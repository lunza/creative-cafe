/**
 * 关联关系与整理进度仓储
 * 负责：
 * - 模板关联关系（associateTemplate/saveAssociation/getAssociatedTemplate/migrateAssociations/resolveAvailableTemplate）
 * - 整理进度（getOrganizingProgress/saveOrganizingProgress/clearOrganizingProgress）
 * - 会话处理状态（setSessionProcessedStatus/getSessionProcessedStatus）
 * - 清理表格数据（clearTableData）
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import {
  addLog,
  getSafeChatId,
  AssociationRecord,
  ChatLogContext,
} from './logger';

/**
 * 保存关联关系
 */
export function saveAssociation(ctx: ChatLogContext, chatId: string, templateId: string): void {
  const associationsPath = path.join(ctx.chatsDir, 'associations.json');

  if (!fs.existsSync(ctx.chatsDir)) {
    fs.mkdirSync(ctx.chatsDir, { recursive: true });
  }

  let associations: Record<string, AssociationRecord> = {};

  if (fs.existsSync(associationsPath)) {
    try {
      const content = fs.readFileSync(associationsPath, 'utf-8');
      const rawData = JSON.parse(content);
      associations = migrateAssociations(rawData);
    } catch (error) {
      console.error('读取关联关系失败:', error);
      associations = {};
    }
  }

  const existing = associations[chatId];
  associations[chatId] = {
    templateId,
    processedCount: existing?.processedCount || 0,
    totalMessages: existing?.totalMessages || 0,
    lastProcessedAt: existing?.lastProcessedAt
  };

  fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
}

export function migrateAssociations(rawData: Record<string, unknown>): Record<string, AssociationRecord> {
  const result: Record<string, AssociationRecord> = {};
  for (const [chatId, value] of Object.entries(rawData)) {
    if (typeof value === 'string') {
      result[chatId] = { templateId: value, processedCount: 0, totalMessages: 0 };
    } else if (typeof value === 'object' && value !== null) {
      result[chatId] = value as AssociationRecord;
    }
  }
  return result;
}

/**
 * 关联模板到聊天会话
 */
export function associateTemplate(ctx: ChatLogContext, chatId: string, templateId: string): void {
  addLog(`关联模板 ${templateId} 到聊天会话 ${chatId}`, 'info');

  try {
    // 1. 读取原始模板
    const originalTemplate = tableTemplateService.getTemplate(templateId);
    if (!originalTemplate) {
      throw new Error(`模板 ${templateId} 不存在`);
    }

    // 2. 创建模板副本
    // 移除 chatId 中的路径分隔符和特殊字符，避免文件路径错误
    const safeChatId = getSafeChatId(chatId);

    const templateCopy = {
      ...originalTemplate,
      id: `${templateId}_${safeChatId}_${Date.now()}`,
      name: `${originalTemplate.name} - ${safeChatId}`,
      isCopy: true,
      originalTemplateId: templateId,
      chatId: chatId
    };

    // 3. 保存模板副本
    tableTemplateService.saveTemplate(templateCopy);
    addLog(`模板副本创建成功: ${templateCopy.id}`, 'info');

    // 4. 创建表格文件（JSON格式）
    const jsonPath = tableTemplateService.createTableFile(chatId, templateCopy.id, safeChatId);
    addLog(`表格文件创建成功: ${jsonPath}`, 'info');

    // 5. 存储关联关系
    saveAssociation(ctx, chatId, templateCopy.id);
    addLog(`关联关系存储成功: ${chatId} -> ${templateCopy.id}`, 'info');

  } catch (error) {
    console.error('关联模板失败:', error);
    throw error;
  }
}

/**
 * 尝试获取可用的模板ID（优先使用关联模板，若副本不存在则回退到原始模板）
 */
export function resolveAvailableTemplate(ctx: ChatLogContext, chatId: string): string | null {
  const associatedTemplateId = getAssociatedTemplate(ctx, chatId);
  if (!associatedTemplateId) {
    const allTemplates = tableTemplateService.getAllTemplates();
    if (allTemplates && allTemplates.length > 0) {
      return allTemplates[0].id;
    }
    return null;
  }

  const template = tableTemplateService.getTemplate(associatedTemplateId);
  if (template) {
    return associatedTemplateId;
  }

  addLog(`[resolveAvailableTemplate] 关联的副本模板不存在: ${associatedTemplateId}，尝试回退`, 'info');

  const allTemplates = tableTemplateService.getAllTemplates();
  if (allTemplates && allTemplates.length > 0) {
    const nonCopyTemplate = allTemplates.find(t => !(t as { id: string; isCopy?: boolean }).isCopy);
    if (nonCopyTemplate) {
      addLog(`[resolveAvailableTemplate] 回退使用原始模板: ${nonCopyTemplate.id}`, 'info');
      return nonCopyTemplate.id;
    }
    addLog(`[resolveAvailableTemplate] 无原始模板，使用第一个可用模板: ${allTemplates[0].id}`, 'info');
    return allTemplates[0].id;
  }

  return null;
}

