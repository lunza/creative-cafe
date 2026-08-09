/**
 * 角色卡视觉特征 Zustand store（Spec: add-asset-and-trait-management / Task 3 + add-trait-category-grouping / Task 4 + fix-asset-trait-and-scene-defects / Task 4）
 *
 * 职责：
 * - 持有当前角色卡的结构化特征数据（v2）：`traits: CharacterTraitItem[]` + `combinations` + `activeCombinationId`
 * - 持有全局自定义分类字典缓存：`globalCategories`（Spec: fix-asset-trait-and-scene-defects / Task 4）
 * - 封装所有 `window.electronAPI.characterTrait.*` IPC 调用（v2 走 `loadData` / `saveData`），对外暴露同步/异步 actions
 * - 封装 `window.electronAPI.categoryDictionary.*` IPC 调用，分类 CRUD 改为写入全局字典（跨角色卡共享）
 * - 提供「编辑态」与「持久化态」分离：addTrait / removeTrait / updateTrait / setTraits / moveTrait / toggleTraitEnabled
 *   仅修改本地 state，调用方在合适时机（如「保存」按钮点击）调用 saveTraits 一次性持久化，支持批量编辑后统一保存
 * - 分类 CRUD（createCategory / renameCategory / deleteCategory）修改本地 state 后立即通过 IPC 持久化到全局字典
 * - setTraits 用于 AI 生成特征（Task 13）后合并本地 state（MERGE 策略：保留已分类项不丢失），用户可逐条修改后点击「保存」持久化
 *
 * 设计要点：
 * - 不持久化到 localStorage：特征数据由主进程 characterTraitService 持久化到磁盘
 *   （`{userData}/data/character-traits/{sha256(characterCardId).slice(0,16)}/traits.json`），
 *   自定义分类由主进程 categoryDictionaryService 持久化到
 *   `{userData}/data/trait-categories.json`（跨角色卡共享）
 *   此 store 仅作为运行期缓存与 IPC 适配层，每次进入角色卡编辑界面重新拉取
 * - 所有 actions 包裹 try/catch，永不向调用方抛出异常，统一通过返回值 `{ success, error? }` 传递错误
 * - `traits` / `globalCategories` / `combinations` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
 * - saveTraits 采用「乐观更新 + 失败回滚」策略：先调 IPC 持久化，失败时回滚全部 v2 字段
 *   （由于 saveTraits 不再接收 traits 参数，traits 等字段已由各 action 修改完毕，saveTraits 仅负责持久化）
 *
 * v2 升级要点（Spec: add-trait-category-grouping / Task 4）：
 * - `traits` 由 `string[]` 升级为 `CharacterTraitItem[]`（含 id / text / categoryId / enabled）
 * - 新增 `combinations` / `activeCombinationId` state
 * - `loadTraits` 改调 `loadData` 一次性填充全部 v2 字段（删除旧的并行 `list` + `loadDescription` 调用）
 * - `saveTraits` 签名改为 `(characterCardId, appearanceDescription?)`，读取当前 store 全部 v2 state 持久化
 * - `addTrait` / `removeTrait` / `updateTrait` 改用 traitId（而非 index）定位，因 UI 在分类面板中展示特征，index 不稳定
 * - 新增分类 CRUD / moveTrait / toggleTraitEnabled / 组合 CRUD actions
 * - `setTraits(string[])` 采用 MERGE 策略：保留已分类项不丢失，仅替换未分类项
 *
 * 【重点标记 - 全局分类字典迁移】Spec: fix-asset-trait-and-scene-defects / Task 4
 * - 自定义分类不再存储于角色卡 manifest 的 `customCategories` 字段，改为全局字典 `trait-categories.json`
 * - store 新增 `globalCategories: TraitCategory[]` state，由 `categoryDictionary.load()` IPC 填充
 * - 旧的 `customCategories` state 字段保留但永远为 `[]`，仅为兼容 `CharacterTraitManifestV2` 类型签名
 *   （saveTraits 写入 `customCategories: []`，不再更新此字段）
 * - `addCategory` / `updateCategory` / `deleteCategory` 旧同步 actions 已移除，改为
 *   `createCategory` / `renameCategory` / `deleteCategory` 异步 actions 调用 IPC 写入全局字典
 * - 主进程 `characterTraitService.loadTraitData` 在加载含 `customCategories` 的旧 manifest 时
 *   自动调用 `categoryDictionaryService.migrateFromManifest()` 合并到全局字典（一次性迁移）
 *
 * 参考：src/renderer/stores/expressionStore.ts（无 persist 的 IPC 适配 store 模式）
 *      src/shared/types/characterTrait.types.ts（v2 类型定义与系统分类常量）
 *      src/main/services/characterTraitService.ts（主进程持久化实现 + 旧 customCategories 迁移）
 *      src/main/services/categoryDictionaryService.ts（全局分类字典服务）
 *      src/main/ipc/handlers/characterTraitHandlers.ts（IPC handler）
 *      src/main/ipc/handlers/categoryDictionaryHandlers.ts（全局字典 IPC handler）
 */

import { create } from 'zustand';
import {
  SYSTEM_TRAIT_CATEGORIES,
  UNCATEGORIZED_CATEGORY_ID,
  genTraitId,
} from '@shared/types';
import type {
  CategorizedTrait,
  CharacterTraitItem,
  CharacterTraitManifestV2,
  TraitCategory,
  TraitCombination,
} from '@shared/types';

// ==================== 类型定义 ====================

/**
 * 角色卡特征 store 状态（v2）。
 *
 * 字段说明：
 * - `currentCharacterCardId`：当前加载的角色卡 ID（用于校验缓存归属，切换角色卡时会被覆盖）
 * - `traits`：结构化特征项数组（v2），顺序代表用户优先级（前置特征优先级更高）
 * - `globalCategories`：全局自定义分类列表（Spec: fix-asset-trait-and-scene-defects / Task 4）
 *   由 `categoryDictionary.load()` IPC 填充，跨角色卡共享，是自定义分类的唯一读取源
 * - `customCategories`：【已废弃】永远为 `[]`，仅为兼容 `CharacterTraitManifestV2` 类型签名保留
 *   旧实现从 manifest 读取，现改为全局字典；saveTraits 写入 `[]`，不再更新此字段
 * - `combinations`：组合方案列表（命名快照，支持一键切换启用集合）
 * - `activeCombinationId`：当前激活的组合方案 ID（null 表示手动模式）
 * - `appearanceDescription`：角色外观描述（中文自然语言，AI 生成特征时自动提取，可手动编辑）
 * - `loading`：加载中标志
 * - `error`：最近一次错误信息（null 表示无错误）
 *
 * Actions 说明：
 * - `loadTraits`：异步，从主进程拉取完整 v2 数据 + 调用 `categoryDictionary.load()` 填充 globalCategories
 * - `saveTraits`：异步，乐观更新 + 失败回滚，将当前 store 全部 v2 state 持久化到主进程
 *   （customCategories 字段强制写 `[]`，不再作为读取源；自定义分类由全局字典独立持久化）
 * - `addTrait` / `removeTrait` / `updateTrait` / `setTraits`：同步，仅修改本地 state（不调 IPC），
 *   调用方需在合适时机调用 saveTraits 持久化
 * - `createCategory` / `renameCategory` / `deleteCategory`：异步分类 CRUD（Spec: fix-asset-trait-and-scene-defects / Task 4）
 *   调用 `categoryDictionary.*` IPC 写入全局字典，并同步更新 `globalCategories` state
 *   （deleteCategory 还会将该分类下特征回退到 `uncategorized` 并调用 saveTraits 持久化）
 * - `moveTrait`：移动特征到指定分类（目标可为系统分类 / 全局自定义分类 / uncategorized）
 * - `toggleTraitEnabled`：切换特征启用状态（进入手动模式：activeCombinationId=null）
 * - `saveCombination` / `applyCombination` / `deleteCombination`：组合方案 CRUD
 *   （【Spec: optimize-trait-translation-and-temp-scheme】saveCombination 新增 traitSnapshot 快照支持，
 *   saveCombination / deleteCombination 修改本地 state 后立即 fire-and-forget 调 `saveTraits()` 持久化；
 *   applyCombination 不改变方案列表，无需持久化）
 * - `setAppearanceDescription`：设置角色外观描述（仅本地 state）
 * - `clear`：重置所有状态
 */
