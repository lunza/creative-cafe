import { contextBridge, ipcRenderer } from 'electron';

// 存储 subscription 映射，以便 off 方法可以正确移除监听器
const subscriptionMap = new Map<string, Map<Function, Function>>();

contextBridge.exposeInMainWorld('electronAPI', {
  // 通用 invoke 方法，用于直接调用 IPC handler
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),

  // 通用方法，用于监听 IPC 事件
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    
    // 保存 subscription 到映射中
    if (!subscriptionMap.has(channel)) {
      subscriptionMap.set(channel, new Map());
    }
    subscriptionMap.get(channel)!.set(callback, subscription);
    
    // 返回移除监听器的函数
    return () => {
      ipcRenderer.removeListener(channel, subscription);
      subscriptionMap.get(channel)?.delete(callback);
    };
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    // 从映射中获取对应的 subscription
    const channelMap = subscriptionMap.get(channel);
    if (channelMap && channelMap.has(callback)) {
      const subscription = channelMap.get(callback);
      ipcRenderer.removeListener(channel, subscription);
      channelMap.delete(callback);
    }
  },
  setting: {
    load: () => ipcRenderer.invoke('setting:load'),
    save: (setting: any) => ipcRenderer.invoke('setting:save', setting),
    getPath: () => ipcRenderer.invoke('setting:getPath')
  },
  worldBook: {
    list: () => ipcRenderer.invoke('worldBook:list'),
    read: (path: string) => ipcRenderer.invoke('worldBook:read', path),
    write: (path: string, data: any) => ipcRenderer.invoke('worldBook:write', path, data),
    delete: (path: string) => ipcRenderer.invoke('worldBook:delete', path),
    import: (sourcePath: string, fileName: string) => ipcRenderer.invoke('worldBook:import', sourcePath, fileName),
    optimize: (path: string) => ipcRenderer.invoke('worldBook:optimize', path),
    getDirectory: () => ipcRenderer.invoke('worldBook:getDirectory'),
    setDirectory: (dir: string) => ipcRenderer.invoke('worldBook:setDirectory', dir),
    readTags: (path: string) => ipcRenderer.invoke('worldBook:readTags', path),
    writeTags: (path: string, data: any) => ipcRenderer.invoke('worldBook:writeTags', path, data),
    deleteTags: (path: string) => ipcRenderer.invoke('worldBook:deleteTags', path),
    saveToKnowledgeBase: (data: any, fileName: string) => ipcRenderer.invoke('worldBook:saveToKnowledgeBase', data, fileName),
    checkFileExists: (fileName: string) => ipcRenderer.invoke('worldBook:checkFileExists', fileName),
    vectorize: (path: string) => ipcRenderer.invoke('worldBook:vectorize', path)
  },
  character: {
    list: () => ipcRenderer.invoke('character:list'),
    read: (path: string) => ipcRenderer.invoke('character:read', path),
    write: (path: string, data: any) => ipcRenderer.invoke('character:write', path, data),
    delete: (path: string) => ipcRenderer.invoke('character:delete', path),
    optimize: (path: string) => ipcRenderer.invoke('character:optimize', path),
    getDirectory: () => ipcRenderer.invoke('character:getDirectory'),
    setDirectory: (dir: string) => ipcRenderer.invoke('character:setDirectory', dir),
    import: (sourcePath: string, fileName: string) => ipcRenderer.invoke('character:import', sourcePath, fileName),
    getWorldBookRelations: (path: string) => ipcRenderer.invoke('character:getWorldBookRelations', path),
    setWorldBookRelations: (path: string, relations: any[]) => ipcRenderer.invoke('character:setWorldBookRelations', path, relations),
    savePNGToDirectory: (base64Data: string, filename: string) => ipcRenderer.invoke('character:savePNGToDirectory', base64Data, filename),
    exportCharacterCard: (params: { base64Image: string; filename: string; characterData: any }) => ipcRenderer.invoke('character:exportCharacterCard', params)
  },
  characterConfig: {
    save: (characterCardId: string, config: any) => ipcRenderer.invoke('characterConfig:save', characterCardId, config),
    load: (characterCardId: string) => ipcRenderer.invoke('characterConfig:load', characterCardId)
  },
  avatar: {
    list: () => ipcRenderer.invoke('avatar:list'),
    read: (path: string) => ipcRenderer.invoke('avatar:read', path),
    write: (path: string, data: any) => ipcRenderer.invoke('avatar:write', path, data),
    delete: (path: string) => ipcRenderer.invoke('avatar:delete', path),
    getDirectory: () => ipcRenderer.invoke('avatar:getDirectory'),
    setDirectory: (dir: string) => ipcRenderer.invoke('avatar:setDirectory', dir)
  },
  plugin: {
    getAvailable: (forceRefresh?: boolean) => ipcRenderer.invoke('plugin:getAvailable', forceRefresh),
    getInstalled: () => ipcRenderer.invoke('plugin:getInstalled'),
    toggle: (pluginId: string, enabled: boolean) => ipcRenderer.invoke('plugin:toggle', pluginId, enabled),
    uninstall: (pluginId: string) => ipcRenderer.invoke('plugin:uninstall', pluginId),
    getDirectory: () => ipcRenderer.invoke('plugin:getDirectory'),
    setDirectory: (dir: string) => ipcRenderer.invoke('plugin:setDirectory', dir),
    checkUpdates: () => ipcRenderer.invoke('plugin:checkUpdates'),
    updateDescriptions: (translatedPlugins: any[]) => ipcRenderer.invoke('plugin:updateDescriptions', translatedPlugins),
    install: (url: string, branch?: string) => ipcRenderer.invoke('plugin:install', url, branch),
    uninstallById: (pluginId: string) => ipcRenderer.invoke('plugin:uninstallById', pluginId)
  },
  file: {
    selectDirectory: () => ipcRenderer.invoke('file:selectDirectory'),
    selectFile: (filters: any[]) => ipcRenderer.invoke('file:selectFile', filters),
    exists: (path: string) => ipcRenderer.invoke('file:exists', path),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
    writeBinary: (path: string, content: string, isBase64?: boolean) => ipcRenderer.invoke('file:writeBinary', path, content, isBase64),
    copyFile: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('file:copyFile', sourcePath, targetPath),
    openFolder: (path: string) => ipcRenderer.invoke('file:openFolder', path),
    openFile: (path: string) => ipcRenderer.invoke('file:openFile', path),
    readJson: (fileName: string) => ipcRenderer.invoke('file:readJson', fileName),
    readAsBase64: (path: string) => ipcRenderer.invoke('file:readAsBase64', path),
    validatePath: (path: string) => ipcRenderer.invoke('file:validatePath', path)
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    getUserDataSize: () => ipcRenderer.invoke('app:getUserDataSize'),
    getRootPath: () => ipcRenderer.invoke('app:getRootPath'),
    openConfigFile: () => ipcRenderer.invoke('app:openConfigFile')
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    pull: () => ipcRenderer.invoke('update:pull')
  },
  // 日志事件监听
  // 记忆插件 API
  memory: {
    // 获取记忆目录
    getMemoryDirectory: () => ipcRenderer.invoke('memory:getMemoryDirectory'),
    // 表格模板管理
    getAllTemplates: () => ipcRenderer.invoke('memory:getAllTemplates'),
    getTemplate: (templateId: string) => ipcRenderer.invoke('memory:getTemplate', templateId),
    createTemplate: (template: any) => ipcRenderer.invoke('memory:createTemplate', template),
    updateTemplate: (templateId: string, updates: any) => ipcRenderer.invoke('memory:updateTemplate', templateId, updates),
    deleteTemplate: (templateId: string) => ipcRenderer.invoke('memory:deleteTemplate', templateId),
    createTableFile: (chatId: string, templateId: string) => ipcRenderer.invoke('memory:createTableFile', chatId, templateId),
    readTableFile: (chatId: string) => ipcRenderer.invoke('memory:readTableFile', chatId),
    updateTableFile: (chatId: string, sheetName: string, data: any[]) => ipcRenderer.invoke('memory:updateTableFile', chatId, sheetName, data),
    getVersionHistory: (templateId: string) => ipcRenderer.invoke('memory:getVersionHistory', templateId),
    restoreVersion: (templateId: string, version: string) => ipcRenderer.invoke('memory:restoreVersion', templateId, version),
    getTemplateBindingStatus: () => ipcRenderer.invoke('memory:getTemplateBindingStatus'),
    
    // 聊天记录管理
    getChatSessions: () => ipcRenderer.invoke('memory:getChatSessions'),
    getChatSession: (chatId: string) => ipcRenderer.invoke('memory:getChatSession', chatId),
    getChatMessages: (chatId: string, page: number, pageSize: number) => ipcRenderer.invoke('memory:getChatMessages', chatId, page, pageSize),
    searchChatMessages: (keyword: string, chatId?: string) => ipcRenderer.invoke('memory:searchChatMessages', keyword, chatId),
    filterChatMessages: (chatId: string, filters: any) => ipcRenderer.invoke('memory:filterChatMessages', chatId, filters),
    processChatWithAI: (chatId: string, templateId: string, config: any) => ipcRenderer.invoke('memory:processChatWithAI', chatId, templateId, config),
    applyAIResults: (chatId: string, results: any[]) => ipcRenderer.invoke('memory:applyAIResults', chatId, results),
    deleteChatSession: (chatId: string) => ipcRenderer.invoke('memory:deleteChatSession', chatId),
    associateTemplate: (chatId: string, templateId: string) => ipcRenderer.invoke('memory:associateTemplate', chatId, templateId),
    getAssociatedTemplate: (chatId: string) => ipcRenderer.invoke('memory:getAssociatedTemplate', chatId),
    processChat: (chatId: string, templateId: string, selectedMessageIds: string[], config: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }) => ipcRenderer.invoke('memory:processChat', chatId, templateId, selectedMessageIds, config),
    processChatProgressive: (chatId: string, templateId: string, config: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }, options?: { continueFromLast?: boolean; minInterval?: number }) => ipcRenderer.invoke('memory:processChatProgressive', chatId, templateId, config, options),
    stopOrganizing: (chatId: string) => ipcRenderer.invoke('memory:stopOrganizing', chatId),
    processChatFull: (chatId: string, templateId: string, config: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }) => ipcRenderer.invoke('memory:processChatFull', chatId, templateId, config),
    executeTableEditCommands: (chatId: string, commands: any[]) => ipcRenderer.invoke('memory:executeTableEditCommands', chatId, commands),
    parseTableEdit: (content: string) => ipcRenderer.invoke('memory:parseTableEdit', content),
    getOrganizingProgress: (chatId: string) => ipcRenderer.invoke('memory:getOrganizingProgress', chatId),
    clearOrganizingProgress: (chatId: string) => ipcRenderer.invoke('memory:clearOrganizingProgress', chatId),
    clearTableData: (chatId: string) => ipcRenderer.invoke('memory:clearTableData', chatId),
    copyTemplate: (sourceTemplateId: string, newTemplateName: string) => ipcRenderer.invoke('memory:copyTemplate', sourceTemplateId, newTemplateName),// 表格数据管理
    getTableData: (chatId: string) => ipcRenderer.invoke('memory:getTableData', chatId),
    saveTableData: (chatId: string, sheetName: string, sheetData: any[]) => ipcRenderer.invoke('memory:saveTableData', chatId, sheetName, sheetData),
    autoInitializeSession: (chatId: string) => ipcRenderer.invoke('memory:autoInitializeSession', chatId),
    onLog: (callback: (message: string, type: string) => void) => {
      ipcRenderer.on('memory:addLog', (event, message, type) => {
        callback(message, type);
      });
    },

    getCharacterChatRecords: () => ipcRenderer.invoke('memory:getCharacterChatRecords'),
    getCharacterChatRecord: (fileName: string) => ipcRenderer.invoke('memory:getCharacterChatRecord', fileName),
    saveCharacterChatRecord: (fileName: string, content: string) => ipcRenderer.invoke('memory:saveCharacterChatRecord', fileName, content),
    deleteCharacterChatRecord: (fileName: string, characterCardName: string) => ipcRenderer.invoke('memory:deleteCharacterChatRecord', fileName, characterCardName),
    vectorizeCharacterChat: (fileName: string) => ipcRenderer.invoke('memory:vectorizeCharacterChat', fileName),
    getCharacterThumbnail: (characterCardName: string) => ipcRenderer.invoke('memory:getCharacterThumbnail', characterCardName),

    // 外部系统调用 API（供其他系统调用）
    external: {
      processSingleChat: (request: any) => ipcRenderer.invoke('memory:external:processSingleChat', request),
      processBatchChat: (request: any) => ipcRenderer.invoke('memory:external:processBatchChat', request)
    }
  },
  // AI 请求 API
  ai: {
    request: (config: { url: string; method: string; headers: Record<string, string>; body: any; timeout?: number; streaming?: boolean }) => 
      ipcRenderer.invoke('ai:request', config),
    cancel: () => ipcRenderer.invoke('ai:cancel')
  },
  // 创意数据 API
  creative: {
    load: () => ipcRenderer.invoke('creative:load'),
    save: (data: any) => ipcRenderer.invoke('creative:save', data),
    export: () => ipcRenderer.invoke('creative:export'),
    import: (jsonData: string) => ipcRenderer.invoke('creative:import', jsonData),
    getDirectory: () => ipcRenderer.invoke('creative:getDirectory')
  },
  // 角色卡对话数据 API
  characterChat: {
    getTestChat: (creativeId: string, characterCardId: string) => ipcRenderer.invoke('characterChat:getTestChat', creativeId, characterCardId),
    saveTestChat: (creativeId: string, characterCardId: string, characterCardName: string, messages: any[]) => ipcRenderer.invoke('characterChat:saveTestChat', creativeId, characterCardId, characterCardName, messages),
    deleteTestChat: (creativeId: string, characterCardId: string) => ipcRenderer.invoke('characterChat:deleteTestChat', creativeId, characterCardId),
    getAllTestChats: () => ipcRenderer.invoke('characterChat:getAllTestChats'),
    clearCache: () => ipcRenderer.invoke('characterChat:clearCache')
  },
  // 聊天记录版本管理 API
  chatVersion: {
    getVersions: (characterCardName: string) => ipcRenderer.invoke('chatVersion:getVersions', characterCardName),
    getVersionContent: (filePath: string) => ipcRenderer.invoke('chatVersion:getVersionContent', filePath),
    deleteVersion: (filePath: string) => ipcRenderer.invoke('chatVersion:deleteVersion', filePath),
    getVersionsDir: (characterCardName: string) => ipcRenderer.invoke('chatVersion:getVersionsDir', characterCardName),
    getLinkedVersion: (characterCardName: string, versionLinkId: string) => ipcRenderer.invoke('chatVersion:getLinkedVersion', characterCardName, versionLinkId),
    createLinkedVersion: (characterCardName: string, options: any) => ipcRenderer.invoke('chatVersion:createLinkedVersion', characterCardName, options),
    getVersionIndex: (characterCardName: string) => ipcRenderer.invoke('chatVersion:getVersionIndex', characterCardName),
    getChangeLog: (characterCardName: string, options?: any) => ipcRenderer.invoke('chatVersion:getChangeLog', characterCardName, options),
    verifyConsistency: (characterCardName: string) => ipcRenderer.invoke('chatVersion:verifyConsistency', characterCardName),
    getTableSnapshot: (characterCardName: string, versionLinkId: string) => ipcRenderer.invoke('chatVersion:getTableSnapshot', characterCardName, versionLinkId),
    getTableSnapshots: (characterCardName: string) => ipcRenderer.invoke('chatVersion:getTableSnapshots', characterCardName),
    getSnapshotContent: (filePath: string) => ipcRenderer.invoke('chatVersion:getSnapshotContent', filePath)
  },
  // 通用存储 API
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (data: { key: string; value: any }) => ipcRenderer.invoke('storage:set', data),
    delete: (key: string) => ipcRenderer.invoke('storage:delete', key),
    clear: () => ipcRenderer.invoke('storage:clear'),
    has: (key: string) => ipcRenderer.invoke('storage:has', key),
    getAll: () => ipcRenderer.invoke('storage:getAll'),
    import: (data: string) => ipcRenderer.invoke('storage:import', data)
  },
  embedding: {
    generate: (text: string) => ipcRenderer.invoke('embedding:generate', { text }),
    generateBatch: (texts: string[]) => ipcRenderer.invoke('embedding:generateBatch', { texts }),
    testConnection: (config?: any) => ipcRenderer.invoke('embedding:testConnection', config),
    listModels: (config?: any) => ipcRenderer.invoke('embedding:listModels', config),
    setMode: (mode: string) => ipcRenderer.invoke('embedding:setMode', { mode }),
    getMode: () => ipcRenderer.invoke('embedding:getMode'),
    localTest: (params?: { modelName?: string }) => ipcRenderer.invoke('embedding:localTest', params || {}),
    localGenerate: (text: string) => ipcRenderer.invoke('embedding:localGenerate', { text }),
    localInit: (modelName?: string) => ipcRenderer.invoke('embedding:localInit', { modelName }),
    checkModelStatus: (modelName: string) => ipcRenderer.invoke('embedding:checkModelStatus', { modelName })
  },
  vector: {
    add: (id: string, vector: number[], metadata: Record<string, any>) =>
      ipcRenderer.invoke('vector:add', { id, vector, metadata }),
    addBatch: (items: Array<{ id: string; vector: number[]; metadata: Record<string, any> }>) =>
      ipcRenderer.invoke('vector:addBatch', { items }),
    search: (query: number[], topK: number, filter?: Record<string, any>, scopeIds?: string[]) =>
      ipcRenderer.invoke('vector:search', { query, topK, filter, scopeIds }),
    getById: (id: string) => ipcRenderer.invoke('vector:getById', { id }),
    update: (id: string, vector: number[], metadata?: Record<string, any>) =>
      ipcRenderer.invoke('vector:update', { id, vector, metadata }),
    delete: (id: string) => ipcRenderer.invoke('vector:delete', { id }),
    count: () => ipcRenderer.invoke('vector:count'),
    rebuildIndex: () => ipcRenderer.invoke('vector:rebuildIndex'),
    testStorage: (scopeIds?: string[]) => ipcRenderer.invoke('vector:testStorage', { scopeIds }),
    getStorePath: () => ipcRenderer.invoke('vector:getStorePath'),
    testEmbedding: () => ipcRenderer.invoke('vector:testEmbedding'),
    testAll: () => ipcRenderer.invoke('vector:testAll'),
    getAvailableScopes: () => ipcRenderer.invoke('vector:getAvailableScopes')
  },
  document: {
    process: (filePath: string) => ipcRenderer.invoke('document:process', { filePath }),
    list: () => ipcRenderer.invoke('document:list'),
    delete: (docId: string) => ipcRenderer.invoke('document:delete', { docId }),
    deleteBatch: (docIds: string[]) => ipcRenderer.invoke('document:deleteBatch', { docIds }),
    getInfo: (docId: string) => ipcRenderer.invoke('document:getInfo', { docId }),
    getChunks: (docId: string) => ipcRenderer.invoke('document:getChunks', { docId }),
    searchVectors: (queryText: string, topK: number, docId?: string) => ipcRenderer.invoke('document:searchVectors', { queryText, topK, docId }),
    getVectorStats: () => ipcRenderer.invoke('document:getVectorStats'),
    generateEmbedding: (text: string) => ipcRenderer.invoke('document:generateEmbedding', { text }),
    selectFile: () => ipcRenderer.invoke('document:selectFile')
  },
  knowledge: {
    list: (filter?: Record<string, any>, page?: number, pageSize?: number) =>
      ipcRenderer.invoke('knowledge:list', { filter, page, pageSize }),
    create: (item: any) => ipcRenderer.invoke('knowledge:create', { item }),
    createBatch: (items: any[]) => ipcRenderer.invoke('knowledge:createBatch', { items }),
    update: (id: string, updates: any) => ipcRenderer.invoke('knowledge:update', { id, updates }),
    delete: (id: string) => ipcRenderer.invoke('knowledge:delete', { id }),
    deleteBatch: (ids: string[]) => ipcRenderer.invoke('knowledge:deleteBatch', { ids }),
    search: (query: string, options?: any) => ipcRenderer.invoke('knowledge:search', { query, options }),
    vectorize: (id: string) => ipcRenderer.invoke('knowledge:vectorize', { id }),
    vectorizeAll: () => ipcRenderer.invoke('knowledge:vectorizeAll'),
    uploadDocument: (filePath: string, options?: { category?: string[]; tags?: string[]; source?: string }) =>
      ipcRenderer.invoke('knowledge:uploadDocument', { filePath, options }),
    selectDocumentFile: () => ipcRenderer.invoke('knowledge:selectDocumentFile')
  },
  context: {
    retrieve: (conversation: any[], options: any) =>
      ipcRenderer.invoke('context:retrieve', { conversation, options }),
    retrieveWithKeywords: (
      conversation: any[], 
      options: any, 
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
    ) =>
      ipcRenderer.invoke('context:retrieveWithKeywords', { 
        conversation, 
        options, 
        enableKeywordMatch,
        scanDepth,
        globalScanData 
      }),
    compress: (items: any[], maxTokens: number) =>
      ipcRenderer.invoke('context:compress', { items, maxTokens })
  },
  worldbook: {
    matchKeywords: (text: string, worldBookPaths?: string[], options?: any) =>
      ipcRenderer.invoke('worldbook:matchKeywords', { text, worldBookPaths, options })
  },
  model: {
    download: (modelName: string) => ipcRenderer.invoke('model:download', { modelName }),
    isDownloaded: (modelName: string) => ipcRenderer.invoke('model:isDownloaded', { modelName }),
    getCacheDir: () => ipcRenderer.invoke('model:getCacheDir')
  },
  chatVector: {
    vectorize: (characterId: string, messages: any[]) => ipcRenderer.invoke('chatVector:vectorize', characterId, messages),
    delete: (characterId: string) => ipcRenderer.invoke('chatVector:delete', characterId),
    search: (characterId: string, query: string, topK?: number) => ipcRenderer.invoke('chatVector:search', characterId, query, topK)
  },
  // 群组聊天 API
  group: {
    getAll: () => ipcRenderer.invoke('group:getAll'),
    get: (id: string) => ipcRenderer.invoke('group:get', id),
    create: (data: any) => ipcRenderer.invoke('group:create', data),
    edit: (group: any) => ipcRenderer.invoke('group:edit', group),
    delete: (id: string) => ipcRenderer.invoke('group:delete', id)
  },
  groupChat: {
    get: (chatId: string) => ipcRenderer.invoke('group-chat:get', chatId),
    save: (chatId: string, chat: any[], force?: boolean) => ipcRenderer.invoke('group-chat:save', chatId, chat, force),
    delete: (chatId: string) => ipcRenderer.invoke('group-chat:delete', chatId),
    info: (chatId: string) => ipcRenderer.invoke('group-chat:info', chatId),
    import: (content: string, suggestedId?: string) => ipcRenderer.invoke('group-chat:import', content, suggestedId)
  }
});
