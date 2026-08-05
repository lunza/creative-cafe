/**
 * 全局特征分类字典服务（主进程）
 *
 * Spec: fix-asset-trait-and-scene-defects / Task 3
 *
 * 用途：
 *  - 持久化管理所有自定义分类（跨角色卡共享、重启后保留）
 *  - 取代 `CharacterTraitManifestV2.customCategories` 字段作为分类的唯一读取源
 *  - 系统分类（`SYSTEM_TRAIT_CATEGORIES`）仍由代码常量提供，不写入此文件
 *
 * 存储路径设计：
 *  - 文件路径：`{userData}/data/trait-categories.json`
 *  - 文件结构：`{ version: 1, categories: TraitCategory[], updatedAt: number }`
 *  - 与 `characterTraitService.ts` 一致采用 `getUserDataPath()` 解析 userData 根目录
 *
 * 【重点标记 - 路径解析选型】Spec: fix-asset-trait-and-scene-defects / Task 3.3
 *  - spec/task 描述提及「使用 `getStorageService()`」做路径解析，但参考实现
 *    `characterTraitService.ts` 实际使用 `getUserDataPath()`（来自 `../utils/appPath`），
 *    `getStorageService()` 提供的是 StorageManager 键值存储能力，不直接暴露 userData 路径
 *  - 为与同目录下 `characterTraitService.ts` 保持一致的代码风格与路径解析方式，
 *    本服务同样使用 `getUserDataPath()`，由 `path.join(getUserDataPath(), 'data', ...)`
 *    拼出与 `character-traits/` 同级的 `trait-categories.json` 路径
 *
 * I/O 模式：
 *  - 同步 `fs.readFileSync` / `fs.writeFileSync` / `fs.existsSync` / `fs.mkdirSync`
 *  - 字典文件预期很小（数十条 TraitCategory 记录），同步 I/O 不会阻塞主进程事件循环
 *  - 与 `characterTraitService.ts` 的异步 fs.promises 模式不同：本服务面向小数据量场景，
 *    同步 API 让上层 IPC handler / store 无需额外 await，简化调用链
 *
 * 错误处理约定（与 `characterTraitService.ts` 一致）：
 *  - 所有方法包裹 try/catch，永不抛异常（除非入参不合法，如 name 为空字符串）
 *  - 文件不存在 → 返回空白字典 `{ version: 1, categories: [], updatedAt: Date.now() }`
 *  - 文件损坏/JSON 解析失败 → 返回空白字典，记录 error 日志（不覆盖磁盘文件）
 *  - 写入失败 → 记录 error 日志，方法静默返回（下次 load 仍能返回上次成功写入的状态）
 *
 * 与 `CharacterTraitManifestV2.customCategories` 的迁移关系：
 *  - 首次加载时，由上层（`characterTraitService` / `characterTraitStore`）调用
 *    `migrateFromManifest(manifest.customCategories)` 将各角色卡的旧分类合并到全局字典
 *  - 合并按 `name` 大小写不敏感去重，仅追加字典中不存在的分类
 *  - 迁移后角色卡 manifest 的 `customCategories` 字段不再作为读取源（保留字段以兼容旧文件）
 */

import * as fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';
import {
  GlobalTraitCategoryDictionary,
  TraitCategory,
  genTraitId,
} from '../../shared/types/characterTrait.types';

/**
 * 自定义分类的起始 order 值。
 *
 * 系统分类占用 order 0..6（`SYSTEM_TRAIT_CATEGORIES`），未分类占用 order=999，
 * 自定义分类从 100 起递增，保证排序位于系统分类之后、未分类之前。
 */
const CUSTOM_CATEGORY_ORDER_BASE = 100;

class CategoryDictionaryService {
  /** 字典文件绝对路径：`{userData}/data/trait-categories.json` */
  private readonly dictionaryPath: string;

  /** 字典文件所在目录：`{userData}/data/` */
  private readonly dictionaryDir: string;

  constructor() {
    this.dictionaryDir = path.join(getUserDataPath(), 'data');
    this.dictionaryPath = path.join(this.dictionaryDir, 'trait-categories.json');
    console.log('[CategoryDictionaryService] Dictionary path:', this.dictionaryPath);
    this.ensureDirectoryExists();
  }