interface CharacterTraitState {
  /** 当前加载的角色卡 ID（null 表示尚未加载） */
  currentCharacterCardId: string | null;
  /** 结构化特征项数组（v2），顺序代表用户优先级（前置优先级更高） */
  traits: CharacterTraitItem[];
  /**
   * 全局自定义分类列表（Spec: fix-asset-trait-and-scene-defects / Task 4）。
   *
   * 由 `categoryDictionary.load()` IPC 填充，跨角色卡共享，是自定义分类的唯一读取源。
   * 系统分类由 `SYSTEM_TRAIT_CATEGORIES` 常量提供，不在此字段中。
   * UI 拼装「全部分类」时应使用 `SYSTEM_TRAIT_CATEGORIES + globalCategories + UNCATEGORIZED_CATEGORY`。
   */
  globalCategories: TraitCategory[];
  /**
   * 【已废弃】永远为 `[]`，仅为兼容 `CharacterTraitManifestV2` 类型签名保留。
   *
   * 旧实现从角色卡 manifest 读取自定义分类，现改为全局字典（`globalCategories`）。
   * saveTraits 写入 `[]`，不再更新此字段；UI 不应再读取此字段。
   */
  customCategories: TraitCategory[];
  /** 组合方案列表（命名启用集合快照） */
  combinations: TraitCombination[];
  /** 当前激活的组合方案 ID（null 表示手动模式） */
  activeCombinationId: string | null;
  /**
   * 应用 traitSnapshot 方案前的 traits 备份（内存态，不持久化）。
   *
   * - `applyCombination(traitSnapshot 方案)` 时备份当前 traits
   * - `applyCombination(null)` 时从备份恢复 traits（手动模式回到方案应用前的状态）
   * - traitIds 方案不修改此字段（仅切换 enabled，不替换 traits 数组）
   * - 切换到手动模式后清空（避免多次切换累积旧备份）
   */
  preCombinationTraits: CharacterTraitItem[] | null;
  /** 角色外观描述（中文自然语言，AI 生成特征时自动提取，可手动编辑） */
  appearanceDescription: string;
  /** 加载中标志 */
  loading: boolean;
  /** 最近一次错误信息（null 表示无错误） */
  error: string | null;

  // -------- Actions --------

  /**
   * 加载指定角色卡的完整 v2 数据（traits / combinations / activeCombinationId / appearanceDescription）
   * + 调用 `categoryDictionary.load()` 填充 `globalCategories`。
   *
   * Spec: fix-asset-trait-and-scene-defects / Task 4
   * - 调用 `window.electronAPI.characterTrait.loadData` 拉取完整 v2 manifest
   *   （主进程 `characterTraitService.loadTraitData` 已在加载含 `customCategories` 的旧 manifest 时
   *   自动调用 `categoryDictionaryService.migrateFromManifest()` 合并到全局字典，渲染进程无感知）
   * - 调用 `window.electronAPI.categoryDictionary.load()` 拉取全局分类字典，填充 `globalCategories`
   * - 不再从 manifest 读取 `customCategories`（强制设为 `[]`，自定义分类的唯一读取源是 `globalCategories`）
   * - 文件不存在时主进程返回空白 v2（traits=[] 等），本 store 透传空值
   * - 防御性兜底：loadData / categoryDictionary.load 返回值字段缺失时补默认
   * - 设置全部 v2 字段 + globalCategories + currentCharacterCardId
   */
  loadTraits: (characterCardId: string) => Promise<void>;

  /**
   * 保存当前 store 全部 v2 state 到主进程（乐观更新 + 失败回滚）。
   * - 保存旧 v2 state 引用（traits / customCategories / combinations / activeCombinationId /
   *   appearanceDescription）
   * - `characterCardId` 可选：未传入时使用 `get().currentCharacterCardId`
   * - 若显式传入 appearanceDescription（含空串），先 set 更新 store.appearanceDescription 再保存；undefined 时使用 store 当前值
   * - 调用 `window.electronAPI.characterTrait.saveData` 持久化完整 v2 manifest
   * - 失败时回滚全部 v2 字段
   * - 返回 `{ success, error? }`
   *
   * 【重点标记 - customCategories 不再写入】Spec: fix-asset-trait-and-scene-defects / Task 4
   * - v2 manifest 构造时 `customCategories` 强制写 `[]`（不再从 store 读取，因 store 中此字段永远为 `[]`）
   * - 自定义分类由全局字典 `categoryDictionary.*` IPC 独立持久化，不依赖 saveTraits
   * - 保留 `customCategories: []` 字段以兼容 `CharacterTraitManifestV2` 类型签名与旧文件读取
   *
   * 注：traits / combinations / activeCombinationId 已由各 action 修改完毕，
   *     saveTraits 仅负责持久化，不再接收 traits 参数（v1 旧签名已废弃）。
   */
  saveTraits: (
    characterCardId?: string,
    appearanceDescription?: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * 追加单个特征项（仅本地 state，不调 IPC）。
   * - trim 后非空且不重复（与已有 traits 的 text 比对，大小写敏感）则追加到末尾
   * - 创建 `CharacterTraitItem`：`{ id: genTraitId(), text, categoryId: categoryId ?? UNCATEGORIZED_CATEGORY_ID, enabled: true }`
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success, error? }`，重复或空串时 success=false
   */
  addTrait: (text: string, categoryId?: string) => { success: boolean; error?: string };

  /**
   * 移除指定 traitId 的特征项（仅本地 state，不调 IPC）。
   * - 按 traitId 过滤移除（v2 改用 id 而非 index，因 UI 在分类面板中展示特征，index 不稳定）
   * - 同步清理 combinations 中所有 traitIds 对该 id 的引用（删除失效引用）
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success, error? }`
   */
  removeTrait: (traitId: string) => { success: boolean; error?: string };

  /**
   * 更新指定 traitId 的特征文本（仅本地 state，不调 IPC）。
   * - trim 后非空
   * - 与其他 trait 文本去重（排除当前 id）
   * - 更新 text 字段（id / categoryId / enabled 不变）
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success, error? }`
   *
   * 【重点标记 - 编辑清空翻译】Spec: add-ai-tag-chinese-translation / Task 4
   * - 更新 text 时同步置 `translation: undefined`，避免翻译与新 tag 文本不符
   *   （translation 由 AI 生成时产出，与原 text 配对；text 变更后翻译失效）
   * - 此 action 同时覆盖两条调用路径，无需在调用方重复清空：
   *   1. `AssetManagerModal.handleSaveEdit`（行内编辑保存）
   *   2. `AssetManagerModal.handleManualReplace`（末轮人工审核替换）
   *   以及 `AssetGenerateModal` 的行内编辑路径
   * - 持久化由调用方在「保存」按钮点击时统一调用 saveTraits 落盘
   */
  updateTrait: (traitId: string, newText: string) => { success: boolean; error?: string };

