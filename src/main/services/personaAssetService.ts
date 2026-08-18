/**
 * 用户人设素材管理服务（主进程）
 *
 * 用途：
 *  - 为每个用户人设持久化 AI 生成的立绘图片
 *  - 轻量化版本，参考 assetService 但简化为单一图片列表（无 assetType 分类）
 *
 * 存储路径设计：
 *  - PNG 文件：{userData}/data/persona-assets/{personaId}/{imageId}.png
 *  - 清单文件：{userData}/data/persona-assets/{personaId}/manifest.json
 *
 * 错误处理约定：
 *  所有方法包裹 try/catch，永不抛异常；错误通过返回值（{ success, error? }）传递。
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

/** 人设素材条目 */
export interface PersonaAssetEntry {
  /** 图片 ID */
  id: string;
  /** 图片文件名（相对于该人设目录，如 `{imageId}.png`） */
  image: string;
  /** 创建时间（ISO 8601 时间戳字符串） */
  createdAt: string;
}

/** 人设素材清单 */
export interface PersonaAssetManifest {
  /** 人设 ID */
  personaId: string;
  /** 清单版本号 */
  version: 1;
  /** 已保存的素材映射：imageId -> PersonaAssetEntry */
  assets: Record<string, PersonaAssetEntry>;
}

class PersonaAssetService {
  private assetRootDir: string;

  constructor() {
    this.assetRootDir = path.join(getUserDataPath(), 'data', 'persona-assets');
  }

  /** 确保根目录存在 */
  private async ensureRootDirectoryExists(): Promise<void> {
    if (!fsSync.existsSync(this.assetRootDir)) {
      await fs.mkdir(this.assetRootDir, { recursive: true });
    }
  }

  /** 获取人设目录路径 */
  private getPersonaDir(personaId: string): string {
    return path.join(this.assetRootDir, personaId);
  }

  /** 获取清单文件路径 */
  private getManifestPath(personaId: string): string {
    return path.join(this.getPersonaDir(personaId), 'manifest.json');
  }

  /** 获取图片绝对路径 */
  getImagePath(personaId: string, imageId: string): string {
    return path.join(this.getPersonaDir(personaId), `${imageId}.png`);
  }

  /** 构造空白 manifest */
  private createEmptyManifest(personaId: string): PersonaAssetManifest {
    return { personaId, version: 1, assets: {} };
  }

  /**
   * 读取人设素材清单。
   * 若目录或 manifest 不存在，返回默认空 manifest，不抛异常。
   */
  async listAssets(personaId: string): Promise<PersonaAssetManifest> {
    try {
      await this.ensureRootDirectoryExists();
      const manifestPath = this.getManifestPath(personaId);

      if (!fsSync.existsSync(manifestPath)) {
        return this.createEmptyManifest(personaId);
      }

      const content = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(content) as PersonaAssetManifest;

      return {
        personaId: parsed.personaId ?? personaId,
        version: 1,
        assets: parsed.assets ?? {},
      };
    } catch (error) {
      console.error('[PersonaAssetService] listAssets failed:', error);
      return this.createEmptyManifest(personaId);
    }
  }

  /**
   * 保存素材图像并更新 manifest。
   *
   * 流程：
   *   1. 校验参数
   *   2. 剥离 data:image/...;base64, 前缀
   *   3. 写入 PNG 文件
   *   4. 更新 manifest.assets[imageId]
   *   5. 写入 manifest.json
   */
  async saveAsset(
    personaId: string,
    imageId: string,
    imageBase64: string,
  ): Promise<{ success: boolean; error?: string; imagePath?: string }> {
    try {
      if (!personaId) {
        return { success: false, error: 'personaId 不能为空' };
      }
      if (!imageId) {
        return { success: false, error: 'imageId 不能为空' };
      }
      if (!imageBase64) {
        return { success: false, error: 'imageBase64 不能为空' };
      }

      await this.ensureRootDirectoryExists();
      const personaDir = this.getPersonaDir(personaId);
      await fs.mkdir(personaDir, { recursive: true });

      // 剥离 data URI 前缀
      const base64Data = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const imagePath = this.getImagePath(personaId, imageId);
      await fs.writeFile(imagePath, Buffer.from(base64Data, 'base64'));

      // 更新 manifest
      const manifest = await this.listAssets(personaId);
      manifest.assets[imageId] = {
        id: imageId,
        image: `${imageId}.png`,
        createdAt: new Date().toISOString(),
      };

      const manifestPath = this.getManifestPath(personaId);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      console.log('[PersonaAssetService] saveAsset success:', personaId, imageId);
      return { success: true, imagePath };
    } catch (error) {
      console.error('[PersonaAssetService] saveAsset failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存素材失败',
      };
    }
  }

  /**
   * 删除指定素材。
   */
  async deleteAsset(
    personaId: string,
    imageId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!personaId || !imageId) {
        return { success: false, error: '参数不能为空' };
      }

      const imagePath = this.getImagePath(personaId, imageId);
      if (fsSync.existsSync(imagePath)) {
        await fs.unlink(imagePath);
      }

      // 更新 manifest
      const manifest = await this.listAssets(personaId);
      delete manifest.assets[imageId];
      const manifestPath = this.getManifestPath(personaId);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      console.log('[PersonaAssetService] deleteAsset success:', personaId, imageId);
      return { success: true };
    } catch (error) {
      console.error('[PersonaAssetService] deleteAsset failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除素材失败',
      };
    }
  }

  /**
   * 获取素材图片的磁盘绝对路径。
   */
  async getImagePathForRenderer(
    personaId: string,
    imageId: string,
  ): Promise<{ success: boolean; imagePath?: string; error?: string }> {
    try {
      const imagePath = this.getImagePath(personaId, imageId);
      if (!fsSync.existsSync(imagePath)) {
        return { success: false, error: '图片文件不存在' };
      }
      return { success: true, imagePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取图片路径失败',
      };
    }
  }

  /**
   * 删除人设的全部素材（人设被删除时调用）。
   */
  async clearAllAssets(personaId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const personaDir = this.getPersonaDir(personaId);
      if (fsSync.existsSync(personaDir)) {
        await fs.rm(personaDir, { recursive: true, force: true });
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '清除素材失败',
      };
    }
  }
}

export const personaAssetService = new PersonaAssetService();
