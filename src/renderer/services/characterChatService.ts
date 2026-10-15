/**
 * 对话模式（CharacterDialogueChat）渲染层服务封装
 *
 * Spec: conversation-mode-optimization-report / Phase 1 / H1
 *
 * 架构规则（对齐 writingV2Service.ts 范式）：
 * 对话模式组件禁止直接裸调 window.electronAPI，必须通过本封装访问，
 * 保证 IPC 契约类型集中、可测（mock 本对象即可），消除 any 穿透。
 *
 * 覆盖命名空间：characterChat / characterConfig / ai / sd / asset / avatar /
 *               setting / file / memory / chatHistory / chatVersion / context / character
 * 【Phase 4】新增：qualityCheck（对话质量检查）/ styleLearn（角色风格学习）
 */

// CharacterTestChat 复用 characterChatStore 的导出定义（单一真相源，避免 IPC 边界类型漂移）
import type { CharacterTestChat } from '../stores/characterChatStore';
// 【Phase 4 / L4 + L5】对话质量检查与角色风格学习的 IPC 边界类型（shared 单一来源）
import type {
  DialogueQualityCheckRequest,
  DialogueQualityReport,
  DialogueQualityFixRequest,
  DialogueQualityFixResult,
  DialogueQualityHistoryEntry,
} from '../../shared/types/dialogueQuality.types';
import type {
  CharacterStyleLearningRequest,
  CharacterStyleResource,
} from '../../shared/types/characterStyle.types';

// ==================== IPC 结果类型（对话模式边界契约） ====================

export interface IpcSuccessResult {
  success: boolean;
  error?: string;
}

export interface TraitTag {
  text: string;
  weight?: number;
  categoryId?: string;
}

export interface TraitPromptResult {
  success: boolean;
  traits?: TraitTag[];
  error?: string;
}

export interface TraitOptimizationSuggestion {
  text: string;
  reason?: string;
  weight?: number;
  categoryId?: string;
}

export interface TraitOptimizationResult {
  success: boolean;
  tagsToRemove?: TraitOptimizationSuggestion[];
  tagsToAdd?: TraitOptimizationSuggestion[];
  error?: string;
}

export type TraitPromptPhase = 'tag-generating' | 'tag-auditing' | 'image-generating';

export interface SdCheckStatusResult {
  available: boolean;
  [key: string]: unknown;
}

export interface SdGenerateResult {
  success: boolean;
  imageBase64?: string;
  finalPrompt?: string;
  error?: string;
}

export interface SdWebuiConfig {
  endpoint?: string;
  negativePrompt?: string;
  [key: string]: unknown;
}

export interface SettingLoadResult {
  success: boolean;
  setting?: {
    sdWebui?: SdWebuiConfig;
    [key: string]: unknown;
  };
  error?: string;
}

export interface AssetSavePayload {
  characterCardId: string;
  assetType: string;
  assetId: string;
  imageBase64: string;
}

export interface AvatarEntry {
  name: string;
  path: string;
  size?: number;
  modified?: Date;
}

export type { CharacterTestChat };

/**
 * 记忆表格数据。
 * 注：data 各行以数字字符串索引（"0","1",...）为键存储单元格值，行结构异构，
 * 故保持 any（与迁移前 electronAPI any 穿透行为一致，不引入新类型错误）。
 */
export interface MemoryTableResult {
  success: boolean;
  sheets?: string[];
  headers?: Record<string, string[]>;
  data?: any;
  sheetDescriptions?: Record<string, string>;
  error?: string;
}

export interface MemoryParseResult {
  success: boolean;
  commands: unknown[];
  errors: string[];
  error?: string;
}

export interface MemoryExecuteResult {
  success: boolean;
  executed?: number;
  errors?: string[];
  error?: string;
}

export interface ProgressiveOrganizeResult {
  success: boolean;
  processedCount?: number;
  errorCount?: number;
  errors?: string[];
  error?: string;
}

export interface VersionContentData {
  messages: unknown[];
  versionLinkId?: string;
  [key: string]: unknown;
}