  /**
   * 更新指定 traitId 的 SDXL 权重字段（仅本地 state，不调 IPC）。
   *
   * 【Spec: add-sdxl-prompt-weight-support / Task 6.3】
   * - 用于 UI 权重编辑器（Task 7/8）修改单个 trait 的 weight
   * - 仅修改 weight 字段，不影响 id / text / categoryId / enabled / translation / originalText
   *   （与 `updateTrait` 编辑 text 时清空 translation 的策略不同：编辑 weight 不清空任何其他字段）
   * - weight 为 undefined / 非数字 / NaN 时清空 weight 字段（恢复默认 1.0 语义）
   * - 范围校验（0.1-10.0）由 `normalizeTraitItem` 在持久化时兜底，此处仅做类型校验，
   *   便于 UI 实时显示用户输入（含越界值，由 saveTraits 落盘时统一兜底）
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success, error? }`
   */
  updateTraitWeight: (
    traitId: string,
    weight: number | undefined,
  ) => { success: boolean; error?: string };

  /**
   * 批量合并 AI 生成的「带分类」特征项数组到本地 state（仅本地 state，不调 IPC）。
   *
   * 【重点标记 - AI 自动归类增强】入参由 `string[]` 升级为 `CategorizedTrait[]`，
   * 使 AI 生成的特征直接进入对应系统分类，无需用户手动归类。
   *
   * 【重点标记 - Bug 修复：tag 数量不符】入参去重键由 `${categoryId}::${text}` 改为
   * 仅 `text`，避免 LLM 将同一 tag 归入不同分类时产生重复项，导致 SD 提示词出现重复 tag。
   *
   * MERGE 策略（保留既有用户手动分类不丢失 + 用 AI 分类更新未分类项）：
   * 1. 现有 traits 中 `categoryId !== uncategorized` 的 → 保留（用户手动分类的不丢失，无论是否在新集合中）
   * 2. 现有 traits 中 `categoryId === uncategorized` 且 text 在新集合中的 → 用新集合中的 categoryId 更新
   *    （即「未分类」中的特征被 AI 重新分类到系统分类；若 AI 也未分类则保持 uncategorized）
   * 3. 现有 traits 中 `categoryId === uncategorized` 且 text 不在新集合中的 → 移除（AI 替换未分类特征）
   * 4. 新集合中不存在于现有 traits（任意分类）的 → 追加为
   *    `{ id: genTraitId(), text, categoryId: 新集合的 categoryId, enabled: true }`
   *
   * 入参会做防御性处理：非数组转为空数组，每个元素 trim + 过滤空串 + 按 text 去重（保留首次出现的分类）
   * 返回 `{ success: true }`（此 action 永不失败）
   */
  setTraits: (traits: CategorizedTrait[]) => { success: boolean; error?: string };

  /**
   * 设置角色外观描述（仅本地 state，不调 IPC）。
   * - 用于 AI 生成特征后填入描述，或用户手动编辑
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success: true }`（此 action 永不失败）
   */
  setAppearanceDescription: (description: string) => { success: boolean; error?: string };

  /**
   * 清空当前所有特征标签 + 外观描述（仅本地 state，不调 IPC，不持久化）。
   *
   * Spec: add-clear-traits-button（角色特征页面「清空」按钮）
   *
   * 与 `setTraits([])` 的区别：
   *  - `setTraits([])` 采用 MERGE 策略，**保留已分类项**（categoryId !== uncategorized），
   *    仅移除未分类项 —— 用于 AI 生成特征时合并，不适合「一键清空」场景
   *  - `clearTraits` 直接 `set({ traits: [], appearanceDescription: '' })`，绕过 MERGE，
   *    真正清空全部特征（含已分类项），用于用户主动「清空」操作
   *
   * 不清空 combinations / activeCombinationId / globalCategories：
   *  - 组合方案是用户保存的命名快照，清空特征不应删除方案
   *  - globalCategories 是全局字典缓存，清空特征不影响分类体系
   *
   * 调用方需在合适时机调用 saveTraits 持久化（清空后用户点「保存」才真正落盘）。
   * 返回 `{ success: true }`（此 action 永不失败）
   */
  clearTraits: () => { success: boolean; error?: string };

  // -------- 分类管理（全局字典 IPC，Spec: fix-asset-trait-and-scene-defects / Task 4） --------

  /**
   * 新增自定义分类（异步，调用 `categoryDictionary.add` IPC 写入全局字典）。
   *
   * Spec: fix-asset-trait-and-scene-defects / Task 4.3
   * - 调用 `window.electronAPI.categoryDictionary.add({ name })`
   * - 主进程 service 行为：name 为空时返回 `{ success: false, error }`；
   *   重名时返回 `{ success: true, category: <既有分类> }`（幂等，不创建副本）
   * - 成功后追加 `result.category` 到 `globalCategories` state（浅拷贝构造新引用）
   * - 返回 `{ success, error?, category? }`（与 IPC 返回值一致，便于 UI 拿到新分类 id）
   *
   * 与旧 `addCategory` 同步 action 的差异：
   * - 旧 action 仅修改本地 `customCategories` state，需调用方再调 `saveTraits` 持久化到 manifest
   * - 新 action 直接通过 IPC 持久化到全局字典 `trait-categories.json`，跨角色卡共享
   */
  createCategory: (name: string) => Promise<{ success: boolean; error?: string; category?: TraitCategory }>;

  /**
   * 重命名自定义分类（异步，调用 `categoryDictionary.rename` IPC 写入全局字典）。
   *
   * Spec: fix-asset-trait-and-scene-defects / Task 4.4
   * - 调用 `window.electronAPI.categoryDictionary.rename({ id, newName })`
   * - 主进程 service 行为：newName 为空 / 重名时返回 `{ success: false, error }`；
   *   id 不存在视为幂等成功（返回 `{ success: true }`）
   * - 成功后更新 `globalCategories` state 中对应分类的 name（浅拷贝构造新引用）
   * - 返回 `{ success, error? }`
   *
   * 系统分类与未分类拒绝重命名（id 校验由调用方在 UI 层处理，store 不重复校验；
   * 若调用方误传系统分类 id，主进程会因找不到该 id 而返回幂等成功，不会破坏系统分类）
   */
  renameCategory: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>;

  /**
   * 删除自定义分类（异步，调用 `categoryDictionary.delete` IPC 写入全局字典）。
   *
   * Spec: fix-asset-trait-and-scene-defects / Task 4.4
   * - 调用 `window.electronAPI.categoryDictionary.delete({ id })`（幂等：id 不存在视为成功）
   * - 成功后：
   *   1. 从 `globalCategories` state 移除该分类（浅拷贝构造新引用）
   *   2. 将 `traits` 中所有 `categoryId === id` 的特征回退到 `UNCATEGORIZED_CATEGORY_ID`
   *      （与旧 `deleteCategory` 同步 action 的回退策略一致，特征本身不删除）
   *   3. 调用 `get().saveTraits()` 持久化 traits 变更到角色卡 manifest
   *      （因 traits 字段变更需落盘，否则下次加载会重新出现已删除分类的 trait 引用）
   * - 返回 `{ success, error? }`
   *
   * 系统分类与未分类拒绝删除（id 校验由调用方在 UI 层处理）
   */
  deleteCategory: (id: string) => Promise<{ success: boolean; error?: string }>;

  // -------- 特征操作 --------

  /**
   * 移动特征到指定分类（仅本地 state，不调 IPC）。
   * - 更新 trait.categoryId（目标可以是系统分类 / 全局自定义分类 / uncategorized）
   * - 不改变 id / text / enabled
   * - 返回 `{ success, error? }`
   *
   * 【重点标记 - 使用 globalCategories 校验】Spec: fix-asset-trait-and-scene-defects / Task 4
   * - 目标分类存在性校验改为读取 `globalCategories`（不再读 `customCategories`）
   * - 因 `globalCategories` 由全局字典填充，跨角色卡共享，移动目标范围与 UI 显示的分类列表一致
   */
  moveTrait: (traitId: string, targetCategoryId: string) => { success: boolean; error?: string };

