/**
 * 工具调用智能体引擎 IPC 处理器（方向 0 最后一层）
 *
 * 暴露工具调用智能体引擎给前端，让前端能调用智能体并订阅工具调用事件。
 *
 * 通道列表：
 *   - ai:runAgentTurn（ipcMain.handle）  运行一轮智能体循环，返回 AgentLoopResult
 *   - ai:agentToolCall（事件推送）       在 onToolCall 回调里通过 event.sender.send 推送
 *                                       给前端，前端用 ipcRenderer.on 订阅
 *
 * 注册模式参照 registerCharacterTraitAIHandlers() / registerLoraHandlers()：
 * 导出 registerAgentHandlers() 函数，由 ipc/index.ts 调用。
 *
 * 关键约束（增量零影响）：
 * handler 读取全局 enableAgentMode 设置 + 当前引擎 capabilities.supportsToolCalling，
 * 计算 effectiveSupportsToolCalling = enableAgentMode && supportsToolCalling 传入 runAgentLoop。
 * 开关关或模型不支持 → 降级纯文本（agentLoop 内部已处理降级，handler 只需正确传入标志）。
 */
import { ipcMain } from 'electron';
import { runAgentLoop } from '../../services/ai/agent/agentLoop';
import { registerBuiltinTools } from '../../services/ai/agent/tools';
import type {
  AgentLoopParams,
  AgentLoopResult,
  AgentLoopCallbacks,
  AgentToolGroup,
  AgentToolContext,
  ToolCallEvent,
} from '../../services/ai/agent/agentTypes';
import type { ChatMessage } from '../../services/AIService';
import { AIConfigProvider } from '../../services/AIService';
import { getStorageService } from '../../services/storageService';
import { createLogger } from '../../services/logger';

const logger = createLogger('agent-handler');

/**
 * 计算当前是否真正启用工具调用
 *
 * effectiveSupportsToolCalling = enableAgentMode === true && engine.capabilities.supportsToolCalling === true
 * 任一条件不满足则降级为纯文本（agentLoop 内部已处理降级，handler 仅传标志）。
 *
 * 设置读取方式：getStorageService().getSettings().enableAgentMode
 * 引擎能力获取方式：AIConfigProvider.getInstance().getActiveEngine().capabilities.supportsToolCalling
 */
function computeEffectiveSupportsToolCalling(): boolean {
  // 1. 读取全局 enableAgentMode 设置（默认关闭，确保现有功能零影响）
  const settings = getStorageService().getSettings();
  const enableAgentMode = settings?.enableAgentMode === true;
  if (!enableAgentMode) {
    return false;
  }

  // 2. 获取当前激活引擎的 capabilities.supportsToolCalling
  // getActiveEngine() 返回 aiEngines 中匹配 activeEngineId 的引擎（缺失时回退首个）
  const engine = AIConfigProvider.getInstance().getActiveEngine();
  const supportsToolCalling = engine?.capabilities?.supportsToolCalling === true;
  return supportsToolCalling;
}

/**
 * 注册工具调用智能体引擎 IPC 处理器
 *
 * 由 ipc/index.ts 的 setupIpcHandlers() 调用。
 */
export function registerAgentHandlers(): void {
  /**
   * 通道 1: ai:runAgentTurn
   *
   * 运行一轮工具调用智能体循环。
   * - 调用 registerBuiltinTools()（幂等，确保工具已注册）
   * - 计算 effectiveSupportsToolCalling 并传入 runAgentLoop
   * - 通过 callbacks.onToolCall → event.sender.send('ai:agentToolCall', event) 推送工具调用事件
   * - 返回 AgentLoopResult
   *
   * 错误兜底：try-catch 包裹，异常时返回 stoppedReason='error' 的 AgentLoopResult，
   * 保证渲染进程永不收到 reject（与 characterTraitAIHandlers 等一致）。
   */
  ipcMain.handle(
    'ai:runAgentTurn',
    async (
      event,
      params: {
        messages: ChatMessage[];
        toolGroups: AgentToolGroup[];
        context?: AgentToolContext;
        options: {
          model: string;
          temperature: number;
          maxTokens: number;
          maxIterations?: number;
          tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
          streamFinal?: boolean;
        };
      }
    ): Promise<AgentLoopResult> => {
      const { messages, toolGroups, context, options } = params;
      try {
        // 1. 注册内置工具（幂等，仅注册一次）
        registerBuiltinTools();

        // 2. 计算 effectiveSupportsToolCalling（enableAgentMode && supportsToolCalling）
        const effectiveSupportsToolCalling = computeEffectiveSupportsToolCalling();

        logger.info('runAgentTurn 启动', undefined, {
          toolGroups,
          effectiveSupportsToolCalling,
          model: options.model,
          streamFinal: options.streamFinal,
        });

        // 3. 构造回调：onToolCall 通过 IPC 推送给前端
        // 注意：ipcMain.handle 的 event 参数支持 sender.send（与 aiHandlers.ts 的 ai:stream 推送一致）
        const callbacks: AgentLoopCallbacks = {
          onToolCall: (toolCallEvent: ToolCallEvent) => {
            try {
              // renderer 可能已销毁（关闭窗口），send 前检查避免抛错
              if (!event.sender.isDestroyed()) {
                event.sender.send('ai:agentToolCall', toolCallEvent);
              }
            } catch (sendError) {
              logger.warn('推送 agentToolCall 事件失败', undefined, {
                error: sendError instanceof Error ? sendError.message : String(sendError),
                toolName: toolCallEvent.toolName,
              });
            }
          },
        };

        // 4. 构造 AgentLoopParams（supportsToolCalling 由 handler 计算，不由调用方传入）
        const loopParams: AgentLoopParams = {
          messages,
          toolGroups,
          context,
          options: {
            ...options,
            supportsToolCalling: effectiveSupportsToolCalling,
          },
          callbacks,
        };

        // 5. 调用 runAgentLoop 返回结果
        // agentLoop 内部已 try-catch 兜底，但外层再包一层保证 IPC 序列化兜底
        const result = await runAgentLoop(loopParams);
        logger.info('runAgentTurn 完成', undefined, {
          stoppedReason: result.stoppedReason,
          iterations: result.iterations,
          toolCallCount: result.toolCallHistory.length,
        });
        return result;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          'runAgentTurn 异常',
          error instanceof Error ? error.stack || error.message : String(error),
          { error: errMsg }
        );
        return {
          finalContent: '',
          toolCallHistory: [],
          iterations: 0,
          stoppedReason: 'error',
          error: errMsg,
        };
      }
    }
  );

  logger.info('Agent handlers 注册完成');
}
