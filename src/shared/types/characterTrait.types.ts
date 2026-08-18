/**
 * 角色特征管理共享类型（Spec: add-trait-category-grouping / Task 1）
 *
 * 用途：
 *  - 将 v1 扁平 `string[]` 特征升级为结构化 `CharacterTraitItem[]`，支持分类、启用选择与组合方案
 *  - 主进程 / 渲染进程 / preload 通过 `@shared/types` 或相对路径统一消费，避免重复定义
 *
 * 设计要点：
 *  - 系统分类以代码常量 `SYSTEM_TRAIT_CATEGORIES` 提供，全局可用、不可删除、不写入每张角色卡的 traits.json
 *  - 「未分类」作为迁移兜底与未归类特征的容器，单独以 `UNCATEGORIZED_CATEGORY` 常量暴露供 UI 拼接
 *  - `UNCATEGORIZED_CATEGORY` 不在 `SYSTEM_TRAIT_CATEGORIES` 数组内（order=999，永远位于列表末尾）
 *  - `genTraitId()` 优先使用 `crypto.randomUUID()`，老环境回退到时间戳+随机数
 *
 * 与 v1 的关系：
 *  - v1 `CharacterTraitManifest`（`traits: string[]`）保留为废弃别名，由 service 层做 v1→v2 迁移
 *  - v2 `CharacterTraitManifestV2` 是新的存储真源，字段缺失时由 service 兜底补全
 */

/**
 * 特征分类（系统分类或自定义分类）。
 *
 * - 系统分类：`isSystem=true`，定义于 `SYSTEM_TRAIT_CATEGORIES` 常量，全局共享，不写入角色卡文件
 * - 自定义分类：`isSystem=false`，按角色卡独立存储于 `customCategories` 字段
 * - 未分类：`UNCATEGORIZED_CATEGORY_ID = 'uncategorized'`，作为迁移兜底与未归类特征容器
 */
export interface TraitCategory {
  /** 分类唯一 ID（系统分类为常量字符串如 `'head'`，自定义分类为 `genTraitId()` 生成） */
  id: string;
  /** 分类显示名称（中文，如「头部特征」） */
  name: string;
  /** 可选 emoji / 图标 key（UI 自行映射） */
  icon?: string;
  /** 是否系统分类（系统分类不可删除/重命名） */
  isSystem: boolean;
  /** 排序序号（升序，系统分类 0..N-1，未分类 999，自定义分类从 100 起递增） */
  order: number;
}

/**
 * 单个角色特征项（v2 结构化项）。
 *
 * 与 v1 扁平 `string` 相比，新增稳定 `id` / 分类归属 / 启用标志，
 * 支持跨分类组合与下游图像生成仅拼接 `enabled=true` 项。
 */
export interface CharacterTraitItem {
  /** 特征项全局唯一 ID（`genTraitId()` 生成，迁移时为旧 string 重新分配） */
  id: string;
  /** 特征文本（如 `white fur`、`black shirt`），下游 SD 生成时拼接为 prompt tag */
  text: string;
  /** 所属分类 ID（系统分类 id / 自定义分类 id / `UNCATEGORIZED_CATEGORY_ID`） */
  categoryId: string;
  /** 是否启用（下游生成仅拼接 `enabled=true` 项的 text） */
  enabled: boolean;
  /**
   * 中文翻译（Spec: add-ai-tag-chinese-translation）。
   * 语义同 `CategorizedTrait.translation`：AI 生成时产出，手动编辑 / AI 审计替换 / 颜色拆分 / 人工审核替换后置为 undefined。
   * 旧数据无此字段时兜底 undefined，前端 Tooltip 不显示。
   * 随 v2 manifest 持久化（`CharacterTraitManifestV2.traits[].translation`）。
   */
  translation?: string;
  /**
   * 拆分前原始标签文本（Spec: optimize-trait-translation-and-temp-scheme）。
   * 语义同 `CategorizedTrait.originalText`：L3 颜色拆分时设置，手动编辑后清空。
   * 随 v2 manifest 持久化（`CharacterTraitManifestV2.traits[].originalText`）。
   * 旧数据无此字段时兜底 undefined，前端不显示拆分图标。
   */
  originalText?: string;
  /**
   * SDXL 提示词权重（Spec: add-sdxl-prompt-weight-support）。
   *
   * - 表示该 tag 在 SD prompt 中的权重，用于 SD WebUI（含 Forge Neo）的 per-tag 加权/弱化
   * - 默认值 undefined 等价于 1.0（不加权），此时 prompt 中 tag 文本原样输出
   * - weight !== 1.0 且 !== undefined 时，applyTraitsAndLora 将 tag 格式化为 `(text:weight)` 语法
   *   （如 weight=1.5 的 `blue_eyes` → `(blue_eyes:1.5)`，兼容 Forge Neo lark 解析器）
   * - 有效范围 0.1 ~ 10.0（保留 1 位小数），越界由 normalizeTraitItem 兜底为 undefined
   * - AI 生成时可选产出（LLM 输出格式 `分类:tag|中文翻译|权重`，第三段可选）
   * - 手动编辑 tag.text 时 weight 保持不变（与 originalText 清空策略不同）
   * - L4/L5 审计替换 tag 时继承原 weight；L3 颜色拆分后两个 trait weight 均重置为 undefined
   * - 随 v2 manifest 持久化（`CharacterTraitManifestV2.traits[].weight`）
   * - 旧数据无此字段时兜底 undefined，等价于 1.0，不影响现有行为
   */
  weight?: number;
}

