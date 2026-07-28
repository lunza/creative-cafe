/**
 * 角色卡表情状态 Zustand store（Spec: add-character-expression-system / Task 6）
 *
 * 职责：
 * - 持有当前角色卡的表情 manifest 与图像路径缓存（imageCache）
 * - 封装所有 `window.electronAPI.expression.*` IPC 调用，对外暴露同步/异步 actions
 * - 提供情绪键 → 表情图像路径的解析器（resolveExpressionImage），供 ChatMessageBubble 渲染时调用
 * - 加载时预热浏览器图像缓存，避免后续情绪切换闪烁（Spec: Task 6.3 + Task 12.2）
 *
 * 设计要点：
 * - 不持久化到 localStorage：表情数据由主进程 expressionService 持久化到磁盘，
 *   此 store 仅作为运行期缓存与 IPC 适配层，每次进入对话重新拉取
 * - 所有 actions 包裹 try/catch，永不向调用方抛出异常，统一通过返回值 `{ success, error? }` 传递错误
 * - `manifest` / `imageCache` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
 *
 * 【重点标记】关于 `getImagePath` 的返回签名：
 * 任务文档描述为 `Promise<string | null>`，但 `src/renderer/types/electron.d.ts` 第 453 行
 * 与 `src/main/ipc/handlers/expressionHandlers.ts` 第 143 行的实际实现均为
 * `Promise<{ success: boolean; imagePath: string | null; error?: string }>`。
 * 本 store 以实际实现为准（取 `.imagePath`），不以任务文档为准。
 *
 * 【重点标记 - CSP 裂图 BUG 修复】
 * 主进程 `expressionService.getImagePath / saveImage` 返回的是磁盘绝对路径（如
 * `C:\Users\...\character-expressions\{hash}\joy.png`）。但 `src/main/index.ts` 中的
 * CSP 限制 `img-src 'self' data: blob:`，渲染进程无法直接通过 `<img src="C:/...">`
 * 加载本地文件，会导致「裂开图片」图标。
 *
 * 修复方案：imageCache 中**只存 data URL**，不存绝对路径：
 * - `loadExpressions`：拿到绝对路径后，再调用 `window.electronAPI.file.readAsBase64`
 *   读为 `data:image/png;base64,...` 存入 imageCache（与 `useCharacterSwitch` 加载头像一致）
 * - `saveExpression`：入参 `imageDataUrl` 本身已是 data URL（裁剪/SD 生成的输出），
 *   保存成功后直接存入 imageCache，无需读盘
 *
 * 参考：src/renderer/stores/characterChatStore.ts（无 persist 的 IPC 适配 store 模式）
 *      src/renderer/components/Character/CharacterDialogueChat/useCharacterSwitch.ts（头像 data URL 加载模式）
 */

import { create } from 'zustand';
import { EMOTION_PRESETS } from '../components/Character/CharacterDialogueChat/PromptBuilder';

// ==================== 类型定义 ====================

// 注：以下三个接口与主进程 `src/main/services/expressionService.ts` 中的同名接口
// 结构一致。此处采用结构化本地声明（避免将主进程代码导入渲染进程），保持渲染层独立性。

/** 表情条目：记录某个情绪键对应的图片信息 */
interface ExpressionEntry {
  /** 类型：preset（预置情绪）或 custom（自定义情绪） */
  type: 'preset' | 'custom';
  /** 图片文件名（相对于该角色卡表情目录，如 "joy.png"） */
  image: string;
}

/** 自定义情绪定义 */
interface CustomEmotion {
  /** 英文键名，需匹配 ^[a-z][a-z0-9_]*$ */
  key: string;
  /** 中文标签 */
  label: string;
}

/** 表情包清单：每个角色卡一个 manifest.json */
interface ExpressionManifest {
  /** 角色卡 ID（characterCardId 原始值，即角色卡文件路径字符串） */
  characterCardId: string;
  /** 清单版本号 */
  version: 1;
  /** 已上传的表情映射：emotionKey -> ExpressionEntry */
  expressions: Record<string, ExpressionEntry>;
  /** 用户为该角色卡自定义添加的情绪类别 */
  customEmotions: CustomEmotion[];
}

