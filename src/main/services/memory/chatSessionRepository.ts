/**
 * 聊天会话仓储
 * 负责 SillyTavern JSONL 聊天记录的读取、会话列表、消息分页、搜索与筛选。
 * 包括对角色卡聊天记录（.json 格式）的读取、整理流程专用的消息读取与分段。
 *
 * 异步化说明（spec §4.2 P4）：
 *   原实现全部使用 fs.*Sync 同步 API，在主进程读取大型 JSONL 聊天记录时会阻塞事件循环，
 *   导致 IPC 请求排队、UI 卡顿。本模块已全面改为 fs.promises 异步 I/O：
 *   - readFirstNonEmptyLines / countNonEmptyLines 使用 fs.promises.open + filehandle.read
 *   - getChatSessions / getChatSession / getChatMessages / searchChatMessages / filterChatMessages
 *     均返回 Promise，调用方（IPC handler / organizeOrchestrator / chatLogService）已适配 await
 *   - splitChatIntoSegments 为纯逻辑（无 I/O），保持同步
 *   - 会话元数据缓存（mtime+size）保留，命中时跳过 I/O
 */

import fsp from 'fs/promises';
import path from 'path';
import {
  addLog,
  ChatMessage,
  ChatSession,
  SillyTavernMessage,
  SillyTavernChatMetadata,
  ChatLogContext,
} from './logger';
import {
  getAssociatedTemplate,
  getSessionProcessedStatus,
  getOrganizingProgress,
} from './associationRepository';

// ========== 会话元数据缓存（mtime-based）==========
// SubTask 27.1: 以文件 mtime+size 为缓存键，避免每次 getChatSessions 都全量读取所有 JSONL。
// SubTask 27.2: 缓存未命中时仅流式读取前 2 行获取元数据+预览，并流式统计非空行数得到 messageCount，
//               不再将整个文件内容加载为字符串再 split/parse。
//
// 缓存失效策略：
//   - 文件 mtime 或 size 变化 → 视为变更，重读首行/计数并刷新缓存
//   - 文件被删除（existsSync=false）→ 移除对应缓存条目
//   - getChatSessions 扫描结束后，清理"不在本次扫描集合中且文件已不存在"的残留条目

interface SessionBaseMeta {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  preview: string;
  characterName: string;
}

interface CachedSessionEntry {
  mtimeMs: number;
  size: number;
  session: SessionBaseMeta;
}

const sessionMetaCache = new Map<string, CachedSessionEntry>();

/**
 * 流式读取文件前 N 个"非空行"（行为与 `content.split('\n').filter(l => l.trim())` 的前 N 项一致）。
 * 一旦凑够 maxLines 行即停止读取，避免将整个大文件加载到内存。
 *
 * 异步实现（spec §4.2 P4）：使用 fs.promises.open + filehandle.read，避免阻塞事件循环。
 *
 * @param maxBytes 安全字节上限，防止极端情况下读到超大单行时无限读取。
 */
async function readFirstNonEmptyLines(filePath: string, maxLines: number, maxBytes: number = 1024 * 1024): Promise<string[]> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const result: string[] = [];
    let pending = '';
    const chunk = Buffer.alloc(8192);
    let totalRead = 0;

    while (totalRead < maxBytes && result.length < maxLines) {
      const { bytesRead } = await fh.read(chunk, 0, Math.min(chunk.length, maxBytes - totalRead), null);
      if (bytesRead <= 0) break;
      pending += chunk.toString('utf-8', 0, bytesRead);
      totalRead += bytesRead;

      let newlineIdx: number;
      while ((newlineIdx = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newlineIdx);
        pending = pending.slice(newlineIdx + 1);
        if (line.trim()) {
          result.push(line);
          if (result.length >= maxLines) {
            break;
          }
        }
      }
      if (result.length >= maxLines) {
        break;
      }
    }
    // 处理尾部未以换行符结束的剩余内容
    if (result.length < maxLines && pending.trim()) {
      result.push(pending);
    }
    return result;
  } finally {
    await fh.close();
  }
}

/**
 * 流式统计文件中"非空行"的数量（与 `content.split('\n').filter(l => l.trim()).length` 行为一致）。
 * 仅逐字节扫描换行符，不进行 JSON 解析，对大文件成本远低于 readFile + split。
 *
 * 异步实现（spec §4.2 P4）：使用 fs.promises.open + filehandle.read。
 */
