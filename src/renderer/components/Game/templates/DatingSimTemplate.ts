/**
 * 恋爱模拟 - 游戏模板（占位）
 *
 * 游戏类型：DATING_SIM
 * 状态：PLANNED（仅元数据占位，未实现 Component）
 *
 * 大厅展示用 meta 已配置，好感度面板与 tableSchema 待后续扩展。
 */

import { lazy } from 'react';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate
} from '../../../../shared/types/game.types';
import { DEFAULT_GAME_TABLE_SCHEMA } from '../../../../shared/constants/game.constants';

const PlaceholderGameMain = lazy(() => import('./PlaceholderGameMain'));

export const DatingSimTemplate: GameTypeTemplate = {
  type: GameType.DATING_SIM,
  meta: {
    title: '心动邂逅',
    subtitle: '提升好感度，邂逅浪漫',
    description:
      '一款文字恋爱模拟游戏，玩家通过与多位角色对话、约会、送礼提升好感度，解锁专属剧情与结局。',
    gameplay:
      '在对话中选择不同选项影响好感度变化，触发约会事件与剧情分支，逐步走入角色内心。',
    developer: 'Creative Cafe',
    version: '0.1.0',
    status: GameStatus.PLANNED,
    tags: ['恋爱', '好感度', '约会']
  },
  panels: [],
  tableSchema: DEFAULT_GAME_TABLE_SCHEMA,
  Component: PlaceholderGameMain
};