/**
 * AI 生成的「带分类」特征项（Spec: add-trait-category-grouping / AI 自动归类增强）。
 *
 * 与 `CharacterTraitItem` 的关系：
 *  - 是其「无 id / 无 enabled」的轻量子集，由 `characterTraitAIService` 在主进程解析 LLM 响应时产出
 *  - 由 `characterTraitStore.setTraits` 接收后，由 store 为每项分配 `id` 与 `enabled=true`，
 *    并按 MERGE 策略合并入既有 `CharacterTraitItem[]`
 *
 * 设计动机：
 *  - 原始 Spec「AI 集成适配」一节中规定 AI 生成特征仍返回 `string[]`、新特征落入「未分类」，
 *    由用户手动归类（"AI 自动归类为未来增强项，本期不做"）
 *  - 本次增强即为该「未来增强项」：让 AI 直接输出 `分类:tag` 形式，
 *    经 `parseTraitsFromContent` 解析后携带 `categoryId` 透传到 store，
 *    使 AI 生成的特征直接进入对应系统分类，无需用户手动归类
 *
 * `categoryId` 取值：
 *  - 系统分类 id 之一（`basic` / `head` / `body` / `top` / `bottom` / `accessories` / `underwear` / `background` / `pose` / `expression`）
 *  - 或 `UNCATEGORIZED_CATEGORY_ID`（当 AI 未输出分类前缀、或前缀非已知系统分类时的兜底）
 */
export interface CategorizedTrait {
  /** 特征文本（如 `white hair`、`blue eyes`），下游 SD 生成时拼接为 prompt tag */
  text: string;
  /**
   * 所属分类 ID：
   *  - 系统分类 id（`basic` / `head` / `body` / `top` / `bottom` / `accessories` / `underwear` / `background` / `pose` / `expression`）
   *  - 或 `UNCATEGORIZED_CATEGORY_ID`（无法识别分类时的兜底）
   */
  categoryId: string;
  /**
   * 中文翻译（Spec: add-ai-tag-chinese-translation）。
   * - AI 生成特征时同时产出（prompt 输出 `分类:tag|中文翻译` 格式，parseTraitsFromContent 解析）
   * - 手动编辑 trait.text / AI 审计替换（L2-L5） / 颜色拆分 / 人工审核替换后置为 undefined
   * - 旧数据（无此字段）加载时兜底 undefined，前端 Tooltip 不显示
   * - 仅 AI 原创生成的 tag 携带翻译；标签库标准 tag（被替换后）无翻译
   */
  translation?: string;
  /**
   * 拆分前原始标签文本（Spec: optimize-trait-translation-and-temp-scheme）。
   * - 仅 L3 颜色拆分生成的标签设置此字段（如 `grey long hair` 拆分为 `grey_hair` + `long_hair`，
   *   两者 originalText 均为 `grey long hair`）
   * - 手动编辑标签文本后清空（编辑后的标签不再是"拆分生成"）
   * - 非拆分标签无此字段（undefined），前端不显示拆分图标
   */
  originalText?: string;
  /**
   * SDXL 提示词权重（Spec: add-sdxl-prompt-weight-support）。
   *
   * 语义同 `CharacterTraitItem.weight`：AI 生成时可选产出，由 `characterTraitStore.setTraits` 透传到 `CharacterTraitItem.weight`。
   * - LLM 输出格式 `分类:tag|中文翻译|权重`（第三段可选，不存在时兜底 undefined）
   * - `parseTraitsFromContent` 解析第三段为浮点数，范围 0.1-10.0，越界兜底 undefined
   * - 审计替换/拆分 tag 时 weight 继承或重置（与 `CharacterTraitItem.weight` 策略一致）
   */
  weight?: number;
}