async function countNonEmptyLines(filePath: string): Promise<number> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const chunk = Buffer.alloc(65536);
    let bytesRead = 0;
    let count = 0;
    let hasNonEmpty = false;

    while ((bytesRead = (await fh.read(chunk, 0, chunk.length, null)).bytesRead) > 0) {
      for (let i = 0; i < bytesRead; i++) {
        const b = chunk[i];
        if (b === 0x0A) {
          // '\n'
          if (hasNonEmpty) {
            count++;
            hasNonEmpty = false;
          }
        } else if (
          b !== 0x0D /* \r */ &&
          b !== 0x20 /* space */ &&
          b !== 0x09 /* \t */ &&
          b !== 0x0B /* \v */ &&
          b !== 0x0C /* \f */
        ) {
          hasNonEmpty = true;
        }
      }
    }
    // 处理最后一行（未以换行符结束）
    if (hasNonEmpty) {
      count++;
    }
    return count;
  } finally {
    await fh.close();
  }
}

/**
 * 获取所有聊天会话列表
 *
 * 异步实现（spec §4.2 P4）：fs.promises.readdir/stat 替代同步版本，避免阻塞事件循环。
 */
export async function getChatSessions(ctx: ChatLogContext): Promise<ChatSession[]> {
  addLog(`开始获取聊天会话列表，目录: ${ctx.chatsDir}`, 'debug');

  const sessions: ChatSession[] = [];
  const seenChatFilePaths = new Set<string>();

  try {
    let chatsDirExists = true;
    try {
      await fsp.access(ctx.chatsDir);
    } catch {
      chatsDirExists = false;
    }
    if (chatsDirExists) {
      // 读取角色目录
      const characterDirs = await fsp.readdir(ctx.chatsDir);
      addLog(`找到 ${characterDirs.length} 个角色目录: ${characterDirs.join(', ')}`, 'debug');

      for (const characterDir of characterDirs) {
        const characterPath = path.join(ctx.chatsDir, characterDir);

        // 检查是否是目录
        const stat = await fsp.stat(characterPath).catch(() => null);
        if (!stat || !stat.isDirectory()) {
          continue;
        }
        // 读取该角色的所有聊天文件
        try {
          const chatFiles = await fsp.readdir(characterPath);
          addLog(`角色 ${characterDir} 有 ${chatFiles.length} 个文件`, 'debug');

          for (const chatFile of chatFiles) {
            if (chatFile.endsWith('.jsonl')) {
              const chatId = `${characterDir}/${chatFile.replace('.jsonl', '')}`;
              // 记录本次扫描中实际存在的文件路径，用于清理已删除文件的缓存
              seenChatFilePaths.add(path.join(characterPath, chatFile));
              const session = await getChatSession(ctx, chatId);
              if (session) {
                const templateId = getAssociatedTemplate(ctx, chatId);
                session.templateId = templateId ?? undefined;
                session.isTemplateAssociated = !!templateId;
                session.isProcessed = getSessionProcessedStatus(ctx, chatId);
                const progress = getOrganizingProgress(ctx, chatId);
                if (progress) {
                  session.organizingProgress = progress;
                }
                sessions.push(session);
                addLog(`添加聊天会话: ${session.name} (${session.characterName})${templateId ? ` - 已关联模板` : ''}${session.isProcessed ? ' - 已整理' : ''}${progress ? ` - 整理进度 ${progress.processedCount}/${progress.totalMessages}` : ''}`, 'debug');
              }
            }
          }
        } catch (error) {
          console.error(`读取角色目录 ${characterDir} 失败:`, error);
        }
      }

      // 清理已删除文件残留的缓存条目（不在本次扫描集合中且文件已不存在的）
      await pruneStaleSessionCache(seenChatFilePaths);
    } else {
      console.warn('聊天记录目录不存在:', ctx.chatsDir);
    }
  } catch (error) {
    console.error('获取聊天会话列表失败:', error);
  }

  addLog(`共获取到 ${sessions.length} 个聊天会话`, 'debug');
  return sessions.sort((a, b) =>
    new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
  );
}

/**
 * 清理已删除文件残留的会话元数据缓存条目。
 * 仅移除"不在本次扫描集合中且文件已不存在"的条目，避免内存中累积过期缓存。
 *
 * 异步实现（spec §4.2 P4）：fs.promises.access 替代 existsSync。
 */