  /**
   * 切换特征启用状态（仅本地 state，不调 IPC）。
   * - 翻转 enabled
   * - 进入手动模式：`activeCombinationId = null`（Spec Scenario: 手动编辑进入手动模式）
   * - 返回 `{ success, error? }`
   */
  toggleTraitEnabled: (traitId: string) => { success: boolean; error?: string };

  // -------- 组合方案 --------

  /**
   * 保存当前启用特征集合为命名组合方案（修改本地 state 后立即调用 `saveTraits()` 持久化）。
   *
   * 【Spec: optimize-trait-translation-and-temp-scheme】traitSnapshot 支持：
   * - 新增可选 `snapshot` 参数：传入时同时保存 traits 完整快照（深拷贝），applyCombination 时
   *   用快照完整替换 traits（而非仅切换 enabled），解决「保存方案后编辑特征 → 应用方案时特征丢失」问题
   * - 不传 `snapshot` 时仅保存 traitIds（向后兼容 AssetManagerModal 旧调用 + 旧方案加载）
   * - 旧方案（无 traitSnapshot）在 applyCombination 中走 traitIds 分支，行为不变
   *
   * - trim 后非空；与现有组合名去重（大小写敏感）
   * - 创建 `{ id: genTraitId(), name, traitIds: 当前 enabled=true 的 trait id 快照, traitSnapshot?, createdAt, updatedAt }`
   * - 追加到 combinations
   * - 不自动设 activeCombinationId（保存方案不等于应用方案）
   * - 立即持久化（fire-and-forget 调 `get().saveTraits()`；
 *   持久化失败时 saveTraits 内部回滚 combinations，仅记录日志，不向调用方抛错）
   * - 返回 `{ success, error? }`（同步签名，调用方无需 await）
   */
  saveCombination: (
    name: string,
    snapshot?: CharacterTraitItem[],
  ) => { success: boolean; error?: string };

  /**
   * 覆盖已有的同名组合方案（保留原 id / createdAt，更新 traitIds / traitSnapshot / updatedAt）。
   *
   * - 按名称精确匹配（大小写敏感），找不到时返回 `{ success: false, error }`
   * - traitIds 从 store `traits` 派生（与 saveCombination 一致）
   * - snapshot 非空时深拷贝写入 traitSnapshot（与 saveCombination 一致）
   * - 立即持久化（fire-and-forget 调 `get().saveTraits()`）
   * - 返回 `{ success, error? }`（同步签名）
   */
  overwriteCombination: (
    name: string,
    snapshot?: CharacterTraitItem[],
  ) => { success: boolean; error?: string };

  /**
   * 应用指定组合方案（仅本地 state，不调 IPC——applyCombination 不改变方案列表，无需持久化）。
   *
   * 【Spec: optimize-trait-translation-and-temp-scheme】traitSnapshot 分支：
   * - 若 combination.traitSnapshot 存在且非空 → 用快照完整替换 traits（深拷贝，保留 text/categoryId/enabled/id 等全部字段）
   * - 否则走 traitIds 分支（向后兼容旧方案）：仅切换 enabled 状态，trait 本身不变
   *
   * - `combinationId === null` 时取消激活（设 `activeCombinationId = null`，
 *   便于 UI allowClear 场景；现有调用方仍传 string，非破坏性扩展）
   * - 找不到 combination 时返回 `{ success: false, error }`
   * - traitIds 分支：traitIds 中失效的 id（trait 已删除）静默跳过
   * - 返回 `{ success, error? }`
   */
  applyCombination: (combinationId: string | null) => { success: boolean; error?: string };

  /**
   * 删除指定组合方案（修改本地 state 后立即调用 `saveTraits()` 持久化）。
   * - 从 combinations 移除
   * - 若它是 activeCombinationId，置 `activeCombinationId = null`（进入手动模式）
   * - 不影响任何特征项本身
   * - 立即持久化（fire-and-forget 调 `get().saveTraits()`，与 saveCombination 一致）
   * - 返回 `{ success, error? }`
   */
  deleteCombination: (combinationId: string) => { success: boolean; error?: string };

  /** 重置所有 v2 状态（离开角色卡编辑界面时调用） */
  clear: () => void;
}

// ==================== Store 实现 ====================

