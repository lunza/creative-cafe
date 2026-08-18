/**
 * 角色素材管理与特征管理系统 Zustand store（Spec: add-asset-and-trait-management / Task 8）
 *
 * 职责：
 * - 按 assetType 分组持有 `manifests` 与 `imageCache`（illustration / general / three-view）
 * - 封装所有 `window.electronAPI.asset.*` IPC 调用，对外暴露同步/异步 actions
 * - 提供 `resolveAssetImage(assetType, assetId)` 解析器，供未来对话/卡片渲染调用
 *
 * 设计要点：
 * - 不持久化到 localStorage：素材 manifest 由主进程 assetService 持久化到磁盘
 *   （`{userData}/data/character-assets/{sha256(characterCardId).slice(0,16)}/{assetType}/manifest.json`），
 *   此 store 仅作为运行期缓存与 IPC 适配层，每次进入角色卡时重新拉取
 * - 所有 actions 包裹 try/catch，永不向调用方抛出异常，统一通过返回值 `{ success, error? }` 传递错误
 * - `manifests` / `imageCache` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
 *
 * 【重点标记 - CSP 兼容设计】（与 expressionStore.ts 同源修复模式）
 * 主进程 `assetService.getImagePath / save` 返回的 `imagePath` 是磁盘绝对路径（如
 * `C:\Users\...\character-assets\{hash}\illustration\{assetId}.png`）。但 `src/main/index.ts`
 * 中的 CSP 限制 `img-src 'self' data: blob:`，渲染进程无法直接通过 `<img src="C:/...">`
 * 加载本地文件，会导致「裂开图片」图标。
 *
 * 修复方案：imageCache 中**只存 data URL**，不存绝对路径：
 * - `loadAssets`：拿到 `getImagePath` 返回的绝对路径后，再调用 `window.electronAPI.file.readAsBase64`
 *   读为 `data:image/png;base64,...` 存入 imageCache（与 `useCharacterSwitch` 加载头像、
 *   `expressionStore.loadExpressions` 加载表情一致）
 * - `saveAsset`：入参 `imageBase64` 本身已是 data URL（裁剪/SD 生成的输出），
 *   保存成功后直接复用入参存入 imageCache，无需读盘——既避免 CSP 拦截，又省一次 IO
 *
 * 参考：
 * - src/renderer/stores/expressionStore.ts（CSP 裂图 BUG 修复模式来源）
 * - src/renderer/components/Character/CharacterDialogueChat/useCharacterSwitch.ts（头像 data URL 加载模式）
 * - src/main/services/assetService.ts（主进程持久化实现）
 * - src/main/ipc/handlers/assetHandlers.ts（IPC handler 实现）
 * - src/renderer/types/electron.d.ts（asset 命名空间 IPC 类型声明）
 */

import { create } from 'zustand';

// ==================== 类型定义 ====================

// 注：以下类型与主进程 `src/main/services/assetService.ts` 中的同名类型结构一致。
// 此处采用结构化本地声明（避免将主进程代码导入渲染进程），保持渲染层独立性。
// 同时与 `src/renderer/types/electron.d.ts` 第 476-505 行 asset 命名空间中内联声明的
// 结构保持一致，确保 IPC 边界两侧类型形状不漂移。

/** 素材类型：illustration（立绘）/ general（通用素材）/ three-view（三视图） */
export type AssetType = 'illustration' | 'general' | 'three-view';

/** 三视图槽位：front（正视图）/ side（侧视图）/ back（背视图）
 * 含裸体变体：front-nude / side-nude / back-nude（生成时自动过滤上装/下装/内衣分类特征，配饰保留） */
export type ThreeViewSlot = 'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude';

/** 素材条目：记录某个 assetId 对应的图片信息（manifest.assets[assetId]） */
export interface AssetEntry {
  /** 素材 ID（illustration/general 时为自定义 ID；three-view 时为 front/side/back） */
  id: string;
  /** 素材类型 */
  type: AssetType;
  /** 三视图槽位（仅 type='three-view' 时存在，值为 front/side/back） */
  slot?: ThreeViewSlot;
  /** 图片文件名（相对于该角色卡 × assetType 目录，如 "{assetId}.png"） */
  image: string;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
}

