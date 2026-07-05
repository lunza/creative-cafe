/**
 * 游戏模式共享类型定义（单一真源）
 *
 * 用于创作中心游戏模式（Game Mode），覆盖：
 * - 游戏元数据（GameMeta）
 * - 游戏存档（GameSave）
 * - 游戏表格数据（GameTableData，结构对齐 WritingTableData）
 * - 游戏类型模板接口（GameTypeTemplate）
 * - AI 叙事请求与流式响应（GameNarrativeRequest / GameNarrativeChunk）
 *
 * 设计原则：
 * - 复用项目既有的 AIService / tableEdit 协议 / WritingTableData 结构
 * - 与 writing.types.ts 中的 WritingTableData 同构，但命名为 GameTableData 以避免命名冲突
 * - 类型仅定义，业务逻辑分布在 main/services/game 与 renderer/components/Game
 */

import type { WritingTableData } from './writing-table.types';

// ==================== 枚举 ====================

/**
 * 游戏类型枚举
 *
 * 用于标识游戏的大类，决定加载哪个模板、表格 schema、prompt builder。
 * 新增游戏类型时需同时更新 GAME_TYPE_LABELS 与 GameTemplateRegistry 注册。
 */
export enum GameType {
  /** 狼人杀 - 多人推理/阵营博弈 */
  WEREWOLF = 'werewolf',
  /** 逆转裁判类推理 - 证据收集/法庭辩论 */
  MYSTERY = 'mystery',
  /** 恋爱模拟 - 好感度/约会事件 */
  DATING_SIM = 'dating_sim',
  /** 文字模拟经营 - 资源/设施/回合制 */
  MANAGEMENT = 'management',
  /** 文字 RPG - 角色属性/技能树/装备 */
  TEXT_RPG = 'text_rpg'
}

/**
 * 游戏状态枚举
 *
 * 用于大厅卡片显示状态徽标。
 */
export enum GameStatus {
  /** 已完成 - 可完整游玩 */
  COMPLETED = 'completed',
  /** 开发中 - 框架已接入但内容/玩法未完整 */
  IN_DEVELOPMENT = 'in_development',
  /** 计划中 - 仅元数据占位，未实现 */
  PLANNED = 'planned'
}

/**
 * 游戏模式视图枚举
 *
 * 用于 gameUIStore.currentView 状态，决定 GameModeEntry 渲染哪个页面。
 */
export enum GameView {
  /** 游戏大厅 */
  LOBBY = 'lobby',
  /** 游戏详情页 */
  DETAIL = 'detail',
  /** 游戏主页面（运行时） */
  MAIN = 'main'
}

/**
 * 游戏叙事生成状态
 *
 * 与 GenerationState（写作模式）语义对齐，但单独定义以避免跨模块耦合。
 */
export enum GameNarrativeState {
  IDLE = 'idle',
  PREPARING = 'preparing',
  GENERATING = 'generating',
  STREAMING = 'streaming',
  COMPLETED = 'completed',
  STOPPED = 'stopped',
  ERROR = 'error'
}

/**
 * 表格整理模式
 *
 * - sync: 同步整理（AI 回复后由系统主动调用整理服务）
 * - async: 异步整理（AI 在回复末尾自带 tableEdit 标签，由 parser 解析后应用）
 *
 * 与 WritingTableConfig.organizeMode 同构。
 */
export type GameTableOrganizeMode = 'sync' | 'async';

// ==================== 游戏元数据 ====================

/**
 * 游戏元数据 - 单个游戏的描述信息
 *
 * 持久化路径：`data/games/<gameId>/meta.json`
 * 索引文件：`data/games/games-index.json`（仅含摘要字段）
 *
 * @property id              游戏 ID（如 pastoral_town）
 * @property type            游戏类型
 * @property title           游戏标题
 * @property subtitle        副标题/宣传语
 * @property description     详细介绍（支持多行文本）
 * @property gameplay        玩法说明
 * @property developer       开发者信息
 * @property version         版本号（如 1.0.0）
 * @property status          游戏状态
 * @property coverPath       封面图路径（可选，缺省时使用类型默认占位）
 * @property tags            标签（如 ["经营","回合制","农场"]）
 * @property createdAt       创建时间（ms 时间戳）
 * @property updatedAt       最后更新时间（ms 时间戳）
 * @property templateKey     模板 key（与 GameType 一致，预留供同一类型多模板扩展）
 */
