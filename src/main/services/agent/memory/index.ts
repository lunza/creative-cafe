/**
 * memory/ 模块 barrel export —— 智能体底座记忆存储统一出口
 *
 * 按需导出，避免循环依赖。import 路径示例：
 *   import { MemoryStore, getAgentBackend } from './memory';
 *   import { WorldBookAdapter } from './memory/adapters';
 */

// SQLite 后端
export {
  AgentSqliteBackend,
  getAgentBackend,
  AGENT_SCHEMA_STATEMENTS,
  type AgentMemoryRow,
  type AuditRow,
} from './sqliteBackend';

// 记忆存储
export {
  MemoryStore,
  getMemoryStore,
  resetMemoryStore,
  type MemoryStoreConfig,
  type IMemoryAdapter,
} from './memoryStore';

// 写溯源
export {
  WriteProvenanceService,
  type WriteProvenanceRecord,
  type WriteAction,
} from './writeProvenance';

// 记忆 Prompt 准备
export {
  formatMemoryEntries,
  injectIntoPrompt,
  deduplicateEntries,
  prepareMemoryPrompt,
  type MemoryFormatOptions,
  type MemoryInjectionPosition,
} from './memoryPromptPrepare';

// 适配器
export { WorldBookAdapter, type IWorldBookService } from './adapters/worldBookAdapter';
export { CharacterAdapter, type ICharacterService } from './adapters/characterAdapter';
export { ChatHistoryAdapter, type IChatSessionRepository } from './adapters/chatHistoryAdapter';
export { ChapterAdapter, type IWritingProjectRepository } from './adapters/chapterAdapter';
