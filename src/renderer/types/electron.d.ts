import {
  WritingStyleResource,
  WritingStyleLearningRequest,
  WritingStyleProgress
} from '../../shared/types/writing.types';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface ElectronAPI {
  // 通用 invoke 方法，用于直接调用 IPC handler
  invoke: (channel: string, ...args: any[]) => Promise<any>;

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
    processChatProgressive: (chatId: string, templateId: string, config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }, restart?: boolean) => Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; resumed: boolean }>;
    getOrganizingProgress: (chatId: string) => Promise<{ processedCount: number; totalMessages: number; lastProcessedAt?: string } | null>;
    clearOrganizingProgress: (chatId: string) => Promise<boolean>;
    clearTableData: (chatId: string) => Promise<{ success: boolean }>;
    copyTemplate: (sourceTemplateId: string, newTemplateName: string) => Promise<any>;
    
    // 表格数据管理
    getTableData: (chatId: string) => Promise<any>;
    saveTableData: (chatId: string, sheetName: string, sheetData: any[]) => Promise<void>;
    
    // 自动初始化（首次对话时自动绑定模板并创建空表格）
    autoInitializeSession: (chatId: string) => Promise<{ success: boolean; templateId: string | null }>;
    
    // 日志
    onLog?: (message: string, type: string) => void;
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
    search: (query: number[], topK: number, filter?: Record<string, any>) => Promise<{ success: boolean; results?: Array<{ id: string; score: number; metadata: Record<string, any> }>; error?: string }>;
    update: (id: string, vector: number[], metadata?: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    count: () => Promise<{ success: boolean; count?: number; error?: string }>;
    rebuildIndex: () => Promise<{ success: boolean; error?: string }>;
    testStorage: () => Promise<{ success: boolean; mode: string; vectorCount: number; storagePath?: string; error?: string; details?: string }>;
    getStorePath: () => Promise<string>;
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

  // 群组聊天 API
  group: {
    getAll: () => Promise<any[]>;
    get: (id: string) => Promise<any | null>;
    create: (data: any) => Promise<any>;
    edit: (group: any) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
  };
  groupChat: {
    get: (chatId: string) => Promise<any[]>;
    save: (chatId: string, chat: any[], force?: boolean) => Promise<{ ok: true } | { error: string }>;
    delete: (chatId: string) => Promise<boolean>;
    info: (chatId: string) => Promise<any>;
    import: (content: string, suggestedId?: string) => Promise<string>;
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
    cancelGeneration: (projectId: string) => Promise<{ success: boolean }>;
    autoSaveChapter: (data: { projectId: string; chapterIndex: number; content: string }) => Promise<{ success: boolean }>;
    saveVersion: (data: { projectId: string; chapterIndex: number; content: string; note?: string }) => Promise<{ success: boolean }>;
    restoreVersion: (data: { projectId: string; chapterIndex: number; versionId: string }) => Promise<{ success: boolean }>;
    onStreamChunk: (callback: (data: { projectId: string; chapterIndex: number; chunk: string }) => void) => () => void;
    onStreamComplete: (callback: (data: { projectId: string; chapterIndex: number; content: string; metadata: any }) => void) => () => void;
    onStreamError: (callback: (data: { projectId: string; chapterIndex: number; error: any }) => void) => () => void;
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
  };
}

export { ElectronAPI };
