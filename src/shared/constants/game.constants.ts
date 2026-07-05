/**
 * 游戏模式常量定义
 *
 * 与 game.types.ts 配套使用，提供枚举标签映射、默认值、超时配置等。
 * 与 writing.constants.ts 的结构对齐。
 */

import {
  GameType,
  GameStatus,
  GameView,
  GameNarrativeState,
  type GameTableSchema
} from '../types/game.types';
import { DEFAULT_GAME_LOCAL_CONFIG, MAX_AUTO_SAVES, AUTO_SAVE_SUFFIX } from '../types/game.types';

// ==================== 枚举标签映射 ====================

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  [GameType.WEREWOLF]: '狼人杀',
  [GameType.MYSTERY]: '推理',
  [GameType.DATING_SIM]: '恋爱模拟',
  [GameType.MANAGEMENT]: '经营',
  [GameType.TEXT_RPG]: '文字RPG'
};

export const GAME_TYPE_OPTIONS = Object.entries(GAME_TYPE_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const GAME_TYPE_ICON_COLORS: Record<GameType, string> = {
  [GameType.WEREWOLF]: '#8b5cf6',
  [GameType.MYSTERY]: '#ef4444',
  [GameType.DATING_SIM]: '#ec4899',
  [GameType.MANAGEMENT]: '#10b981',
  [GameType.TEXT_RPG]: '#3b82f6'
};

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  [GameStatus.COMPLETED]: '已完成',
  [GameStatus.IN_DEVELOPMENT]: '开发中',
  [GameStatus.PLANNED]: '计划中'
};

export const GAME_STATUS_COLORS: Record<GameStatus, string> = {
  [GameStatus.COMPLETED]: '#52c41a',
  [GameStatus.IN_DEVELOPMENT]: '#faad14',
  [GameStatus.PLANNED]: '#8c8c8c'
};

export const GAME_STATUS_OPTIONS = Object.entries(GAME_STATUS_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const GAME_VIEW_LABELS: Record<GameView, string> = {
  [GameView.LOBBY]: '游戏大厅',
  [GameView.DETAIL]: '游戏详情',
  [GameView.MAIN]: '游戏主页'
};

export const GAME_NARRATIVE_STATE_LABELS: Record<GameNarrativeState, string> = {
  [GameNarrativeState.IDLE]: '空闲',
  [GameNarrativeState.PREPARING]: '准备中',
  [GameNarrativeState.GENERATING]: '生成中',
  [GameNarrativeState.STREAMING]: '流式输出',
  [GameNarrativeState.COMPLETED]: '已完成',
  [GameNarrativeState.STOPPED]: '已停止',
  [GameNarrativeState.ERROR]: '错误'
};

// ==================== 排序与筛选选项 ====================

export type GameSortField = 'updatedAt' | 'createdAt' | 'title';

export const GAME_SORT_OPTIONS: Array<{ value: GameSortField; label: string }> = [
  { value: 'updatedAt', label: '最近更新' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'title', label: '名称' }
];

// ==================== 默认 schema 与初始数据 ====================

/**
 * 默认空表格 schema（无 sheet）
 *
 * 用于未声明 tableSchema 的占位模板。
 */
export const DEFAULT_GAME_TABLE_SCHEMA: GameTableSchema = {
  sheets: [],
  headers: {},
  sheetDescriptions: {}
};

/**
 * 创建空表格数据（按 schema 初始化）
 *
 * @property sheets              sheet 名列表
 * @property headers             每个 sheet 的列头
 * @property data                每个 sheet 的行数据（空数组）
 * @property sheetDescriptions    每个 sheet 的描述
 */
export function createEmptyTableData(schema: GameTableSchema) {
  return {
    sheets: [...schema.sheets],
    headers: { ...schema.headers },
    data: schema.sheets.reduce((acc, sheetName) => {
      acc[sheetName] = [];
      return acc;
    }, {} as Record<string, Record<string, any>[]>),
    sheetDescriptions: { ...schema.sheetDescriptions }
  };
}

// ==================== 路径与文件名常量 ====================

/** 游戏数据根目录（相对于 userData） */
export const GAMES_DIR_NAME = 'games';

/** 游戏存档根目录（相对于 userData） */
export const GAME_SAVES_DIR_NAME = 'game-saves';

/** 游戏索引文件名 */
export const GAMES_INDEX_FILENAME = 'games-index.json';

/** 单个游戏元数据文件名 */
export const GAME_META_FILENAME = 'meta.json';

/** 游戏本地配置文件名 */
export const GAME_CONFIG_FILENAME = 'config.json';

/** 存档元数据文件名 */
export const SAVE_META_FILENAME = 'save.json';

/** 存档表格数据文件名 */
export const SAVE_TABLE_DATA_FILENAME = 'table-data.json';

/** 存档表格配置文件名 */
export const SAVE_TABLE_CONFIG_FILENAME = 'table-config.json';

/** 存档表格版本快照文件名 */
export const SAVE_TABLE_VERSIONS_FILENAME = 'table-versions.json';

/** 存档自定义状态快照文件名 */
export const SAVE_STATE_SNAPSHOT_FILENAME = 'state-snapshot.json';

/** 索引文件版本号 */
export const GAMES_INDEX_VERSION = '1.0.0';

// ==================== 超时与限流 ====================

/** AI 叙事生成超时（ms），与 AI_CHECK_TIMEOUT 对齐 */
export const GAME_NARRATIVE_TIMEOUT = 120000;

/** 流式 chunk 之间最大间隔（ms），超过则判定为断流 */
export const GAME_STREAM_CHUNK_TIMEOUT = 30000;

// ==================== 重新导出 ====================

export { DEFAULT_GAME_LOCAL_CONFIG, MAX_AUTO_SAVES, AUTO_SAVE_SUFFIX };
