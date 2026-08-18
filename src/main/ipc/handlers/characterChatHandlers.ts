import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { chatStorageService, ChatMessage, TestChatData } from '../../services/ChatStorageService';
import { chatVectorizationService } from '../../services/ChatVectorizationService';
import { chatVersionService } from '../../services/ChatVersionService';
import { tableSnapshotService } from '../../services/TableSnapshotService';
import { versionLinkerService } from '../../services/VersionLinkerService';
import { getUserDataPath } from '../../utils/appPath';
import type { CharacterTraitItem } from '../../../shared/types/characterTrait.types';

function getCharacterTestChat(creativeId: string, characterCardId: string): TestChatData | null {
  return chatStorageService.getTestChat(creativeId, characterCardId);
}

async function saveCharacterTestChat(
  creativeId: string,
  characterCardId: string,
  characterCardName: string,
  messages: ChatMessage[],
  // 【Spec: enhance-conversation-image-auditability / Task 7.2】
  // sessionTraits 为对话级字段（不在 messages 内），由渲染进程 characterChatStore
  // 从 currentTestChat.sessionTraits 读取后透传。undefined 表示重置（不写入或清空字段）。
  sessionTraits?: CharacterTraitItem[]
): Promise<TestChatData> {
  const existingChat = await chatStorageService.getTestChat(creativeId, characterCardId);

  if (existingChat) {
    existingChat.messages = messages;
    existingChat.updatedAt = Date.now();
    // 透传 sessionTraits：undefined 时显式置为 undefined（JSON.stringify 会省略该字段，
    // 实现重置语义）；数组时直接赋值（渲染进程已深拷贝，主进程无需再次拷贝）
    existingChat.sessionTraits = sessionTraits;
    await chatStorageService.saveTestChat(existingChat);
  } else {
    const newChat: TestChatData = {
      id: `test-chat-${Date.now()}`,
      creativeId,
      characterCardId,
      characterCardName,
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // 仅当传入有效数组时写入 sessionTraits（undefined 时省略字段，保持新对话默认无临时特征）
      ...(Array.isArray(sessionTraits) ? { sessionTraits } : {})
    };
    await chatStorageService.saveTestChat(newChat);
  }

  // 创建聊天版本（UI 版本列表依赖此文件）
  const chatVersionFilePath = await chatVersionService.createVersion(characterCardName, messages, {
    creativeId,
    characterCardId,
    characterCardName,
    savedAt: Date.now(),
  });

  // 【Spec: enhance-conversation-image-auditability / Task 1】
  // 创建联动版本：复用 createVersion 已生成的聊天版本文件，仅创建表格快照并写入版本索引。
  // 表格数据文件路径为 {userDataPath}/data/memories/chatlog/{safeChatId}.json
  try {
    const safeChatId = characterCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const tableFilePath = path.join(getUserDataPath(), 'data', 'memories', 'chatlog', `${safeChatId}.json`);

    let tableData: any;
    try {
      const tableContent = await fs.readFile(tableFilePath, 'utf8');
      const parsed = JSON.parse(tableContent);
      tableData = {
        sheets: parsed.sheets || [],
        headers: parsed.headers || {},
        data: parsed.data || {},
      };
    } catch {
      // 表格文件不存在（新对话尚未创建表格），跳过表格快照数据
      tableData = undefined;
    }

    await versionLinkerService.createLinkedVersion(characterCardName, {
      messages,
      tableData,
      triggerType: 'auto',
      source: 'system',
      description: 'Auto-saved linked version',
      existingChatVersionFilePath: chatVersionFilePath,
    });
  } catch (error) {
    console.error('[saveCharacterTestChat] Failed to create linked version:', error);
  }

  // 返回最新保存的对话（与 saveTestChat 返回值一致）
  const saved = await chatStorageService.getTestChat(creativeId, characterCardId);
  return saved ?? {
    id: `test-chat-${Date.now()}`,
    creativeId,
    characterCardId,
    characterCardName,
    messages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionTraits,
  };
}

async function deleteCharacterTestChat(creativeId: string, characterCardId: string): Promise<boolean> {
  return await chatStorageService.deleteTestChat(creativeId, characterCardId);
}

function getAllCharacterTestChats(): Promise<TestChatData[]> {
  return chatStorageService.getAllTestChats();
}

