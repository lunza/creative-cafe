/**
 * 文字模拟经营游戏表格 schema 定义（Task 14 / SubTask 14.1）
 *
 * 定义经营游戏的 5 个 sheet 结构，对齐 GameTableSchema 接口：
 * - characters：游戏中的角色列表（玩家 / NPC / 招募单位）
 * - resources：玩家拥有的资源（金币 / 食物 / 木材 / 人口等）
 * - facilities：已建造的设施列表（含可建设施，由 level 判定已建/可建）
 * - events：已发生的事件历史（每回合结算时 AI 写入）
 * - stats：游戏统计数据（如当前回合、随机种子等 key-value 项）
 *
 * 设计要点：
 * - headers 第一列固定为 '1'（行号占位，与 WritingTableData 习惯对齐）
 * - sheet 顺序敏感：与 tableEdit 命令中的 sheetIndex 一一对应
 *   （1=characters / 2=resources / 3=facilities / 4=events / 5=stats）
 * - 字段名使用 snake_case，与 ResourcePanel / FacilityPanel / StatisticsPanel
 *   的默认字段映射（nameField='name' / amountField='amount' / ...）保持一致
 *
 * 参考：src/shared/types/game.types.ts 的 GameTableSchema 接口
 */

import type { GameTableSchema } from '../../../../../shared/types/game.types';

/**
 * 经营游戏表格 schema 常量
 *
 * 由 ManagementGameTemplate.tableSchema 字段引用：
 * - 新建存档时由主进程按 schema 初始化空表格
 * - AI 叙事生成 prompt 中注入 schema 帮助模型生成合法 tableEdit 命令
 */
export const MANAGEMENT_TABLE_SCHEMA: GameTableSchema = {
  sheets: ['characters', 'resources', 'facilities', 'events', 'stats'],
  headers: {
    characters: ['1', 'name', 'role', 'status'],
    resources: ['1', 'name', 'amount', 'change_per_turn'],
    facilities: ['1', 'name', 'level', 'cost', 'production'],
    events: ['1', 'turn', 'description', 'effect'],
    stats: ['1', 'key', 'value']
  },
  sheetDescriptions: {
    characters: '游戏中的角色列表',
    resources: '玩家拥有的资源',
    facilities: '已建造的设施',
    events: '已发生的事件历史',
    stats: '游戏统计数据'
  }
};

/**
 * 各 sheet 在 sheets 数组中的索引（从 0 开始）
 *
 * 用于在 tableEdit 命令构造时按 sheetIndex 引用，避免硬编码数字导致顺序错乱。
 * 注意：tableEdit 命令本身的 sheetIndex 从 1 开始（参见 GameTableEditCommand）。
 */
export const MANAGEMENT_SHEET_INDICES = {
  characters: 0,
  resources: 1,
  facilities: 2,
  events: 3,
  stats: 4
} as const;

/**
 * 各 sheet 名称常量
 *
 * 集中定义避免拼写错误，与 ResourcePanel / FacilityPanel / StatisticsPanel
 * 的 sheetName 默认值（'resources' / 'facilities' / 'stats'）保持一致。
 */
export const MANAGEMENT_SHEET_NAMES = {
  characters: 'characters',
  resources: 'resources',
  facilities: 'facilities',
  events: 'events',
  stats: 'stats'
} as const;
