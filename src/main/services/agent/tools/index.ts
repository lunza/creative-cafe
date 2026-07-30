/**
 * tools/ 模块 barrel export —— 智能体底座工具系统统一出口
 *
 * 按需导出，避免循环依赖。import 路径示例：
 *   import { ToolRegistry, getToolRegistry } from './tools';
 *   import { updateStateTableDescriptor } from './tools/builtin';
 */

// 工具类型
export {
  evaluateAvailability,
  type ToolDescriptor,
  type ToolOwnerRef,
  type ToolExecutorRef,
  type ToolAvailabilitySignal,
  type ToolAvailabilityExpression,
  type AvailabilityContext,
  type JsonObject,
} from './types';

// 工具注册中心
export {
  ToolRegistry,
  getToolRegistry,
  resetToolRegistry,
  type ToolExecutor,
} from './toolRegistry';

// 内置工具
export {
  updateStateTableDescriptor,
  createUpdateStateTableExecutor,
  registerUpdateStateTableTool,
  type ITableEditExecutor,
} from './builtin/updateStateTable';

// 对话组工具（Task 16.1）
export {
  searchWorldbookDescriptor,
  searchHistoryDescriptor,
  addMemoryNoteDescriptor,
  createSearchWorldbookExecutor,
  createSearchHistoryExecutor,
  createAddMemoryNoteExecutor,
  registerDialogueTools,
  type IDialogueToolServices,
} from './builtin/dialogueTools';

// 世界书组工具（Task 17.1）
export {
  createEntryDescriptor,
  expandFromContextDescriptor,
  generateKeywordsDescriptor,
  sortEntriesDescriptor,
  createCreateEntryExecutor,
  createExpandFromContextExecutor,
  createGenerateKeywordsExecutor,
  createSortEntriesExecutor,
  registerWorldbookTools,
  type IWorldbookToolServices,
} from './builtin/worldbookTools';
