/**
 * Session Manager —— 会话管理服务
 *
 * 来源：spec §二 Task 6（会话管理后端）
 * 决策：自研，JSON 文件持久化，复用现有存储模式。
 *
 * 存储结构：
 *  - 会话列表：{userDataPath}/sessions/{characterCardId}/sessions.json
 *  - 消息历史：{userDataPath}/sessions/{characterCardId}/{sessionId}.json
 *
 * 7 个操作（供 IPC handler 调用）：
 *  1. createSession        - 创建新会话
 *  2. listSessions         - 列出当前角色所有会话
 *  3. switchSession        - 切换会话（更新 lastActiveAt）
 *  4. deleteSession        - 删除会话（同时删除消息历史文件）
 *  5. renameSession        - 重命名会话标题
 *  6. saveSessionMessages  - 保存会话消息历史
 *  7. loadSessionMessages  - 加载会话消息历史
 *
 * 设计约束：
 *  - 文件操作容错：读取失败时返回空数组，不抛异常
 *  - 会话 ID 生成：Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
 *  - 默认标题："新对话"
 *  - 遵循现有 IPC 模式（ipcMain.handle + 异步文件操作）
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../logger';
import { getUserDataPath } from '../../utils/appPath';

const logger = createLogger('session-manager');

// ==================== 数据结构 ====================

/** 会话消息（与前端消息结构兼容的通用类型） */
export interface SessionMessage {
  role: string;
  content: string;
  timestamp?: number;
  [key: string]: unknown;
}

