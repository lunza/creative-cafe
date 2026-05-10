// 角色测试聊天类型定义

// 聊天消息接口
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  speakerName?: string;
}

// 聊天状态接口
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
}

// 角色信息接口
export interface CharacterInfo {
  creativeId: string;
  characterCardId: string;
  characterCardName: string;
  characterCardContent?: string;
  avatarPath?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
  alternate_greetings?: string[];
  tags?: string[];
  character_version?: string;
  creator?: string;
}

// 聊天操作接口
export interface ChatActions {
  sendMessage: (content: string) => Promise<void>;
  continueConversation: () => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  clearChat: () => Promise<void>;
  cancelRequest: () => void;
}

// 聊天配置接口
export interface ChatConfig {
  maxTokens?: number;
  temperature?: number;
  streaming?: boolean;
  timeout?: number;
}

// ==================== 新增类型：人设与AI参数配置 ====================

// 用户人设接口
export interface UserPersona {
  id: string;
  name: string;
  description: string;
  avatarPath: string;
  createdAt: number;
  updatedAt: number;
}

// AI参数配置
export interface AIParameterConfig {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

// 知识库绑定信息
export interface KnowledgeBaseBinding {
  documentId: string;
  documentName: string;
  enabled: boolean;
  priority: number;
}

// 角色会话配置（存储每个角色的自定义参数）
export interface CharacterSessionConfig {
  characterCardId: string;
  selectedPersonaId?: string;
  customParameters?: AIParameterConfig;
  boundKnowledgeBaseIds?: string[];
  knowledgeBaseBindings?: KnowledgeBaseBinding[];
  memoryTableEnabled?: boolean;
  memoryTableAutoOrganize?: boolean;
  memoryTableOrganizeMode?: 'sync' | 'async'; // 新增：整理模式，默认'sync'
  lastUpdated: number;
}

// 记忆表格配置
export interface MemoryTableConfig {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async'; // 新增：整理模式
}

// 记忆表格数据结构
export interface MemoryTableSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
}

// 记忆表格数据（完整结构）
export interface MemoryTableData {
  chatId: string;
  sheets: MemoryTableSheet[];
}

// 完整AI参数（合并后的最终参数）
export interface EffectiveAIParams extends AIParameterConfig {
  source: 'global' | 'persona' | 'custom';
}