export interface GameMeta {
  id: string;
  type: GameType;
  title: string;
  subtitle: string;
  description: string;
  gameplay: string;
  developer: string;
  version: string;
  status: GameStatus;
  coverPath?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  templateKey?: string;
}

/**
 * 游戏索引摘要 - games-index.json 中的单条记录
 *
 * 用于大厅列表展示，避免加载所有 meta.json。
 * 字段为 GameMeta 的子集，新增字段需同步更新。
 */
export interface GameIndexEntry {
  id: string;
  type: GameType;
  title: string;
  subtitle: string;
  status: GameStatus;
  coverPath?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 游戏索引文件结构
 *
 * @property version  索引格式版本
 * @property games    游戏摘要列表
 */
export interface GamesIndex {
  version: string;
  games: GameIndexEntry[];
}

// ==================== 游戏存档 ====================

/**
 * 游戏存档元数据
 *
 * 持久化路径：`data/game-saves/<saveId>/save.json`
 *
 * @property id              存档 ID（uuid）
 * @property gameId           所属游戏 ID
 * @property gameType         所属游戏类型（冗余字段，便于无 game.meta 时也能识别类型）
 * @property name             存档名称（用户输入或自动生成）
 * @property isAuto           是否自动存档
 * @property createdAt        创建时间（ms）
 * @property updatedAt        最后更新时间（ms）
 * @property currentTurn       当前回合（适用于回合制游戏，非回合制游戏为 null）
 * @property currentNodeId     当前剧情节点 ID（由模板定义，用于存档列表展示进度）
 * @property nodeTitle         当前节点标题（用于存档列表展示，避免读 table 才能显示）
 * @property turnCount         已进行回合数
 * @property messageCount       剧情日志消息数
 * @property stateSnapshotPath 自定义状态快照路径（相对存档目录）
 */
export interface GameSaveMeta {
  id: string;
  gameId: string;
  gameType: GameType;
  name: string;
  isAuto: boolean;
  createdAt: number;
  updatedAt: number;
  currentTurn: number | null;
  currentNodeId: string | null;
  nodeTitle: string | null;
  turnCount: number;
  messageCount: number;
  stateSnapshotPath?: string;
}

/**
 * 完整存档数据 - save.json 的结构
 *
 * 包含存档元数据 + 剧情日志 + 自定义状态快照。
 * 表格数据单独存于 `tables/table-data.json`。
 *
 * @property meta             存档元数据
 * @property narrativeLog     剧情日志（消息数组，对齐 ChatMessage 结构）
 * @property stateSnapshot    模板自定义状态快照（由 serializeState 生成）
 */
export interface GameSaveData {
  meta: GameSaveMeta;
  narrativeLog: GameNarrativeMessage[];
  stateSnapshot?: Record<string, any>;
}

/**
 * 游戏叙事消息 - 剧情日志的单条消息
 *
 * 复用 ChatMessage 的核心字段，但移除 versionInfo（游戏不需要版本快照），
 * 增加 turn 与 nodeId 字段以支持剧情节点定位。
 *
 * @property id           消息 ID
 * @property role         消息角色（user=玩家行动 / assistant=AI 叙事 / system=系统提示）
 * @property content      消息文本
 * @property timestamp    ms 时间戳
 * @property turn         所属回合（可选）
 * @property nodeId       所属剧情节点 ID（可选）
 * @property speakerName  发言者名称（可选，如 NPC 名）
 */
export interface GameNarrativeMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  turn?: number;
  nodeId?: string;
  speakerName?: string;
}

// ==================== 游戏表格数据 ====================

/**
 * 游戏表格数据 - 结构对齐 WritingTableData
 *
 * 持久化路径：`data/game-saves/<saveId>/tables/table-data.json`
 *
 * 与 WritingTableData 完全同构，仅类型名不同以避免命名冲突。
 * 复用 WritingTableData 类型别名即可。
 */
export type GameTableData = WritingTableData;

/**
 * 游戏表格配置 - 结构对齐 WritingTableConfig
 *
 * 持久化路径：`data/game-saves/<saveId>/tables/table-config.json`
 */
export interface GameTableConfig {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: GameTableOrganizeMode;
  associatedTemplateId: string | null;
  associatedTemplateName: string;
  organizeRequirements?: string;
}