/** 会话数据结构 */
export interface ChatSession {
  sessionId: string;
  characterCardId: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

/** 会话列表查询结果 */
export interface SessionListResult {
  success: boolean;
  sessions?: ChatSession[];
  error?: string;
}

/** 会话操作结果（create/delete/rename/switch/saveMessages） */
export interface SessionOperationResult {
  success: boolean;
  session?: ChatSession;
  error?: string;
}

/** 会话消息历史操作结果 */
export interface SessionMessagesResult {
  success: boolean;
  messages?: SessionMessage[];
  error?: string;
}

// ==================== 常量与工具函数 ====================

/** 默认会话标题 */
const DEFAULT_TITLE = '新对话';

/**
 * 生成会话 ID。
 * 格式：Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
 */
function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * 获取角色会话目录路径。
 * {userDataPath}/sessions/{characterCardId}/
 */
function getSessionDir(characterCardId: string): string {
  return path.join(getUserDataPath(), 'sessions', characterCardId);
}

/**
 * 获取会话列表文件路径。
 * {userDataPath}/sessions/{characterCardId}/sessions.json
 */
function getSessionListPath(characterCardId: string): string {
  return path.join(getSessionDir(characterCardId), 'sessions.json');
}

/**
 * 获取会话消息历史文件路径。
 * {userDataPath}/sessions/{characterCardId}/{sessionId}.json
 */
function getSessionMessagesPath(characterCardId: string, sessionId: string): string {
  return path.join(getSessionDir(characterCardId), `${sessionId}.json`);
}

/**
 * 确保目录存在（递归创建，幂等）。
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

/**
 * 读取会话列表文件。
 * 文件不存在或解析失败时返回空数组（容错）。
 */
async function readSessionList(characterCardId: string): Promise<ChatSession[]> {
  try {
    const filePath = getSessionListPath(characterCardId);
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ChatSession[];
  } catch (err) {
    logger.debug('readSessionList: file not found or parse error', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * 写入会话列表文件。
 */
async function writeSessionList(characterCardId: string, sessions: ChatSession[]): Promise<void> {
  const dirPath = getSessionDir(characterCardId);
  await ensureDir(dirPath);
  const filePath = getSessionListPath(characterCardId);
  await fsp.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
}

// ==================== CRUD 操作 ====================

/**
 * 创建新会话。
 *
 * @param characterCardId 角色 ID
 * @param title 会话标题（默认"新对话"）
 * @returns 创建结果（含新会话对象）
 */
export async function createSession(
  characterCardId: string,
  title?: string,
): Promise<SessionOperationResult> {
  try {
    const sessions = await readSessionList(characterCardId);
    const now = Date.now();
    const session: ChatSession = {
      sessionId: generateSessionId(),
      characterCardId,
      title: title || DEFAULT_TITLE,
      createdAt: now,
      lastActiveAt: now,
      messageCount: 0,
    };
    sessions.push(session);
    await writeSessionList(characterCardId, sessions);
    logger.info('Session created', undefined, { sessionId: session.sessionId, characterCardId });
    return { success: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('createSession failed', msg);
    return { success: false, error: msg };
  }
}

/**
 * 列出当前角色所有会话（按最后活跃时间降序）。
 *
 * @param characterCardId 角色 ID
 * @returns 会话列表
 */
export async function listSessions(characterCardId: string): Promise<SessionListResult> {
  try {
    const sessions = await readSessionList(characterCardId);
    // 按 lastActiveAt 降序排序
    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return { success: true, sessions };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('listSessions failed', msg);
    return { success: false, sessions: [], error: msg };
  }
}

/**
 * 切换会话（更新 lastActiveAt）。
 *
 * @param characterCardId 角色 ID
 * @param sessionId 目标会话 ID
 * @returns 切换结果（含更新后的会话对象）
 */
export async function switchSession(
  characterCardId: string,
  sessionId: string,
): Promise<SessionOperationResult> {
  try {
    const sessions = await readSessionList(characterCardId);
    const session = sessions.find(s => s.sessionId === sessionId);
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    session.lastActiveAt = Date.now();
    await writeSessionList(characterCardId, sessions);
    logger.info('Session switched', undefined, { sessionId, characterCardId });
    return { success: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('switchSession failed', msg);
    return { success: false, error: msg };
  }
}

/**
 * 删除会话（同时删除消息历史文件）。
 *
 * @param characterCardId 角色 ID
 * @param sessionId 会话 ID
 * @returns 删除结果
 */
export async function deleteSession(
  characterCardId: string,
  sessionId: string,
): Promise<SessionOperationResult> {
  try {
    const sessions = await readSessionList(characterCardId);
    const index = sessions.findIndex(s => s.sessionId === sessionId);
    if (index === -1) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    const session = sessions[index];
    sessions.splice(index, 1);
    await writeSessionList(characterCardId, sessions);

    // 删除消息历史文件（容错：文件不存在时忽略）
    try {
      const messagesPath = getSessionMessagesPath(characterCardId, sessionId);
      await fsp.unlink(messagesPath);
    } catch {
      // 消息文件不存在，忽略
    }

    logger.info('Session deleted', undefined, { sessionId, characterCardId });
    return { success: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('deleteSession failed', msg);
    return { success: false, error: msg };
  }
}

/**
 * 重命名会话标题。
 *
 * @param characterCardId 角色 ID
 * @param sessionId 会话 ID
 * @param newTitle 新标题
 * @returns 重命名结果
 */
export async function renameSession(
  characterCardId: string,
  sessionId: string,
  newTitle: string,
): Promise<SessionOperationResult> {
  try {
    const sessions = await readSessionList(characterCardId);
    const session = sessions.find(s => s.sessionId === sessionId);
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    session.title = newTitle;
    session.lastActiveAt = Date.now();
    await writeSessionList(characterCardId, sessions);
    logger.info('Session renamed', undefined, { sessionId, newTitle });
    return { success: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('renameSession failed', msg);
    return { success: false, error: msg };
  }
}

// ==================== 消息历史管理 ====================

/**
 * 保存会话消息历史。
 * 同时更新会话列表中的 messageCount 和 lastActiveAt。
 *
 * @param characterCardId 角色 ID
 * @param sessionId 会话 ID
 * @param messages 消息数组
 * @returns 保存结果
 */
export async function saveSessionMessages(
  characterCardId: string,
  sessionId: string,
  messages: SessionMessage[],
): Promise<SessionOperationResult> {
  try {
    // 确保目录存在
    const dirPath = getSessionDir(characterCardId);
    await ensureDir(dirPath);

    // 写入消息历史文件
    const messagesPath = getSessionMessagesPath(characterCardId, sessionId);
    await fsp.writeFile(messagesPath, JSON.stringify(messages, null, 2), 'utf-8');

    // 更新会话列表中的 messageCount 和 lastActiveAt
    const sessions = await readSessionList(characterCardId);
    const session = sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.messageCount = messages.length;
      session.lastActiveAt = Date.now();
      await writeSessionList(characterCardId, sessions);
    }

    logger.info('Session messages saved', undefined, { sessionId, messageCount: messages.length });
    return { success: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('saveSessionMessages failed', msg);
    return { success: false, error: msg };
  }
}

/**
 * 加载会话消息历史。
 * 文件不存在或解析失败时返回空数组（容错）。
 *
 * @param characterCardId 角色 ID
 * @param sessionId 会话 ID
 * @returns 消息数组
 */
export async function loadSessionMessages(
  characterCardId: string,
  sessionId: string,
): Promise<SessionMessagesResult> {
  try {
    const messagesPath = getSessionMessagesPath(characterCardId, sessionId);
    const raw = await fsp.readFile(messagesPath, 'utf-8');
    const messages = JSON.parse(raw) as SessionMessage[];
    logger.info('Session messages loaded', undefined, { sessionId, messageCount: messages.length });
    return { success: true, messages };
  } catch (err) {
    // 文件不存在或解析失败，返回空数组（容错）
    logger.debug('loadSessionMessages: file not found or parse error', err instanceof Error ? err.message : String(err));
    return { success: true, messages: [] };
  }
}
