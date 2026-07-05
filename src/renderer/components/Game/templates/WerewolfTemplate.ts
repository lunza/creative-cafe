/**
 * 狼人杀 - 游戏模板（占位）
 *
 * 游戏类型：WEREWOLF
 * 状态：PLANNED（仅元数据占位，未实现 Component）
 *
 * 大厅展示用 meta 已配置，多人阶段制面板与 tableSchema 待后续扩展。
 */

import { lazy } from 'react';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate
} from '../../../../shared/types/game.types';
import { DEFAULT_GAME_TABLE_SCHEMA } from '../../../../shared/constants/game.constants';

const PlaceholderGameMain = lazy(() => import('./PlaceholderGameMain'));

export const WerewolfTemplate: GameTypeTemplate = {
  type: GameType.WEREWOLF,
  meta: {
    title: '暗夜博弈',
    subtitle: '阵营博弈，推理胜负',
    description:
      '一款文字化狼人杀游戏，玩家扮演村民阵营或狼人阵营，在白天讨论与夜晚行动中博弈推理，找出隐藏的狼人。',
    gameplay:
      '白天通过发言与投票放逐嫌疑人，夜晚由各角色执行行动，AI 扮演其他玩家提供发言与线索。',
    developer: 'Creative Cafe',
    version: '0.1.0',
    status: GameStatus.PLANNED,
    tags: ['推理', '阵营', '多人']
  },
  panels: [],
  tableSchema: DEFAULT_GAME_TABLE_SCHEMA,
  Component: PlaceholderGameMain
};
