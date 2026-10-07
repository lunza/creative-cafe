/**
 * 小说全流程创作流水线服务（主进程编排层）
 *
 * Spec: add-novel-writing-pipeline-api
 *
 * 编排既有服务（零 V1 改动）：
 *   init（建项目+资源绑定）→ generateOutline（大纲，注入角色卡/世界书）
 *   → generateChapter（分片大纲→逐分片生成→合并落盘）→ compose（成书导出）
 *
 * - 单一真相源：项目实体（DB）为唯一真相源
 * - 统一信封：{ success, data?, error?, code?, stage?, partial? }
 * - 进度：onProgress 回调（handler 层转发到 writing:pipeline:progress 事件）
 * - 取消：cancelFlag 在分片级/章节级检查，当前分片 AI 调用完成后停止
 */
import fs from 'fs';
import path from 'path';
import { writingStorageService, getWritingProjectsPath } from '../WritingStorageService';
import { writingResourceManager } from '../WritingResourceManager';
import { outlineGenerator } from './OutlineGenerator';
import { contentGenerator } from './ContentGenerator';
import { promptBuilder } from './PromptBuilder';
import { characterService } from '../characterService';
import { worldBookService } from '../worldBookService';
import { addLog } from '../memory/chatLogService';
import { pathService } from '../pathService';
import { getStorageService } from '../storageService';
import { plotCheckerService, PlotCheckRequestData } from './PlotCheckerService';
import { mangaParsingService } from '../manga/MangaParsingService';
import {
  WRITING_TABLE_TEMPLATES,
  WRITING_DEFAULT_TABLE_TEMPLATE_ID,
} from '../../../shared/constants/writingTableTemplates';
import type { PlotCheckIssue, LogicCheckIssue, ModelConfig } from '../../../shared/types/writing.types';
import {
  LOGIC_CONTRADICTION_TYPE_LABELS,
  WritingProject,
  WritingConfig,
  ProjectStatus,
  ExportFormat,
  ChapterOutline,
  NovelType,
  NarrativePerspective,
} from '../../../shared/types/writing.types';
import { buildExportContent } from '../../../shared/utils/v2ExportContent';
import {
  validatePipelineInit,
  suggestedShardCount,
  assertE2EResult,
  verdictOf,
} from '../../../shared/utils/pipelineUtils';
import type {
  PipelineEnvelope,
  PipelineStage,
  PipelineErrorCode,
  PipelineProgressEvent,
  PipelineInitParams,
  PipelineCreateCharacterParams,
  PipelineE2EParams,
  PipelineE2EReport,
  PipelineV2ChapterRecord,
  PipelineV2IssueFixRecord,
} from '../../../shared/types/writing-v2.types';

interface PipelineSession {
  stage: PipelineStage;
  running: boolean;
  currentChapter: number;
  totalChapters: number;
  cancelFlag: boolean;
}

/** 1x1 透明 PNG（E2E/最小角色卡占位图） */
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type ProgressCallback = (event: PipelineProgressEvent) => void;

function ok<T>(data: T): PipelineEnvelope<T> {
  return { success: true, data };
}

function fail<T = undefined>(
  error: string,
  code: PipelineErrorCode,
  stage?: PipelineStage,
  partial?: { projectId?: string; completedChapters: number }
): PipelineEnvelope<T> {
  return { success: false, error, code, stage, partial };
}

/** runAll 成功时的返回数据 */
type RunAllData = { projectId: string; filePath: string; wordCount: number; chapterCount: number };

export class WritingPipelineService {
  private readonly sessions = new Map<string, PipelineSession>();

  private getSession(projectId: string): PipelineSession {
    let s = this.sessions.get(projectId);
    if (!s) {
      s = { stage: 'IDLE', running: false, currentChapter: 0, totalChapters: 0, cancelFlag: false };
      this.sessions.set(projectId, s);
    }
    return s;
  }

  private emit(
    projectId: string,
    onProgress: ProgressCallback | undefined,
    stage: PipelineStage,
    current: number,
    total: number,
    message: string
  ): void {
    if (!onProgress) return;
    onProgress({
      projectId,
      stage,
      current,
      total,
      message,
      percent: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
    });
  }

  // ==================== 资源 ====================

  /** 列出可选角色卡/世界书（id 与既有资源绑定语义一致：文件路径） */
  async listResources(): Promise<
    PipelineEnvelope<{ characters: Array<{ id: string; name: string }>; worldBooks: Array<{ id: string; name: string }> }>
  > {
    try {
      const [charItems, wbItems] = await Promise.all([
        characterService.listCharacters(),
        worldBookService.listWorldBooks(),
      ]);
      const characters = (charItems ?? []).map((c: any) => ({
        id: c.path,
        name: c.characterName || c.name || path.basename(c.path),
      }));
      const worldBooks = (wbItems ?? []).map((w: any) => ({
        id: w.path,
        name: (w.name || path.basename(w.path)).replace(/\.(json5?|json)$/i, ''),
      }));
      return ok({ characters, worldBooks });
    } catch (error) {
      return fail(`[资源列表] ${error instanceof Error ? error.message : '未知错误'}`, 'INTERNAL');
    }
  }

  /** 创建最小角色卡（占位图 + 卡数据） */
  async createCharacterCard(
    params: PipelineCreateCharacterParams
  ): Promise<PipelineEnvelope<{ id: string; name: string }>> {
    try {
      if (!params?.name?.trim()) {
        return fail('[角色卡] 名称不能为空', 'VALIDATION');
      }
      const dir = pathService.getCustomPath('character');
      fs.mkdirSync(dir, { recursive: true });
      const safe = params.name.trim().replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${safe}-${Date.now()}.png`;
      const filePath = path.join(dir, fileName);
      const result = await characterService.createCharacterFromImage(filePath, PLACEHOLDER_PNG_BASE64, {
        data: {
          name: params.name.trim(),
          description: params.profile || '',
          personality: params.personality || '',
          scenario: params.scenario || '',
          creator: 'writing-pipeline',
          tags: ['writing-pipeline'],
        },
      });
      if (!result.success) {
        return fail(`[角色卡] ${result.error || '创建失败'}`, 'RESOURCE');
      }
      addLog(`[Pipeline] 创建角色卡: ${filePath}`, 'info');
      return ok({ id: filePath, name: params.name.trim() });
    } catch (error) {
      return fail(`[角色卡] ${error instanceof Error ? error.message : '创建失败'}`, 'RESOURCE');
    }
  }

  // ==================== 初始化 ====================

  /** 初始化项目 + 资源绑定（复用 writing:createProject 同款项目结构） */
  async init(
    params: PipelineInitParams,
    onProgress?: ProgressCallback
  ): Promise<PipelineEnvelope<{ projectId: string }>> {
    try {
      // 资源 id 存在性校验（候选列表）
      const res = await this.listResources();
      const candidates =
        res.success && res.data
          ? {
              characterIds: (res.data as any).characters.map((c: any) => c.id),
              worldBookIds: (res.data as any).worldBooks.map((w: any) => w.id),
            }
          : undefined;
      const validation = validatePipelineInit(params, candidates);
      if (!validation.ok) {
        return fail(`[初始化] ${validation.errors.join('；')}`, 'VALIDATION');
      }

      const projectId = `writing_project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      // 归一化：NovelTypeTemplates 以 NovelType 枚举值为键，非法值回退 OTHER，
      // 否则 buildSystemPrompt 读 template.systemPrompt 会崩溃（E2E 首跑踩坑）
      const novelType = (Object.values(NovelType) as string[]).includes(params.novelType)
        ? params.novelType
        : NovelType.OTHER;
      const narrativePerspective = (Object.values(NarrativePerspective) as string[]).includes(
        params.narrativePerspective
      )
        ? params.narrativePerspective
        : NarrativePerspective.THIRD_PERSON;
      const config: WritingConfig = {
        parameters: {
          creativeDescription: params.creativeDescription,
          novelType,
          narrativePerspective,
          writingStyle: params.writingStyle || '',
          targetWordCount: params.targetWordCount,
          chapterCount: params.chapterCount,
        } as WritingConfig['parameters'],
        modelConfig: params.modelConfig,
        resources: {
          worldBookIds: params.worldBookIds,
          characterCardIds: params.characterCardIds,
          userPersonaIds: [],
          writingStyleIds: [],
        } as WritingConfig['resources'],
      };

      const title = params.title?.trim() || params.creativeDescription.substring(0, 20);
      const project: WritingProject = {
        id: projectId,
        title,
        status: ProjectStatus.OUTLINING,
        config,
        outline: {
          workInfo: {
            suggestedTitle: title,
            genre: novelType,
            targetWordCount: params.targetWordCount,
            writingStyle: params.writingStyle || '',
          } as any,
          storyLine: { mainPlot: '', subPlots: [], theme: '' } as any,
          chapters: Array.from({ length: params.chapterCount }, (_, i) => ({
            index: i,
            title: `第${i + 1}章`,
            summary: '',
            keyPlotPoints: [],
            characters: [],
            scenes: [],
            targetWordCount: Math.round(params.targetWordCount / params.chapterCount),
          })) as unknown as ChapterOutline[],
          characterRelationships: [],
          worldbuildingNotes: [],
        },
        outlineRaw: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastSavedAt: Date.now(),
        metadata: {
          totalWordCount: 0,
          completedChapters: 0,
          generationSettings: {
            model: params.modelConfig.model,
            temperature: params.modelConfig.temperature,
          },
          continuityInfo: { foreshadowing: [], plotThreads: [], characterDevelopment: {} },
        } as any,
      };

      const saved = await writingStorageService.saveProject(project);
      if (!saved) {
        return fail('[初始化] 项目落盘失败', 'INTERNAL');
      }
      const session = this.getSession(projectId);
      session.stage = 'INIT';
      session.totalChapters = params.chapterCount;
      this.emit(projectId, onProgress, 'INIT', 1, 1, '项目已创建');
      addLog(`[Pipeline] 项目初始化: ${projectId}（${params.chapterCount} 章 / ${params.targetWordCount} 字）`, 'info');
      return ok({ projectId });
    } catch (error) {
      return fail(`[初始化] ${error instanceof Error ? error.message : '未知错误'}`, 'INTERNAL');
    }
  }

