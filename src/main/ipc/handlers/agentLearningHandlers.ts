/**
 * Agent 自我学习 IPC 处理器（Spec: add-agent-skill-and-memory-foundation / Task 12.3）
 *
 * 暴露 agentLearningService 给前端，让前端能触发记忆整合、决策优化、反馈与模式提取。
 *
 * 通道列表（全部 ipcMain.handle，前缀统一为 agent-learning:）：
 *   - agent-learning:consolidate       触发记忆整合（episodic → semantic/procedural）
 *   - agent-learning:optimize          决策优化（检索相关记忆 + 建议技能 + 置信度）
 *   - agent-learning:feedback          应用用户反馈（调整置信度 / 创建纠正 / 删除）
 *   - agent-learning:extractPatterns   提取模式（触发整合 + 返回语义记忆）
 *
 * 命名空间隔离设计（关键）：
 *   为避免与现有 memory:* 旧聊天/表格记忆系统产生任何冲突，本模块使用独立的
 *   `agent-learning:` 通道前缀和 `agentLearning` preload 命名空间，与旧系统物理隔离。
 *
 * 错误兜底（参照 agentHandlers.ts 风格）：
 *   每个 handler try-catch 包裹，异常时返回 { success: false, error } 结构化错误，
 *   保证渲染进程永不收到 reject。
 *
 * 初始化策略：
 *   agentLearningService 内部已通过 memoryService 间接初始化（依赖注入），
 *   不在此处显式调用 initialize。
 */
import { ipcMain } from 'electron';
import { agentLearningService } from '../../services/ai/agent/memory/agentLearningService';
import type {
  MemoryFeedback,
} from '../../services/ai/agent/memory/memoryTypes';
import type {
  AgentToolContext,
} from '../../services/ai/agent/agentTypes';
import { createLogger } from '../../services/logger';

const logger = createLogger('agent-learning-handler');

/**
 * 注册 Agent 自我学习 IPC 处理器
 *
 * 由 ipc/index.ts 的 setupIpcHandlers() 调用。
 */
export function registerAgentLearningHandlers(): void {
  // 通道 1: agent-learning:consolidate
  // 触发记忆整合：将 episodic 记忆按 taskType 分组，沉淀出 semantic/procedural 记忆
  ipcMain.handle('agent-learning:consolidate', async () => {
    try {
      const stats = await agentLearningService.consolidate();
      return { success: true, data: stats };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('agent-learning:consolidate 异常', errMsg);
      return { success: false, error: errMsg };
    }
  });

  // 通道 2: agent-learning:optimize
  // 决策优化：在 Agent 决策前检索相关记忆 + 建议技能 + 计算置信度
  ipcMain.handle(
    'agent-learning:optimize',
    async (
      _event,
      params: {
        taskType: string;
        taskDescription: string;
        context?: AgentToolContext;
      }
    ) => {
      try {
        const { taskType, taskDescription, context } = params || {};
        const optimization = await agentLearningService.optimizeDecision(
          taskType,
          taskDescription,
          context
        );
        return { success: true, data: optimization };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-learning:optimize 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 3: agent-learning:feedback
  // 应用用户反馈：correct=true 加分；correct=false 且有 correction 创建纠正；否则删除
  ipcMain.handle(
    'agent-learning:feedback',
    async (
      _event,
      params: { memoryId: string; feedback: MemoryFeedback }
    ) => {
      try {
        const { memoryId, feedback } = params || {};
        await agentLearningService.applyFeedback(memoryId, feedback);
        return { success: true };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-learning:feedback 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 4: agent-learning:extractPatterns
  // 提取模式：触发整合 + 返回（可选过滤 taskType 的）语义记忆
  ipcMain.handle(
    'agent-learning:extractPatterns',
    async (_event, params: { taskType?: string }) => {
      try {
        const { taskType } = params || {};
        const patterns = await agentLearningService.extractPatterns(taskType);
        return { success: true, data: patterns };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-learning:extractPatterns 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  logger.info('Agent 自我学习 handlers 注册完成');
}
