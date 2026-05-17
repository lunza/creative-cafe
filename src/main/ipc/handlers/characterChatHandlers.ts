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
    console.log('[Chat] Getting test chat for:', creativeId, characterCardId);
    return await getCharacterTestChat(creativeId, characterCardId);
  });
  
  ipcMain.handle('characterChat:saveTestChat', async (
    _event, 
    creativeId: string, 
    characterCardId: string, 
    characterCardName: string, 
    messages: ChatMessage[]
  ) => {
    console.log('[Chat] Saving test chat for:', creativeId, characterCardId);
    return await saveCharacterTestChat(creativeId, characterCardId, characterCardName, messages);
  });
  
  ipcMain.handle('characterChat:deleteTestChat', async (_event, creativeId: string, characterCardId: string) => {
    console.log('[Chat] Deleting test chat for:', creativeId, characterCardId);
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
    console.log('[ChatVector] Vectorizing chat for character:', characterId);
    return await chatVectorizationService.vectorizeChat(characterId, messages);
  });
  
  ipcMain.handle('chatVector:delete', async (_event, characterId: string) => {
    console.log('[ChatVector] Deleting vectors for character:', characterId);
    return await chatVectorizationService.deleteVectorization(characterId);
  });
  
  ipcMain.handle('chatVector:search', async (_event, characterId: string, query: string, topK?: number) => {
    console.log('[ChatVector] Searching chat vectors for character:', characterId);
    return await chatVectorizationService.searchChatMessages(characterId, query, topK);
  });

  ipcMain.handle('chatVersion:getVersions', async (_event, characterCardName: string) => {
    console.log('[ChatVersion] Getting versions for character:', characterCardName);
    return await chatVersionService.getVersionList(characterCardName);
  });

  ipcMain.handle('chatVersion:getVersionContent', async (_event, filePath: string) => {
    console.log('[ChatVersion] Getting version content:', filePath);
    return await chatVersionService.getVersionContent(filePath);
  });

  ipcMain.handle('chatVersion:deleteVersion', async (_event, filePath: string) => {
    console.log('[ChatVersion] Deleting version:', filePath);
    return await chatVersionService.deleteVersion(filePath);
  });

  ipcMain.handle('chatVersion:getVersionsDir', async (_event, characterCardName: string) => {
    return chatVersionService.getVersionsDir(characterCardName);
  });

  ipcMain.handle('chatVersion:getLinkedVersion', async (_event, characterCardName: string, versionLinkId: string) => {
    console.log('[ChatVersion] Getting linked version:', characterCardName, versionLinkId);
    return await versionLinkerService.getLinkedVersion(characterCardName, versionLinkId);
  });

  ipcMain.handle('chatVersion:createLinkedVersion', async (_event, characterCardName: string, options: any) => {
    console.log('[ChatVersion] Creating linked version for:', characterCardName);
    return await versionLinkerService.createLinkedVersion(characterCardName, options);
  });

  ipcMain.handle('chatVersion:getVersionIndex', async (_event, characterCardName: string) => {
    console.log('[ChatVersion] Getting version index for:', characterCardName);
    return await versionLinkerService.getVersionIndex(characterCardName);
  });

  ipcMain.handle('chatVersion:getChangeLog', async (_event, characterCardName: string, options?: any) => {
    console.log('[ChatVersion] Getting change log for:', characterCardName);
    return await versionLinkerService.getChangeLog(characterCardName, options);
  });

  ipcMain.handle('chatVersion:verifyConsistency', async (_event, characterCardName: string) => {
    console.log('[ChatVersion] Verifying consistency for:', characterCardName);
    return await versionLinkerService.verifyConsistency(characterCardName);
  });

  ipcMain.handle('chatVersion:getTableSnapshot', async (_event, characterCardName: string, versionLinkId: string) => {
    console.log('[ChatVersion] Getting table snapshot for:', characterCardName, versionLinkId);
    const linked = await versionLinkerService.getLinkedVersion(characterCardName, versionLinkId);
    return linked.tableSnapshot;
  });

  ipcMain.handle('chatVersion:getTableSnapshots', async (_event, characterCardName: string) => {
    console.log('[ChatVersion] Getting table snapshots for:', characterCardName);
    return await tableSnapshotService.getSnapshots(characterCardName);
  });

  ipcMain.handle('chatVersion:getSnapshotContent', async (_event, filePath: string) => {
    console.log('[ChatVersion] Getting snapshot content:', filePath);
    return await tableSnapshotService.getSnapshotContent(filePath);
  });

  console.log('[Chat] Character chat handlers registered');
}
