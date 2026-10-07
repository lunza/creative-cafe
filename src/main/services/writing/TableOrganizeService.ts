import { Chapter, ModelConfig, ChapterStatus } from '../../../shared/types/writing.types';
import { WritingProjectRepository } from './WritingProjectRepository';
import {
  WritingTableRepository,
  WritingTableData,
  WritingOrganizeProgress,
  loadTableData,
  saveTableDataFile
} from './WritingTableRepository';
import { TableEditCommandExecutor } from './TableEditCommandExecutor';
import { AIConfigProvider } from '../ai/AIConfigProvider';
import { callAIAPIWithFetch, AIAPIConfig, AIAPIParams } from '../ai/aiHttpClient';
import { TableTemplate, TableSheet } from '../memory/tableTemplateService';
import { resolveWritingTableTemplate } from './writingTemplateRegistry';
import { tableEditParser } from '../memory/tableEditParser';
import { addLog } from '../memory/chatLogService';

/**
 * 表格整理业务逻辑服务。
 *
 * 职责：
 * - organizeTable: 全项目/单章节表格整理（含 AI 调用与 prompt 构建）
 * - organizeSingleSheet: 单 sheet 整理
 * - reorganizeRow: 单行重新整理
 * - 各种 prompt 构建方法
 * - AI HTTP 调用（callAIAPI）
 * - 表格去重（deduplicateTableData/deduplicateSingleSheet）
 * - 章节内容分片（splitChapterContent）
 *
 * 依赖（通过构造函数注入）：
 * - WritingProjectRepository: 项目加载/保存
 * - WritingTableRepository: 表格数据/配置/进度读写
 * - AIConfigProvider: AI 引擎配置
 * - TableEditCommandExecutor: tableEdit 命令执行
 *
 * 跨层依赖（SubTask 9.7）：
 * - tableTemplateService / tableEditParser / addLog 仍直接 import，
 *   已通过 Task 13 的后续抽取计划统一处理；此处已将它们的使用范围隔离在本文件内。
 */
export class TableOrganizeService {
  constructor(
    private readonly projectRepo: WritingProjectRepository,
    private readonly tableRepo: WritingTableRepository,
    private readonly aiConfig: AIConfigProvider,
    private readonly editExecutor: TableEditCommandExecutor
  ) {}

  // ==================== 取消控制 ====================

  /** 整理任务取消标志（按项目，章节级/分片级检查） */
  private readonly cancelFlags = new Map<string, boolean>();

  /** 请求取消进行中的整理任务（当前分片 AI 调用完成后生效，已处理结果保留） */
  cancelOrganize(projectId: string): void {
    this.cancelFlags.set(projectId, true);
    addLog(`[WritingOrganize] 取消请求: ${projectId}`, 'info');
  }

  private isCancelRequested(projectId: string): boolean {
    return this.cancelFlags.get(projectId) === true;
  }

  // ==================== 公共入口 ====================

  /**
   * 确保表格数据文件存在且含模板结构，缺失时按已绑定模板重建空表并落盘。
   * 背景：「清空」按钮会删除整个 table-data.json（含 sheets/headers 结构），但模板绑定配置仍在，
   * 此前整理入口会误报「表格数据不存在，请先绑定模板」——这里自愈重建，让「AI 整理全部」可直接重跑。
   */
  private async ensureTableDataFromTemplate(projectId: string): Promise<WritingTableData> {
    const existing = loadTableData(projectId);
    if (existing && existing.sheets && existing.sheets.length > 0) {
      return existing;
    }

    const tableConfig = await this.tableRepo.getTableConfig(projectId);
    if (!tableConfig || !tableConfig.associatedTemplateId) {
      throw new Error('未关联表格模板，请先绑定模板');
    }
    const template = resolveWritingTableTemplate(tableConfig.associatedTemplateId);
    if (!template) {
      throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
    }

    const rebuilt: WritingTableData = {
      sheets: (template.sheets || []).map(s => s.name),
      headers: {},
      data: {},
      sheetDescriptions: {}
    };
    for (const sheet of template.sheets || []) {
      rebuilt.headers[sheet.name] = sheet.headers;
      rebuilt.data[sheet.name] = [];
      rebuilt.sheetDescriptions[sheet.name] = sheet.description || '';
    }
    saveTableDataFile(projectId, rebuilt);
    addLog(`[WritingOrganize] 表格数据文件缺失（可能已被清空），已按模板重建空表结构: ${tableConfig.associatedTemplateName || tableConfig.associatedTemplateId}`, 'info');
    return rebuilt;
  }

