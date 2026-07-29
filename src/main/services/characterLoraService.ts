/**
 * 角色卡 LoRA 模型管理服务（主进程）
 *
 * 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
 *
 * 用途：
 *  - 为每个角色卡持久化「LoRA 模型选择清单」（如 `[{ name: "charA_v1", weight: 0.7 }]`）
 *  - 在 SD 生成素材时，自动携带该角色的 LoRA 配置，保证角色独立性
 *
 * bug 背景：
 *  - 原实现将 LoRA 选择存储在全局 `AppSetting.sdWebui.selectedLoras` 中，
 *    导致 A 角色选择的 LoRA 会污染 B 角色的生成（AssetManagerModal onConfirm
 *    直接调用 saveSetting 写入全局设置）。
 *  - 本服务参考 characterTraitService 的按角色存储模式，将 LoRA 独立持久化
 *    到 `{userData}/data/character-loras/{hash}/loras.json`，彻底隔离角色间配置。
 *
 * 存储路径设计：
 *  - 根目录：`{userData}/data/character-loras/`
 *  - 单卡目录：`{userData}/data/character-loras/{sanitizeCardId(characterCardId)}/`
 *  - LoRA 文件：`{userData}/data/character-loras/{sanitizeCardId(characterCardId)}/loras.json`
 *  - 文件结构：`{ characterCardId, version: 1, loras: Array<{ name: string; weight: number }> }`
 *
 * 与 characterTraitService 的关系：
 *  - 复用相同的 `sanitizeCardId` 实现模式（SHA-256 哈希前 16 位）
 *  - 不复用 characterTraitService 的实例或存储目录，LoRA 数据独立持久化
 *  - 代码风格（class + 单例导出、JSDoc、try/catch 返回 `{ success, error? }`）一致
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserDataPath } from '../utils/appPath';

/**
 * 角色卡 LoRA 清单：每个角色卡一个 loras.json
 */
export interface CharacterLoraManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号 */
  version: 1;
  /** LoRA 模型列表，每项含 name（模型名）和 weight（权重 0-1） */
  loras: Array<{ name: string; weight: number }>;
}

class CharacterLoraService {
  private loraDir: string;

  constructor() {
    this.loraDir = path.join(getUserDataPath(), 'data', 'character-loras');
    console.log('[CharacterLoraService] Lora directory:', this.loraDir);
    this.ensureDirectoryExists();
  }

  /**
   * 确保 LoRA 根目录存在（构造时异步调用一次）。
   * 单卡子目录在 saveLoras 时按需创建。
   */
  private async ensureDirectoryExists(): Promise<void> {
    try {
      if (!fsSync.existsSync(this.loraDir)) {
        await fs.mkdir(this.loraDir, { recursive: true });
        console.log('[CharacterLoraService] Created lora directory:', this.loraDir);
      }
    } catch (error) {
      console.error('[CharacterLoraService] ensureDirectoryExists failed:', error);
    }
  }

  /**
   * 将 characterCardId 哈希为文件系统安全的小写目录名。
   * 与 characterTraitService.sanitizeCardId 完全一致（SHA-256 前 16 位）。
   */
  private sanitizeCardId(characterCardId: string): string {
    const hash = crypto.createHash('sha256').update(characterCardId, 'utf8').digest('hex');
    return hash.slice(0, 16);
  }

  /**
   * 获取 loras.json 的绝对路径（不确保存在）。
   */
  private getLoraPath(characterCardId: string): string {
    return path.join(this.loraDir, this.sanitizeCardId(characterCardId), 'loras.json');
  }

  /**
   * 读取角色卡的 LoRA 模型清单。
   *
   * - 文件不存在：返回空数组 `[]`（不抛异常、不写日志告警）
   * - 文件损坏/解析失败：返回空数组 `[]`，记录 error 日志
   * - 字段缺失：兜底补全为空数组
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @returns LoRA 模型数组，每项含 name 和 weight
   */
  async loadLoras(characterCardId: string): Promise<Array<{ name: string; weight: number }>> {
    try {
      if (!characterCardId) {
        console.warn('[CharacterLoraService] loadLoras: empty characterCardId, returning []');
        return [];
      }

      const loraPath = this.getLoraPath(characterCardId);

      if (!fsSync.existsSync(loraPath)) {
        return [];
      }

      const content = await fs.readFile(loraPath, 'utf8');
      const parsed = JSON.parse(content) as Partial<CharacterLoraManifest>;

      // 兜底：补全可能缺失/类型不符的字段
      const loras = Array.isArray(parsed.loras)
        ? parsed.loras.filter(
            (l) => l && typeof l.name === 'string' && typeof l.weight === 'number'
          )
        : [];
      return loras;
    } catch (error) {
      console.error('[CharacterLoraService] loadLoras failed:', error);
      return [];
    }
  }

  /**
   * 保存角色卡的 LoRA 模型清单（原子写入：先 mkdir 再 writeFile）。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param loras LoRA 模型数组，每项含 name 和 weight
   * @returns `{ success: true }` 或 `{ success: false, error?: string }`
   */
  async saveLoras(
    characterCardId: string,
    loras: Array<{ name: string; weight: number }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }

      // 入参校验/规整：仅保留有效元素
      const safeLoras = Array.isArray(loras)
        ? loras.filter(
            (l) => l && typeof l.name === 'string' && typeof l.weight === 'number'
          )
        : [];

      const manifest: CharacterLoraManifest = {
        characterCardId,
        version: 1,
        loras: safeLoras,
      };

      const loraPath = this.getLoraPath(characterCardId);
      const loraDir = path.dirname(loraPath);

      // 确保单卡目录存在
      if (!fsSync.existsSync(loraDir)) {
        await fs.mkdir(loraDir, { recursive: true });
      }

      await fs.writeFile(loraPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(
        `[CharacterLoraService] saveLoras: saved ${safeLoras.length} loras for ${characterCardId}`
      );

      return { success: true };
    } catch (error) {
      console.error('[CharacterLoraService] saveLoras failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// 单例导出
export const characterLoraService = new CharacterLoraService();
