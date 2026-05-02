export interface ElectronAPI {
  config: {
    read: () => Promise<any>;
    write: (config: any) => Promise<any>;
    validate: (config: any) => Promise<any>;
  };
  worldBook: {
    list: () => Promise<any[]>;
    read: (path: string) => Promise<any>;
    write: (path: string, data: any) => Promise<any>;
    delete: (path: string) => Promise<any>;
    optimize: (path: string) => Promise<any>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean; worldBookDir: string }>;
    readTags: (path: string) => Promise<any>;
    writeTags: (path: string, data: any) => Promise<any>;
    deleteTags: (path: string) => Promise<any>;
  };
  character: {
    list: () => Promise<any[]>;
    read: (path: string) => Promise<any>;
    write: (path: string, data: any) => Promise<any>;
    delete: (path: string) => Promise<any>;
    optimize: (path: string) => Promise<any>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean; characterDir: string }>;
    import: (sourcePath: string, fileName: string) => Promise<{ success: boolean; targetPath?: string; error?: string }>;
    testRead: (path: string) => Promise<any>;
    getWorldBookRelations: (path: string) => Promise<Array<{ worldBookPath: string; enabled: boolean; priority: number; filterTags?: string[] }>>;
    setWorldBookRelations: (path: string, relations: Array<{ worldBookPath: string; enabled: boolean; priority: number; filterTags?: string[] }>) => Promise<{ success: boolean; error?: string }>;
  };
  avatar: {
    list: () => Promise<any[]>;
    read: (path: string) => Promise<any>;
    write: (path: string, data: any) => Promise<any>;
    delete: (path: string) => Promise<any>;
    getDirectory: () => Promise<string>;
    setDirectory: (dir: string) => Promise<{ success: boolean; avatarDir: string }>;
  };
  file: {
    selectDirectory: () => Promise<string | null>;
    selectFile: (filters: any[]) => Promise<string | null>;
    exists: (path: string) => Promise<boolean>;
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
    writeBinary: (path: string, content: string, isBase64?: boolean) => Promise<{ success: boolean; error?: string }>;
    copyFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; error?: string }>;
    openFolder: (path: string) => Promise<{ success: boolean; message?: string }>;
    openFile: (path: string) => Promise<boolean>;
    readJson: (fileName: string) => Promise<any>;
    readAsBase64: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPlatform: () => Promise<string>;
    openPath: (path: string) => Promise<void>;
    getUserDataPath: () => Promise<string>;
    getRootPath: () => Promise<string>;
    openConfigFile: () => Promise<boolean>;
  };
  characterChat: {
    getTestChat: (creativeId: string, characterCardId: string) => Promise<any>;
    saveTestChat: (creativeId: string, characterCardId: string, characterCardName: string, messages: any[]) => Promise<any>;
    deleteTestChat: (creativeId: string, characterCardId: string) => Promise<boolean>;
    getGenerationChat: (creativeId: string, targetType: 'character' | 'worldbook', name: string) => Promise<any>;
    saveGenerationChat: (creativeId: string, targetType: 'character' | 'worldbook', name: string, messages: any[]) => Promise<any>;
    deleteGenerationChat: (creativeId: string, targetType: 'character' | 'worldbook', name: string) => Promise<boolean>;
    getAllTestChats: () => Promise<any[]>;
    getAllGenerationChats: () => Promise<any[]>;
    migrateFromLegacy: () => Promise<{ success: boolean; migrated: number; errors: string[] }>;
    clearCache: () => Promise<{ success: boolean }>;
  };
  vector: {
    add: (id: string, vector: number[], metadata: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
    addBatch: (items: Array<{ id: string; vector: number[]; metadata: Record<string, any> }>) => Promise<{ success: boolean; error?: string }>;
    search: (query: number[], topK: number, filter?: Record<string, any>) => Promise<{ success: boolean; results?: Array<{ id: string; score: number; metadata: Record<string, any> }>; error?: string }>;
    update: (id: string, vector: number[], metadata?: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    count: () => Promise<{ success: boolean; count?: number; error?: string }>;
    rebuildIndex: () => Promise<{ success: boolean; error?: string }>;
    setMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
    setStoreMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
    testStorage: () => Promise<{ success: boolean; mode: string; vectorCount: number; details?: string; error?: string }>;
    testEmbedding: () => Promise<any>;
    testAll: () => Promise<any>;
  };
  document: {
    process: (filePath: string) => Promise<any>;
    list: () => Promise<any[]>;
    delete: (docId: string) => Promise<boolean>;
    getInfo: (docId: string) => Promise<any | null>;
    selectFile: () => Promise<string | null>;
  };
  embedding: {
    generate: (text: string) => Promise<{ success: boolean; vector?: number[]; error?: string; dimension?: number; model?: string }>;
    testConnection: (config?: any) => Promise<{ success: boolean; mode: string; dimension: number; error?: string; details?: string }>;
    setMode: (mode: string) => Promise<{ success: boolean; mode?: string; error?: string }>;
    getMode: () => Promise<{ success: boolean; mode: string; dimension: number }>;
    localTest: (params?: { modelName?: string }) => Promise<{ success: boolean; mode: string; dimension: number; details?: string; model?: string; error?: string }>;
    localGenerate: (text: string) => Promise<{ success: boolean; vector?: number[]; dimension?: number; model?: string; error?: string }>;
    localInit: (modelName?: string) => Promise<{ success: boolean; error?: string }>;
    checkModelStatus: (modelName: string) => Promise<{ downloaded: boolean; path: string }>;
  };
  knowledge: {
    list: () => Promise<any[]>;
    get: (id: string) => Promise<any>;
    create: (data: any) => Promise<{ success: boolean; id?: string; error?: string }>;
    update: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    vectorize: (id: string) => Promise<{ success: boolean; error?: string }>;
    vectorizeAll: () => Promise<{ success: boolean; count?: number; error?: string }>;
    getVersionHistory: (id: string) => Promise<number[]>;
    restoreVersion: (id: string, version: number) => Promise<{ success: boolean; error?: string }>;
  };
  context: {
    retrieve: (conversation: Array<{ role: string; content: string }>, options: { topK?: number; minScore?: number; sources?: string[]; filter?: Record<string, any> }) => Promise<{ success: boolean; items?: Array<{ id: string; source: string; content: string; score: number; metadata: Record<string, any> }>; error?: string }>;
    compress: (items: Array<{ id: string; source: string; content: string; score: number }>, maxTokens: number) => Promise<{ success: boolean; compressed?: string; error?: string }>;
  };
  model: {
    download: (modelName: string) => Promise<{ success: boolean; localPath: string; error?: string }>;
    isDownloaded: (modelName: string) => Promise<boolean>;
    getCacheDir: () => Promise<string>;
  };
  storage: {
    get: (key: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    set: (data: { key: string; value: any }) => Promise<{ success: boolean; error?: string }>;
    delete: (key: string) => Promise<{ success: boolean; error?: string }>;
    clear: () => Promise<{ success: boolean; error?: string }>;
    has: (key: string) => Promise<{ success: boolean; exists: boolean; error?: string }>;
    getAll: () => Promise<{ success: boolean; data?: Record<string, any>; error?: string }>;
    import: (data: string) => Promise<{ success: boolean; error?: string }>;
  };
  memory: {
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
    getChatSessions: () => Promise<any[]>;
    getChatSession: (chatId: string) => Promise<any | null>;
    getChatMessages: (chatId: string, page: number, pageSize: number) => Promise<{ messages: any[]; total: number; totalPages: number }>;
    searchChatMessages: (keyword: string, chatId?: string) => Promise<any[]>;
    filterChatMessages: (chatId: string, filters: any) => Promise<any[]>;
    processChatWithAI: (chatId: string, templateId: string, config: { apiKey: string; apiUrl: string; modelName: string }) => Promise<any[]>;
    applyAIResults: (chatId: string, results: any[]) => Promise<string>;
    deleteChatSession: (chatId: string) => Promise<boolean>;
    associateTemplate: (chatId: string, templateId: string) => Promise<void>;
    processChat: (chatId: string, templateId: string, selectedMessageIds?: string[], config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }) => Promise<void>;
    getTableData: (chatId: string) => Promise<any>;
    saveTableData: (chatId: string, sheetName: string, sheetData: any[]) => Promise<void>;
  };
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
  creative: {
    load: () => Promise<{ creatives: any[]; currentCreativeId: string | null; currentEditorTarget: { type: 'character' | 'worldbook'; id: string } | null }>;
    save: (data: { creatives: any[]; currentCreativeId: string | null; currentEditorTarget: { type: 'character' | 'worldbook'; id: string } | null }) => Promise<boolean>;
    export: () => Promise<string>;
    import: (jsonData: string) => Promise<{ success: boolean; error?: string }>;
  };
  update: {
    check: () => Promise<any>;
    download: (latestVersion: string) => Promise<any>;
    install: (downloadPath: string) => Promise<any>;
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
