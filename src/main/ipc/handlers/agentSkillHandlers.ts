/**
 * Agent 技能库 IPC 处理器（Spec: add-agent-skill-and-memory-foundation / Task 12.1）
 *
 * 暴露 skillService 给前端，让前端能管理 Agent 技能库（CRUD / 调用 / 发现 / 版本管理 / 导入导出）。
 *
 * 通道列表（全部 ipcMain.handle，前缀统一为 agent-skill:）：
 *   - agent-skill:list      列出技能（可按 category / enabledOnly 过滤）
 *   - agent-skill:get       获取单个技能 manifest
 *   - agent-skill:create    创建技能（registerSkill 支持新建语义）
 *   - agent-skill:update    更新技能（registerSkill 内部处理更新语义：先 unregister 再 register）
 *   - agent-skill:delete    注销技能（unregisterSkill，版本历史保留）
 *   - agent-skill:invoke    调用技能（委托 skillExecutor）
 *   - agent-skill:discover  发现技能（按 query 模糊匹配 name/description/tags）
 *   - agent-skill:history    获取技能版本历史
 *   - agent-skill:rollback  回滚技能到指定版本
 *   - agent-skill:import    从 JSON 字符串导入技能
 *   - agent-skill:export    导出技能为 JSON 字符串
 *
 * 命名空间隔离设计（关键）：
 *   为避免与现有 memory:* 旧聊天/表格记忆系统产生任何冲突，本模块使用独立的
 *   `agent-skill:` 通道前缀和 `agentSkill` preload 命名空间，与旧系统物理隔离。
 *
 * 错误兜底（参照 agentHandlers.ts 风格）：
 *   每个 handler try-catch 包裹，异常时返回 { success: false, error } 结构化错误，
 *   保证渲染进程永不收到 reject。
 *
 * 初始化策略：
 *   register 入口调用 skillService.initialize()（幂等，多次调用安全）。
 */
import { ipcMain } from 'electron';
import { skillService } from '../../services/ai/agent/skill/skillService';
import type {
  SkillCategory,
  SkillManifest,
} from '../../services/ai/agent/skill/skillTypes';
import type { AgentToolContext } from '../../services/ai/agent/agentTypes';
import { createLogger } from '../../services/logger';

const logger = createLogger('agent-skill-handler');

/**
 * 注册 Agent 技能库 IPC 处理器
 *
 * 由 ipc/index.ts 的 setupIpcHandlers() 调用。
 */
export function registerAgentSkillHandlers(): void {
  // 初始化技能库（幂等：内部通过 initialized 标志保证仅加载一次）
  skillService.initialize().catch((err) => {
    logger.error(
      'skillService 初始化失败（agent-skill 通道仍可注册，但首次调用可能为空）',
      err instanceof Error ? err.message : String(err)
    );
  });

  // 通道 1: agent-skill:list
  // 列出技能，可按 category / enabledOnly 过滤
  ipcMain.handle(
    'agent-skill:list',
    async (
      _event,
      params: { category?: SkillCategory; enabledOnly?: boolean }
    ) => {
      try {
        const { category, enabledOnly } = params || {};
        const skills = skillService.listSkills(category, enabledOnly);
        return { success: true, data: skills };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:list 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  // 通道 2: agent-skill:get
  // 获取单个技能 manifest；不存在时 data=undefined
  ipcMain.handle('agent-skill:get', async (_event, params: { id: string }) => {
    try {
      const { id } = params || {};
      const manifest = skillService.getSkill(id);
      return { success: true, data: manifest };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('agent-skill:get 异常', errMsg);
      return { success: false, error: errMsg, data: undefined };
    }
  });

  // 通道 3: agent-skill:create
  // 创建技能（registerSkill 支持新建语义）
  ipcMain.handle(
    'agent-skill:create',
    async (_event, params: { manifest: SkillManifest }) => {
      try {
        const { manifest } = params || {};
        await skillService.registerSkill(manifest);
        return { success: true };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:create 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 4: agent-skill:update
  // 更新技能（registerSkill 内部处理更新语义：id 已存在则先 unregister 再 register）
  ipcMain.handle(
    'agent-skill:update',
    async (_event, params: { manifest: SkillManifest }) => {
      try {
        const { manifest } = params || {};
        await skillService.registerSkill(manifest);
        return { success: true };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:update 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 5: agent-skill:delete
  // 注销技能（unregisterSkill，版本历史保留）
  ipcMain.handle('agent-skill:delete', async (_event, params: { id: string }) => {
    try {
      const { id } = params || {};
      await skillService.unregisterSkill(id);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('agent-skill:delete 异常', errMsg);
      return { success: false, error: errMsg };
    }
  });

  // 通道 6: agent-skill:invoke
  // 调用技能（委托 skillExecutor 按 type 分发执行）
  ipcMain.handle(
    'agent-skill:invoke',
    async (
      _event,
      params: {
        id: string;
        input: Record<string, any>;
        context?: AgentToolContext;
      }
    ) => {
      try {
        const { id, input, context } = params || {};
        const result = await skillService.invokeSkill(id, input, context);
        return result; // SkillResult 已含 { success, data?, error?, trace? }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:invoke 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 7: agent-skill:discover
  // 发现技能（按 query 模糊匹配 name/description/tags，返回 SkillSummary 列表）
  ipcMain.handle(
    'agent-skill:discover',
    async (_event, params: { query: string; category?: SkillCategory }) => {
      try {
        const { query, category } = params || {};
        const summaries = skillService.discoverSkills(query, category);
        return { success: true, data: summaries };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:discover 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  // 通道 8: agent-skill:history
  // 获取技能版本历史（按 createdAt 降序，最新在前）
  ipcMain.handle(
    'agent-skill:history',
    async (_event, params: { id: string }) => {
      try {
        const { id } = params || {};
        const history = await skillService.getSkillHistory(id);
        return { success: true, data: history };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:history 异常', errMsg);
        return { success: false, error: errMsg, data: [] };
      }
    }
  );

  // 通道 9: agent-skill:rollback
  // 回滚技能到指定版本（重新注册该版本 manifest，会生成新版本条目）
  ipcMain.handle(
    'agent-skill:rollback',
    async (_event, params: { id: string; version: string }) => {
      try {
        const { id, version } = params || {};
        await skillService.rollbackSkill(id, version);
        return { success: true };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:rollback 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 10: agent-skill:import
  // 从 JSON 字符串导入技能（解析后调用 registerSkill，支持新建与覆盖更新）
  ipcMain.handle(
    'agent-skill:import',
    async (_event, params: { json: string }) => {
      try {
        const { json } = params || {};
        await skillService.importSkill(json);
        return { success: true };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:import 异常', errMsg);
        return { success: false, error: errMsg };
      }
    }
  );

  // 通道 11: agent-skill:export
  // 导出技能为 JSON 字符串（美化格式）
  ipcMain.handle(
    'agent-skill:export',
    async (_event, params: { id: string }) => {
      try {
        const { id } = params || {};
        const json = await skillService.exportSkill(id);
        return { success: true, data: json };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error('agent-skill:export 异常', errMsg);
        return { success: false, error: errMsg, data: '' };
      }
    }
  );

  logger.info('Agent 技能库 handlers 注册完成');
}