export const useCharacterTraitStore = create<CharacterTraitState>((set, get) => ({
  currentCharacterCardId: null,
  traits: [],
  // 【重点标记 - 全局分类字典 state】Spec: fix-asset-trait-and-scene-defects / Task 4
  // - globalCategories 由 categoryDictionary.load() IPC 填充，跨角色卡共享，是自定义分类的唯一读取源
  // - 初始值 []，loadTraits 完成后填充
  globalCategories: [],
  // customCategories 已废弃：永远为 []，仅为兼容 CharacterTraitManifestV2 类型签名
  // 旧实现从 manifest 读取，现改为全局字典；saveTraits 写入 []
  customCategories: [],
  combinations: [],
  activeCombinationId: null,
  // 【Spec: optimize-trait-translation-and-temp-scheme】traitSnapshot 方案应用前的 traits 备份
  preCombinationTraits: null,
  appearanceDescription: '',
  loading: false,
  error: null,

  loadTraits: async (characterCardId: string) => {
    if (!characterCardId) {
      console.warn('[characterTraitStore] loadTraits: characterCardId 为空，跳过加载');
      return;
    }

    set({ loading: true, error: null, currentCharacterCardId: characterCardId });

    try {
      if (!window.electronAPI?.characterTrait?.loadData) {
        console.warn(
          '[characterTraitStore] loadTraits: window.electronAPI.characterTrait.loadData 不可用'
        );
        set({
          loading: false,
          error: 'electronAPI.characterTrait.loadData 不可用',
          traits: [],
          // customCategories 已废弃，永远为 []
          customCategories: [],
          // globalCategories 兜底为 []（IPC 不可用时无分类可加载）
          globalCategories: [],
          combinations: [],
          activeCombinationId: null,
          preCombinationTraits: null, // 重置备份（加载新角色卡时无方案激活）
          appearanceDescription: '',
        });
        return;
      }

      // 调用 loadData 一次性获取完整 v2 manifest（含 traits / combinations /
      // activeCombinationId / appearanceDescription）
      //
      // 【重点标记 - 不再读取 manifest.customCategories】Spec: fix-asset-trait-and-scene-defects / Task 4
      // - 主进程 loadTraitData 仍会返回 customCategories 字段（兼容旧文件），但本 store 不再使用它
      // - 主进程加载含 customCategories 的旧 manifest 时已自动调用 migrateFromManifest 合并到全局字典
      // - 自定义分类的唯一读取源改为下方 categoryDictionary.load() 返回的 globalCategories
      const data = await window.electronAPI.characterTrait.loadData(characterCardId);

      // 防御性兜底：loadData 返回值字段缺失时补默认（主进程已兜底，此处二次防御）
      const safeTraits: CharacterTraitItem[] = Array.isArray(data?.traits) ? data.traits : [];
      // customCategories 强制为 []（不再读取 manifest 的 customCategories 字段）
      const safeCombinations: TraitCombination[] = Array.isArray(data?.combinations)
        ? data.combinations
        : [];
      const safeActiveCombinationId: string | null =
        data?.activeCombinationId === null || data?.activeCombinationId === undefined
          ? null
          : String(data.activeCombinationId);
      const safeDescription: string =
        typeof data?.appearanceDescription === 'string' ? data.appearanceDescription : '';

      // 【重点标记 - 加载全局分类字典】Spec: fix-asset-trait-and-scene-defects / Task 4
      // - 调用 categoryDictionary.load() IPC 拉取全局分类字典，填充 globalCategories
      // - 字典文件不存在或损坏时主进程返回空白字典（categories=[]），此处二次防御
      // - categoryDictionary IPC 不可用时 globalCategories 兜底为 []（不阻塞特征加载）
      let safeGlobalCategories: TraitCategory[] = [];
      try {
        if (window.electronAPI?.categoryDictionary?.load) {
          const dictResult = await window.electronAPI.categoryDictionary.load();
          if (dictResult?.success && Array.isArray(dictResult.dictionary?.categories)) {
            safeGlobalCategories = dictResult.dictionary.categories;
          } else if (!dictResult?.success) {
            console.warn(
              '[characterTraitStore] loadTraits: categoryDictionary.load 返回失败，globalCategories 兜底为 []',
              dictResult?.error
            );
          }
        } else {
          console.warn(
            '[characterTraitStore] loadTraits: window.electronAPI.categoryDictionary.load 不可用，globalCategories 兜底为 []'
          );
        }
      } catch (dictError) {
        // 全局字典加载失败不阻塞特征加载，仅记录日志
        console.warn(
          '[characterTraitStore] loadTraits: categoryDictionary.load 抛出异常，globalCategories 兜底为 []',
          dictError
        );
      }

      set({
        traits: safeTraits,
        // customCategories 已废弃，永远为 []
        customCategories: [],
        globalCategories: safeGlobalCategories,
        combinations: safeCombinations,
        activeCombinationId: safeActiveCombinationId,
        preCombinationTraits: null, // 从磁盘加载时清空备份（applyCombination 不持久化，无需恢复）
        appearanceDescription: safeDescription,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('[characterTraitStore] loadTraits failed:', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : '加载特征失败',
      });
    }
  },

  saveTraits: async (characterCardId?: string, appearanceDescription?: string) => {
    try {
      if (!window.electronAPI?.characterTrait?.saveData) {
        return { success: false, error: 'electronAPI.characterTrait.saveData 不可用' };
      }

      const state = get();
      // characterCardId 缺省时使用 currentCharacterCardId
      const cardId = characterCardId ?? state.currentCharacterCardId;
      if (!cardId) {
        return { success: false, error: 'characterCardId 为空（未加载角色卡）' };
      }

      // 保存旧 v2 state 引用，用于失败回滚
      const prevTraits = state.traits;
      const prevCustomCategories = state.customCategories;
      const prevCombinations = state.combinations;
      const prevActiveCombinationId = state.activeCombinationId;
      const prevDescription = state.appearanceDescription;

      // 若显式传入 appearanceDescription（含空串），先 set 更新 store 再保存；undefined 时使用 store 当前值
      const descToSave =
        appearanceDescription !== undefined ? appearanceDescription : prevDescription;

      if (appearanceDescription !== undefined) {
        set({ appearanceDescription: descToSave });
      }

      // 构建完整 v2 manifest 持久化
      const data: CharacterTraitManifestV2 = {
        characterCardId: cardId,
        version: 2,
        appearanceDescription: descToSave,
        traits: state.traits,
        customCategories: state.customCategories,
        combinations: state.combinations,
        activeCombinationId: state.activeCombinationId,
      };

      const result = await window.electronAPI.characterTrait.saveData({
        characterCardId: cardId,
        data,
      });

      if (!result?.success) {
        // 失败回滚全部 v2 字段
        set({
          traits: prevTraits,
          customCategories: prevCustomCategories,
          combinations: prevCombinations,
          activeCombinationId: prevActiveCombinationId,
          appearanceDescription: prevDescription,
        });
        return { success: false, error: result?.error ?? '保存特征失败' };
      }

      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] saveTraits failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存特征失败',
      };
    }
  },

  addTrait: (text: string, categoryId?: string) => {
    try {
      const trimmed = (text ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '特征不能为空' };
      }

      const { traits } = get();
      // 大小写敏感去重（按 text 字段）
      if (traits.some((t) => t.text === trimmed)) {
        return { success: false, error: '特征已存在' };
      }

      // 创建结构化特征项：默认归入未分类、enabled=true
      const newItem: CharacterTraitItem = {
        id: genTraitId(),
        text: trimmed,
        categoryId: categoryId ?? UNCATEGORIZED_CATEGORY_ID,
        enabled: true,
      };

      // 浅拷贝构造新引用，追加到末尾
      set({ traits: [...traits, newItem] });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] addTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '添加特征失败',
      };
    }
  },

  removeTrait: (traitId: string) => {
    try {
      const { traits, combinations } = get();
      const exists = traits.some((t) => t.id === traitId);
      if (!exists) {
        return { success: false, error: '特征不存在' };
      }

      // 浅拷贝构造新引用，过滤掉指定 traitId
      const nextTraits = traits.filter((t) => t.id !== traitId);
      // 同步清理 combinations 中所有 traitIds 对该 id 的引用（删除失效引用）
      const nextCombinations = combinations.map((c) => ({
        ...c,
        traitIds: c.traitIds.filter((id) => id !== traitId),
      }));

      set({ traits: nextTraits, combinations: nextCombinations });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] removeTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '移除特征失败',
      };
    }
  },

  updateTrait: (traitId: string, newText: string) => {
    try {
      const { traits } = get();
      const trimmed = (newText ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '特征不能为空' };
      }

      // 与其他 trait 文本去重（排除当前 id）
      const duplicate = traits.some((t) => t.id !== traitId && t.text === trimmed);
      if (duplicate) {
        return { success: false, error: '特征已存在' };
      }

      // 浅拷贝构造新引用，更新指定 traitId 的 text 字段
      // 【重点标记 - 编辑清空翻译】Spec: add-ai-tag-chinese-translation / Task 4
      // 同步置 translation: undefined（避免翻译与新 tag 文本不符），覆盖 handleSaveEdit +
      // handleManualReplace + AssetGenerateModal 行内编辑三条调用路径，无需调用方重复清空。
      const nextTraits = traits.map((t) =>
        t.id === traitId ? { ...t, text: trimmed, translation: undefined } : t
      );
      set({ traits: nextTraits });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] updateTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新特征失败',
      };
    }
  },

  // 【Spec: add-sdxl-prompt-weight-support / Task 6.3】更新单个 trait 的 weight 字段
  updateTraitWeight: (traitId: string, weight: number | undefined) => {
    try {
      const { traits } = get();
      const exists = traits.some((t) => t.id === traitId);
      if (!exists) {
        return { success: false, error: '特征不存在' };
      }

      // 类型校验：非数字 / NaN 兜底为 undefined（清空 weight，恢复默认 1.0 语义）
      // 范围校验（0.1-10.0）由 normalizeTraitItem 在持久化时兜底，此处仅做类型校验，
      // 便于 UI 实时显示用户输入（含越界值，由 saveTraits 落盘时统一兜底）
      const safeWeight =
        typeof weight === 'number' && !Number.isNaN(weight) ? weight : undefined;

      // 浅拷贝构造新引用，仅更新 weight 字段
      // 【Spec: add-sdxl-prompt-weight-support】编辑 weight 不影响 id / text / categoryId /
      // enabled / translation / originalText（与 updateTrait 编辑 text 时清空 translation 不同）
      const nextTraits = traits.map((t) =>
        t.id === traitId ? { ...t, weight: safeWeight } : t,
      );
      set({ traits: nextTraits });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] updateTraitWeight failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新权重失败',
      };
    }
  },

  setTraits: (traits: CategorizedTrait[]) => {
    try {
      // 防御性处理：非数组转为空数组；每个元素 trim text + 过滤空串 + 按 text 去重
      // 同时将 categoryId 兜底为 UNCATEGORIZED_CATEGORY_ID（防止传入未知分类 id 时破坏不变式）
      // 【Bug 修复 - Spec: fix-asset-trait-and-scene-defects §5.7】原 validCategoryIds 仅含
      // SYSTEM_TRAIT_CATEGORIES + UNCATEGORIZED_CATEGORY_ID，未合并 globalCategories 中的自定义分类，
      // 导致 AI 返回的 weapon:gun 在 parseTraitsFromContent 阶段正确解析为 { categoryId: 'weapon' }，
      // 但在 setTraits 二次校验时被兜底为 uncategorized。修复：合并 get().globalCategories。
      const validCategoryIds = new Set([
        ...SYSTEM_TRAIT_CATEGORIES.map((c) => c.id),
        ...get().globalCategories.map((c) => c.id),
        UNCATEGORIZED_CATEGORY_ID,
      ]);
      const seen = new Set<string>();
      let duplicateCount = 0;
      // 【重点标记 - 透传 translation】Spec: add-ai-tag-chinese-translation / Task 4
      // safeTraits 映射时保留 AI 产出的 translation 字段（trim 后非空才保留），
      // 供后续 path 2（未分类项重新分类时刷新翻译）+ path 4（新增项携带翻译）使用。
      // 旧实现 return { text, categoryId } 丢弃 translation，导致 AI 翻译无法持久化。
      const safeTraits: CategorizedTrait[] = Array.isArray(traits)
        ? traits
            .map((t) => {
              const text = typeof t?.text === 'string' ? t.text.trim() : '';
              let categoryId =
                typeof t?.categoryId === 'string' && t.categoryId
                  ? t.categoryId
                  : UNCATEGORIZED_CATEGORY_ID;
              // 防御性兜底：未知 categoryId（如自定义分类已删除 / AI typo）归入 uncategorized
              if (!validCategoryIds.has(categoryId)) {
                categoryId = UNCATEGORIZED_CATEGORY_ID;
              }
              // translation 防御性兜底：仅保留非空字符串，其余置 undefined（与 CategorizedTrait 可选字段语义一致）
              const translation =
                typeof t?.translation === 'string' && t.translation.trim()
                  ? t.translation.trim()
                  : undefined;
              // 【Spec: add-sdxl-prompt-weight-support / Task 6.1】weight 透传：
              // 仅保留有效数字（NaN 兜底 undefined），范围校验（0.1-10.0）由 normalizeTraitItem 在持久化时兜底
              const weight =
                typeof t?.weight === 'number' && !Number.isNaN(t.weight) ? t.weight : undefined;
              return {
                text,
                categoryId,
                ...(translation !== undefined ? { translation } : {}),
                ...(weight !== undefined ? { weight } : {}),
              };
            })
            .filter((t) => t.text.length > 0)
            .filter((t) => {
              // 【Bug 修复 - tag 数量不符】原去重键为 `${categoryId}::${text}`（组合键），
              // 当 AI 将同一 tag 归入不同分类时（如 basic:white fur + body:white fur），
              // 两条均保留，导致 traitsToAdd 中出现同 text 重复项，最终 SD 提示词中产生重复 tag。
              // 现改为仅按 text 去重，保留首次出现的分类，与 SD tag 语义一致。
              if (seen.has(t.text)) {
                duplicateCount++;
                return false;
              }
              seen.add(t.text);
              return true;
            })
        : [];

      if (duplicateCount > 0) {
        console.log(
          '[characterTraitStore] setTraits: 去重移除',
          duplicateCount,
          '条同文本跨分类重复 tag，保留',
          safeTraits.length,
          '条唯一 tag',
        );
      }

      const { traits: existingTraits } = get();

      // 索引：新集合中按 text（大小写敏感）→ categoryId，用于未分类项的归类更新
      // 注意：若同一 text 在新集合中以多个 categoryId 出现（去重后），取首次出现的 categoryId
      const newByText = new Map<string, string>();
      // 【重点标记 - 透传 translation】Spec: add-ai-tag-chinese-translation / Task 4
      // 同步建立 text → translation 索引，供 path 2（未分类项重新分类时刷新翻译）使用。
      // 仅当 AI 显式提供非空 translation 时才覆盖既有 trait 的 translation，否则保留既有值。
      const newByTranslation = new Map<string, string>();
      // 【Spec: add-sdxl-prompt-weight-support / Task 6.1】同步建立 text → weight 索引，
      // 供 path 2（未分类项重新分类时刷新 weight）使用。仅当 AI 显式提供有效数字时才覆盖既有 weight。
      const newByWeight = new Map<string, number>();
      for (const t of safeTraits) {
        if (!newByText.has(t.text)) {
          newByText.set(t.text, t.categoryId);
          if (typeof t.translation === 'string') {
            newByTranslation.set(t.text, t.translation);
          }
          if (typeof t.weight === 'number') {
            newByWeight.set(t.text, t.weight);
          }
        }
      }
      const newTextSet = new Set(newByText.keys());

      // MERGE 策略（Spec: 保留既有已分类项不丢失 + 用 AI 分类更新未分类项）：
      // 1. 现有 traits 中 categoryId !== uncategorized 的 → 保留（用户手动分类的不丢失）
      // 2. 现有 traits 中 categoryId === uncategorized 且 text 在新集合中的 → 用 AI 的 categoryId 更新
      // 3. 现有 traits 中 categoryId === uncategorized 且 text 不在新集合中的 → 移除（AI 替换未分类特征）
      const preservedTraits: CharacterTraitItem[] = [];
      for (const t of existingTraits) {
        if (t.categoryId !== UNCATEGORIZED_CATEGORY_ID) {
          // 1. 用户手动分类的：原样保留
          preservedTraits.push(t);
        } else if (newTextSet.has(t.text)) {
          // 2. 未分类但在新集合中：用 AI 的 categoryId 更新（可能仍为 uncategorized）
          const newCategoryId = newByText.get(t.text) ?? UNCATEGORIZED_CATEGORY_ID;
          // 若 AI 提供新 translation 则覆盖（AI 重新生成翻译），否则保留既有 translation
          const newTranslation = newByTranslation.get(t.text);
          // 【Spec: add-sdxl-prompt-weight-support / Task 6.1】若 AI 提供新 weight 则覆盖，否则保留既有 weight
          const newWeight = newByWeight.get(t.text);
          preservedTraits.push({
            ...t,
            categoryId: newCategoryId,
            ...(typeof newTranslation === 'string' ? { translation: newTranslation } : {}),
            ...(typeof newWeight === 'number' ? { weight: newWeight } : {}),
          });
        }
        // 3. 未分类且不在新集合中：跳过（移除）
      }

      // 4. 新集合中不存在于现有 traits（任意分类）的 → 追加为 { id, text, categoryId: AI's, enabled: true }
      // 【重点标记 - 透传 translation】Spec: add-ai-tag-chinese-translation / Task 4
      // - 新增项携带 AI 产出的 translation（若存在）
      // - 仅当 translation 为非空字符串时写入字段，否则省略（与 CategorizedTrait 可选字段语义一致）
      // 【Spec: add-sdxl-prompt-weight-support / Task 6.1】新增项携带 AI 产出的 weight（若为有效数字）
      const existingTexts = new Set(existingTraits.map((t) => t.text));
      const traitsToAdd: CharacterTraitItem[] = safeTraits
        .filter((t) => !existingTexts.has(t.text))
        .map((t) => ({
          id: genTraitId(),
          text: t.text,
          categoryId: t.categoryId,
          enabled: true,
          ...(typeof t.translation === 'string' ? { translation: t.translation } : {}),
          ...(typeof t.weight === 'number' ? { weight: t.weight } : {}),
        }));

      // 浅拷贝构造新引用，保留项 + 新增项
      set({ traits: [...preservedTraits, ...traitsToAdd] });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] setTraits failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置特征失败',
      };
    }
  },

  setAppearanceDescription: (description: string) => {
    try {
      const safeDescription = typeof description === 'string' ? description : '';
      set({ appearanceDescription: safeDescription });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] setAppearanceDescription failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置外观描述失败',
      };
    }
  },

  clearTraits: () => {
    try {
      // 直接置空，绕过 setTraits 的 MERGE 策略（MERGE 会保留已分类项）
      // 仅清空本地 state，不调 IPC；用户需点「保存」才持久化清空结果
      set({ traits: [], appearanceDescription: '' });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] clearTraits failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '清空特征失败',
      };
    }
  },

  // ==================== 分类管理（全局字典 IPC，Spec: fix-asset-trait-and-scene-defects / Task 4） ====================
  //
  // 【重点标记 - 旧同步 actions 已替换为异步 IPC actions】
  // - 旧 `addCategory` / `updateCategory` / `deleteCategory` 仅修改本地 `customCategories` state，
  //   需调用方再调 `saveTraits` 持久化到角色卡 manifest，自定义分类无法跨角色卡共享（Spec 要修复的核心缺陷）
  // - 新 `createCategory` / `renameCategory` / `deleteCategory` 通过 `categoryDictionary.*` IPC
  //   直接持久化到全局字典 `trait-categories.json`（跨角色卡共享、重启后保留）
  // - 系统分类 / 未分类的 id 校验由 UI 层处理（store 不重复校验，避免与主进程 service 行为耦合）

  createCategory: async (name: string) => {
    try {
      const trimmed = (name ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '分类名不能为空' };
      }

      if (!window.electronAPI?.categoryDictionary?.add) {
        return { success: false, error: 'electronAPI.categoryDictionary.add 不可用' };
      }

      // 调用 IPC 写入全局字典；主进程 service 行为：
      // - name 为空时 throw（已被上方 trim 校验拦截）
      // - 重名时返回既有分类（幂等，不创建副本）
      // - 创建后立即 saveDictionary 落盘
      const result = await window.electronAPI.categoryDictionary.add({ name: trimmed });
      if (result?.success && result.category) {
        // 浅拷贝构造新引用，追加到 globalCategories
        set({
          globalCategories: [...get().globalCategories, result.category],
        });
        return { success: true, category: result.category };
      }
      return {
        success: false,
        error: result?.error || '创建分类失败',
      };
    } catch (error) {
      console.error('[characterTraitStore] createCategory failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建分类失败',
      };
    }
  },

  renameCategory: async (id: string, newName: string) => {
    try {
      const trimmed = (newName ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '分类名不能为空' };
      }

      if (!window.electronAPI?.categoryDictionary?.rename) {
        return { success: false, error: 'electronAPI.categoryDictionary.rename 不可用' };
      }

      // 调用 IPC 重命名全局字典中的分类；主进程 service 行为：
      // - newName 为空 / 重名时 throw（IPC handler 捕获后返回 { success: false, error }）
      // - id 不存在视为幂等成功（返回 { success: true }）
      const result = await window.electronAPI.categoryDictionary.rename({ id, newName: trimmed });
      if (!result?.success) {
        return { success: false, error: result?.error || '重命名分类失败' };
      }

      // 浅拷贝构造新引用，更新 globalCategories 中对应分类的 name
      set({
        globalCategories: get().globalCategories.map((c) =>
          c.id === id ? { ...c, name: trimmed } : c
        ),
      });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] renameCategory failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '重命名分类失败',
      };
    }
  },

  deleteCategory: async (id: string) => {
    try {
      if (!window.electronAPI?.categoryDictionary?.delete) {
        return { success: false, error: 'electronAPI.categoryDictionary.delete 不可用' };
      }

      // 调用 IPC 删除全局字典中的分类（幂等：id 不存在视为成功）
      const result = await window.electronAPI.categoryDictionary.delete({ id });
      if (!result?.success) {
        return { success: false, error: result?.error || '删除分类失败' };
      }

      // 成功后同步本地 state：
      // 1. 从 globalCategories 移除该分类（浅拷贝构造新引用）
      // 2. 将 traits 中所有 categoryId === id 的特征回退到 UNCATEGORIZED_CATEGORY_ID
      //    （与旧同步 deleteCategory 的回退策略一致，特征本身不删除）
      // 3. 调用 saveTraits 持久化 traits 变更到角色卡 manifest
      //    （因 traits 字段变更需落盘，否则下次加载会重新出现已删除分类的 trait 引用）
      const { globalCategories, traits } = get();
      const nextGlobalCategories = globalCategories.filter((c) => c.id !== id);
      const nextTraits = traits.map((t) =>
        t.categoryId === id ? { ...t, categoryId: UNCATEGORIZED_CATEGORY_ID } : t
      );
      set({
        globalCategories: nextGlobalCategories,
        traits: nextTraits,
      });

      // 持久化 traits 变更（characterCardId 缺省取 currentCharacterCardId）
      // 失败仅记录日志，不阻塞删除分类的成功返回（全局字典已删除，本地 state 已更新）
      const saveResult = await get().saveTraits();
      if (!saveResult.success) {
        console.warn(
          '[characterTraitStore] deleteCategory: saveTraits 持久化 traits 回退失败（全局字典已删除，本地 state 已更新）',
          saveResult.error
        );
      }
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] deleteCategory failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除分类失败',
      };
    }
  },

  // ==================== 特征操作 ====================

  moveTrait: (traitId: string, targetCategoryId: string) => {
    try {
      // 【重点标记 - 使用 globalCategories 校验】Spec: fix-asset-trait-and-scene-defects / Task 4
      // - 目标分类存在性校验改为读取 `globalCategories`（不再读 `customCategories`）
      // - 因 `globalCategories` 由全局字典填充，跨角色卡共享，移动目标范围与 UI 显示的分类列表一致
      const { traits, globalCategories } = get();
      const exists = traits.some((t) => t.id === traitId);
      if (!exists) {
        return { success: false, error: '特征不存在' };
      }

      // 目标可以是系统分类 / 全局自定义分类 / uncategorized，校验存在性
      const isSystemCategory = SYSTEM_TRAIT_CATEGORIES.some((c) => c.id === targetCategoryId);
      const isUncategorized = targetCategoryId === UNCATEGORIZED_CATEGORY_ID;
      const isCustomCategory = globalCategories.some((c) => c.id === targetCategoryId);
      if (!isSystemCategory && !isUncategorized && !isCustomCategory) {
        return { success: false, error: '目标分类不存在' };
      }

      // 更新 trait.categoryId（不改变 id / text / enabled）
      const nextTraits = traits.map((t) =>
        t.id === traitId ? { ...t, categoryId: targetCategoryId } : t
      );
      set({ traits: nextTraits });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] moveTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '移动特征失败',
      };
    }
  },

  toggleTraitEnabled: (traitId: string) => {
    try {
      const { traits } = get();
      const target = traits.find((t) => t.id === traitId);
      if (!target) {
        return { success: false, error: '特征不存在' };
      }

      // 翻转 enabled
      const nextTraits = traits.map((t) =>
        t.id === traitId ? { ...t, enabled: !t.enabled } : t
      );
      // 进入手动模式：activeCombinationId = null（Spec Scenario: 手动编辑进入手动模式）
      // 清空 preCombinationTraits：用户手动编辑意味着接受当前特征列表，无需在切换方案时恢复旧备份
      set({ traits: nextTraits, activeCombinationId: null, preCombinationTraits: null });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] toggleTraitEnabled failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '切换启用状态失败',
      };
    }
  },

  // ==================== 组合方案 ====================

  saveCombination: (name: string, snapshot?: CharacterTraitItem[]) => {
    try {
      const trimmed = (name ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '组合名不能为空' };
      }

      const { traits, combinations } = get();
      // 与现有组合名去重（大小写敏感）
      if (combinations.some((c) => c.name === trimmed)) {
        return { success: false, error: '组合名已存在' };
      }

      // traitIds = 当前 enabled=true 的 trait id 快照（始终保存，向后兼容旧 applyCombination 逻辑）
      const traitIds = traits.filter((t) => t.enabled).map((t) => t.id);
      const now = Date.now();
      const newCombination: TraitCombination = {
        id: genTraitId(),
        name: trimmed,
        traitIds,
        // 【Spec: optimize-trait-translation-and-temp-scheme】traitSnapshot：
        // 保存当前 traits 完整快照，applyCombination 时用快照完整替换 traits（而非仅切换 enabled），
        // 解决「保存方案后编辑特征 → 应用方案时特征丢失」问题。
        // 深拷贝（{ ...t }）避免后续 trait 编辑污染快照；snapshot 为 undefined 时省略字段，
        // 与旧方案（仅 traitIds）兼容，applyCombination 会自动走 traitIds 分支。
        ...(snapshot ? { traitSnapshot: snapshot.map((t) => ({ ...t })) } : {}),
        createdAt: now,
        updatedAt: now,
      };

      set({ combinations: [...combinations, newCombination] });
      // 不自动设 activeCombinationId（保存方案不等于应用方案）

      // 【Spec: optimize-trait-translation-and-temp-scheme】立即持久化
      // fire-and-forget：保持同步签名（调用方无需 await），saveTraits 失败时内部已回滚 combinations，
      // 此处仅记录日志，不向调用方抛错（与 deleteCombination 的 await 模式不同，
      // 因 saveCombination 调用方 AssetManagerModal.handleOpenSaveCombination 同步消费 result.success）
      void get()
        .saveTraits()
        .catch((e) => {
          console.error(
            '[characterTraitStore] saveCombination: saveTraits 持久化失败（state 已回滚）',
            e,
          );
        });

      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] saveCombination failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存组合失败',
      };
    }
  },

  overwriteCombination: (name: string, snapshot?: CharacterTraitItem[]) => {
    try {
      const trimmed = (name ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '组合名不能为空' };
      }

      const { traits, combinations } = get();
      const existing = combinations.find((c) => c.name === trimmed);
      if (!existing) {
        return { success: false, error: '组合方案不存在' };
      }

      // traitIds = 当前 enabled=true 的 trait id（与 saveCombination 一致）
      const traitIds = traits.filter((t) => t.enabled).map((t) => t.id);
      const updatedCombinations = combinations.map((c) =>
        c.id === existing.id
          ? {
              ...c,
              traitIds,
              // snapshot 深拷贝写入（undefined 时移除 traitSnapshot，回退为纯 traitIds 方案）
              ...(snapshot ? { traitSnapshot: snapshot.map((t) => ({ ...t })) } : {}),
              updatedAt: Date.now(),
            }
          : c,
      );

      set({ combinations: updatedCombinations });

      void get()
        .saveTraits()
        .catch((e) => {
          console.error(
            '[characterTraitStore] overwriteCombination: saveTraits 持久化失败（state 已回滚）',
            e,
          );
        });

      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] overwriteCombination failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '覆盖组合失败',
      };
    }
  },

  applyCombination: (combinationId: string | null) => {
    try {
      // 【Spec: optimize-trait-translation-and-temp-scheme】支持 null 取消激活
      // （便于 UI allowClear 场景；
      // 现有调用方 AssetManagerModal.handleApplyCombination 仍传 string，非破坏性扩展）
      if (combinationId === null) {
        const { preCombinationTraits } = get();
        // 从备份恢复 traits（若有），让手动模式回到方案应用前的状态
        set({
          ...(preCombinationTraits
            ? { traits: preCombinationTraits.map((t) => ({ ...t })) }
            : {}),
          activeCombinationId: null,
          preCombinationTraits: null, // 清空备份，避免多次切换累积
        });
        return { success: true };
      }

      const { traits, combinations } = get();
      const combination = combinations.find((c) => c.id === combinationId);
      if (!combination) {
        return { success: false, error: '组合方案不存在' };
      }

      // 【Spec: optimize-trait-translation-and-temp-scheme】traitSnapshot 分支：
      // 用快照完整替换 traits（深拷贝，保留 text/categoryId/enabled/id/translation 等全部字段），
      // 解决「保存方案后编辑特征 → 应用方案时特征丢失」问题。
      // 同时备份当前 traits 到 preCombinationTraits，供切换到手动模式时恢复。
      if (combination.traitSnapshot && combination.traitSnapshot.length > 0) {
        set({
          preCombinationTraits: traits.map((t) => ({ ...t })),
          traits: combination.traitSnapshot.map((t) => ({ ...t })),
          activeCombinationId: combinationId,
        });
      } else {
        // traitIds 分支（向后兼容旧方案）：仅切换 enabled 状态，trait 本身不变
        const enabledIdSet = new Set(combination.traitIds);
        set({
          traits: traits.map((t) => ({
            ...t,
            enabled: enabledIdSet.has(t.id),
          })),
          activeCombinationId: combinationId,
        });
        // traitIds 中失效的 id（trait 已删除）静默跳过（Set.has 自然处理）
      }

      // applyCombination 不改变方案列表，无需持久化（仅切换当前 traits / activeCombinationId）
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] applyCombination failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '应用组合失败',
      };
    }
  },

  deleteCombination: (combinationId: string) => {
    try {
      const { combinations, activeCombinationId } = get();
      const exists = combinations.some((c) => c.id === combinationId);
      if (!exists) {
        return { success: false, error: '组合方案不存在' };
      }

      const nextCombinations = combinations.filter((c) => c.id !== combinationId);
      // 若它是 activeCombinationId，置 null（进入手动模式）
      const wasActive = activeCombinationId === combinationId;
      const nextActiveCombinationId = wasActive ? null : activeCombinationId;

      // 删除的是激活的 traitSnapshot 方案时，从备份恢复 traits（与切换到手动模式行为一致）
      const { preCombinationTraits } = get();
      const shouldRestore = wasActive && preCombinationTraits;

      set({
        combinations: nextCombinations,
        activeCombinationId: nextActiveCombinationId,
        ...(shouldRestore
          ? {
              traits: preCombinationTraits!.map((t) => ({ ...t })),
              preCombinationTraits: null,
            }
          : {}),
      });

      // 【Spec: optimize-trait-translation-and-temp-scheme】立即持久化（与 saveCombination 一致）
      // fire-and-forget：保持同步签名，saveTraits 失败时内部已回滚 combinations，仅记录日志
      void get()
        .saveTraits()
        .catch((e) => {
          console.error(
            '[characterTraitStore] deleteCombination: saveTraits 持久化失败（state 已回滚）',
            e,
          );
        });

      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] deleteCombination failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除组合失败',
      };
    }
  },

  clear: () => {
    set({
      currentCharacterCardId: null,
      traits: [],
      // customCategories 已废弃，永远为 []
      customCategories: [],
      // 【重点标记 - 重置 globalCategories】Spec: fix-asset-trait-and-scene-defects / Task 4
      // - 离开角色卡编辑界面时清空全局分类缓存，下次 loadTraits 重新拉取
      globalCategories: [],
      combinations: [],
      activeCombinationId: null,
      preCombinationTraits: null, // 清空备份
      appearanceDescription: '',
      loading: false,
      error: null,
    });
  },
}));

// ==================== 类型导出 ====================

export type { CharacterTraitState };
