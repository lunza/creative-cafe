import { ipcMain } from 'electron';
import { chatStorageService, ChatMessage, TestChatData } from '../../services/ChatStorageService';
import { chatVectorizationService } from '../../services/ChatVectorizationService';

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
    return await chatStorageService.saveTestChat(existingChat);
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
    return await chatStorageService.saveTestChat(newChat);
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
  
  console.log('[Chat] Character chat handlers registered');
}
