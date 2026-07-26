/**
 * 聊天消息统一类型定义（单一真源）
 *
 * 项目中存在多处 `ChatMessage` 重复定义，经分析可归为 4 种语义：
 *
 * 1. `AIRequestMessage` - AI API 请求负载（仅 role + content）
 *    消费方：AIService / WritingEngine / OutlineGenerator / ContentGenerator / AIAssistedChapterService
 *
 * 2. `MemoryChatMessage` - 记忆插件持久化聊天消息（id + chatId + string 时间戳）
 *    消费方：renderer/types/memory.ts、main/services/memory/logger.ts、MemoryChat/ChatManager.tsx
 *
 * 3. `ChatMessage` - 创意/角色卡聊天消息（id + number 时间戳，可选 status/speakerName/versionInfo）
 *    消费方：creativeStore / characterChatStore / creativeHandlers / ChatStorageService /
 *           CharacterDialogueChat.types.ts
 *
 * 4. `SillyTavernChatMessage` - SillyTavern 格式消息（含 name / is_user / send_date 等字段）
 *    消费方：ChatVectorizationService（用于向量化外部导入的 SillyTavern 聊天记录）
 *
 * 设计原则：
 * - 语义不同的类型不强行合并（避免 timestamp: string | number 这种破坏性联合）
 * - 字段并集仅用于"真正重复"的定义（如 creative/character 各处的 ChatMessage）
 * - 消费方迁移由后续任务处理，当前仅创建 shared 新定义
 */

/**
 * AI API 请求消息 - OpenAI 风格的最小负载
 *
 * 仅包含 role 与 content，用于构造发送给 LLM 的 messages 数组。
 * 不携带 id / timestamp 等持久化字段。
 *
 * @property role    消息角色（system / user / assistant）
 * @property content 消息文本内容
 */
export interface AIRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 创意/角色卡聊天消息 - 项目中最常见的 ChatMessage 形态
 *
 * 用于 creativeStore / characterChatStore / ChatStorageService / CharacterDialogueChat
 * 等场景。CharacterDialogueChat 扩展了 status / speakerName / versionInfo 三个可选字段，
 * 这里取并集作为统一接口。
 *
 * @property id           消息唯一标识
 * @property role         消息角色（user / assistant / system）
 * @property content      消息文本内容
 * @property timestamp    消息时间戳（ms 数值）
 * @property status       发送状态（可选，仅 CharacterDialogueChat 使用）
 * @property speakerName  发言者名称（可选，仅 CharacterDialogueChat 使用）
 * @property versionInfo  版本信息（可选，仅 CharacterDialogueChat 使用）
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  speakerName?: string;
  /** AI 推荐选项（辅助模式开启时，AI 回复中解析出的 3 个推荐选项） */
  suggestedOptions?: string[];
  versionInfo?: ChatMessageVersionInfo;
}

/**
 * 聊天消息版本信息 - 用于 CharacterDialogueChat 的版本快照体系
 *
 * @property versionFilePath        版本快照文件路径
 * @property isLatestVersion        是否为最新版本
 * @property versionSequenceNumber  版本序号
 * @property allVersions            全部版本摘要列表
 * @property versionLinkId          版本链 ID（可选）
 * @property tableSnapshotExists    是否存在表格快照（可选）
 * @property consistencyStatus      一致性状态（可选）
 */
export interface ChatMessageVersionInfo {
  versionFilePath: string;
  isLatestVersion: boolean;
  versionSequenceNumber: number;
  allVersions: ChatVersionSummary[];
  versionLinkId?: string;
  tableSnapshotExists?: boolean;
  consistencyStatus?: 'matched' | 'mismatched' | 'partial';
}

/**
 * 聊天版本摘要
 *
 * @property fileName              版本文件名
 * @property filePath             版本文件路径
 * @property sequenceNumber       序号
 * @property timestamp            时间戳（ms）
 * @property messageCount         消息数
 * @property versionLinkId        版本链 ID（可选）
 * @property tableSnapshotExists  是否存在表格快照（可选）
 */
export interface ChatVersionSummary {
  fileName: string;
  filePath: string;
  sequenceNumber: number;
  timestamp: number;
  messageCount: number;
  versionLinkId?: string;
  tableSnapshotExists?: boolean;
}

/**
 * 记忆插件聊天消息 - 用于 MemoryChat 模块
 *
 * 与 `ChatMessage` 的区别：
 * - `timestamp` 为 ISO 字符串（非 number）
 * - 必须携带 `chatId` 标识所属会话
 *
 * @property id        消息唯一标识
 * @property role      消息角色（user / assistant / system）
 * @property content    消息文本内容
 * @property timestamp  ISO 时间字符串
 * @property chatId     所属会话 ID
 */
export interface MemoryChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chatId: string;
}

/**
 * SillyTavern 格式聊天消息 - 用于导入外部聊天记录
 *
 * 镜像 SillyTavern 的消息结构，供 ChatVectorizationService 在向量化
 * 外部导入的聊天记录时使用。与项目原生 ChatMessage 语义不同，不进行合并。
 *
 * @property name         发言者显示名
 * @property is_user       是否为用户消息
 * @property is_system     是否为系统消息
 * @property send_date     发送时间（SillyTavern 格式字符串）
 * @property mes           消息正文
 * @property extra         附加信息（可选）
 * @property swipes        候选回复列表（可选）
 * @property swipe_id      当前选中的候选索引（可选）
 * @property swipe_info    候选回复元信息（可选）
 * @property hash_sheets   表格哈希（可选）
 */
export interface SillyTavernChatMessage {
  name: string;
  is_user: boolean;
  is_system: boolean;
  send_date: string;
  mes: string;
  extra?: any;
  swipes?: string[];
  swipe_id?: number;
  swipe_info?: any[];
  hash_sheets?: any;
}

/**
 * ChatVectorizationService 使用的聊天消息
 *
 * 该接口兼容 SillyTavern 格式（name / create_date）与项目原生格式（role / content），
 * 并保留索引签名以容纳未声明字段。仅用于 ChatVectorizationService 内部消费。
 *
 * @property role        消息角色（user / assistant / system）
 * @property content     消息正文
 * @property name        发言者显示名（可选，SillyTavern 格式）
 * @property create_date 创建时间戳（可选，SillyTavern 格式，毫秒数值）
 */
export interface ChatVectorizationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
  create_date?: number;
  [key: string]: any;
}
