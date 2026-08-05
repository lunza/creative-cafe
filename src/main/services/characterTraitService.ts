/**
 * 角色特征管理服务（主进程）
 *
 * Spec:
 *  - add-asset-and-trait-management / Task 1（v1 基线）
 *  - add-trait-category-grouping / Task 2（v2 升级 + 迁移）
 *  - add-dynamic-scene-prompt-generation / Task 4（动态场景字段持久化）
 *
 * 用途：
 *  - 为每个角色卡持久化「视觉特征清单」（如 `white fur, dog girl, black shirt`）
 *  - 在 SD 生成素材时，自动携带该角色的特征 tag，保证角色一致性（毛色/服饰/物种等关键特征不漂移）
 *  - v2 引入分类体系（系统分类 + 自定义分类 + 未分类）与组合方案，支持跨分类启用选择
 *  - 动态场景方案（dynamicScenePrompts）独立于基础特征，存储一次性服装/动作/场景提示词
 *
 * 存储路径设计：
 *  - 根目录：`{userData}/data/character-traits/`
 *  - 单卡目录：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/`
 *  - 特征文件：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/traits.json`
 *  - 文件结构：`{ characterCardId, version: 2, traits: CharacterTraitItem[], customCategories, combinations, activeCombinationId, dynamicScenePrompts, activeDynamicScenePromptId }`（v2）
 *             `{ characterCardId, version: 1, traits: string[] }`（v1，加载时自动迁移为 v2）
 *
 * 与 expressionService 的关系：
 *  - 复用 expressionService 的 `sanitizeCardId` 实现模式（SHA-256 哈希前 16 位），保证同一 characterCardId
 *    在 `character-expressions/` 与 `character-traits/` 目录下映射到同一 hash 子目录（虽然目录相互独立）
 *  - 不复用 expressionService 的实例或存储目录，特征数据独立持久化，互不干扰
 *  - 代码风格（class + 单例导出、JSDoc、try/catch 返回 `{ success, error? }`、日志前缀）与 expressionService 一致
 *
 * 错误处理约定：
 *  - 所有方法包裹 try/catch，永不抛异常
 *  - 错误通过返回值 `{ success: false, error?: string }` 传递
 *  - `loadTraits` / `loadTraitData` 文件不存在时返回空（不抛异常、不返回 error）
 *  - `clearTraits` 文件不存在视为成功（ENOENT 时返回 `{ success: true }`）
 *
 * v1 → v2 迁移（Spec: 数据迁移与向后兼容 Requirement）：
 *  - 加载 traits.json 时若 `version !== 2`，将 `string[]` 映射为 `CharacterTraitItem[]`
 *    （每项 `{ id: genTraitId(), text, categoryId: 'uncategorized', enabled: true }`）
 *  - 迁移后 `customCategories=[]`、`combinations=[]`、`activeCombinationId=null`，保留 `appearanceDescription`
 *  - 迁移后 `dynamicScenePrompts=[]`、`activeDynamicScenePromptId=null`（v1 无动态场景概念，显式补默认）
 *  - 迁移仅在内存进行，下次 `saveTraitData` 时以 `version: 2` 落盘
 *
 * 旧 v2 文件兼容（Spec: add-dynamic-scene-prompt-generation / Task 4）：
 *  - 早于本 spec 落盘的 v2 文件可能缺失 `dynamicScenePrompts` / `activeDynamicScenePromptId`
 *  - `loadTraitData()` 通过 `Array.isArray(parsed.x) ? parsed.x : []` / `typeof === 'string' ? x : null` 兜底
 *  - 类型上 v2 manifest 的这两个字段为必填（避免消费方判空），由 service 层负责兜底补全
 *
 * 旧 API 兼容（Spec: 旧 IPC 调用兼容 Scenario）：
 *  - `loadTraits(cardId): Promise<string[]>` 废弃适配层：调 `loadTraitData` 后返回 `data.traits.map(t => t.text)`
 *  - `saveTraits(cardId, traits: string[], appearanceDescription?)` 废弃适配层：
 *    合并去重策略——保留现有 item，对传入 string 中不在现有 text 集合的，新增 item 归 uncategorized+enabled
 *    动态场景方案原样透传（不被 string[] 保存破坏）
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserDataPath } from '../utils/appPath';
import {
  CharacterTraitItem,
  CharacterTraitManifestV2,
  DynamicScenePrompt,
  TraitCategory,
  TraitCombination,
  UNCATEGORIZED_CATEGORY_ID,
  genTraitId,
} from '../../shared/types/characterTrait.types';
// 【重点标记 - 全局分类字典迁移】Spec: fix-asset-trait-and-scene-defects / Task 4
// - loadTraitData 加载含 customCategories 的旧 v2 manifest 时调用 migrateFromManifest 合并到全局字典
// - 迁移幂等：migrateFromManifest 内部按 name 去重，全部已存在时不写盘
import { categoryDictionaryService } from './categoryDictionaryService';

/**
 * 角色特征清单 v1（废弃别名，仅用于类型兼容与迁移判断）。
 *
 * @deprecated 改用 `CharacterTraitManifestV2`。v1 数据加载时由 service 自动迁移为 v2。
 */
