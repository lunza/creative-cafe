/**
 * 记忆插件类型定义
 */

// 表格模板相关类型
export interface TableTemplate {
  id: string;
  name: string;
  description: string;
  sheets: TableSheet[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface TableSheet {
  name: string;
  description: string;
  headers: string[];
  order: number;
}

// 聊天记录相关类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chatId: string;
}

export interface ChatSession {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  preview: string;
}

export interface AIProcessingResult {
  sheetName: string;
  updates: Record<string, any>[];
  preview: string;
}

// Electron API 类型
export interface MemoryAPI {
  // 表格模板管理
  getAllTemplates: () => Promise<TableTemplate[]>;
  getTemplate: (templateId: string) => Promise<TableTemplate | null>;
  createTemplate: (template: Omit<TableTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>) => Promise<TableTemplate>;
  updateTemplate: (templateId: string, updates: Partial<TableTemplate>) => Promise<TableTemplate | null>;
  deleteTemplate: (templateId: string) => Promise<boolean>;
  createTableFile: (chatId: string, templateId: string) => Promise<string>;
  readTableFile: (chatId: string) => Promise<Record<string, any[]>>;
  updateTableFile: (chatId: string, sheetName: string, data: any[]) => Promise<string>;
  getVersionHistory: (templateId: string) => Promise<string[]>;
  restoreVersion: (templateId: string, version: string) => Promise<TableTemplate | null>;
  
  // 聊天记录管理
  getChatSessions: () => Promise<ChatSession[]>;
  getChatSession: (chatId: string) => Promise<ChatSession | null>;
  getChatMessages: (chatId: string, page: number, pageSize: number) => Promise<{
    messages: ChatMessage[];
    total: number;
    totalPages: number;
  }>;
  searchChatMessages: (keyword: string, chatId?: string) => Promise<ChatMessage[]>;
  filterChatMessages: (chatId: string, filters: any) => Promise<ChatMessage[]>;
  processChatWithAI: (
    chatId: string,
    templateId: string,
    config: { apiKey: string; apiUrl: string; modelName: string }
  ) => Promise<AIProcessingResult[]>;
  applyAIResults: (chatId: string, results: AIProcessingResult[]) => Promise<string>;
  deleteChatSession: (chatId: string) => Promise<boolean>;
  
  // 表格数据管理
  getTableData: (chatId: string) => Promise<any>;
  saveTableData: (chatId: string, sheetName: string, sheetData: any[]) => Promise<void>;
}