async function pruneStaleSessionCache(seenFilePaths: Set<string>): Promise<void> {
  for (const filePath of sessionMetaCache.keys()) {
    if (seenFilePaths.has(filePath)) {
      continue;
    }
    // 不在本次扫描集合中：若文件确实已不存在，则移除缓存；否则保留（可能是目录扫描范围外的合法条目）
    try {
      await fsp.access(filePath);
      // 文件存在，保留缓存
    } catch {
      // 文件不存在，移除缓存
      sessionMetaCache.delete(filePath);
    }
  }
}

/**
 * 获取单个聊天会话信息
 *
 * 优化说明：
 *   - 命中 mtime+size 缓存时直接返回，不再读取文件内容（SubTask 27.1）。
 *   - 缓存未命中时仅流式读取前 2 行获取元数据+预览，并流式统计非空行数（SubTask 27.2），
 *     不再将整个 JSONL 加载为字符串后 split。
 *   - 文件被删除（access 失败）时，移除对应缓存并返回 null。
 *   - 返回值始终为独立副本，避免调用方修改污染缓存。
 *
 * 异步实现（spec §4.2 P4）：fs.promises.stat/access + 异步流式读取。
 */
export async function getChatSession(ctx: ChatLogContext, chatId: string): Promise<ChatSession | null> {
  // 解析 chatId，格式为 "characterDir/chatFileName"
  const [characterDir, chatFileName] = chatId.split('/');
  if (!characterDir || !chatFileName) {
    return null;
  }

  const chatFilePath = path.join(ctx.chatsDir, characterDir, `${chatFileName}.jsonl`);

  try {
    await fsp.access(chatFilePath);
  } catch {
    // 文件已被删除：清理可能存在的旧缓存条目
    sessionMetaCache.delete(chatFilePath);
    return null;
  }

  try {
    const stats = await fsp.stat(chatFilePath);
    const mtimeMs = stats.mtime.getTime();
    const size = stats.size;

    // 缓存命中：mtime+size 均未变化，直接复用缓存的会话元数据
    const cached = sessionMetaCache.get(chatFilePath);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      return { ...cached.session };
    }

    // 缓存未命中：仅读前 2 个非空行（元数据 + 第一条消息预览），不加载整个文件
    const firstLines = await readFirstNonEmptyLines(chatFilePath, 2);
    if (firstLines.length === 0) {
      return null;
    }

    // 解析元数据行
    let characterName = characterDir;
    try {
      const metadata = JSON.parse(firstLines[0]) as SillyTavernChatMetadata;
      if (metadata.character_name && metadata.character_name !== 'unused') {
        characterName = metadata.character_name;
      }
    } catch (error) {
      // 元数据解析失败，使用目录名作为角色名
    }

    // 获取预览文本（第二条非空行 = 第一条消息）
    let preview = '';
    if (firstLines.length > 1) {
      try {
        const firstMessage = JSON.parse(firstLines[1]) as SillyTavernMessage;
        preview = firstMessage.mes || '';
      } catch (error) {
        // 消息解析失败，preview 保持为空
      }
    }

    // 流式统计非空行数（与原 fileContent.split('\n').filter(l => l.trim()).length 行为一致）
    const totalNonEmptyLines = await countNonEmptyLines(chatFilePath);
    const messageCount = Math.max(0, totalNonEmptyLines - 1);

    const sessionBase: SessionBaseMeta = {
      id: chatId,
      name: chatFileName,
      startTime: stats.birthtime.toISOString(),
      endTime: stats.mtime.toISOString(),
      messageCount,
      preview: preview.substring(0, 100),
      characterName
    };

    // 写入缓存
    sessionMetaCache.set(chatFilePath, {
      mtimeMs,
      size,
      session: sessionBase
    });

    return { ...sessionBase };
  } catch (error) {
    console.error('读取聊天会话失败:', error);
    return null;
  }
}

/**
 * 获取聊天记录
 *
 * 异步实现（spec §4.2 P4）：fs.promises.readFile 替代 readFileSync。
 */