export interface CharacterTraitManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号（v1 = 1） */
  version: 1;
  /** 视觉特征 tag 数组，顺序代表用户优先级（如 `["white fur", "dog girl", "black shirt"]`） */
  traits: string[];
  /** 角色外观描述（中文自然语言，AI 生成特征时自动提取，可手动编辑） */
  appearanceDescription?: string;
}

class CharacterTraitService {
  private traitDir: string;

  constructor() {
    this.traitDir = path.join(getUserDataPath(), 'data', 'character-traits');
    console.log('[CharacterTraitService] Trait directory:', this.traitDir);
    this.ensureDirectoryExists();
  }

  /**
   * 确保特征根目录存在（构造时异步调用一次）。
   * 单卡子目录在 saveTraitData / saveTraits 时按需创建。
   */
  private async ensureDirectoryExists(): Promise<void> {
    try {
      if (!fsSync.existsSync(this.traitDir)) {
        await fs.mkdir(this.traitDir, { recursive: true });
        console.log('[CharacterTraitService] Created trait directory:', this.traitDir);
      }
    } catch (error) {
      // 不抛异常，仅记录；后续 saveTraitData 会再次尝试 mkdir
      console.error('[CharacterTraitService] ensureDirectoryExists failed:', error);
    }
  }

  /**
   * 将 characterCardId（角色卡文件路径字符串，可能含路径分隔符/空格/中文字符）
   * 哈希为文件系统安全的小写目录名。
   *
   * 采用 SHA-256 完整哈希后截取前 16 个十六进制字符：
   *  - 同一 characterCardId 永远映射到同一目录（确定性）
   *  - 不同 characterCardId 几乎不会冲突（SHA-256 抗碰撞性）
   *  - 仅含 [0-9a-f]，对任何文件系统都安全
   *
   * 注意：此实现与 expressionService.sanitizeCardId 完全一致，复用同一哈希逻辑，
   * 保证同一角色卡在 character-expressions / character-traits 目录下 hash 子目录名相同。
   */
  private sanitizeCardId(characterCardId: string): string {
    const hash = crypto.createHash('sha256').update(characterCardId, 'utf8').digest('hex');
    return hash.slice(0, 16);
  }

  /**
   * 获取 traits.json 的绝对路径（不确保存在）。
   */
  private getTraitPath(characterCardId: string): string {
    return path.join(this.traitDir, this.sanitizeCardId(characterCardId), 'traits.json');
  }

  /**
   * 构造空白 v2 manifest（文件不存在或解析失败时返回）。
   *
   * 【重点标记 - 新增字段兜底】Spec: add-dynamic-scene-prompt-generation / Task 4
   * - 空白 manifest 的 `dynamicScenePrompts` 兜底为 `[]`，`activeDynamicScenePromptId` 兜底为 `null`
   * - 与 v1→v2 迁移路径保持一致：无动态场景方案时默认空列表 + null 激活态
   *
   * @param characterCardId 角色卡 ID
   */
  private emptyV2Manifest(characterCardId: string): CharacterTraitManifestV2 {
    return {
      characterCardId,
      version: 2,
      appearanceDescription: '',
      traits: [],
      customCategories: [],
      combinations: [],
      activeCombinationId: null,
      dynamicScenePrompts: [],
      activeDynamicScenePromptId: null,
    };
  }