export interface ContextRetrievalItem {
  source?: string;
  score?: number;
  content?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ContextRetrievalResult {
  success: boolean;
  items?: ContextRetrievalItem[];
  vectorItems?: ContextRetrievalItem[];
  keywordItems?: ContextRetrievalItem[];
  error?: string;
}

export interface ChatHistoryItem {
  content: string;
  score: number;
  timestamp: number;
}

export interface PersonaFileData {
  id?: string;
  name?: string;
  description?: string;
  avatarPath?: string;
  isGeneric?: boolean;
  isSystem?: boolean;
  [key: string]: unknown;
}

export interface ChatVersionEntry {
  fileName: string;
  filePath: string;
  sequenceNumber: number;
  timestamp: number;
  messageCount: number;
  versionLinkId?: string;
}

// ==================== 服务实现 ====================

function api(): any {
  return (window as Window & { electronAPI?: any }).electronAPI;
}

/** characterChat 命名空间：测试对话 CRUD */
export const characterChat = {
  /** 读取角色测试对话（不存在时返回 null） */
  getTestChat: (creativeId: string, characterCardId: string): Promise<CharacterTestChat | null> =>
    api().characterChat.getTestChat(creativeId, characterCardId),
};

/** characterConfig 命名空间：对话配置持久化 */
export const characterConfig = {
  save: (characterCardId: string, config: Record<string, unknown>): Promise<IpcSuccessResult> =>
    api().characterConfig.save(characterCardId, config),
  load: (characterCardId: string): Promise<{ success: boolean; config?: Record<string, unknown>; error?: string }> =>
    api().characterConfig.load(characterCardId),
};

/** ai 命名空间：AI 请求与进度事件 */
export const ai = {
  /** 生成上下文互动标签（含 L0-L5 审计），期间推送 traitPromptProgress 事件 */
  generateTraitPrompts: (args: { prompt: string; baseTraits: string }): Promise<TraitPromptResult> =>
    api().ai.generateTraitPrompts(args),
  /** AI 标签优化（删除 + 补充），失败时调用方需降级为不优化 */
  optimizeTraitsForContext: (args: {
    traits: TraitTag[];
    conversationContext: string;
  }): Promise<TraitOptimizationResult> => api().ai.optimizeTraitsForContext(args),
  /**
   * 订阅图片生成阶段进度事件（Spec: enhance-conversation-image-bubble / Task 9.7）。
   * 【Phase 1 / H4】preload 已改为返回 unsubscribe 函数，调用方在 cleanup 中直接调用，
   * 取代原先 offTraitPromptProgress() 一次性 removeAllListeners 的非标准模式。
   */
  subscribeTraitPromptProgress: (
    callback: (data: { phase: TraitPromptPhase }) => void
  ): (() => void) => api().ai.onTraitPromptProgress(callback),
  /** 兼容旧接口：一次性移除全部 traitPromptProgress 监听器 */
  offTraitPromptProgress: (): void => api().ai.offTraitPromptProgress(),
  /** 订阅故障转移事件，返回 unsubscribe */
  onFailover: (
    callback: (data: {
      type: 'retry' | 'switch';
      toProvider?: string;
      toModel?: string;
      reason: string;
      attempt?: number;
    }) => void
  ): (() => void) => api().ai.failover.onFailover(callback),
};

/** sd 命名空间：SD WebUI 图片生成 */
export const sd = {
  checkStatus: (endpoint: string): Promise<SdCheckStatusResult> =>
    api().sd.checkStatus(endpoint),
  generateTxt2Img: (args: {
    endpoint: string;
    prompt: string;
    negativePrompt: string;
    /** SDGenerationOptions 为 interface（无隐式索引签名），不能赋给 Record<string, unknown>，故放宽为 object */
    options: object;
  }): Promise<SdGenerateResult> => api().sd.generateTxt2Img(args),
};

/** asset 命名空间：素材保存/删除 */
export const asset = {
  save: (payload: AssetSavePayload): Promise<IpcSuccessResult> =>
    api().asset.save(payload),
  delete: (payload: Record<string, unknown>): Promise<IpcSuccessResult> =>
    api().asset.delete(payload),
};

/** avatar 命名空间：人设（头像目录）读取 */
export const avatar = {
  list: (): Promise<AvatarEntry[]> => api().avatar.list(),
  read: (path: string): Promise<PersonaFileData | null> =>
    api().avatar.read(path),
};

/** setting 命名空间：系统设置读取 */
export const setting = {
  load: (): Promise<SettingLoadResult> => api().setting.load(),
};

/** file 命名空间：文件读写与目录选择 */
export const file = {
  selectDirectory: (): Promise<string | null> => api().file.selectDirectory(),
  write: (path: string, content: string): Promise<IpcSuccessResult> =>
    api().file.write(path, content),
};

/** memory 命名空间：记忆表格与整理 */
export const memory = {
  getTableData: (chatId: string): Promise<MemoryTableResult> =>
    api().memory.getTableData(chatId),
  parseTableEdit: (content: string): Promise<MemoryParseResult> =>
    api().memory.parseTableEdit(content),
  executeTableEditCommands: (chatId: string, commands: unknown[]): Promise<MemoryExecuteResult> =>
    api().memory.executeTableEditCommands(chatId, commands),
  processChatProgressive: (
    chatId: string,
    content: string,
    engineConfig: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<ProgressiveOrganizeResult> => api().memory.processChatProgressive(chatId, content, engineConfig, options),
  stopOrganizing: (chatId: string): Promise<IpcSuccessResult> =>
    api().memory.stopOrganizing(chatId),
  restoreTableFromSnapshot: (chatId: string, versionLinkId: string): Promise<IpcSuccessResult> =>
    api().memory.restoreTableFromSnapshot(chatId, versionLinkId),
};

/** chatHistory 命名空间：对话历史 RAG 检索与向量化 */
export const chatHistory = {
  retrieve: (...args: unknown[]): Promise<ChatHistoryItem[]> => api().chatHistory.retrieve(...args),
  /** 增量向量化（fire-and-forget，失败仅记录日志） */
  vectorizeIncremental: (chatId: string, recentMessages: unknown[]): Promise<unknown> =>
    api().chatHistory.vectorizeIncremental(chatId, recentMessages),
};

/** chatVersion 命名空间：消息版本管理 */
export const chatVersion = {
  getVersions: (characterCardName: string): Promise<ChatVersionEntry[]> =>
    api().chatVersion.getVersions(characterCardName),
  getVersionIndex: (characterCardName: string): Promise<unknown> =>
    api().chatVersion.getVersionIndex(characterCardName),
  getVersionContent: (versionFilePath: string): Promise<VersionContentData> =>
    api().chatVersion.getVersionContent(versionFilePath),
  /** 【Phase 2 / M6】手动全局快照：创建聊天版本 + 表格快照（versionLinkId 关联），N1 */
  createLinkedVersion: (
    characterCardName: string,
    options: {
      messages?: unknown[];
      description?: string;
      triggerType?: 'auto' | 'manual' | 'aiOrganize';
      source?: 'user' | 'ai' | 'system';
    }
  ): Promise<{ success: boolean; versionLinkId?: string; error?: string; [key: string]: unknown }> =>
    api().chatVersion.createLinkedVersion(characterCardName, options),
  deleteVersion: (filePath: string): Promise<boolean> =>
    api().chatVersion.deleteVersion(filePath),
};

/** character 命名空间：角色卡读取 */
export const character = {
  getWorldBookRelations: (characterCardId: string): Promise<Array<Record<string, any>> | null> =>
    api().character.getWorldBookRelations(characterCardId),
};

/** context 命名空间：知识库检索 */
export const context = {
  retrieveWithKeywords: (...args: unknown[]): Promise<ContextRetrievalResult> =>
    api().context.retrieveWithKeywords(...args),
};

/**
 * 【Phase 4 / L4 - conversation-mode-optimization-report】qualityCheck 命名空间：
 * 对话质量检查与人设一致性检查（参考写作模式 V2PlotCheckPanel / PlotCheckerService）。
 */
export const qualityCheck = {
  /** 执行对话质量检查（人设一致性 / 对话连贯性 / 情感表达合理性三维度） */
  check: (
    request: DialogueQualityCheckRequest
  ): Promise<{ success: boolean; report: DialogueQualityReport | null; error: string | null }> =>
    api().characterQuality.check(request),
  /** 对单个问题执行 AI 自动修正（重写目标消息，保持角色语言风格） */
  fixIssue: (request: DialogueQualityFixRequest): Promise<DialogueQualityFixResult> =>
    api().characterQuality.fixIssue(request),
  /** 获取检查历史（评分趋势，按时间升序） */
  getHistory: (characterCardId: string): Promise<DialogueQualityHistoryEntry[]> =>
    api().characterQuality.getHistory(characterCardId).then((r: { history: DialogueQualityHistoryEntry[] }) => r.history),
  /** 清空指定角色的检查历史 */
  clearHistory: (characterCardId: string): Promise<IpcSuccessResult> =>
    api().characterQuality.clearHistory(characterCardId),
};

/**
 * 【Phase 4 / L5 - conversation-mode-optimization-report】styleLearn 命名空间：
 * 角色风格学习（学习素材为对话历史中的 AI 回复，产物按角色卡一份持久化）。
 */
export const styleLearn = {
  /** 基于对话历史学习角色语言风格 */
  learn: (
    request: CharacterStyleLearningRequest
  ): Promise<{ success: boolean; resource: CharacterStyleResource | null; error: string | null }> =>
    api().characterStyle.learn(request),
  /** 列出全部角色的风格档案 */
  list: (): Promise<CharacterStyleResource[]> =>
    api().characterStyle.list().then((r: { styles: CharacterStyleResource[] }) => r.styles),
  /** 获取指定角色的风格档案 */
  get: (characterCardId: string): Promise<CharacterStyleResource | null> =>
    api().characterStyle.get(characterCardId).then((r: { style: CharacterStyleResource | null }) => r.style),
  /** 删除指定角色的风格档案 */
  delete: (characterCardId: string): Promise<IpcSuccessResult> =>
    api().characterStyle.delete(characterCardId),
};
