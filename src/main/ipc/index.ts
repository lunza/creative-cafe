import { ipcMain } from 'electron';
import { settingHandlers } from './handlers/settingHandlers';
import { worldBookHandlers } from './handlers/worldBookHandlers';
import { characterHandlers } from './handlers/characterHandlers';
import { avatarHandlers } from './handlers/avatarHandlers';
import { fileHandlers } from './handlers/fileHandlers';
import { appHandlers } from './handlers/appHandlers';
import { pluginHandlers } from './handlers/pluginHandlers';
import { documentHandlers } from './handlers/documentHandlers';
import { updateHandlers } from './handlers/updateHandlers';
import { registerMemoryHandlers } from './handlers/memoryHandlers';
import { registerCreativeHandlers } from './handlers/creativeHandlers';
import { registerCharacterChatHandlers } from './handlers/characterChatHandlers';
import { registerWritingHandlers } from './handlers/writingHandlers';
import { registerGameHandlers } from './handlers/gameHandlers';
import { registerPromptHandlers } from './handlers/promptHandlers';
import { registerTokenHandlers } from './handlers/tokenHandlers';
import { registerExpressionHandlers } from './handlers/expressionHandlers';
import { registerCharacterTraitHandlers } from './handlers/characterTraitHandlers';
import { registerAssetHandlers } from './handlers/assetHandlers';
import { registerSdGenerationHandlers } from './handlers/sdGenerationHandlers';
import { registerCharacterTraitAIHandlers } from './handlers/characterTraitAIHandlers';
import { registerLoraHandlers } from './handlers/loraHandlers';
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
  updateHandlers();

  // Task 25.2: 从 main/index.ts 迁入的 registerXxxHandlers 调用，
  // 使 main/index.ts 仅依赖 setupIpcHandlers 单一入口
  registerMemoryHandlers();
  registerCreativeHandlers();
  registerCharacterChatHandlers();
  registerWritingHandlers();
  registerGameHandlers();
  registerPromptHandlers();
  registerTokenHandlers();
  // 表情管理系统 IPC（Spec: add-character-expression-system / Task 1）
  registerExpressionHandlers();
  // 角色特征管理 IPC（Spec: add-asset-and-trait-management / Task 2）
  // 暴露 character-trait:list / save / clear 三个通道，参数与返回值对齐 characterTraitService
  registerCharacterTraitHandlers();
  // 素材管理 IPC（Spec: add-asset-and-trait-management / Task 7）
  // 暴露 asset:list / save / delete / getImagePath 四个通道，参数含 assetType
  // 表情类型继续由 expressionHandlers 管理，不纳入本服务
  registerAssetHandlers();
  // SD 表情生成 IPC（Spec: add-ai-expression-generation / Task 2）
  // 统一注册全部 5 个通道（checkStatus / getModels / generateExpression /
  // generateAllExpressions / cancelGeneration），取代 Task 6 的 sdHandlers.ts
  registerSdGenerationHandlers();
  // AI 辅助角色特征生成 IPC（Spec: add-asset-and-trait-management / Task 12）
  // 暴露 ai:generateCharacterTraits 通道，调用 LLM 从角色描述提取视觉特征 tag
  // 与 aiHandlers.ts 的 ai:request（低层 HTTP 转发）不同，本通道是高层业务通道
  registerCharacterTraitAIHandlers();
  // LoRA 模型列表获取 IPC（Spec: add-lora-model-selection / Task 3）
  // 暴露 lora:list 通道，调用 loraService.fetchLoraList 获取可用 LoRA 列表
  registerLoraHandlers();

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
