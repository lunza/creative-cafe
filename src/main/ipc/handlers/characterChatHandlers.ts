import { ipcMain } from 'electron';
import { chatStorageService, ChatMessage, TestChatData } from '../../services/ChatStorageService';
import { chatVectorizationService } from '../../services/ChatVectorizationService';
import { chatVersionService } from '../../services/ChatVersionService';
import { tableSnapshotService } from '../../services/TableSnapshotService';
import { versionLinkerService } from '../../services/VersionLinkerService';

function getCharacterTestChat(creativeId: string, characterCardId: string): TestChatData | null {
  return chatStorageService.getTestChat(creativeId, characterCardId);
}

async function saveCharacterTestChat(
  creativeId: string, 
  characterCardId: string, 
  characterCardName: string, 
  messages: ChatMessage[]
): Promise<TestChatData> {
  const existingChat = await chatStorageService.getTestChat(creativeId, characterCardId);
  
  if (existingChat) {
    existingChat.messages = messages;
    existingChat.updatedAt = Date.now();
    const saved = await chatStorageService.saveTestChat(existingChat);
    
    await chatVersionService.createVersion(characterCardName, messages, {
      creativeId,
      characterCardId,
      characterCardName,
      savedAt: Date.now(),
    });
    
    return saved;
  } else {
    const newChat: TestChatData = {
      id: `test-chat-${Date.now()}`,
      creativeId,
      characterCardId,
      characterCardName,
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const saved = await chatStorageService.saveTestChat(newChat);
    
    await chatVersionService.createVersion(characterCardName, messages, {
      creativeId,
      characterCardId,
      characterCardName,
      savedAt: Date.now(),
    });
    
    return saved;
  }
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
    messages: ChatMessage[]
  ) => {
    return await saveCharacterTestChat(creativeId, characterCardId, characterCardName, messages);
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
