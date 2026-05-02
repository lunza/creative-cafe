import { ipcMain } from 'electron';
import { chatStorageService, ChatMessage, TestChatData, GenerationChatData } from '../../services/ChatStorageService';

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

function getCharacterGenerationChat(
  creativeId: string, 
  targetType: 'character' | 'worldbook', 
  name: string
): Promise<GenerationChatData | null> {
  return chatStorageService.getGenerationChat(creativeId, targetType, name);
}

async function saveCharacterGenerationChat(
  creativeId: string, 
  targetType: 'character' | 'worldbook', 
  name: string, 
  messages: ChatMessage[]
): Promise<GenerationChatData> {
  const existingChat = await chatStorageService.getGenerationChat(creativeId, targetType, name);
  
  if (existingChat) {
    existingChat.messages = messages;
    existingChat.updatedAt = Date.now();
    return await chatStorageService.saveGenerationChat(existingChat);
  } else {
    const newChat: GenerationChatData = {
      id: `gen-chat-${Date.now()}`,
      creativeId,
      targetType,
      name,
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return await chatStorageService.saveGenerationChat(newChat);
  }
}

async function deleteCharacterGenerationChat(
  creativeId: string, 
  targetType: 'character' | 'worldbook', 
  name: string
): Promise<boolean> {
  return await chatStorageService.deleteGenerationChat(creativeId, targetType, name);
}

function getAllCharacterTestChats(): Promise<TestChatData[]> {
  return chatStorageService.getAllTestChats();
}

function getAllCharacterGenerationChats(): Promise<GenerationChatData[]> {
  return chatStorageService.getAllGenerationChats();
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
  
  ipcMain.handle('characterChat:getGenerationChat', async (
    _event, 
    creativeId: string, 
    targetType: 'character' | 'worldbook', 
    name: string
  ) => {
    console.log('[Chat] Getting generation chat for:', creativeId, targetType, name);
    return await getCharacterGenerationChat(creativeId, targetType, name);
  });
  
  ipcMain.handle('characterChat:saveGenerationChat', async (
    _event, 
    creativeId: string, 
    targetType: 'character' | 'worldbook', 
    name: string, 
    messages: ChatMessage[]
  ) => {
    console.log('[Chat] Saving generation chat for:', creativeId, targetType, name);
    return await saveCharacterGenerationChat(creativeId, targetType, name, messages);
  });
  
  ipcMain.handle('characterChat:deleteGenerationChat', async (
    _event, 
    creativeId: string, 
    targetType: 'character' | 'worldbook', 
    name: string
  ) => {
    console.log('[Chat] Deleting generation chat for:', creativeId, targetType, name);
    return await deleteCharacterGenerationChat(creativeId, targetType, name);
  });
  
  ipcMain.handle('characterChat:getAllTestChats', async () => {
    return await getAllCharacterTestChats();
  });
  
  ipcMain.handle('characterChat:getAllGenerationChats', async () => {
    return await getAllCharacterGenerationChats();
  });
  
  ipcMain.handle('characterChat:migrateFromLegacy', async () => {
    console.log('[Chat] Starting migration from legacy file');
    return await chatStorageService.migrateFromLegacyFile();
  });
  
  ipcMain.handle('characterChat:clearCache', async () => {
    chatStorageService.clearCache();
    return { success: true };
  });
  
  console.log('[Chat] Character chat handlers registered');
}