interface ExpressionState {
  /** 当前加载的角色卡 ID（用于校验缓存归属，切换角色卡时会被覆盖） */
  currentCharacterCardId: string | null;
  /** 当前 manifest（含预置 + 自定义情绪清单与图像映射） */
  manifest: ExpressionManifest | null;
  /** 图像缓存：emotionKey → data URL（仅含已上传的表情）。
   * 【重点标记 - CSP 兼容】存 data URL 而非磁盘绝对路径，避免被 CSP 拦截导致裂图。 */
  imageCache: Record<string, string>;
  /** 加载中标志 */
  loading: boolean;
  /** 最近一次错误信息（null 表示无错误） */
  error: string | null;

  // -------- Actions --------

  /**
   * 加载指定角色卡的表情包。
   * - 拉取 manifest，构造空白默认值兜底
   * - 逐个 emotionKey 调用 getImagePath 拿磁盘绝对路径，再 readAsBase64 转为 data URL 存入缓存
   * - 预热浏览器图像缓存（fire-and-forget）
   */
  loadExpressions: (characterCardId: string) => Promise<void>;

  /**
   * 保存表情图像（裁剪后的 data URL）。
   * 成功后同步更新本地 manifest 与 imageCache，并预热新图。
   */
  saveExpression: (
    characterCardId: string,
    emotionKey: string,
    imageDataUrl: string,
    isCustom: boolean,
    label?: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * 删除指定情绪的图像文件。
   * 成功后同步从 manifest.expressions 与 imageCache 移除。
   * 不会移除 customEmotions 条目（如需移除自定义情绪请调用 removeCustomEmotion）。
   */
  deleteExpression: (
    characterCardId: string,
    emotionKey: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * 添加自定义情绪类别（仅写入 manifest.customEmotions）。
   * 成功后同步追加到本地 manifest.customEmotions（幂等）。
   */
  addCustomEmotion: (
    characterCardId: string,
    key: string,
    label: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * 移除自定义情绪类别：从 customEmotions + expressions + imageCache 同步移除，
   * 主进程会一并删除图像文件。
   */
  removeCustomEmotion: (
    characterCardId: string,
    key: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * 解析情绪键 → 表情图像路径。
   * 优先级：自定义表情 > 预置表情。
   * 返回 null 表示未上传该情绪表情，调用方应回退到默认头像（avatarPath）。
   * 不区分自定义/预置类型——只要 imageCache 中有该 key 就返回。
   *
   * 特殊规则：emotionKey 为 null/undefined/空串/'default' 时直接返回 null
   * （default 情绪始终使用 avatarPath，无需上传）。
   */
  resolveExpressionImage: (emotionKey: string | undefined | null) => string | null;

  /**
   * 获取当前角色卡可用的所有情绪键（预置 30 + 自定义）。
   * 用于 buildExpressionPrompt 的 availableEmotionKeys 参数。
   * 去重保序，预置优先。
   */
  getAvailableEmotionKeys: () => string[];

  /** 重置所有状态（离开角色对话时调用） */
  clear: () => void;
}

// ==================== 工具函数 ====================

/**
 * 预加载单张图片到浏览器图像缓存（fire-and-forget）。
 *
 * Spec: add-character-expression-system / Task 6.3 + Task 12.2
 * 通过 `new Image()` 触发浏览器下载并缓存图像，后续切换情绪时可直接命中缓存避免闪烁。
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
    console.warn('[expressionStore] preloadImage failed:', imagePath, e);
  }
}

// ==================== Store 实现 ====================

export const useExpressionStore = create<ExpressionState>((set, get) => ({
  currentCharacterCardId: null,
  manifest: null,
  imageCache: {},
  loading: false,
  error: null,

  loadExpressions: async (characterCardId: string) => {
    if (!characterCardId) {
      console.warn('[expressionStore] loadExpressions: characterCardId 为空，跳过加载');
      return;
    }

    set({ loading: true, error: null, currentCharacterCardId: characterCardId });

    try {
      if (!window.electronAPI?.expression) {
        console.warn('[expressionStore] loadExpressions: window.electronAPI.expression 不可用');
        set({
          loading: false,
          error: 'electronAPI.expression 不可用',
          manifest: {
            characterCardId,
            version: 1,
            expressions: {},
            customEmotions: [],
          },
          imageCache: {},
        });
        return;
      }

      // 拉取 manifest
      const rawManifest = await window.electronAPI.expression.list(characterCardId);

      // 防御性兜底：list 理论上必返回 manifest，但若 IPC 异常可能返回 null/undefined
      const safeManifest: ExpressionManifest = {
        characterCardId: rawManifest?.characterCardId ?? characterCardId,
        version: 1,
        expressions: rawManifest?.expressions ?? {},
        customEmotions: rawManifest?.customEmotions ?? [],
      };

      // 构建 imageCache：逐个 emotionKey 调用 getImagePath 拿磁盘绝对路径，
      // 再通过 file.readAsBase64 转换为 data URL 存入缓存。
      // 【重点标记 - CSP 裂图 BUG 修复】绝对路径无法直接用于 <img src>（CSP 拦截），
      // 必须转为 data URL，与 useCharacterSwitch.ts 加载头像的方式保持一致。
      const imageCache: Record<string, string> = {};
      const emotionKeys = Object.keys(safeManifest.expressions);
      for (const emotionKey of emotionKeys) {
        try {
          const pathResult = await window.electronAPI.expression.getImagePath({
            characterCardId,
            emotionKey,
          });
          // 【重点标记】实际返回签名：{ success, imagePath, error? }，
          // 不是任务文档描述的 Promise<string | null>。以 electron.d.ts 与 handler 实现为准。
          if (pathResult?.success && pathResult.imagePath) {
            // 将磁盘文件读为 data URL（data:image/png;base64,...）
            const base64Result = await window.electronAPI.file.readAsBase64(pathResult.imagePath);
            if (base64Result?.success && base64Result.data) {
              imageCache[emotionKey] = base64Result.data;
            } else {
              console.warn(
                `[expressionStore] readAsBase64 failed for ${emotionKey}:`,
                base64Result?.error,
              );
            }
          }
        } catch (e) {
          console.warn(`[expressionStore] getImagePath failed for ${emotionKey}:`, e);
        }
      }

      // 预加载所有图像到浏览器缓存（fire-and-forget，无需 await）
      for (const path of Object.values(imageCache)) {
        preloadImage(path);
      }

      set({
        manifest: safeManifest,
        imageCache,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('[expressionStore] loadExpressions failed:', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : '加载表情包失败',
      });
    }
  },

  saveExpression: async (
    characterCardId: string,
    emotionKey: string,
    imageDataUrl: string,
    isCustom: boolean,
    label?: string
  ) => {
    try {
      if (!window.electronAPI?.expression) {
        return { success: false, error: 'electronAPI.expression 不可用' };
      }

      const result = await window.electronAPI.expression.saveImage({
        characterCardId,
        emotionKey,
        imageBase64: imageDataUrl,
        isCustom,
        label,
      });

      if (result?.success && result.imagePath) {
        const imageFileName = `${emotionKey}.png`;

        // 【重点标记 - CSP 裂图 BUG 修复】imageCache 只存 data URL，不存磁盘绝对路径。
        // 入参 imageDataUrl 本身就是 data URL（来自裁剪组件 / SD 生成结果），
        // 保存成功后直接复用即可，无需再从磁盘读回——既避免 CSP 拦截，又省一次 IO。
        // 仅做容错：若调用方传入的不是 data URL（理论上不会发生），才回退读盘。
        let imageSrcForCache: string;
        if (imageDataUrl && imageDataUrl.startsWith('data:')) {
          imageSrcForCache = imageDataUrl;
        } else {
          // 回退路径：从磁盘读取为 data URL
          const base64Result = await window.electronAPI.file.readAsBase64(result.imagePath);
          imageSrcForCache = base64Result?.success && base64Result.data
            ? base64Result.data
            : result.imagePath; // 最终兜底（虽会被 CSP 拦截，但 manifest 已写入，下次 loadExpressions 仍会失败）
        }

        set((state) => {
          const prevManifest = state.manifest;
          const nextManifest: ExpressionManifest = prevManifest
            ? { ...prevManifest }
            : {
                characterCardId,
                version: 1,
                expressions: {},
                customEmotions: [],
              };

          // 更新 expressions 映射（与主进程 expressionService.saveImage 写入的文件名保持一致）
          nextManifest.expressions = {
            ...nextManifest.expressions,
            [emotionKey]: {
              type: isCustom ? 'custom' : 'preset',
              image: imageFileName,
            },
          };

          // 自定义情绪需追加到 customEmotions（去重）
          if (isCustom) {
            const exists = nextManifest.customEmotions.some((e) => e.key === emotionKey);
            if (!exists) {
              nextManifest.customEmotions = [
                ...nextManifest.customEmotions,
                { key: emotionKey, label: label || emotionKey },
              ];
            }
          }

          // 更新 imageCache（仅存 data URL，CSP 兼容）
          const nextImageCache = {
            ...state.imageCache,
            [emotionKey]: imageSrcForCache,
          };

          return { manifest: nextManifest, imageCache: nextImageCache };
        });

        // 预加载新上传的图片到浏览器缓存
        preloadImage(imageSrcForCache);
      }

      return { success: result?.success ?? false, error: result?.error };
    } catch (error) {
      console.error('[expressionStore] saveExpression failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存表情失败',
      };
    }
  },

  deleteExpression: async (characterCardId: string, emotionKey: string) => {
    try {
      if (!window.electronAPI?.expression) {
        return { success: false, error: 'electronAPI.expression 不可用' };
      }

      const result = await window.electronAPI.expression.deleteImage({
        characterCardId,
        emotionKey,
      });

      if (result?.success) {
        set((state) => {
          if (!state.manifest) return state;

          const nextExpressions = { ...state.manifest.expressions };
          delete nextExpressions[emotionKey];

          const nextImageCache = { ...state.imageCache };
          delete nextImageCache[emotionKey];

          return {
            manifest: { ...state.manifest, expressions: nextExpressions },
            imageCache: nextImageCache,
          };
        });
      }

      return { success: result?.success ?? false, error: result?.error };
    } catch (error) {
      console.error('[expressionStore] deleteExpression failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除表情失败',
      };
    }
  },

  addCustomEmotion: async (characterCardId: string, key: string, label: string) => {
    try {
      if (!window.electronAPI?.expression) {
        return { success: false, error: 'electronAPI.expression 不可用' };
      }

      const result = await window.electronAPI.expression.addCustomEmotion({
        characterCardId,
        key,
        label,
      });

      if (result?.success) {
        set((state) => {
          const prevManifest = state.manifest;
          if (!prevManifest) return state;

          // 幂等：仅在不存在时追加
          const exists = prevManifest.customEmotions.some((e) => e.key === key);
          if (exists) return state;

          return {
            manifest: {
              ...prevManifest,
              customEmotions: [...prevManifest.customEmotions, { key, label }],
            },
          };
        });
      }

      return { success: result?.success ?? false, error: result?.error };
    } catch (error) {
      console.error('[expressionStore] addCustomEmotion failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '添加自定义情绪失败',
      };
    }
  },

  removeCustomEmotion: async (characterCardId: string, key: string) => {
    try {
      if (!window.electronAPI?.expression) {
        return { success: false, error: 'electronAPI.expression 不可用' };
      }

      const result = await window.electronAPI.expression.removeCustomEmotion({
        characterCardId,
        key,
      });

      if (result?.success) {
        set((state) => {
          if (!state.manifest) return state;

          const nextCustomEmotions = state.manifest.customEmotions.filter((e) => e.key !== key);

          const nextExpressions = { ...state.manifest.expressions };
          delete nextExpressions[key];

          const nextImageCache = { ...state.imageCache };
          delete nextImageCache[key];

          return {
            manifest: {
              ...state.manifest,
              customEmotions: nextCustomEmotions,
              expressions: nextExpressions,
            },
            imageCache: nextImageCache,
          };
        });
      }

      return { success: result?.success ?? false, error: result?.error };
    } catch (error) {
      console.error('[expressionStore] removeCustomEmotion failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '移除自定义情绪失败',
      };
    }
  },

  resolveExpressionImage: (emotionKey: string | undefined | null) => {
    // null/undefined/空串 → 回退到默认头像
    if (emotionKey === null || emotionKey === undefined || emotionKey === '') {
      return null;
    }
    // default 情绪 → 使用 avatarPath 回退（不要求用户上传 default 表情）
    if (emotionKey === 'default') {
      return null;
    }
    const { imageCache } = get();
    return imageCache[emotionKey] || null;
  },

  getAvailableEmotionKeys: () => {
    const { manifest } = get();
    const presetKeys = EMOTION_PRESETS.map((e) => e.key);
    const customKeys = manifest?.customEmotions?.map((c) => c.key) ?? [];

    // 去重保序（预置优先；正常情况下自定义 key 不会与预置 key 冲突——
    // addCustomEmotion 在主进程侧已校验不与预置重复）
    const seen = new Set<string>();
    const result: string[] = [];
    for (const k of [...presetKeys, ...customKeys]) {
      if (!seen.has(k)) {
        seen.add(k);
        result.push(k);
      }
    }
    return result;
  },

  clear: () => {
    set({
      currentCharacterCardId: null,
      manifest: null,
      imageCache: {},
      loading: false,
      error: null,
    });
  },
}));

// ==================== 类型导出 ====================

export type {
  ExpressionEntry,
  CustomEmotion,
  ExpressionManifest,
  ExpressionState,
};
