/**
 * 写作模式 - 剧情检查 / 自动修正 / 逻辑记录 IPC handler
 *
 * 涵盖：
 *   - 章节剧情检查（checkChapter）
 *   - 单条问题自动修正（autoFixIssue）
 *   - 批量问题修正（batchFixIssues）
 *   - 逻辑检查记录查询 / 清空（getLogicCheckRecords / clearLogicCheckRecords）
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { plotCheckerService, PlotCheckRequestData } from '../../../services/writing/PlotCheckerService';
import { logicCheckRecorder } from '../../../services/writing/LogicCheckRecorder';
import { getStorageService } from '../../../services/storageService';
import { addLog } from '../../../services/memory/chatLogService';
import {
  ModelConfig,
  PlotCheckIssue,
  BatchFixRequest,
  BatchFixResult
} from '../../../../shared/types/writing.types';

export function registerWritingPlotCheckHandlers(): void {
  // ========== 章节剧情检查 ==========

  ipcMain.handle('writing:checkChapter', async (_event, request: { projectId: string; chapterIndex: number; content: string; previousChapters?: { index: number; title: string; content: string }[] }) => {
    try {
      addLog('===== 写作模式: 剧情检查请求 =====', 'debug');
      addLog(`章节索引: ${request.chapterIndex}`, 'debug');
      addLog(`内容长度: ${request.content?.length || 0}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const project = await writingStorageService.loadProject(request.projectId);
      if (!project) {
        return { success: false, error: '项目不存在', report: null };
      }

      // Read model config from active AI engine settings (same logic as PlotCheckerService.getConfig)
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      // 已分析但保留：settings.aiEngines 类型未声明，TS 无法推断 .find 回调参数；保留 (e: any)
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name ?? project.config?.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
        temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (project.config?.modelConfig?.temperature ?? 0.7),
        maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (project.config?.modelConfig?.maxTokens ?? 10240)
      };

      addLog(`模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      if (!modelConfig.model) {
        return { success: false, error: '未配置 AI 模型，请在设置中配置 AI 引擎', report: null };
      }

      const tableData = await writingStorageService.getTableData(request.projectId);
      const tableConfig = await writingStorageService.getTableConfig(request.projectId);

      const checkRequest: PlotCheckRequestData = {
        projectId: request.projectId,
        chapterIndex: request.chapterIndex,
        content: request.content,
        outline: project.outline,
        resources: project.config?.resources || { worldBookIds: [], characterCardIds: [] },
        novelType: project.config?.parameters?.novelType,
        writingStyle: project.config?.parameters?.writingStyle,
        modelConfig,
        previousChapters: request.previousChapters || [],
        writingTableData: tableData && tableConfig ? {
          tableConfig: {
            associatedTemplateId: tableConfig.associatedTemplateId || '',
            associatedTemplateName: tableConfig.associatedTemplateName
          },
          sheets: tableData.sheets,
          headers: tableData.headers,
          data: tableData.data,
          sheetDescriptions: tableData.sheetDescriptions
        } : undefined
      };

      const report = await plotCheckerService.checkChapter(checkRequest);

      // 记录逻辑异常到记忆表格
      if (report.logicCheckResult && report.logicCheckResult.issues.length > 0) {
        const chapterTitle = project.outline?.chapters?.find(ch => ch.index === request.chapterIndex)?.title;
        await logicCheckRecorder.recordIssues(
          report.logicCheckResult.issues,
          request.projectId,
          request.chapterIndex,
          chapterTitle
        );
      }

      addLog('===== 写作模式: 剧情检查完成 =====', 'debug');
      addLog(`综合评分: ${report.overallScore}`, 'debug');
      addLog(`问题总数: ${report.totalIssues}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return { success: true, report, error: null };
    } catch (error) {
      addLog('===== 写作模式: 剧情检查错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        report: null,
        error: error instanceof Error ? error.message : '剧情检查失败'
      };
    }
  });

  // ========== 自动修正 ==========

  ipcMain.handle('writing:autoFixIssue', async (_event, request: { projectId: string; chapterIndex: number; content: string; issue: PlotCheckIssue; issueType?: 'dimension' | 'logic'; modelConfig?: ModelConfig }) => {
    try {
      addLog('===== 写作模式: 自动修正请求 =====', 'debug');
      addLog(`章节索引: ${request.chapterIndex}`, 'debug');
      addLog(`问题标题: ${request.issue?.title || request.issue?.description}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      // Read model config from active AI engine settings
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      // 已分析但保留：settings.aiEngines 类型未声明，TS 无法推断 .find 回调参数；保留 (e: any)
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name ?? request.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
        temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (request.modelConfig?.temperature ?? 0.7),
        maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (request.modelConfig?.maxTokens ?? 10240)
      };

      addLog(`【自动修正】模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      const result = await plotCheckerService.autoFixIssue(
        request.projectId,
        request.chapterIndex,
        request.content,
        request.issue,
        request.issueType || 'dimension',
        modelConfig
      );

      addLog('===== 写作模式: 自动修正完成 =====', 'debug');
      addLog(`修正成功: ${result.success}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return {
        success: result.success,
        fixedContent: result.fixedContent,
        diffs: result.diffs || [],
        error: result.error || null
      };
    } catch (error) {
      addLog('===== 写作模式: 自动修正错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        fixedContent: request.content,
        diffs: [],
        error: error instanceof Error ? error.message : '自动修正失败'
      };
    }
  });

  // ========== 批量修正 ==========

  ipcMain.handle('writing:batchFixIssues', async (_event, req: BatchFixRequest): Promise<BatchFixResult> => {
    try {
      addLog('===== 写作模式: 批量修正请求 =====', 'debug');
      addLog(`章节索引: ${req.chapterIndex}`, 'debug');
      addLog(`问题数量: ${req.issues?.length || 0}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const project = await writingStorageService.loadProject(req.projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      // Read model config from active AI engine settings
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      // 已分析但保留：settings.aiEngines 类型未声明，TS 无法推断 .find 回调参数；保留 (e: any)
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name ?? req.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
        temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (req.modelConfig?.temperature ?? 0.7),
        maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (req.modelConfig?.maxTokens ?? 10240)
      };

      addLog(`【批量修正】模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      const result = await plotCheckerService.batchFixIssues(
        req.projectId,
        req.chapterIndex,
        req.content,
        req.issues,
        modelConfig
      );

      addLog('===== 写作模式: 批量修正完成 =====', 'debug');
      addLog(`修正成功: ${result.success}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return result;
    } catch (error) {
      addLog('===== 写作模式: 批量修正错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        fixedContent: req.content,
        results: req.issues.map((_, i) => ({ index: i, success: false, error: error instanceof Error ? error.message : 'Unknown error' })),
        error: error instanceof Error ? error.message : '批量修正失败'
      };
    }
  });

  // ========== 逻辑检查记录 ==========

  ipcMain.handle('writing:getLogicCheckRecords', async () => {
    try {
      const result = logicCheckRecorder.getRecords();
      return result;
    } catch (error) {
      return { success: false, records: [], error: error instanceof Error ? error.message : '获取记录失败' };
    }
  });

  ipcMain.handle('writing:clearLogicCheckRecords', async () => {
    try {
      return logicCheckRecorder.clearRecords();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '清空记录失败' };
    }
  });
}
