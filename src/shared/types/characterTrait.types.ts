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
 *  - 系统分类 id 之一（`head` / `body` / `clothing` / `background` / `pose` / `expression`）
 *  - 或 `UNCATEGORIZED_CATEGORY_ID`（当 AI 未输出分类前缀、或前缀非已知系统分类时的兜底）
 */
export interface CategorizedTrait {
  /** 特征文本（如 `white hair`、`blue eyes`），下游 SD 生成时拼接为 prompt tag */
  text: string;
  /**
   * 所属分类 ID：
   *  - 系统分类 id（`head` / `body` / `clothing` / `background` / `pose` / `expression`）
   *  - 或 `UNCATEGORIZED_CATEGORY_ID`（无法识别分类时的兜底）
   */
  categoryId: string;
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
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
}

/**
 * 动态场景提示词方案（Spec: add-dynamic-scene-prompt-generation / Task 1）。
 *
 * 设计动机：
 *  - 与 `CharacterTraitItem[]` 基础特征分离，存储动态解析出的服装/动作/场景提示词
 *  - 基础特征描述角色「固有」视觉属性（种族/发色/瞳色/体型等），不应被一次性场景指令污染
 *  - 用户通过自然语言命令（如「让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上」）
 *    由 AI 解析为三组独立英文 SD tag，保存为方案后可在生成图片时一键切换
 *
 * 三组字段语义（clothing / pose / scene）：
 *  - 均为英文 SD tag 字符串，逗号分隔（如 `"gothic dress, black lace, choker"`）
 *  - 任一组未在用户指令中提及时为空字符串 `""`（不视为缺失，下游生成时占位符替换为空）
 *  - 字段值可由用户在 UI 中手动编辑（覆盖 AI 原始解析结果后再保存）
 *
 * 与 `TraitCombination`（特征组合方案）的区别：
 *  - `TraitCombination` 是基础特征 `enabled` 状态的命名快照（仅保存 traitIds 数组），
 *    应用时切换基础特征的 enabled 标志，不引入新的 prompt 内容
 *  - `DynamicScenePrompt` 是独立的动态内容，携带全新的 clothing/pose/scene tag 字符串，
 *    与基础特征并行注入 SD 生成链路，不修改基础特征的 enabled 状态
 *  - 两者可同时激活：基础特征组合决定 `{traits}` 拼接内容，
 *    动态场景方案决定 `{clothing}` / `{pose}` / `{scene}` 占位符替换
 *  - 命名策略不同：`TraitCombination.name` 拒绝空名/重名，
 *    `DynamicScenePrompt.name` 允许重名（与 spec「用户输入，可重名」一致）
 *
 * 引用 spec: `add-dynamic-scene-prompt-generation`
 */
export interface DynamicScenePrompt {
  /** 方案唯一 ID（用 `genTraitId()` 生成，复用基础特征的 ID 生成器，避免引入新 ID 命名空间） */
  id: string;
  /** 方案名（用户输入，可重名；与 `TraitCombination.name` 的「空名/重名拒绝」策略不同） */
  name: string;
  /** 服装相关英文 SD tag 字符串（逗号分隔，可能为空字符串 `""`） */
  clothing: string;
  /** 动作/姿势英文 SD tag 字符串（逗号分隔，可能为空字符串 `""`） */
  pose: string;
  /** 场景/环境英文 SD tag 字符串（逗号分隔，可能为空字符串 `""`） */
  scene: string;
  /** 原始自然语言指令（用户最初输入的中文命令，用于溯源、重新解析与 UI 展示） */
  sourceCommand: string;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 最后更新时间戳（ms；用户手动编辑 clothing/pose/scene 后更新） */
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
 * 【重点标记 - 新增字段】Spec: add-dynamic-scene-prompt-generation
 * - v2 manifest 新增动态场景字段 `dynamicScenePrompts` 与 `activeDynamicScenePromptId`
 * - 这两个字段为「存储可选、内存必填」语义：磁盘上的旧 v2 文件可能缺失这两个字段，
 *   由 service 层 `loadTraitData()` 在加载时兜底为 `[]` / `null`，保证 v2 迁移兼容
 * - 类型上为必填字段（避免消费方反复判空），由 service 层负责兜底补全
 * - 保存时完整写入这两个字段（`saveTraitData()` 不删除/不压缩）
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
  /** 动态场景方案列表（默认 `[]`，由 service 层 `loadTraitData()` 兜底补全；存储独立于基础特征） */
  dynamicScenePrompts: DynamicScenePrompt[];
  /** 当前激活动态场景方案 ID（null 表示无激活方案，默认 null，由 service 层兜底补全） */
  activeDynamicScenePromptId: string | null;
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
 * 分类顺序（order 0..6）：
 *  1. `basic` 基本特征 — 物种/种族、性别、内容分级（sfw/nsfw）等角色基底属性，
 *     作为整个角色的基底特征，置于最前
 *  2. `head` 头部特征 — 发色/发型/瞳色/动物耳朵/帽子等
 *  3. `body` 身体特征 — 体型/肤色/毛色/尾巴/翅膀等（不含物种与性别，已移至 basic）
 *  4. `clothing` 衣物配饰
 *  5. `background` 背景环境
 *  6. `pose` 人物姿势
 *  7. `expression` 人物表情
 */
export const SYSTEM_TRAIT_CATEGORIES: readonly TraitCategory[] = [
  { id: 'basic', name: '基本特征', isSystem: true, order: 0 },
  { id: 'head', name: '头部特征', isSystem: true, order: 1 },
  { id: 'body', name: '身体特征', isSystem: true, order: 2 },
  { id: 'clothing', name: '衣物配饰', isSystem: true, order: 3 },
  { id: 'background', name: '背景环境', isSystem: true, order: 4 },
  { id: 'pose', name: '人物姿势', isSystem: true, order: 5 },
  { id: 'expression', name: '人物表情', isSystem: true, order: 6 },
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
