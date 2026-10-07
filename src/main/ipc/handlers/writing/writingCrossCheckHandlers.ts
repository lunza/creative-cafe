/**
 * 写作模式 - 跨章节连贯性审查 IPC handler
 * Spec: add-cross-chapter-coherence-review
 *
 * 涵盖：
 *   - 跨章审查（crossCheckReview：本地扫描 + AI 语义审查，流式进度 writing:crossCheck:stream）
 *   - 中止审查（crossCheckCancel：cancelled 标记契约）
 *   - 一键修复建议（crossCheckSuggestFix）
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { crossChapterReviewService } from '../../../services/writing/CrossChapterReviewService';
import { getStorageService } from '../../../services/storageService';
import { addLog } from '../../../services/memory/chatLogService';
import type { ModelConfig } from '../../../../shared/types/writing.types';
import type { CrossCheckParams, CrossCheckIssue } from '../../../../shared/types/cross-chapter-review.types';

/** 从活动 AI 引擎读取模型配置（与 writingPlotCheckHandlers 同一模式） */
function resolveModelConfig(project: { config?: { modelConfig?: { model?: string; temperature?: number; maxTokens?: number } } }): ModelConfig {
  const storageService = getStorageService();
  const settings = storageService.getSettings();
  const engines = settings?.aiEngines || [];
  // 已分析但保留：settings.aiEngines 类型未声明，TS 无法推断 .find 回调参数；保留 (e: any)
  const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

  return {
    model: activeEngine?.model_name ?? project.config?.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
    temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (project.config?.modelConfig?.temperature ?? 0.7),
    maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (project.config?.modelConfig?.maxTokens ?? 10240)
  };
}

export function registerWritingCrossCheckHandlers(): void {
  // ========== 跨章审查 ==========
  ipcMain.handle('writing:crossCheckReview', async (event, request: { projectId: string; params: CrossCheckParams }) => {
    try {
      addLog('===== 写作模式: 跨章审查请求 =====', 'debug');
      addLog(`起始: ${request.params?.startPos}, 章数: ${request.params?.count}, 距离: ${request.params?.distance}, 阈值: ${request.params?.similarityThreshold}, 严格度: ${request.params?.aiStrictness}`, 'debug');

      const project = await writingStorageService.loadProject(request.projectId);
      if (!project) {
        return { success: false, error: '项目不存在', report: null };
      }

      let modelConfig: ModelConfig | undefined;
      try {
        modelConfig = resolveModelConfig(project);
      } catch {
        // 仅本地扫描时不需要模型
        if (request.params.enableAiReview === false) {
          addLog('[跨章审查] 未配置模型但已关闭 AI 审查，仅执行本地扫描', 'debug');
        } else {
          return { success: false, error: '未配置 AI 模型，请在设置中配置 AI 引擎（或关闭 AI 语义审查）', report: null };
        }
      }

      const report = await crossChapterReviewService.reviewCrossChapters(
        { projectId: request.projectId, params: request.params, modelConfig },
        (p) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send('writing:crossCheck:stream', {
            projectId: request.projectId,
            phase: p.phase ?? 'ai',
            chunk: p.chunk ?? '',
            reasoning: p.reasoning ?? '',
            message: p.message,
          });
        }
      );

      addLog(`[跨章审查] 完成: ${report.issues.length} 条问题, cancelled=${!!report.cancelled}`, 'debug');
      return { success: true, report, error: report.aiError && report.issues.length === 0 ? report.aiError : null };
    } catch (error) {
      addLog(`[跨章审查] 错误: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return {
        success: false,
        report: null,
        error: error instanceof Error ? error.message : '跨章审查失败',
      };
    }
  });

  // ========== 中止审查 ==========
  ipcMain.handle('writing:crossCheckCancel', async () => {
    try {
      crossChapterReviewService.cancel();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '中止失败' };
    }
  });

  // ========== 一键修复建议 ==========
  ipcMain.handle('writing:crossCheckSuggestFix', async (_event, request: { projectId: string; issue: CrossCheckIssue; checkedPositions: number[]; customPrompt?: string }) => {
    try {
      addLog('===== 写作模式: 跨章审查修复建议请求 =====', 'debug');
      const result = await crossChapterReviewService.suggestFix(request);
      addLog(`[跨章审查-修复] 结果: success=${result.success}${result.error ? `, error=${result.error}` : ''}`, 'debug');
      return result;
    } catch (error) {
      addLog(`[跨章审查-修复] 错误: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : '修复建议生成失败' };
    }
  });
}
