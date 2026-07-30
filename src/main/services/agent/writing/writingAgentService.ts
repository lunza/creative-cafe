/**
 * WritingAgentService —— 写作智能体编排服务
 *
 * 来源：spec §二 Task 15.1（编排循环：读大纲→writeChapter→checkPlot→applyAutoFix→updateTable→下一章）
 * 决策：自研（spec §三无对应 openclaw 文件）。写作编排是本项目特有业务，
 *       采用固定编排循环（非动态 agent loop），直接调用现有写作服务：
 *       ContentGenerator / PlotCheckerService / TableOrganizeService / WritingProjectRepository。
 *
 * 职责：
 *  1. runAgentWriting：编排多章节自主写作（读大纲→写章→自审→修复→更新表→下一章）
 *  2. cancel：取消正在进行的编排
 *  3. resumeFromCheckpoint：从断点恢复编排
 *  4. 进度推送：通过 onProgress 回调实时推送编排进度
 *
 * 设计约束（spec §5.2）：
 *  - 不替换现有逐按钮流程：用户手动触发"智能体写作"按钮
 *  - 降级保护：单章失败不中断整体编排（记录失败，继续下一章）
 *  - 断点续跑：每章完成后保存 checkpoint，支持从断点恢复
 *  - 取消支持：通过 AbortController 实现即时取消
 *  - 资源复用：调用 WritingResourceManager 加载世界书/角色卡/人设等素材
 */

import { ContentGenerator } from '../../writing/ContentGenerator';
import { PlotCheckerService, type PlotCheckRequestData } from '../../writing/PlotCheckerService';
import { TableOrganizeService } from '../../writing/TableOrganizeService';
import { WritingProjectRepository } from '../../writing/WritingProjectRepository';
import { WritingTableRepository } from '../../writing/WritingTableRepository';
import { TableEditCommandExecutor } from '../../writing/TableEditCommandExecutor';
import { aiConfigProvider } from '../../ai/AIConfigProvider';
import { writingResourceManager } from '../../WritingResourceManager';
import { PromptBuilder } from '../../writing/PromptBuilder';
import { writingStorageService } from '../../WritingStorageService';
import { createLogger } from '../../logger';
import type {
  AgentWritingRequest,
  AgentWritingOptions,
  AgentWritingEvent,
  AgentWritingProgressCallback,
  AgentWritingResult,
  ChapterAgentResult,
  AgentWritingCheckpoint,
} from './writingAgentTypes';
import { meetsSeverityThreshold } from './writingAgentTypes';
import type {
  WritingProject,
  GeneratedOutline,
  ChapterOutline,
  ContentGenerationRequest,
  PlotCheckReport,
  PlotCheckIssue,
  LogicCheckIssue,
} from '../../../../shared/types/writing.types';

const logger = createLogger('writing-agent');

// ==================== 默认选项 ====================

const DEFAULT_OPTIONS: Required<AgentWritingOptions> = {
  enablePlotCheck: true,
  enableAutoFix: true,
  enableTableOrganize: true,
  autoFixMinSeverity: 'high',
  maxRetriesPerChapter: 2,
  skipExistingChapters: true,
};

// ==================== WritingAgentService 实现 ====================

/**
 * 写作智能体编排服务。
 *
 * 用法：
 * ```ts
 * const service = WritingAgentService.getInstance();
 *
 * // 订阅进度
 * const unsubscribe = service.onProgress(event => {
 *   console.log(`[${event.type}] ${event.message}`);
 * });
 *
 * // 启动编排
 * const result = await service.runAgentWriting(request);
 *
 * // 取消
 * service.cancel();
 * ```
 */
export class WritingAgentService {
  private static instance: WritingAgentService | null = null;

  private readonly contentGenerator: ContentGenerator;
  private readonly plotCheckerService: PlotCheckerService;
  private readonly tableOrganizeService: TableOrganizeService;
  private readonly projectRepo: WritingProjectRepository;
  private readonly tableRepo: WritingTableRepository;
  private readonly promptBuilder: PromptBuilder;

  /** 当前活跃编排的 AbortController（取消用） */
  private abortController: AbortController | null = null;
  /** 是否正在编排 */
  private isRunning = false;
  /** 进度回调列表 */
  private readonly progressCallbacks: Set<AgentWritingProgressCallback> = new Set();

  private constructor() {
    this.contentGenerator = new ContentGenerator();
    this.plotCheckerService = new PlotCheckerService();
    this.projectRepo = new WritingProjectRepository();
    this.tableRepo = new WritingTableRepository();
    this.tableOrganizeService = new TableOrganizeService(
      this.projectRepo,
      this.tableRepo,
      aiConfigProvider,
      new TableEditCommandExecutor()
    );
    this.promptBuilder = new PromptBuilder();
  }