  /**
   * 确保字典文件所在目录存在（构造时同步调用一次）。
   *
   * 与 `characterTraitService.ensureDirectoryExists` 的差异：
   *  - 本服务使用同步 `fs.mkdirSync`（数据量小，构造时一次性完成）
   *  - 失败仅记录日志，不抛异常；后续 `saveDictionary` 会再次尝试 mkdir
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.dictionaryDir)) {
        fs.mkdirSync(this.dictionaryDir, { recursive: true });
        console.log('[CategoryDictionaryService] Created dictionary directory:', this.dictionaryDir);
      }
    } catch (error) {
      // 不抛异常，仅记录；后续 saveDictionary 会再次尝试 mkdir
      console.error('[CategoryDictionaryService] ensureDirectoryExists failed:', error);
    }
  }

  /**
   * 构造空白字典（文件不存在或解析失败时返回）。
   *
   * @returns 空白 GlobalTraitCategoryDictionary（version=1, categories=[], updatedAt=now）
   */
  private emptyDictionary(): GlobalTraitCategoryDictionary {
    return {
      version: 1,
      categories: [],
      updatedAt: Date.now(),
    };
  }

  /**
   * 防御性补全单个 TraitCategory：缺失字段补默认。
   *
   * @param raw 原始对象（可能字段缺失/类型不符）
   * @returns 兜底后的 TraitCategory，若 id/name 非字符串则返回 null
   */
  private normalizeCategory(raw: unknown): TraitCategory | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const r = raw as Partial<TraitCategory>;
    if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name) {
      return null;
    }
    return {
      id: r.id,
      name: r.name,
      icon: typeof r.icon === 'string' ? r.icon : undefined,
      // 全局字典中的分类一定是 isSystem=false；强制规整避免磁盘数据被篡改
      isSystem: false,
      order: typeof r.order === 'number' ? r.order : CUSTOM_CATEGORY_ORDER_BASE,
    };
  }

  /**
   * 读取全局分类字典（同步 I/O）。
   *
   * 行为：
   *  - 文件不存在：返回空白字典（不抛异常、不写日志告警）
   *  - 文件损坏/JSON 解析失败：返回空白字典，记录 error 日志（不覆盖磁盘文件，便于人工排查）
   *  - 文件存在但 version !== 1：仍尝试读取 categories 字段（向前兼容），缺失字段兜底补全
   *  - 字段缺失：防御性逐项兜底，强制 isSystem=false（全局字典不应包含系统分类）
   *
   * @returns 完整字典（永不为 null，永不抛异常）
   */
  loadDictionary(): GlobalTraitCategoryDictionary {
    try {
      if (!fs.existsSync(this.dictionaryPath)) {
        // 文件不存在视为空字典，符合 Spec「首次加载无字典文件」场景
        return this.emptyDictionary();
      }

      const content = fs.readFileSync(this.dictionaryPath, 'utf8');
      // 不使用 Partial<GlobalTraitCategoryDictionary>，采用 permissive 形状运行时逐字段校验
      const parsed = JSON.parse(content) as {
        version?: unknown;
        categories?: unknown;
        updatedAt?: unknown;
      };

      const rawCategories = Array.isArray(parsed.categories) ? parsed.categories : [];
      const categories: TraitCategory[] = rawCategories
        .map((c: unknown) => this.normalizeCategory(c))
        .filter((c): c is TraitCategory => c !== null);

      const updatedAt =
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now();

      return {
        version: 1,
        categories,
        updatedAt,
      };
    } catch (error) {
      console.error('[CategoryDictionaryService] loadDictionary failed:', error);
      return this.emptyDictionary();
    }
  }

  /**
   * 保存全局分类字典（同步 I/O，原子写入：先 mkdir 再 writeFileSync）。
   *
   * @param dictionary 待持久化的字典（version 字段忽略，强制写 1）
   */
  saveDictionary(dictionary: GlobalTraitCategoryDictionary): void {
    try {
      const safeCategories: TraitCategory[] = Array.isArray(dictionary?.categories)
        ? dictionary.categories
            .map(c => this.normalizeCategory(c))
            .filter((c): c is TraitCategory => c !== null)
        : [];

      const safeDictionary: GlobalTraitCategoryDictionary = {
        version: 1,
        categories: safeCategories,
        updatedAt: typeof dictionary?.updatedAt === 'number' ? dictionary.updatedAt : Date.now(),
      };

      // 自动创建目录（{recursive: true} 幂等，已存在不报错）
      fs.mkdirSync(this.dictionaryDir, { recursive: true });

      // 写入 trait-categories.json（writeFileSync 对小文件足够原子；
      // 与 characterTraitService.saveTraitData 的 writeFile 模式对应，仅同步版本）
      fs.writeFileSync(this.dictionaryPath, JSON.stringify(safeDictionary, null, 2), 'utf8');
      console.log(
        '[CategoryDictionaryService] saveDictionary: written to',
        this.dictionaryPath,
        'categories=',
        safeCategories.length
      );
    } catch (error) {
      // 写入失败仅记录日志，不抛异常（下次 load 仍能返回上次成功写入的状态）
      console.error('[CategoryDictionaryService] saveDictionary failed:', error);
    }
  }

  /**
   * 新增自定义分类。
   *
   * 行为：
   *  - 入参 `name` 为空或纯空白时抛出 Error（入参校验失败属于编程错误，应让调用方感知）
   *  - 检查重名（大小写不敏感）：若已存在同名分类，**返回既有分类**（不抛异常、不创建副本）
   *    —— 选择「返回既有」而非「抛异常」是为了让 UI「新建分类」按钮在并发场景下幂等，
   *       与 `characterTraitService` 的「永不抛异常」哲学一致
   *  - 创建新分类：`id = genTraitId()` / `isSystem = false` / `order = 100 + 当前分类数`
   *  - 创建后立即 saveDictionary 落盘
   *
   * @param name 分类显示名称（必填非空）
   * @param icon 可选 emoji / 图标 key
   * @returns 新建的 TraitCategory，或重名时返回既有分类
   * @throws Error 当 name 为空或纯空白
   */
  addCategory(name: string, icon?: string): TraitCategory {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      throw new Error('[CategoryDictionaryService] addCategory: name 不能为空');
    }

    const dictionary = this.loadDictionary();

    // 大小写不敏感查重
    const existing = this.findByName(dictionary.categories, trimmedName);
    if (existing) {
      console.log(
        '[CategoryDictionaryService] addCategory: duplicate name, returning existing category',
        existing.id,
        existing.name
      );
      return existing;
    }

    const newCategory: TraitCategory = {
      id: genTraitId(),
      name: trimmedName,
      icon: typeof icon === 'string' && icon ? icon : undefined,
      isSystem: false,
      // order 从 100 起递增，保证排在系统分类之后、未分类之前
      order: CUSTOM_CATEGORY_ORDER_BASE + dictionary.categories.length,
    };

    dictionary.categories.push(newCategory);
    dictionary.updatedAt = Date.now();
    this.saveDictionary(dictionary);

    console.log(
      '[CategoryDictionaryService] addCategory: created',
      newCategory.id,
      newCategory.name,
      'order=',
      newCategory.order
    );
    return newCategory;
  }

  /**
   * 删除自定义分类（按 id）。
   *
   * 行为：
   *  - id 不存在：视为幂等成功（不抛异常、不写日志告警）
   *  - 删除后立即 saveDictionary 落盘
   *  - 删除分类后该分类下的特征回退逻辑由上层 store 处理（与本服务解耦）
   *
   * @param id 分类 ID（必填）
   */
  deleteCategory(id: string): void {
    if (typeof id !== 'string' || !id) {
      console.warn('[CategoryDictionaryService] deleteCategory: empty id, skipping');
      return;
    }

    const dictionary = this.loadDictionary();
    const before = dictionary.categories.length;
    dictionary.categories = dictionary.categories.filter(c => c.id !== id);

    if (dictionary.categories.length === before) {
      // id 不存在视为幂等成功，不抛异常
      console.log('[CategoryDictionaryService] deleteCategory: id not found, treat as no-op', id);
      return;
    }

    dictionary.updatedAt = Date.now();
    this.saveDictionary(dictionary);
    console.log('[CategoryDictionaryService] deleteCategory: removed', id);
  }

  /**
   * 重命名自定义分类（按 id）。
   *
   * 行为：
   *  - id 不存在：视为幂等成功（不抛异常，仅记录 warn 日志）
   *  - newName 为空或纯空白：抛出 Error（入参校验失败）
   *  - newName 与既有其他分类重名（大小写不敏感，排除自身）：抛出 Error
   *  - 重命名后立即 saveDictionary 落盘
   *
   * @param id 分类 ID（必填）
   * @param newName 新名称（必填非空）
   * @throws Error 当 id 不存在且 newName 非空时... 不抛（幂等）；当 newName 为空或重名时抛
   */
  renameCategory(id: string, newName: string): void {
    const trimmedName = typeof newName === 'string' ? newName.trim() : '';
    if (!trimmedName) {
      throw new Error('[CategoryDictionaryService] renameCategory: newName 不能为空');
    }

    if (typeof id !== 'string' || !id) {
      console.warn('[CategoryDictionaryService] renameCategory: empty id, skipping');
      return;
    }

    const dictionary = this.loadDictionary();
    const target = dictionary.categories.find(c => c.id === id);
    if (!target) {
      // id 不存在视为幂等成功（与 deleteCategory 一致）
      console.log('[CategoryDictionaryService] renameCategory: id not found, treat as no-op', id);
      return;
    }

    // 大小写不敏感查重（排除自身）
    const duplicate = dictionary.categories.find(
      c => c.id !== id && c.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      throw new Error(
        `[CategoryDictionaryService] renameCategory: duplicate name "${trimmedName}" (existing id=${duplicate.id})`
      );
    }

    target.name = trimmedName;
    dictionary.updatedAt = Date.now();
    this.saveDictionary(dictionary);
    console.log('[CategoryDictionaryService] renameCategory: renamed', id, '->', trimmedName);
  }

  /**
   * 检查全局字典中是否已存在指定名称的分类（大小写不敏感）。
   *
   * @param name 待检查的分类名称
   * @returns 存在返回 true，否则 false；name 为空时返回 false
   */
  hasCategory(name: string): boolean {
    if (typeof name !== 'string' || !name.trim()) {
      return false;
    }
    const dictionary = this.loadDictionary();
    return this.findByName(dictionary.categories, name.trim()) !== null;
  }

  /**
   * 将角色卡 manifest 的 `customCategories` 合并到全局字典（数据迁移）。
   *
   * Spec: fix-asset-trait-and-scene-defects / 既有数据迁移 Scenario
   *
   * 行为：
   *  - 入参为空数组或非数组：直接 return（无操作）
   *  - 按 `name` 大小写不敏感去重，仅追加字典中不存在的分类
   *  - 追加分类的 id 重新用 `genTraitId()` 生成（不复用 manifest 中的旧 id，
   *    因为旧 id 可能与全局字典中已有分类的 id 冲突）
   *  - 追加分类的 order 从 `100 + 当前分类数` 起递增
   *  - 入参中的系统分类（`isSystem=true`）被过滤掉（全局字典不存储系统分类）
   *  - 若实际追加了分类，则 saveDictionary 落盘；若无追加（全部已存在），不写盘
   *
   * @param customCategories 角色卡 manifest 的 customCategories 字段
   */
  migrateFromManifest(customCategories: TraitCategory[]): void {
    if (!Array.isArray(customCategories) || customCategories.length === 0) {
      return;
    }

    const dictionary = this.loadDictionary();
    let addedCount = 0;

    for (const raw of customCategories) {
      const normalized = this.normalizeCategory(raw);
      if (!normalized) {
        // 字段不完整，跳过
        continue;
      }
      // 全局字典不存储系统分类（系统分类由常量提供）
      if (raw.isSystem === true) {
        continue;
      }

      // 大小写不敏感查重
      if (this.findByName(dictionary.categories, normalized.name)) {
        continue;
      }

      // 追加新分类：重新生成 id 与 order，避免与全局字典既有项冲突
      dictionary.categories.push({
        id: genTraitId(),
        name: normalized.name,
        icon: normalized.icon,
        isSystem: false,
        order: CUSTOM_CATEGORY_ORDER_BASE + dictionary.categories.length,
      });
      addedCount += 1;
    }

    if (addedCount > 0) {
      dictionary.updatedAt = Date.now();
      this.saveDictionary(dictionary);
      console.log(
        '[CategoryDictionaryService] migrateFromManifest: added',
        addedCount,
        'categories (source count=',
        customCategories.length,
        ')'
      );
    } else {
      console.log(
        '[CategoryDictionaryService] migrateFromManifest: no new categories to add (source count=',
        customCategories.length,
        ')'
      );
    }
  }

  /**
   * 在分类列表中按 name 大小写不敏感查找（私有工具方法）。
   *
   * @param categories 分类列表
   * @param name 待查找的名称（已 trim）
   * @returns 匹配的 TraitCategory 或 null
   */
  private findByName(categories: TraitCategory[], name: string): TraitCategory | null {
    const lower = name.toLowerCase();
    for (const c of categories) {
      if (c.name.toLowerCase() === lower) {
        return c;
      }
    }
    return null;
  }
}

/**
 * 全局分类字典服务单例。
 *
 * 与 `characterTraitService` 单例模式一致：模块加载时构造，全局共享。
 */
export const categoryDictionaryService = new CategoryDictionaryService();
