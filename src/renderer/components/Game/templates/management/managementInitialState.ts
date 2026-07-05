/**
 * 文字模拟经营游戏初始状态定义（Task 14 / SubTask 14.2）
 *
 * 定义经营游戏的模板自定义状态（ManagementState）与初始值，
 * 并提供 initialStateToTableData 转换函数将 ManagementState 转换为 GameTableData
 * 的初始数据（供主进程在新建存档时按 schema 初始化表格）。
 *
 * 设计要点：
 * - ManagementState 是模板自定义状态（stateSnapshot），独立于 GameTableData
 *   两者通过 serializeState / deserializeState 序列化为 JSON 持久化
 * - initialStateToTableData 仅在新建存档时调用一次，后续由 AI tableEdit 命令维护
 * - 资源默认值：金币 500 / 食物 50 / 木材 30 / 人口 5（与 Task 14 spec 一致）
 * - 默认回合 = 1（与 GameSaveMeta.currentTurn 同步语义，但独立存储避免冗余）
 *
 * 参考：
 * - src/shared/types/game.types.ts 的 GameTypeTemplate.serializeState / deserializeState
 *   签名为 (Record<string, any>) => Record<string, any>（注意：不是 JSON 字符串）
 */

import type { GameTableData } from '../../../../../shared/types/game.types';
import { MANAGEMENT_TABLE_SCHEMA } from './managementSchema';

// ==================== 类型定义 ====================

/**
 * 经营游戏模板自定义状态
 *
 * 序列化后存入存档的 state-snapshot.json，由 ManagementGameTemplate.serializeState
 * 处理。与 GameTableData 平行存在 —— GameTableData 是 AI 维护的表格快照，
 * ManagementState 是模板自身的运行时状态（如随机种子、升级路径配置等）。
 *
 * @property turn         当前回合数（与 GameSaveMeta.currentTurn 冗余，但便于无 save.meta 时也能读到回合）
 * @property resources    资源快照（用于本地校验、UI 乐观更新；表格才是真源）
 * @property facilities   已建设施列表（id + name + level）
 * @property events       已发生事件列表（与表格 events sheet 同步，便于历史回看）
 * @property randomSeed   随机事件种子（用于主进程生成可复现的随机事件序列）
 * @property upgradePaths 设施升级路径配置（key=facility id，value=升级链）
 */
export interface ManagementState {
  turn: number;
  resources: {
    gold: number;
    food: number;
    wood: number;
    population: number;
  };
  facilities: Array<{
    id: string;
    name: string;
    level: number;
  }>;
  events: Array<{
    id: string;
    turn: number;
    description: string;
  }>;
  /** 自定义状态（如随机事件种子、建筑升级路径） */
  randomSeed: number;
  upgradePaths: Record<string, string[]>;
}

// ==================== 初始状态 ====================

/**
 * 经营游戏初始状态
 *
 * 新建存档时由 ManagementGameTemplate.getInitialState() 返回此对象的副本。
 *
 * 默认值：
 * - turn: 1（第一回合）
 * - resources.gold: 500（金币，足够建造初始设施）
 * - resources.food: 50（食物，初始人口 5 人消耗 10 回合）
 * - resources.wood: 30（木材，用于早期建造）
 * - resources.population: 5（人口，初始 5 人）
 * - facilities: []（开局无建设施）
 * - events: []（开局无事件）
 * - randomSeed: Date.now()（启动时随机种子，确保每局游戏随机性不同）
 * - upgradePaths: {}（暂无升级路径配置，由后续 Task 15 扩展）
 */
export const MANAGEMENT_INITIAL_STATE: ManagementState = {
  turn: 1,
  resources: {
    gold: 500,
    food: 50,
    wood: 30,
    population: 5
  },
  facilities: [],
  events: [],
  randomSeed: Date.now(),
  upgradePaths: {}
};

/**
 * 创建初始状态的深拷贝
 *
 * 由于 MANAGEMENT_INITIAL_STATE 是模块级常量，直接返回引用会导致
 * 多次创建存档共享同一对象引用，后续修改会污染初始值。
 * 此函数用于 ManagementGameTemplate.getInitialState()。
 */
export function createInitialManagementState(): ManagementState {
  return {
    ...MANAGEMENT_INITIAL_STATE,
    resources: { ...MANAGEMENT_INITIAL_STATE.resources },
    facilities: [],
    events: [],
    upgradePaths: {},
    // 重新生成种子，保证每局不同
    randomSeed: Date.now()
  };
}

// ==================== 状态转换工具 ====================

/**
 * 将 ManagementState 转换为 GameTableData 的初始数据
 *
 * 用于新建存档时由主进程按 schema 初始化表格。
 * 转换规则：
 * - characters sheet：默认一行"镇长"作为玩家角色
 * - resources sheet：从 state.resources 转换为 4 行（金币 / 食物 / 木材 / 人口）
 * - facilities sheet：从 state.facilities 转换为行（含 cost / production 占位）
 * - events sheet：从 state.events 转换为行（含 effect 占位）
 * - stats sheet：turn + randomSeed 两行 key-value
 *
 * 注意：此函数仅在新建存档时调用一次，后续表格由 AI tableEdit 命令维护。
 * 表格一旦写入，与 stateSnapshot 之间不再自动同步。
 *
 * @param state  模板自定义状态（默认使用 MANAGEMENT_INITIAL_STATE）
 * @returns      完整的 GameTableData 对象（sheets + headers + data + sheetDescriptions）
 */
export function initialStateToTableData(
  state: ManagementState = MANAGEMENT_INITIAL_STATE
): GameTableData {
  return {
    sheets: [...MANAGEMENT_TABLE_SCHEMA.sheets],
    headers: { ...MANAGEMENT_TABLE_SCHEMA.headers },
    sheetDescriptions: { ...MANAGEMENT_TABLE_SCHEMA.sheetDescriptions },
    data: {
      characters: [
        { name: '镇长', role: 'player', status: 'active' }
      ],
      resources: [
        { name: '金币', amount: state.resources.gold, change_per_turn: 0 },
        { name: '食物', amount: state.resources.food, change_per_turn: 0 },
        { name: '木材', amount: state.resources.wood, change_per_turn: 0 },
        { name: '人口', amount: state.resources.population, change_per_turn: 0 }
      ],
      facilities: state.facilities.map((f) => ({
        name: f.name,
        level: f.level,
        // cost / production 字段为占位，由 AI 在建造时填充
        cost: 0,
        production: 0
      })),
      events: state.events.map((e) => ({
        turn: e.turn,
        description: e.description,
        effect: ''
      })),
      stats: [
        { key: 'turn', value: String(state.turn) },
        { key: 'randomSeed', value: String(state.randomSeed) }
      ]
    }
  };
}