export async function getChatMessages(ctx: ChatLogContext, chatId: string, page: number = 1, pageSize: number = 50): Promise<{
  messages: ChatMessage[],
  total: number,
  totalPages: number
}> {
  // 解析 chatId，格式为 "characterDir/chatFileName"
  const [characterDir, chatFileName] = chatId.split('/');
  if (!characterDir || !chatFileName) {
    return { messages: [], total: 0, totalPages: 0 };
  }

  const chatFilePath = path.join(ctx.chatsDir, characterDir, `${chatFileName}.jsonl`);

  try {
    await fsp.access(chatFilePath);
  } catch {
    return { messages: [], total: 0, totalPages: 0 };
  }

  try {
    const fileContent = await fsp.readFile(chatFilePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    const messages: ChatMessage[] = [];

    // 跳过元数据行，从第二行开始读取消息
    for (let i = 1; i < lines.length; i++) {
      try {
        const line = lines[i];
        const stMessage = JSON.parse(line) as SillyTavernMessage;

        messages.push({
          id: `${chatId}-${i}`,
          role: stMessage.is_user ? 'user' : stMessage.is_system ? 'system' : 'assistant',
          content: stMessage.mes || '',
          timestamp: stMessage.send_date || new Date().toISOString(),
          chatId
        });
      } catch (error) {
        // 消息解析失败，跳过
        console.error('解析聊天消息失败:', error);
      }
    }

    // 分页
    const total = messages.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedMessages = messages.slice(start, end);

    return {
      messages: paginatedMessages,
      total,
      totalPages
    };
  } catch (error) {
    console.error('读取聊天记录失败:', error);
    return { messages: [], total: 0, totalPages: 0 };
  }
}

/**
 * 读取角色卡聊天记录（.json 格式）
 * 角色卡聊天记录存储在 data/memories/chats/ 目录下，格式为 { messages: [...] }
 *
 * 异步实现（spec §4.2 P4）：fs.promises.readFile 替代 readFileSync。
 */
export async function readCharacterChatMessages(ctx: ChatLogContext, chatId: string): Promise<ChatMessage[]> {
  try {
    const jsonFilePath = path.join(ctx.chatsDir, `${chatId}.json`);

    try {
      await fsp.access(jsonFilePath);
    } catch {
      addLog(`角色卡聊天记录文件不存在: ${jsonFilePath}`, 'debug');
      return [];
    }

    const content = await fsp.readFile(jsonFilePath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed.messages)) {
      return [];
    }

    const messages: ChatMessage[] = [];
    parsed.messages.forEach((msg: Record<string, unknown>, index: number) => {
      const role = (msg.role as ChatMessage['role']) || (msg.is_user ? 'user' : (msg.is_system ? 'system' : 'assistant'));
      messages.push({
        id: `${chatId}-json-${index}`,
        role,
        content: (msg.content as string) || (msg.mes as string) || '',
        timestamp: (msg.timestamp as string) || (msg.send_date as string) || new Date().toISOString(),
        chatId
      });
    });

    addLog(`从角色卡聊天记录读取到 ${messages.length} 条消息`, 'debug');
    return messages;
  } catch (error) {
    addLog(`读取角色卡聊天记录失败: ${error}`, 'warn');
    return [];
  }
}

/**
 * 搜索聊天记录
 *
 * 异步实现（spec §4.2 P4）：fs.promises.readdir/stat 替代同步版本。
 */
export async function searchChatMessages(ctx: ChatLogContext, keyword: string, chatId?: string): Promise<ChatMessage[]> {
  const results: ChatMessage[] = [];

  try {
    await fsp.access(ctx.chatsDir);
  } catch {
    return results;
  }

  if (chatId) {
    // 搜索指定的聊天记录
    const [characterDir, chatFileName] = chatId.split('/');
    if (characterDir && chatFileName) {
      const chatFilePath = path.join(ctx.chatsDir, characterDir, `${chatFileName}.jsonl`);
      try {
        await fsp.access(chatFilePath);
        await searchInChatFile(chatFilePath, chatId, keyword, results);
      } catch {
        // 文件不存在，跳过
      }
    }
  } else {
    // 搜索所有聊天记录
    const characterDirs = await fsp.readdir(ctx.chatsDir);
    for (const characterDir of characterDirs) {
      const characterPath = path.join(ctx.chatsDir, characterDir);
      const stat = await fsp.stat(characterPath).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        continue;
      }
      const chatFiles = await fsp.readdir(characterPath);
      for (const chatFile of chatFiles) {
        if (chatFile.endsWith('.jsonl')) {
          const fileChatId = `${characterDir}/${chatFile.replace('.jsonl', '')}`;
          const chatFilePath = path.join(characterPath, chatFile);
          await searchInChatFile(chatFilePath, fileChatId, keyword, results);
        }
      }
    }
  }

  return results;
}

/**
 * 在单个聊天文件中搜索
 *
 * 异步实现（spec §4.2 P4）：fs.promises.readFile 替代 readFileSync。
 */
