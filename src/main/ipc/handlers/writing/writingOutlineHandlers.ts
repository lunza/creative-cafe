/**
 * 写作模式 - 大纲相关 IPC handler
 *
 * 涵盖：AI 大纲生成（writingV2 命名空间共享通道）。
 *
 * 大纲生成使用 `activeAbortControllers` 中止控制器，
 * 该共享状态由 writingChapterHandlers 维护。
 */
import { ipcMain } from 'electron';
import { writingResourceManager } from '../../../services/WritingResourceManager';
import { outlineGenerator } from '../../../services/writing/OutlineGenerator';
import { promptBuilder } from '../../../services/writing/PromptBuilder';
import { writingTemplateRepository } from '../../../services/writing/WritingTemplateRepository';
import { addLog } from '../../../services/memory/chatLogService';
import { activeAbortControllers } from './writingChapterHandlers';

export function registerWritingOutlineHandlers(): void {
  // ========== AI 大纲生成 ==========

  ipcMain.handle('writing:generateOutline', async (event, request) => {
    try {
      addLog('===== 写作模式: AI大纲生成请求 =====', 'debug');
      addLog(`创意描述: ${request.parameters.creativeDescription}`, 'debug');
      addLog(`小说类型: ${request.parameters.novelType}`, 'debug');
      addLog(`目标字数: ${request.parameters.targetWordCount}`, 'debug');
      addLog(`章节数量: ${request.parameters.chapterCount}`, 'debug');
      addLog(`写作风格: ${request.parameters.writingStyle}`, 'debug');
      addLog(`叙事视角: ${request.parameters.narrativePerspective}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      if (!request || !request.parameters || !request.modelConfig) {
        return {
          success: false,
          outline: null,
          outlineRaw: null,
          error: '请求参数格式不正确'
        };
      }

      const abortController = new AbortController();
      const outlineKey = 'outline_generate';
      activeAbortControllers.set(outlineKey, abortController);

      try {
        const resources = request.resources || { worldBookIds: [], characterCardIds: [] };
        const userPersonaIds = resources.userPersonaIds || [];

        const worldBooks = await writingResourceManager.loadWorldBooks(resources.worldBookIds || []);
        const characters = await writingResourceManager.loadCharacterCards(resources.characterCardIds || []);
        const userPersonas = await writingResourceManager.loadUserPersonas(userPersonaIds);

        // Load writing styles
        const writingStyleIds = resources.writingStyleIds || [];
        const writingStyles = await writingResourceManager.loadWritingStyles(writingStyleIds);

        const resourceContext = writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas, writingStyles);

        // Build writing style context for prompts
        let writingStyleContext = '';
        if (writingStyles.length > 0) {
          writingStyleContext = promptBuilder.buildWritingStylePrompt(writingStyles);
        }

        outlineGenerator.onStreamChunk((chunk: string) => {
          event.sender.send('writing:stream:chunk', { chunk });
        });

        // 加载自定义模板（如有）
        let customNovelTypeTemplate = null;
        let customWritingStyleTemplate = null;
        if (request.parameters.customNovelTypeId) {
          customNovelTypeTemplate = await writingTemplateRepository.getCustomNovelTypeTemplate(request.parameters.customNovelTypeId);
        }
        if (request.parameters.customWritingStyleId) {
          customWritingStyleTemplate = await writingTemplateRepository.getCustomWritingStyleTemplate(request.parameters.customWritingStyleId);
        }

        const result = await outlineGenerator.generate(
          outlineGenerator.buildPrompt({ ...request, resources, _resourceContext: resourceContext, _writingStyleContext: writingStyleContext, _customNovelTypeTemplate: customNovelTypeTemplate || undefined, _customWritingStyleTemplate: customWritingStyleTemplate || undefined }),
          request.modelConfig,
          abortController.signal
        );

        activeAbortControllers.delete(outlineKey);

        addLog('===== 写作模式: 大纲生成成功 =====', 'debug');
        addLog(`原始内容长度: ${result.rawContent?.length || 0}`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

        return {
          success: true,
          outline: null,
          outlineRaw: result.rawContent,
          chainOfThought: result.chainOfThought || null
        };
      } catch (error) {
        activeAbortControllers.delete(outlineKey);

        if (error instanceof Error && 'rawContent' in error && error.rawContent) {
          return {
            success: false,
            outline: null,
            outlineRaw: error.rawContent as string,
            chainOfThought: (error as any).chainOfThought || null, // 已分析但保留：访问 Error 上的自定义 chainOfThought 属性
            error: '大纲解析失败，但原始内容已保留'
          };
        }

        throw error;
      }
    } catch (error) {
      addLog('===== 写作模式: 大纲生成错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outline: null,
        outlineRaw: null,
        error: errorMessage || '大纲生成失败，请稍后重试'
      };
    }
  });

}
