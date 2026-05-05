import { ipcMain } from 'electron';
import { settingHandlers } from './handlers/settingHandlers';
import { worldBookHandlers } from './handlers/worldBookHandlers';
import { characterHandlers } from './handlers/characterHandlers';
import { avatarHandlers } from './handlers/avatarHandlers';
import { fileHandlers } from './handlers/fileHandlers';
import { appHandlers } from './handlers/appHandlers';
import { pluginHandlers } from './handlers/pluginHandlers';
import { documentHandlers } from './handlers/documentHandlers';
import './handlers/aiHandlers';
import { getStorageService } from '../services/storageService';
import { embeddingService } from '../services/EmbeddingService';
import { embeddingWorkerService } from '../services/EmbeddingWorkerService';
import { vectorStoreService } from '../services/VectorStoreService';
import { knowledgeBaseService } from '../services/KnowledgeBaseService';
import { knowledgeBaseDocumentService } from '../services/KnowledgeBaseDocumentService';
import { contextManager } from '../services/ContextManager';
import { modelDownloadService } from '../services/ModelDownloadService';

export function setupIpcHandlers() {
  getStorageService();
  
  settingHandlers();
  worldBookHandlers();
  characterHandlers();
  avatarHandlers();
  fileHandlers();
  appHandlers();
  pluginHandlers();
  documentHandlers();

  embeddingService.initialize();
  embeddingService.registerIpcHandlers();

  vectorStoreService.initialize();
  vectorStoreService.registerIpcHandlers();

  knowledgeBaseService.initialize();
  knowledgeBaseService.registerIpcHandlers();
  knowledgeBaseDocumentService.registerIpcHandlers();

  contextManager.registerIpcHandlers();

  modelDownloadService.registerIpcHandlers();

  embeddingWorkerService.initialize();
  embeddingWorkerService.registerIpcHandlers();
}
