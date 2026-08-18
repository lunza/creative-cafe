/**
 * Spec: add-asset-and-trait-management / Task 6
 * 素材管理主进程服务（assetService.ts）
 *
 * ## 设计目标
 * 将原表情管理拓展为通用素材管理，新增三种素材类型：
 *   - illustration：角色立绘
 *   - general：一般图像
 *   - three-view：三视图（front / side / back 三个固定槽位）
 *
 * ## 与 expressionService 的关系
 * 表情类型（expression）继续走现有 expressionService.ts，**不纳入本服务**。
 * 两者相互独立，存储目录互不重叠：
 *   - 表情：data/character-expressions/{hash}/...
 *   - 素材：data/character-assets/{hash}/{assetType}/...
 * 这样做的目的：
 *   1. 保持现有表情功能零迁移、零回归（向后兼容）
 *   2. 素材类型语义清晰，便于 UI 分 Tab 展示
 *   3. 三视图槽位约束仅在素材服务内实现，不影响表情逻辑
 *
 * ## 存储路径设计
 *   - PNG 文件：{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/{assetId}.png
 *   - 清单文件：{userData}/data/character-assets/{sanitizeCardId(characterCardId)}/{assetType}/manifest.json
 *
 * 其中 sanitizeCardId 复用 expressionService 的实现模式：
 * SHA-256 完整哈希后截取前 16 个十六进制字符，确定性且文件系统安全。
 * 每个 assetType 拥有独立子目录与独立 manifest，便于按类型批量读取/迁移。
 *
 * ## 错误处理约定
 * 所有方法包裹 try/catch，永不抛异常；错误通过返回值（`{ success, error? }`）传递。
 * 文件不存在等可恢复场景按幂等成功处理。
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserDataPath } from '../utils/appPath';

/**
 * 素材类型枚举。
 *
 * - illustration：角色立绘（单人全身/半身插画）
 * - general：一般图像（场景图、道具图等）
 * - three-view：三视图（正面/侧面/背面，固定三个槽位）
 *
 * 注意：表情类型 `expression` 不纳入本服务，继续由 expressionService.ts 管理。
 */
export type AssetType = 'illustration' | 'general' | 'three-view';

/**
 * 三视图允许的槽位标识。
 */
export type ThreeViewSlot = 'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude';

/**
 * 三视图允许的 assetId 白名单。
 * 含裸体变体：front-nude / side-nude / back-nude（生成时自动过滤上装/下装/内衣分类特征，配饰保留）。
 */
const THREE_VIEW_ALLOWED_SLOTS: readonly ThreeViewSlot[] = [
  'front', 'side', 'back',
  'front-nude', 'side-nude', 'back-nude',
];

/**
 * 素材条目：记录某个 assetId 对应的图片信息。
 */
export interface AssetEntry {
  /** 素材 ID（同一 assetType 下唯一，三视图场景下即为 front/side/back） */
  id: string;
  /** 素材类型 */
  type: AssetType;
  /**
   * 槽位标识（仅 three-view 类型使用，值为 'front' | 'side' | 'back'）。
   * illustration / general 类型留空。
   */
  slot?: ThreeViewSlot;
  /** 图片文件名（相对于该 assetType 目录），形如 `{assetId}.png` */
  image: string;
  /** 创建时间（ISO 8601 时间戳字符串） */
  createdAt: string;
}

/**
 * 素材包清单：每个角色卡 × 每个 assetType 一个 manifest.json。
 */
export interface AssetManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号 */
  version: 1;
  /** 已上传的素材映射：assetId -> AssetEntry */
  assets: Record<string, AssetEntry>;
}

class AssetService {
  private assetRootDir: string;

  constructor() {
    this.assetRootDir = path.join(getUserDataPath(), 'data', 'character-assets');
    console.log('[AssetService] Asset root directory:', this.assetRootDir);
    this.ensureRootDirectoryExists();
  }

