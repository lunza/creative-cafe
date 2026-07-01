/**
 * shared/types 统一入口（barrel）
 *
 * 用法：
 * ```ts
 * import { VectorItem, SearchResult, ChatMessage, WritingTableData } from '@shared/types';
 * ```
 *
 * 说明：
 * - 本文件 re-export shared/types/ 下所有类型模块，作为消费方的统一入口
 * - 向量类型：`./vector.types`（`./vector.ts` 为兼容 re-export，最终也将由此入口暴露）
 * - 聊天类型：`./chat.types`
 * - 写作表格类型：`./writing-table.types`
 * - 向量配置 Schema 常量：`./vectorConfigSchema`
 * - 写作类型：`./writing.types`（已通过其顶部 import 集成 WritingTableData）
 * - Prompt 模板类型：`./promptTemplate.types`
 *
 * 注意：`./vector.types` 与 `./vector.ts` 不重复 re-export，避免同名冲突；
 * 此处仅从 `./vector.types` 暴露（vector.ts 本身已 re-export 自 vector.types）。
 *
 * 已知冲突消解：
 * - `ContextItem` 与 `RetrieveOptions` 在 `./vector.types`（向量检索上下文）
 *   与 `./writing.types`（写作上下文）中均有定义，语义不同。barrel 优先暴露
 *   `./vector.types` 版本（向量检索为主语义）；需要写作上下文版本的消费方
 *   应直接 `import { ContextItem } from '@shared/types/writing.types'`。
 * - `WritingTableData` 在 `./writing-table.types`（单一真源）与 `./writing.types`
 *   （re-export）中一致，无冲突。
 */

// 向量数据类型（单一真源）
export * from './vector.types';

// 聊天消息类型（单一真源）
export * from './chat.types';

// 写作表格数据类型（单一真源）
export * from './writing-table.types';

// 向量配置 Schema 常量
export * from './vectorConfigSchema';

// 写作模式类型
// WritingTableData 已在 writing.types.ts 顶部 re-export 自 writing-table.types.ts，
// 这里通过 export * 间接暴露。ContextItem / RetrieveOptions 与 vector.types 冲突，
// 由下方显式 re-export 消解（优先 vector 语义）。
export * from './writing.types';

// Prompt 模板类型
export * from './promptTemplate.types';

// === 冲突消解 ===
// 显式 re-export 优先于 export *，解决 vector.types 与 writing.types 之间的同名冲突。
// 优先暴露向量检索语义的版本（向量相关类型为本任务 14 的合并重点）。
// 注：isolatedModules 模式下重导出类型必须使用 `export type`。
export type {
  ContextItem as ContextItem,
  RetrieveOptions as RetrieveOptions,
} from './vector.types';
