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
import { registerCategoryDictionaryHandlers } from './handlers/categoryDictionaryHandlers';
import { registerLoraHandlers } from './handlers/loraHandlers';
import { registerCharacterLoraHandlers } from './handlers/characterLoraHandlers';
import './handlers/aiHandlers';
import { registerAgentHandlers } from './handlers/agentHandlers';
import { registerWebSearchHandlers } from './handlers/webSearchHandlers';
import { registerTagHandlers } from './handlers/tagHandlers';
// RAG 标签库 IPC（Spec: rag-tag-library-for-ai-trait-generation / Task 7）
// 暴露 tagRag:getStatus / startVectorization / cancelVectorization / search / clearIndex
// 进度事件 tagRag:progress 由 tagRagProgressEmitter 主动广播（非 invoke 通道）
import { registerTagRagHandlers } from './handlers/tagRagHandlers';
// 缩略图管线 IPC（Spec: optimize-system-rendering-performance / Task 7）
// 暴露 thumbnail:get / thumbnail:invalidate 通道，基于 nativeImage 生成缩略图
import { registerThumbnailHandlers } from './handlers/thumbnailHandlers';
// 文档读取 IPC（读取项目根目录 docs/ 下的文档文件内容）
// 暴露 docs:read 通道，供渲染进程读取本地技术文档
import { docsHandlers } from './handlers/docsHandlers';
import { getStorageService } from '../services/storageService';
import { embeddingService } from '../services/EmbeddingService';
import { embeddingWorkerService } from '../services/EmbeddingWorkerService';
import { vectorStoreService } from '../services/VectorStoreService';
import { knowledgeBaseService } from '../services/KnowledgeBaseService';
import { knowledgeBaseDocumentService } from '../services/KnowledgeBaseDocumentService';
import { contextManager } from '../services/ContextManager';
import { modelDownloadService } from '../services/ModelDownloadService';
// RAG 标签库服务（Spec: rag-tag-library-for-ai-trait-generation / Task 5）
// 在 setupIpcHandlers 末尾调用 initialize() 恢复 meta 状态 + 注册事件监听
import { tagRagService } from '../services/tagRagService';

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
  // 暴露 ai:generateCharacterTraits / ai:recognizeImageTraits 通道，
  // 调用 LLM 从角色描述或角色卡 PNG 图片提取视觉特征 tag
  // 与 aiHandlers.ts 的 ai:request（低层 HTTP 转发）不同，本通道是高层业务通道
  registerCharacterTraitAIHandlers();
  // 全局分类字典 IPC（Spec: fix-asset-trait-and-scene-defects / Task 3）
  // 暴露 category-dictionary:load / add / delete / rename / has 共 5 个通道，
  // 持久化到 {userData}/data/trait-categories.json，跨角色卡共享自定义分类
  registerCategoryDictionaryHandlers();
  // LoRA 模型列表获取 IPC（Spec: add-lora-model-selection / Task 3）
  // 暴露 lora:list 通道，调用 loraService.fetchLoraList 获取可用 LoRA 列表
  registerLoraHandlers();
  // 角色卡 LoRA 管理 IPC（2026-07-29 bug 修复 - 按角色独立存储）
  // 【重点标记】暴露 character-lora:list / save 通道，按角色卡独立持久化 LoRA 配置
  registerCharacterLoraHandlers();

  // Agent 智能体底座 IPC（Spec: implement-agent-foundation-and-fix-defects / Task 9）
  // 暴露 agent:run / agent:cancel / agent:token / agent:toolCall / agent:done
  //       + skill:list / skill:invoke + memory:search + learning:dream 共 9 个通道
  registerAgentHandlers();

  // Web 搜索 IPC（webSearch:test / webSearch:search）
  registerWebSearchHandlers();

  // 本地标签自动推荐 IPC（Spec: implement-local-tag-autocomplete / Task 3）
  // 暴露 tag:search / tag:getLoadStatus / tag:reload / tag:setCsvPath 共 4 个通道
  // 调用 tagAutocompleteService 单例，提供 31.7 万 tag 库的实时子串匹配查询
  registerTagHandlers();

  // RAG 标签库 IPC（Spec: rag-tag-library-for-ai-trait-generation / Task 7）
  // 暴露 tagRag:getStatus / startVectorization / cancelVectorization / search / clearIndex 共 5 个通道
  // 调用 tagRagService 单例，将 31.7 万标签向量化后语义检索，引导 AI 使用有效标签
  // 进度事件 tagRag:progress 由 tagRagProgressEmitter 主动广播
  registerTagRagHandlers();
  // 初始化 RAG 服务：从 meta 文件恢复状态 + 注册 CSV/维度变更事件监听
  // 注意：不自动触发向量化（需用户在 UI 手动点击）
  tagRagService.initialize();

  // 缩略图管线 IPC（Spec: optimize-system-rendering-performance / Task 7）
  // 暴露 thumbnail:get（生成/读取缩略图 data URL，含内存+磁盘缓存）
  //       thumbnail:invalidate（粗粒度清空全部缩略图缓存）共 2 个通道
  // 基于 Electron nativeImage（零新原生依赖），供渲染进程 LazyImage 走 IPC 取缩略图
  registerThumbnailHandlers();

  // 文档读取 IPC：暴露 docs:read 通道，读取项目根目录 docs/ 下的文档文件内容
  docsHandlers();

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