/**
 * 游戏表格 schema 定义 - 模板声明所需 sheet 结构
 *
 * 由游戏模板通过 GameTypeTemplate.tableSchema 提供，
 * 在新建存档时用于初始化空表格，并注入 AI prompt 指导 tableEdit 命令生成。
 *
 * @property sheets              sheet 名称列表（顺序敏感，对应 tableEdit 中的表格索引）
 * @property headers             每个 sheet 的列头列表（key 为 sheet 名）
 * @property sheetDescriptions    每个 sheet 的用途描述
 */
export interface GameTableSchema {
  sheets: string[];
  headers: Record<string, string[]>;
  sheetDescriptions: Record<string, string>;
}

// ==================== 游戏配置 ====================

/**
 * 游戏本地配置 - 每个游戏独立的运行时配置
 *
 * 持久化路径：`data/games/<gameId>/config.json`
 *
 * @property activeEngineId    AI 引擎 ID（从 settingStore.aiEngines 中选择）
 * @property temperature        温度
 * @property maxTokens          最大 token
 * @property organizeMode       表格整理模式
 * @property ansiTheme          ANSI 配色主题（如 'default' / 'dark' / 'solarized'）
 * @property autoSave           是否启用自动存档
 */
export interface GameLocalConfig {
  activeEngineId: string | null;
  temperature: number;
  maxTokens: number;
  organizeMode: GameTableOrganizeMode;
  ansiTheme: string;
  autoSave: boolean;
}

// ==================== AI 叙事请求与响应 ====================

/**
 * 游戏叙事生成请求
 *
 * 由渲染进程通过 IPC 发送给主进程 GameNarrativeService。
 *
 * @property gameId           游戏 ID
 * @property saveId           存档 ID
 * @property gameType         游戏类型
 * @property userAction       玩家行动（如 "build:farm" / "end_turn" / 自由文本）
 * @property modelConfig      模型配置（如未提供则从 settingStore 读取）
 * @property organizeMode     表格整理模式（如未提供则从 GameLocalConfig 读取）
 * @property templateSystemPrompt  模板提供的额外 system prompt 片段（如经营模板的经济规则）。
 *                                 【重要】游戏模板注册中心在渲染进程，主进程无法直接访问。
 *                                 因此渲染进程在调用 generateNarrative 时需将模板的额外规则
 *                                 通过此字段传入，由主进程拼接到 system prompt 末尾。
 * @property tableSchema      模板声明的表格 schema（用于 prompt 构建时的列头提示）。
 *                                 与 templateSystemPrompt 同理，由渲染进程从模板注册中心
 *                                 取出后传入主进程，避免主进程依赖渲染进程的注册中心。
 */
export interface GameNarrativeRequest {
  gameId: string;
  saveId: string;
  gameType: GameType;
  userAction: string;
  modelConfig?: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
  organizeMode?: GameTableOrganizeMode;
  templateSystemPrompt?: string;
  tableSchema?: GameTableSchema;
}

/**
 * 游戏叙事流式 chunk - 通过 IPC 事件 game:narrative:chunk 推送
 *
 * @property saveId      存档 ID（用于多存档并发区分）
 * @property chunk       流式文本片段
 * @property index       chunk 序号（从 0 开始）
 */
export interface GameNarrativeChunk {
  saveId: string;
  chunk: string;
  index: number;
}

/**
 * 游戏叙事完成事件 - 通过 IPC 事件 game:narrative:complete 推送
 *
 * @property saveId           存档 ID
 * @property fullText         完整叙事文本（已剥离 tableEdit 标签）
 * @property tableChanges     表格变更摘要（包含执行的命令数与受影响的 sheet）
 * @property tableEdits        解析出的 tableEdit 命令原文（用于审计）
 * @property generationTime   生成耗时（ms）
 * @property model            使用的模型名
 */
export interface GameNarrativeComplete {
  saveId: string;
  fullText: string;
  tableChanges: {
    commandsExecuted: number;
    affectedSheets: string[];
    errors: string[];
  };
  tableEdits: string[];
  generationTime: number;
  model: string;
}

/**
 * 游戏叙事错误事件 - 通过 IPC 事件 game:narrative:error 推送
 *
 * @property saveId   存档 ID
 * @property error    错误信息
 * @property code     错误代码
 */
export interface GameNarrativeError {
  saveId: string;
  error: string;
  code: string;
}

