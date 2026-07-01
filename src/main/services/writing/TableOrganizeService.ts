import { Chapter, ModelConfig, ChapterStatus } from '../../../shared/types/writing.types';
import type { IncomingMessage } from 'http';
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
import { tableTemplateService, TableTemplate, TableSheet } from '../memory/tableTemplateService';
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

  // ==================== 公共入口 ====================

  async organizeTable(
    projectId: string,
    modelConfig: ModelConfig,
    chapterIndex?: number,
    onProgress?: (current: number, total: number, message: string, percent?: number, currentChunk?: number, totalChunks?: number) => void,
    requirements?: string,
    skipOrganized?: boolean
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> {
    const result = { success: false, processedCount: 0, errorCount: 0, errors: [] as string[] };
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

      const tableData = loadTableData(projectId);
      if (!tableData || !tableData.sheets || tableData.sheets.length === 0) {
        throw new Error('表格数据不存在，请先绑定模板');
      }

      // 保存原始数据快照（深拷贝）
      const originalDataSnapshot: WritingTableData = JSON.parse(JSON.stringify(tableData));

      const template = tableTemplateService.getTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      // 确定要处理的章节列表
      let chaptersToProcess: Chapter[];
      if (chapterIndex !== undefined) {
        // 单章节模式：仅处理指定章节
        const targetChapter = project.outline!.chapters.find(ch => ch.index === chapterIndex);
        if (!targetChapter) {
          throw new Error(`章节 ${chapterIndex} 不存在`);
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

      // 累计已处理的分片数，用于精确进度计算
      let processedChunks = 0;

      for (let i = 0; i < chaptersToProcess.length; i++) {
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
  ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> {
    const startTime = new Date().toISOString();
    const result = { success: false, processedCount: 0, errorCount: 0, errors: [] as string[] };

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

      const tableData = loadTableData(projectId);
      if (!tableData || !tableData.sheets || tableData.sheets.length === 0) {
        throw new Error('表格数据不存在，请先绑定模板');
      }

      // 验证指定的 sheet 是否存在
      if (!tableData.sheets.includes(sheetName)) {
        throw new Error(`表格 "${sheetName}" 不存在`);
      }

      const template = tableTemplateService.getTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      // 验证模板中包含该 sheet
      const targetSheetTemplate = template.sheets?.find((s: TableSheet) => s.name === sheetName);
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
        const targetChapter = project.outline!.chapters.find(ch => ch.index === chapterIndex);
        if (!targetChapter) {
          throw new Error(`章节 ${chapterIndex} 不存在`);
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
      let processedChunks = 0;

      for (let i = 0; i < chaptersToProcess.length; i++) {
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

      const template = tableTemplateService.getTemplate(tableConfig.associatedTemplateId);
      if (!template) {
        throw new Error(`模板 ${tableConfig.associatedTemplateId} 不存在`);
      }

      // 找到当前 sheet 的模板定义
      const sheetTemplate = template.sheets?.find((s: TableSheet) => s.name === sheet);
      if (!sheetTemplate) {
        throw new Error(`模板中不存在 sheet "${sheet}"`);
      }

      // 使用与 organizeTable 一致的 AI 调用链路
      const apiEndpoint = this.aiConfig.buildApiEndpoint(modelConfig);

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
        const uniqueId = row['1']; // "1" 对应唯一 ID 字段（索引1）

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
      const prompt = this.buildSingleSheetOrganizePrompt(chunkContent, template, tableContext, requirements);

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
    requirements?: string
  ): string {
    const targetSheet = template.sheets[0]; // 单表格模板只有一个 sheet

    const requirementsSection = requirements
      ? `\n【用户整理要求】\n${requirements}\n`
      : '';

    return `【角色设定】
你是一个专业的小说内容分析专家，擅长从小说章节中提取关键信息并整理到结构化表格中。

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

    // 将行数据格式化为可读文本
    const currentDataStr = Object.entries(currentRowData)
      .filter(([key]) => key !== '0')
      .map(([key, value]) => {
        const idx = parseInt(key, 10);
        const headerName = sheetTemplate.headers[idx - 1] || `字段${idx}`;
        return `${headerName}: ${value}`;
      }).join('\n');

    return `【角色设定】
你是一个专业的信息整理专家，擅长根据用户的要求优化和整理表格中的数据行。

【项目上下文】
${projectContext}

${tableContext}
【当前待整理行数据】
Sheet: ${sheetTemplate.name}
字段定义（索引 → 字段名）：${sheetTemplate.headers.map((h: string, i: number) => `[${i}]${h}`).join(', ')}
当前行值：${Object.entries(currentRowData).filter(([key]) => key !== '0').map(([key, value]) => {
      const idx = parseInt(key, 10);
      const headerName = sheetTemplate.headers[idx] || `字段${idx}`;
      return `[${idx}]${headerName}=${value}`;
    }).join(', ')}

【用户整理要求】
${requirements}

【任务要求】
1. 根据用户的整理要求，结合项目上下文和表格上下文，优化当前行的所有字段数据
2. 保持"[0]"索引（流水号）字段的值不变
3. 保持"[1]"索引（唯一id）字段的值不变
4. 其他字段根据用户要求进行优化和补充
5. 返回完整的行数据，格式为 JSON 对象

【返回格式】
请仅返回 JSON 对象，键名为字段索引字符串，值为对应的字段内容：
{"0": "流水号的值（保持不变）", "1": "唯一id的值（保持不变）", "2": "字段2的值", "3": "字段3的值", ...}

重要：
- 键名必须是数字字符串（"0", "1", "2", ...），必须与上方字段定义的索引一一对应
- "0" 对应第一个字段（流水号），"1" 对应第二个字段（唯一id），依此类推
- 必须返回所有字段的键值对，数量与字段定义中的字段数相同
- 不要返回任何其他内容，仅返回 JSON`;
  }

  /**
   * 解析 AI 返回的行数据
   * 保持唯一 ID 和流水号不变
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

    // 构建新的行数据
    const newRow: Record<string, unknown> = {};

    for (let i = 0; i < headers.length; i++) {
      const key = i.toString();
      const header = headers[i];

      // 保持唯一 ID 和流水号不变
      if (header === '唯一id' || header === '流水号') {
        newRow[key] = originalRowData[key] || parsed[key] || '';
      } else {
        newRow[key] = parsed[key] !== undefined ? parsed[key] : (originalRowData[key] || '');
      }
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
      const prompt = this.buildWritingTableOrganizePrompt(chunkContent, template, tableContext, requirements);

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

      if (rows.length > 0) {
        context += `\n【${sheet.name}】(表格索引: ${tableIndex})\n`;
        rows.forEach((row: Record<string, unknown>, rowIndex: number) => {
          const rowIdx = rowIndex + 1;
          context += `行${rowIdx}: `;
          const parts: string[] = [];
          for (const [key, value] of Object.entries(row)) {
            if (key !== '流水号') {
              parts.push(`${key}=${value}`);
            }
          }
          context += parts.join(', ') + '\n';

          const uniqueId = row['唯一id'];
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
    requirements?: string
  ): string {
    const templateDescription = template.sheets.map((sheet: TableSheet, index: number) => {
      return `- [索引${index + 1}] ${sheet.name}：字段包括 [${sheet.headers.map((h: string, i: number) => `${i + 1}:${h}`).join(', ')}]
  表格用途：${sheet.description || '暂无描述'}`;
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
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
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
   b. 如果没找到，在"当前已有数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一ID=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(2, 1, {"4":"警长"})  ← 只更新身份字段（假设角色表格是表格2，身份是字段4）
- 错误操作：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

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
9. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"当前已有数据"中通过名称相似度查找
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
- 行索引: 从1开始,对应该表格中的数据行索引
- 字段索引: 从1开始,对应该表格表头的字段索引
- 每个表格的字段结构固定为: [1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增,通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成,需具有语义且保持一致性

【示例输出 - 精确格式约束】

假设当前对话场景如下：
- 消息："朱迪说她昨天在中央公园遇到了尼克，尼克给她展示了一枚金色徽章。另外，之前提到的电子面罩已经被典狱长收回了。"
- 现有表格数据：
  【角色表格】(表格索引: 2)
  行1: 唯一id=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官, 关系=主角
  行2: 唯一id=nick_001, 角色名=尼克·王尔德, 身份=狐狸, 关系=配角
  【物品表格】(表格索引: 4)
  行1: 唯一id=mask_001, 物品名=电子面罩, 类型=装备, 状态=使用中, 备注/持有人=典狱长
  行3: 唯一id=card_001, 物品名=万能房卡, 类型=钥匙, 状态=可用, 备注/持有人=朱迪

正确输出格式：

<tableEdit>
<!-- 
=== 新增操作 ===
insertRow(2, {"2":"badge_001","3":"金色徽章","4":"物品","5":"尼克展示给朱迪的金色徽章","6":"已发现","7":"尼克"})
说明：在角色表格(索引2)中新增一行，添加"金色徽章"物品记录
  字段2(唯一id): badge_001 - 语义化命名，badge表示徽章，001表示序号
  字段3(物品名): 金色徽章
  字段4(类型): 物品
  字段5(描述): 尼克展示给朱迪的金色徽章
  字段6(状态): 已发现
  字段7(备注/持有人): 尼克

=== 更新操作 ===
updateRow(2, 2, {"6":"已见面","7":"狐狸骗子"})
说明：更新角色表格(索引2)中第2行(尼克·王尔德)的信息
  行2对应的是唯一id=nick_001的记录
  只更新变化的字段：字段6(关系)从"配角"改为"已见面"，字段7(特征)更新为"狐狸骗子"
  不要重复填写未变化的字段(唯一id、角色名、身份)

updateRow(4, 1, {"6":"已收回"})
说明：更新物品表格(索引4)中第1行(电子面罩)的状态
  行1对应的是唯一id=mask_001的记录
  只更新字段6(状态)从"使用中"改为"已收回"

=== 删除操作 ===
deleteRow(4, 1)
说明：删除物品表格(索引4)中第1行(电子面罩)
  行1对应的是唯一id=mask_001的记录
  仅在确认该物品已不再相关时使用删除操作
-->
</tableEdit>

【格式规范总结】

1. insertRow(表格索引, {字段数据对象})
   - 表格索引：数字，从1开始，对应模板页签顺序
   - 字段数据对象：JSON格式，键为字段索引(字符串)，值为字段内容(字符串)
   - 示例：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官"})
   - 注意：字段索引2(唯一id)必须填写，字段1(流水号)由系统自动生成无需填写
   - 注意：所有值必须是字符串类型，用双引号包裹

2. updateRow(表格索引, 行索引, {字段数据对象})
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始，对应当前表格中的数据行号
   - 字段数据对象：JSON格式，只包含需要更新的字段
   - 示例：updateRow(2, 1, {"4":"警长"})
   - 注意：只更新变化的字段，不要重复填写未变化的字段
   - 注意：行索引必须在当前表格数据范围内(参考"唯一ID快速查找索引")

3. deleteRow(表格索引, 行索引)
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始
   - 示例：deleteRow(4, 1)
   - 注意：删除操作需谨慎，仅在确认记录不再相关时使用
   - 注意：合并重复记录时，应先updateRow保留的记录，再deleteRow删除重复的记录

【错误格式示例 - 绝对禁止】

✗ insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"}) 
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(2, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

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
    const http = require('http');
    const https = require('https');

    const parsedUrl = new URL(apiEndpoint.apiUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    if (!modelConfig.temperature && modelConfig.temperature !== 0) {
      throw new Error('未提供 temperature 参数');
    }
    if (!modelConfig.maxTokens) {
      throw new Error('未提供 maxTokens 参数');
    }

    const { apiKey, apiKeyTransmission, modelName, apiMode } = apiEndpoint;

    const payload: Record<string, unknown> = {
      model: modelName,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
    };

    if (apiMode === 'text_completion') {
      Object.assign(payload, { prompt });
    } else {
      Object.assign(payload, {
        messages: [
          { role: 'system', content: '你是一个小说数据整理助手，负责从章节内容中提取结构化信息到表格中。' },
          { role: 'user', content: prompt }
        ]
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKeyTransmission === 'header') {
      const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      headers['Authorization'] = authValue;
    } else {
      payload.api_key = apiKey;
    }

    addLog(`[WritingOrganize] AI请求 - 完整 Payload:`, 'debug');
    addLog(JSON.stringify(payload, null, 2), 'debug');

    const requestBody = JSON.stringify(payload);
    const contentLength = Buffer.byteLength(requestBody);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': contentLength,
        },
        timeout: 0,
      };

      const req = transport.request(options, (res: IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            addLog(`[WritingOrganize] AI响应 - 完整原始数据:`, 'debug');
            addLog(data, 'debug');
            addLog(`[WritingOrganize] AI响应 - 完整解析后JSON:`, 'debug');
            addLog(JSON.stringify(response, null, 2), 'debug');
            if (apiMode === 'text_completion') {
              resolve(response.choices?.[0]?.text || '');
            } else {
              resolve(response.choices?.[0]?.message?.content || '');
            }
          } catch (e) {
            addLog(`[WritingOrganize] AI响应 - 解析失败，原始数据:`, 'error');
            addLog(data, 'error');
            reject(new Error(`AI响应解析失败: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('AI请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }
}
