/**
 * 文字模拟经营游戏模板定义（Task 14 / SubTask 14.4）
 *
 * 实现 GameTypeTemplate 接口的经营游戏模板：
 * - type: GameType.MANAGEMENT
 * - meta: 田园小镇游戏元数据（占位用，实际 meta 由 data/games/pastoral_town/meta.json 提供）
 * - panels: ['resource', 'facility', 'statistics']
 * - tableSchema: MANAGEMENT_TABLE_SCHEMA（5 sheet 结构）
 * - Component: 懒加载 ManagementGameMain
 * - serializeState / deserializeState: ManagementState <-> Record<string, any>
 * - getInitialState: 新建存档时返回 MANAGEMENT_INITIAL_STATE 的副本
 *
 * 【重点标记 - 接口签名与 spec 描述不一致，按实际类型实现】：
 * spec 描述 serializeState/deserializeState 为 (state) => JSON 字符串，
 * 但 src/shared/types/game.types.ts 中实际签名为：
 *   - serializeState?: (state: Record<string, any>) => Record<string, any>;
 *   - deserializeState?: (snapshot: Record<string, any>) => Record<string, any>;
 * 即返回结构化对象，由存档层（GameSaveRepository）统一负责 JSON 序列化。
 * 本实现按实际类型签名实现，ManagementState 直接以对象形式传递。
 *
 * @see src/shared/types/game.types.ts GameTypeTemplate
 *
 * 参考：
 * - src/renderer/components/Game/templates/MysteryTemplate.ts（占位模板风格）
 * - src/renderer/components/Game/templates/PlaceholderGameMain.tsx（懒加载模式）
 */

import { lazy } from 'react';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate
} from '../../../../../shared/types/game.types';
import { MANAGEMENT_TABLE_SCHEMA } from './managementSchema';
import {
  MANAGEMENT_INITIAL_STATE,
  createInitialManagementState,
  type ManagementState
} from './managementInitialState';

// 懒加载主组件：仅在 GameMainPage 首次渲染该模板时才会加载 chunk
const Component = lazy(() => import('./ManagementGameMain'));

/**
 * 经营游戏模板实例
 *
 * 在 src/renderer/components/Game/templates/index.ts 中通过
 * GameTemplateRegistry.register(GameType.MANAGEMENT, ManagementGameTemplate) 注册。
 */
export const ManagementGameTemplate: GameTypeTemplate = {
  type: GameType.MANAGEMENT,
  meta: {
    title: '田园小镇',
    subtitle: '经营你的梦想农场',
    description:
      '一款文字模拟经营游戏，扮演镇长建设自己的小镇。通过建造设施、招募角色、管理资源，将一片荒地逐步发展为繁荣的小镇。',
    gameplay:
      '通过建造设施、招募角色、管理资源来发展小镇。每回合可以建造一个设施或招募一个角色，然后结束回合触发随机事件和资源结算。',
    developer: 'Creative Cafe Team',
    version: '1.0.0',
    status: GameStatus.COMPLETED,
    tags: ['经营', '模拟', '建设']
  },
  panels: ['resource', 'facility', 'statistics'],
  tableSchema: MANAGEMENT_TABLE_SCHEMA,
  Component,

  /**
   * 序列化模板自定义状态
   *
   * 接收 Record<string, any> 形式的状态，原样返回（结构化对象）。
   * 实际 JSON.stringify 由 GameSaveRepository 在写入 state-snapshot.json 时完成。
   *
   * 兼容性：若传入的状态不是合法的 ManagementState（如缺字段），保留原对象不动，
   * 避免因类型校验失败而丢失数据。
   */
  serializeState: (state: Record<string, any>): Record<string, any> => {
    return { ...state };
  },

  /**
   * 反序列化模板自定义状态
   *
   * 接收 Record<string, any> 形式的快照（来自 state-snapshot.json 解析结果），
   * 返回 ManagementState 兼容对象。若快照为 null / undefined 或解析失败，
   * 回退到 MANAGEMENT_INITIAL_STATE，保证读档后游戏可继续运行。
   *
   * 注意：此处只做浅合并（spread），不做深校验。若需深校验，
   * 可在 GameSaveRepository 之外再加一层验证逻辑。
   */
  deserializeState: (snapshot: Record<string, any>): Record<string, any> => {
    if (!snapshot || typeof snapshot !== 'object') {
      return createInitialManagementState() as Record<string, any>;
    }
    // 浅合并：用快照覆盖默认值，缺字段时由默认值兜底
    const merged: ManagementState = {
      ...MANAGEMENT_INITIAL_STATE,
      ...snapshot,
      resources: {
        ...MANAGEMENT_INITIAL_STATE.resources,
        ...(snapshot.resources ?? {})
      },
      facilities: Array.isArray(snapshot.facilities)
        ? [...snapshot.facilities]
        : [],
      events: Array.isArray(snapshot.events) ? [...snapshot.events] : [],
      upgradePaths: { ...(snapshot.upgradePaths ?? {}) }
    };
    return merged;
  },

  /**
   * 新建存档时返回初始状态
   *
   * 必须返回新对象（深拷贝），避免后续修改污染常量。
   */
  getInitialState: (): Record<string, any> => {
    return createInitialManagementState() as Record<string, any>;
  }

  // onOtherAction: undefined —— 经营游戏暂无"其他"按钮
};

export default ManagementGameTemplate;