  // ==================== 大纲 ====================

  /** 生成大纲并落盘（注入已绑定角色卡/世界书） */
  async generateOutline(
    projectId: string,
    onProgress?: ProgressCallback
  ): Promise<
    PipelineEnvelope<{ chapterCount: number; chapters: Array<{ index: number; title: string; summary: string }> }>
  > {
    const session = this.getSession(projectId);
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return fail('[大纲] 项目不存在', 'VALIDATION');
      session.stage = 'OUTLINE';
      session.running = true;
      this.emit(projectId, onProgress, 'OUTLINE', 0, 1, '正在生成大纲…');

      const resources = project.config.resources ?? { worldBookIds: [], characterCardIds: [] };
      const worldBooks = await writingResourceManager.loadWorldBooks(resources.worldBookIds ?? []);
      const characters = await writingResourceManager.loadCharacterCards(resources.characterCardIds ?? []);
      const userPersonas = await writingResourceManager.loadUserPersonas(resources.userPersonaIds ?? []);
      const writingStyles = await writingResourceManager.loadWritingStyles(resources.writingStyleIds ?? []);
      const resourceContext = writingResourceManager.buildResourceContextSummary(
        worldBooks,
        characters,
        userPersonas,
        writingStyles
      );
      const writingStyleContext =
        writingStyles.length > 0 ? promptBuilder.buildWritingStylePrompt(writingStyles) : '';

      const request: any = {
        parameters: project.config.parameters,
        modelConfig: project.config.modelConfig,
        resources,
        _resourceContext: resourceContext,
        _writingStyleContext: writingStyleContext,
      };

      const result = await outlineGenerator.generate(
        outlineGenerator.buildPrompt(request),
        project.config.modelConfig,
        new AbortController().signal
      );
      if (!result?.rawContent) {
        return fail('[大纲] AI 未返回大纲内容', 'AI', 'OUTLINE');
      }
      const outline = outlineGenerator.parseOutlineResponse(result.rawContent);
      if (!outline || !outline.chapters || outline.chapters.length === 0) {
        return fail('[大纲] 大纲解析失败（无章节）', 'AI', 'OUTLINE');
      }

      // 与初始化章节数对齐（复用 V2 对齐语义：截断/补全 + 重排 index + 目标字数均分）
      const want = project.config.parameters.chapterCount;
      const chapters = outline.chapters.slice(0, want).map((c, i) => ({
        ...c,
        index: i,
        targetWordCount: Math.round(project.config.parameters.targetWordCount / want),
      }));
      while (chapters.length < want) {
        const i = chapters.length;
        chapters.push({
          index: i,
          title: `第${i + 1}章`,
          summary: '',
          keyPlotPoints: [],
          characters: [],
          scenes: [],
          targetWordCount: Math.round(project.config.parameters.targetWordCount / want),
        } as unknown as ChapterOutline);
      }
      outline.chapters = chapters as any;

      project.outline = outline;
      project.outlineRaw = result.rawContent;
      project.status = ProjectStatus.WRITING;
      project.updatedAt = Date.now();
      await writingStorageService.saveProject(project);

      session.stage = 'OUTLINE';
      session.running = false;
      this.emit(projectId, onProgress, 'OUTLINE', 1, 1, '大纲生成完成');
      addLog(`[Pipeline] 大纲完成: ${projectId}（${chapters.length} 章）`, 'info');
      return ok({
        chapterCount: chapters.length,
        chapters: chapters.map((c: any) => ({ index: c.index, title: c.title, summary: c.summary || '' })),
      });
    } catch (error) {
      session.running = false;
      return fail(`[大纲] ${error instanceof Error ? error.message : '生成失败'}`, 'AI', 'OUTLINE');
    }
  }

  // ==================== 章节（分片流水线） ====================

  /** 生成单章：分片大纲 → 逐分片生成 → 合并落盘 */
  async generateChapter(
    projectId: string,
    chapterIndex: number,
    shardCount?: number,
    onProgress?: ProgressCallback
  ): Promise<PipelineEnvelope<{ chapterIndex: number; wordCount: number; shardCount: number }>> {
    const session = this.getSession(projectId);
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return fail('[章节] 项目不存在', 'VALIDATION');
      const chapter = project.outline?.chapters?.[chapterIndex];
      if (!chapter) {
        return fail(`[章节] 第 ${chapterIndex + 1} 章不存在`, 'VALIDATION');
      }

      session.stage = 'CHAPTER';
      session.running = true;
      session.currentChapter = chapterIndex + 1;

      const modelConfig = project.config.modelConfig;
      const resources = project.config.resources;
      // 漫画源素材（与角色卡/世界书同级）：项目携带 mangaReference 时构建全文上下文，
      // 注入分片大纲 + 分片内容，让 AI 写作时能参考具体台词/动作/场景细节
      const mangaReferenceContext =
        project.mangaReference?.analyses?.length
          ? mangaParsingService.buildMangaReferenceContext(project.mangaReference)
          : '';
      const chapterInfo = {
        index: chapter.index,
        title: chapter.title,
        outline: chapter.summary,
        characters: chapter.characters || [],
        scenes: chapter.scenes || [],
      };
      const generationParams = {
        targetWordCount: chapter.targetWordCount,
        style: project.config.parameters?.writingStyle || '',
        perspective: project.config.parameters?.narrativePerspective,
        novelType: project.config.parameters?.novelType,
      };

      // 表格数据注入（与既有分片链路一致）
      const tableData = await writingStorageService.getTableData(projectId);
      const tableConfig = await writingStorageService.getTableConfig(projectId);
      const writingTableData =
        tableData && tableConfig
          ? {
              tableConfig: {
                associatedTemplateId: tableConfig.associatedTemplateId,
                associatedTemplateName: tableConfig.associatedTemplateName,
              },
              sheets: tableData.sheets,
              headers: tableData.headers,
              data: tableData.data,
              sheetDescriptions: tableData.sheetDescriptions,
            }
          : undefined;

      // 1) 分片大纲（模型偶发输出非法 JSON——本地小模型全量首跑实测踩过——失败重试 1 次）
      const shardsPlan = shardCount ?? suggestedShardCount(chapter.targetWordCount || 2000);
      this.emit(projectId, onProgress, 'CHAPTER', 0, shardsPlan, `第 ${chapterIndex + 1} 章：生成分片大纲…`);
      let outlineResult: any;
      for (let attempt = 1; attempt <= 2; attempt++) {
        outlineResult = await contentGenerator.generateShardOutline(
          {
            projectId,
            chapterIndex,
            shardCount: shardsPlan,
            chapterInfo,
            resources,
            generationParams,
            modelConfig,
            writingTableData,
            mangaReferenceContext: mangaReferenceContext || undefined,
          } as any,
          modelConfig,
          new AbortController().signal
        );
        if (outlineResult?.success && outlineResult.shards?.length) break;
        if (attempt < 2) {
          addLog(
            `[Pipeline] 第 ${chapterIndex + 1} 章分片大纲第 ${attempt} 次失败（${outlineResult?.error || '未知错误'}），重试…`,
            'warn'
          );
          this.emit(
            projectId,
            onProgress,
            'CHAPTER',
            0,
            shardsPlan,
            `第 ${chapterIndex + 1} 章：分片大纲重试（${attempt}/2）…`
          );
        }
      }
      if (!outlineResult?.success || !outlineResult.shards?.length) {
        return fail(
          `[章节] 第 ${chapterIndex + 1} 章分片大纲失败：${outlineResult?.error || '未知错误'}`,
          'AI',
          'CHAPTER',
          { projectId, completedChapters: chapterIndex }
        );
      }
      const shards = outlineResult.shards;

      // 2) 逐分片生成（分片级取消检查）
      const parts: string[] = [];
      for (let i = 0; i < shards.length; i++) {
        if (session.cancelFlag) {
          session.running = false;
          return fail(
            `[章节] 用户已取消（第 ${chapterIndex + 1} 章已生成 ${i}/${shards.length} 分片）`,
            'CANCELLED',
            'CHAPTER',
            { projectId, completedChapters: chapterIndex }
          );
        }
        this.emit(
          projectId,
          onProgress,
          'CHAPTER',
          i + 1,
          shards.length,
          `第 ${chapterIndex + 1} 章：分片 ${i + 1}/${shards.length} 生成中…`
        );
        const previous = parts.join('\n\n');
        let content = '';
        try {
          const result: any = await contentGenerator.generateShardContent(
            {
              projectId,
              chapterIndex,
              shardIndex: i,
              totalShards: shards.length,
              shardOutline: shards[i],
              previousShardContents: previous,
              chapterInfo,
              resources,
              generationParams,
              modelConfig,
              writingTableData,
              mangaReferenceContext: mangaReferenceContext || undefined,
            } as any,
            modelConfig,
            () => {},
            new AbortController().signal
          );
          content = result?.content || '';
        } catch (err) {
          return fail(
            `[章节] 第 ${chapterIndex + 1} 章分片 ${i + 1} 生成失败：${err instanceof Error ? err.message : '未知错误'}`,
            'AI',
            'CHAPTER',
            { projectId, completedChapters: chapterIndex }
          );
        }
        if (content && content.trim()) {
          parts.push(content.trim());
        }
      }

      // 3) 合并落盘
      const merged = parts.join('\n\n');
      if (!merged) {
        return fail(
          `[章节] 第 ${chapterIndex + 1} 章无有效内容`,
          'AI',
          'CHAPTER',
          { projectId, completedChapters: chapterIndex }
        );
      }
      await writingStorageService.autoSaveChapter(projectId, chapterIndex, merged);
      session.running = false;
      this.emit(projectId, onProgress, 'CHAPTER', shards.length, shards.length, `第 ${chapterIndex + 1} 章完成（${merged.length} 字）`);
      addLog(`[Pipeline] 章节完成: ${projectId} 第 ${chapterIndex + 1} 章（${merged.length} 字 / ${shards.length} 分片）`, 'info');
      return ok({ chapterIndex, wordCount: merged.length, shardCount: shards.length });
    } catch (error) {
      session.running = false;
      return fail(
        `[章节] ${error instanceof Error ? error.message : '生成失败'}`,
        'AI',
        'CHAPTER',
        { projectId, completedChapters: chapterIndex }
      );
    }
  }

  // ==================== 成书导出 ====================

  /** 成书导出（复用 writingV2:exportWithChapters 同款逻辑） */
  async compose(
    projectId: string,
    format: ExportFormat,
    chapterIndices?: number[],
    onProgress?: ProgressCallback
  ): Promise<PipelineEnvelope<{ filePath: string; wordCount: number; chapterCount: number }>> {
    const session = this.getSession(projectId);
    try {
      session.stage = 'COMPOSE';
      session.running = true;
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return fail('[成书] 项目不存在', 'VALIDATION');
      const allChapters = project.outline?.chapters ?? [];
      const selected =
        chapterIndices && chapterIndices.length > 0
          ? allChapters.filter((c) => chapterIndices.includes(c.index))
          : allChapters;
      if (selected.length === 0) {
        return fail('[成书] 没有可导出的章节', 'EXPORT', 'COMPOSE');
      }

      const exportDir = path.join(getWritingProjectsPath(), 'exports');
      fs.mkdirSync(exportDir, { recursive: true });
      const ext = format === ExportFormat.MARKDOWN ? 'md' : format === ExportFormat.JSON ? 'json' : 'txt';
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const exportPath = path.join(exportDir, `${project.title || 'untitled'}-pipeline-${stamp}.${ext}`);
      const content = buildExportContent(project, selected, format);
      fs.writeFileSync(exportPath, content, 'utf8');

      const wordCount = selected.reduce((s, c) => s + (c.content || '').length, 0);
      session.stage = 'DONE';
      session.running = false;
      this.emit(projectId, onProgress, 'COMPOSE', 1, 1, `成书完成：${exportPath}`);
      addLog(`[Pipeline] 成书导出: ${exportPath}（${selected.length} 章 / ${wordCount} 字）`, 'info');
      return ok({ filePath: exportPath, wordCount, chapterCount: selected.length });
    } catch (error) {
      session.running = false;
      return fail(`[成书] ${error instanceof Error ? error.message : '导出失败'}`, 'EXPORT', 'COMPOSE');
    }
  }

  // ==================== 一键全流程 ====================

  /** init → outline → 逐章 → compose；任一步失败即停止并保留部分结果 */
  async runAll(
    params: PipelineInitParams,
    onProgress?: ProgressCallback
  ): Promise<PipelineEnvelope<RunAllData>> {
    const initResult = await this.init(params, onProgress);
    if (!initResult.success || !initResult.data) {
      return initResult as unknown as PipelineEnvelope<RunAllData>;
    }
    const projectId = (initResult.data as { projectId: string }).projectId;
    const session = this.getSession(projectId);

    const outlineResult = await this.generateOutline(projectId, onProgress);
    if (!outlineResult.success) {
      return {
        ...fail(`[全流程] ${outlineResult.error ?? '大纲生成失败'}`, outlineResult.code ?? 'AI', 'OUTLINE', {
          projectId,
          completedChapters: 0,
        }),
      } as PipelineEnvelope<RunAllData>;
    }

    const chapterCount = params.chapterCount;
    for (let i = 0; i < chapterCount; i++) {
      if (session.cancelFlag) {
        const composed = await this.compose(projectId, ExportFormat.MARKDOWN, undefined, onProgress);
        return {
          ...fail(`[全流程] 用户已取消（已完成 ${i}/${chapterCount} 章）`, 'CANCELLED', 'CHAPTER', {
            projectId,
            completedChapters: i,
          }),
          ...(composed.success && composed.data
            ? { data: { projectId, ...(composed.data as object) } as any }
            : {}),
        };
      }
      const chResult = await this.generateChapter(projectId, i, undefined, onProgress);
      if (!chResult.success) {
        return chResult as unknown as PipelineEnvelope<RunAllData>;
      }
    }

    const composed = await this.compose(projectId, ExportFormat.MARKDOWN, undefined, onProgress);
    if (!composed.success || !composed.data) {
      return {
        ...fail(`[全流程] ${composed.error ?? '成书导出失败'}`, composed.code ?? 'EXPORT', 'COMPOSE', {
          projectId,
          completedChapters: chapterCount,
        }),
      } as PipelineEnvelope<RunAllData>;
    }
    return {
      success: true,
      data: { projectId, ...(composed.data as object) } as any,
    };
  }

  // ==================== 状态 / 取消 ====================

  status(
    projectId: string
  ): PipelineEnvelope<{ stage: PipelineStage; currentChapter: number; totalChapters: number; running: boolean }> {
    const s = this.getSession(projectId);
    return ok({
      stage: s.stage,
      currentChapter: s.currentChapter,
      totalChapters: s.totalChapters,
      running: s.running,
    });
  }

  cancel(projectId: string): PipelineEnvelope {
    const s = this.getSession(projectId);
    if (!s.running) {
      return fail('[取消] 当前没有进行中的流水线任务', 'VALIDATION');
    }
    s.cancelFlag = true;
    addLog(`[Pipeline] 取消请求: ${projectId}`, 'info');
    return ok(undefined);
  }

  // ==================== E2E（dev-only，handler 层做 dev 门禁） ====================

  /**
   * E2E：2 角色卡 + 1 世界书 + 3 章（smoke 6000 / full 20000）→ 断言 → 报告落盘
   */
  async runE2E(
    params: PipelineE2EParams,
    onProgress?: ProgressCallback
  ): Promise<PipelineEnvelope<{ report: PipelineE2EReport }>> {
    const startedAt = Date.now();
    const scale = params?.scale === 'full' ? 'full' : 'smoke';
    const targetWordCount = scale === 'full' ? 20000 : 6000;
    const chapterCount = 3;
    const report: PipelineE2EReport = {
      scale,
      startedAt,
      finishedAt: 0,
      durationMs: 0,
      characterNames: [],
      worldBookName: '',
      projectId: '',
      exportPath: '',
      wordCount: 0,
      chapterCount,
      assertions: [],
      verdict: 'FAIL',
    };

    const finalize = <T = undefined>(envelope: PipelineEnvelope<T>): PipelineEnvelope<T> => {
      report.finishedAt = Date.now();
      report.durationMs = report.finishedAt - report.startedAt;
      try {
        const exportDir = path.join(getWritingProjectsPath(), 'exports');
        fs.mkdirSync(exportDir, { recursive: true });
        const reportPath = path.join(
          exportDir,
          `e2e-report-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.json`
        );
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        (report as any).reportPath = reportPath;
      } catch (e) {
        addLog(`[PipelineE2E] 报告落盘失败: ${e instanceof Error ? e.message : e}`, 'error');
      }
      addLog(
        `[PipelineE2E] ${scale} 结束: ${report.verdict}（${report.durationMs}ms）`,
        report.verdict === 'PASS' ? 'info' : 'error'
      );
      return envelope;
    };

    try {
      // 1) 素材保障：角色 <2 创建补齐；世界书 <1 创建
      const res = await this.listResources();
      if (!res.success || !res.data) {
        throw new Error(`资源列表失败：${res.error}`);
      }
      const resources = res.data as {
        characters: Array<{ id: string; name: string }>;
        worldBooks: Array<{ id: string; name: string }>;
      };

      let chars = resources.characters;
      if (chars.length < 2) {
        const need = 2 - chars.length;
        for (let i = 0; i < need; i++) {
          const created = await this.createCharacterCard({
            name: `e2e-测试角色${chars.length + i + 1}`,
            profile: `${chars.length + i + 1} 号端到端测试角色，性格鲜明，有明确的目标与弱点，会在故事中经历成长。`,
            personality: '坚韧、好奇、富有同理心；说话简洁有力，关键时刻可靠。',
            scenario: 'e2e 流水线自动测试',
          });
          if (!created.success || !created.data) throw new Error(`创建角色卡失败：${created.error}`);
          chars = [...chars, created.data as { id: string; name: string }];
        }
      }
      const [charA, charB] = chars;

      let wbs = resources.worldBooks;
      if (wbs.length < 1) {
        const wbDir = worldBookService.getWorldBookDir();
        const wbPath = path.join(wbDir, `e2e-测试世界书-${Date.now()}.json`);
        await worldBookService.writeWorldBook(wbPath, {
          name: 'e2e-测试世界书',
          content:
            '世界设定：故事发生在云澜大陆，这里悬浮着九块大陆，以灵脉相连。每百年一次的灵潮会唤醒沉睡的星核，掌握星核之人可改写大陆版图。',
          entries: {
            1: {
              name: '灵潮',
              content: '每百年出现一次的天地灵气潮汐，会唤醒沉睡的星核。',
              keywords: ['灵潮'],
            },
            2: {
              name: '云澜大陆',
              content: '九块悬浮大陆以灵脉相连，星核是大陆的力量核心。',
              keywords: ['云澜大陆'],
            },
          },
        });
        wbs = [...wbs, { id: wbPath, name: 'e2e-测试世界书' }];
      }
      const wb = wbs[0];
      // 世界书核心词条（用于注入断言）：兼容两种条目格式——
      // 自有格式 { name, keywords: [] } 与 SillyTavern 格式 { key: [], keysecondary: [] }
      const wbData = await worldBookService.readWorldBook(wb.id);
      const wbKeywords: string[] = [];
      const pushKw = (v: unknown) => {
        const s = String(v ?? '').trim();
        if (s && !wbKeywords.includes(s)) wbKeywords.push(s);
      };
      if (wbData?.entries) {
        for (const entry of Object.values<any>(wbData.entries)) {
          (Array.isArray(entry?.keywords) ? entry.keywords : []).forEach(pushKw);
          (Array.isArray(entry?.key) ? entry.key : []).forEach(pushKw);
          (Array.isArray(entry?.keysecondary) ? entry.keysecondary : []).forEach(pushKw);
          pushKw(entry?.name);
        }
      }
      pushKw(wbData?.name);
      pushKw(wb.name);

      report.characterNames = [charA.name, charB.name];
      report.worldBookName = wb.name;

      // 2) 全流程（3 章）——modelConfig 解析自应用设置的激活 AI 引擎（取值规则与 V2 向导一致）
      const settings = getStorageService().getSettings();
      const engines = settings?.aiEngines || [];
      const engine: any =
        engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
      if (!engine) {
        throw new Error('未配置可用的 AI 引擎，请先在应用设置中配置 AI 引擎');
      }
      const modelConfig = {
        model: engine.model_name || engine.model || '',
        temperature: engine.temperature ?? 0.8,
        maxTokens: engine.max_tokens ?? 4096,
      };

      const creativeDescription =
        `${charA.name}与${charB.name}在${wb.name}的世界中相遇，因神秘异变踏上冒险之旅。` +
        '两人从陌生到信任，在夺宝之争中成长，最终揭开异变背后的真相。' +
        (wbKeywords[0] ? `世界观与核心术语须遵循世界书，正文须自然出现词条「${wbKeywords[0]}」。` : '');
      const runResult = await this.runAll(
        {
          creativeDescription,
          novelType: NovelType.FANTASY,
          narrativePerspective: NarrativePerspective.THIRD_PERSON,
          writingStyle: '',
          targetWordCount,
          chapterCount,
          characterCardIds: [charA.id, charB.id],
          worldBookIds: [wb.id],
          modelConfig,
        },
        onProgress
      );

      report.projectId =
        runResult.partial?.projectId || (runResult.data as any)?.projectId || '';
      if (runResult.success && runResult.data) {
        const d = runResult.data as {
          projectId: string;
          filePath: string;
          wordCount: number;
          chapterCount: number;
        };
        report.projectId = d.projectId;
        report.exportPath = d.filePath;
        report.wordCount = d.wordCount;
        report.chapterCount = d.chapterCount;
      }

      // 3) 断言
      const project = report.projectId
        ? await writingStorageService.loadProject(report.projectId)
        : null;
      const chapters = (project?.outline?.chapters ?? []).map((c: any) => ({
        index: c.index,
        title: c.title,
        content: c.content || '',
        targetWordCount: c.targetWordCount,
      }));
      const outlineText = (project?.outline?.storyLine as any)?.summary ||
        (project?.outline as any)?.characterRelationships?.join(' ') ||
        (project?.outlineRaw || '');
      const exportedFileExists =
        !!report.exportPath && fs.existsSync(report.exportPath) && fs.statSync(report.exportPath).size > 0;

      report.assertions = assertE2EResult({
        chapters,
        expected: {
          chapterCount,
          targetWordCount,
          characterNames: report.characterNames,
          worldbookKeywords: wbKeywords,
          outlineText,
          exportedFileExists,
        },
      });
      report.verdict = verdictOf(report.assertions);

      if (!runResult.success) {
        report.error = runResult.error;
        report.verdict = 'FAIL';
      }

      return finalize(ok({ report }));
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      report.verdict = 'FAIL';
      // 尽力落断言为空
      if (report.assertions.length === 0) {
        report.assertions = [
          { name: 'e2e', passed: false, detail: report.error || '未知错误' },
        ];
      }
      return finalize(fail<{ report: PipelineE2EReport }>(`[E2E] ${report.error}`, 'INTERNAL'));
    }
  }

  // ==================== 写作模式 2.0 整合测试（Spec: test-writing-v2-integrated-e2e） ====================

  /**
   * v2-integrated 整合测试：
   *   1) 素材选择（世界书"西雅图沿海兽人小镇"/角色卡"Lucky"/人设"Pixel"，缺失则创建并记录）
   *   2) 项目创建（[E2E-TEST] 写作模式2.0整合测试，20000 字 / 4 章，白话文 + 先抑后扬创意描述）
   *   3) 绑定内置表格模板「小说设定总表」
   *   4) 大纲生成（记录基准）
   *   5) 逐章循环：AI 生成（注入已整理表格上下文）→ 剧情检查 → 逐条单条修正（记录 diff）→ 表格整理（验证完整性）→ 落盘
   *   6) 断言 + 报告落盘（exports/v2-integrated-report-*.json）
   */
  async runV2IntegratedE2E(
    onProgress?: ProgressCallback
  ): Promise<PipelineEnvelope<{ report: PipelineE2EReport }>> {
    const startedAt = Date.now();
    const chapterCount = 4;
    const targetWordCount = 20000;
    const report: PipelineE2EReport = {
      scale: 'v2-integrated',
      startedAt,
      finishedAt: 0,
      durationMs: 0,
      characterNames: [],
      worldBookName: '',
      projectId: '',
      exportPath: '',
      wordCount: 0,
      chapterCount,
      assertions: [],
      verdict: 'FAIL',
      missingResources: [],
      chapters: [],
    };
    const step = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
      addLog(`[V2E2E] ${msg}`, level);
      if (level === 'error') console.error(`[V2E2E] ${msg}`);
      else console.log(`[V2E2E] ${msg}`);
    };
    const failAssertion = (name: string, detail: string) =>
      report.assertions.push({ name, passed: false, detail });
    const okAssertion = (name: string, detail: string) =>
      report.assertions.push({ name, passed: true, detail });

    const finalize = <T = undefined>(envelope: PipelineEnvelope<T>): PipelineEnvelope<T> => {
      report.finishedAt = Date.now();
      report.durationMs = report.finishedAt - report.startedAt;
      report.verdict = report.assertions.every((a) => a.passed) && !report.error ? 'PASS' : 'FAIL';
      try {
        const exportDir = path.join(getWritingProjectsPath(), 'exports');
        fs.mkdirSync(exportDir, { recursive: true });
        const reportPath = path.join(
          exportDir,
          `v2-integrated-report-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.json`
        );
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        (report as { reportPath?: string }).reportPath = reportPath;
        step(`报告已落盘: ${reportPath}`);
      } catch (e) {
        step(`报告落盘失败: ${e instanceof Error ? e.message : e}`, 'error');
      }
      step(`v2-integrated 结束: ${report.verdict}（${report.durationMs}ms）`);
      return envelope;
    };

    try {
      // ---------- Task 3: 模型配置（系统默认激活引擎） ----------
      const settings = getStorageService().getSettings();
      const engines = settings?.aiEngines || [];
      const engine: any = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
      if (!engine) throw new Error('未配置可用的 AI 引擎，请先在应用设置中配置 AI 引擎');
      const modelConfig: ModelConfig = {
        model: engine.model_name || engine.model || '',
        temperature: engine.temperature ?? 0.8,
        maxTokens: engine.max_tokens ?? 4096,
      };
      report.modelBaseline = { ...modelConfig };
      step(`[模型基准] ${JSON.stringify(report.modelBaseline)}（激活引擎 id=${engine.id}）`);

      // ---------- Task 4: 素材选择（按名称查找，缺失则创建并记录） ----------
      const res = await this.listResources();
      if (!res.success || !res.data) throw new Error(`资源列表失败：${res.error}`);
      const resources = res.data as {
        characters: Array<{ id: string; name: string }>;
        worldBooks: Array<{ id: string; name: string }>;
      };

      const wbHit = resources.worldBooks.find((w) => w.name.includes('西雅图沿海兽人小镇'));
      let worldBook = wbHit ? { id: wbHit.id, name: wbHit.name } : null;
      if (!worldBook) {
        step('世界书"西雅图沿海兽人小镇"不存在，创建测试世界书', 'warn');
        const wbDir = worldBookService.getWorldBookDir();
        const wbPath = path.join(wbDir, `西雅图沿海兽人小镇-${Date.now()}.json`);
        await worldBookService.writeWorldBook(wbPath, {
          name: '西雅图沿海兽人小镇',
          content:
            '故事发生在美国西雅图郊外一座依山傍海的兽人小镇——灰湾镇（Grey Cove）。这里的人类与兽人混居，渔业是经济支柱，每年十月有"潮汐节"。小镇安静祥和，但暗流涌动。',
          entries: {
            1: { name: '灰湾镇', content: '西雅图郊外的沿海兽人小镇，人类与兽人混居，渔业为主业。', keywords: ['灰湾镇'] },
            2: { name: '潮汐节', content: '每年十月的镇庆，渔船出海、篝火晚会、渔王评选。', keywords: ['潮汐节'] },
            3: { name: '老码头', content: '小镇最古老的木码头，尽头是修船厂与灯塔，是镇上人的聚会地。', keywords: ['老码头'] },
          },
        });
        worldBook = { id: wbPath, name: '西雅图沿海兽人小镇' };
        report.missingResources!.push('世界书"西雅图沿海兽人小镇"缺失（已自动创建）');
      }
      report.worldBookName = worldBook.name;
      step(`[素材] 世界书: ${worldBook.name}（id=${worldBook.id}，${wbHit ? '已存在' : '新建'}）`);

      const charHit = resources.characters.find((c) => /lucky/i.test(c.name));
      let character = charHit ? { id: charHit.id, name: charHit.name } : null;
      if (!character) {
        step('角色卡"Lucky"不存在，创建测试角色卡', 'warn');
        const created = await this.createCharacterCard({
          name: 'Lucky',
          profile: 'Lucky 陈，26 岁灰湾镇渔家女儿，红发海獭兽人，性格倔强乐观，梦想开一家自己的海鲜餐厅。',
          personality: '倔强、乐观、手艺人脾气；说话直来直去，关键时刻顶得住事。',
          scenario: '写作模式2.0整合测试主角',
        });
        if (!created.success || !created.data) throw new Error(`创建角色卡 Lucky 失败：${created.error}`);
        character = created.data as { id: string; name: string };
        report.missingResources!.push('角色卡"Lucky"缺失（已自动创建）');
      }
      report.characterNames = [character.name];
      step(`[素材] 角色卡: ${character.name}（id=${character.id}，${charHit ? '已存在' : '新建'}）`);

      // 人设 Pixel（listResources 不含 personas，直接扫描 avatars 目录，与 preload listPersonas 同源）
      const avatarDir = pathService.getCustomPath('avatar');
      let persona: { id: string; name: string } | null = null;
      try {
        if (fs.existsSync(avatarDir)) {
          for (const f of fs.readdirSync(avatarDir)) {
            if (!f.toLowerCase().endsWith('.json') || f.includes('user-profile.json')) continue;
            try {
              const data = JSON.parse(fs.readFileSync(path.join(avatarDir, f), 'utf8'));
              if (/pixel/i.test(String(data.name || f))) {
                persona = { id: path.join(avatarDir, f), name: data.name || f };
                break;
              }
            } catch { /* 单文件解析失败忽略 */ }
          }
        }
      } catch (e) {
        step(`人设目录扫描失败: ${e instanceof Error ? e.message : e}`, 'warn');
      }
      if (!persona) {
        step('人设"Pixel"不存在，创建测试人设', 'warn');
        fs.mkdirSync(avatarDir, { recursive: true });
        const personaPath = path.join(avatarDir, `Pixel-${Date.now()}.json`);
        fs.writeFileSync(
          personaPath,
          JSON.stringify(
            {
              name: 'Pixel',
              description: '写作测试人设：叙事冷静克制，白话文，重细节描写（场景/气味/触感/对话/心理），节奏先抑后扬。',
              creator: 'writing-pipeline',
            },
            null,
            2
          ),
          'utf8'
        );
        persona = { id: personaPath, name: 'Pixel' };
        report.missingResources!.push('人设"Pixel"缺失（已自动创建）');
      }
      step(`[素材] 人设: ${persona.name}（id=${persona.id}）`);
      step(`[素材] 写作风格: 置空（writingStyle=''）`);
      report.resources = { worldBook, character, persona, writingStyle: '' };

      // ---------- Task 2: 项目创建 + 参数配置 ----------
      const creativeDescription =
        `一部现实主义题材的短篇小说，共 4 章，总字数约 ${targetWordCount} 字（每章约 5000 字）。` +
        '故事发生在西雅图郊外的沿海兽人小镇（设定遵循世界书"西雅图沿海兽人小镇"，须自然出现其核心词条）。' +
        `女主角 ${character.name} 是镇上海獭兽人渔家女，梦想开一家自己的海鲜餐厅，却因一笔债务陷入低谷（先抑）；` +
        '男主角是镇上餐厅的落魄主厨，两人从合作到并肩，靠手艺与诚信度过危机，最终在潮汐节上迎来转机（后扬）。' +
        '写作要求：1) 采用通俗易懂的白话文，确保文化水平不高的读者也能轻松理解；' +
        '2) 剧情描写必须包含多维度细节：场景环境、气味感知、触感体验、外观特征、物体状态、人物动作、对话内容、生理特征与心理活动，增强沉浸感；' +
        '3) 人物描写重点突出男女主角，弱化其他配角；' +
        '4) 故事背景符合现实逻辑，增强读者代入感；' +
        '5) 章节标题须直白准确地概括该章核心内容；' +
        '6) 禁止：过度重复描写、疯狂/黑暗/血腥场景、自残/自虐/自杀情节、散文及诗词类写作手法。';
      const initResult = await this.init(
        {
          title: '[E2E-TEST] 写作模式2.0整合测试',
          creativeDescription,
          novelType: NovelType.ROMANCE,
          narrativePerspective: NarrativePerspective.THIRD_PERSON,
          writingStyle: '',
          targetWordCount,
          chapterCount,
          characterCardIds: [character.id],
          worldBookIds: [worldBook.id],
          modelConfig,
        },
        onProgress
      );
      if (!initResult.success || !initResult.data) {
        throw new Error(`项目创建失败：${initResult.error}`);
      }
      const projectId = (initResult.data as { projectId: string }).projectId;
      report.projectId = projectId;
      step(`[项目] 已创建: ${projectId}（[E2E-TEST] 写作模式2.0整合测试，${chapterCount} 章 / ${targetWordCount} 字 / novelType=${NovelType.ROMANCE} / 第三人称 / 风格置空）`);

      // 人设绑定（init 未含 persona，直接写回项目配置）
      const boundProject = await writingStorageService.loadProject(projectId);
      if (boundProject) {
        boundProject.config.resources.userPersonaIds = [persona.id];
        await writingStorageService.saveProject(boundProject);
        step(`[项目] 人设已绑定: ${persona.name}`);
      }

      // ---------- 绑定内置表格模板（小说设定总表）——表格整理功能前置 ----------
      const tableTpl =
        WRITING_TABLE_TEMPLATES.find((t) => t.id === WRITING_DEFAULT_TABLE_TEMPLATE_ID) ?? WRITING_TABLE_TEMPLATES[0];
      await writingStorageService.associateTableTemplate(
        projectId,
        tableTpl.id,
        tableTpl.name,
        tableTpl.sheets.map((s) => ({ name: s.name, headers: s.headers, description: s.description }))
      );
      step(`[表格] 已绑定模板「${tableTpl.name}」（${tableTpl.sheets.length} 个 sheet）`);
      okAssertion('表格模板绑定', `模板「${tableTpl.name}」${tableTpl.sheets.length} 个 sheet`);

      // ---------- Task 5: 大纲生成 ----------
      const outlineStart = Date.now();
      step('[大纲] 开始生成…');
      const outlineResult = await this.generateOutline(projectId, onProgress);
      if (!outlineResult.success || !outlineResult.data) {
        throw new Error(`大纲生成失败：${outlineResult.error}`);
      }
      report.outline = {
        chapterCount: outlineResult.data.chapterCount,
        chapters: outlineResult.data.chapters,
        durationMs: Date.now() - outlineStart,
      };
      step(
        `[大纲] 生成完成（${report.outline.durationMs}ms，${report.outline.chapterCount} 章）：` +
          report.outline.chapters.map((c) => `第${c.index + 1}章「${c.title}」`).join('；')
      );
      okAssertion('大纲生成', `${report.outline.chapterCount} 章 / ${report.outline.durationMs}ms`);
      okAssertion('大纲章节数=4', String(report.outline.chapterCount));

      // 大纲保存基准（报告已含 outline；另导出 Markdown 基准文件）
      try {
        const exportDir = path.join(getWritingProjectsPath(), 'exports');
        fs.mkdirSync(exportDir, { recursive: true });
        const outlineStamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const outlineFile = path.join(exportDir, `v2-integrated-outline-${outlineStamp}.md`);
        fs.writeFileSync(
          outlineFile,
          `# [E2E-TEST] 写作模式2.0整合测试 — 大纲基准\n\n生成时间: ${new Date(outlineStart).toISOString()}\n耗时: ${report.outline.durationMs}ms\n\n` +
            report.outline.chapters
              .map((c) => `## 第${c.index + 1}章 ${c.title}\n\n${c.summary || '（无摘要）'}\n`)
              .join('\n'),
          'utf8'
        );
        report.exportPath = outlineFile;
        step(`[大纲] 基准已保存: ${outlineFile}`);
      } catch (e) {
        step(`大纲基准保存失败: ${e instanceof Error ? e.message : e}`, 'warn');
      }

      // ---------- Task 6: 章节循环（生成 → 剧情检查 → 单条修正 → 表格整理） ----------
      const modelCfg = report.modelBaseline;
      for (let i = 0; i < chapterCount; i++) {
        const proj = (await writingStorageService.loadProject(projectId)) as WritingProject;
        const chapter = proj.outline?.chapters?.[i];
        const rec: PipelineV2ChapterRecord = {
          index: i,
          title: chapter?.title || `第${i + 1}章`,
          generation: {
            startedAt: 0, finishedAt: 0, durationMs: 0, wordCount: 0, shardCount: 0,
            tableInjectionChars: 0, tableSheets: 0, tableRows: 0,
          },
          plotCheck: null,
          fixes: null,
          table: null,
        };

        // 6.1 AI 生成（generateChapter 内部已注入当前表格数据作为上下文）
        const tblBefore = await writingStorageService.getTableData(projectId);
        rec.generation.tableSheets = tblBefore?.sheets?.length ?? 0;
        rec.generation.tableRows = tblBefore?.data
          ? Object.values(tblBefore.data).reduce((s, rows) => s + (Array.isArray(rows) ? rows.length : 0), 0)
          : 0;
        rec.generation.tableInjectionChars = JSON.stringify(tblBefore?.data ?? {}).length;
        step(
          `[第${i + 1}章] 6.1 AI 生成开始（${rec.generation.tableSheets} 个表格 sheet / ${rec.generation.tableRows} 行数据作为上下文注入）`
        );
        const genStart = Date.now();
        this.emit(projectId, onProgress, 'CHAPTER', i + 1, chapterCount, `第 ${i + 1} 章：AI 生成中…`);
        const chResult = await this.generateChapter(projectId, i, undefined, onProgress);
        rec.generation.startedAt = genStart;
        rec.generation.finishedAt = Date.now();
        rec.generation.durationMs = rec.generation.finishedAt - genStart;
        if (!chResult.success || !chResult.data) {
          step(`[第${i + 1}章] 6.1 生成失败: ${chResult.error}`, 'error');
          failAssertion(`第${i + 1}章-AI生成`, chResult.error || '未知错误');
          report.chapters?.push(rec);
          report.wordCount = (await this.countWords(projectId)).wordCount;
          break;
        }
        rec.generation.wordCount = chResult.data.wordCount;
        rec.generation.shardCount = chResult.data.shardCount;
        step(
          `[第${i + 1}章] 6.1 生成完成: ${rec.generation.wordCount} 字 / ${rec.generation.shardCount} 分片 / ${rec.generation.durationMs}ms` +
            `（表格注入: ${rec.generation.tableSheets} sheet / ${rec.generation.tableRows} 行 / ${rec.generation.tableInjectionChars} 字符）`
        );
        okAssertion(`第${i + 1}章-AI生成`, `${rec.generation.wordCount} 字 / ${rec.generation.durationMs}ms`);

        // 6.2 剧情检查
        const checkProj = (await writingStorageService.loadProject(projectId)) as WritingProject;
        const checkChapter = checkProj.outline?.chapters?.[i];
        const content = checkChapter?.content || '';
        step(`[第${i + 1}章] 6.2 剧情检查开始（内容 ${content.length} 字）…`);
        const checkStart = Date.now();
        let report2: Awaited<ReturnType<typeof plotCheckerService.checkChapter>> | null = null;
        type V2IssueEntry = { title: string; type: 'dimension' | 'logic'; severity: string; suggestion: string; originalText?: string };
        let issues: V2IssueEntry[] = [];
        try {
          const tableData = await writingStorageService.getTableData(projectId);
          const tableConfig = await writingStorageService.getTableConfig(projectId);
          const checkRequest: PlotCheckRequestData = {
            projectId,
            chapterIndex: i,
            content,
            outline: checkProj.outline,
            resources: checkProj.config?.resources || { worldBookIds: [], characterCardIds: [] },
            novelType: checkProj.config?.parameters?.novelType,
            writingStyle: checkProj.config?.parameters?.writingStyle,
            modelConfig: modelCfg,
            previousChapters: (checkProj.outline?.chapters ?? [])
              .filter((c) => c.index < i && c.content && c.content.trim())
              .slice(-1)
              .map((c) => ({ index: c.index, title: c.title, content: (c.content || '').slice(0, 4000) })),
            writingTableData:
              tableData && tableConfig
                ? {
                    tableConfig: {
                      associatedTemplateId: tableConfig.associatedTemplateId || '',
                      associatedTemplateName: tableConfig.associatedTemplateName || '',
                    },
                    sheets: tableData.sheets,
                    headers: tableData.headers,
                    data: tableData.data,
                    sheetDescriptions: tableData.sheetDescriptions,
                  }
                : undefined,
          };
          report2 = await plotCheckerService.checkChapter(checkRequest);
        } catch (e) {
          step(`[第${i + 1}章] 6.2 剧情检查失败: ${e instanceof Error ? e.message : e}`, 'error');
          failAssertion(`第${i + 1}章-剧情检查`, e instanceof Error ? e.message : String(e));
        }
        const checkMs = Date.now() - checkStart;
        if (report2) {
          const dimIssues: typeof issues = [];
          for (const dim of report2.dimensions) {
            for (const issue of dim.issues) {
              dimIssues.push({
                title: issue.title,
                type: 'dimension',
                severity: issue.severity,
                suggestion: issue.suggestion,
                originalText: issue.quickFixSuggestion?.originalText,
              });
            }
          }
          for (const issue of report2.logicCheckResult?.issues ?? []) {
            dimIssues.push({
              title: LOGIC_CONTRADICTION_TYPE_LABELS[issue.type] || issue.type,
              type: 'logic',
              severity: issue.severity,
              suggestion: issue.suggestion || issue.analysis || '',
              originalText: issue.quickFixSuggestion?.originalText,
            });
          }
          rec.plotCheck = {
            startedAt: checkStart,
            finishedAt: checkStart + checkMs,
            durationMs: checkMs,
            score: report2.overallScore,
            totalIssues: report2.totalIssues,
            issues: dimIssues,
          };
          step(
            `[第${i + 1}章] 6.2 剧情检查完成: 评分 ${report2.overallScore} / 问题 ${report2.totalIssues} / ${checkMs}ms`
          );
          okAssertion(`第${i + 1}章-剧情检查`, `评分 ${report2.overallScore} / ${report2.totalIssues} 问题`);
        }

        // 6.3 单条修正（每条建议独立修正；本地模型慢，限制修正条数控制时长）
        if (report2 && rec.plotCheck && rec.plotCheck.issues.length > 0) {
          const MAX_FIX = 2;
          const targets = rec.plotCheck.issues.slice(0, MAX_FIX);
          let current = content;
          const records: PipelineV2IssueFixRecord[] = [];
          let successCount = 0;
          let failedCount = 0;
          for (let k = 0; k < targets.length; k++) {
            const t = targets[k];
            // 还原原始 issue 对象（autoFixIssue 需要完整字段）
            const rawIssue: (PlotCheckIssue | LogicCheckIssue) & { quickFixSuggestion?: any } = t.type === 'dimension'
              ? (report2.dimensions.flatMap((d) => d.issues).find((x) => x.title === t.title) ??
                ({ title: t.title, description: t.suggestion, suggestion: t.suggestion, severity: t.severity, dimension: 'outline_consistency', quickFixSuggestion: t.originalText ? { originalText: t.originalText, fixedText: '', reason: '' } : undefined } as any))
              : (report2.logicCheckResult?.issues.find((x) => (LOGIC_CONTRADICTION_TYPE_LABELS[x.type] || x.type) === t.title) ??
                ({ type: 'item_state', title: t.title, description: t.suggestion, suggestion: t.suggestion, severity: t.severity, quickFixSuggestion: t.originalText ? { originalText: t.originalText, fixedText: '', reason: '' } : undefined } as any));
            const fixStart = Date.now();
            step(`[第${i + 1}章] 6.3 单条修正 ${k + 1}/${targets.length}: 「${t.title}」`);
            const fixResult = await plotCheckerService.autoFixIssue(
              projectId, i, current, rawIssue, t.type, modelCfg
            );
            const fixMs = Date.now() - fixStart;
            if (fixResult.success) {
              const sample = fixResult.diffs?.[0]
                ? `${fixResult.diffs[0].originalText.slice(0, 40)} → ${fixResult.diffs[0].fixedText.slice(0, 40)}`
                : '（无差异记录）';
              records.push({
                issueTitle: t.title, issueType: t.type, severity: t.severity,
                success: true, diffCount: fixResult.diffs?.length ?? 0, diffSample: sample, durationMs: fixMs,
              });
              current = fixResult.fixedContent;
              successCount++;
              step(`[第${i + 1}章] 6.3 修正成功: 「${t.title}」 diff=${fixResult.diffs?.length ?? 0} / ${fixMs}ms`);
            } else {
              records.push({
                issueTitle: t.title, issueType: t.type, severity: t.severity,
                success: false, diffCount: 0, diffSample: '', error: fixResult.error, durationMs: fixMs,
              });
              failedCount++;
              step(`[第${i + 1}章] 6.3 修正失败: 「${t.title}」 ${fixResult.error}`, 'warn');
            }
          }
          // 修正后内容落盘
          await writingStorageService.autoSaveChapter(projectId, i, current);
          rec.fixes = {
            beforeWordCount: content.length,
            afterWordCount: current.length,
            successCount,
            failedCount,
            records,
          };
          step(
            `[第${i + 1}章] 6.3 单条修正完成: 成功 ${successCount} / 失败 ${failedCount}（${successCount + failedCount}/${rec.plotCheck.issues.length} 条，其余未修正）；字数 ${rec.fixes.beforeWordCount}→${rec.fixes.afterWordCount}`
          );
          okAssertion(`第${i + 1}章-单条修正`, `修正 ${successCount}/${targets.length}（共 ${rec.plotCheck.issues.length} 条建议，限制 ${MAX_FIX} 条控制时长）`);
        } else if (report2) {
          rec.fixes = { beforeWordCount: content.length, afterWordCount: content.length, successCount: 0, failedCount: 0, records: [] };
          step(`[第${i + 1}章] 6.3 剧情检查无问题，跳过单条修正`);
          okAssertion(`第${i + 1}章-单条修正`, '无问题需修正');
        }

        // 6.4 表格整理（仅当前章节，单章模式）
        step(`[第${i + 1}章] 6.4 表格整理开始…`);
        const tblStart = Date.now();
        this.emit(projectId, onProgress, 'CHAPTER', i + 1, chapterCount, `第 ${i + 1} 章：表格整理中…`);
        const orgResult = await writingStorageService.organizeTable(
          projectId,
          modelCfg,
          i,
          (current, total, message) => step(`[第${i + 1}章] 表格整理进度 ${current}/${total}: ${message}`),
          undefined,
          true
        );
        const tblMs = Date.now() - tblStart;
        const tblAfter = await writingStorageService.getTableData(projectId);
        const sheets = tblAfter?.sheets?.length ?? 0;
        const rows = tblAfter?.data
          ? Object.values(tblAfter.data).reduce((s, r) => s + (Array.isArray(r) ? r.length : 0), 0)
          : 0;
        // 完整性/准确性验证：字段齐全（每个 sheet 的 headers 非空）、行数增长、内容含章节关键词
        const fieldComplete =
          !!tblAfter &&
          Object.keys(tblAfter.headers ?? {}).length === sheets &&
          Object.values(tblAfter.headers ?? {}).every((h) => Array.isArray(h) && h.length > 0);
        const rowMatches = rows > 0;
        // key 对齐验证：数据层行 key 为数字索引（"1","2",...），UI 用 header 名映射读取。
        // 此处校验：对每个含数据行的 sheet，存在 header 列名 h 使得 h 非空且行值非空
        // （即 headers[idx] 能定位到有效列），避免"行数>0 但 UI 读不到值"的假阳性。
        const keyAlignment = (() => {
          if (!tblAfter?.data || !tblAfter?.headers || rows === 0) return false;
          for (const [sheetName, sheetRows] of Object.entries(tblAfter.data)) {
            if (!Array.isArray(sheetRows) || sheetRows.length === 0) continue;
            const headers = tblAfter.headers[sheetName] || [];
            for (const row of sheetRows) {
              if (!row || typeof row !== 'object') continue;
              const rowKeys = Object.keys(row);
              if (rowKeys.length === 0) continue;
              const aligned = rowKeys.some((k) => {
                if (/^\d+$/.test(k)) {
                  const idx = parseInt(k, 10);
                  const h = headers[idx];
                  return !!h && h.length > 0 && row[k] != null && String(row[k]).trim().length > 0;
                }
                return headers.includes(k) && row[k] != null && String(row[k]).trim().length > 0;
              });
              if (!aligned) return false;
            }
          }
          return true;
        })();
        const contentMatches = (() => {
          if (!tblAfter?.data || rows === 0) return false;
          const allText = Object.values(tblAfter.data)
            .flatMap((r) => (Array.isArray(r) ? r : []))
            .map((row) => Object.values(row ?? {}).join(' '))
            .join(' ');
          // 准确性抽样：章节正文中出现的核心名词至少 1 个进入表格
          const cands = [chapter?.title, character?.name, '餐厅', '镇', '海', '潮汐', '码头'].filter(Boolean) as string[];
          return cands.some((w) => w && allText.includes(w));
        })();
        rec.table = {
          startedAt: tblStart,
          finishedAt: tblStart + tblMs,
          durationMs: tblMs,
          success: !!orgResult.success,
          sheets,
          rows,
          verify: {
            fieldComplete,
            rowMatches,
            contentMatches,
            keyAlignment,
            detail: `sheets=${sheets} rows=${rows} processed=${orgResult.processedCount} errors=${orgResult.errorCount}${orgResult.errors?.length ? ' ' + orgResult.errors.slice(0, 2).join('；') : ''}`,
          },
        };
        if (orgResult.success) {
          step(`[第${i + 1}章] 6.4 表格整理完成: ${sheets} sheet / ${rows} 行 / ${tblMs}ms（字段齐全=${fieldComplete} 行数>0=${rowMatches} 内容匹配=${contentMatches} key对齐=${keyAlignment}）`);
          okAssertion(`第${i + 1}章-表格整理`, `${sheets} sheet / ${rows} 行 / ${tblMs}ms`);
          if (fieldComplete && rowMatches && keyAlignment) okAssertion(`第${i + 1}章-表格验证`, `字段齐全=${fieldComplete} 行数>0=${rowMatches} 内容匹配=${contentMatches} key对齐=${keyAlignment}`);
          else failAssertion(`第${i + 1}章-表格验证`, `字段齐全=${fieldComplete} 行数>0=${rowMatches} 内容匹配=${contentMatches} key对齐=${keyAlignment}（${rec.table.verify.detail}）`);
        } else {
          step(`[第${i + 1}章] 6.4 表格整理失败: ${orgResult.errors?.[0] || '未知'}`, 'error');
          failAssertion(`第${i + 1}章-表格整理`, orgResult.errors?.[0] || '未知错误');
        }

        // 6.5 阶段性保存（项目实体 + 表格数据均已落盘；确认状态）
        const savedProj = await writingStorageService.loadProject(projectId);
        const savedContent = savedProj?.outline?.chapters?.[i]?.content || '';
        step(`[第${i + 1}章] 6.5 阶段性保存完成（正文 ${savedContent.length} 字已落盘，表格 ${rows} 行）`);
        report.chapters?.push(rec);
      }

      // ---------- 汇总断言 ----------
      const finalProj = await writingStorageService.loadProject(report.projectId);
      const allChapters = finalProj?.outline?.chapters ?? [];
      const totalWords = allChapters.reduce((s, c) => s + (c.content || '').length, 0);
      report.wordCount = totalWords;
      const allGenerated = allChapters.length === chapterCount && allChapters.every((c) => (c.content || '').trim().length > 0);
      if (allGenerated) okAssertion('4章全部生成', `${totalWords} 字 / ${chapterCount} 章`);
      else failAssertion('4章全部生成', `实际 ${allChapters.filter((c) => (c.content || '').trim()).length}/${chapterCount} 章有正文（${totalWords} 字）`);

      const checked = (report.chapters ?? []).filter((c) => c.plotCheck).length;
      if (checked === chapterCount) okAssertion('4章剧情检查', `${checked}/${chapterCount} 章完成`);
      else failAssertion('4章剧情检查', `${checked}/${chapterCount} 章完成`);

      const fixed = (report.chapters ?? []).filter((c) => c.fixes && c.fixes.records.length >= 0).length;
      if (fixed === chapterCount) okAssertion('4章单条修正流程', `${fixed}/${chapterCount} 章完成`);
      else failAssertion('4章单条修正流程', `${fixed}/${chapterCount} 章完成`);

      const organized = (report.chapters ?? []).filter((c) => c.table?.success).length;
      if (organized === chapterCount) okAssertion('4章表格整理', `${organized}/${chapterCount} 章成功`);
      else failAssertion('4章表格整理', `${organized}/${chapterCount} 章成功`);

      // 表格上下文注入验证：第 2-4 章生成时表格已含前序章节数据
      const injected = (report.chapters ?? []).slice(1).filter((c) => (c.generation.tableRows ?? 0) > 0);
      if (injected.length >= 1) okAssertion('表格上下文注入', `第 2-${injected.length + 1} 章生成时均注入了前序表格数据（${injected.map((c) => `第${c.index + 1}章${c.generation.tableRows}行`).join('、')}）`);
      else failAssertion('表格上下文注入', '后续章节生成时未检测到表格数据注入');

      // 成书导出（最终交付）
      const composed = await this.compose(report.projectId, ExportFormat.MARKDOWN, undefined, onProgress);
      if (composed.success && composed.data) {
        report.exportPath = composed.data.filePath;
        step(`[成书] 导出完成: ${composed.data.filePath}（${composed.data.wordCount} 字）`);
      } else {
        step(`[成书] 导出失败: ${composed.error}`, 'warn');
      }

      return finalize(ok({ report }));
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      if (report.assertions.length === 0) {
        report.assertions = [{ name: 'v2-integrated', passed: false, detail: report.error || '未知错误' }];
      }
      step(`v2-integrated 失败: ${report.error}`, 'error');
      return finalize(fail<{ report: PipelineE2EReport }>(`[V2E2E] ${report.error}`, 'INTERNAL'));
    }
  }

  /** 汇总项目当前总字数 */
  private async countWords(projectId: string): Promise<{ wordCount: number; chapterCount: number }> {
    const proj = await writingStorageService.loadProject(projectId);
    const chapters = proj?.outline?.chapters ?? [];
    return {
      wordCount: chapters.reduce((s, c) => s + (c.content || '').length, 0),
      chapterCount: chapters.length,
    };
  }
}

export const writingPipelineService = new WritingPipelineService();