/**
 * 游戏表格更新事件 - 通过 IPC 事件 game:table:updated 推送
 *
 * 在 tableEdit 命令应用成功后推送，渲染进程据此刷新面板。
 *
 * @property saveId       存档 ID
 * @property changes       变更摘要
 */
export interface GameTableUpdated {
  saveId: string;
  changes: GameNarrativeComplete['tableChanges'];
}

// ==================== 游戏类型模板接口 ====================

/**
 * 游戏类型模板接口 - 渲染进程
 *
 * 新增游戏类型时需实现此接口并注册到 GameTemplateRegistry。
 * 模板负责声明：所需面板、表格 schema、自定义状态序列化、主组件。
 *
 * 注意：此接口在渲染进程使用，Component 字段为懒加载的 React 组件。
 */
export interface GameTypeTemplate {
  /** 游戏类型 */
  type: GameType;
  /** 模板元数据（用于无 GameMeta 时的大厅占位显示） */
  meta: {
    title: string;
    subtitle: string;
    description: string;
    gameplay: string;
    developer: string;
    version: string;
    status: GameStatus;
    tags: string[];
  };
  /** 声明所需面板 key（如 ['resource', 'facility', 'statistics']） */
  panels: string[];
  /** 表格 schema 定义 */
  tableSchema: GameTableSchema;
  /** 懒加载的 React 组件（动态 import） */
  Component: React.LazyExoticComponent<React.ComponentType<GameTemplateProps>>;
  /** 序列化模板自定义状态（用于存档） */
  serializeState?: (state: Record<string, any>) => Record<string, any>;
  /** 反序列化模板自定义状态（用于读档） */
  deserializeState?: (snapshot: Record<string, any>) => Record<string, any>;
  /** "其他"按钮回调（如未注册，详情页隐藏该按钮） */
  onOtherAction?: () => void;
  /** 初始状态（新建存档时使用） */
  getInitialState?: () => Record<string, any>;
}

/**
 * 游戏模板组件 Props
 *
 * 传递给 GameTypeTemplate.Component 的 props。
 *
 * @property saveId     当前存档 ID
 * @property gameId      所属游戏 ID
 * @property tableData  当前表格数据快照（由 GameMainPage 从 store 传入）
 * @property onAction   玩家行动回调（触发叙事生成）
 */
export interface GameTemplateProps {
  saveId: string;
  gameId: string;
  tableData: GameTableData | null;
  onAction: (userAction: string) => void;
}

// ==================== tableEdit 命令类型 ====================

/**
 * tableEdit 命令类型枚举（游戏模块专用）
 *
 * 与对话模式/写作模式保持一致的协议，但类型名加 Game 前缀以避免
 * 与 `src/main/services/memory/tableEditParser.ts` 中的同名类型混淆。
 */
export enum GameTableEditCommandType {
  INSERT_ROW = 'insertRow',
  UPDATE_ROW = 'updateRow',
  DELETE_ROW = 'deleteRow'
}

/**
 * tableEdit 命令解析结果（游戏模块专用）
 *
 * @property type       命令类型
 * @property sheetIndex 表格索引（从 1 开始）
 * @property rowIndex   行索引（从 1 开始，insertRow 时无此字段）
 * @property rowData    行数据（insertRow / updateRow 时存在）
 */
export interface GameTableEditCommand {
  type: GameTableEditCommandType;
  sheetIndex: number;
  rowIndex?: number;
  rowData?: Record<string, any>;
  /** 原始命令文本（用于审计与错误定位） */
  raw: string;
}

/**
 * tableEdit 解析结果（游戏模块专用）
 *
 * @property commands   解析出的命令列表
 * @property errors     解析失败的命令原文列表（用于审计）
 */
export interface GameTableEditParseResult {
  commands: GameTableEditCommand[];
  errors: string[];
}

// ==================== 默认配置 ====================

/**
 * 默认游戏本地配置
 *
 * 新建游戏时使用，可被用户在选项对话框中覆盖。
 */
export const DEFAULT_GAME_LOCAL_CONFIG: GameLocalConfig = {
  activeEngineId: null,
  temperature: 0.7,
  maxTokens: 32768,
  organizeMode: 'async',
  ansiTheme: 'default',
  autoSave: true
};

/**
 * 自动存档保留数量上限
 *
 * 超过此数量的最旧自动存档将被删除。
 */
export const MAX_AUTO_SAVES = 5;

/**
 * 自动存档文件名后缀
 */
export const AUTO_SAVE_SUFFIX = '_auto';
