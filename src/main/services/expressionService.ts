import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserDataPath } from '../utils/appPath';

/**
 * 表情条目：记录某个情绪键对应的图片信息
 */
export interface ExpressionEntry {
  /** 类型：preset（预置情绪）或 custom（自定义情绪） */
  type: 'preset' | 'custom';
  /** 图片文件名（相对于该角色卡表情目录） */
  image: string;
}

/**
 * 自定义情绪定义
 */
export interface CustomEmotion {
  /** 英文键名，需匹配 ^[a-z][a-z0-9_]*$ */
  key: string;
  /** 中文标签 */
  label: string;
}

/**
 * 表情包清单：每个角色卡一个 manifest.json
 */
export interface ExpressionManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号 */
  version: 1;
  /** 已上传的表情映射：emotionKey -> ExpressionEntry */
  expressions: Record<string, ExpressionEntry>;
  /** 用户为该角色卡自定义添加的情绪类别 */
  customEmotions: CustomEmotion[];
}

/**
 * 自定义情绪 key 校验正则：以小写字母开头，仅含小写字母/数字/下划线
 */
const CUSTOM_EMOTION_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

class ExpressionService {
  private expressionDir: string;

  constructor() {
    this.expressionDir = path.join(getUserDataPath(), 'data', 'character-expressions');
    console.log('[ExpressionService] Expression directory:', this.expressionDir);
    this.ensureDirectoryExists();
  }

