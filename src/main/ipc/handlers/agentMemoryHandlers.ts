/**
 * Agent 长期记忆 IPC 处理器（Spec: add-agent-skill-and-memory-foundation / Task 12.2）
 *
 * 暴露 memoryService 给前端，让前端能记录与检索 Agent 长期记忆。
 *
 * 通道列表（全部 ipcMain.handle，前缀统一为 agent-memory:）：
 *   - agent-memory:search       语义检索记忆（向量相似度，可按 type 过滤）
 *   - agent-memory:query        非向量查询（按 type/tags/taskType 等元数据过滤）
 *   - agent-memory:record       记录一条记忆（按 type 分发到 episodic/semantic/procedural）
 *   - agent-memory:delete       删除一条记忆
 *   - agent-memory:getRelevant  RAG 入口（根据上下文 + 任务描述召回相关记忆）
 *
 * 命名空间隔离设计（关键）：
 *   为避免与现有 memory:* 旧聊天/表格记忆系统产生任何冲突，本模块使用独立的
 *   `agent-memory:` 通道前缀和 `agentMemory` preload 命名空间，与旧系统物理隔离。
 *   注意：memoryService.searchMemories 内部已路由到 source='agent-memory' 的 backend，
 *   不会与旧 chatVector / chatHistory 等向量源混淆。
 *
 * 错误兜底（参照 agentHandlers.ts 风格）：
 *   每个 handler try-catch 包裹，异常时返回 { success: false, error } 结构化错误，
 *   保证渲染进程永不收到 reject。
 *
 * 初始化策略：
 *   register 入口调用 memoryService.initialize()（幂等，多次调用安全）。
 *
 * record 通道分发逻辑：
 *   - episodic：从 metadata 构造 LearningEvent，调用 recordEpisodicMemory
 *   - semantic：调用 recordSemanticMemory(content, metadata.pattern||'general', metadata.derivedFrom)
 *   - procedural：调用 recordProceduralMemory(metadata.skillId||'unknown', content)
 */
import { ipcMain } from 'electron';
import { memoryService } from '../../services/ai/agent/memory/memoryService';
import type {
  MemoryQueryFilter,
  MemoryType,
} from '../../services/ai/agent/memory/memoryTypes';
import type {
  AgentToolContext,
} from '../../services/ai/agent/agentTypes';
import { createLogger } from '../../services/logger';

const logger = createLogger('agent-memory-handler');

/**
 * 注册 Agent 长期记忆 IPC 处理器
 *
 * 由 ipc/index.ts 的 setupIpcHandlers() 调用。
 */
export function registerAgentMemoryHandlers(): void {
  // 初始化记忆服务（幂等：内部通过 initialized 标志保证仅加载一次）
  memoryService.initialize().catch((err) => {
    logger.error(
      'memoryService 初始化失败（agent-memory 通道仍可注册，但首次调用可能为空）',
      err instanceof Error ? err.message : String(err)
    );
  });

  // 通道 1: agent-memory:search
  // 语义检索：基于向量相似度召回，可在结果上按 type 过滤
  ipcMain.handle(
    'agent-memory:search',
    async (
      _event,
      params: { query: string; type?: MemoryType; topK?: number }
    ) => {
      try {
        const { query, type, topK } = params || {};
        const results = await memoryService.searchMemories(query, type, topK);
        return { success: true, data: results };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-memory:search 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  // 通道 2: agent-memory:query
  // 非向量查询：在内存索引上按 metadata 字段过滤
  ipcMain.handle(
    'agent-memory:query',
    async (_event, params: { filter: MemoryQueryFilter }) => {
      try {
        const { filter } = params || {};
        const results = await memoryService.queryMemories(filter);
        return { success: true, data: results };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-memory:query 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  // 通道 3: agent-memory:record
  // 记录一条记忆，按 type 分发到对应的 record 方法
  ipcMain.handle(
    'agent-memory:record',
    async (
      _event,
      params: {
        content: string;
        type: MemoryType;
        metadata?: Record<string, any>;
      }
    ) => {
      try {
        const { content, type, metadata } = params || {};
        let memory;

        if (type === 'episodic') {
          // episodic：从 metadata 构造 LearningEvent 后调用 recordEpisodicMemory
          // 必填字段缺失时使用合理默认值（保证类型合法）
          const event = {
            sessionId: metadata?.sessionId,
            taskType: metadata?.taskType ?? 'unknown',
            taskDescription: metadata?.taskDescription,
            toolCalls: metadata?.toolCalls ?? [],
            outcome: metadata?.outcome ?? 'success',
            finalContentLength: metadata?.finalContentLength,
            context: metadata?.context as AgentToolContext | undefined,
            timestamp: metadata?.timestamp ?? Date.now(),
          };
          memory = await memoryService.recordEpisodicMemory(event);
        } else if (type === 'semantic') {
          // semantic：pattern 默认 'general'，derivedFrom 可选
          memory = await memoryService.recordSemanticMemory(
            content,
            metadata?.pattern || 'general',
            metadata?.derivedFrom
          );
        } else if (type === 'procedural') {
          // procedural：skillId 默认 'unknown'
          memory = await memoryService.recordProceduralMemory(
            metadata?.skillId || 'unknown',
            content
          );
        } else {
          return {
            success: false,
            error: `未知的记忆类型: ${type}（支持 episodic / semantic / procedural）`,
          };
        }

        return { success: true, data: memory };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-memory:record 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 4: agent-memory:delete
  // 删除一条记忆（从索引移除 + 删除向量）
  ipcMain.handle('agent-memory:delete', async (_event, params: { id: string }) => {
    try {
      const { id } = params || {};
      await memoryService.deleteMemory(id);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('agent-memory:delete 异常', errMsg);
      return { success: false, error: errMsg };
    }
  });

  // 通道 5: agent-memory:getRelevant
  // RAG 入口：根据上下文 + 任务描述召回相关记忆（拼接查询后走 searchMemories）
  ipcMain.handle(
    'agent-memory:getRelevant',
    async (
      _event,
      params: {
        context: AgentToolContext;
        taskDescription: string;
        topK?: number;
      }
    ) => {
      try {
        const { context, taskDescription, topK } = params || {};
        const results = await memoryService.getRelevantMemories(
          context,
          taskDescription,
          topK
        );
        return { success: true, data: results };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-memory:getRelevant 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  logger.info('Agent 长期记忆 handlers 注册完成');
}
