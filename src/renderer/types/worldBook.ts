// 世界书条目位置类型 (与 SillyTavern 官方规范对齐)
// 0=before_char, 1=after_char, 2=before_example, 3=at_depth
export type WorldBookEntryPosition = 0 | 1 | 2 | 3;

export interface WorldBookMeta {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

// 与 SillyTavern 官方规范对齐的世界书条目接口
export interface WorldBookEntry {
  uid: number | string;
  // SillyTavern 核心字段
  key: string[];                      // 触发关键词列表
  secondaryKeys?: string[];           // 次要关键词列表（内部统一命名，导出时映射为 secondary_keys）
  keysecondary?: string[];            // 次要关键词列表（向后兼容，与 secondaryKeys 同义）
  content: string;                    // 注入的内容文本
  comment: string;                    // 用户备注
  constant: boolean;                  // 是否始终激活
  selective: boolean;                 // 是否按概率激活
  // SillyTavern 标准字段
  order?: number;                     // 排序权重 (越大越靠后)
  position?: WorldBookEntryPosition;  // 注入位置 (数字类型: 0=before_char, 1=after_char, 2=before_example, 3=at_depth)
  depth?: number;                     // 递归深度
  probability?: number;               // 激活概率 0-100 (整数)
  group?: string;                     // 分组名称
  disable?: boolean;                  // 是否禁用
  useRegex?: boolean;                 // 使用正则匹配（内部命名，导出时映射为 use_regex）
  vectorized?: boolean;               // 使用向量检索
  caseSensitive?: boolean;            // 区分大小写（内部命名，导出时映射为 case_sensitive）
  // Creative-Cafe 独有字段
  automationId?: string;
  scanDepth?: number;
  displayIndex?: number;
  matchWholeWords?: boolean;
  useGroupScoring?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: number;       // SillyTavern 标准：数字类型
}

export interface WorldBookData {
  entries: Record<string | number, WorldBookEntry>;
  name?: string;
  description?: string;
}

export interface WorldBookTag {
  id: string;
  name: string;
  color?: string;
}

export interface WorldBookTagAssociation {
  entryUid: string | number;
  tagId: string;
}

export interface WorldBookTagData {
  tags: WorldBookTag[];
  associations: WorldBookTagAssociation[];
}