export async function searchInChatFile(chatFilePath: string, chatId: string, keyword: string, results: ChatMessage[]): Promise<void> {
  try {
    const fileContent = await fsp.readFile(chatFilePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    // 跳过元数据行，从第二行开始搜索
    for (let i = 1; i < lines.length; i++) {
      try {
        const line = lines[i];
        const stMessage = JSON.parse(line) as SillyTavernMessage;

        if (stMessage.mes && stMessage.mes.toLowerCase().includes(keyword.toLowerCase())) {
          results.push({
            id: `${chatId}-${i}`,
            role: stMessage.is_user ? 'user' : stMessage.is_system ? 'system' : 'assistant',
            content: stMessage.mes,
            timestamp: stMessage.send_date || new Date().toISOString(),
            chatId
          });
        }
      } catch (error) {
        // 消息解析失败，跳过
      }
    }
  } catch (error) {
    console.error('搜索聊天记录失败:', error);
  }
}

/**
 * 筛选聊天记录
 *
 * 异步实现（spec §4.2 P4）：fs.promises.readFile 替代 readFileSync。
 */
export async function filterChatMessages(ctx: ChatLogContext, chatId: string, filters: {
  startTime?: string;
  endTime?: string;
}): Promise<ChatMessage[]> {
  // 解析 chatId，格式为 "characterDir/chatFileName"
  const [characterDir, chatFileName] = chatId.split('/');
  if (!characterDir || !chatFileName) {
    return [];
  }

  const chatFilePath = path.join(ctx.chatsDir, characterDir, `${chatFileName}.jsonl`);

  try {
    await fsp.access(chatFilePath);
  } catch {
    return [];
  }

  try {
    const fileContent = await fsp.readFile(chatFilePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    const messages: ChatMessage[] = [];

    // 跳过元数据行，从第二行开始筛选
    for (let i = 1; i < lines.length; i++) {
      try {
        const line = lines[i];
        const stMessage = JSON.parse(line) as SillyTavernMessage;

        // 检查时间范围
        if (filters.startTime || filters.endTime) {
          const messageTime = new Date(stMessage.send_date || new Date());

          if (filters.startTime) {
            const startTime = new Date(filters.startTime);
            if (messageTime < startTime) {
              continue;
            }
          }

          if (filters.endTime) {
            const endTime = new Date(filters.endTime);
            if (messageTime > endTime) {
              continue;
            }
          }
        }

        messages.push({
          id: `${chatId}-${i}`,
          role: stMessage.is_user ? 'user' : stMessage.is_system ? 'system' : 'assistant',
          content: stMessage.mes || '',
          timestamp: stMessage.send_date || new Date().toISOString(),
          chatId
        });
      } catch (error) {
        // 消息解析失败，跳过
      }
    }

    return messages;
  } catch (error) {
    console.error('筛选聊天记录失败:', error);
    return [];
  }
}

// ========== 整理流程专用：消息读取与分段 ==========

/**
 * 读取并过滤出可参与整理的消息（仅 user/assistant）。
 * 优先从 JSONL 读取，若 JSONL 为空则回退到角色卡聊天记录（.json）。
 *
 * 异步实现（spec §4.2 P4）：跟随 getChatMessages / readCharacterChatMessages 异步化。
 */
export async function readAndFilterMessages(ctx: ChatLogContext, chatId: string): Promise<ChatMessage[]> {
  const allMessages = (await getChatMessages(ctx, chatId)).messages;
  let messages: ChatMessage[] = allMessages;
  if (allMessages.length === 0) {
    const jsonMessages = await readCharacterChatMessages(ctx, chatId);
    if (jsonMessages.length > 0) {
      addLog(`[TableOrganize] 从角色卡聊天记录格式读取到 ${jsonMessages.length} 条消息`, 'debug');
      messages = jsonMessages;
    }
  }
  return messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
}

/**
 * 将聊天记录按逻辑段落分割（用户与 AI 各一条消息为一轮）。
 */
export function splitChatIntoSegments(messages: ChatMessage[]): ChatMessage[][] {
  const segments: ChatMessage[][] = [];
  let currentSegment: ChatMessage[] = [];

  messages.forEach((message, index) => {
    currentSegment.push(message);

    if (message.role === 'assistant' && index < messages.length - 1 && messages[index + 1].role === 'user') {
      segments.push([...currentSegment]);
      currentSegment = [];
    }
  });

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}