/**
 * 获取聊天会话关联的模板
 */
export function getAssociatedTemplate(ctx: ChatLogContext, chatId: string): string | null {
  const associationsPath = path.join(ctx.chatsDir, 'associations.json');

  if (fs.existsSync(associationsPath)) {
    try {
      const content = fs.readFileSync(associationsPath, 'utf-8');
      const rawData = JSON.parse(content);
      const associations = migrateAssociations(rawData);
      return associations[chatId]?.templateId || null;
    } catch (error) {
      console.error('读取关联关系失败:', error);
    }
  }

  return null;
}

export function clearOrganizingProgress(ctx: ChatLogContext, chatId: string): void {
  const associationsPath = path.join(ctx.chatsDir, 'associations.json');

  if (!fs.existsSync(associationsPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(associationsPath, 'utf-8');
    const rawData = JSON.parse(content);
    const associations = migrateAssociations(rawData);

    if (associations[chatId]) {
      associations[chatId].processedCount = 0;
      associations[chatId].totalMessages = 0;
      associations[chatId].lastProcessedAt = undefined;
      fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
      addLog(`已清除聊天记录 ${chatId} 的整理进度`, 'info');
    }
  } catch (error) {
    console.error('清除整理进度失败:', error);
  }
}

/**
 * 清理已整理的表格数据（仅删除 chatlog 目录下的表格JSON文件，不影响原始聊天记录）
 */
export function clearTableData(ctx: ChatLogContext, chatId: string): void {
  const safeChatId = getSafeChatId(chatId);

  // 仅删除 chatlog 目录下的表格数据文件（原始聊天记录在 chats/ 目录，不会被删除）
  const tableFilePath = path.join(ctx.chatlogDir, `${safeChatId}.json`);
  if (fs.existsSync(tableFilePath)) {
    fs.unlinkSync(tableFilePath);
    addLog(`已删除表格数据文件: ${tableFilePath}`, 'info');
  } else {
    addLog(`表格数据文件不存在: ${tableFilePath}`, 'debug');
  }

  // 重置关联进度（associations.json 在 chats/ 目录下）
  clearOrganizingProgress(ctx, chatId);

  // 重置处理状态
  setSessionProcessedStatus(ctx, chatId, false);

  addLog(`已清理聊天记录 ${chatId} 的表格数据和进度`, 'info');
}

export function getOrganizingProgress(ctx: ChatLogContext, chatId: string): { processedCount: number; totalMessages: number; lastProcessedAt?: string } | null {
  const associationsPath = path.join(ctx.chatsDir, 'associations.json');

  if (fs.existsSync(associationsPath)) {
    try {
      const content = fs.readFileSync(associationsPath, 'utf-8');
      const rawData = JSON.parse(content);
      const associations = migrateAssociations(rawData);
      const record = associations[chatId];
      if (record) {
        return {
          processedCount: record.processedCount,
          totalMessages: record.totalMessages,
          lastProcessedAt: record.lastProcessedAt
        };
      }
    } catch (error) {
      console.error('读取整理进度失败:', error);
    }
  }

  return null;
}

export function saveOrganizingProgress(ctx: ChatLogContext, chatId: string, processedCount: number, totalMessages: number): void {
  const associationsPath = path.join(ctx.chatsDir, 'associations.json');

  if (!fs.existsSync(ctx.chatsDir)) {
    fs.mkdirSync(ctx.chatsDir, { recursive: true });
  }

  let associations: Record<string, AssociationRecord> = {};

  if (fs.existsSync(associationsPath)) {
    try {
      const content = fs.readFileSync(associationsPath, 'utf-8');
      const rawData = JSON.parse(content);
      associations = migrateAssociations(rawData);
    } catch (error) {
      console.error('读取关联关系失败:', error);
      associations = {};
    }
  }

  if (associations[chatId]) {
    associations[chatId].processedCount = processedCount;
    associations[chatId].totalMessages = totalMessages;
    associations[chatId].lastProcessedAt = new Date().toISOString();
    fs.writeFileSync(associationsPath, JSON.stringify(associations, null, 2));
  }
}

// ---------- 会话处理状态（per-chatId 单独文件，避免 TOCTOU 竞态） ----------

/**
 * 单个 chatId 的处理状态文件数据结构。
 * 每个文件只记录一个 chatId 的状态，因此更新该 chatId 状态时无需读取/合并其他 chatId 数据，
 * 多 chatId 并发整理互不影响。
 */
interface SessionStatusFile {
  processed: boolean;
  timestamp: number;
}

/**
 * 单个 chatId 处理状态文件所在目录（chatlogDir 子目录）。
 * 使用独立子目录 `processed_sessions/` 避免与 `<safeChatId>.json` 表格文件命名空间冲突。
 */
function getSessionStatusDir(ctx: ChatLogContext): string {
  return path.join(ctx.chatlogDir, 'processed_sessions');
}

/**
 * 单个 chatId 的处理状态文件路径。
 * 使用 getSafeChatId 规避路径分隔符与文件名非法字符。
 */
function getSessionStatusFilePath(ctx: ChatLogContext, chatId: string): string {
  const safeChatId = getSafeChatId(chatId);
  return path.join(getSessionStatusDir(ctx), `${safeChatId}.json`);
}

/**
 * 旧版聚合状态文件路径（迁移期兼容读取）。
 */
function getLegacySessionStatusFilePath(ctx: ChatLogContext): string {
  return path.join(ctx.chatlogDir, 'processed_sessions.json');
}

/**
 * 获取会话是否已处理的状态。
 *
 * 读取顺序：
 *   1. 优先读取新格式 `processed_sessions/<safeChatId>.json`（每 chatId 单独文件）
 *   2. 若不存在，回退到旧版 `processed_sessions.json`（聚合 map）兼容迁移期数据
 *
 * 这种"读穿透"方式无需一次性迁移脚本，且每次写入即隐式完成该 chatId 的迁移。
 */
export function getSessionProcessedStatus(ctx: ChatLogContext, chatId: string): boolean {
  // 1. 优先读取新格式（每 chatId 单独文件）
  const statusFilePath = getSessionStatusFilePath(ctx, chatId);
  try {
    if (fs.existsSync(statusFilePath)) {
      const content = fs.readFileSync(statusFilePath, 'utf-8');
      const data = JSON.parse(content) as Partial<SessionStatusFile>;
      return data?.processed === true;
    }
  } catch (error) {
    console.error('读取会话处理状态失败（新格式）:', error);
  }

  // 2. 回退到旧版聚合文件（迁移期兼容）
  const legacyPath = getLegacySessionStatusFilePath(ctx);
  try {
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const statuses = JSON.parse(content) as Record<string, boolean>;
      return statuses[chatId] === true;
    }
  } catch (error) {
    console.error('读取会话处理状态失败（旧格式）:', error);
  }

  return false;
}