  private async ensureDirectoryExists() {
    if (!fsSync.existsSync(this.expressionDir)) {
      await fs.mkdir(this.expressionDir, { recursive: true });
      console.log('[ExpressionService] Created expression directory:', this.expressionDir);
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
   */
  private sanitizeCardId(characterCardId: string): string {
    const hash = crypto.createHash('sha256').update(characterCardId, 'utf8').digest('hex');
    return hash.slice(0, 16);
  }

  /**
   * 获取指定角色卡的表情包目录（绝对路径），并确保目录存在。
   */
  private async getCharacterExpressionDir(characterCardId: string): Promise<string> {
    const dir = path.join(this.expressionDir, this.sanitizeCardId(characterCardId));
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * 获取 manifest.json 的绝对路径（不确保存在）。
   */
  private getManifestPath(characterCardId: string): string {
    return path.join(this.expressionDir, this.sanitizeCardId(characterCardId), 'manifest.json');
  }

  /**
   * 构造一个空白的默认 manifest。
   */
  private createEmptyManifest(characterCardId: string): ExpressionManifest {
    return {
      characterCardId,
      version: 1,
      expressions: {},
      customEmotions: [],
    };
  }

  /**
   * 读取角色卡表情包清单。若目录或 manifest 不存在，返回默认空 manifest。
   */
  async listExpressions(characterCardId: string): Promise<ExpressionManifest> {
    try {
      await this.ensureDirectoryExists();
      const manifestPath = this.getManifestPath(characterCardId);

      if (!fsSync.existsSync(manifestPath)) {
        console.log('[ExpressionService] listExpressions: manifest not found, returning default. characterCardId=', characterCardId);
        return this.createEmptyManifest(characterCardId);
      }

      const content = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(content) as ExpressionManifest;

      // 兜底：补全可能缺失的字段，避免旧/坏数据导致渲染进程报错
      return {
        characterCardId: parsed.characterCardId ?? characterCardId,
        version: 1,
        expressions: parsed.expressions ?? {},
        customEmotions: parsed.customEmotions ?? [],
      };
    } catch (error) {
      console.error('[ExpressionService] listExpressions failed:', error);
      return this.createEmptyManifest(characterCardId);
    }
  }

  /**
   * 保存表情图像并更新 manifest。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param emotionKey 情绪键名（预置或自定义）
   * @param imageBase64 图像 base64 字符串，可含 `data:image/png;base64,` 前缀
   * @param isCustom 是否为自定义情绪
   * @param label 自定义情绪的中文标签（仅 isCustom=true 时使用）
   * @returns { success, error?, imagePath? } imagePath 为图像绝对路径
   */
  async saveImage(
    characterCardId: string,
    emotionKey: string,
    imageBase64: string,
    isCustom: boolean,
    label?: string
  ): Promise<{ success: boolean; error?: string; imagePath?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!emotionKey) {
        return { success: false, error: 'emotionKey 不能为空' };
      }

      const charDir = await this.getCharacterExpressionDir(characterCardId);
      const imageFileName = `${emotionKey}.png`;
      const imagePath = path.join(charDir, imageFileName);

      // 剥离可能的 data URI 前缀
      const base64Data = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(imagePath, buffer);
      console.log('[ExpressionService] saveImage: image written to', imagePath);

      // 更新 manifest
      const manifest = await this.listExpressions(characterCardId);
      manifest.expressions[emotionKey] = {
        type: isCustom ? 'custom' : 'preset',
        image: imageFileName,
      };

      if (isCustom) {
        const exists = manifest.customEmotions.some(e => e.key === emotionKey);
        if (!exists) {
          manifest.customEmotions.push({ key: emotionKey, label: label || emotionKey });
        }
      }

      const manifestPath = path.join(charDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log('[ExpressionService] saveImage: manifest updated for', emotionKey);

      return { success: true, imagePath };
    } catch (error) {
      console.error('[ExpressionService] saveImage failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 删除指定情绪的图像文件，并从 manifest.expressions 中移除。
   * 不会从 customEmotions 中移除（如需移除自定义情绪请调用 removeCustomEmotion）。
   */
  async deleteImage(
    characterCardId: string,
    emotionKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!emotionKey) {
        return { success: false, error: 'emotionKey 不能为空' };
      }

      const charDir = path.join(this.expressionDir, this.sanitizeCardId(characterCardId));
      const imagePath = path.join(charDir, `${emotionKey}.png`);

      if (fsSync.existsSync(imagePath)) {
        await fs.unlink(imagePath);
        console.log('[ExpressionService] deleteImage: image removed', imagePath);
      } else {
        console.log('[ExpressionService] deleteImage: image not found, skip unlink', imagePath);
      }

      // 更新 manifest（若 manifest 不存在则视为已删除）
      const manifest = await this.listExpressions(characterCardId);
      if (manifest.expressions[emotionKey]) {
        delete manifest.expressions[emotionKey];
        const manifestPath = path.join(charDir, 'manifest.json');
        // 确保 charDir 存在（listExpressions 不会创建目录，仅 getCharacterExpressionDir 会）
        if (!fsSync.existsSync(charDir)) {
          await fs.mkdir(charDir, { recursive: true });
        }
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        console.log('[ExpressionService] deleteImage: manifest updated, removed', emotionKey);
      }

      return { success: true };
    } catch (error) {
      console.error('[ExpressionService] deleteImage failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 添加自定义情绪类别（仅写入 manifest.customEmotions，不创建图像文件）。
   * key 必须匹配 ^[a-z][a-z0-9_]*$。
   */
  async addCustomEmotion(
    characterCardId: string,
    key: string,
    label: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!key || !CUSTOM_EMOTION_KEY_REGEX.test(key)) {
        return { success: false, error: '自定义情绪 key 必须匹配 ^[a-z][a-z0-9_]*$' };
      }
      if (!label || !label.trim()) {
        return { success: false, error: '自定义情绪 label 不能为空' };
      }

      const charDir = await this.getCharacterExpressionDir(characterCardId);
      const manifest = await this.listExpressions(characterCardId);

      const exists = manifest.customEmotions.some(e => e.key === key);
      if (exists) {
        return { success: false, error: '该自定义情绪已存在' };
      }

      manifest.customEmotions.push({ key, label: label.trim() });
      const manifestPath = path.join(charDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log('[ExpressionService] addCustomEmotion: added', key, label);

      return { success: true };
    } catch (error) {
      console.error('[ExpressionService] addCustomEmotion failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 移除自定义情绪类别：从 customEmotions 中移除、从 expressions 中移除、删除对应图像文件。
   */
  async removeCustomEmotion(
    characterCardId: string,
    key: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!key) {
        return { success: false, error: 'key 不能为空' };
      }

      const charDir = path.join(this.expressionDir, this.sanitizeCardId(characterCardId));
      const manifest = await this.listExpressions(characterCardId);

      const before = manifest.customEmotions.length;
      manifest.customEmotions = manifest.customEmotions.filter(e => e.key !== key);
      const after = manifest.customEmotions.length;

      if (before === after) {
        // 不存在该自定义情绪，视为幂等成功
        console.log('[ExpressionService] removeCustomEmotion: key not found, no-op', key);
        return { success: true };
      }

      // 从 expressions 中移除
      if (manifest.expressions[key]) {
        delete manifest.expressions[key];
      }

      // 删除图像文件
      const imagePath = path.join(charDir, `${key}.png`);
      if (fsSync.existsSync(imagePath)) {
        await fs.unlink(imagePath);
        console.log('[ExpressionService] removeCustomEmotion: image removed', imagePath);
      }

      // 持久化 manifest
      if (!fsSync.existsSync(charDir)) {
        await fs.mkdir(charDir, { recursive: true });
      }
      const manifestPath = path.join(charDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log('[ExpressionService] removeCustomEmotion: removed', key);

      return { success: true };
    } catch (error) {
      console.error('[ExpressionService] removeCustomEmotion failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取指定情绪的图像绝对路径，若图像不存在返回 null。
   */
  async getImagePath(
    characterCardId: string,
    emotionKey: string
  ): Promise<string | null> {
    try {
      if (!characterCardId || !emotionKey) {
        return null;
      }

      const imagePath = path.join(
        this.expressionDir,
        this.sanitizeCardId(characterCardId),
        `${emotionKey}.png`
      );

      if (fsSync.existsSync(imagePath)) {
        return imagePath;
      }
      return null;
    } catch (error) {
      console.error('[ExpressionService] getImagePath failed:', error);
      return null;
    }
  }
}

export const expressionService = new ExpressionService();