  /**
   * 获取单例实例。
   */
  static getInstance(): WritingAgentService {
    if (!WritingAgentService.instance) {
      WritingAgentService.instance = new WritingAgentService();
    }
    return WritingAgentService.instance;
  }

  /**
   * 是否正在编排。
   */
  get running(): boolean {
    return this.isRunning;
  }

  // ==================== 进度订阅 ====================

  /**
   * 订阅进度事件。
   * @returns 取消订阅函数
   */
  onProgress(callback: AgentWritingProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  /**
   * 推送进度事件。
   */
  private emit(event: AgentWritingEvent): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(event);
      } catch (err) {
        logger.error('Progress callback error', err instanceof Error ? err.message : String(err));
      }
    }
  }

  // ==================== 取消 ====================

  /**
   * 取消当前编排。
   *
   * 触发 AbortController.abort()，编排循环在下一次 checkpoint 检测到取消信号后停止。
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Writing agent cancellation requested');
    }
  }

  /**
   * 检查是否已取消。
   */
  private get isCancelled(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  // ==================== 编排主入口 ====================

  /**
   * 启动智能体写作编排。
   *
   * 编排循环：
   *  1. 加载项目与大纲
   *  2. 确定章节范围（startChapterIndex ~ endChapterIndex）
   *  3. 对每个章节：
   *     a. 跳过已有内容章节（若启用 skipExistingChapters）
   *     b. 生成章节内容（ContentGenerator.generateStream）
   *     c. 保存章节（WritingProjectRepository.autoSaveChapter）
   *     d. 剧情检查（PlotCheckerService.checkChapter）
   *     e. 自动修复 critical/high 问题（PlotCheckerService.autoFixIssue）
   *     f. 整理状态表（TableOrganizeService.organizeTable）
   *     g. 保存 checkpoint
   *  4. 返回编排结果
   *
   * @param request 编排请求
   * @returns 编排结果
   */
  async runAgentWriting(request: AgentWritingRequest): Promise<AgentWritingResult> {
    // 单实例守卫
    if (this.isRunning) {
      return {
        success: false,
        projectId: request.projectId,
        startChapterIndex: request.startChapterIndex ?? 0,
        endChapterIndex: request.endChapterIndex ?? 0,
        totalChapters: 0,
        succeededChapters: 0,
        failedChapters: 0,
        skippedChapters: 0,
        chapterResults: [],
        totalDurationMs: 0,
        cancelled: false,
        error: 'Writing agent is already running. Cancel the current run first.',
      };
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    const startTime = Date.now();

    try {
      return await this.executeOrchestration(request, startTime);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Writing agent orchestration failed', message);
      return {
        success: false,
        projectId: request.projectId,
        startChapterIndex: request.startChapterIndex ?? 0,
        endChapterIndex: request.endChapterIndex ?? 0,
        totalChapters: 0,
        succeededChapters: 0,
        failedChapters: 0,
        skippedChapters: 0,
        chapterResults: [],
        totalDurationMs: Date.now() - startTime,
        cancelled: this.isCancelled,
        error: message,
      };
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  // ==================== 编排执行 ====================

  /**
   * 执行编排核心循环。
   */
  private async executeOrchestration(
    request: AgentWritingRequest,
    startTime: number
  ): Promise<AgentWritingResult> {
    const options = { ...DEFAULT_OPTIONS, ...request.options };

    // 1. 加载项目与大纲
    const project = await this.projectRepo.loadProject(request.projectId);
    if (!project) {
      throw new Error(`项目不存在: ${request.projectId}`);
    }
    if (!project.outline || !project.outline.chapters || project.outline.chapters.length === 0) {
      throw new Error('项目大纲为空，请先生成大纲后再启动智能体写作');
    }

    const outline = project.outline;
    const totalChapters = outline.chapters.length;

    // 2. 确定章节范围
    const startIdx = request.startChapterIndex ?? this.findFirstUnwrittenChapter(project);
    const endIdx = request.endChapterIndex ?? (totalChapters - 1);

    if (startIdx < 0 || startIdx >= totalChapters) {
      throw new Error(`起始章节索引越界: ${startIdx}（大纲共 ${totalChapters} 章）`);
    }
    if (endIdx < startIdx || endIdx >= totalChapters) {
      throw new Error(`结束章节索引越界: ${endIdx}（有效范围 ${startIdx}-${totalChapters - 1}）`);
    }

    const chaptersToWrite = outline.chapters.slice(startIdx, endIdx + 1);
    const actualTotal = chaptersToWrite.length;

    logger.info(`Writing agent started: project=${request.projectId}, chapters=${startIdx}-${endIdx} (${actualTotal} chapters)`);

    // 推送开始事件
    this.emit({
      type: 'started',
      totalChapters: actualTotal,
      completedChapters: 0,
      percent: 0,
      message: `开始智能体写作：共 ${actualTotal} 章`,
      timestamp: Date.now(),
    });

    // 3. 编排循环
    const chapterResults: ChapterAgentResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < chaptersToWrite.length; i++) {
      // 检查取消
      if (this.isCancelled) {
        logger.info('Writing agent cancelled by user');
        this.emit({
          type: 'cancelled',
          completedChapters: i,
          totalChapters: actualTotal,
          percent: Math.round((i / actualTotal) * 100),
          message: '智能体写作已取消',
          timestamp: Date.now(),
        });
        break;
      }

      const chapterOutline = chaptersToWrite[i];
      const chapterIdx = startIdx + i;
      const percent = Math.round((i / actualTotal) * 100);

      // 推送章节开始事件
      this.emit({
        type: 'chapter_started',
        chapterIndex: chapterIdx,
        chapterTitle: chapterOutline.title,
        totalChapters: actualTotal,
        completedChapters: i,
        percent,
        message: `开始第 ${chapterIdx + 1} 章「${chapterOutline.title}」`,
        timestamp: Date.now(),
      });

      try {
        const result = await this.processChapter(
          project,
          outline,
          chapterOutline,
          chapterIdx,
          request,
          options,
          i,
          actualTotal
        );

        chapterResults.push(result);

        if (result.skipped) {
          skipped++;
        } else if (result.success) {
          succeeded++;
        } else {
          failed++;
        }

        // 保存 checkpoint
        const checkpoint: AgentWritingCheckpoint = {
          projectId: request.projectId,
          startChapterIndex: startIdx,
          nextChapterIndex: chapterIdx + 1,
          endChapterIndex: endIdx,
          completedChapters: [...chapterResults],
          createdAt: startTime,
          updatedAt: Date.now(),
        };
        await this.saveCheckpoint(checkpoint);

        // 推送章节完成事件
        this.emit({
          type: 'chapter_completed',
          chapterIndex: chapterIdx,
          chapterTitle: chapterOutline.title,
          totalChapters: actualTotal,
          completedChapters: i + 1,
          percent: Math.round(((i + 1) / actualTotal) * 100),
          message: result.skipped
            ? `第 ${chapterIdx + 1} 章已跳过（已有内容）`
            : `第 ${chapterIdx + 1} 章完成`,
          timestamp: Date.now(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Chapter ${chapterIdx} failed`, message);

        const failedResult: ChapterAgentResult = {
          chapterIndex: chapterIdx,
          chapterTitle: chapterOutline.title,
          content: '',
          wordCount: 0,
          success: false,
          error: message,
          durationMs: 0,
        };
        chapterResults.push(failedResult);
        failed++;

        this.emit({
          type: 'chapter_failed',
          chapterIndex: chapterIdx,
          chapterTitle: chapterOutline.title,
          totalChapters: actualTotal,
          completedChapters: i + 1,
          percent: Math.round(((i + 1) / actualTotal) * 100),
          error: message,
          message: `第 ${chapterIdx + 1} 章失败：${message}`,
          timestamp: Date.now(),
        });

        // 单章失败不中断整体编排，继续下一章
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const completed = succeeded + skipped;
    const success = failed === 0 || completed > 0;

    // 推送完成事件
    this.emit({
      type: 'completed',
      totalChapters: actualTotal,
      completedChapters: completed,
      percent: 100,
      message: `智能体写作完成：成功 ${succeeded}，跳过 ${skipped}，失败 ${failed}`,
      timestamp: Date.now(),
    });

    logger.info(
      `Writing agent finished: succeeded=${succeeded}, skipped=${skipped}, failed=${failed}, duration=${totalDurationMs}ms`
    );

    return {
      success,
      projectId: request.projectId,
      startChapterIndex: startIdx,
      endChapterIndex: endIdx,
      totalChapters: actualTotal,
      succeededChapters: succeeded,
      failedChapters: failed,
      skippedChapters: skipped,
      chapterResults,
      totalDurationMs,
      cancelled: this.isCancelled,
      checkpoint: chapterResults.length > 0
        ? {
            projectId: request.projectId,
            startChapterIndex: startIdx,
            nextChapterIndex: startIdx + chapterResults.length,
            endChapterIndex: endIdx,
            completedChapters: [...chapterResults],
            createdAt: startTime,
            updatedAt: Date.now(),
          }
        : undefined,
    };
  }

  // ==================== 单章处理 ====================

  /**
   * 处理单个章节：写章→保存→检查→修复→整理表。
   */
  private async processChapter(
    project: WritingProject,
    outline: GeneratedOutline,
    chapterOutline: ChapterOutline,
    chapterIdx: number,
    request: AgentWritingRequest,
    options: Required<AgentWritingOptions>,
    currentProgress: number,
    totalChapters: number
  ): Promise<ChapterAgentResult> {
    const chapterStart = Date.now();

    // 检查是否已有内容（跳过逻辑）
    if (options.skipExistingChapters) {
      // 注：已写章节内容存储在单独的文件中，通过 autoSaveChapter 保存。
      // 此处通过加载章节内容文件判断是否已有内容。
      const hasContent = await this.hasChapterContent(request.projectId, chapterIdx);
      if (hasContent) {
        logger.info(`Chapter ${chapterIdx} already has content, skipping`);
        return {
          chapterIndex: chapterIdx,
          chapterTitle: chapterOutline.title,
          content: '',
          wordCount: 0,
          skipped: true,
          success: true,
          durationMs: Date.now() - chapterStart,
        };
      }
    }

    // ---- 步骤 1：生成章节内容 ----
    this.emit({
      type: 'chapter_writing',
      chapterIndex: chapterIdx,
      chapterTitle: chapterOutline.title,
      totalChapters,
      completedChapters: currentProgress,
      message: `正在生成第 ${chapterIdx + 1} 章内容...`,
      timestamp: Date.now(),
    });

    let content = '';
    let retries = 0;
    let lastError: string | undefined;

    while (retries <= options.maxRetriesPerChapter) {
      try {
        content = await this.generateChapterContent(outline, chapterOutline, chapterIdx, request);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        retries++;
        if (retries <= options.maxRetriesPerChapter) {
          logger.warn(`Chapter ${chapterIdx} generation attempt ${retries} failed: ${lastError}, retrying...`);
        }
      }
    }

    if (!content) {
      return {
        chapterIndex: chapterIdx,
        chapterTitle: chapterOutline.title,
        content: '',
        wordCount: 0,
        success: false,
        error: `章节内容生成失败（重试 ${retries} 次）：${lastError}`,
        durationMs: Date.now() - chapterStart,
      };
    }

    const wordCount = this.countWords(content);

    // ---- 步骤 2：保存章节 ----
    await this.projectRepo.autoSaveChapter(
      request.projectId,
      chapterIdx,
      content,
      true // isAutoGenerated
    );

    this.emit({
      type: 'chapter_written',
      chapterIndex: chapterIdx,
      chapterTitle: chapterOutline.title,
      totalChapters,
      completedChapters: currentProgress,
      message: `第 ${chapterIdx + 1} 章生成完成（${wordCount} 字）`,
      timestamp: Date.now(),
    });

    let plotCheckReport: PlotCheckReport | undefined;
    let fixedIssueCount = 0;

    // ---- 步骤 3：剧情检查 ----
    if (options.enablePlotCheck) {
      this.emit({
        type: 'chapter_checking',
        chapterIndex: chapterIdx,
        chapterTitle: chapterOutline.title,
        totalChapters,
        completedChapters: currentProgress,
        message: `正在检查第 ${chapterIdx + 1} 章剧情...`,
        timestamp: Date.now(),
      });

      try {
        plotCheckReport = await this.checkChapter(request, project, chapterOutline, chapterIdx, content);

        this.emit({
          type: 'chapter_checked',
          chapterIndex: chapterIdx,
          chapterTitle: chapterOutline.title,
          totalChapters,
          completedChapters: currentProgress,
          plotCheckReport,
          message: `第 ${chapterIdx + 1} 章检查完成：总分 ${plotCheckReport.overallScore}，问题 ${plotCheckReport.totalIssues} 个`,
          timestamp: Date.now(),
        });

        // ---- 步骤 4：自动修复 ----
        if (options.enableAutoFix && plotCheckReport.totalIssues > 0) {
          this.emit({
            type: 'chapter_fixing',
            chapterIndex: chapterIdx,
            chapterTitle: chapterOutline.title,
            totalChapters,
            completedChapters: currentProgress,
            message: `正在修复第 ${chapterIdx + 1} 章问题...`,
            timestamp: Date.now(),
          });

          const fixResult = await this.autoFixIssues(
            request,
            chapterIdx,
            content,
            plotCheckReport,
            options.autoFixMinSeverity
          );

          if (fixResult.fixedContent && fixResult.fixedContent !== content) {
            content = fixResult.fixedContent;
            fixedIssueCount = fixResult.fixedCount;

            // 保存修复后的内容
            await this.projectRepo.autoSaveChapter(
              request.projectId,
              chapterIdx,
              content,
              true
            );
          }

          this.emit({
            type: 'chapter_fixed',
            chapterIndex: chapterIdx,
            chapterTitle: chapterOutline.title,
            totalChapters,
            completedChapters: currentProgress,
            fixedIssueCount,
            message: `第 ${chapterIdx + 1} 章修复完成：修复 ${fixedIssueCount} 个问题`,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        // 剧情检查失败不中断章节编排，仅记录
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Chapter ${chapterIdx} plot check failed: ${msg}`);
      }
    }

    // ---- 步骤 5：整理状态表 ----
    if (options.enableTableOrganize) {
      this.emit({
        type: 'chapter_organizing',
        chapterIndex: chapterIdx,
        chapterTitle: chapterOutline.title,
        totalChapters,
        completedChapters: currentProgress,
        message: `正在整理第 ${chapterIdx + 1} 章状态表...`,
        timestamp: Date.now(),
      });

      try {
        await this.organizeTable(request.projectId, request.modelConfig, chapterIdx);
        this.emit({
          type: 'chapter_organized',
          chapterIndex: chapterIdx,
          chapterTitle: chapterOutline.title,
          totalChapters,
          completedChapters: currentProgress,
          message: `第 ${chapterIdx + 1} 章状态表整理完成`,
          timestamp: Date.now(),
        });
      } catch (err) {
        // 表格整理失败不中断编排
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Chapter ${chapterIdx} table organize failed: ${msg}`);
      }
    }

    return {
      chapterIndex: chapterIdx,
      chapterTitle: chapterOutline.title,
      content,
      wordCount,
      plotCheckReport,
      fixedIssueCount,
      success: true,
      durationMs: Date.now() - chapterStart,
    };
  }

  // ==================== 章节内容生成 ====================

  /**
   * 生成章节内容。
   *
   * 构建 ContentGenerationRequest 并调用 ContentGenerator.generateStream。
   */
  private async generateChapterContent(
    outline: GeneratedOutline,
    chapterOutline: ChapterOutline,
    chapterIdx: number,
    request: AgentWritingRequest
  ): Promise<string> {
    // 加载素材资源
    const resourceIds = request.resources || {};
    const worldBookIds = resourceIds.worldBookIds || [];
    const characterCardIds = resourceIds.characterCardIds || [];
    const userPersonaIds = resourceIds.userPersonaIds || [];
    const writingStyleIds = resourceIds.writingStyleIds || [];

    const [worldBooks, characters, userPersonas, writingStyles] = await Promise.all([
      worldBookIds.length > 0 ? writingResourceManager.loadWorldBooks(worldBookIds) : Promise.resolve([]),
      characterCardIds.length > 0 ? writingResourceManager.loadCharacterCards(characterCardIds) : Promise.resolve([]),
      userPersonaIds.length > 0 ? writingResourceManager.loadUserPersonas(userPersonaIds) : Promise.resolve([]),
      writingStyleIds.length > 0 ? writingResourceManager.loadWritingStyles(writingStyleIds) : Promise.resolve([]),
    ]);

    // 构建世界书上下文（向量检索相关条目）
    const worldBookContext = await this.buildWorldBookContext(worldBooks, chapterOutline);

    // 构建角色上下文
    const characterContext = characters.map(c => ({
      name: c.name,
      description: c.description,
      personality: c.personality,
      mesExample: c.mesExample,
    }));

    // 构建人设上下文
    // 注：UserPersonaContext 类型仅含 name/description，但 ContentGenerationRequest.userPersonaContext
    // 还要求 traits: string[]。此处 traits 留空数组（素材库的 UserPersona 暂未提供 traits 字段）。
    const userPersonaContext = userPersonas.map(p => ({
      name: p.name,
      description: p.description,
      traits: [] as string[],
    }));

    // 构建前序章节上下文（取前 3 章摘要）
    const previousChapters = outline.chapters
      .slice(Math.max(0, chapterIdx - 3), chapterIdx)
      .map(ch => ({
        index: ch.index,
        title: ch.title,
        summary: ch.summary || '',
      }));

    // 构建写作风格上下文
    let writingStyleContext: string | undefined;
    if (writingStyles.length > 0) {
      writingStyleContext = this.promptBuilder.buildWritingStylePrompt(writingStyles);
    }

    // 加载表格数据
    let writingTableData: ContentGenerationRequest['writingTableData'];
    const tableData = await writingStorageService.getTableData(request.projectId);
    const tableConfig = await writingStorageService.getTableConfig(request.projectId);
    if (tableData && tableConfig) {
      writingTableData = {
        tableConfig: {
          // associatedTemplateId 在 WritingTableConfig 中为 string | null，
          // 而 ContentGenerationRequest.writingTableData.tableConfig.associatedTemplateId 为 string，
          // 此处将 null 归一化为空字符串以兼容类型（表格未关联模板时即为空）
          associatedTemplateId: tableConfig.associatedTemplateId || '',
          associatedTemplateName: tableConfig.associatedTemplateName,
        },
        sheets: tableData.sheets,
        headers: tableData.headers,
        data: tableData.data,
        sheetDescriptions: tableData.sheetDescriptions,
      };
    }

    // 构建 ContentGenerationRequest
    const genRequest: ContentGenerationRequest = {
      chapterInfo: {
        index: chapterIdx,
        title: chapterOutline.title,
        outline: chapterOutline.summary || '',
        characters: chapterOutline.characters || [],
        scenes: chapterOutline.scenes || [],
      },
      previousChapters,
      worldBookContext,
      characterContext,
      userPersonaContext,
      generationParams: {
        targetWordCount: chapterOutline.targetWordCount || 3000,
        style: request.generationParams.style,
        perspective: request.generationParams.perspective,
        novelType: request.generationParams.novelType,
        constraints: request.generationParams.constraints,
        writingStyleContext,
      },
      modelConfig: request.modelConfig,
      projectId: request.projectId,
      chapterIndex: chapterIdx,
      resources: request.resources,
      writingTableData,
      customNovelTypeId: request.customNovelTypeId,
      customWritingStyleId: request.customWritingStyleId,
    };

    // 调用 ContentGenerator 生成内容（非流式收集）
    const result = await this.contentGenerator.generateStream(
      genRequest,
      request.modelConfig,
      () => {
        // 流式 chunk 不需要处理（编排模式下收集完整内容）
        // 检查取消
        if (this.isCancelled) {
          throw new Error('用户取消了写作');
        }
      },
      this.abortController!.signal
    );

    return result.content || '';
  }

  // ==================== 世界书上下文构建 ====================

  /**
   * 构建世界书上下文（向量检索相关条目）。
   */
  private async buildWorldBookContext(
    worldBooks: Array<{
      name: string;
      entries?: Array<{ uid?: string; name?: string; content: string; keywords?: string[] }>;
    }>,
    chapterOutline: ChapterOutline
  ): Promise<Array<{ entryName: string; content: string; keywords: string[]; relevance: number }>> {
    const entries: Array<{ entryName: string; content: string; keywords: string[]; relevance: number }> = [];
    const searchText = chapterOutline.summary || chapterOutline.title || '';

    for (const wb of worldBooks) {
      try {
        // 尝试向量检索
        const { worldBookService } = await import('../../worldBookService');
        const searchResults = await worldBookService.searchWorldBookEntriesByVector(searchText, 5);

        if (searchResults.length > 0) {
          for (const result of searchResults) {
            const meta = result.metadata as Record<string, unknown>;
            const entryName = (meta.entryName as string) || (meta.name as string) || wb.name;
            const entryContent = (meta.entryContent as string) || (meta.content as string) || '';
            const entryKeywords = (meta.entryKeys as string[]) || (meta.keywords as string[]) || [];

            if (entryContent && entryContent.trim()) {
              entries.push({
                entryName,
                content: entryContent,
                keywords: Array.isArray(entryKeywords) ? entryKeywords : [entryKeywords].filter(Boolean),
                relevance: result.score,
              });
            }
          }
        } else {
          // 回退：使用原始数据
          if (wb.entries) {
            for (const entry of wb.entries) {
              if (entry.content && entry.content.trim()) {
                entries.push({
                  entryName: entry.name || '未命名',
                  content: entry.content,
                  keywords: entry.keywords || [],
                  relevance: 0.5,
                });
              }
            }
          }
        }
      } catch {
        // 向量检索失败，回退使用原始数据
        if (wb.entries) {
          for (const entry of wb.entries) {
            if (entry.content && entry.content.trim()) {
              entries.push({
                entryName: entry.name || '未命名',
                content: entry.content,
                keywords: entry.keywords || [],
                relevance: 0.5,
              });
            }
          }
        }
      }
    }

    return entries;
  }

  // ==================== 剧情检查 ====================

  /**
   * 执行剧情检查。
   *
   * 构建 PlotCheckRequestData（与 writingPlotCheckHandlers 对齐）并调用 PlotCheckerService.checkChapter。
   */
  private async checkChapter(
    request: AgentWritingRequest,
    project: WritingProject,
    _chapterOutline: ChapterOutline,
    chapterIdx: number,
    content: string
  ): Promise<PlotCheckReport> {
    // 加载表格数据（剧情检查需要）
    const tableData = await writingStorageService.getTableData(request.projectId);
    const tableConfig = await writingStorageService.getTableConfig(request.projectId);

    const checkRequest: PlotCheckRequestData = {
      projectId: request.projectId,
      chapterIndex: chapterIdx,
      content,
      outline: project.outline,
      resources: (project.config as { resources?: PlotCheckRequestData['resources'] })?.resources || {
        worldBookIds: request.resources?.worldBookIds || [],
        characterCardIds: request.resources?.characterCardIds || [],
      },
      novelType: (project.config as { parameters?: { novelType?: PlotCheckRequestData['novelType'] } })?.parameters?.novelType,
      writingStyle: (project.config as { parameters?: { writingStyle?: PlotCheckRequestData['writingStyle'] } })?.parameters?.writingStyle,
      modelConfig: request.modelConfig,
      previousChapters: [],
      writingTableData: tableData && tableConfig
        ? {
            tableConfig: {
              associatedTemplateId: tableConfig.associatedTemplateId || '',
              associatedTemplateName: tableConfig.associatedTemplateName,
            },
            sheets: tableData.sheets,
            headers: tableData.headers,
            data: tableData.data,
            sheetDescriptions: tableData.sheetDescriptions,
          }
        : undefined,
    };

    return this.plotCheckerService.checkChapter(checkRequest);
  }

  // ==================== 自动修复 ====================

  /**
   * 自动修复剧情问题。
   *
   * 遍历所有维度的问题，对满足严重级别阈值的 quickFixable 问题执行 autoFixIssue。
   */
  private async autoFixIssues(
    request: AgentWritingRequest,
    chapterIdx: number,
    content: string,
    report: PlotCheckReport,
    minSeverity: 'critical' | 'high' | 'medium' | 'low'
  ): Promise<{ fixedContent: string; fixedCount: number }> {
    let fixedContent = content;
    let fixedCount = 0;

    // 收集所有需要修复的问题
    const issuesToFix: Array<{ issue: PlotCheckIssue | LogicCheckIssue; issueType: 'dimension' | 'logic' }> = [];

    for (const dim of report.dimensions) {
      for (const issue of dim.issues) {
        if (
          issue.quickFixable &&
          issue.quickFixSuggestion &&
          meetsSeverityThreshold(issue.severity, minSeverity)
        ) {
          issuesToFix.push({ issue, issueType: 'dimension' });
        }
      }
    }

    // 逻辑检查问题
    if (report.logicCheckResult) {
      for (const issue of report.logicCheckResult.issues) {
        if (
          issue.quickFixable &&
          issue.quickFixSuggestion &&
          meetsSeverityThreshold(issue.severity, minSeverity)
        ) {
          issuesToFix.push({ issue, issueType: 'logic' });
        }
      }
    }

    // 逐个修复
    for (const { issue, issueType } of issuesToFix) {
      if (this.isCancelled) break;

      try {
        const fixResult = await this.plotCheckerService.autoFixIssue(
          request.projectId,
          chapterIdx,
          fixedContent,
          issue,
          issueType,
          request.modelConfig
        );

        if (fixResult.success && fixResult.fixedContent) {
          fixedContent = fixResult.fixedContent;
          fixedCount++;
          // PlotCheckIssue 有 title 字段，LogicCheckIssue 没有（用 chapterTitle/description 兜底）
          const issueLabel =
            issueType === 'dimension'
              ? (issue as PlotCheckIssue).title || issue.description
              : (issue as LogicCheckIssue).chapterTitle || issue.description;
          logger.info(`Chapter ${chapterIdx} issue fixed: ${issueLabel}`);
        }
      } catch (err) {
        logger.warn(
          `Chapter ${chapterIdx} issue fix failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return { fixedContent, fixedCount };
  }

  // ==================== 表格整理 ====================

  /**
   * 整理状态表。
   */
  private async organizeTable(
    projectId: string,
    modelConfig: { model: string; temperature: number; maxTokens: number },
    chapterIdx: number
  ): Promise<void> {
    // 检查是否已关联表格模板
    const tableConfig = await this.tableRepo.getTableConfig(projectId);
    if (!tableConfig || !tableConfig.associatedTemplateId) {
      logger.info(`Project ${projectId} has no table template, skipping table organize`);
      return;
    }

    await this.tableOrganizeService.organizeTable(
      projectId,
      modelConfig,
      chapterIdx,
      undefined, // onProgress（编排模式不需要表格整理的细粒度进度）
      undefined, // requirements
      true       // skipOrganized（跳过已整理的）
    );
  }

  // ==================== 工具方法 ====================

  /**
   * 查找第一个未完成章节。
   *
   * 实现策略：遍历大纲章节，找到第一个 content 为空或长度过短的章节。
   * 若所有章节都有内容，返回 0（从头开始，由 skipExistingChapters 处理跳过）。
   */
  private findFirstUnwrittenChapter(project: WritingProject): number {
    if (!project.outline?.chapters) return 0;
    for (const ch of project.outline.chapters) {
      const contentLen = ch.content ? ch.content.trim().length : 0;
      if (contentLen < 100) {
        return ch.index;
      }
    }
    return 0;
  }

  /**
   * 检查章节是否已有内容。
   *
   * 通过检查章节内容文件是否存在且非空来判断。
   * 章节文件路径与 WritingProjectRepository.autoSaveChapter 对齐：
   *   {projectDir}/chapters/chapter-{index}.md
   * 其中 index 经 formatChapterIndex 格式化（去除尾零，如 1.0 → "1"，1.5 → "1.5"）。
   */
  private async hasChapterContent(projectId: string, chapterIndex: number): Promise<boolean> {
    try {
      // 动态导入避免循环依赖；getProjectDir 来自 WritingProjectRepository
      const { getProjectDir } = await import('../../writing/WritingProjectRepository');
      const projectDir = getProjectDir(projectId);
      const fs = await import('fs/promises');
      const path = await import('path');

      // 与 WritingProjectRepository.formatChapterIndex 对齐：去除浮点尾零
      const safeIndex = parseFloat(chapterIndex.toFixed(10)).toString();
      const chapterFile = path.join(projectDir, 'chapters', `chapter-${safeIndex}.md`);

      try {
        const content = await fs.readFile(chapterFile, 'utf-8');
        return content.trim().length > 100;
      } catch {
        return false; // 文件不存在或读取失败
      }
    } catch {
      return false;
    }
  }

  /**
   * 统计字数（中文按字符计，英文按单词计）。
   */
  private countWords(content: string): number {
    // 中文字符数 + 英文单词数
    const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  // ==================== Checkpoint 持久化 ====================

  /**
   * 保存 checkpoint（断点续跑用）。
   *
   * 当前实现：内存存储（后续可扩展到 SQLite）。
   */
  private async saveCheckpoint(checkpoint: AgentWritingCheckpoint): Promise<void> {
    // 存储到内存（后续可扩展到 SQLite agent_memory 表）
    WritingAgentService.lastCheckpoint = checkpoint;
  }

  /**
   * 获取最近一次 checkpoint。
   */
  static getLastCheckpoint(): AgentWritingCheckpoint | null {
    return WritingAgentService.lastCheckpoint;
  }

  /**
   * 清除 checkpoint。
   */
  static clearCheckpoint(): void {
    WritingAgentService.lastCheckpoint = null;
  }

  private static lastCheckpoint: AgentWritingCheckpoint | null = null;

  // ==================== 断点续跑 ====================

  /**
   * 从 checkpoint 恢复编排。
   */
  async resumeFromCheckpoint(
    originalRequest: AgentWritingRequest
  ): Promise<AgentWritingResult> {
    const checkpoint = WritingAgentService.lastCheckpoint;
    if (!checkpoint || checkpoint.projectId !== originalRequest.projectId) {
      // 无 checkpoint，从头开始
      return this.runAgentWriting(originalRequest);
    }

    logger.info(
      `Resuming from checkpoint: nextChapter=${checkpoint.nextChapterIndex}, endChapter=${checkpoint.endChapterIndex}`
    );

    // 从 nextChapterIndex 恢复
    return this.runAgentWriting({
      ...originalRequest,
      startChapterIndex: checkpoint.nextChapterIndex,
      endChapterIndex: checkpoint.endChapterIndex,
    });
  }
}
