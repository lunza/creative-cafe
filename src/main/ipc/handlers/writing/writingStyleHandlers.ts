/**
 * 写作模式 - 风格学习 / 创意描述润色 IPC handler
 *
 * 涵盖：
 *   - 风格学习（upload / list / get / delete / cancel / getActiveTasks）
 *   - 创意描述润色（polishDescription，流式 polish:chunk / polish:complete / polish:error 事件）
 *
 * 风格学习与润色均使用 `activeAbortControllers` 中止控制器，
 * 该共享状态由 writingChapterHandlers 维护。
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { writingResourceManager } from '../../../services/WritingResourceManager';
import { writingStyleLearningService } from '../../../services/WritingStyleLearningService';
import { descriptionPolisher } from '../../../services/writing/DescriptionPolisher';
import { getStorageService } from '../../../services/storageService';
import { addLog } from '../../../services/memory/chatLogService';
import { activeAbortControllers } from './writingChapterHandlers';

export function registerWritingStyleHandlers(): void {
  // ========== 风格学习 ==========

  // File upload and start learning
  ipcMain.handle('writing:style:upload', async (event, request: { filePath: string; fileName: string; fileSize: number }) => {
    try {
      const taskId = `style_learning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Start learning in background (don't await)
      writingStyleLearningService.startLearning(request, taskId).then(resource => {
        return { success: true, taskId, resource };
      }).catch(error => {
        console.error('[Writing] Style learning failed:', error);
        event.sender.send('writing:style:error', {
          taskId,
          error: error instanceof Error ? error.message : '学习失败'
        });
        return { success: false, taskId, error: error instanceof Error ? error.message : '学习失败' };
      });

      return { success: true, taskId };
    } catch (error) {
      return {
        success: false,
        taskId: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // List all learned writing styles
  ipcMain.handle('writing:style:list', async () => {
    try {
      const styles = await writingStorageService.listWritingStyles();
      return { success: true, styles };
    } catch (error) {
      return {
        success: false,
        styles: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get single writing style resource
  ipcMain.handle('writing:style:get', async (_event, resourceId: string) => {
    try {
      const style = await writingStorageService.loadWritingStyle(resourceId);
      if (!style) {
        return { success: false, style: null, error: '写作风格不存在' };
      }
      return { success: true, style };
    } catch (error) {
      return {
        success: false,
        style: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Delete writing style
  ipcMain.handle('writing:style:delete', async (_event, resourceId: string) => {
    try {
      const success = await writingStorageService.deleteWritingStyle(resourceId);
      return { success };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Cancel learning task
  ipcMain.handle('writing:style:cancel', async (_event, taskId: string) => {
    try {
      const cancelled = writingStyleLearningService.cancelLearning(taskId);
      return { success: cancelled };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get active learning tasks
  ipcMain.handle('writing:style:getActiveTasks', async () => {
    try {
      const activeTaskIds = writingStyleLearningService.getActiveTaskIds();
      return { success: true, activeTaskIds };
    } catch (error) {
      return {
        success: false,
        activeTaskIds: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // ========== 创意描述润色 ==========

  ipcMain.handle('writing:polishDescription', async (event, request: {
    description: string;
    instruction?: string;
    resources?: {
      worldBookIds?: string[];
      characterCardIds?: string[];
      userPersonaIds?: string[];
    };
    modelConfig?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };
  }) => {
    try {
      addLog('===== 写作模式: 创意描述润色请求 =====', 'debug');
      addLog(`描述长度: ${request.description?.length || 0}`, 'debug');
      addLog(`指令: ${request.instruction || '(无)'}`, 'debug');
      addLog(`资源: ${JSON.stringify(request.resources || {})}`, 'debug');

      if (!request.description || request.description.trim().length === 0) {
        return {
          success: false,
          error: '描述内容不能为空'
        };
      }

      // Read AI config from settings (same logic as ContentGenerator)
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      const activeEngine = engines.length > 0
        // 已分析但保留：settings.aiEngines 类型未声明，TS 无法推断 .find 回调参数；保留 (e: any)
        ? (engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0])
        : null;

      const configModel = activeEngine?.model_name || request.modelConfig?.model;
      const configTemperature = activeEngine?.temperature ?? request.modelConfig?.temperature;
      const configMaxTokens = activeEngine?.max_tokens ?? request.modelConfig?.maxTokens;

      if (!configModel) {
        return {
          success: false,
          error: 'AI 配置未找到模型名称，请先在设置中配置 AI 服务'
        };
      }

      if (configTemperature === undefined || configTemperature === null) {
        return {
          success: false,
          error: 'AI 配置未找到温度参数，请先在设置中配置 AI 服务'
        };
      }

      if (configMaxTokens === undefined || configMaxTokens === null) {
        return {
          success: false,
          error: 'AI 配置未找到 maxTokens 参数，请先在设置中配置 AI 服务'
        };
      }

      const modelConfig = {
        model: configModel,
        temperature: configTemperature,
        maxTokens: configMaxTokens
      };

      const abortController = new AbortController();
      const polishKey = 'polish_description';
      activeAbortControllers.set(polishKey, abortController);

      // Load resources if provided
      let resourceContext = '';
      if (request.resources) {
        const worldBookIds = request.resources.worldBookIds || [];
        const characterCardIds = request.resources.characterCardIds || [];
        const userPersonaIds = request.resources.userPersonaIds || [];

        // Task 4.1: 记录接收到的资源 ID 列表
        addLog(`润色资源 - 世界书: [${worldBookIds.join(', ')}], 角色卡: [${characterCardIds.join(', ')}], 用户人设: [${userPersonaIds.join(', ')}]`, 'debug');

        if (worldBookIds.length > 0 || characterCardIds.length > 0 || userPersonaIds.length > 0) {
          const worldBooks = await writingResourceManager.loadWorldBooks(worldBookIds);
          const characters = await writingResourceManager.loadCharacterCards(characterCardIds);
          const userPersonas = userPersonaIds.length > 0
            ? await writingResourceManager.loadUserPersonas(userPersonaIds)
            : [];
          resourceContext = writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas);

          // Task 4.1: 记录资源上下文是否为空
          if (!resourceContext || resourceContext.trim().length === 0) {
            addLog('润色资源上下文为空，将仅基于创意描述进行润色', 'warn');
          } else {
            addLog(`润色资源上下文长度: ${resourceContext.length} 字符`, 'debug');
          }
        } else {
          addLog('润色未选择任何资源，将仅基于创意描述进行润色', 'debug');
        }
      } else {
        addLog('润色未提供资源参数，将仅基于创意描述进行润色', 'debug');
      }

      const onStream = (chunk: string) => {
        event.sender.send('writing:polish:chunk', { chunk });
      };

      try {
        const polishedContent = await descriptionPolisher.polishStream(
          {
            description: request.description,
            resourceContext,
            instruction: request.instruction,
            modelConfig
          },
          onStream,
          abortController.signal
        );

        activeAbortControllers.delete(polishKey);

        addLog('===== 写作模式: 创意描述润色成功 =====', 'debug');
        addLog(`润色后长度: ${polishedContent?.length || 0}`, 'debug');

        event.sender.send('writing:polish:complete', { content: polishedContent });

        return {
          success: true,
          content: polishedContent
        };
      } catch (error) {
        activeAbortControllers.delete(polishKey);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        addLog('===== 写作模式: 创意描述润色错误 =====', 'error');
        addLog(`错误信息: ${errorMessage}`, 'error');

        event.sender.send('writing:polish:error', { error: errorMessage });

        return {
          success: false,
          error: errorMessage
        };
      }
    } catch (error) {
      addLog('===== 写作模式: 创意描述润色外部错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}