/**
 * 设置会话是否已处理的状态。
 *
 * 写入策略：始终只写 `processed_sessions/<safeChatId>.json`（仅覆盖该 chatId 的状态）。
 *
 * 并发安全分析：
 *   - 每个 chatId 的状态文件只被该 chatId 的整理任务读写，不同 chatId 之间无共享状态；
 *   - 单次写入为整体覆盖（非"读-改-写"），即使同一 chatId 的多个并发任务也无 TOCTOU 风险
 *     （最后写入者获胜，且结果都是同一 chatId 的最终状态）；
 *   - 消除了原聚合文件方案中"读 A→改 B→写 C"导致多 chatId 互相覆盖丢失更新的问题。
 */
export function setSessionProcessedStatus(ctx: ChatLogContext, chatId: string, isProcessed: boolean): void {
  const statusFilePath = getSessionStatusFilePath(ctx, chatId);
  const statusDir = getSessionStatusDir(ctx);

  try {
    // 确保目录存在（recursive 保证 chatlogDir + processed_sessions/ 两级都可创建）
    if (!fs.existsSync(statusDir)) {
      fs.mkdirSync(statusDir, { recursive: true });
    }

    // 整体覆盖写入该 chatId 的状态文件，避免读取/合并其他 chatId 数据
    const data: SessionStatusFile = {
      processed: isProcessed,
      timestamp: Date.now(),
    };
    fs.writeFileSync(statusFilePath, JSON.stringify(data, null, 2), 'utf-8');
    addLog(`会话 ${chatId} 的处理状态已设置为: ${isProcessed}`, 'debug');
  } catch (error) {
    console.error('设置会话处理状态失败:', error);
  }
}
