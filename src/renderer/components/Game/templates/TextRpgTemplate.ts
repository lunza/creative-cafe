/**
 * 文字 RPG - 游戏模板（占位）
 *
 * 游戏类型：TEXT_RPG
 * 状态：PLANNED（仅元数据占位，未实现 Component）
 *
 * 大厅展示用 meta 已配置，角色属性 / 技能树 / 装备面板与 tableSchema 待后续扩展。
 */

import { lazy } from 'react';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate
} from '../../../../shared/types/game.types';
import { DEFAULT_GAME_TABLE_SCHEMA } from '../../../../shared/constants/game.constants';

const PlaceholderGameMain = lazy(() => import('./PlaceholderGameMain'));

export const TextRpgTemplate: GameTypeTemplate = {
  type: GameType.TEXT_RPG,
  meta: {
    title: '冒险纪元',
    subtitle: '冒险探索，角色成长',
    description:
      '一款文字驱动的 RPG 游戏模板，玩家创建角色、探索地图、参与战斗，通过积累经验提升技能与装备。',
    gameplay:
      '在叙事节点选择行动（探索 / 战斗 / 对话 / 休息），战斗回合由 AI 旁白推进，胜败影响后续剧情走向。',
    developer: 'Creative Cafe',
    version: '0.1.0',
    status: GameStatus.PLANNED,
    tags: ['RPG', '冒险', '成长']
  },
  panels: [],
  tableSchema: DEFAULT_GAME_TABLE_SCHEMA,
  Component: PlaceholderGameMain
};