/**
 * 特征组合方案（命名快照）。
 *
 * - 保存某一时刻 `enabled=true` 特征的 id 集合，支持一键切换
 * - 应用时将 `traitIds` 中的特征置 `enabled=true`，其余置 `enabled=false`
 * - 特征被删除导致 `traitIds` 中部分 id 失效时，应用阶段静默跳过
 */
export interface TraitCombination {
  /** 组合方案唯一 ID */
  id: string;
  /** 方案名称（用户输入，空名/重名拒绝） */
  name: string;
  /** 启用特征 id 快照（应用时仅这些 id 的特征置 enabled=true） */
  traitIds: string[];
  /**
   * 完整特征快照（Spec: optimize-trait-translation-and-temp-scheme）。
   * - 从 AssetGenerateModal 保存时写入（含临时新增/编辑的标签、启用状态、translation、originalText）
   * - 从 AssetManagerModal 保存时不写入（仅 traitIds，向后兼容）
   * - 应用方案时优先使用 traitSnapshot（若存在），否则回退到 traitIds 逻辑
   * - 与 traitIds 可共存（traitIds 仍记录启用 id，traitSnapshot 记录完整数据）
   */
  traitSnapshot?: CharacterTraitItem[];
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
}

/**
 * 角色卡特征清单 v2（traits.json 真源）。
 *
 * 与 v1 相比：
 * - `version` 升级为 `2`
 * - `traits` 由 `string[]` 升级为 `CharacterTraitItem[]`
 * - 新增 `customCategories` / `combinations` / `activeCombinationId`
 * - 保留 `appearanceDescription`（可选）
 *
 * 存储路径不变：`{userData}/data/character-traits/{sha256(cardId).slice(0,16)}/traits.json`
 */
export interface CharacterTraitManifestV2 {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号（v2 = 2） */
  version: 2;
  /** 角色外观描述（中文自然语言，AI 生成特征时自动提取，可手动编辑） */
  appearanceDescription?: string;
  /** 结构化特征项数组，顺序代表用户优先级 */
  traits: CharacterTraitItem[];
  /** 自定义分类列表（系统分类不写入，由常量提供） */
  customCategories: TraitCategory[];
  /** 组合方案列表 */
  combinations: TraitCombination[];
  /** 当前激活的组合方案 ID（null 表示手动模式） */
  activeCombinationId: string | null;
}

/**
 * 全局分类字典（Spec: fix-asset-trait-and-scene-defects / Task 3）。
 *
 * 存储所有自定义分类（跨角色卡共享），持久化到 `{userData}/data/trait-categories.json`。
 * 系统分类（`SYSTEM_TRAIT_CATEGORIES`）不写入此文件，由代码常量提供。
 *
 * 与 `CharacterTraitManifestV2.customCategories` 的关系：
 *  - `customCategories` 字段标记为废弃（保留以兼容旧文件读取，不再写入）
 *  - `GlobalTraitCategoryDictionary.categories` 是新的读取源
 *  - 首次加载时，将各角色卡 `customCategories` 合并到全局字典（按 name 去重）
 */
export interface GlobalTraitCategoryDictionary {
  /** 字典版本号（v1 = 1） */
  version: 1;
  /** 所有自定义分类列表（不含系统分类） */
  categories: TraitCategory[];
  /** 最后更新时间戳（ms） */
  updatedAt: number;
}

/**
 * 未分类分类 ID（迁移兜底容器）。
 *
 * v1 traits 迁移到 v2 时，所有 string 特征归入此分类；用户手动添加但未指定分类的特征也归入此。
 */
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';