export function registerCharacterChatHandlers(): void {
  ipcMain.handle('characterChat:getTestChat', async (_event, creativeId: string, characterCardId: string) => {
    return await getCharacterTestChat(creativeId, characterCardId);
  });
  
  ipcMain.handle('characterChat:saveTestChat', async (
    _event,
    creativeId: string,
    characterCardId: string,
    characterCardName: string,
    messages: ChatMessage[],
    // 【Spec: enhance-conversation-image-auditability / Task 7.2】
    // 第 5 个参数：sessionTraits（可选），undefined 表示重置
    sessionTraits?: CharacterTraitItem[]
  ) => {
    return await saveCharacterTestChat(creativeId, characterCardId, characterCardName, messages, sessionTraits);
  });
  
  ipcMain.handle('characterChat:deleteTestChat', async (_event, creativeId: string, characterCardId: string) => {
    return await deleteCharacterTestChat(creativeId, characterCardId);
  });
  
  ipcMain.handle('characterChat:getAllTestChats', async () => {
    return await getAllCharacterTestChats();
  });
  
  ipcMain.handle('characterChat:clearCache', async () => {
    chatStorageService.clearCache();
    return { success: true };
  });
  
  ipcMain.handle('chatVector:vectorize', async (_event, characterId: string, messages: ChatMessage[]) => {
    return await chatVectorizationService.vectorizeChat(characterId, messages);
  });

  ipcMain.handle('chatVector:delete', async (_event, characterId: string) => {
    return await chatVectorizationService.deleteVectorization(characterId);
  });

  ipcMain.handle('chatVector:search', async (_event, characterId: string, query: string, topK?: number) => {
    return await chatVectorizationService.searchChatMessages(characterId, query, topK);
  });

  // 对话历史 RAG 检索（Spec: optimize-chat-ai-intelligence / Task 7.3）
  // chatHistory:retrieve - 检索本会话历史消息的向量相似片段，注入 system prompt"区域 2"
  // chatHistory:vectorizeIncremental - 增量向量化最近消息（fire-and-forget，失败仅日志）
  ipcMain.handle('chatHistory:retrieve', async (
    _event,
    chatId: string,
    queryText: string,
    topK?: number,
    minScore?: number
  ) => {
    console.log(`[IPC] chatHistory:retrieve: entered, chatId=${chatId}, queryLen=${queryText?.length}, topK=${topK ?? 3}`);
    try {
      return await chatVectorizationService.retrieveChatHistory(
        chatId,
        queryText,
        topK ?? 3,
        minScore ?? 0.6
      );
    } catch (error) {
      console.error(`[IPC] chatHistory:retrieve: handler error (chatId=${chatId}):`, error);
      return []; // 返回空数组，与 retrieveChatHistory 内部失败时的行为一致
    }
  });

  ipcMain.handle('chatHistory:vectorizeIncremental', async (
    _event,
    chatId: string,
    messages: ChatMessage[]
  ) => {
    console.log(`[IPC] chatHistory:vectorizeIncremental: entered, chatId=${chatId}, messages=${messages?.length}`);
    try {
      await chatVectorizationService.vectorizeIncremental(chatId, messages);
      return { success: true };
    } catch (error) {
      console.error(`[IPC] chatHistory:vectorizeIncremental: handler error (chatId=${chatId}):`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('chatVersion:getVersions', async (_event, characterCardName: string) => {
    return await chatVersionService.getVersionList(characterCardName);
  });

  ipcMain.handle('chatVersion:getVersionContent', async (_event, filePath: string) => {
    return await chatVersionService.getVersionContent(filePath);
  });

  ipcMain.handle('chatVersion:deleteVersion', async (_event, filePath: string) => {
    return await chatVersionService.deleteVersion(filePath);
  });

  ipcMain.handle('chatVersion:getVersionsDir', async (_event, characterCardName: string) => {
    return chatVersionService.getVersionsDir(characterCardName);
  });

  ipcMain.handle('chatVersion:getLinkedVersion', async (_event, characterCardName: string, versionLinkId: string) => {
    return await versionLinkerService.getLinkedVersion(characterCardName, versionLinkId);
  });

  ipcMain.handle('chatVersion:createLinkedVersion', async (_event, characterCardName: string, options: any) => {
    return await versionLinkerService.createLinkedVersion(characterCardName, options);
  });

  ipcMain.handle('chatVersion:getVersionIndex', async (_event, characterCardName: string) => {
    return await versionLinkerService.getVersionIndex(characterCardName);
  });

  ipcMain.handle('chatVersion:getChangeLog', async (_event, characterCardName: string, options?: any) => {
    return await versionLinkerService.getChangeLog(characterCardName, options);
  });

  ipcMain.handle('chatVersion:verifyConsistency', async (_event, characterCardName: string) => {
    return await versionLinkerService.verifyConsistency(characterCardName);
  });

  ipcMain.handle('chatVersion:getTableSnapshot', async (_event, characterCardName: string, versionLinkId: string) => {
    const linked = await versionLinkerService.getLinkedVersion(characterCardName, versionLinkId);
    return linked.tableSnapshot;
  });

  ipcMain.handle('chatVersion:getTableSnapshots', async (_event, characterCardName: string) => {
    return await tableSnapshotService.getSnapshots(characterCardName);
  });

  ipcMain.handle('chatVersion:getSnapshotContent', async (_event, filePath: string) => {
    return await tableSnapshotService.getSnapshotContent(filePath);
  });
}
