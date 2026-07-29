import {
  WritingStyleResource,
  WritingStyleLearningRequest,
  WritingStyleProgress,
  CustomNovelTypeTemplate,
  CustomWritingStyleTemplate
} from '../../shared/types/writing.types';
import type {
  PromptPolishRequest,
  PromptPolishResult
} from '../../shared/types/promptTemplate.types';
import type {
  GameIndexEntry,
  GameMeta,
  GameSaveMeta,
  GameSaveData,
  GameNarrativeMessage,
  GameTableData,
  GameTableSchema,
  GameTableEditCommand,
  GameNarrativeRequest,
  GameNarrativeChunk,
  GameNarrativeComplete,
  GameNarrativeError,
  GameTableUpdated,
  GameLocalConfig,
  GameType
} from '../../shared/types/game.types';
import type { AIEngineCapabilities } from './setting';
// 工具调用智能体引擎类型（方向 0）
// 主进程类型仅用于类型检查（type-only import，编译时擦除，不影响 renderer 打包）
import type {
  AgentLoopResult,
  AgentToolGroup,
  AgentToolContext,
  ToolCallEvent,
} from '../../main/services/ai/agent/agentTypes';
import type { ChatMessage } from '../../main/services/AIService';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface ElectronAPI {
  // 通用 invoke 方法，用于直接调用 IPC handler
  invoke: (channel: string, ...args: any[]) => Promise<any>;

  // 通用方法，用于监听 IPC 事件
  on: (channel: string, callback: (...args: any[]) => void) => void;

  off: (channel: string, callback: (...args: any[]) => void) => void;
  setting: {
    load: () => Promise<{ success: boolean; setting?: any; error?: string }>;
    save: (setting: any) => Promise<{ success: boolean; error?: string }>;
    getPath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  };
  worldBook: {
    list: () => Promise<any[]>;
    read: (path: string) => Promise<any>;
    write: (path: string, data: any) => Promise<any>;
    delete: (path: string) => Promise<any>;
    import: (sourcePath: string, fileName: string) => Promise<{ success: boolean; targetPath?: string; error?: string }>;
    optimize: (path: string) => Promise<any>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean; worldBookDir: string }>;
    readTags: (path: string) => Promise<any>;
    writeTags: (path: string, data: any) => Promise<any>;
    deleteTags: (path: string) => Promise<any>;
    saveToKnowledgeBase: (data: any, fileName: string) => Promise<{ success: boolean; filePath?: string; message?: string; fileExists?: boolean; error?: string }>;
    checkFileExists: (fileName: string) => Promise<{ success: boolean; exists: boolean; filePath?: string; error?: string }>;
    vectorize: (path: string) => Promise<{
      success: boolean;
      descriptionVectorized: boolean;
      entriesVectorized: number;
      entriesFailed: number;
      error?: string;
      descriptionVectorId?: string;
      entryVectorIds: string[];
    }>;
  };
  character: {
    list: () => Promise<any[]>;
    read: (path: string) => Promise<any>;
    write: (path: string, data: any) => Promise<any>;
    createFromImage: (filePath: string, imageDataBase64: string, characterData: any) => Promise<{ success: boolean; error?: string }>;
    delete: (path: string) => Promise<any>;
    optimize: (path: string) => Promise<any>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean }>;
    import: (sourcePath: string, fileName: string) => Promise<{ success: boolean; targetPath?: string; error?: string }>;
    testRead: (path: string) => Promise<any>;
    getWorldBookRelations: (path: string) => Promise<Array<{ worldBookPath: string; enabled: boolean; priority: number; filterTags?: string[] }>>;
    setWorldBookRelations: (path: string, relations: Array<{ worldBookPath: string; enabled: boolean; priority: number; filterTags?: string[] }>) => Promise<{ success: boolean; error?: string }>;
  };
  characterConfig: {
    save: (characterCardId: string, config: any) => Promise<{ success: boolean; error?: string }>;
    load: (characterCardId: string) => Promise<{ success: boolean; config: any | null }>;
  };
  avatar: {
    list: () => Promise<any[]>;
    read: (path: string) => Promise<any>;
    write: (path: string, data: any) => Promise<any>;
    delete: (path: string) => Promise<any>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean; avatarDir: string }>;
  };
  plugin: {
    getAvailable: (forceRefresh?: boolean) => Promise<any[]>;
    getInstalled: () => Promise<any[]>;
    toggle: (pluginId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    uninstall: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean; pluginDir: string }>;
    checkUpdates: () => Promise<{ success: boolean; plugins?: any[]; error?: string }>;
    updateDescriptions: (translatedPlugins: any[]) => Promise<{ success: boolean; error?: string }>;
    install: (url: string, branch?: string) => Promise<{
      success: boolean;
      plugin?: any;
      error?: string;
      displayName?: string;
      version?: string;
      author?: string;
    }>;
    uninstallById: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
  };
  file: {
    selectDirectory: () => Promise<string | null>;
    selectFile: (filters: any[]) => Promise<string | null>;
    exists: (path: string) => Promise<boolean>;
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
    writeBinary: (path: string, content: string, isBase64?: boolean) => Promise<{ success: boolean; error?: string }>;
    copyFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; error?: string }>;
    openFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
    openFile: (path: string) => Promise<{ success: boolean; error?: string }>;
    validatePath: (path: string) => Promise<{ valid: boolean; exists: boolean; isDirectory: boolean; canRead: boolean; canWrite: boolean; error?: string }>;
    readJson: (fileName: string) => Promise<any>;
    readAsBase64: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPlatform: () => Promise<string>;
    openPath: (path: string) => Promise<string>;
    getRootPath: () => Promise<string>;
    getUserDataPath: () => Promise<string>;
    getUserDataSize: () => Promise<{ success: boolean; size?: number; formattedSize?: string; error?: string }>;
  };
  update: {
    check: () => Promise<{ success: boolean; message?: string; data?: { hasUpdate: boolean; currentVersion: string; latestVersion: string; commits: Array<{ hash: string; message: string; author: string; date: string }> } }>;
    pull: () => Promise<{ success: boolean; message?: string; data?: { compiled: boolean; buildOutput: string[]; changedFiles: string[] }; logs?: string[] }>;
  };
  memory: {
    // 表格模板管理
    getAllTemplates: () => Promise<any[]>;
    getTemplate: (templateId: string) => Promise<any | null>;
    createTemplate: (template: any) => Promise<any>;
    updateTemplate: (templateId: string, updates: any) => Promise<any | null>;
    deleteTemplate: (templateId: string) => Promise<boolean>;
    createTableFile: (chatId: string, templateId: string) => Promise<string>;
    readTableFile: (chatId: string) => Promise<Record<string, any[]>>;
    updateTableFile: (chatId: string, sheetName: string, data: any[]) => Promise<string>;
    getVersionHistory: (templateId: string) => Promise<string[]>;
    restoreVersion: (templateId: string, version: string) => Promise<any | null>;
    getTemplateBindingStatus: () => Promise<Record<string, boolean>>;

    // 聊天记录管理
    getChatSessions: () => Promise<any[]>;
    getChatSession: (chatId: string) => Promise<any | null>;
    getChatMessages: (chatId: string, page: number, pageSize: number) => Promise<{ messages: any[]; total: number; totalPages: number }>;
    searchChatMessages: (keyword: string, chatId?: string) => Promise<any[]>;
    filterChatMessages: (chatId: string, filters: any) => Promise<any[]>;
    processChatWithAI: (chatId: string, templateId: string, config: { apiKey: string; apiUrl: string; modelName: string }) => Promise<any[]>;
    applyAIResults: (chatId: string, results: any[]) => Promise<string>;
    deleteChatSession: (chatId: string) => Promise<boolean>;
    associateTemplate: (chatId: string, templateId: string) => Promise<void>;
    getAssociatedTemplate: (chatId: string) => Promise<string | null>;
    processChat: (chatId: string, templateId: string, selectedMessageIds?: string[], config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }) => Promise<void>;
    processChatProgressive: (chatId: string, templateId: string, config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }, options?: { continueFromLast?: boolean; minInterval?: number }) => Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; resumed: boolean }>;
    getOrganizingProgress: (chatId: string) => Promise<{ processedCount: number; totalMessages: number; lastProcessedAt?: string } | null>;
    clearOrganizingProgress: (chatId: string) => Promise<boolean>;
    clearTableData: (chatId: string) => Promise<{ success: boolean }>;
    copyTemplate: (sourceTemplateId: string, newTemplateName: string) => Promise<any>;

    // 表格数据管理
    getTableData: (chatId: string) => Promise<any>;
    saveTableData: (chatId: string, sheetName: string, sheetData: any[]) => Promise<void>;

    // 自动初始化（首次对话时自动绑定模板并创建空表格）
    autoInitializeSession: (chatId: string) => Promise<{ success: boolean; templateId: string | null }>;

    // 角色卡聊天记录向量化（读取聊天记录并重新向量化）
    vectorizeCharacterChat: (fileName: string) => Promise<{ success: boolean; messagesVectorized?: number; messagesFailed?: number; error?: string; messageVectorIds?: string[] }>;
  };
  // AI 请求 API
  ai: {
    request: (config: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: any;
      timeout?: number;
      streaming?: boolean
    }) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
      details?: string
    }>;
    listModels: (params: { apiUrl?: string; apiKey?: string; apiKeyTransmission?: string }) => Promise<{ success: boolean; models: string[]; error?: string }>;
    /**
     * AI 辅助角色特征生成（Spec: add-asset-and-trait-management / Task 12）
     *
     * 基于角色卡 description/personality/scenario 调用 LLM 提取视觉特征 tag 列表。
     * 主进程内部复用 aiConfigProvider 读取激活 AI 引擎配置，
     * 非流式调用 /v1/chat/completions，解析逗号分隔 tag 返回。
     *
     * 错误兜底（SubTask 12.4）：
     * - AI 引擎未配置 / 调用失败 / 返回格式异常 → success=false，error 为友好信息（非堆栈）
     * - traits 可能为空数组（LLM 未从描述中提取到任何视觉特征）
     */
    generateCharacterTraits: (args: {
      characterCardId: string;
      description: string;
      personality?: string;
      scenario?: string;
      includeImage?: boolean;
    }) => Promise<{
      success: boolean;
      traits?: string[];
      appearanceDescription?: string;
      error?: string;
    }>;
    /**
     * AI 图片识别特征提取（Spec: add-model-capability-detection-and-image-recognition / Task 6）
     *
     * 通过多模态模型识别角色卡 PNG 图片，提取视觉特征 tag 列表。
     * 主进程内部读取角色卡图片为 base64 data URI，构建多模态 messages
     * （text + image_url），非流式调用 /v1/chat/completions，解析逗号分隔 tag 返回。
     *
     * 前置条件：当前 AI 引擎 supportsVision=true（由前端判断，主进程不重复检测）
     *
     * 错误兜底：
     * - AI 引擎未配置 / 角色卡图片读取失败 / 调用失败 / 返回格式异常 → success=false
     * - traits 可能为空数组（模型未从图片中提取到任何视觉特征）
     */
    recognizeImageTraits: (args: { characterCardPath: string; characterName?: string }) =>
      Promise<{ success: boolean; traits?: string[]; appearanceDescription?: string; error?: string }>;
    /**
     * 探测 AI 模型能力（Spec: add-model-capability-detection-and-image-recognition / Task 3）
     *
     * 并行探测 vision / thinking / tool-calling 等能力，供前端在连通性测试后展示徽章。
     * 主进程内部调用 aiService.probeAllCapabilities，探测失败时 success=false。
     */
    probeCapabilities: (args: { apiUrl: string; apiKey: string; apiKeyTransmission: string; modelName: string }) =>
      Promise<{ success: boolean; capabilities?: AIEngineCapabilities; error?: string }>;
    /**
     * 运行一轮工具调用智能体循环（方向 0 最后一层）
     *
     * handler 内部读取全局 enableAgentMode 设置 + 当前引擎 capabilities.supportsToolCalling，
     * 计算 effectiveSupportsToolCalling = enableAgentMode && supportsToolCalling 传入 runAgentLoop。
     * 开关关或模型不支持 → 自动降级为纯文本生成（agentLoop 内部已处理降级）。
     *
     * options 不含 supportsToolCalling（由 handler 计算），也不含 abortSignal（暂未暴露取消通道）。
     * 工具调用事件通过 onAgentToolCall 订阅（handler 在执行工具时主动推送）。
     *
     * 错误兜底：handler try-catch 包裹，异常时返回 stoppedReason='error' 的 AgentLoopResult，
     * 渲染进程永不收到 reject。
     */
    runAgentTurn: (params: {
      messages: ChatMessage[];
      toolGroups: AgentToolGroup[];
      context?: AgentToolContext;
      options: {
        model: string;
        temperature: number;
        maxTokens: number;
        maxIterations?: number;
        tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
        streamFinal?: boolean;
      };
    }) => Promise<AgentLoopResult>;
    /**
     * 订阅工具调用事件（agentLoop 在执行工具时推送，可观测性）
     * @param callback 接收 ToolCallEvent（含工具名、参数、结果、耗时、迭代序号）
     * @returns unsubscribe 函数（与 writing.onPolishChunk / game.onNarrativeChunk 模式一致）
     */
    onAgentToolCall: (callback: (event: ToolCallEvent) => void) => () => void;
  };
  // ============================================================================
  // Agent 技能库 / 长期记忆 / 自我学习 API（Spec: add-agent-skill-and-memory-foundation / Task 12）
  // ============================================================================
  // 命名空间隔离设计：使用独立前缀 agent-skill: / agent-memory: / agent-learning:
  // 与现有 memory:* 旧聊天/表格记忆系统物理隔离，避免通道与命名冲突
  // Agent 技能库 API
  agentSkill: {
    list: (params?: { category?: string; enabledOnly?: boolean }) => Promise<any[]>;
    get: (id: string) => Promise<any | undefined>;
    create: (manifest: any) => Promise<void>;
    update: (manifest: any) => Promise<void>;
    delete: (id: string) => Promise<void>;
    invoke: (id: string, input: any, context?: any) => Promise<any>;
    discover: (query: string, category?: string) => Promise<any[]>;
    history: (id: string) => Promise<any[]>;
    rollback: (id: string, version: string) => Promise<void>;
    import: (json: string) => Promise<void>;
    export: (id: string) => Promise<string>;
  };
  // Agent 长期记忆 API
  agentMemory: {
    search: (query: string, type?: string, topK?: number) => Promise<any[]>;
    query: (filter: any) => Promise<any[]>;
    record: (content: string, type: string, metadata?: any) => Promise<any>;
    delete: (id: string) => Promise<void>;
    getRelevant: (context: any, taskDescription: string, topK?: number) => Promise<any[]>;
  };
  // Agent 自我学习 API
  agentLearning: {
    consolidate: () => Promise<any>;
    optimize: (taskType: string, taskDescription: string, context?: any) => Promise<any>;
    feedback: (memoryId: string, feedback: any) => Promise<void>;
    extractPatterns: (taskType?: string) => Promise<any[]>;
  };
  // 创意数据 API
  creative: {
    load: () => Promise<{ creatives: any[]; currentCreativeId: string | null; currentEditorTarget: { type: 'character' | 'worldbook'; id: string } | null }>;
    save: (data: { creatives: any[]; currentCreativeId: string | null; currentEditorTarget: { type: 'character' | 'worldbook'; id: string } | null }) => Promise<boolean>;
    export: () => Promise<string>;
    import: (jsonData: string) => Promise<{ success: boolean; error?: string }>;
  };
  // 角色卡对话数据 API
  characterChat: {
    getTestChat: (creativeId: string, characterCardId: string) => Promise<any>;
    saveTestChat: (creativeId: string, characterCardId: string, characterCardName: string, messages: any[]) => Promise<any>;
    deleteTestChat: (creativeId: string, characterCardId: string) => Promise<boolean>;
    getAllTestChats: () => Promise<any[]>;
    clearCache: () => Promise<{ success: boolean }>;
  };
  // 通用存储 API
  storage: {
    get: (key: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    set: (data: { key: string; value: any }) => Promise<{ success: boolean; error?: string }>;
    delete: (key: string) => Promise<{ success: boolean; error?: string }>;
    clear: () => Promise<{ success: boolean; error?: string }>;
    has: (key: string) => Promise<{ success: boolean; exists: boolean; error?: string }>;
    getAll: () => Promise<{ success: boolean; data?: Record<string, any>; error?: string }>;
    import: (data: string) => Promise<{ success: boolean; error?: string }>;
  };
  // 向量存储 API
  vector: {
    add: (id: string, vector: number[], metadata: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
    addBatch: (items: Array<{ id: string; vector: number[]; metadata: Record<string, any> }>) => Promise<{ success: boolean; error?: string }>;
    search: (query: number[], topK: number, filter?: Record<string, any>, scopeIds?: string[]) => Promise<{ success: boolean; results?: Array<{ id: string; score: number; metadata: Record<string, any> }>; error?: string }>;
    update: (id: string, vector: number[], metadata?: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    count: () => Promise<{ success: boolean; count?: number; error?: string }>;
    rebuildIndex: () => Promise<{ success: boolean; error?: string }>;
    testStorage: () => Promise<{ success: boolean; mode: string; vectorCount: number; storagePath?: string; error?: string; details?: string }>;
    getStorePath: () => Promise<string>;
    getById: (id: string) => Promise<{ success: boolean; item?: any; error?: string }>;
    getAvailableScopes: () => Promise<{ success: boolean; scopes?: any[]; error?: string }>;
  };
  // 向量嵌入 API
  embedding: {
    generate: (text: string) => Promise<{ success: boolean; vector?: number[]; error?: string; dimension?: number; model?: string }>;
    testConnection: () => Promise<{ success: boolean; mode: string; dimension: number; error?: string; details?: string }>;
    setMode: (mode: string) => Promise<{ success: boolean; mode?: string; error?: string }>;
    getMode: () => Promise<{ success: boolean; mode: string; dimension: number }>;
  };
  // 知识库 API
  knowledge: {
    list: (filter?: Record<string, any>, page?: number, pageSize?: number) => Promise<{ success: boolean; items?: any[]; total?: number; error?: string }>;
    get: (id: string) => Promise<any>;
    create: (data: any) => Promise<{ success: boolean; id?: string; error?: string }>;
    createBatch: (items: any[]) => Promise<{ success: boolean; count?: number; error?: string }>;
    update: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    deleteBatch: (ids: string[]) => Promise<{ success: boolean; count?: number; error?: string }>;
    search: (query: string, options?: any) => Promise<{ success: boolean; results?: any[]; error?: string }>;
    vectorize: (id: string) => Promise<{ success: boolean; error?: string }>;
    vectorizeAll: () => Promise<{ success: boolean; count?: number; error?: string }>;
    uploadDocument: (filePath: string, options?: { category?: string[]; tags?: string[]; source?: string }) => Promise<{ success: boolean; documentId?: string; knowledgeItemsCreated?: number; chunkCount?: number; error?: string; isDuplicate?: boolean }>;
    selectDocumentFile: () => Promise<string | null>;
  };
  // 上下文管理 API
  context: {
    retrieve: (conversation: Array<{ role: string; content: string }>, options: { topK?: number; minScore?: number; sources?: string[]; filter?: Record<string, any>; scopeIds?: string[] }) => Promise<{ success: boolean; items?: Array<{ id: string; source: string; content: string; score: number; metadata: Record<string, any> }>; error?: string }>;
    retrieveWithKeywords: (
      conversation: Array<{ role: string; content: string }>,
      options: { topK?: number; minScore?: number; sources?: string[]; filter?: Record<string, any>; scopeIds?: string[] },
      enableKeywordMatch?: boolean,
      scanDepth?: number,
      globalScanData?: {
        personaDescription?: string;
        characterDescription?: string;
        characterPersonality?: string;
        characterDepthPrompt?: string;
        scenario?: string;
        creatorNotes?: string;
      }
    ) => Promise<{ success: boolean; items?: Array<{ id: string; source: string; content: string; score: number; metadata: Record<string, any> }>; vectorItems?: any[]; keywordItems?: any[]; error?: string }>;
    compress: (items: Array<{ id: string; source: string; content: string; score: number }>, maxTokens: number) => Promise<{ success: boolean; compressed?: string; error?: string }>;
  };

  // 世界书关键词匹配 API
  worldbook: {
    matchKeywords: (text: string, worldBookPaths?: string[], options?: { caseSensitive?: boolean; matchWholeWords?: boolean; maxResults?: number }) => Promise<{ success: boolean; matches: Array<{ entry: any; matchedKeys: string[]; matchType: string; matchScore: number; content: string; comment?: string; name?: string }>; count: number; error?: string }>;
  };

  // 文档向量化 API
  document: {
    process: (filePath: string) => Promise<any>;
    list: () => Promise<any[]>;
    delete: (docId: string) => Promise<boolean>;
    deleteBatch: (docIds: string[]) => Promise<number>;
    getInfo: (docId: string) => Promise<any | null>;
    getChunks: (docId: string) => Promise<Array<{ index: number; text: string }>>;
    searchVectors: (queryText: string, topK: number, docId?: string) => Promise<{ success: boolean; results?: Array<{ id: string; score: number; metadata: Record<string, any> }>; error?: string }>;
    getVectorStats: () => Promise<{ totalVectors: number; documentCount: number; documents: Array<{ docId: string; fileName: string; vectorCount: number }> }>;
    generateEmbedding: (text: string) => Promise<{ success: boolean; vector?: number[]; error?: string; dimension?: number }>;
    selectFile: () => Promise<string | null>;
  };

  // 对话记录向量化 API
  chatVector: {
    vectorize: (characterId: string, messages: Array<{ role: string; content: string; name?: string; create_date?: number }>) => Promise<{
      success: boolean;
      messagesVectorized: number;
      messagesFailed: number;
      error?: string;
      messageVectorIds: string[];
    }>;
    delete: (characterId: string) => Promise<{
      success: boolean;
      deletedCount: number;
      error?: string;
    }>;
    search: (characterId: string, query: string, topK?: number) => Promise<{
      id: string;
      score: number;
      metadata: Record<string, any>;
    }[]>;
  };

  // 对话历史 RAG API（Spec: optimize-chat-ai-intelligence / Task 7.4）
  // retrieve: 检索本会话历史消息的向量相似片段，注入 system prompt"区域 2：本会话相关历史片段"
  // vectorizeIncremental: 增量向量化最近消息（跳过已向量化的 messageId），fire-and-forget
  chatHistory: {
    retrieve: (
      chatId: string,
      queryText: string,
      topK?: number,
      minScore?: number
    ) => Promise<Array<{ content: string; score: number; timestamp: number }>>;
    vectorizeIncremental: (
      chatId: string,
      messages: Array<{ role: string; content: string; id?: string; name?: string; timestamp?: number; create_date?: number }>
    ) => Promise<{ success: boolean }>;
  };

  // 写作模式 API
  writing: {
    loadProjects: () => Promise<{ success: boolean; projects: any[] }>;
    createProject: (config: any) => Promise<{ success: boolean; projectId: string }>;
    saveProject: (project: any) => Promise<{ success: boolean }>;
    deleteProject: (projectId: string) => Promise<{ success: boolean }>;
    exportProject: (projectId: string, format: string) => Promise<{ success: boolean; filePath?: string }>;
    generateOutline: (request: any) => Promise<{ success: boolean; outline?: any; outlineRaw?: string; error?: string; parseError?: string }>;
    saveProjectRaw: (projectId: string, rawContent: string) => Promise<{ success: boolean; error?: string }>;
    generateChapter: (request: any) => Promise<{ success: boolean }>;
    generateChapterChunk: (request: any) => Promise<{ success: boolean }>;
    cancelGeneration: (projectId: string) => Promise<{ success: boolean }>;
    cancelChunkGeneration: (projectId: string, chapterIndex: number, chunkIndex: number) => Promise<{ success: boolean }>;
    autoSaveChapter: (data: { projectId: string; chapterIndex: number; content: string }) => Promise<{ success: boolean }>;
    saveVersion: (data: { projectId: string; chapterIndex: number; content: string; note?: string }) => Promise<{ success: boolean }>;
    restoreVersion: (data: { projectId: string; chapterIndex: number; versionId: string }) => Promise<{ success: boolean }>;
    onStreamChunk: (callback: (data: { projectId: string; chapterIndex: number; chunk: string }) => void) => () => void;
    onStreamComplete: (callback: (data: { projectId: string; chapterIndex: number; content: string; metadata: any }) => void) => () => void;
    onStreamError: (callback: (data: { projectId: string; chapterIndex: number; error: any }) => void) => () => void;
    onChunkStart: (callback: (data: { projectId: string; chapterIndex: number; chunkIndex: number }) => void) => () => void;
    onChunkProgress: (callback: (data: { projectId: string; chapterIndex: number; chunkIndex: number; chunk: string }) => void) => () => void;
    onChunkComplete: (callback: (data: { projectId: string; chapterIndex: number; chunkIndex: number; content: string }) => void) => () => void;
    onChunkError: (callback: (data: { projectId: string; chapterIndex: number; chunkIndex: number; error: any }) => void) => () => void;
    offStreamChunk: (callback: (data: any) => void) => void;
    offStreamComplete: (callback: (data: any) => void) => void;
    offStreamError: (callback: (data: any) => void) => void;
    // 写作风格 API
    style: {
      upload: (request: WritingStyleLearningRequest) => Promise<{ success: boolean; taskId: string; error?: string }>;
      list: () => Promise<{ success: boolean; styles: WritingStyleResource[]; error?: string }>;
      get: (resourceId: string) => Promise<{ success: boolean; style: WritingStyleResource | null; error?: string }>;
      delete: (resourceId: string) => Promise<{ success: boolean; error?: string }>;
      cancel: (taskId: string) => Promise<{ success: boolean; error?: string }>;
      getActiveTasks: () => Promise<{ success: boolean; activeTaskIds: string[]; error?: string }>;
      onProgress: (callback: (data: { taskId: string; progress: WritingStyleProgress }) => void) => () => void;
      onComplete: (callback: (data: { taskId: string; resource: WritingStyleResource }) => void) => () => void;
      onError: (callback: (data: { taskId: string; error: string }) => void) => () => void;
    };
    // 表格整理 API
    table: {
      getTableData: (projectId: string) => Promise<{ sheets: string[]; headers: Record<string, string[]>; data: Record<string, Record<string, any>[]>; sheetDescriptions: Record<string, string> }>;
      saveTableData: (projectId: string, sheetName: string, sheetData: Record<string, any>[]) => Promise<void>;
      clearTableData: (projectId: string) => Promise<void>;
      updateRowInTable: (projectId: string, sheetName: string, rowIndex: number, rowData: Record<string, any>) => Promise<boolean>;
      getTableConfig: (projectId: string) => Promise<{ enabled: boolean; autoOrganize: boolean; organizeMode: 'sync' | 'async'; associatedTemplateId: string | null; associatedTemplateName: string } | null>;
      saveTableConfig: (projectId: string, config: { enabled: boolean; autoOrganize: boolean; organizeMode: 'sync' | 'async'; associatedTemplateId: string | null; associatedTemplateName: string }) => Promise<void>;
      associateTableTemplate: (projectId: string, templateId: string, templateName: string, templateSheets: Array<{ name: string; headers: string[]; description?: string }>) => Promise<{ success: boolean; error?: string }>;
      getAllTemplates: () => Promise<{ success: boolean; templates: any[]; error?: string }>;
      organizeTable: (projectId: string, modelConfig: any, chapterIndex?: number) => Promise<{ success: boolean; message: string; processedCount?: number; errorCount?: number; errors?: string[] }>;
      getOrganizeProgress: (projectId: string) => Promise<{ progress: number; status: string } | null>;
    };
    // 自定义模板管理 API
    template: {
      novelType: {
        list: () => Promise<{ success: boolean; templates: CustomNovelTypeTemplate[]; error?: string }>;
        get: (id: string) => Promise<{ success: boolean; template: CustomNovelTypeTemplate | null; error?: string }>;
        save: (template: CustomNovelTypeTemplate) => Promise<{ success: boolean; id?: string; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean; error?: string }>;
      };
      writingStyle: {
        list: () => Promise<{ success: boolean; templates: CustomWritingStyleTemplate[]; error?: string }>;
        get: (id: string) => Promise<{ success: boolean; template: CustomWritingStyleTemplate | null; error?: string }>;
        save: (template: CustomWritingStyleTemplate) => Promise<{ success: boolean; id?: string; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean; error?: string }>;
      };
    };
  };

  prompt: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    get: (moduleId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    save: (template: any, modifiedBy: string, changeSummary: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    getHistory: (moduleId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    rollback: (moduleId: string, version: number, modifiedBy: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    clearHistory: (moduleId: string) => Promise<{ success: boolean; error?: string }>;
    build: (moduleId: string, variables: Record<string, string>) => Promise<{ success: boolean; data?: { systemPrompt: string; userPrompt: string }; error?: string }>;
    validate: (template: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    reset: (moduleId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    optimize: (request: PromptPolishRequest) => Promise<{ success: boolean; data?: PromptPolishResult; error?: string }>;
  };

  // Token 计数 API（精确 cl100k_base，由主进程 TokenCountService 提供）
  token: {
    count: (text: string) => Promise<number>;
    countBatch: (messages: Array<{ id: string; text: string }>) => Promise<Array<{ id: string; count: number }>>;
  };

  // 角色卡表情管理 API（Spec: add-character-expression-system / Task 1）
  // 存储路径：{userData}/data/character-expressions/{sha256(characterCardId).slice(0,16)}/
  // 每个角色卡一个 manifest.json + 多个 {emotionKey}.png
  expression: {
    /** 读取角色卡表情包 manifest；若不存在返回空白默认 manifest */
    list: (characterCardId: string) => Promise<{
      characterCardId: string;
      version: 1;
      expressions: Record<string, { type: 'preset' | 'custom'; image: string }>;
      customEmotions: Array<{ key: string; label: string }>;
    }>;
    /** 保存表情图像（base64，可含 data URI 前缀）并更新 manifest；返回图像绝对路径 */
    saveImage: (args: {
      characterCardId: string;
      emotionKey: string;
      imageBase64: string;
      isCustom: boolean;
      label?: string;
    }) => Promise<{ success: boolean; error?: string; imagePath?: string }>;
    /** 删除指定情绪的图像文件，并从 manifest.expressions 移除（保留 customEmotions） */
    deleteImage: (args: { characterCardId: string; emotionKey: string }) => Promise<{ success: boolean; error?: string }>;
    /** 添加自定义情绪类别（key 需匹配 ^[a-z][a-z0-9_]*$） */
    addCustomEmotion: (args: { characterCardId: string; key: string; label: string }) => Promise<{ success: boolean; error?: string }>;
    /** 移除自定义情绪类别：从 customEmotions + expressions 移除，并删除图像文件 */
    removeCustomEmotion: (args: { characterCardId: string; key: string }) => Promise<{ success: boolean; error?: string }>;
    /** 获取指定情绪的图像绝对路径，不存在时返回 null */
    getImagePath: (args: { characterCardId: string; emotionKey: string }) => Promise<{ success: boolean; imagePath: string | null; error?: string }>;
  };

  // 角色特征管理 API（Spec: add-asset-and-trait-management / Task 2）
  // 为每个角色卡持久化视觉特征 tag 数组，SD 生成素材时携带以保证角色一致性
  // 存储路径：{userData}/data/character-traits/{sha256(characterCardId).slice(0,16)}/traits.json
  characterTrait: {
    /** 读取角色卡视觉特征 tag 数组；文件不存在或解析失败时返回 [] */
    list: (characterCardId: string) => Promise<string[]>;
    /** 覆盖保存角色卡视觉特征 tag 数组（自动创建目录，原子写入 traits.json，可附带外观描述） */
    save: (args: { characterCardId: string; traits: string[]; appearanceDescription?: string }) => Promise<{ success: boolean; error?: string }>;
    /** 读取角色卡外观描述（中文自然语言）；不存在时返回空串 */
    loadDescription: (characterCardId: string) => Promise<string>;
    /** 清除角色卡特征文件（删除 traits.json，文件不存在视为幂等成功） */
    clear: (characterCardId: string) => Promise<{ success: boolean; error?: string }>;
  };

  // 角色卡 LoRA 管理 API（2026-07-29 bug 修复 - 按角色独立存储）
  // 【重点标记】原实现将 LoRA 存在全局设置中导致角色间污染，现改为按角色卡独立持久化
  // 存储路径：{userData}/data/character-loras/{sha256(characterCardId).slice(0,16)}/loras.json
  characterLora: {
    /** 读取角色卡 LoRA 模型清单；文件不存在或解析失败时返回 [] */
    list: (characterCardId: string) => Promise<Array<{ name: string; weight: number }>>;
    /** 覆盖保存角色卡 LoRA 模型清单（自动创建目录，原子写入 loras.json） */
    save: (args: {
      characterCardId: string;
      loras: Array<{ name: string; weight: number }>;
    }) => Promise<{ success: boolean; error?: string }>;
  };

  // 素材管理 API（Spec: add-asset-and-trait-management / Task 7）
  // 通用素材管理，支持 illustration / general / three-view 三种素材类型
  // 表情类型（expression）继续走 expressionService.ts，不纳入本命名空间
  // 存储路径：{userData}/data/character-assets/{sha256(characterCardId).slice(0,16)}/{assetType}/...
  //
  // 注意：assetType 在 preload 透传为 string（避免主进程 AssetType 类型泄露），
  //       实际仅接受 'illustration' | 'general' | 'three-view'，
  //       service 内部对 three-view 类型校验 assetId 是否在 front/side/back 白名单内
  asset: {
    /** 读取角色卡 × assetType 的素材包 manifest；不存在时返回默认空 manifest */
    list: (args: { characterCardId: string; assetType: string }) => Promise<{
      characterCardId: string;
      version: 1;
      assets: Record<string, {
        id: string;
        type: 'illustration' | 'general' | 'three-view';
        slot?: 'front' | 'side' | 'back';
        image: string;
        createdAt: string;
      }>;
    }>;
    /** 保存素材图像（base64，可含 data URI 前缀）并更新 manifest；返回图像绝对路径 */
    save: (args: {
      characterCardId: string;
      assetType: string;
      assetId: string;
      imageBase64: string;
      slot?: string;
    }) => Promise<{ success: boolean; error?: string; imagePath?: string }>;
    /** 删除指定素材的图像文件并从 manifest.assets 移除条目（幂等） */
    delete: (args: { characterCardId: string; assetType: string; assetId: string }) => Promise<{ success: boolean; error?: string }>;
    /**
     * 获取指定素材的图像绝对路径；不存在时 imagePath=null，success=true
     * 【重点标记 - CSP 兼容】返回的 imagePath 为磁盘绝对路径，
     * 渲染进程应通过 file.readAsBase64 转 data URL 后再用于 <img src>
     */
    getImagePath: (args: { characterCardId: string; assetType: string; assetId: string }) => Promise<{ success: boolean; imagePath: string | null; error?: string }>;
  };

  // SD 表情生成 API（Spec: add-ai-expression-generation / Task 2 + integrate-nl-driven-sd-models / Task 5）
  // 通过 SD WebUI img2img / txt2img 端点生成角色卡表情图片
  // 注意：本命名空间合并了 Task 6 的 checkStatus / getModels，并由 Task 2 追加
  //       generateExpression / generateAllExpressions / cancelGeneration 及事件监听器，
  //       Task 5 追加 generateTxt2Img（NL 驱动模型文生图）。
  // options 类型实际为 SDGenerationOptions（定义于 src/main/services/sdGenerationService.ts），
  // 因主进程类型不可直接被渲染进程引用，此处使用 any 以匹配 preload 实现
  sd: {
    /** 检查 SD WebUI API 状态（GET /sdapi/v1/options + /sdapi/v1/script-info），返回当前模型 + ADetailer 可用性 */
    checkStatus: (endpoint: string) => Promise<{
      available: boolean;
      currentModel?: string;
      adetailerAvailable?: boolean;
      error?: string;
    }>;
    /** 获取 SD WebUI 已加载的模型列表（GET /sdapi/v1/sd-models） */
    getModels: (endpoint: string) => Promise<{
      success: boolean;
      models: Array<{ title: string; model_name: string; hash?: string }>;
      error?: string;
    }>;
    /** 生成单个表情图片（内部先 extractBaseImage 再 generateExpression） */
    generateExpression: (args: {
      characterCardPath: string;
      emotionKey: string;
      prompt: string;
      negativePrompt: string;
      options?: any;
    }) => Promise<{ success: boolean; imageBase64?: string; error?: string; warning?: string }>;
    /** 文生图（txt2img），适用于 qwen-image / flux2 等 NL 驱动模型 */
    generateTxt2Img: (args: {
      endpoint: string;
      prompt: string;
      negativePrompt?: string;
      options?: any;
    }) => Promise<{ success: boolean; imageBase64?: string; error?: string; warning?: string }>;
    /** 批量生成多个表情，通过 onGenerationProgress / onGenerationComplete 推送进度 */
    generateAllExpressions: (args: {
      characterCardPath: string;
      emotions: Array<{ key: string; prompt: string; negativePrompt: string }>;
      options?: any;
    }) => Promise<{
      success: boolean;
      total: number;
      successCount: number;
      failedCount: number;
      cancelledCount: number;
    }>;
    /** 取消正在进行的批量生成任务（设置模块级取消标志） */
    cancelGeneration: () => Promise<{ success: boolean }>;
    /** 监听单个表情生成进度事件 */
    onGenerationProgress: (callback: (data: {
      current: number;
      total: number;
      emotionKey: string;
      status: 'success' | 'failed';
      error?: string;
      imageBase64?: string;
    }) => void) => void;
    /** 监听批量生成完成事件 */
    onGenerationComplete: (callback: (data: {
      total: number;
      success: number;
      failed: number;
      cancelled: number;
    }) => void) => void;
    /** 移除所有进度监听器（组件卸载时调用） */
    removeProgressListeners: () => void;
  };

  // 游戏模式 API（Spec: add-game-mode-framework / Task 5 preload 契约）
  // 命名空间由 Task 5 在 preload.ts 中实现；此处类型声明由 Task 6 提前补全以解耦渲染进程开发
  game: {
    list: () => Promise<{ success: boolean; games?: GameIndexEntry[]; error?: string }>;
    getMeta: (gameId: string) => Promise<{ success: boolean; meta?: GameMeta | null; error?: string }>;
    createGame: (meta: GameMeta) => Promise<{ success: boolean }>;
    updateGame: (gameId: string, updates: Partial<GameMeta>) => Promise<{ success: boolean }>;
    deleteGame: (gameId: string) => Promise<{ success: boolean }>;
    createSave: (params: {
      gameId: string;
      gameType: GameType;
      name: string;
      isAuto: boolean;
      tableSchema: GameTableSchema;
      initialState?: Record<string, any>;
    }) => Promise<{ success: boolean; meta?: GameSaveMeta; error?: string }>;
    loadSave: (saveId: string) => Promise<{ success: boolean; data?: GameSaveData | null; error?: string }>;
    listSaves: (gameId: string) => Promise<{ success: boolean; saves?: GameSaveMeta[]; error?: string }>;
    deleteSave: (saveId: string) => Promise<{ success: boolean }>;
    save: (
      saveId: string,
      updates: {
        narrativeLog?: GameSaveData['narrativeLog'];
        stateSnapshot?: Record<string, any>;
        currentTurn?: number | null;
        currentNodeId?: string | null;
        nodeTitle?: string | null;
        turnCount?: number;
      }
    ) => Promise<{ success: boolean }>;
    getTableData: (saveId: string) => Promise<{ success: boolean; data?: GameTableData | null; error?: string }>;
    saveTableData: (saveId: string, tableData: GameTableData) => Promise<{ success: boolean }>;
    applyTableEdits: (
      saveId: string,
      commands: GameTableEditCommand[]
    ) => Promise<{
      success: boolean;
      changes: {
        commandsExecuted: number;
        affectedSheets: string[];
        errors: string[];
      };
    }>;
    getVersionSnapshot: (saveId: string) => Promise<{ success: boolean; snapshot?: any; error?: string }>;
    confirmVersion: (saveId: string) => Promise<{ success: boolean }>;
    rollbackVersion: (saveId: string) => Promise<{ success: boolean }>;
    generateNarrative: (request: GameNarrativeRequest) => Promise<void>;
    cancelGeneration: (saveId: string) => Promise<void>;
    getConfig: (gameId: string) => Promise<{ success: boolean; config?: GameLocalConfig; error?: string }>;
    saveConfig: (gameId: string, config: GameLocalConfig) => Promise<{ success: boolean }>;
    // 事件监听器（每个返回 unsubscribe 函数）
    onNarrativeChunk: (callback: (data: GameNarrativeChunk) => void) => () => void;
    onNarrativeComplete: (callback: (data: GameNarrativeComplete) => void) => () => void;
    onNarrativeError: (callback: (data: GameNarrativeError) => void) => () => void;
    onTableUpdated: (callback: (data: GameTableUpdated) => void) => () => void;
  };

  // LoRA 模型列表 API（Spec: add-lora-model-selection / Task 3）
  // 通过 SD WebUI API 获取可用 LoRA 模型列表，含预览图 URL 和 JSON 元数据
  lora: {
    list: (endpoint: string) => Promise<{
      success: boolean;
      loras?: Array<{
        name: string;
        alias: string;
        path: string;
        previewUrl: string;
        description: string;
        activationText: string;
        preferredWeight: number;
        sdVersion: string;
        notes: string;
        category: string;
      }>;
      error?: string;
    }>;
  };
}

export { ElectronAPI };