/**
 * 系统预设分类常量（7 个核心分类）。
 *
 * - 全局可用，不写入每张角色卡的 traits.json
 * - `isSystem=true`，UI 不可删除/重命名
 * - 未分类（`UNCATEGORIZED_CATEGORY`）单独导出，由 UI 自行拼接到列表末尾
 *
 * 分类顺序（order 0..9）：
 *  1. `basic` 基本特征 — 物种/种族、性别、内容分级（sfw/nsfw）等角色基底属性，
 *     作为整个角色的基底特征，置于最前
 *  2. `head` 头部特征 — 发色/发型/瞳色/动物耳朵/帽子等
 *  3. `body` 身体特征 — 体型/肤色/毛色/尾巴/翅膀等（不含物种与性别，已移至 basic）
 *  4. `top` 上装 — 上衣/衬衫/外套/连衣裙等上身衣物
 *  5. `bottom` 下装 — 裤子/裙子/短裤等下身衣物
 *  6. `accessories` 配饰 — 眼镜/缎带/首饰/帽子/围巾等装饰物
 *  7. `underwear` 内衣 — 胸罩/内裤/内衣套装等贴身衣物
 *  8. `background` 背景环境
 *  9. `pose` 人物姿势
 *  10. `expression` 人物表情
 *
 * 【分类拆分】原 `clothing` 衣物配饰分类已于本次拆分为 `top`/`bottom`/`accessories`/`underwear`
 * 四个细分类。旧数据中 `categoryId='clothing'` 的特征由 `characterTraitService.loadTraitData`
 * 迁移至 `uncategorized`（用户手动重新归类）。
 */
export const SYSTEM_TRAIT_CATEGORIES: readonly TraitCategory[] = [
  { id: 'basic', name: '基本特征', isSystem: true, order: 0 },
  { id: 'head', name: '头部特征', isSystem: true, order: 1 },
  { id: 'body', name: '身体特征', isSystem: true, order: 2 },
  { id: 'top', name: '上装', isSystem: true, order: 3 },
  { id: 'bottom', name: '下装', isSystem: true, order: 4 },
  { id: 'accessories', name: '配饰', isSystem: true, order: 5 },
  { id: 'underwear', name: '内衣', isSystem: true, order: 6 },
  { id: 'background', name: '背景环境', isSystem: true, order: 7 },
  { id: 'pose', name: '人物姿势', isSystem: true, order: 8 },
  { id: 'expression', name: '人物表情', isSystem: true, order: 9 },
  // 【Spec: enhance-conversation-interaction-prompt-recognition】
  // 互动元素分类：专门承载用户与角色之间的动作互动标签（disembodied_hand / hand_on_breast /
  // hugging_another / holding_hands 等 Danbooru 风格互动标签）。
  // 与 pose（角色自身姿势）语义分离：pose 是角色自己的姿态，interaction 是与另一个实体的交互。
  // 仅在对话上下文描述互动动作时由 AI 输出，角色卡描述场景不触发。
  { id: 'interaction', name: '互动元素', isSystem: true, order: 10 },
];

/**
 * 未分类常量（迁移兜底 / 未归类容器）。
 *
 * 不在 `SYSTEM_TRAIT_CATEGORIES` 数组中（避免 UI 排序冲突），由 UI 自行拼接到分类列表末尾。
 * `order=999` 保证在自定义分类之后（自定义分类 order 从 100 起递增）。
 */
export const UNCATEGORIZED_CATEGORY: TraitCategory = {
  id: UNCATEGORIZED_CATEGORY_ID,
  name: '未分类',
  isSystem: true,
  order: 999,
};

/**
 * 生成特征项 / 自定义分类 / 组合方案的全局唯一 ID。
 *
 * 优先使用 `crypto.randomUUID()`（Web Crypto API，主进程 Node 19+ 与渲染进程均可用），
 * 不可用时回退到 `trait_${Date.now()}_${Math.random().toString(36).slice(2,10)}`。
 *
 * @returns 36 字符 UUID 或回退的 trait_ 前缀字符串
 */
export function genTraitId(): string {
  try {
    // globalThis.crypto 在 Electron 渲染进程与 Node 19+ 主进程均可用
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    // 访问 crypto 抛错时落入兜底分支
  }
  return `trait_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