/** 素材包清单：每个角色卡 × assetType 一个 manifest.json */
export interface AssetManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号 */
  version: 1;
  /** 已上传的素材映射：assetId -> AssetEntry */
  assets: Record<string, AssetEntry>;
}

/**
 * 素材 store 状态接口。
 *
 * 状态字段：
 * - `currentCharacterCardId`：当前加载的角色卡 ID（用于校验缓存归属，切换角色卡时会被覆盖）
 * - `manifests`：三种 assetType 各自的 manifest（按 assetType 分组持有，互不污染）
 * - `imageCache`：三种 assetType 各自的 data URL 缓存（仅存 data URL，CSP 兼容）
 * - `loading` / `error`：加载状态
 *
 * Actions：见下方各方法 JSDoc。
 */
export interface AssetState {
  /** 当前加载的角色卡 ID（用于校验缓存归属，切换角色卡时会被覆盖） */
  currentCharacterCardId: string | null;
  /** 三种 assetType 各自的 manifest（null 表示该类型尚未加载） */
  manifests: Record<AssetType, AssetManifest | null>;
  /** 图像缓存：assetType -> assetId -> data URL。
   * 【重点标记 - CSP 兼容】只存 data URL，不存磁盘绝对路径，避免被 CSP 拦截导致裂图。 */
  imageCache: Record<AssetType, Record<string, string>>;
  /** 加载中标志 */
  loading: boolean;
  /** 最近一次错误信息（null 表示无错误） */
  error: string | null;

  // -------- Actions --------

  /**
   * 加载指定角色卡 × assetType 的素材包。
   * - 调 `asset.list` 拿 manifest
   * - 遍历 assets 调 `asset.getImagePath` 拿磁盘绝对路径
   * - 调 `file.readAsBase64` 转 data URL 存入 imageCache[assetType]
   * - 仅更新对应 assetType 的 manifest/imageCache，不触碰其他类型
   */
  loadAssets: (characterCardId: string, assetType: AssetType) => Promise<void>;

  /**
   * 保存素材图像（base64，可含 data URI 前缀）。
   * - 调 `asset.save` 持久化到磁盘并更新主进程 manifest
   * - 成功后**直接复用入参 imageBase64**（已是 data URL）存入 imageCache，避免读盘
   * - 同步更新本地 manifests[assetType].assets[assetId]
   */
  saveAsset: (args: {
    characterCardId: string;
    assetType: AssetType;
    assetId: string;
    imageBase64: string;
    slot?: ThreeViewSlot;
  }) => Promise<{ success: boolean; error?: string }>;

  /**
   * 删除指定素材的图像文件。
   * - 调 `asset.delete` 删除磁盘文件并从主进程 manifest.assets 移除
   * - 同步从 manifests[assetType].assets 与 imageCache[assetType] 移除
   */
  deleteAsset: (args: {
    characterCardId: string;
    assetType: AssetType;
    assetId: string;
  }) => Promise<{ success: boolean; error?: string }>;

  /**
   * 解析 assetType × assetId → 素材图像 data URL。
   * 优先从 imageCache 查找；未找到返回 null，调用方应回退到默认占位图。
   * 供未来对话/卡片渲染时调用。
   */
  resolveAssetImage: (assetType: AssetType, assetId: string) => string | null;

  /** 重置所有状态（离开角色卡时调用） */
  clear: () => void;
}

// ==================== 工具函数 ====================

/**
 * 构造空 manifests 初始值（三种 assetType 均为 null）。
 */
function createEmptyManifests(): Record<AssetType, AssetManifest | null> {
  return {
    illustration: null,
    general: null,
    'three-view': null,
  };
}

/**
 * 构造空 imageCache 初始值（三种 assetType 均为空对象）。
 */
function createEmptyImageCache(): Record<AssetType, Record<string, string>> {
  return {
    illustration: {},
    general: {},
    'three-view': {},
  };
}