  async organizeTable(
    projectId: string,
    modelConfig: ModelConfig,
    chapterIndex?: number,
    onProgress?: (current: number, total: number, message: string, percent?: number, currentChunk?: number, totalChunks?: number) => void,
    requirements?: string,
    skipOrganized?: boolean
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; cancelled?: boolean }> {
    const result = { success: false, processedCount: 0, errorCount: 0, errors: [] as string[], cancelled: false };
    const startTime = Date.now();

    addLog(`[WritingOrganize] 开始整理表格: ${projectId}, chapterIndex: ${chapterIndex}`, 'info');

    try {
      const project = await this.projectRepo.loadProject(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      const tableConfig = await this.tableRepo.getTableConfig(projectId);
      if (!tableConfig || !tableConfig.associatedTemplateId) {
        throw new Error('未关联表格模板，请先绑定模板');
      }

      // 数据文件可能被「清空」整删，模板已绑定时按模板重建空表结构（自愈）
      const tableData = await this.ensureTableDataFromTemplate(projectId);

      // 保存原始数据快照（深拷贝）
      const originalDataSnapshot: WritingTableData = JSON.parse(JSON.stringify(tableData));

      // 写作内置模板优先，记忆模块模板兜底（存量绑定兼容）
      const template = resolveWritingTableTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      // 确定要处理的章节列表
      let chaptersToProcess: Chapter[];
      if (chapterIndex !== undefined) {
        // 单章节模式：仅处理指定章节
        // ⚠️ chapterIndex 语义是「章节在数组中的位置」（渲染层 selectedIndex / 智能体 startIdx+i，均 0 基），
        // 而漫画导入项目的 chapter.index 可能是 1 基（validateOutline 缺省 idx+1），
        // 仅按 index 值查找会报「章节 0 不存在」或错位一章——按位置优先，index 值兜底
        const allChapters = project.outline!.chapters;
        const targetChapter = allChapters[chapterIndex] ?? allChapters.find(ch => ch.index === chapterIndex);
        if (!targetChapter) {
          throw new Error(`章节 ${chapterIndex + 1} 不存在`);
        }
        if (!targetChapter.content || targetChapter.content.trim().length === 0) {
          throw new Error(`章节 ${targetChapter.title} 没有内容`);
        }
        chaptersToProcess = [targetChapter as Chapter];
      } else {
        // 全项目模式：处理所有有内容的章节
        chaptersToProcess = project.outline!.chapters.filter(ch => ch.content && ch.content.trim().length > 0) as Chapter[];
      }

      const totalChapters = chaptersToProcess.length;
      if (totalChapters === 0) {
        throw new Error('没有可处理的章节内容');
      }

      // 预计算总分片数，用于精确进度计算
      let totalChunks = 0;
      for (const chapter of chaptersToProcess) {
        const chunks = this.splitChapterContent(chapter.content || '');
        totalChunks += chunks.length;
      }

      const progress: WritingOrganizeProgress = {
        projectId,
        status: 'running',
        currentChapter: 0,
        totalChapters,
        processedCount: 0,
        errorCount: 0,
        errors: [],
        startedAt: startTime
      };
      this.tableRepo.saveOrganizeProgress(projectId, progress);

      const apiEndpoint = this.aiConfig.buildApiEndpoint(modelConfig);

      // 仅强制 apiUrl 与 modelName；apiKey 允许为空（无 Key 的本地 LLM 引擎），
      // 与内容生成 / 剧情检查 / 单条修正链路（getAIConfig，不强制 apiKey）对齐。
      if (!apiEndpoint.apiUrl) {
        throw new Error('未配置 AI 服务地址，请在设置中配置');
      }
      if (!apiEndpoint.modelName) {
        throw new Error('未配置模型名称，请在设置中配置');
      }

      // 累计已处理的分片数，用于精确进度计算
      let processedChunks = 0;
      this.cancelFlags.delete(projectId);

      for (let i = 0; i < chaptersToProcess.length; i++) {
        // 取消检查（章节级）
        if (this.isCancelRequested(projectId)) {
          addLog(`[WritingOrganize] 已取消，停止整理（已完成 ${i}/${totalChapters} 章）`, 'info');
          break;
        }
        const chapter = chaptersToProcess[i];
        progress.currentChapter = chapter.index;
        this.tableRepo.saveOrganizeProgress(projectId, progress);

        addLog(`[WritingOrganize] 处理章节 ${i + 1}/${totalChapters}: ${chapter.title}`, 'info');

        // 跳过已整理章节（如果 skipOrganized 为 true）
        if (skipOrganized && chapter.status === ChapterStatus.ORGANIZED) {
          addLog(`[WritingOrganize] 跳过已整理章节: ${chapter.title}`, 'info');
          if (onProgress) {
            const percent = Math.round((processedChunks / totalChunks) * 100);
            onProgress(i + 1, totalChapters, `跳过已整理章节: ${chapter.title}`, percent, processedChunks, totalChunks);
          }
          // 更新已处理分片数，跳过当前章节的分片
          const chapterChunks = this.splitChapterContent(chapter.content || '');
          processedChunks += chapterChunks.length;
          this.tableRepo.saveOrganizeProgress(projectId, progress);
          continue;
        }

        if (onProgress) {
          const percent = Math.round((processedChunks / totalChunks) * 100);
          onProgress(i + 1, totalChapters, `处理章节: ${chapter.title}`, percent, processedChunks, totalChunks);
        }

        // 计算当前章节的分片数
        const chapterChunks = this.splitChapterContent(chapter.content || '');
        const chapterStartChunks = processedChunks;

        try {
          const chapterResult = await this.processChapterWithAI(
            projectId,
            chapter,
            template,
            tableData,
            apiEndpoint,
            modelConfig,
            // 分片级进度回调
            (chunkIndex: number, totalChapterChunks: number, chapterTitle: string) => {
              processedChunks = chapterStartChunks + chunkIndex;
              if (onProgress) {
                const percent = Math.round((processedChunks / totalChunks) * 100);
                onProgress(
                  i + 1,
                  totalChapters,
                  `处理章节 "${chapterTitle}" 分片 ${chunkIndex}/${totalChapterChunks}`,
                  percent,
                  processedChunks,
                  totalChunks
                );
              }
            },
            requirements
          );

          if (chapterResult.success) {
            progress.processedCount++;
            // SubTask 9.6: 不可变更新章节状态为 organized，消除 as any
            project.outline!.chapters = project.outline!.chapters.map(ch =>
              ch.index === chapter.index
                ? { ...ch, status: ChapterStatus.ORGANIZED }
                : ch
            );
            addLog(`[WritingOrganize] 章节处理成功: ${chapter.title}`, 'info');
          } else {
            const errorMsg = chapterResult.error || '未知错误';
            addLog(`[WritingOrganize] 章节处理失败: ${chapter.title} - ${errorMsg}`, 'error');
            progress.errors.push(`章节 ${chapter.title}: ${errorMsg}`);
            progress.errorCount++;
          }
        } catch (chapterError) {
          const errorMsg = chapterError instanceof Error ? chapterError.message : String(chapterError);
          addLog(`[WritingOrganize] 章节处理异常: ${chapter.title} - ${errorMsg}`, 'error');
          progress.errors.push(`章节 ${chapter.title}: ${errorMsg}`);
          progress.errorCount++;
        }

        this.tableRepo.saveOrganizeProgress(projectId, progress);
      }

      // 取消收尾：已处理结果保留（仍走去重/快照流程）
      if (this.isCancelRequested(projectId)) {
        result.cancelled = true;
        addLog('[WritingOrganize] 整理因取消结束，已处理部分保留', 'info');
      }
      this.cancelFlags.delete(projectId);

      // 持久化章节状态变更
      await this.projectRepo.saveProject(project);

      progress.status = progress.errorCount > 0 ? 'error' : 'completed';
      progress.lastProcessedAt = new Date().toISOString();
      this.tableRepo.saveOrganizeProgress(projectId, progress);

      // 所有章节处理完成后，进行全局去重
      const removedCount = this.deduplicateTableData(projectId);
      if (removedCount > 0) {
        addLog(`[WritingOrganize] 已清理 ${removedCount} 行重复数据`, 'info');
      }

      result.success = progress.processedCount > 0;
      result.processedCount = progress.processedCount;
      result.errorCount = progress.errorCount;
      result.errors = progress.errors;

      // 如果整理成功，保存版本快照
      if (result.success) {
        const newData = loadTableData(projectId);
        if (newData) {
          await this.tableRepo.saveVersionSnapshot(projectId, chapterIndex, originalDataSnapshot, newData);
          addLog(`[WritingOrganize] 版本快照已保存，等待用户确认`, 'info');
        }
      }

      addLog(`[WritingOrganize] 整理完成: success=${result.success}, processed=${result.processedCount}, errors=${result.errorCount}`, 'info');
      return result;
    } catch (error) {
      console.error('[WritingOrganize] 整理失败:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      const errorProgress: WritingOrganizeProgress = {
        projectId,
        status: 'error',
        currentChapter: 0,
        totalChapters: 0,
        processedCount: 0,
        errorCount: 1,
        errors: [errorMsg],
        startedAt: startTime,
        lastProcessedAt: new Date().toISOString()
      };
      this.tableRepo.saveOrganizeProgress(projectId, errorProgress);

      result.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * 整理单个表格（指定 sheet）
   * 仅对用户指定的单个 sheet 进行整理，其他 sheet 不受影响
   */
  async organizeSingleSheet(
    projectId: string,
    sheetName: string,
    modelConfig: ModelConfig,
    chapterIndex?: number,
    onProgress?: (current: number, total: number, status: string, percent: number, currentChunk?: number, totalChunks?: number) => void,
    requirements?: string
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; cancelled?: boolean }> {
    const startTime = new Date().toISOString();
    const result = { success: false, processedCount: 0, errorCount: 0, errors: [] as string[], cancelled: false };

    try {
      addLog(`[WritingOrganize] 开始整理单个表格: ${projectId}, sheet=${sheetName}`, 'info');

      const project = await this.projectRepo.loadProject(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      if (!project.outline || !project.outline.chapters || project.outline.chapters.length === 0) {
        throw new Error('项目大纲不存在或没有章节');
      }

      const tableConfig = await this.tableRepo.getTableConfig(projectId);
      if (!tableConfig || !tableConfig.associatedTemplateId) {
        throw new Error('未关联表格模板，请先绑定模板');
      }

      // 与 organizeTable 一致：数据文件缺失时按模板重建（自愈），再校验目标 sheet
      const tableData = await this.ensureTableDataFromTemplate(projectId);

      // 验证指定的 sheet 是否存在
      if (!tableData.sheets.includes(sheetName)) {
        throw new Error(`表格 "${sheetName}" 不存在`);
      }

      const template = resolveWritingTableTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      // 验证模板中包含该 sheet
      const targetSheetTemplate = template.sheets?.find((s) => s.name === sheetName);
      if (!targetSheetTemplate) {
        throw new Error(`模板中不存在表格 "${sheetName}"`);
      }

      addLog(`[WritingOrganize] 整理单个表格: ${sheetName}`, 'info');

      // 创建只包含目标 sheet 的临时模板
      const singleSheetTemplate = {
        ...template,
        sheets: [targetSheetTemplate]
      };

      // 确定要处理的章节列表
      let chaptersToProcess: Chapter[];
      if (chapterIndex !== undefined) {
        // 与 organizeTable 相同：位置优先（渲染层传 0 基数组位置），index 值兜底
        const allChapters = project.outline!.chapters;
        const targetChapter = allChapters[chapterIndex] ?? allChapters.find(ch => ch.index === chapterIndex);
        if (!targetChapter) {
          throw new Error(`章节 ${chapterIndex + 1} 不存在`);
        }
        if (!targetChapter.content || targetChapter.content.trim().length === 0) {
          throw new Error(`章节 ${targetChapter.title} 没有内容`);
        }
        chaptersToProcess = [targetChapter as Chapter];
      } else {
        chaptersToProcess = project.outline!.chapters.filter(ch => ch.content && ch.content.trim().length > 0) as Chapter[];
      }

      const totalChapters = chaptersToProcess.length;
      if (totalChapters === 0) {
        throw new Error('没有可处理的章节内容');
      }

      // 预计算总分片数
      let totalChunks = 0;
      for (const chapter of chaptersToProcess) {
        const chunks = this.splitChapterContent(chapter.content || '');
        totalChunks += chunks.length;
      }

      const progress: WritingOrganizeProgress = {
        projectId,
        status: 'running',
        currentChapter: 0,
        totalChapters,
        processedCount: 0,
        errorCount: 0,
        errors: [],
        startedAt: startTime
      };
      this.tableRepo.saveOrganizeProgress(projectId, progress);

      const apiEndpoint = this.aiConfig.buildApiEndpoint(modelConfig);
      // 仅强制 apiUrl 与 modelName；apiKey 允许为空（无 Key 的本地 LLM 引擎）。
      if (!apiEndpoint.apiUrl) {
        throw new Error('未配置 AI 服务地址，请在设置中配置');
      }
      if (!apiEndpoint.modelName) {
        throw new Error('未配置模型名称，请在设置中配置');
      }
      let processedChunks = 0;
      this.cancelFlags.delete(projectId);

      for (let i = 0; i < chaptersToProcess.length; i++) {
        // 取消检查（章节级）
        if (this.isCancelRequested(projectId)) {
          addLog(`[WritingOrganize] 单表整理已取消，停止（已完成 ${i}/${totalChapters} 章）`, 'info');
          break;
        }
        const chapter = chaptersToProcess[i];
        progress.currentChapter = chapter.index;
        this.tableRepo.saveOrganizeProgress(projectId, progress);

        addLog(`[WritingOrganize] 处理章节 ${i + 1}/${totalChapters}: ${chapter.title}`, 'info');

        if (onProgress) {
          const percent = Math.round((processedChunks / totalChunks) * 100);
          onProgress(i + 1, totalChapters, `处理章节: ${chapter.title}`, percent, processedChunks, totalChunks);
        }

        const chapterChunks = this.splitChapterContent(chapter.content || '');
        const chapterStartChunks = processedChunks;

        try {
          // 使用单表格整理的 processChapterWithAI 变体
          const chapterResult = await this.processChapterWithAIForSingleSheet(
            projectId,
            chapter,
            singleSheetTemplate,
            sheetName,
            tableData,
            apiEndpoint,
            modelConfig,
            (chunkIndex: number, totalChapterChunks: number, chapterTitle: string) => {
              processedChunks = chapterStartChunks + chunkIndex;
              if (onProgress) {
                const percent = Math.round((processedChunks / totalChunks) * 100);
                onProgress(
                  i + 1,
                  totalChapters,
                  `处理章节 "${chapterTitle}" 分片 ${chunkIndex}/${totalChapterChunks}`,
                  percent,
                  processedChunks,
                  totalChunks
                );
              }
            },
            requirements
          );

          if (chapterResult.success) {
            progress.processedCount++;
            // SubTask 9.6: 不可变更新章节状态为 organized，消除 as any
            project.outline!.chapters = project.outline!.chapters.map(ch =>
              ch.index === chapter.index
                ? { ...ch, status: ChapterStatus.ORGANIZED }
                : ch
            );
            addLog(`[WritingOrganize] 章节处理成功: ${chapter.title}`, 'info');
          } else {
            const errorMsg = chapterResult.error || '未知错误';
            addLog(`[WritingOrganize] 章节处理失败: ${chapter.title} - ${errorMsg}`, 'error');
            progress.errors.push(`章节 ${chapter.title}: ${errorMsg}`);
            progress.errorCount++;
          }
        } catch (chapterError) {
          const errorMsg = chapterError instanceof Error ? chapterError.message : String(chapterError);
          addLog(`[WritingOrganize] 章节处理异常: ${chapter.title} - ${errorMsg}`, 'error');
          progress.errors.push(`章节 ${chapter.title}: ${errorMsg}`);
          progress.errorCount++;
        }

        this.tableRepo.saveOrganizeProgress(projectId, progress);
      }

      // 取消收尾：已处理结果保留
      if (this.isCancelRequested(projectId)) {
        result.cancelled = true;
        addLog('[WritingOrganize] 单表整理因取消结束，已处理部分保留', 'info');
      }
      this.cancelFlags.delete(projectId);

      // 持久化章节状态变更
      await this.projectRepo.saveProject(project);

      progress.status = progress.errorCount > 0 ? 'error' : 'completed';
      progress.lastProcessedAt = new Date().toISOString();
      this.tableRepo.saveOrganizeProgress(projectId, progress);

      // 对目标 sheet 进行去重
      this.deduplicateSingleSheet(projectId, sheetName);

      result.success = progress.processedCount > 0;
      result.processedCount = progress.processedCount;
      result.errorCount = progress.errorCount;
      result.errors = progress.errors;

      addLog(`[WritingOrganize] 单表格整理完成: ${sheetName}, 处理章节数: ${result.processedCount}`, 'info');
      return result;
    } catch (error) {
      addLog(`[WritingOrganize] 单表格整理失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
      const errorMsg = error instanceof Error ? error.message : String(error);

      const errorProgress: WritingOrganizeProgress = {
        projectId,
        status: 'error',
        currentChapter: 0,
        totalChapters: 0,
        processedCount: 0,
        errorCount: 1,
        errors: [errorMsg],
        startedAt: startTime,
        lastProcessedAt: new Date().toISOString()
      };
      this.tableRepo.saveOrganizeProgress(projectId, errorProgress);

      result.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * 重新整理单行数据
   * 根据用户输入的整理要求，对指定行进行 AI 整理优化，保持唯一 ID 不变
   */
  async reorganizeRow(
    projectId: string,
    sheet: string,
    rowIndex: number,
    rowData: Record<string, unknown>,
    requirements: string,
    modelConfig: ModelConfig
  ): Promise<{ success: boolean; updatedRow?: Record<string, unknown>; error?: string }> {
    addLog(`[WritingOrganize] 重新整理单行数据: ${projectId}, sheet=${sheet}, row=${rowIndex}`, 'info');

    try {
      const project = await this.projectRepo.loadProject(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      const tableConfig = await this.tableRepo.getTableConfig(projectId);
      if (!tableConfig || !tableConfig.associatedTemplateId) {
        throw new Error('未关联表格模板');
      }

      const template = resolveWritingTableTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      // 找到当前 sheet 的模板定义
      const sheetTemplate = template.sheets?.find((s) => s.name === sheet);
      if (!sheetTemplate) {
        throw new Error(`模板中不存在 sheet "${sheet}"`);
      }

      // 使用与 organizeTable 一致的 AI 调用链路
      const apiEndpoint = this.aiConfig.buildApiEndpoint(modelConfig);

      // 仅强制 apiUrl 与 modelName；apiKey 允许为空（无 Key 的本地 LLM 引擎）。
      if (!apiEndpoint.apiUrl) {
        throw new Error('未配置 AI 服务地址，请在设置中配置');
      }
      if (!apiEndpoint.modelName) {
        throw new Error('未配置模型名称，请在设置中配置');
      }

      // 构建提示词（包含章节内容上下文、表格上下文、用户整理要求）
      const tableContext = this.buildTableContextForPrompt(projectId, template);
      const prompt = this.buildRowReorganizePrompt(sheetTemplate, rowData, requirements, tableContext, project);

      // 调用 AI（与 processChapterWithAI 完全一致）
      const aiResponse = await this.callAIAPI(prompt, modelConfig, apiEndpoint);

      if (!aiResponse || aiResponse.trim() === '') {
        throw new Error('AI 未返回有效响应');
      }

      // 解析 AI 返回的新行数据
      const updatedRow = this.parseAIRowResponse(aiResponse, sheetTemplate.headers, rowData);

      // 保存更新后的行数据到存储
      const tableData = loadTableData(projectId);
      if (tableData && tableData.data && tableData.data[sheet]) {
        tableData.data[sheet][rowIndex] = updatedRow;
        saveTableDataFile(projectId, tableData);
      }

      addLog(`[WritingOrganize] 行重新整理完成: row=${rowIndex}`, 'info');
      return { success: true, updatedRow };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`[WritingOrganize] 行重新整理失败: ${errorMsg}`, 'error');
      throw error;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 全局去重：对指定 project 的表格数据，按唯一 ID 去重
   * 每个 sheet 中保留唯一 ID 相同的行中的第一条
   */
  private deduplicateTableData(projectId: string): number {
    const tableData = loadTableData(projectId);
    if (!tableData || !tableData.data) return 0;

    let totalRemoved = 0;

    for (const [sheetName, rows] of Object.entries(tableData.data)) {
      if (!Array.isArray(rows)) continue;

      const seenIds = new Set<string>();
      const dedupedRows: Record<string, unknown>[] = [];

      for (const row of rows) {
        // 存储约定：key "1" = 唯一id（解析器把 AI 字段2 转换而来），作为实体去重键
        const uniqueId = row['1'];

        if (uniqueId) {
          if (seenIds.has(uniqueId as string)) {
            // 重复行，跳过
            totalRemoved++;
            addLog(`[WritingOrganize] 全局去重: 移除 ${sheetName} 重复行, 唯一ID=${uniqueId}`, 'debug');
            continue;
          }
          seenIds.add(uniqueId as string);
        }

        dedupedRows.push(row);
      }

      tableData.data[sheetName] = dedupedRows;
    }

    // 保存去重后的数据
    saveTableDataFile(projectId, tableData);

    if (totalRemoved > 0) {
      addLog(`[WritingOrganize] 全局去重完成: 共移除 ${totalRemoved} 行重复数据`, 'info');
    }

    return totalRemoved;
  }

  /**
   * 单表格整理的章节处理（只更新指定 sheet）
   */
  private async processChapterWithAIForSingleSheet(
    projectId: string,
    chapter: Chapter,
    template: TableTemplate,
    targetSheetName: string,
    existingTableData: WritingTableData,
    apiEndpoint: { apiUrl: string; apiMode: string; apiKey: string; apiKeyTransmission: string; modelName: string },
    modelConfig: ModelConfig,
    onChunkProgress?: (chunkIndex: number, totalChunks: number, chapterTitle: string) => void,
    requirements?: string
  ): Promise<{ success: boolean; error?: string }> {
    const content = chapter.content || '';
    const chunks = this.splitChapterContent(content);

    addLog(`[WritingOrganize] 单表格处理章节: ${chapter.title}, sheet=${targetSheetName}, 分块数: ${chunks.length}`, 'info');

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      // 取消检查（分片级：当前分片 AI 调用完成后停止）
      if (this.isCancelRequested(projectId)) {
        addLog(`[WritingOrganize] 已取消：章节 ${chapter.title} 剩余分片停止处理（单表整理）`, 'info');
        break;
      }
      const chunkContent = chunks[chunkIndex];

      // 每批分片处理前重新加载最新的表格数据
      const latestTableData = loadTableData(projectId);
      if (latestTableData) {
        existingTableData.sheets = latestTableData.sheets;
        existingTableData.headers = latestTableData.headers;
        existingTableData.data = latestTableData.data;
        existingTableData.sheetDescriptions = latestTableData.sheetDescriptions;
      }

      // 构建单表格整理的提示词（只包含目标 sheet 的信息）
      const tableContext = this.buildSingleSheetTableContextForPrompt(projectId, template, targetSheetName);
      const prompt = this.buildSingleSheetOrganizePrompt(chunkContent, template, tableContext, requirements, chapter);

      const aiResponse = await this.callAIAPI(prompt, modelConfig, apiEndpoint);

      if (!aiResponse || aiResponse.trim() === '') {
        addLog(`[WritingOrganize] AI未返回有效响应: ${chapter.title} (分块 ${chunkIndex + 1})`, 'warn');
        if (onChunkProgress) {
          onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
        }
        continue;
      }

      const parseResult = tableEditParser.parse(aiResponse);

      if (!parseResult.success && parseResult.commands.length === 0) {
        addLog(`[WritingOrganize] 未解析到tableEdit命令: ${chapter.title} (分块 ${chunkIndex + 1})`, 'warn');
        if (onChunkProgress) {
          onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
        }
        continue;
      }

      if (parseResult.commands.length > 0) {
        addLog(`[WritingOrganize] 执行 ${parseResult.commands.length} 个tableEdit命令 (分块 ${chunkIndex + 1})`, 'info');
        this.editExecutor.execute(projectId, parseResult.commands, existingTableData);
      }

      if (onChunkProgress) {
        onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
      }
    }

    addLog(`[WritingOrganize] 单表格章节处理完成: ${chapter.title}`, 'info');
    return { success: true };
  }

  /**
   * 构建单表格整理的表格上下文（只包含目标 sheet 的信息）
   */
  private buildSingleSheetTableContextForPrompt(projectId: string, template: TableTemplate, targetSheetName: string): string {
    const tableData = loadTableData(projectId);
    if (!tableData) return '【现有表格数据】\n暂无数据\n';

    let context = '【现有表格数据】\n';
    let quickIndex = '【唯一ID快速查找索引】\n';

    // 只处理目标 sheet
    const sheet = template.sheets?.find((s: TableSheet) => s.name === targetSheetName);
    if (!sheet) {
      return context + '未找到指定表格\n';
    }

    const sheetIndex = template.sheets.indexOf(sheet);
    const rows = tableData.data[targetSheetName] || [];
    const tableIndex = sheetIndex + 1;

    if (rows.length > 0) {
      context += `\n--- 表格${tableIndex}: ${sheet.name} ---\n`;
      context += `描述: ${sheet.description || '暂无描述'}\n`;
      context += `字段定义: ${sheet.headers.map((h: string, i: number) => `[${i}]${h}`).join(', ')}\n`;
      context += `当前已有数据 (${rows.length} 行):\n`;

      // 限制显示行数，避免上下文过长
      const displayRows = rows.slice(0, 30);
      displayRows.forEach((row: Record<string, unknown>, idx: number) => {
        const rowData = sheet.headers.map((h: string, i: number) => {
          return `[${i}]${h}=${row[String(i)] || ''}`;
        }).join(', ');
        context += `  行${idx}: ${rowData}\n`;
      });

      if (rows.length > 30) {
        context += `  ... 还有 ${rows.length - 30} 行数据\n`;
      }

      // 构建唯一ID快速查找索引
      const uniqueIdIndex = sheet.headers.findIndex((h: string) => h === '唯一id');
      if (uniqueIdIndex >= 0) {
        quickIndex += `表格${tableIndex} (${sheet.name}):\n`;
        rows.forEach((row: Record<string, unknown>) => {
          const uniqueId = row[String(uniqueIdIndex)];
          const nameField = row['2'] || row['3'] || ''; // 通常第二个或第三个字段是名称
          if (uniqueId) {
            quickIndex += `  ${uniqueId} -> ${nameField}\n`;
          }
        });
      }
    } else {
      context += `\n--- 表格${tableIndex}: ${sheet.name} ---\n`;
      context += `描述: ${sheet.description || '暂无描述'}\n`;
      context += `字段定义: ${sheet.headers.map((h: string, i: number) => `[${i}]${h}`).join(', ')}\n`;
      context += `当前已有数据: 空表\n`;
    }

    context += '\n' + quickIndex + '\n';
    return context;
  }

  /**
   * 构建单表格整理的提示词（只包含目标 sheet 的信息）
   */
  private buildSingleSheetOrganizePrompt(
    content: string,
    template: TableTemplate,
    tableContext: string,
    requirements?: string,
    chapter?: { index?: number; title?: string }
  ): string {
    const targetSheet = template.sheets[0]; // 单表格模板只有一个 sheet

    const requirementsSection = requirements
      ? `\n【用户整理要求】\n${requirements}\n`
      : '';

    return `【角色设定】
你是一个专业的小说内容分析专家，擅长从小说章节中提取关键信息并整理到结构化表格中。

${
      chapter?.index
        ? `【当前章节】
以下内容来自「第${chapter.index}章${chapter.title ? `（${chapter.title}）` : ''}」。
章节类字段必须填写绝对章号（如"第${chapter.index}章"），禁止填写"本章"等相对值。

`
        : ''
    }
【任务目标】
请阅读以下小说章节内容，提取关键信息并整理到指定的表格中。

【章节内容】
${content}

${tableContext}
【目标表格信息】
当前需要整理的表格: ${targetSheet.name}
表格描述: ${targetSheet.description || '暂无描述'}
字段定义: ${targetSheet.headers.map((h: string, i: number) => `[${i}]${h}`).join(', ')}

${requirementsSection}
【输出要求】
1. 从当前章节内容中提取关键信息，生成对应的tableEdit命令
2. 将命令放在<tableEdit>标签内
3. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
4. 确保使用正确的表格索引（表格索引从1开始）
5. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
6. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找
7. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
8. 只提取当前章节中明确提到的信息，不要臆造
9. 操作结果确认：在生成tableEdit命令后，简要说明每个操作的目的
10. 【绝对禁止】对于唯一ID已存在的实体，绝对不要使用insertRow！

【tableEdit命令格式】
<tableEdit>
{
  "type": "insertRow",
  "sheetIndex": 1,
  "data": {"0": "值1", "1": "值2", ...}
}
</tableEdit>

或

<tableEdit>
{
  "type": "updateRow",
  "sheetIndex": 1,
  "rowIndex": 行索引,
  "data": {"字段索引": "新值", ...}
}
</tableEdit>

或

<tableEdit>
{
  "type": "deleteRow",
  "sheetIndex": 1,
  "rowIndex": 行索引
}
</tableEdit>

注意：
- sheetIndex 始终为 1（因为只处理单个表格）
- rowIndex 从 0 开始
- data 中的键名是字段索引的数字字符串`;
  }

  /**
   * 对单个 sheet 进行去重
   */
  private deduplicateSingleSheet(projectId: string, sheetName: string): void {
    const tableData = loadTableData(projectId);
    if (!tableData || !tableData.data || !tableData.data[sheetName]) return;

    const rows = tableData.data[sheetName];
    if (!Array.isArray(rows)) return;

    const seenIds = new Set<string>();
    const dedupedRows: Record<string, unknown>[] = [];
    let removedCount = 0;

    for (const row of rows) {
      const uniqueId = row['1']; // "1" 对应唯一 ID 字段（索引1）

      if (uniqueId) {
        if (seenIds.has(uniqueId)) {
          removedCount++;
          addLog(`[WritingOrganize] 单表格去重: 移除 ${sheetName} 重复行, 唯一ID=${uniqueId}`, 'debug');
          continue;
        }
        seenIds.add(uniqueId);
      }

      dedupedRows.push(row);
    }

    tableData.data[sheetName] = dedupedRows;
    saveTableDataFile(projectId, tableData);

    if (removedCount > 0) {
      addLog(`[WritingOrganize] 单表格去重完成: ${sheetName}, 移除 ${removedCount} 行重复数据`, 'info');
    }
  }

  /**
   * 构建单行重新整理的提示词
   * 与 buildWritingTableOrganizePrompt 保持结构一致，包含项目上下文、表格上下文、用户要求
   */
  private buildRowReorganizePrompt(
    sheetTemplate: TableSheet,
    currentRowData: Record<string, unknown>,
    requirements: string,
    tableContext: string,
    project: any // 已分析但保留：修改为 WritingProject 会暴露 outline?.name/.theme/.style 潜在类型错误
  ): string {
    const fieldsDesc = sheetTemplate.headers.map((h: string, i: number) => `${i + 1}:${h}`).join(', ');

    // 项目上下文
    const projectContext = `项目名称: ${project.outline?.name || '未命名'}
主题: ${project.outline?.theme || '未指定'}
风格: ${project.outline?.style || '未指定'}`;

    // 存储约定：key "1"=唯一id（保持不变）、key k(k≥2)=表头第 k-1 列
    const originalUniqueId = typeof currentRowData['1'] === 'string' ? currentRowData['1'] : '';

    return `【角色设定】
你是一个专业的信息整理专家，擅长根据用户的要求优化和整理表格中的数据行。

【项目上下文】
${projectContext}

${tableContext}
【当前待整理行数据】
Sheet: ${sheetTemplate.name}
字段定义（键名 → 字段名）：${sheetTemplate.headers.map((h: string, i: number) => `[${i + 2}]${h}`).join(', ')}
${originalUniqueId ? `该行唯一id：${originalUniqueId}（系统字段，保持不变，不要输出）\n` : ''}当前行值：${sheetTemplate.headers.map((h: string, i: number) => {
      const value = currentRowData[String(i + 2)];
      return `[${i + 2}]${h}=${value ?? ''}`;
    }).join(', ')}

【用户整理要求】
${requirements}

【任务要求】
1. 根据用户的整理要求，结合项目上下文和表格上下文，优化当前行的所有字段数据
2. 返回完整的行数据，格式为 JSON 对象

【返回格式】
请仅返回 JSON 对象，键名为字段键名字符串，值为对应的字段内容：
{"2": "第1个字段的值", "3": "第2个字段的值", ...}

重要：
- 键名必须是数字字符串，从 "2" 开始，与上方字段定义的键名一一对应
- 不要返回唯一id和流水号（系统字段由程序保留）
- 必须返回所有字段的键值对，数量与字段定义中的字段数相同
- 不要返回任何其他内容，仅返回 JSON`;
  }

  /**
   * 解析 AI 返回的行数据
   * 按存储约定键控：key "0"=流水号、"1"=唯一id 原样保留，key k(k≥2)=表头第 k-1 列
   */
  private parseAIRowResponse(
    aiResponse: string,
    headers: string[],
    originalRowData: Record<string, unknown>
  ): Record<string, unknown> {
    // 尝试从 AI 响应中提取 JSON
    let jsonStr = aiResponse.trim();
    const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // 尝试找到 { } 包裹的内容
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonStr = braceMatch[0];
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`AI 返回的数据格式不正确: ${jsonStr.substring(0, 200)}`);
    }

    // 构建新的行数据（存储约定：key "0"=流水号、"1"=唯一id 原样保留；
    // key k(k≥2)=表头第 k-1 列，AI 未返回的字段回填原值）
    const newRow: Record<string, unknown> = {};
    if (originalRowData['0'] !== undefined) newRow['0'] = originalRowData['0'];
    if (originalRowData['1'] !== undefined) newRow['1'] = originalRowData['1'];

    for (let i = 0; i < headers.length; i++) {
      const key = String(i + 2);
      newRow[key] = parsed[key] !== undefined ? parsed[key] : (originalRowData[key] || '');
    }

    return newRow;
  }

  private splitChapterContent(content: string, maxWordCount: number = 8000): string[] {
    const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0);
    const chunks: string[] = [];
    let currentChunk = '';
    let currentWordCount = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length;

      if (currentWordCount + paragraphLength > maxWordCount && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
        currentWordCount = paragraphLength;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        currentWordCount += paragraphLength;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private async processChapterWithAI(
    projectId: string,
    chapter: Chapter,
    template: TableTemplate,
    existingTableData: WritingTableData,
    apiEndpoint: { apiUrl: string; apiMode: string; apiKey: string; apiKeyTransmission: string; modelName: string },
    modelConfig: ModelConfig,
    onChunkProgress?: (chunkIndex: number, totalChunks: number, chapterTitle: string) => void,
    requirements?: string
  ): Promise<{ success: boolean; error?: string }> {
    const content = chapter.content || '';
    const chunks = this.splitChapterContent(content);

    addLog(`[WritingOrganize] 处理章节: ${chapter.title}, 分块数: ${chunks.length}`, 'info');

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      // 取消检查（分片级：当前分片 AI 调用完成后停止）
      if (this.isCancelRequested(projectId)) {
        addLog(`[WritingOrganize] 已取消：章节 ${chapter.title} 剩余分片停止处理`, 'info');
        break;
      }
      const chunkContent = chunks[chunkIndex];
      addLog(`[WritingOrganize] 处理分块 ${chunkIndex + 1}/${chunks.length}, 长度: ${chunkContent.length} 字符`, 'debug');

      // 每批分片处理前重新加载最新的表格数据，确保上下文包含之前分片的整理结果
      const latestTableData = loadTableData(projectId);
      if (latestTableData) {
        // 更新 existingTableData 引用为最新数据
        existingTableData.sheets = latestTableData.sheets;
        existingTableData.headers = latestTableData.headers;
        existingTableData.data = latestTableData.data;
        existingTableData.sheetDescriptions = latestTableData.sheetDescriptions;
        addLog(`[WritingOrganize] 已重新加载最新表格数据 (分块 ${chunkIndex + 1})`, 'debug');
      }

      const tableContext = this.buildTableContextForPrompt(projectId, template);
      const prompt = this.buildWritingTableOrganizePrompt(chunkContent, template, tableContext, requirements, chapter);

      addLog(`[WritingOrganize] 开始调用AI API (分块 ${chunkIndex + 1})`, 'debug');

      const aiResponse = await this.callAIAPI(prompt, modelConfig, apiEndpoint);

      if (!aiResponse || aiResponse.trim() === '') {
        addLog(`[WritingOrganize] AI未返回有效响应: ${chapter.title} (分块 ${chunkIndex + 1})`, 'warn');
        // 通知前端分片处理完成（即使没有返回有效响应）
        if (onChunkProgress) {
          onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
        }
        continue;
      }

      addLog(`[WritingOrganize] AI响应长度: ${aiResponse.length} 字符 (分块 ${chunkIndex + 1})`, 'debug');

      const parseResult = tableEditParser.parse(aiResponse);

      if (!parseResult.success && parseResult.commands.length === 0) {
        addLog(`[WritingOrganize] 未解析到tableEdit命令: ${chapter.title} (分块 ${chunkIndex + 1})`, 'warn');
        if (parseResult.errors.length > 0) {
          addLog(`[WritingOrganize] 解析错误: ${parseResult.errors.join('; ')}`, 'warn');
        }
        // 通知前端分片处理完成
        if (onChunkProgress) {
          onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
        }
        continue;
      }

      if (parseResult.errors.length > 0) {
        addLog(`[WritingOrganize] 解析警告: ${parseResult.errors.join('; ')}`, 'warn');
      }

      if (parseResult.commands.length > 0) {
        addLog(`[WritingOrganize] 执行 ${parseResult.commands.length} 个tableEdit命令 (分块 ${chunkIndex + 1})`, 'info');
        this.editExecutor.execute(projectId, parseResult.commands, existingTableData);
        addLog(`[WritingOrganize] 分块 ${chunkIndex + 1} 整理结果已录入表格`, 'info');
      }

      // 通知前端分片处理完成，触发UI刷新
      if (onChunkProgress) {
        onChunkProgress(chunkIndex + 1, chunks.length, chapter.title);
      }
    }

    addLog(`[WritingOrganize] 章节处理完成: ${chapter.title}`, 'info');
    return { success: true };
  }

  private buildTableContextForPrompt(projectId: string, template: TableTemplate): string {
    const tableData = loadTableData(projectId);
    if (!tableData) return '【现有表格数据】\n暂无数据\n';

    let context = '【现有表格数据】\n';
    let quickIndex = '【唯一ID快速查找索引】\n';

    template.sheets.forEach((sheet: TableSheet, sheetIndex: number) => {
      const rows = tableData.data[sheet.name] || [];
      const tableIndex = sheetIndex + 1;
      const headers = tableData.headers?.[sheet.name] || sheet.headers || [];

      if (rows.length > 0) {
        context += `\n【${sheet.name}】(表格索引: ${tableIndex})\n`;
        rows.forEach((row: Record<string, unknown>, rowIndex: number) => {
          const rowIdx = rowIndex + 1;
          // 按存储约定渲染：key "0"=流水号（系统内部，不展示）、key "1"=唯一id、
          // key k(k≥2)=表头第 k-1 列（模板字段）
          const parts: string[] = [];
          const uniqueId = row['1'];
          if (uniqueId) {
            parts.push(`唯一id=${uniqueId}`);
          }
          for (let i = 0; i < headers.length; i++) {
            const value = row[String(i + 2)];
            if (value !== undefined && value !== null && String(value) !== '') {
              parts.push(`${headers[i]}=${value}`);
            }
          }
          // 兜底：行内存在约定之外的键（历史数据/命名键），原样附加以免信息丢失
          for (const [key, value] of Object.entries(row)) {
            const idx = Number(key);
            if (!Number.isInteger(idx) || idx < 1 || idx - 2 >= headers.length) {
              if (key !== '0' && key !== '1') parts.push(`${key}=${value}`);
            }
          }
          context += `行${rowIdx}: ${parts.join(', ')}\n`;

          if (uniqueId) {
            quickIndex += `- ${uniqueId} → ${sheet.name}, 行${rowIdx}\n`;
          }
        });
        context += `共 ${rows.length} 条记录\n`;
      }
    });

    if (quickIndex === '【唯一ID快速查找索引】\n') {
      quickIndex += '暂无数据\n';
    }

    return context + '\n' + quickIndex;
  }

  // 保留以维持向后兼容；当前未被外部调用，但原代码已定义。
  private buildTableContext(projectId: string, template: TableTemplate): string {
    const tableData = loadTableData(projectId);
    if (!tableData) return '';

    let context = '当前表格数据状态:\n';
    for (const sheetName of tableData.sheets) {
      const rows = tableData.data[sheetName] || [];
      context += `\n页签: ${sheetName}\n`;
      context += `列: ${tableData.headers[sheetName]?.join(', ') || '无'}\n`;
      context += `行数: ${rows.length}\n`;
      if (rows.length > 0 && rows.length <= 5) {
        context += '最近数据:\n';
        rows.slice(-3).forEach((row: Record<string, unknown>, idx: number) => {
          context += `  - ${JSON.stringify(row)}\n`;
        });
      }
    }
    return context;
  }

  private buildWritingTableOrganizePrompt(
    chapterContent: string,
    template: TableTemplate,
    tableContext: string,
    requirements?: string,
    chapter?: { index?: number; title?: string }
  ): string {
    const templateDescription = template.sheets.map((sheet: TableSheet, index: number) => {
      // 字段编号从 3 开始：字段1=流水号（系统自动）、字段2=唯一id（AI 生成），
      // 与【tableEdit命令格式】参数说明的字段结构约定保持一致，避免两处描述冲突导致 AI 错位
      return `- [索引${index + 1}] ${sheet.name}：表格字段为 [${sheet.headers.map((h: string, i: number) => `${i + 3}:${h}`).join(', ')}]
  表格用途：${sheet.description || '暂无描述'}（每个表格的字段结构固定为 [1:流水号, 2:唯一id, 3+:模板字段]，字段1由系统自动生成无需填写）`;
    }).join('\n');

    const extractionRules = template.sheets.map((sheet: TableSheet, index: number) => {
      const fields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id').join('、');
      return `${index + 1}. **${sheet.name}**：${sheet.description || '暂无描述'} | 提取字段：${fields}`;
    }).join('；');

    const uniqueIdGuide = template.sheets.map((sheet: TableSheet) => {
      const keyFields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id' && h !== '备注').slice(0, 3);
      return `- ${sheet.name}：使用关键字段"${keyFields.join('、')}"的语义组合 + 序号，确保唯一且有语义`;
    }).join('\n');

    return `【角色设定】
你是一个专业的信息提取和表格整理专家，擅长从文本中提取关键信息并生成精确的tableEdit命令。你特别擅长识别不同称呼（appellations）的同一元素，并通过唯一ID策略确保实体识别的一致性。

${
      chapter?.index
        ? `【当前章节】
以下内容来自「第${chapter.index}章${chapter.title ? `（${chapter.title}）` : ''}」。
章节类字段（发生章节/首次登场章节/埋设章节/回收章节等相关事件等）必须填写绝对章号（如"第${chapter.index}章"，N 为事件实际发生的章节序号），禁止填写"本章""上一章"等相对值。`
        : ''
    }
【当前消息】
${chapterContent}

${tableContext}
${requirements ? `【用户整理要求】\n${requirements}\n\n` : ''}【表格模板结构】
${templateDescription}

【表格提取规则】
当前模板包含以下表格，请根据表格名称和描述提取对应信息，同一实体的不同称呼共用唯一ID：
${extractionRules}

【唯一ID生成指南】
${uniqueIdGuide}

【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆
   - 【重要】唯一ID写入字段2，禁止写入其他字段索引，禁止省略字段2

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**。请根据上下文和语义情景判断：
     * 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID
     * 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
     * 姓名 vs 代号/职业："007" = "詹姆斯·邦德" → 同一个唯一ID
     * 代词回指："她" / "他" / "那个女孩" → 根据上下文指向判断对应的实体
   - **关键判断原则**：
     * 如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID
     * 例："朱迪"、"朱迪·霍普斯"、"Judy"、"兔子"都出现在同一个场景且行为连贯 → 同一个角色
     * 例：对话中出现"白兔子"和"灰兔子"两个不同实体，各自有独立描述和行为 → 两个不同的唯一ID
     * 例："学校"和"第一中学"如果上下文明确指同一所学校 → 同一个地点

3. **实体识别与一致性维护**：
   - 在整个对话过程中，建立和维护一致的实体识别
   - 跨越对话轮次和会话，保持同一实体的唯一ID一致性
   - 考虑上下文变化、语义关系和对话流程，进行系统的唯一元素识别
   - 当不确定时，优先假设是同一实体（基于已有记录中的唯一ID判断）

4. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"现有表格数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致（如"典狱长使用的电子面罩"和"典狱长使用的电子面具"）
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段

增量更新决策流程：
1. 从当前消息中识别实体（角色、物品、地点、事件等）
2. 检查表格中是否已有该实体（通过唯一ID或关键特征匹配）
   a. 首先在"唯一ID快速查找索引"中查找
   b. 如果没找到，在"现有表格数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一id=zhudi_001, 姓名=朱迪, 身份=警官（角色表是表格1）
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(1, 1, {"4":"警长"})  ← 表格1第1行，只更新字段4（身份，字段3=姓名、字段2=唯一id不变）
- 错误操作：insertRow(1, {"2":"zhudi_001","3":"朱迪","4":"警长"})  ← 唯一id已存在，重复插入，绝对禁止！

重复检测特殊场景处理：
- 场景1：消息中提到"电子面罩"，但表格中已有"电子面罩"(mask_001)和"电子面罩"(electronic_mask_001)
  处理：这两条记录很可能是同一物品，应合并为一条，使用updateRow更新其中一条，并删除另一条
- 场景2：消息中提到"万能房卡"，表格中已有"万能房卡"(universal_room_card_001)和"万能房卡"(card_001)
  处理：检查描述是否一致，如果一致则合并；如果不一致则保留两条但确保唯一ID不同
- 场景3：消息中提到"神经刺激遥控器"，表格中已有"神经刺激遥控器"(remote_001)和"神经刺激遥控器"(nerve_stimulator_001)
  处理：这两条记录很可能是同一物品，应合并为一条

【输出要求】
1. 从当前消息中提取关键信息，生成对应的tableEdit命令
2. 将命令放在<tableEdit>标签内
3. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
4. 确保使用正确的表格索引、行索引和字段索引
5. 参考现有表格数据，避免重复添加相同信息
6. 识别变体称呼，使用唯一ID保持一致性
7. 只提取当前消息中明确提到的信息，不要臆造
8. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
9. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"现有表格数据"中通过名称相似度查找
10. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
11. 操作结果确认：在生成tableEdit命令后，简要说明每个操作的目的
12. 【绝对禁止】对于唯一ID已存在的实体，绝对不要使用insertRow！这是最严重的错误，会导致数据重复！

【tableEdit命令格式】
你需要将操作指令放在<tableEdit>标签内,使用HTML注释格式:

<tableEdit>
<!-- 
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
-->
</tableEdit>

参数说明:
- 表格索引: 从1开始,对应模板中页签的顺序
- 行索引: 从1开始,对应"现有表格数据"中列出的行号
- 字段索引: 从1开始,对应该表格的字段索引
- 每个表格的字段结构固定为: [1:流水号, 2:唯一id, 3+:模板字段]
- 流水号(字段1)由系统自动递增,无需填写
- 唯一id(字段2)由AI根据实体名称生成,需具有语义且保持一致性
- 模板字段从字段3开始(字段3=表头第1列,字段4=表头第2列...),与【表格模板结构】中列出的编号一一对应

【示例输出 - 精确格式约束】

假设表格模板包含：
- [索引1] 角色表：模板字段为 [3:姓名, 4:身份, 5:性格, 6:特征, 7:关键关系, 8:首次登场章节]
- [索引2] 物品表：模板字段为 [3:名称, 4:类型, 5:持有者, 6:作用, 7:相关事件]
（字段1=流水号由系统自动生成无需填写，字段2=唯一id由你生成）

现有表格数据：
  【角色表】(表格索引: 1)
  行1: 唯一id=zhudi_001, 姓名=朱迪, 身份=警官, 性格=勇敢正直, 特征=兔子、灰色毛发、警服, 关键关系=尼克的搭档, 首次登场章节=第1章
  【物品表】(表格索引: 2)
  行1: 唯一id=mask_001, 名称=电子面罩, 类型=装备, 持有者=典狱长, 作用=监控囚犯, 相关事件=第2章没收

当前消息："朱迪说她今天升官成了警长。她在中央公园捡到一枚金色徽章。"

正确输出格式：

<tableEdit>
<!--
=== 更新操作 ===
updateRow(1, 1, {"4":"警长"})
说明：更新角色表(索引1)中第1行(唯一id=zhudi_001的朱迪)
  只更新变化的字段：字段4(身份)从"警官"改为"警长"
  不要重复填写未变化的字段(唯一id、姓名、性格、特征等)

=== 新增操作 ===
insertRow(2, {"2":"badge_001","3":"金色徽章","4":"饰品","5":"朱迪","6":"朱迪在中央公园捡到的金色徽章","7":"朱迪捡到徽章"})
说明：在物品表(索引2)中新增一行"金色徽章"
  字段2(唯一id): badge_001 - 语义化命名，badge表示徽章，001表示序号
  字段3(名称): 金色徽章
  字段4(类型): 饰品
  字段5(持有者): 朱迪
  字段6(作用): 朱迪在中央公园捡到的金色徽章
  字段7(相关事件): 朱迪捡到徽章
-->
</tableEdit>

【格式规范总结】

1. insertRow(表格索引, {字段数据对象})
   - 表格索引：数字，从1开始，对应模板页签顺序
   - 字段数据对象：JSON格式，键为字段索引(字符串)，值为字段内容(字符串)
   - 示例：insertRow(1, {"2":"zhudi_001","3":"朱迪","4":"警官"})
   - 注意：字段索引2(唯一id)必须填写，字段1(流水号)由系统自动生成无需填写
   - 注意：所有值必须是字符串类型，用双引号包裹

2. updateRow(表格索引, 行索引, {字段数据对象})
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始，对应"现有表格数据"中列出的行号
   - 字段数据对象：JSON格式，只包含需要更新的字段
   - 示例：updateRow(1, 1, {"4":"警长"})
   - 注意：只更新变化的字段，不要重复填写未变化的字段
   - 注意：行索引必须在当前表格数据范围内(参考"唯一ID快速查找索引")

3. deleteRow(表格索引, 行索引)
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始
   - 示例：deleteRow(2, 1)
   - 注意：删除操作需谨慎，仅在确认记录不再相关时使用
   - 注意：合并重复记录时，应先updateRow保留的记录，再deleteRow删除重复的记录

【错误格式示例 - 绝对禁止】

✗ insertRow(1, {"3":"朱迪","4":"警官"})
  错误原因：缺少字段2(唯一id)，insertRow 必须填写唯一id

✗ insertRow(1, {"1":"001","2":"zhudi_001","3":"朱迪","4":"警官"})
  错误原因：字段1(流水号)由系统自动生成，禁止手动填写

✗ updateRow(1, 1, {"2":"new_id_002","4":"警长"})
  错误原因：updateRow 禁止修改唯一id(字段2)，只更新变化的模板字段

✗ insertRow("2", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

✗ updateRow(2, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串

【现在开始处理】
请分析上述消息，参考现有表格数据，提取关键信息并生成tableEdit命令。记住：这是增量更新，不要重复插入已存在的实体！`;
  }

  // 保留以维持向后兼容；当前未被外部调用，但原代码已定义。
  private buildChapterPrompt(chapter: Chapter, template: TableTemplate, tableContext: string): string {
    let prompt = `你是一个小说数据整理助手。请分析以下章节内容，并根据模板结构提取关键信息到表格中。\n\n`;
    prompt += `章节标题: ${chapter.title}\n`;
    prompt += `章节索引: ${chapter.index}\n\n`;
    prompt += `章节内容:\n${chapter.content?.substring(0, 8000)}\n\n`;

    prompt += `表格模板结构:\n`;
    for (const sheet of template.sheets) {
      prompt += `页签: ${sheet.name}\n`;
      prompt += `描述: ${sheet.description || '无'}\n`;
      prompt += `列: ${sheet.headers.join(', ')}\n\n`;
    }

    if (tableContext) {
      prompt += `${tableContext}\n\n`;
    }

    prompt += `请提取章节中的关键信息，使用以下格式更新表格：\n`;
    prompt += `\`\`\`tableEdit\n`;
    prompt += `sheet: 页签名称\n`;
    prompt += `action: insert\n`;
    prompt += `data: {"列名1": "值1", "列名2": "值2", ...}\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `请只返回tableEdit命令，不要返回其他内容。`;

    return prompt;
  }

  private async callAIAPI(
    prompt: string,
    modelConfig: ModelConfig,
    apiEndpoint: { apiUrl: string; apiMode: string; apiKey: string; apiKeyTransmission: string; modelName: string }
  ): Promise<string> {
    addLog(`[WritingOrganize] AI请求 - 开始调用 AI API`, 'debug');
    addLog(`[WritingOrganize] AI请求 - 模型: ${apiEndpoint.modelName}`, 'debug');
    addLog(`[WritingOrganize] AI请求 - 地址: ${apiEndpoint.apiUrl}`, 'debug');
    addLog(`[WritingOrganize] AI请求 - 提示词长度: ${prompt.length} 字符`, 'debug');

    const config: AIAPIConfig = {
      apiKey: apiEndpoint.apiKey,
      apiUrl: apiEndpoint.apiUrl,
      modelName: apiEndpoint.modelName,
      apiKeyTransmission: apiEndpoint.apiKeyTransmission,
      apiMode: apiEndpoint.apiMode,
    };

    const params: AIAPIParams = {
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
      systemPrompt: '你是一个小说数据整理助手，负责从章节内容中提取结构化信息到表格中。',
    };

    const payload: Record<string, unknown> = {
      model: apiEndpoint.modelName,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
      messages: [
        { role: 'system', content: '你是一个小说数据整理助手，负责从章节内容中提取结构化信息到表格中。' },
        { role: 'user', content: prompt }
      ]
    };

    if (apiEndpoint.apiKeyTransmission === 'body') {
      payload.api_key = apiEndpoint.apiKey;
    }

    addLog(`[WritingOrganize] AI请求 - 完整 Payload:`, 'debug');
    addLog(JSON.stringify(payload, null, 2), 'debug');

    try {
      const response = await callAIAPIWithFetch(prompt, config, params);
      addLog(`[WritingOrganize] AI响应 - 内容长度: ${response.length} 字符`, 'debug');
      addLog(`[WritingOrganize] AI响应 - 内容: ${response}`, 'debug');
      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`[WritingOrganize] AI调用失败: ${errorMsg}`, 'error');
      throw error;
    }
  }
}
