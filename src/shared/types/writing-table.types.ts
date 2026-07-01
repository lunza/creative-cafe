/**
 * 写作表格数据统一类型定义（单一真源）
 *
 * 合并以下重复定义：
 * - `src/shared/types/writing.types.ts` 中的 `WritingTableData`（用于版本快照）
 * - `src/main/services/writing/WritingTableRepository.ts` 中的 `WritingTableData`
 *   （用于表格文件读写、TableOrganizeService、TableEditCommandExecutor）
 *
 * 两处定义结构完全一致，本文件取该结构作为统一契约。
 *
 * 同时定义 `WritingTableContext`，对齐 `PlotCheckRequestData.writingTableData`
 * 与 `ContentGenerationRequest.writingTableData` 等请求体内联类型，作为
 * AI Prompt 上下文注入时的统一形态。
 *
 * 设计原则：
 * - `WritingTableData` 字段全部必填（与存储文件结构对齐）
 * - `WritingTableContext` 字段全部可选（与请求体中"可能未配置表格"的场景对齐）
 * - 不修改消费方，仅创建 shared 新定义；writing.types.ts 通过 re-export 引入
 */

/**
 * 写作表格数据 - table-data.json 的完整结构
 *
 * 用于持久化存储写作项目的表格数据，由 WritingTableRepository 读写。
 * 一个项目对应一个 table-data.json 文件，包含多个 sheet。
 *
 * @property sheets             sheet 名称列表（顺序敏感）
 * @property headers            每个 sheet 的列头列表（key 为 sheet 名）
 * @property data               每个 sheet 的行数据列表（key 为 sheet 名）
 * @property sheetDescriptions   每个 sheet 的用途描述（key 为 sheet 名）
 */
export interface WritingTableData {
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, Record<string, any>[]>;
  sheetDescriptions: Record<string, string>;
}

/**
 * 写作表格上下文 - 注入到 AI Prompt 的请求体字段
 *
 * 用于 ContentGenerationRequest / PlotCheckRequestData /
 * ShardContentGenerationRequest 等请求体的 `writingTableData` 字段。
 *
 * 与 `WritingTableData` 的区别：
 * - 所有字段可选（请求体可能未配置表格）
 * - 携带 `tableConfig` 元信息（关联模板 ID 与名称），供 Prompt 提示模板来源
 *
 * @property tableConfig           表格配置元信息（可选）
 * @property sheets                sheet 名称列表（可选）
 * @property headers               每个 sheet 的列头列表（可选）
 * @property data                  每个 sheet 的行数据列表（可选）
 * @property sheetDescriptions      每个 sheet 的用途描述（可选）
 */
export interface WritingTableContext {
  tableConfig?: {
    associatedTemplateId: string;
    associatedTemplateName: string;
  };
  sheets?: string[];
  headers?: Record<string, string[]>;
  data?: Record<string, Record<string, any>[]>;
  sheetDescriptions?: Record<string, string>;
}

/**
 * 写作表格配置 - table-config.json 的结构
 *
 * 用于持久化存储表格的整理行为配置。与 MemoryTableConfig（CharacterDialogueChat）
 * 语义一致，但字段命名按写作模块约定。
 *
 * @property enabled                 是否启用记忆表格
 * @property autoOrganize            是否自动整理
 * @property organizeMode             整理模式（sync 同步 / async 异步）
 * @property associatedTemplateId    关联的表格模板 ID（null 表示未关联）
 * @property associatedTemplateName   关联的表格模板名称
 * @property organizeRequirements     整理需求说明（可选）
 */
export interface WritingTableConfig {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async';
  associatedTemplateId: string | null;
  associatedTemplateName: string;
  organizeRequirements?: string;
}