/**
 * 预加载单张图片到浏览器图像缓存（fire-and-forget）。
 *
 * 通过 `new Image()` 触发浏览器下载并缓存图像，后续切换素材时可直接命中缓存避免闪烁。
 * 不需要 await——加载失败也不影响业务流程，最多出现一次图片加载失败回退。
 */
function preloadImage(imagePath: string): void {
  try {
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.src = imagePath;
    }
  } catch (e) {
    // 预加载失败仅打印日志，不影响业务流程
    console.warn('[assetStore] preloadImage failed:', imagePath, e);
  }
}

// ==================== Store 实现 ====================

export const useAssetStore = create<AssetState>((set, get) => ({
  currentCharacterCardId: null,
  manifests: createEmptyManifests(),
  imageCache: createEmptyImageCache(),
  loading: false,
  error: null,

  loadAssets: async (characterCardId: string, assetType: AssetType) => {
    if (!characterCardId) {
      console.warn('[assetStore] loadAssets: characterCardId 为空，跳过加载');
      return;
    }

    set({ loading: true, error: null, currentCharacterCardId: characterCardId });

    try {
      if (!window.electronAPI?.asset) {
        console.warn('[assetStore] loadAssets: window.electronAPI.asset 不可用');
        set((state) => ({
          loading: false,
          error: 'electronAPI.asset 不可用',
          manifests: {
            ...state.manifests,
            [assetType]: {
              characterCardId,
              version: 1,
              assets: {},
            },
          },
          imageCache: {
            ...state.imageCache,
            [assetType]: {},
          },
        }));
        return;
      }

      // 拉取 manifest
      const rawManifest = await window.electronAPI.asset.list({ characterCardId, assetType });

      // 防御性兜底：list 理论上必返回 manifest，但若 IPC 异常可能返回 null/undefined
      const safeManifest: AssetManifest = {
        characterCardId: rawManifest?.characterCardId ?? characterCardId,
        version: 1,
        assets: rawManifest?.assets ?? {},
      };

      // 构建 imageCache[assetType]：逐个 assetId 调用 getImagePath 拿磁盘绝对路径，
      // 再通过 file.readAsBase64 转换为 data URL 存入缓存。
      // 【重点标记 - CSP 裂图 BUG 修复】绝对路径无法直接用于 <img src>（CSP 拦截），
      // 必须转为 data URL，与 expressionStore.loadExpressions、useCharacterSwitch 一致。
      const nextTypeCache: Record<string, string> = {};
      const assetIds = Object.keys(safeManifest.assets);
      for (const assetId of assetIds) {
        try {
          const pathResult = await window.electronAPI.asset.getImagePath({
            characterCardId,
            assetType,
            assetId,
          });
          if (pathResult?.success && pathResult.imagePath) {
            // 将磁盘文件读为 data URL（data:image/png;base64,...）
            const base64Result = await window.electronAPI.file.readAsBase64(pathResult.imagePath);
            if (base64Result?.success && base64Result.data) {
              nextTypeCache[assetId] = base64Result.data;
            } else {
              console.warn(
                `[assetStore] readAsBase64 failed for ${assetType}/${assetId}:`,
                base64Result?.error,
              );
            }
          }
        } catch (e) {
          console.warn(
            `[assetStore] getImagePath failed for ${assetType}/${assetId}:`,
            e,
          );
        }
      }

      // 预加载所有图像到浏览器缓存（fire-and-forget，无需 await）
      for (const dataUrl of Object.values(nextTypeCache)) {
        preloadImage(dataUrl);
      }

      set((state) => ({
        manifests: {
          ...state.manifests,
          [assetType]: safeManifest,
        },
        imageCache: {
          ...state.imageCache,
          [assetType]: nextTypeCache,
        },
        loading: false,
        error: null,
      }));
    } catch (error) {
      console.error('[assetStore] loadAssets failed:', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : '加载素材包失败',
      });
    }
  },

  saveAsset: async ({ characterCardId, assetType, assetId, imageBase64, slot }) => {
    try {
      if (!window.electronAPI?.asset) {
        return { success: false, error: 'electronAPI.asset 不可用' };
      }

      const result = await window.electronAPI.asset.save({
        characterCardId,
        assetType,
        assetId,
        imageBase64,
        slot,
      });

      if (result?.success) {
        // 【重点标记 - CSP 裂图 BUG 修复】imageCache 只存 data URL，不存磁盘绝对路径。
        // 入参 imageBase64 本身就是 data URL（来自裁剪组件 / SD 生成结果），
        // 保存成功后直接复用即可，无需再从磁盘读回——既避免 CSP 拦截，又省一次 IO。
        // 仅做容错：若调用方传入的不是 data URL（理论上不会发生），才回退读盘。
        let imageSrcForCache: string;
        if (imageBase64 && imageBase64.startsWith('data:')) {
          imageSrcForCache = imageBase64;
        } else if (result.imagePath) {
          // 回退路径：从磁盘读取为 data URL
          const base64Result = await window.electronAPI.file.readAsBase64(result.imagePath);
          imageSrcForCache = base64Result?.success && base64Result.data
            ? base64Result.data
            : imageBase64; // 最终兜底（虽可能被 CSP 拦截，但 manifest 已写入）
        } else {
          imageSrcForCache = imageBase64;
        }

        set((state) => {
          const prevManifest = state.manifests[assetType];
          const nextManifest: AssetManifest = prevManifest
            ? { ...prevManifest, assets: { ...prevManifest.assets } }
            : {
                characterCardId,
                version: 1,
                assets: {},
              };

          // 更新 assets 映射（与主进程 assetService.save 写入的条目结构保持一致）
          nextManifest.assets = {
            ...nextManifest.assets,
            [assetId]: {
              id: assetId,
              type: assetType,
              slot,
              image: result.imagePath ?? `${assetId}.png`,
              createdAt: new Date().toISOString(),
            },
          };

          // 更新 imageCache[assetType]（仅存 data URL，CSP 兼容）
          const nextTypeCache = {
            ...state.imageCache[assetType],
            [assetId]: imageSrcForCache,
          };

          return {
            manifests: {
              ...state.manifests,
              [assetType]: nextManifest,
            },
            imageCache: {
              ...state.imageCache,
              [assetType]: nextTypeCache,
            },
          };
        });

        // 预加载新上传的图片到浏览器缓存
        preloadImage(imageSrcForCache);
      }

      return { success: result?.success ?? false, error: result?.error };
    } catch (error) {
      console.error('[assetStore] saveAsset failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存素材失败',
      };
    }
  },

  deleteAsset: async ({ characterCardId, assetType, assetId }) => {
    try {
      if (!window.electronAPI?.asset) {
        return { success: false, error: 'electronAPI.asset 不可用' };
      }

      const result = await window.electronAPI.asset.delete({
        characterCardId,
        assetType,
        assetId,
      });

      if (result?.success) {
        set((state) => {
          const prevManifest = state.manifests[assetType];
          if (!prevManifest) return state;

          const nextAssets = { ...prevManifest.assets };
          delete nextAssets[assetId];

          const nextTypeCache = { ...state.imageCache[assetType] };
          delete nextTypeCache[assetId];

          return {
            manifests: {
              ...state.manifests,
              [assetType]: { ...prevManifest, assets: nextAssets },
            },
            imageCache: {
              ...state.imageCache,
              [assetType]: nextTypeCache,
            },
          };
        });
      }

      return { success: result?.success ?? false, error: result?.error };
    } catch (error) {
      console.error('[assetStore] deleteAsset failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除素材失败',
      };
    }
  },

  resolveAssetImage: (assetType: AssetType, assetId: string) => {
    if (!assetId) {
      return null;
    }
    const { imageCache } = get();
    const typeCache = imageCache[assetType];
    return typeCache?.[assetId] || null;
  },

  clear: () => {
    set({
      currentCharacterCardId: null,
      manifests: createEmptyManifests(),
      imageCache: createEmptyImageCache(),
      loading: false,
      error: null,
    });
  },
}));
