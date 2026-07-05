/**
 * 逆转推理 - 游戏模板（占位）
 *
 * 游戏类型：MYSTERY（逆转裁判类推理）
 * 状态：PLANNED（仅元数据占位，未实现 Component）
 *
 * 大厅展示用 meta 已配置，玩法面板与 tableSchema 待 Task 14 之后扩展。
 */

import { lazy } from 'react';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate
} from '../../../../shared/types/game.types';
import { DEFAULT_GAME_TABLE_SCHEMA } from '../../../../shared/constants/game.constants';

const PlaceholderGameMain = lazy(() => import('./PlaceholderGameMain'));

export const MysteryTemplate: GameTypeTemplate = {
  type: GameType.MYSTERY,
  meta: {
    title: '逆转推理',
    subtitle: '收集线索，揭开真相',
    description:
      '一款逆转裁判风格的文字推理游戏，玩家需要调查现场、收集证据、在法庭上质证嫌疑人。',
    gameplay:
      '通过调查场景收集线索，在法庭对决中使用证据反驳证人陈述，逐步揭开案件真相。',
    developer: 'Creative Cafe',
    version: '0.1.0',
    status: GameStatus.PLANNED,
    tags: ['推理', '法庭', '调查']
  },
  panels: [],
  tableSchema: DEFAULT_GAME_TABLE_SCHEMA,
  Component: PlaceholderGameMain
};