  /**
   * 防御性补全单个 CharacterTraitItem：缺失字段补默认。
   *
   * @param raw 原始对象（可能字段缺失/类型不符）
   * @returns 兜底后的 CharacterTraitItem，若 text 非字符串则返回 null
   */
  private normalizeTraitItem(raw: unknown): CharacterTraitItem | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const r = raw as Partial<CharacterTraitItem>;
    if (typeof r.text !== 'string' || !r.text) {
      return null;
    }
    return {
      id: typeof r.id === 'string' && r.id ? r.id : genTraitId(),
      text: r.text,
      categoryId:
        typeof r.categoryId === 'string' && r.categoryId ? r.categoryId : UNCATEGORIZED_CATEGORY_ID,
      enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    };
  }

  /**
   * 读取角色卡的 v2 特征清单（含迁移与防御性兜底）。
   *
   * 行为：
   *  - 文件不存在：返回空白 v2 manifest（traits:[], customCategories:[], combinations:[], activeCombinationId=null, appearanceDescription:''）
   *  - 解析失败：返回空白 v2 manifest，记录 error 日志
   *  - `version !== 2`（含 v1 与缺失 version）：执行 v1→v2 迁移
   *    （string[] 映射为 CharacterTraitItem[]，归 uncategorized + enabled=true）
   *  - `version === 2`：直接返回，字段缺失/类型不符逐项兜底补全
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @returns 完整 v2 manifest（永不为 null，永不抛异常）
   */
  async loadTraitData(characterCardId: string): Promise<CharacterTraitManifestV2> {
    try {
      if (!characterCardId) {
        console.warn('[CharacterTraitService] loadTraitData: empty characterCardId, returning empty v2');
        return this.emptyV2Manifest(characterCardId);
      }

      const traitPath = this.getTraitPath(characterCardId);

      if (!fsSync.existsSync(traitPath)) {
        // 文件不存在视为空特征，符合 Spec「首次加载无特征文件」场景
        return this.emptyV2Manifest(characterCardId);
      }

      const content = await fs.readFile(traitPath, 'utf8');
      // 注意：不使用 `Partial<CharacterTraitManifestV2 & CharacterTraitManifest>`，
      // 因为 v1.version=1 与 v2.version=2 是不相交字面量类型，交集会塌缩为 never。
      // 这里采用 permissive 形状，运行时逐字段校验类型并兜底。
      //
      // 【重点标记 - 新增字段】Spec: add-dynamic-scene-prompt-generation / Task 4
      // - `dynamicScenePrompts` / `activeDynamicScenePromptId` 加入 permissive 形状
      // - 旧 v2 文件（早于本 spec 落盘的）可能缺失这两个字段，由下方 `?? []` / `?? null` 兜底
      const parsed = JSON.parse(content) as {
        version?: unknown;
        traits?: unknown;
        customCategories?: unknown;
        combinations?: unknown;
        activeCombinationId?: unknown;
        appearanceDescription?: unknown;
        characterCardId?: unknown;
        dynamicScenePrompts?: unknown;
        activeDynamicScenePromptId?: unknown;
      };

      const version =
        typeof parsed.version === 'number' ? parsed.version : 1;
      const appearanceDescription =
        typeof parsed.appearanceDescription === 'string' ? parsed.appearanceDescription : '';

      // v1（version !== 2）：执行迁移
      if (version !== 2) {
        // v1 traits 为 string[]，过滤后逐项转 CharacterTraitItem（归 uncategorized + enabled）
        const v1Traits = Array.isArray(parsed.traits)
          ? parsed.traits.filter((t: unknown): t is string => typeof t === 'string' && !!t)
          : [];
        const traits: CharacterTraitItem[] = v1Traits.map(text => ({
          id: genTraitId(),
          text,
          categoryId: UNCATEGORIZED_CATEGORY_ID,
          enabled: true,
        }));
        console.log(
          '[CharacterTraitService] loadTraitData: migrating v1 -> v2, traits=',
          traits.length,
          'path=',
          traitPath
        );
        // 【重点标记 - v1→v2 迁移】Spec: add-dynamic-scene-prompt-generation / Task 4
        // - v1 traits.json 无动态场景字段概念，迁移时显式补 `dynamicScenePrompts: []` + `activeDynamicScenePromptId: null`
        // - 与 emptyV2Manifest 兜底语义一致，保证迁移产物为完整 v2 manifest
        return {
          characterCardId,
          version: 2,
          ...(appearanceDescription ? { appearanceDescription } : { appearanceDescription: '' }),
          traits,
          customCategories: [],
          combinations: [],
          activeCombinationId: null,
          dynamicScenePrompts: [],
          activeDynamicScenePromptId: null,
        };
      }

      // v2：直接返回，字段缺失/类型不符逐项兜底
      const rawTraits = Array.isArray(parsed.traits) ? parsed.traits : [];
      const traits: CharacterTraitItem[] = rawTraits
        .map((item: unknown) => this.normalizeTraitItem(item))
        .filter((item): item is CharacterTraitItem => item !== null);

      const rawCustomCategories = Array.isArray(parsed.customCategories)
        ? parsed.customCategories
        : [];
      const customCategories = rawCustomCategories.filter(
        (c: unknown): c is TraitCategory =>
          !!c && typeof c === 'object' &&
          typeof (c as { id?: unknown }).id === 'string' &&
          typeof (c as { name?: unknown }).name === 'string'
      );

      // 【重点标记 - 既有数据迁移】Spec: fix-asset-trait-and-scene-defects / Task 4 / Scenario: 既有数据迁移
      // - 首次加载含 customCategories 的旧 v2 manifest 时，合并到全局字典 trait-categories.json
      // - migrateFromManifest 按 name 大小写不敏感去重，仅追加字典中不存在的分类；全部已存在时不写盘（幂等）
      // - 迁移后 manifest.customCategories 字段不再作为读取源（渲染进程改读 globalCategories），
      //   但仍原样返回以保留向后兼容（旧文件读取不破坏；下次 saveTraitData 时由 store 写入 []）
      // - 迁移失败不阻塞特征加载（catch 兜底，仅记录 warn 日志）
      if (customCategories.length > 0) {
        try {
          categoryDictionaryService.migrateFromManifest(customCategories);
        } catch (migrateError) {
          console.warn(
            '[CharacterTraitService] loadTraitData: migrateFromManifest failed (non-blocking, customCategories=',
            customCategories.length,
            ')',
            migrateError
          );
        }
      }

      const rawCombinations = Array.isArray(parsed.combinations) ? parsed.combinations : [];
      const combinations = rawCombinations.filter(
        (c: unknown): c is TraitCombination =>
          !!c && typeof c === 'object' &&
          typeof (c as { id?: unknown }).id === 'string' &&
          typeof (c as { name?: unknown }).name === 'string'
      );

      const activeCombinationId =
        typeof parsed.activeCombinationId === 'string'
          ? parsed.activeCombinationId
          : null;

      // 【重点标记 - 旧 v2 文件兼容】Spec: add-dynamic-scene-prompt-generation / Task 4
      // - 早于本 spec 落盘的 v2 文件可能缺失 dynamicScenePrompts / activeDynamicScenePromptId
      // - `Array.isArray` / `typeof === 'string'` 兜底，保证返回值为完整 v2 manifest
      // - 不对数组元素做 schema 校验（spec 明确：简单数组/字符串，无需校验）
      const dynamicScenePrompts = Array.isArray(parsed.dynamicScenePrompts)
        ? parsed.dynamicScenePrompts
        : [];
      const activeDynamicScenePromptId =
        typeof parsed.activeDynamicScenePromptId === 'string'
          ? parsed.activeDynamicScenePromptId
          : null;

      return {
        characterCardId,
        version: 2,
        ...(appearanceDescription ? { appearanceDescription } : { appearanceDescription: '' }),
        traits,
        customCategories,
        combinations,
        activeCombinationId,
        dynamicScenePrompts,
        activeDynamicScenePromptId,
      };
    } catch (error) {
      console.error('[CharacterTraitService] loadTraitData failed:', error);
      return this.emptyV2Manifest(characterCardId);
    }
  }

  /**
   * 保存角色卡的 v2 特征清单（原子写入：先 mkdir 再 writeFile）。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param data v2 manifest（version 字段忽略，强制写 2）
   * @returns `{ success: true }` 或 `{ success: false, error?: string }`
   */
  async saveTraitData(
    characterCardId: string,
    data: CharacterTraitManifestV2
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }

      // 防御性规整：traits / customCategories / combinations / activeCombinationId 兜底
      const safeTraits: CharacterTraitItem[] = Array.isArray(data?.traits)
        ? data.traits
            .map(item => this.normalizeTraitItem(item))
            .filter((item): item is CharacterTraitItem => item !== null)
        : [];

      const safeCustomCategories = Array.isArray(data?.customCategories)
        ? data.customCategories.filter(
            (c): c is TraitCategory =>
              !!c && typeof c === 'object' &&
              typeof (c as { id?: unknown }).id === 'string' &&
              typeof (c as { name?: unknown }).name === 'string'
          )
        : [];

      const safeCombinations = Array.isArray(data?.combinations)
        ? data.combinations.filter(
            (c): c is TraitCombination =>
              !!c && typeof c === 'object' &&
              typeof (c as { id?: unknown }).id === 'string' &&
              typeof (c as { name?: unknown }).name === 'string'
          )
        : [];

      const safeActiveCombinationId =
        typeof data?.activeCombinationId === 'string' ? data.activeCombinationId : null;

      // 【重点标记 - 新增字段持久化】Spec: add-dynamic-scene-prompt-generation / Task 4
      // - `dynamicScenePrompts` 仅做 Array.isArray 兜底，不校验元素结构（spec：简单数组无需 schema 校验）
      // - `activeDynamicScenePromptId` 仅做 typeof === 'string' 兜底，缺失/类型不符时落盘为 null
      // - 字段完整写入 traits.json，保证下次加载时无需再次兜底
      const safeDynamicScenePrompts: DynamicScenePrompt[] = Array.isArray(data?.dynamicScenePrompts)
        ? data.dynamicScenePrompts
        : [];
      const safeActiveDynamicScenePromptId =
        typeof data?.activeDynamicScenePromptId === 'string'
          ? data.activeDynamicScenePromptId
          : null;

      // 外观描述规整：非字符串视为空串（保留字段，便于 UI 直接显示）
      const safeDescription =
        typeof data?.appearanceDescription === 'string' ? data.appearanceDescription : '';

      const manifest: CharacterTraitManifestV2 = {
        characterCardId,
        version: 2,
        ...(safeDescription ? { appearanceDescription: safeDescription } : { appearanceDescription: '' }),
        traits: safeTraits,
        customCategories: safeCustomCategories,
        combinations: safeCombinations,
        activeCombinationId: safeActiveCombinationId,
        dynamicScenePrompts: safeDynamicScenePrompts,
        activeDynamicScenePromptId: safeActiveDynamicScenePromptId,
      };

      const traitPath = this.getTraitPath(characterCardId);
      const traitDir = path.dirname(traitPath);

      // 自动创建目录（{recursive: true} 幂等，已存在不报错）
      await fs.mkdir(traitDir, { recursive: true });

      // 写入 traits.json（fs.writeFile 对小文件足够原子；ExpressionManifest 同样模式）
      await fs.writeFile(traitPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(
        '[CharacterTraitService] saveTraitData: v2 manifest written to',
        traitPath,
        'traits=',
        safeTraits.length,
        'customCategories=',
        safeCustomCategories.length,
        'combinations=',
        safeCombinations.length,
        'activeCombinationId=',
        safeActiveCombinationId,
        'dynamicScenePrompts=',
        safeDynamicScenePrompts.length,
        'activeDynamicScenePromptId=',
        safeActiveDynamicScenePromptId,
        'hasDescription=',
        !!safeDescription
      );

      return { success: true };
    } catch (error) {
      console.error('[CharacterTraitService] saveTraitData failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 读取角色卡的特征清单（扁平 string[] 语义）。
   *
   * - 文件不存在：返回空数组 `[]`（不抛异常、不写日志告警）
   * - 文件损坏/解析失败：返回空数组 `[]`，记录 error 日志
   * - v1 数据：内部自动迁移为 v2 后返回 `traits.map(t => t.text)`
   *
   * @deprecated 改用 `loadTraitData` 获取完整 v2 数据。本方法仅保留兼容未迁移调用方。
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @returns 特征 tag 字符串数组，顺序代表用户优先级
   */
  async loadTraits(characterCardId: string): Promise<string[]> {
    try {
      const data = await this.loadTraitData(characterCardId);
      return data.traits.map(t => t.text);
    } catch (error) {
      console.error('[CharacterTraitService] loadTraits failed:', error);
      return [];
    }
  }

  /**
   * 读取角色卡的外观描述（中文自然语言）。
   *
   * - 文件不存在：返回空串 `''`
   * - 文件损坏/解析失败：返回空串 `''`，记录 error 日志
   * - 字段缺失（旧版 traits.json 无 appearanceDescription）：返回空串 `''`
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @returns 角色外观描述字符串，不存在时返回空串
   */
  async loadAppearanceDescription(characterCardId: string): Promise<string> {
    try {
      if (!characterCardId) {
        console.warn('[CharacterTraitService] loadAppearanceDescription: empty characterCardId, returning \'\'');
        return '';
      }

      const data = await this.loadTraitData(characterCardId);
      return data.appearanceDescription ?? '';
    } catch (error) {
      console.error('[CharacterTraitService] loadAppearanceDescription failed:', error);
      return '';
    }
  }

  /**
   * 保存角色卡的特征清单（扁平 string[] 语义，废弃适配层）。
   *
   * 合并去重策略（Spec: 旧 IPC 调用兼容 Scenario）：
   *  - 保留现有 v2 item（含已分类项 / enabled 状态 / id），不删除
   *  - 对传入 string 中不在现有 text 集合的，新增 item 归 `uncategorized` + `enabled=true`
   *  - `appearanceDescription` 显式传入时更新（含空串清空），undefined 时保留现有
   *
   * @deprecated 改用 `saveTraitData` 直接保存 v2 数据。本方法仅保留兼容未迁移调用方。
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param traits 特征 tag 字符串数组
   * @param appearanceDescription 角色外观描述（可选，显式传入时更新）
   * @returns `{ success: true }` 或 `{ success: false, error?: string }`
   */
  async saveTraits(
    characterCardId: string,
    traits: string[],
    appearanceDescription?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }

      // 入参校验/规整：仅保留非空字符串元素
      const safeTraits = Array.isArray(traits)
        ? traits.filter((t): t is string => typeof t === 'string' && !!t)
        : [];

      // 加载现有 v2 数据（v1 自动迁移）
      const existing = await this.loadTraitData(characterCardId);
      const existingTexts = new Set(existing.traits.map(t => t.text));

      // 合并去重：现有 item 保留，新 string 追加为 uncategorized + enabled=true
      const mergedTraits: CharacterTraitItem[] = [...existing.traits];
      for (const text of safeTraits) {
        if (!existingTexts.has(text)) {
          mergedTraits.push({
            id: genTraitId(),
            text,
            categoryId: UNCATEGORIZED_CATEGORY_ID,
            enabled: true,
          });
          existingTexts.add(text); // 防止入参 string 自身重复
        }
      }

      // 外观描述：显式传入时更新，undefined 保留现有
      const nextDescription =
        typeof appearanceDescription === 'string'
          ? appearanceDescription.trim()
          : existing.appearanceDescription ?? '';

      const manifest: CharacterTraitManifestV2 = {
        characterCardId,
        version: 2,
        ...(nextDescription ? { appearanceDescription: nextDescription } : { appearanceDescription: '' }),
        traits: mergedTraits,
        customCategories: existing.customCategories,
        combinations: existing.combinations,
        activeCombinationId: existing.activeCombinationId,
        // 【重点标记 - 旧 API 兼容层透传】Spec: add-dynamic-scene-prompt-generation / Task 4
        // - saveTraits 是废弃适配层，仅更新 traits(string[]) 与 appearanceDescription
        // - 动态场景方案应原样保留（existing 已由 loadTraitData 兜底补全字段），不被本次保存破坏
        dynamicScenePrompts: existing.dynamicScenePrompts,
        activeDynamicScenePromptId: existing.activeDynamicScenePromptId,
      };

      return await this.saveTraitData(characterCardId, manifest);
    } catch (error) {
      console.error('[CharacterTraitService] saveTraits failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 清除角色卡的特征清单（删除 traits.json 文件）。
   *
   * - 文件不存在：视为成功（ENOENT 返回 `{ success: true }`），符合幂等语义
   * - 其他删除失败：返回 `{ success: false, error?: string }`
   *
   * 注意：仅删除 traits.json 文件，不删除单卡子目录（保留目录便于后续写入；
   *      与 expressionService 删除图像时的目录处理策略一致）。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @returns `{ success: true }` 或 `{ success: false, error?: string }`
   */
  async clearTraits(characterCardId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }

      const traitPath = this.getTraitPath(characterCardId);

      try {
        await fs.unlink(traitPath);
        console.log('[CharacterTraitService] clearTraits: traits.json removed', traitPath);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        // ENOENT：文件本就不存在，视为幂等成功
        if (err.code === 'ENOENT') {
          console.log(
            '[CharacterTraitService] clearTraits: traits.json not found, treat as success',
            traitPath
          );
          return { success: true };
        }
        // 其他错误（权限/EACCES 等）向上抛，由外层 catch 统一捕获
        throw error;
      }

      return { success: true };
    } catch (error) {
      console.error('[CharacterTraitService] clearTraits failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const characterTraitService = new CharacterTraitService();
