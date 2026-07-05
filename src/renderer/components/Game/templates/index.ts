/**
 * 游戏模板聚合入口
 *
 * 职责：
 * 1. 集中导出所有已实现的游戏模板（占位模板也在此导出，供大厅展示）
 * 2. 在模块加载时自动将各模板注册到 GameTemplateRegistry
 *
 * 用法：
 * - 仅消费注册中心：`import { GameTemplateRegistry } from '@/renderer/components/Game/templates'`
 * - 直接引用某个模板常量：`import { MysteryTemplate } from '@/renderer/components/Game/templates'`
 *
 * 注意：
 * - 此文件被首次 import 时即触发注册（副作用模块），调用方无需手动调用 register
 * - MANAGEMENT 模板在 Task 14 已实现，注册时使用 GameType.MANAGEMENT 枚举值
 */

import { GameType } from '../../../../shared/types/game.types';
import { GameTemplateRegistry } from './GameTemplateRegistry';
import { MysteryTemplate } from './MysteryTemplate';
import { DatingSimTemplate } from './DatingSimTemplate';
import { WerewolfTemplate } from './WerewolfTemplate';
import { TextRpgTemplate } from './TextRpgTemplate';
import ManagementGameTemplate from './management/ManagementGameTemplate';

// 注册所有已实现的模板（占位模板也注册，供大厅展示）
GameTemplateRegistry.register(GameType.MYSTERY, MysteryTemplate);
GameTemplateRegistry.register(GameType.DATING_SIM, DatingSimTemplate);
GameTemplateRegistry.register(GameType.WEREWOLF, WerewolfTemplate);
GameTemplateRegistry.register(GameType.TEXT_RPG, TextRpgTemplate);
// MANAGEMENT 模板在 Task 14 已实现并注册
GameTemplateRegistry.register(GameType.MANAGEMENT, ManagementGameTemplate);

export { GameTemplateRegistry } from './GameTemplateRegistry';
export { MysteryTemplate } from './MysteryTemplate';
export { DatingSimTemplate } from './DatingSimTemplate';
export { WerewolfTemplate } from './WerewolfTemplate';
export { TextRpgTemplate } from './TextRpgTemplate';
export { ManagementGameTemplate } from './management/ManagementGameTemplate';
export { MANAGEMENT_TABLE_SCHEMA } from './management/managementSchema';
export {
  MANAGEMENT_INITIAL_STATE,
  createInitialManagementState,
  initialStateToTableData,
  type ManagementState
} from './management/managementInitialState';
