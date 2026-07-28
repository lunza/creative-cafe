/**
 * 角色特征管理服务（主进程）
 *
 * Spec: add-asset-and-trait-management / Task 1
 *
 * 用途：
 *  - 为每个角色卡持久化「视觉特征清单」（如 `white fur, dog girl, black shirt`）
 *  - 在 SD 生成素材时，自动携带该角色的特征 tag，保证角色一致性（毛色/服饰/物种等关键特征不漂移）
 *
 * 存储路径设计：
 *  - 根目录：`{userData}/data/character-traits/`
 *  - 单卡目录：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/`
 *  - 特征文件：`{userData}/data/character-traits/{sanitizeCardId(characterCardId)}/traits.json`
 *  - 文件结构：`{ characterCardId, version: 1, traits: string[] }`
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
 *  - `loadTraits` 文件不存在时返回空数组 `[]`（不抛异常、不返回 error）
 *  - `clearTraits` 文件不存在视为成功（ENOENT 时返回 `{ success: true }`）
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserDataPath } from '../utils/appPath';

/**
 * 角色特征清单：每个角色卡一个 traits.json
 */
export interface CharacterTraitManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号 */
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
   * 单卡子目录在 saveTraits 时按需创建。
   */
  private async ensureDirectoryExists(): Promise<void> {
    try {
      if (!fsSync.existsSync(this.traitDir)) {
        await fs.mkdir(this.traitDir, { recursive: true });
        console.log('[CharacterTraitService] Created trait directory:', this.traitDir);
      }
    } catch (error) {
      // 不抛异常，仅记录；后续 saveTraits 会再次尝试 mkdir
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
   * 读取角色卡的特征清单。
   *
   * - 文件不存在：返回空数组 `[]`（不抛异常、不写日志告警）
   * - 文件损坏/解析失败：返回空数组 `[]`，记录 error 日志
   * - 字段缺失：兜底补全为空数组
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @returns 特征 tag 字符串数组，顺序代表用户优先级
   */
  async loadTraits(characterCardId: string): Promise<string[]> {
    try {
      if (!characterCardId) {
        console.warn('[CharacterTraitService] loadTraits: empty characterCardId, returning []');
        return [];
      }

      const traitPath = this.getTraitPath(characterCardId);

      if (!fsSync.existsSync(traitPath)) {
        // 文件不存在视为空特征，符合 Spec「首次加载无特征文件」场景
        return [];
      }

      const content = await fs.readFile(traitPath, 'utf8');
      const parsed = JSON.parse(content) as Partial<CharacterTraitManifest>;

      // 兜底：补全可能缺失/类型不符的字段，避免旧/坏数据导致渲染进程报错
      const traits = Array.isArray(parsed.traits) ? parsed.traits.filter(t => typeof t === 'string') : [];
      return traits;
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

      const traitPath = this.getTraitPath(characterCardId);

      if (!fsSync.existsSync(traitPath)) {
        return '';
      }

      const content = await fs.readFile(traitPath, 'utf8');
      const parsed = JSON.parse(content) as Partial<CharacterTraitManifest>;

      const description =
        typeof parsed.appearanceDescription === 'string' ? parsed.appearanceDescription : '';
      return description;
    } catch (error) {
      console.error('[CharacterTraitService] loadAppearanceDescription failed:', error);
      return '';
    }
  }

  /**
   * 保存角色卡的特征清单（原子写入：先 mkdir 再 writeFile）。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param traits 特征 tag 字符串数组，顺序代表用户优先级
   * @param appearanceDescription 角色外观描述（可选，中文自然语言）
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

      // 入参校验/规整：仅保留字符串元素，过滤掉 null/undefined/非字符串
      const safeTraits = Array.isArray(traits)
        ? traits.filter((t): t is string => typeof t === 'string')
        : [];

      // 外观描述规整：非字符串转为 undefined，空串视为无描述
      const safeDescription =
        typeof appearanceDescription === 'string' && appearanceDescription.trim()
          ? appearanceDescription.trim()
          : undefined;

      const manifest: CharacterTraitManifest = {
        characterCardId,
        version: 1,
        traits: safeTraits,
        ...(safeDescription ? { appearanceDescription: safeDescription } : {}),
      };

      const traitPath = this.getTraitPath(characterCardId);
      const traitDir = path.dirname(traitPath);

      // 自动创建目录（{recursive: true} 幂等，已存在不报错）
      await fs.mkdir(traitDir, { recursive: true });

      // 写入 traits.json（fs.writeFile 对小文件足够原子；ExpressionManifest 同样模式）
      await fs.writeFile(traitPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(
        '[CharacterTraitService] saveTraits: traits written to',
        traitPath,
        'count=',
        safeTraits.length,
        'hasDescription=',
        !!safeDescription
      );

      return { success: true };
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