  /**
   * 确保素材根目录存在。仅在构造时调用一次，避免每次操作都检查。
   */
  private async ensureRootDirectoryExists(): Promise<void> {
    try {
      if (!fsSync.existsSync(this.assetRootDir)) {
        await fs.mkdir(this.assetRootDir, { recursive: true });
        console.log('[AssetService] Created asset root directory:', this.assetRootDir);
      }
    } catch (error) {
      // 不抛异常，后续单次操作仍会按需 mkdir
      console.error('[AssetService] ensureRootDirectoryExists failed:', error);
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
   * 与 expressionService.sanitizeCardId 实现完全一致，
   * 同一角色卡在表情/素材两个目录下使用同一 hash，便于未来跨类型检索。
   */
  private sanitizeCardId(characterCardId: string): string {
    const hash = crypto.createHash('sha256').update(characterCardId, 'utf8').digest('hex');
    return hash.slice(0, 16);
  }

  /**
   * 获取指定角色卡 × assetType 的素材目录（绝对路径），并确保目录存在。
   */
  private async getAssetTypeDir(
    characterCardId: string,
    assetType: AssetType
  ): Promise<string> {
    const dir = path.join(this.assetRootDir, this.sanitizeCardId(characterCardId), assetType);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * 获取指定角色卡 × assetType 的 manifest.json 绝对路径（不确保存在）。
   */
  private getManifestPath(characterCardId: string, assetType: AssetType): string {
    return path.join(
      this.assetRootDir,
      this.sanitizeCardId(characterCardId),
      assetType,
      'manifest.json'
    );
  }

  /**
   * 构造一个空白的默认 manifest。
   */
  private createEmptyManifest(characterCardId: string): AssetManifest {
    return {
      characterCardId,
      version: 1,
      assets: {},
    };
  }

  /**
   * 读取指定角色卡 × assetType 的素材清单。
   * 若目录或 manifest 不存在，返回默认空 manifest，不抛异常。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param assetType 素材类型
   */
  async listAssets(
    characterCardId: string,
    assetType: AssetType
  ): Promise<AssetManifest> {
    try {
      await this.ensureRootDirectoryExists();
      const manifestPath = this.getManifestPath(characterCardId, assetType);

      if (!fsSync.existsSync(manifestPath)) {
        console.log(
          '[AssetService] listAssets: manifest not found, returning default.',
          'characterCardId=', characterCardId,
          'assetType=', assetType
        );
        return this.createEmptyManifest(characterCardId);
      }

      const content = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(content) as AssetManifest;

      // 兜底：补全可能缺失的字段，避免旧/坏数据导致渲染进程报错
      return {
        characterCardId: parsed.characterCardId ?? characterCardId,
        version: 1,
        assets: parsed.assets ?? {},
      };
    } catch (error) {
      console.error('[AssetService] listAssets failed:', error);
      return this.createEmptyManifest(characterCardId);
    }
  }

  /**
   * 保存素材图像并更新 manifest。
   *
   * 流程：
   *   1. 校验参数（含三视图槽位约束）
   *   2. 剥离 `data:image/...;base64,` 前缀
   *   3. 写入 PNG 文件（覆盖已有同名文件）
   *   4. 更新 manifest.assets[assetId]
   *   5. 写入 manifest.json
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param assetType 素材类型
   * @param assetId 素材 ID（三视图类型仅允许 front/side/back）
   * @param imageBase64 图像 base64 字符串，可含 `data:image/png;base64,` 前缀
   * @param slot 三视图槽位（仅 three-view 类型时使用，与 assetId 一致）
   * @returns `{ success, error?, imagePath? }`，imagePath 为图像绝对路径
   */
  async saveAsset(
    characterCardId: string,
    assetType: AssetType,
    assetId: string,
    imageBase64: string,
    slot?: ThreeViewSlot
  ): Promise<{ success: boolean; error?: string; imagePath?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!assetId) {
        return { success: false, error: 'assetId 不能为空' };
      }
      if (!imageBase64) {
        return { success: false, error: 'imageBase64 不能为空' };
      }

      // 三视图槽位约束：仅允许 front / side / back
      if (assetType === 'three-view') {
        const allowed = THREE_VIEW_ALLOWED_SLOTS.includes(assetId as ThreeViewSlot);
        if (!allowed) {
          return { success: false, error: '三视图仅支持 front/side/back 槽位' };
        }
        // 三视图场景下，slot 与 assetId 保持一致
        slot = assetId as ThreeViewSlot;
      } else {
        // 非 three-view 类型不应携带 slot
        slot = undefined;
      }

      const assetTypeDir = await this.getAssetTypeDir(characterCardId, assetType);
      const imageFileName = `${assetId}.png`;
      const imagePath = path.join(assetTypeDir, imageFileName);

      // 剥离可能的 data URI 前缀
      const base64Data = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(imagePath, buffer);
      console.log('[AssetService] saveAsset: image written to', imagePath);

      // 更新 manifest
      const manifest = await this.listAssets(characterCardId, assetType);
      manifest.assets[assetId] = {
        id: assetId,
        type: assetType,
        ...(slot !== undefined ? { slot } : {}),
        image: imageFileName,
        createdAt: new Date().toISOString(),
      };

      const manifestPath = path.join(assetTypeDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log('[AssetService] saveAsset: manifest updated for', assetType, assetId);

      return { success: true, imagePath };
    } catch (error) {
      console.error('[AssetService] saveAsset failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 删除指定素材的图像文件，并从 manifest.assets 中移除。
   *
   * 流程：
   *   1. 删除 PNG 文件（ENOENT 视为成功，幂等）
   *   2. 从 manifest.assets 移除 assetId 条目
   *   3. 写入 manifest.json
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param assetType 素材类型
   * @param assetId 素材 ID
   */
  async deleteAsset(
    characterCardId: string,
    assetType: AssetType,
    assetId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!assetId) {
        return { success: false, error: 'assetId 不能为空' };
      }

      const assetTypeDir = path.join(
        this.assetRootDir,
        this.sanitizeCardId(characterCardId),
        assetType
      );
      const imagePath = path.join(assetTypeDir, `${assetId}.png`);

      // 删除图像文件；不存在视为幂等成功
      try {
        await fs.unlink(imagePath);
        console.log('[AssetService] deleteAsset: image removed', imagePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') {
          console.log('[AssetService] deleteAsset: image not found, skip unlink', imagePath);
        } else {
          // 其他错误抛出，由外层 catch 统一处理
          throw err;
        }
      }

      // 更新 manifest
      const manifest = await this.listAssets(characterCardId, assetType);
      if (manifest.assets[assetId]) {
        delete manifest.assets[assetId];
        // 确保 assetTypeDir 存在（listAssets 不会创建目录，仅 getAssetTypeDir 会）
        if (!fsSync.existsSync(assetTypeDir)) {
          await fs.mkdir(assetTypeDir, { recursive: true });
        }
        const manifestPath = path.join(assetTypeDir, 'manifest.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        console.log('[AssetService] deleteAsset: manifest updated, removed', assetType, assetId);
      } else {
        console.log('[AssetService] deleteAsset: assetId not in manifest, no manifest update', assetId);
      }

      return { success: true };
    } catch (error) {
      console.error('[AssetService] deleteAsset failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取指定素材的图像绝对路径，若图像不存在返回 null。
   * 供 IPC handler 读取文件后转换为 data URL 返回渲染进程（CSP 兼容）。
   *
   * @param characterCardId 角色卡 ID（原始路径字符串）
   * @param assetType 素材类型
   * @param assetId 素材 ID
   */
  async getAssetPath(
    characterCardId: string,
    assetType: AssetType,
    assetId: string
  ): Promise<string | null> {
    try {
      if (!characterCardId || !assetId) {
        return null;
      }

      const imagePath = path.join(
        this.assetRootDir,
        this.sanitizeCardId(characterCardId),
        assetType,
        `${assetId}.png`
      );

      if (fsSync.existsSync(imagePath)) {
        return imagePath;
      }
      return null;
    } catch (error) {
      console.error('[AssetService] getAssetPath failed:', error);
      return null;
    }
  }
}

export const assetService = new AssetService();
