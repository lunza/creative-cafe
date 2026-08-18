/**
 * 角色素材管理与特征管理弹窗（Spec: add-asset-and-trait-management / Task 9）
 *
 * 重构自 ExpressionManagerModal.tsx：原弹窗仅管理表情，重构后内部 5 个 Tab：
 * 1. 表情（ExpressionTabContent）—— 复用 ExpressionManagerModal 的表情网格逻辑
 * 2. 角色立绘（AssetGridTabContent，assetType='illustration'）
 * 3. 一般图像（AssetGridTabContent，assetType='general'）
 * 4. 三视图（ThreeViewTabContent，三个固定槽位：正面/侧面/背面）
 * 5. 角色特征（CharacterTraitTabContent，Tag 编辑器）
 *
 * 数据来源：
 * - 表情：useExpressionStore（已有）
 * - 立绘/一般图像/三视图：useAssetStore（Task 8 新建）
 * - 特征：useCharacterTraitStore（Task 3 新建）
 *
 * 约束：
 * - AI 生成入口（表情/素材/特征）均为 placeholder，Task 11+ 接入 AssetGenerateModal
 * - 不删除原 ExpressionManagerModal.tsx（Task 11 决定保留/删除）
 * - 不修改任何入口文件（Task 11 处理）
 *
 * UI 风格：暗色主题 + inline styles + 项目 CSS 变量（与 ExpressionManagerModal 一致）
 *
 * 文件头说明重构关系：本文件由 ExpressionManagerModal.tsx 重构而来，
 * 表情 Tab 直接复用其核心逻辑（30 预置情绪 + 自定义情绪网格 + 上传/删除/裁剪流程）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
// 【Spec: add-sdxl-prompt-weight-support / Task 8】Popover / InputNumber / Slider 用于权重编辑器
import { Modal, Button, Input, message, Spin, Empty, Tooltip, Tabs, Tag, Collapse, Select, Dropdown, Popover, InputNumber, Slider } from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  PlusOutlined,
  CloseOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  SaveOutlined,
  EyeOutlined,
  SwapOutlined,
  FolderAddOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
  ClearOutlined,
  CheckOutlined,
  // 【Spec: optimize-trait-translation-and-temp-scheme / Task 4】拆分标签视觉标识
  SplitCellsOutlined,
} from '@ant-design/icons';
import {
  SYSTEM_TRAIT_CATEGORIES,
  UNCATEGORIZED_CATEGORY,
  UNCATEGORIZED_CATEGORY_ID,
} from '@shared/types';
import type { CategorizedTrait, CharacterTraitItem, TraitCategory } from '@shared/types';
import { EMOTION_PRESETS } from './PromptBuilder';
import ImageCropperModal from './ImageCropperModal';
import AssetGenerateModal from './AssetGenerateModal';
import LoraSelectModal from './LoraSelectModal';
import RagQualityReport from './RagQualityReport';
import { useExpressionStore } from '../../../stores/expressionStore';
import { useSettingStore } from '../../../stores/settingStore';
import type { CustomEmotion } from '../../../stores/expressionStore';
import { useAssetStore } from '../../../stores/assetStore';
import type { AssetType, ThreeViewSlot } from '../../../stores/assetStore';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
import { useCharacterLoraStore } from '../../../stores/characterLoraStore';
import { invalidateCharacterImageCache } from '../utils/characterThumbnailCache';
// 【Spec: implement-local-tag-autocomplete / Task 7 集成补全】
// 原实现仅集成了 AssetGenerateModal 的「新增临时标签」入口，遗漏了本组件
// CharacterTraitTabContent 的「输入新特征 tag」入口（见下方 newTrait Input 替换）。
// 修复记录见 docs/FIX_RECORDS.md §6.1。
import { TagAutocomplete } from '../../Common';
// LazyImage（Spec: optimize-system-rendering-performance / Task 6.1）
// 走主进程 thumbnail:get IPC 取压缩缩略图，懒加载进入视口的卡片缩略图，
// 替换 AssetCard 原先直显全尺寸 dataUrl 的 <img>，缓解素材网格滚动卡顿。
import { LazyImage } from '../../Common/LazyImage';

// ==================== Props 接口 ====================

interface AssetManagerModalProps {
  open: boolean;
  characterCardId: string;
  characterName: string;
  /** 新增：角色描述，供 AI 特征生成使用（Task 13） */
  characterDescription?: string;
  /** 新增：角色个性，供 AI 特征生成使用（Task 13） */
  characterPersonality?: string;
  /** 新增：角色场景，供 AI 特征生成使用（Task 13） */
  characterScenario?: string;
  /** 默认表情（角色卡 PNG）预览，用于 default 卡片 + 未上传情绪的占位 */
  avatarPath?: string;
  onClose: () => void;
  /**
   * 角色卡图片替换回调（Task 2）。
   * 当用户在立绘 Tab 点击「设为角色卡图片」并确认后触发。
   * 内联模式下由 CharacterEditModal 接收，更新 uploadedImage 预览 + 重置 imageChanged
   * （因为 PNG 已在磁盘上重建，保存时仅需 write JSON，无需再次 createFromImage）。
   * 弹窗模式下（CharacterDialogueChat）可不传。
   */
  onCardImageReplaced?: (newImageDataUrl: string) => void;
  /**
   * 内联渲染模式：为 true 时不渲染 Modal 外壳，直接输出 Tabs + AssetGenerateModal，
   * 用于嵌入 CharacterEditModal 的「素材管理」Tab 页签，避免「点击按钮再打开弹窗」的二次跳转。
   *
   * - inline=false（默认）：渲染为独立 Modal（mask + footer + 定位），供 ChatHeader 按钮调用
   * - inline=true：渲染为普通 div，内容随父容器流动；open prop 仅控制数据加载时机
   *   （内部 useEffect 依赖 open && characterCardId 触发加载）
   * - 内联模式下内部子弹窗（ImageCropperModal / AssetGenerateModal / LoraSelectModal）
   *   仍各自 portal 到 document.body，不受内联影响
   */
  inline?: boolean;
}

// ==================== 常量 ====================

/** 自定义情绪英文键校验正则（与主进程 expressionService 保持一致） */
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** 三视图槽位元数据：用于 ThreeViewTabContent 渲染（穿衣 3 + 裸体 3 = 6 个槽位） */
const THREE_VIEW_SLOTS: ReadonlyArray<{ slot: ThreeViewSlot; label: string; nude: boolean }> = [
  { slot: 'front', label: '正面', nude: false },
  { slot: 'side', label: '侧面', nude: false },
  { slot: 'back', label: '背面', nude: false },
  { slot: 'front-nude', label: '正面', nude: true },
  { slot: 'side-nude', label: '侧面', nude: true },
  { slot: 'back-nude', label: '背面', nude: true },
];

// ==================== 子组件：ImagePreviewModal（可复用全尺寸预览弹窗，支持上一张/下一张） ====================

interface PreviewableImage {
  url: string;
  label: string;
}

interface ImagePreviewModalProps {
  /** 可预览的图片列表（按显示顺序） */
  images: PreviewableImage[];
  /** 当前预览索引（-1 = 关闭） */
  index: number;
  /** 索引变更回调（传入 -1 表示关闭） */
  onChange: (index: number) => void;
}

/**
 * 全尺寸图片预览弹窗（支持上一张/下一张导航）。
 *
 * 左右两侧显示 `<` / `>` 圆形按钮，多张时底部显示「标签（X / Y）」计数器。
 * 用于 ExpressionTabContent / AssetGridTabContent / ThreeViewTabContent 的图片预览。
 */
const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  images,
  index,
  onChange,
}) => {
  const open = index >= 0 && index < images.length;
  const current = open ? images[index] : null;

  return (
    <Modal
      open={open}
      onCancel={() => onChange(-1)}
      footer={null}
      title={null}
      centered
      width="auto"
      style={{ maxWidth: '95vw', padding: 0 }}
      styles={{ body: { padding: 0 } }}
      closable
      destroyOnClose
    >
      {current && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {/* 上一张按钮 */}
          <Button
            shape="circle"
            icon={<LeftOutlined />}
            disabled={index <= 0}
            onClick={() => onChange(Math.max(0, index - 1))}
            style={{ flexShrink: 0 }}
          />
          <div style={{ textAlign: 'center' }}>
            <img
              src={current.url}
              alt={current.label}
              style={{
                maxWidth: '85vw',
                maxHeight: '85vh',
                display: 'block',
                borderRadius: 8,
              }}
            />
            {/* 计数器 + 标签（仅多张时显示） */}
            {images.length > 1 && (
              <div
                style={{
                  marginTop: 8,
                  color: 'var(--text-secondary, #94a3b8)',
                  fontSize: 12,
                }}
              >
                {current.label}（{index + 1} / {images.length}）
              </div>
            )}
          </div>
          {/* 下一张按钮 */}
          <Button
            shape="circle"
            icon={<RightOutlined />}
            disabled={index >= images.length - 1}
            onClick={() => onChange(Math.min(images.length - 1, index + 1))}
            style={{ flexShrink: 0 }}
          />
        </div>
      )}
    </Modal>
  );
};

// ==================== 子组件：ExpressionTabContent ====================

interface ExpressionTabContentProps {
  characterCardId: string;
  characterName: string;
  avatarPath?: string;
  /** 批量生成 30 预置情绪入口（Task 11 接入 AssetGenerateModal） */
  onBatchGenerate?: () => void;
  /** 单张情绪生成入口（Task 11 接入 AssetGenerateModal） */
  onSingleGenerate?: (emotionKey: string, label: string) => void;
}

/**
 * 表情 Tab 内容（Spec: add-asset-and-trait-management / Task 9.2）
 *
 * 直接复用 ExpressionManagerModal 的表情网格逻辑：
 * - 30 预置情绪 + 自定义情绪网格
 * - 上传流程：file input → FileReader → ImageCropperModal → saveExpression
 * - 删除流程：Modal.confirm → deleteExpression
 * - 添加自定义情绪表单
 * - AI 生成入口：placeholder（Task 11 接入 AssetGenerateModal）
 *
 * 此子组件从 ExpressionManagerModal.tsx 复制核心逻辑后适配为 Tab 内容形态
 * （去除外层 Modal，仅保留 Tab 内主体）。
 */
const ExpressionTabContent: React.FC<ExpressionTabContentProps> = ({
  characterCardId,
  characterName,
  avatarPath,
  onBatchGenerate,
  onSingleGenerate,
}) => {
  // ====== Store 订阅 ======
  const {
    manifest,
    imageCache,
    loading,
    loadExpressions,
    saveExpression,
    deleteExpression,
    addCustomEmotion,
    removeCustomEmotion,
  } = useExpressionStore();
  // TODO(perf): 整体订阅，待拆分为 selector（8 字段，>5 暂缓）

  // store.error 单独订阅，用于渲染 inline 错误横幅
  const storeError = useExpressionStore((s) => s.error);

  // ====== 裁剪弹窗状态 ======
  const [cropperOpen, setCropperOpen] = useState<boolean>(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  /** 当前正在上传的情绪键 */
  const [cropperTargetKey, setCropperTargetKey] = useState<string | null>(null);
  /** 上传的目标是否为自定义情绪（影响 saveExpression 的 isCustom 参数与 manifest 写入位置） */
  const [cropperIsCustom, setCropperIsCustom] = useState<boolean>(false);
  /** 自定义情绪标签（自定义情绪保存时透传给 store，用于 customEmotions 列表） */
  const [cropperLabel, setCropperLabel] = useState<string>('');

  // ====== 添加自定义情绪表单状态 ======
  const [addCustomOpen, setAddCustomOpen] = useState<boolean>(false);
  const [newCustomLabel, setNewCustomLabel] = useState<string>('');
  // 一键生成流程 loading（AI 生成 + 保存合并为一个动作）
  const [autoGenerating, setAutoGenerating] = useState<boolean>(false);

  // ====== 全尺寸预览状态（与 AssetGridTabContent / ThreeViewTabContent 一致：缩略图 hover 眼睛图标预览） ======
  // 支持上一张/下一张导航：previewIndex 跟踪当前预览位置，-1 = 关闭
  const [previewIndex, setPreviewIndex] = useState<number>(-1);

  // 隐藏的 file input ref（用于触发文件选择对话框）
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ====== 打开 Tab 时加载表情包（顶层 AssetManagerModal 已统一加载，此处兜底） ======
  useEffect(() => {
    if (characterCardId) {
      loadExpressions(characterCardId);
    }
  }, [characterCardId, loadExpressions]);

  // ====== 关闭时重置局部状态（避免下次打开残留裁剪/表单状态） ======
  const resetCropperState = useCallback(() => {
    setCropperOpen(false);
    setCropperImageSrc(null);
    setCropperTargetKey(null);
    setCropperIsCustom(false);
    setCropperLabel('');
  }, []);

  // ====== 上传流程 ======

  /**
   * 点击某情绪卡片的「上传」按钮：记录目标情绪信息，触发隐藏 file input。
   * 注意 fileInputRef.current.value 必须重置，否则用户连续选择同一文件不触发 change。
   */
  const handleUploadClick = useCallback(
    (emotionKey: string, isCustom: boolean, label: string) => {
      setCropperTargetKey(emotionKey);
      setCropperIsCustom(isCustom);
      setCropperLabel(label);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
    },
    [],
  );

  /** file input change：读取为 data URL 并打开裁剪弹窗 */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setCropperImageSrc(dataUrl);
        setCropperOpen(true);
      };
      reader.onerror = () => {
        message.error('读取图片文件失败');
        resetCropperState();
      };
      reader.readAsDataURL(file);
    },
    [resetCropperState],
  );

  /** 裁剪确认：调用 saveExpression 保存到主进程，store 同步更新缓存 */
  const handleCropperConfirm = useCallback(
    async (croppedDataUrl: string) => {
      if (!cropperTargetKey || !characterCardId) {
        resetCropperState();
        return;
      }
      const result = await saveExpression(
        characterCardId,
        cropperTargetKey,
        croppedDataUrl,
        cropperIsCustom,
        cropperLabel || undefined,
      );
      if (result.success) {
        message.success('表情已保存');
      } else {
        message.error(result.error || '保存表情失败');
      }
      resetCropperState();
    },
    [
      characterCardId,
      cropperTargetKey,
      cropperIsCustom,
      cropperLabel,
      saveExpression,
      resetCropperState,
    ],
  );

  const handleCropperCancel = useCallback(() => {
    resetCropperState();
  }, [resetCropperState]);

  // ====== 删除流程 ======

  /** 删除单张表情图（预置/自定义通用，不影响 customEmotions 列表） */
  const handleDeleteImage = useCallback(
    (emotionKey: string) => {
      Modal.confirm({
        title: '确认删除',
        content: '确定删除该情绪的表情图片？删除后将回退到默认头像。',
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          if (!characterCardId) return;
          const result = await deleteExpression(characterCardId, emotionKey);
          if (result.success) {
            message.success('表情已删除');
          } else {
            message.error(result.error || '删除表情失败');
          }
        },
      });
    },
    [characterCardId, deleteExpression],
  );

  /** 移除自定义情绪类别（同时删除图像与 customEmotions 条目） */
  const handleRemoveCustomEmotion = useCallback(
    (emotionKey: string) => {
      Modal.confirm({
        title: '移除自定义情绪',
        content: '将删除该情绪及其图片，确定？',
        okText: '移除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          if (!characterCardId) return;
          const result = await removeCustomEmotion(characterCardId, emotionKey);
          if (result.success) {
            message.success('自定义情绪已移除');
          } else {
            message.error(result.error || '移除自定义情绪失败');
          }
        },
      });
    },
    [characterCardId, removeCustomEmotion],
  );

  // ====== 添加自定义情绪 ======

  const handleAddCustomOpen = useCallback(() => {
    setNewCustomLabel('');
    setAddCustomOpen(true);
  }, []);

  const handleAddCustomCancel = useCallback(() => {
    setAddCustomOpen(false);
    setNewCustomLabel('');
  }, []);

  /**
   * 一键添加自定义情绪：
   * 用户仅需输入中文情绪词，系统自动调用 AI 生成英文键 + SD 提示词 + NL 描述并保存。
   * - 校验中文标签非空
   * - 调用 ai.generateEmotionPrompts → 获取 emotionKey + positive + nlPrompt
   * - 校验 emotionKey 格式 + 去重（冲突时追加后缀）
   * - 组装 prompts 并调用 addCustomEmotion 保存
   * - 失败时保持弹窗打开，用户可重试
   */
  const handleAddCustomSubmit = useCallback(async () => {
    const label = newCustomLabel.trim();

    if (!label) {
      message.warning('请输入情绪关键词');
      return;
    }
    if (!characterCardId) return;

    setAutoGenerating(true);
    try {
      // 1. 收集已存在的情绪键（预置 + 自定义），传给 AI 避免冲突
      const existingKeys = [
        ...EMOTION_PRESETS.map((e) => e.key),
        ...(manifest?.customEmotions?.map((e) => e.key) ?? []),
      ];

      // 2. 调用 AI 生成英文键 + SD 提示词 + NL 描述（告知 AI 已占用键）
      const aiResult = await window.electronAPI.ai.generateEmotionPrompts({
        emotionLabel: label,
        existingKeys,
      });

      if (!aiResult?.success || !aiResult.positive || !aiResult.emotionKey) {
        message.error(aiResult?.error || 'AI 生成失败，请重试');
        return;
      }

      // 3. 校验 emotionKey 格式 + 去重（AI 已知避让，此处为二次防御）
      let finalKey = aiResult.emotionKey;
      if (!KEY_PATTERN.test(finalKey)) {
        message.error('AI 生成的英文键格式不合规，请重试');
        return;
      }
      // 二次防御：若仍冲突，追加短数字后缀（极低概率）
      if (EMOTION_PRESETS.some((e) => e.key === finalKey) ||
          manifest?.customEmotions?.some((e) => e.key === finalKey)) {
        let suffix = 2;
        const baseKey = finalKey;
        while (
          EMOTION_PRESETS.some((e) => e.key === `${baseKey}${suffix}`) ||
          manifest?.customEmotions?.some((e) => e.key === `${baseKey}${suffix}`)
        ) {
          suffix++;
        }
        finalKey = `${baseKey}${suffix}`;
        console.warn('[AssetManagerModal] AI key still conflicts after avoidance, using fallback:', finalKey);
      }

      // 3. 组装 prompts 并保存
      const prompts = {
        positive: aiResult.positive,
        nlPrompt: aiResult.nlPrompt || `${label} expression`,
      };

      const result = await addCustomEmotion(characterCardId, finalKey, label, prompts);
      if (result.success) {
        message.success(`自定义情绪已添加（${finalKey}）`);
        setAddCustomOpen(false);
        setNewCustomLabel('');
      } else {
        message.error(result.error || '添加自定义情绪失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加自定义情绪异常');
    } finally {
      setAutoGenerating(false);
    }
  }, [newCustomLabel, characterCardId, manifest, addCustomEmotion]);

  // ====== AI 生成入口（Task 11 接入 AssetGenerateModal） ======

  /**
   * 批量生成：委托父组件打开 AssetGenerateModal（mode='batch-expression'）。
   * 父组件统一持有 AssetGenerateModal 状态，避免在子组件中重复维护。
   */
  const handleBatchGenerate = useCallback(() => {
    if (!characterCardId) {
      message.warning('请先选择角色卡');
      return;
    }
    onBatchGenerate?.();
  }, [characterCardId, onBatchGenerate]);

  /**
   * 单张生成：委托父组件打开 AssetGenerateModal（mode='single-expression' + 目标情绪）。
   * stopPropagation 由调用方在按钮 onClick 中处理。
   */
  const handleSingleGenerate = useCallback(
    (emotionKey: string, label: string) => {
      if (!characterCardId) {
        message.warning('请先选择角色卡');
        return;
      }
      onSingleGenerate?.(emotionKey, label);
    },
    [characterCardId, onSingleGenerate],
  );

  // ====== 渲染辅助 ======

  const customEmotions: CustomEmotion[] = manifest?.customEmotions ?? [];
  const hasCharacter = !!characterCardId;

  // ====== 可预览图片列表（预置 + 自定义情绪中已上传的图片，按显示顺序排列） ======
  const previewableImages = useMemo<PreviewableImage[]>(() => {
    const items: PreviewableImage[] = [];
    for (const e of EMOTION_PRESETS) {
      const isDefault = e.key === 'default';
      const label = isDefault ? '默认（角色卡头像）' : e.label;
      const url = isDefault ? avatarPath : imageCache[e.key];
      if (url) items.push({ url, label });
    }
    for (const e of customEmotions) {
      const url = imageCache[e.key];
      if (url) items.push({ url, label: e.label });
    }
    return items;
  }, [imageCache, customEmotions, avatarPath]);

  /**
   * 渲染单个情绪卡片。
   * - isDefault：default 卡片，仅展示 avatarPath，无上传/删除按钮
   * - isCustom：自定义情绪卡片，额外展示「移除类别」按钮
   * - hasImage：已上传表情图，展示图片 + 删除按钮；否则展示占位 + 上传按钮
   */
  const renderEmotionCard = useCallback(
    (emotionKey: string, label: string, isCustom: boolean, isDefault: boolean) => {
      const imagePath = imageCache[emotionKey];
      const hasImage = !!imagePath;
      // 可预览的图片 URL：默认头像取 avatarPath，已上传情绪取 imagePath，未上传则无（不显示预览覆盖层）
      const previewUrl: string | undefined = isDefault ? avatarPath : hasImage ? imagePath : undefined;

      // 缩略图内容
      let thumbnail: React.ReactNode;
      if (isDefault) {
        thumbnail = avatarPath ? (
          <img
            src={avatarPath}
            alt={label}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: '#cbd5e1', fontSize: 24, fontWeight: 600 }}>
            {characterName.charAt(0).toUpperCase() || '?'}
          </span>
        );
      } else if (hasImage && imagePath) {
        thumbnail = (
          <img
            src={imagePath}
            alt={label}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        );
      } else {
        // 未上传占位：半透明默认头像 + 「未上传」覆盖文字
        thumbnail = (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarPath && (
              <img
                src={avatarPath}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: 0.25,
                  filter: 'grayscale(0.5)',
                }}
              />
            )}
            <span
              style={{
                position: 'absolute',
                color: 'var(--text-secondary, #94a3b8)',
                fontSize: 11,
                background: 'rgba(15, 15, 26, 0.6)',
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              未上传
            </span>
          </div>
        );
      }

      const baseBorder = isDefault
        ? 'var(--primary-color, #6366f1)'
        : 'rgba(255, 255, 255, 0.1)';

      return (
        <div
          key={emotionKey}
          style={{
            border: `1px solid ${baseBorder}`,
            borderRadius: 8,
            padding: 8,
            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.6))',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--primary-color, #6366f1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = baseBorder;
          }}
        >
          {/* 缩略图（正方形，含 hover 预览眼睛图标 - 与其他 Tab 一致） */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: 6,
              overflow: 'hidden',
              background: '#0f0f1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: !hasImage && !isDefault ? '1px dashed rgba(255, 255, 255, 0.15)' : 'none',
            }}
            onMouseEnter={(e) => {
              const overlay = e.currentTarget.querySelector('.thumbnail-hover-overlay') as HTMLElement;
              if (overlay) overlay.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              const overlay = e.currentTarget.querySelector('.thumbnail-hover-overlay') as HTMLElement;
              if (overlay) overlay.style.opacity = '0';
            }}
          >
            {thumbnail}
            {/* hover 预览覆盖层（仅当存在可预览图片时显示，点击打开全尺寸预览 Modal） */}
            {previewUrl && (
              <div
                className="thumbnail-hover-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0, 0, 0, 0.5)',
                  opacity: 0,
                  transition: 'opacity 0.25s ease',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const idx = previewableImages.findIndex(
                    (item) => item.url === previewUrl,
                  );
                  if (idx >= 0) setPreviewIndex(idx);
                }}
              >
                <Tooltip title="预览大图">
                  <Button
                    type="text"
                    icon={<EyeOutlined style={{ fontSize: 22, color: '#fff' }} />}
                    style={{ background: 'transparent' }}
                  />
                </Tooltip>
              </div>
            )}
          </div>

          {/* 标签 + key */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              textAlign: 'center',
              minHeight: 32,
            }}
          >
            <span
              style={{
                color: 'var(--text-primary, #e2e8f0)',
                fontSize: 13,
                fontWeight: 500,
                wordBreak: 'break-word',
                lineHeight: 1.2,
              }}
            >
              {label}
            </span>
            <span style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 10 }}>
              {emotionKey}
            </span>
          </div>

          {/* 操作按钮 */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: 24,
            }}
          >
            {isDefault ? (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary, #6b7280)' }}>
                默认头像
              </span>
            ) : (
              <>
                <Tooltip title="上传表情">
                  <Button
                    size="small"
                    type="text"
                    icon={<UploadOutlined />}
                    onClick={() => handleUploadClick(emotionKey, isCustom, label)}
                    style={{ color: 'var(--primary-color, #6366f1)' }}
                  />
                </Tooltip>
                {/* AI 生成入口（placeholder，Task 11 接入） */}
                <Tooltip title="AI 生成">
                  <Button
                    size="small"
                    type="text"
                    icon={<RobotOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSingleGenerate(emotionKey, label);
                    }}
                    style={{ color: 'var(--primary-color, #6366f1)' }}
                  />
                </Tooltip>
                {hasImage && (
                  <Tooltip title="删除表情">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteImage(emotionKey)}
                    />
                  </Tooltip>
                )}
                {isCustom && (
                  <Tooltip title="移除类别">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<CloseOutlined />}
                      onClick={() => handleRemoveCustomEmotion(emotionKey)}
                    />
                  </Tooltip>
                )}
              </>
            )}
          </div>
        </div>
      );
    },
    [
      imageCache,
      avatarPath,
      characterName,
      handleUploadClick,
      handleDeleteImage,
      handleRemoveCustomEmotion,
      handleSingleGenerate,
    ],
  );

  // 预置情绪卡片（default 单独覆盖标签为「默认（角色卡头像）」）
  const presetCards = EMOTION_PRESETS.map((e) => {
    const isDefault = e.key === 'default';
    const label = isDefault ? '默认（角色卡头像）' : e.label;
    return renderEmotionCard(e.key, label, false, isDefault);
  });

  // 自定义情绪卡片
  const customCards = customEmotions.map((e) =>
    renderEmotionCard(e.key, e.label, true, false),
  );

  return (
    <>
      {/* 顶部说明栏：默认头像预览 + 说明文字 + 添加自定义情绪按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          padding: 12,
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
          borderRadius: 8,
        }}
      >
        {/* 默认头像预览（32x32） */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            border: '1px solid var(--primary-color, #6366f1)',
            background: '#0f0f1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {avatarPath ? (
            <img
              src={avatarPath}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 600 }}>
              {characterName.charAt(0).toUpperCase() || '?'}
            </span>
          )}
        </div>

        {/* 说明文字 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 13 }}>
            为角色上传表情图片，AI 对话时将根据情绪自动切换。
          </div>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11, marginTop: 2 }}>
            未上传的情绪将回退到默认头像。
          </div>
        </div>

        {/* 添加自定义情绪按钮 */}
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAddCustomOpen}
          disabled={!hasCharacter}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            borderColor: 'transparent',
          }}
        >
          添加自定义情绪
        </Button>

        {/* AI 批量生成入口（placeholder，Task 11 接入） */}
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleBatchGenerate}
          disabled={!hasCharacter}
          style={{ marginLeft: 8 }}
        >
          AI 生成全部表情
        </Button>
      </div>

      {/* 错误横幅（store.error） */}
      {storeError && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 12,
          }}
        >
          {storeError}
        </div>
      )}

      {/* 主体内容 */}
      {!hasCharacter ? (
        <Empty description="未选择角色卡，无法管理表情" />
      ) : loading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 0',
          }}
        >
          <Spin size="large" />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            加载中...
          </span>
        </div>
      ) : (
        <>
          {/* 预置情绪网格 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 12,
            }}
          >
            {presetCards}
          </div>

          {/* 自定义情绪分区（仅当存在自定义情绪时显示） */}
          {customEmotions.length > 0 && (
            <>
              <div
                style={{
                  margin: '20px 0 12px',
                  color: 'var(--text-secondary, #94a3b8)',
                  fontSize: 13,
                  fontWeight: 500,
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingBottom: 6,
                }}
              >
                自定义情绪
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 12,
                }}
              >
                {customCards}
              </div>
            </>
          )}
        </>
      )}

      {/* 隐藏的 file input（由 handleUploadClick 触发 click） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* 图片裁剪弹窗（始终挂载，由 cropperOpen 控制可见） */}
      <ImageCropperModal
        open={cropperOpen}
        imageSrc={cropperImageSrc}
        onConfirm={handleCropperConfirm}
        onCancel={handleCropperCancel}
      />

      {/* 添加自定义情绪弹窗（简化流程：用户仅输入中文词，AI 自动生成全部字段） */}
      <Modal
        title="添加自定义情绪"
        open={addCustomOpen}
        onCancel={autoGenerating ? undefined : handleAddCustomCancel}
        onOk={handleAddCustomSubmit}
        confirmLoading={autoGenerating}
        okText="添加"
        cancelText="取消"
        width={480}
        maskClosable={!autoGenerating}
        keyboard={!autoGenerating}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: 6,
                fontSize: 12,
                color: 'var(--text-secondary, #94a3b8)',
              }}
            >
              情绪关键词（中文）
            </label>
            <Input
              value={newCustomLabel}
              onChange={(e) => setNewCustomLabel(e.target.value)}
              placeholder="如 热恋、得意、害羞"
              autoFocus
              disabled={autoGenerating}
              onPressEnter={handleAddCustomSubmit}
            />
          </div>

          {autoGenerating && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Spin tip="AI 正在生成情绪提示词..." />
            </div>
          )}

          {!autoGenerating && (
            <div style={{ padding: '8px 12px', background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.6))', borderRadius: 4, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
              点击"添加"后，系统将自动调用 AI 生成英文键名、SD 提示词和自然语言描述，无需手动输入。
            </div>
          )}
        </div>
      </Modal>

      {/* 全尺寸预览弹窗（支持上一张/下一张导航） */}
      <ImagePreviewModal
        images={previewableImages}
        index={previewIndex}
        onChange={setPreviewIndex}
      />
    </>
  );
};

// ==================== 子组件：AssetCard（SubTask 3.2 / Task 9.2 — React.memo 包装的单张素材卡片） ====================

interface AssetCardProps {
  /** 素材 id（唯一 key） */
  assetId: string;
  /** 素材图片 data URL（未加载完成时为 undefined；用于 hover 预览全尺寸 + 设为角色卡图片） */
  dataUrl: string | undefined;
  /**
   * LazyImage 的 src（Task 6.1 集成）：
   * - 优先传「磁盘绝对路径」→ LazyImage 走 thumbnail:get IPC 取压缩缩略图（推荐）
   * - 路径解析中或不可用时传 dataUrl → LazyImage 检测 data: 前缀直接渲染（回退，不缩略图化）
   * - 空字符串 → 显示占位（等待 src 就绪）
   */
  imagePath: string;
  /** 素材类型（仅 'illustration' 显示「设为角色卡图片」按钮） */
  assetType: AssetType;
  /** 是否正处于「替换角色卡图片」loading（影响立绘 Tab 的 SwapOutlined 按钮 loading） */
  replacingCardImage: boolean;
  /** 点击缩略图 hover 眼睛图标 → 打开全尺寸预览 */
  onPreview: (dataUrl: string) => void;
  /** 删除按钮回调 */
  onDelete: (assetId: string) => void;
  /** 「设为角色卡图片」回调（仅 illustration Tab 传入） */
  onReplaceCardImage?: (dataUrl: string) => void;
}

/**
 * 单张素材卡片（立绘 / 一般图像通用）。
 *
 * 从原 AssetGridTabContent 的 inline .map() 回调抽取（SubTask 3.2 / Task 9.2）：
 * - React.memo 包装：父级 re-render 时仅当 props 浅比较不等才重渲染
 * - 所有 handler（onPreview / onDelete / onReplaceCardImage）由父级以 useCallback 稳定传入，
 *   dataUrl / replacingCardImage / imagePath 为基本类型，浅比较即可判定是否需要更新
 * - 网格缩略图改用 <LazyImage>（Task 6.1）：走 thumbnail:get IPC 取压缩缩略图，
 *   滚动进入视口时懒加载，替代原先直显全尺寸 dataUrl 的 <img>，缓解滚动卡顿。
 *   hover 眼睛预览 / 设为角色卡图片 仍使用全尺寸 dataUrl（不缩略图化）。
 * - 保留全部原有交互：hover 边框高亮、缩略图 hover 眼睛预览、删除按钮、立绘「设为角色卡图片」按钮
 */
const AssetCard = React.memo(
  ({
    assetId,
    dataUrl,
    imagePath,
    assetType,
    replacingCardImage,
    onPreview,
    onDelete,
    onReplaceCardImage,
  }: AssetCardProps) => {
    return (
      <div
        style={{
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: 8,
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.6))',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          transition: 'border-color 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--primary-color, #6366f1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}
      >
        {/* 缩略图容器（含 hover 预览眼睛图标 - Task 3） */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '3 / 4',
            borderRadius: 6,
            overflow: 'hidden',
            background: '#0f0f1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            // hover 时显示预览眼睛图标覆盖层
            const overlay = e.currentTarget.querySelector('.thumbnail-hover-overlay') as HTMLElement;
            if (overlay) overlay.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            const overlay = e.currentTarget.querySelector('.thumbnail-hover-overlay') as HTMLElement;
            if (overlay) overlay.style.opacity = '0';
          }}
        >
          {/* 缩略图（Task 6.1：LazyImage 走 thumbnail:get IPC 取压缩缩略图）。
              imagePath 优先为磁盘绝对路径 → 缩略图化；为 dataUrl 时 LazyImage 直接渲染（回退）；
              为空字符串时 LazyImage 显示占位（路径异步解析中或 dataUrl 未就绪）。
              原先此处直显全尺寸 dataUrl 的 <img> 已替换，避免大图解码拖累滚动。 */}
          <LazyImage src={imagePath} alt={assetId} size={256} />
          {/* hover 预览覆盖层（Task 3：眼睛图标平滑显示）。
              仍使用全尺寸 dataUrl（非缩略图），仅在 dataUrl 就绪时渲染；
              点击眼睛 → onPreview 打开全尺寸预览 Modal。 */}
          {dataUrl && (
            <div
              className="thumbnail-hover-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.5)',
                opacity: 0,
                transition: 'opacity 0.25s ease',
                cursor: 'pointer',
              }}
              onClick={() => onPreview(dataUrl)}
            >
              <Tooltip title="预览大图">
                <Button
                  type="text"
                  icon={<EyeOutlined style={{ fontSize: 22, color: '#fff' }} />}
                  style={{ background: 'transparent' }}
                />
              </Tooltip>
            </div>
          )}
        </div>
        {/* 操作按钮区（Task 2：立绘增加「设为角色卡图片」按钮） */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 4,
            minHeight: 24,
          }}
        >
          {assetType === 'illustration' && dataUrl && onReplaceCardImage && (
            <Tooltip title="设为角色卡图片">
              <Button
                size="small"
                type="text"
                icon={<SwapOutlined />}
                onClick={() => onReplaceCardImage(dataUrl)}
                loading={replacingCardImage}
                style={{ color: 'var(--primary-color, #6366f1)' }}
              />
            </Tooltip>
          )}
          <Tooltip title="删除">
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(assetId)}
            />
          </Tooltip>
        </div>
      </div>
    );
  },
);
AssetCard.displayName = 'AssetCard';

// ==================== 子组件：AssetVirtualGrid（SubTask 3.1 — 网格虚拟化） ====================

/**
 * 启用虚拟化的素材数阈值。
 *
 * 低于此值走原 .map() 渲染路径（无虚拟化开销），与 VirtualizedMessageList 的
 * VIRTUALIZATION_THRESHOLD=50 对齐。50 张以下素材直接渲染无明显卡顿；
 * 超过 50 张时虚拟化收益显著（100+ 张滚动从 1-2s 降至 ≤100ms）。
 */
const ASSET_VIRTUALIZATION_THRESHOLD = 50;

/** 网格最小列宽（与原 minmax(160px, 1fr) 视觉一致） */
const ASSET_GRID_MIN_COLUMN_WIDTH = 160;

/** 网格列间距 / 行间距（与原 gap: 12 一致） */
const ASSET_GRID_GAP = 12;

/** 虚拟化 overscan 行数（可视区上下各缓冲 4 行，平滑滚动） */
const ASSET_GRID_OVERSCAN = 4;
// 注（Task 8.2 预加载决策 - 最小实现优先）：相邻行缩略图的预加载依赖 LazyImage 自身的
// IntersectionObserver rootMargin=200px 提前触发 thumbnail:get IPC，未额外做「投机性预取
// 下一 overscan 行」的 IPC 调用。原因：LazyImage 的 rootMargin 预加载已覆盖滚动方向的
// 提前加载需求，额外投机预取会增加 IPC 噪声与状态管理复杂度，收益有限。

/** 行高预估值（粗估：160px 宽卡 = 图片 213px + padding/按钮 ~47px ≈ 260px；measureElement 会校正实际值） */
const ASSET_GRID_ROW_ESTIMATE = 260;

/** 容器宽度未测量时的兜底列数（首帧使用，ResizeObserver 触发后立即重算） */
const ASSET_GRID_FALLBACK_COLUMNS = 3;

interface AssetVirtualGridProps {
  /** 素材 id 列表（按显示顺序） */
  assetIds: string[];
  /** 渲染单个卡片（接收 assetId，返回 ReactNode） */
  renderCard: (assetId: string) => React.ReactNode;
}

/**
 * 素材网格虚拟化容器（Spec: optimize-system-rendering-performance / Task 3）。
 *
 * 采用「行虚拟化 + 行内多列」模式（grid virtualization）：
 * - 根据滚动容器宽度计算列数 columns = floor((width+gap)/(minColWidth+gap))，至少 1 列
 *   （与原 CSS `repeat(auto-fill, minmax(160px, 1fr))` 视觉等价）
 * - 虚拟化器以「行」为单位：count = ceil(assetIds.length / columns)
 * - 每个虚拟行内用 CSS grid 排布 columns 张卡片
 * - estimateSize 粗估行高，measureElement 动态校正（卡宽随容器变化时高度自适应）；
 *   卡片高度由 aspectRatio: 3/4 决定，同一行内高度一致
 * - overscan=4 平滑滚动
 * - assetIds.length < ASSET_VIRTUALIZATION_THRESHOLD(50) 时回退为原 .map() 渲染
 *
 * 模式来源：src/renderer/components/Character/CharacterDialogueChat/VirtualizedMessageList.tsx
 * （@tanstack/react-virtual v3 动态高度虚拟化），改造为网格多列。
 *
 * 滚动容器：组件自身持有 overflowY:auto 的 div（maxHeight 限制视口高度），
 * 不依赖父级 Modal body 滚动，保证虚拟化器 getScrollElement 稳定可用。
 */
const AssetVirtualGrid: React.FC<AssetVirtualGridProps> = ({ assetIds, renderCard }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // 初始测量 + ResizeObserver 监听容器宽度变化（用于计算列数）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth(); // 首帧同步测量（useEffect 在 paint 后执行，下一帧修正为准确列数）
    if (typeof ResizeObserver === 'undefined') return; // SSR / 非浏览器环境降级
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 列数：容器未测量时用兜底值，测量后按宽度计算（与原 minmax(160px,1fr) 视觉一致）
  const columns = containerWidth === 0
    ? ASSET_GRID_FALLBACK_COLUMNS
    : Math.max(
        1,
        Math.floor((containerWidth + ASSET_GRID_GAP) / (ASSET_GRID_MIN_COLUMN_WIDTH + ASSET_GRID_GAP)),
      );

  // 行数：总素材数按列数上取整
  const rowCount = Math.ceil(assetIds.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ASSET_GRID_ROW_ESTIMATE,
    overscan: ASSET_GRID_OVERSCAN,
    // 动态测量行高（卡宽随容器变化时自动校正）；Firefox 降级用 estimate（与 VirtualizedMessageList 一致）
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element.getBoundingClientRect().height
        : undefined,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // 阈值回退：< 50 张走原 .map() 路径（避免短列表虚拟化开销）
  if (assetIds.length < ASSET_VIRTUALIZATION_THRESHOLD) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: ASSET_GRID_GAP,
        }}
      >
        {assetIds.map((id) => renderCard(id))}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="asset-grid-scroll"
      style={{
        overflowY: 'auto',
        // 滚动容器最大高度：Modal 模式下 Modal body 自身有 maxHeight，
        // 此处给网格独立滚动区，预留 modal header(~55) + tab bar(~46) + toolbar(~80) + 间距，约 280px
        maxHeight: 'calc(100vh - 280px)',
        minHeight: 200,
        paddingRight: 4,
      }}
    >
      <div style={{ height: totalSize, width: '100%', position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const startIndex = virtualItem.index * columns;
          const rowIds = assetIds.slice(startIndex, startIndex + columns);
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: ASSET_GRID_GAP,
                  // 行间距：每行底部留 gap，与原 grid gap 视觉一致
                  paddingBottom: ASSET_GRID_GAP,
                }}
              >
                {rowIds.map((id) => renderCard(id))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==================== 子组件：AssetGridTabContent ====================

interface AssetGridTabContentProps {
  characterCardId: string;
  assetType: AssetType;
  /** Tab 显示名称（如「角色立绘」「一般图像」），用于空状态文案与提示 */
  tabLabel: string;
  /** assetId 前缀（如 'ill' / 'gen'），用于生成唯一 id */
  idPrefix: string;
  /** AI 生成入口（Task 11 接入 AssetGenerateModal） */
  onAIGenerate?: () => void;
  /**
   * 角色卡图片替换回调（仅 illustration Tab 使用）。
   * 用户点击「设为角色卡图片」并确认后，通过此回调通知父组件（CharacterEditModal）
   * 更新 uploadedImage 预览，避免编辑弹窗中显示旧图片。
   * 参数为新图片的 data URL（含 data:image/png;base64, 前缀）。
   */
  onCardImageReplaced?: (newImageDataUrl: string) => void;
}

/**
 * 素材网格 Tab 内容（Spec: add-asset-and-trait-management / Task 9.3）
 *
 * 用于「角色立绘」「一般图像」两个 Tab。
 * - 素材网格：从 assetStore.manifests[assetType] 读取 assets，展示缩略图
 *   （从 imageCache[assetType][assetId] 读取 data URL）
 * - 上传按钮：file input → FileReader → ImageCropperModal → assetStore.saveAsset
 *   - assetId 生成：`{idPrefix}_{Date.now()}_{random}`
 * - 删除按钮：Modal.confirm → assetStore.deleteAsset
 * - AI 生成按钮：placeholder（Task 11 接入 AssetGenerateModal）
 * - 空状态：显示「尚未上传{tabLabel}」+ 上传按钮
 *
 * assetType 参数化：立绘 Tab 传 'illustration'，一般图像 Tab 传 'general'
 */
const AssetGridTabContent: React.FC<AssetGridTabContentProps> = ({
  characterCardId,
  assetType,
  tabLabel,
  idPrefix,
  onAIGenerate,
  onCardImageReplaced,
}) => {
  // TODO(perf): 整体订阅，待拆分为 selector（6 字段，>5 暂缓）
  const {
    manifests,
    imageCache,
    loading,
    loadAssets,
    saveAsset,
    deleteAsset,
  } = useAssetStore();

  // store.error 单独订阅，用于渲染 inline 错误横幅
  const storeError = useAssetStore((s) => s.error);

  // ====== 裁剪弹窗状态 ======
  const [cropperOpen, setCropperOpen] = useState<boolean>(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);

  // ====== 全尺寸预览状态（Task 3：缩略图 hover 眼睛图标预览） ======
  // 支持上一张/下一张导航：previewIndex 跟踪当前预览位置，-1 = 关闭
  const [previewIndex, setPreviewIndex] = useState<number>(-1);

  // ====== 角色卡图片替换状态（Task 2：立绘替换角色卡原图） ======
  const [replacingCardImage, setReplacingCardImage] = useState<boolean>(false);

  // 隐藏的 file input ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ====== 数据计算（提前到 handlers 之前，因 handlePreview 依赖 previewableImages） ======
  const manifest = manifests[assetType];
  const typeImageCache = imageCache[assetType] || {};
  const assetIds = manifest ? Object.keys(manifest.assets) : [];

  // ====== 可预览图片列表（当前 assetType 下所有已上传的素材，按 assetIds 顺序） ======
  const previewableImages = useMemo<PreviewableImage[]>(() => {
    return assetIds
      .map((id, i) => {
        const url = typeImageCache[id];
        return url ? { url, label: `${tabLabel} ${i + 1}` } : null;
      })
      .filter((item): item is PreviewableImage => item !== null);
  }, [assetIds, typeImageCache, tabLabel]);

  // ====== 打开 Tab 时加载素材（顶层 AssetManagerModal 已统一加载，此处兜底） ======
  useEffect(() => {
    if (characterCardId) {
      loadAssets(characterCardId, assetType);
    }
  }, [characterCardId, assetType, loadAssets]);

  // ====== 解析素材磁盘绝对路径（Task 6.1 / 8.1 集成） ======
  // assetStore 仅缓存 dataUrl（CSP 兼容设计，不存磁盘路径），但 LazyImage 需要磁盘路径
  // 才能走 thumbnail:get IPC 取压缩缩略图。此处通过已有的 asset.getImagePath IPC 重新解析
  // （仅路径构造 + existsSync，无文件读取，开销极低），结果缓存到本地 state。
  // getImagePath 与 assetStore.loadAssets 内部的调用存在冗余，但该 IPC 为纯路径操作，
  // 且仅 assetIds 变化时触发一次（并行），可接受；不可修改 assetStore（Task 6 约束）。
  const [imagePaths, setImagePaths] = useState<Record<string, string>>({});
  const [pathsResolved, setPathsResolved] = useState(false);
  // assetIds 每次 render 都是新数组引用（Object.keys），用 join 串作稳定依赖键
  const assetIdsKey = assetIds.join('\n');
  useEffect(() => {
    let cancelled = false;
    setPathsResolved(false);
    if (!characterCardId || assetIds.length === 0) {
      setImagePaths({});
      setPathsResolved(true);
      return;
    }
    (async () => {
      const entries = await Promise.all(
        assetIds.map(async (id) => {
          try {
            const r = await window.electronAPI.asset.getImagePath({
              characterCardId,
              assetType,
              assetId: id,
            });
            return [id, r?.success && r.imagePath ? r.imagePath : ''] as const;
          } catch {
            return [id, ''] as const;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, p] of entries) {
        if (p) map[id] = p;
      }
      setImagePaths(map);
      setPathsResolved(true);
    })();
    return () => {
      cancelled = true;
    };
    // 依赖 assetIdsKey（稳定串）+ characterCardId + assetType；assetIds 不直接入依赖避免每 render 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterCardId, assetType, assetIdsKey]);

  // ====== 重置裁剪状态 ======
  const resetCropperState = useCallback(() => {
    setCropperOpen(false);
    setCropperImageSrc(null);
  }, []);

  // ====== 上传流程 ======
  const handleUploadClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setCropperImageSrc(dataUrl);
        setCropperOpen(true);
      };
      reader.onerror = () => {
        message.error('读取图片文件失败');
        resetCropperState();
      };
      reader.readAsDataURL(file);
    },
    [resetCropperState],
  );

  const handleCropperConfirm = useCallback(
    async (croppedDataUrl: string) => {
      if (!characterCardId) {
        resetCropperState();
        return;
      }
      // 生成唯一 assetId：前缀 + 时间戳 + 随机数
      const assetId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await saveAsset({
        characterCardId,
        assetType,
        assetId,
        imageBase64: croppedDataUrl,
      });
      if (result.success) {
        message.success(`${tabLabel}已保存`);
      } else {
        message.error(result.error || `保存${tabLabel}失败`);
      }
      resetCropperState();
    },
    [characterCardId, assetType, idPrefix, tabLabel, saveAsset, resetCropperState],
  );

  const handleCropperCancel = useCallback(() => {
    resetCropperState();
  }, [resetCropperState]);

  // ====== 删除流程 ======
  const handleDeleteAsset = useCallback(
    (assetId: string) => {
      Modal.confirm({
        title: '确认删除',
        content: `确定删除该${tabLabel}？此操作不可撤销。`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          if (!characterCardId) return;
          const result = await deleteAsset({ characterCardId, assetType, assetId });
          if (result.success) {
            message.success(`${tabLabel}已删除`);
          } else {
            message.error(result.error || `删除${tabLabel}失败`);
          }
        },
      });
    },
    [characterCardId, assetType, tabLabel, deleteAsset],
  );

  // ====== 全尺寸预览（Task 3：缩略图 hover 眼睛图标 → 点击打开预览 Modal） ======
  // 支持上一张/下一张：通过 URL 在 previewableImages 中查找索引
  const handlePreview = useCallback(
    (dataUrl: string) => {
      const idx = previewableImages.findIndex((item) => item.url === dataUrl);
      if (idx >= 0) setPreviewIndex(idx);
    },
    [previewableImages],
  );

  // ====== 角色卡图片替换（Task 2：立绘设为角色卡原图） ======
  // 【重点标记 - 确认机制防误操作】
  // 流程：Modal.confirm 警告 → 读取角色卡 JSON → 剥离 data URI 前缀 →
  //       createFromImage 重建 PNG（新图 + 原 JSON）→ 失效缓存 → 回调父组件
  const handleReplaceCardImage = useCallback(
    (dataUrl: string) => {
      if (!characterCardId) {
        message.warning('未指定角色卡');
        return;
      }

      Modal.confirm({
        title: '设为角色卡图片',
        content:
          '将使用此立绘替换角色卡的原始图片（PNG 载体）。角色卡的角色数据（描述、个性等）会保留不变，仅替换基底图片。此操作不可撤销，确定继续？',
        okText: '确认替换',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          setReplacingCardImage(true);
          try {
            // 1. 读取角色卡当前 JSON 内容（保留元数据，仅替换图片载体）
            const content = await window.electronAPI.character.read(characterCardId);
            if (!content) {
              message.error('读取角色卡数据失败');
              return;
            }

            // 2. 剥离 data URI 前缀，提取纯 base64
            const commaIndex = dataUrl.indexOf(',');
            if (commaIndex === -1) {
              message.error('图片数据格式错误');
              return;
            }
            const base64String = dataUrl.substring(commaIndex + 1);

            // 3. 调用 createFromImage 重建 PNG（新图片 + 原 JSON 元数据）
            const result = await window.electronAPI.character.createFromImage(
              characterCardId,
              base64String,
              content,
            );

            if (!result?.success) {
              message.error(result?.error || '替换角色卡图片失败');
              return;
            }

            // 4. 失效缩略图/头像缓存，使各处显示新图片
            invalidateCharacterImageCache(characterCardId);

            // 5. 回调父组件更新预览（CharacterEditModal 的 uploadedImage）
            onCardImageReplaced?.(dataUrl);

            message.success('角色卡图片已替换');
          } catch (e) {
            console.error('[AssetGridTabContent] replaceCardImage error:', e);
            message.error(e instanceof Error ? e.message : '替换角色卡图片失败');
          } finally {
            setReplacingCardImage(false);
          }
        },
      });
    },
    [characterCardId, onCardImageReplaced],
  );

  // ====== AI 生成入口（Task 11 接入 AssetGenerateModal） ======
  const handleAIGenerate = useCallback(() => {
    if (!characterCardId) {
      message.warning('请先选择角色卡');
      return;
    }
    onAIGenerate?.();
  }, [characterCardId, onAIGenerate]);

  // ====== 单张卡片渲染（SubTask 3.2：useCallback 稳定引用，配合 AssetCard React.memo） ======
  // 依赖 typeImageCache（图片加载完成后 dataUrl 变化需重渲染对应卡片）、replacingCardImage（loading 状态）、
  // 以及 useCallback 稳定的 handler（handlePreview / handleDeleteAsset / handleReplaceCardImage）。
  // AssetCard 内部 React.memo 浅比较 props，仅 dataUrl / replacingCardImage / imagePath 变化时才重渲染对应卡片。
  //
  // imagePath（LazyImage 的 src）取值优先级（Task 6.1）：
  //   1. imagePaths[assetId] —— 已解析的磁盘绝对路径 → LazyImage 走 thumbnail:get IPC（推荐，缩略图化）
  //   2. pathsResolved && dataUrl —— 路径解析完成但未拿到（文件缺失等）且有 dataUrl → 回退为 dataUrl
  //      LazyImage 检测 data: 前缀后直接渲染（不缩略图化，dataUrl-only 回退场景）
  //   3. 路径解析中（!pathsResolved）且有 dataUrl —— 为避免「先全尺寸再缩略图」闪烁，传空串显示占位
  //   4. 其余 —— 空串（占位）
  // 滚动时路径已解析，命中分支 1 走缩略图；仅首次进入 Tab 可能短暂占位。
  const renderCard = useCallback(
    (assetId: string) => {
      const dataUrl = typeImageCache[assetId];
      const resolvedPath = imagePaths[assetId];
      const imagePath =
        resolvedPath ||
        (pathsResolved && dataUrl ? dataUrl : '');
      return (
        <AssetCard
          key={assetId}
          assetId={assetId}
          dataUrl={dataUrl}
          imagePath={imagePath}
          assetType={assetType}
          replacingCardImage={replacingCardImage}
          onPreview={handlePreview}
          onDelete={handleDeleteAsset}
          onReplaceCardImage={assetType === 'illustration' ? handleReplaceCardImage : undefined}
        />
      );
    },
    [
      typeImageCache,
      assetType,
      replacingCardImage,
      imagePaths,
      pathsResolved,
      handlePreview,
      handleDeleteAsset,
      handleReplaceCardImage,
    ],
  );

  // ====== 渲染 ======
  const hasCharacter = !!characterCardId;

  return (
    <>
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          padding: 12,
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
          borderRadius: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 13 }}>
            管理角色的{tabLabel}素材，可上传本地图片或使用 AI 生成。
          </div>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11, marginTop: 2 }}>
            已上传 {assetIds.length} 张{tabLabel}。
          </div>
        </div>

        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          disabled={!hasCharacter}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            borderColor: 'transparent',
          }}
        >
          上传{tabLabel}
        </Button>

        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleAIGenerate}
          disabled={!hasCharacter}
        >
          AI 生成{tabLabel}
        </Button>
      </div>

      {/* 错误横幅 */}
      {storeError && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 12,
          }}
        >
          {storeError}
        </div>
      )}

      {/* 主体内容 */}
      {!hasCharacter ? (
        <Empty description="未选择角色卡，无法管理素材" />
      ) : loading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 0',
          }}
        >
          <Spin size="large" />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            加载中...
          </span>
        </div>
      ) : assetIds.length === 0 ? (
        <Empty description={`尚未上传${tabLabel}`}>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={handleUploadClick}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              borderColor: 'transparent',
            }}
          >
            上传第一张{tabLabel}
          </Button>
        </Empty>
      ) : (
        // SubTask 3.1：素材网格虚拟化（assetIds.length >= 50 时启用 useVirtualizer，否则回退 .map()）
        // AssetCard 由 renderCard 生成（React.memo + useCallback 稳定 props，SubTask 3.2）
        <AssetVirtualGrid assetIds={assetIds} renderCard={renderCard} />
      )}

      {/* 隐藏的 file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* 图片裁剪弹窗 */}
      <ImageCropperModal
        open={cropperOpen}
        imageSrc={cropperImageSrc}
        onConfirm={handleCropperConfirm}
        onCancel={handleCropperCancel}
      />

      {/* 全尺寸预览弹窗（支持上一张/下一张导航） */}
      <ImagePreviewModal
        images={previewableImages}
        index={previewIndex}
        onChange={setPreviewIndex}
      />
    </>
  );
};

// ==================== 子组件：ThreeViewTabContent ====================

interface ThreeViewTabContentProps {
  characterCardId: string;
  /** AI 生成入口，参数为槽位（Task 11 接入 AssetGenerateModal） */
  onAIGenerate?: (slot: ThreeViewSlot) => void;
}

/**
 * 三视图 Tab 内容（Spec: add-asset-and-trait-management / Task 9.4）
 *
 * 三个固定槽位：正面（front）/ 侧面（side）/ 背面（back）
 * - 每个槽位独立展示：有图显示缩略图 + 删除按钮；无图显示占位 + 上传按钮 + AI 生成按钮
 * - 上传流程：ImageCropperModal → assetStore.saveAsset({assetType: 'three-view', assetId: slot, slot})
 * - 删除流程：assetStore.deleteAsset({assetType: 'three-view', assetId: slot})
 * - 三个槽位互不影响
 */
const ThreeViewTabContent: React.FC<ThreeViewTabContentProps> = ({
  characterCardId,
  onAIGenerate,
}) => {
  const imageCache = useAssetStore(s => s.imageCache);
  const loading = useAssetStore(s => s.loading);
  const loadAssets = useAssetStore(s => s.loadAssets);
  const saveAsset = useAssetStore(s => s.saveAsset);
  const deleteAsset = useAssetStore(s => s.deleteAsset);

  // store.error 单独订阅
  const storeError = useAssetStore((s) => s.error);

  const assetType: AssetType = 'three-view';

  // ====== 裁剪弹窗状态 ======
  const [cropperOpen, setCropperOpen] = useState<boolean>(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  /** 当前正在上传的槽位 */
  const [cropperTargetSlot, setCropperTargetSlot] = useState<ThreeViewSlot | null>(null);

  // ====== 全尺寸预览状态（Task 3：缩略图 hover 眼睛图标预览） ======
  // 支持上一张/下一张导航：previewIndex 跟踪当前预览位置，-1 = 关闭
  const [previewIndex, setPreviewIndex] = useState<number>(-1);

  // 隐藏的 file input ref（共享，每次点击时记录目标 slot）
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ====== 打开 Tab 时加载三视图（顶层 AssetManagerModal 已统一加载，此处兜底） ======
  useEffect(() => {
    if (characterCardId) {
      loadAssets(characterCardId, assetType);
    }
  }, [characterCardId, loadAssets]);

  // ====== 重置裁剪状态 ======
  const resetCropperState = useCallback(() => {
    setCropperOpen(false);
    setCropperImageSrc(null);
    setCropperTargetSlot(null);
  }, []);

  // ====== 上传流程 ======
  const handleUploadClick = useCallback((slot: ThreeViewSlot) => {
    setCropperTargetSlot(slot);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setCropperImageSrc(dataUrl);
        setCropperOpen(true);
      };
      reader.onerror = () => {
        message.error('读取图片文件失败');
        resetCropperState();
      };
      reader.readAsDataURL(file);
    },
    [resetCropperState],
  );

  const handleCropperConfirm = useCallback(
    async (croppedDataUrl: string) => {
      if (!characterCardId || !cropperTargetSlot) {
        resetCropperState();
        return;
      }
      // assetId 直接使用 slot 名（'front'/'side'/'back'），保持三视图槽位固定
      // 保存时同时透传 slot 字段，供主进程 manifest 记录
      const result = await saveAsset({
        characterCardId,
        assetType,
        assetId: cropperTargetSlot,
        imageBase64: croppedDataUrl,
        slot: cropperTargetSlot,
      });
      if (result.success) {
        message.success('三视图已保存');
      } else {
        message.error(result.error || '保存三视图失败');
      }
      resetCropperState();
    },
    [characterCardId, cropperTargetSlot, assetType, saveAsset, resetCropperState],
  );

  const handleCropperCancel = useCallback(() => {
    resetCropperState();
  }, [resetCropperState]);

  // ====== 删除流程 ======
  const handleDeleteSlot = useCallback(
    (slot: ThreeViewSlot, label: string) => {
      Modal.confirm({
        title: '确认删除',
        content: `确定删除${label}视图？此操作不可撤销。`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          if (!characterCardId) return;
          const result = await deleteAsset({ characterCardId, assetType, assetId: slot });
          if (result.success) {
            message.success('三视图已删除');
          } else {
            message.error(result.error || '删除三视图失败');
          }
        },
      });
    },
    [characterCardId, assetType, deleteAsset],
  );

  // ====== AI 生成入口（Task 11 接入 AssetGenerateModal） ======
  const handleAIGenerate = useCallback(
    (slot: ThreeViewSlot) => {
      if (!characterCardId) {
        message.warning('请先选择角色卡');
        return;
      }
      onAIGenerate?.(slot);
    },
    [characterCardId, onAIGenerate],
  );

  // ====== 渲染 ======
  // 注：三视图通过固定 slot（front/side/back）直接查 imageCache，无需读 manifest
  const typeImageCache = imageCache[assetType] || {};
  const hasCharacter = !!characterCardId;

  // ====== 可预览图片列表（三视图 6 个槽位中已上传的图片：穿衣 3 + 裸体 3） ======
  const previewableImages = useMemo<PreviewableImage[]>(() => {
    return THREE_VIEW_SLOTS
      .map(({ slot, label }) => {
        const url = typeImageCache[slot];
        return url ? { url, label } : null;
      })
      .filter((item): item is PreviewableImage => item !== null);
  }, [typeImageCache]);

  const renderSlot = (slot: ThreeViewSlot, label: string) => {
    const dataUrl = typeImageCache[slot];
    const hasImage = !!dataUrl;

    return (
      <div
        key={slot}
        style={{
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: 12,
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.6))',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'center',
          transition: 'border-color 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--primary-color, #6366f1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}
      >
        <div
          style={{
            color: 'var(--text-primary, #e2e8f0)',
            fontSize: 14,
            fontWeight: 500,
            alignSelf: 'flex-start',
          }}
        >
          {label}
        </div>

        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '3 / 4',
            borderRadius: 6,
            overflow: 'hidden',
            background: '#0f0f1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: !hasImage ? '1px dashed rgba(255, 255, 255, 0.15)' : 'none',
          }}
          onMouseEnter={(e) => {
            // hover 时显示预览眼睛图标覆盖层（Task 3）
            const overlay = e.currentTarget.querySelector('.thumbnail-hover-overlay') as HTMLElement;
            if (overlay) overlay.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            const overlay = e.currentTarget.querySelector('.thumbnail-hover-overlay') as HTMLElement;
            if (overlay) overlay.style.opacity = '0';
          }}
        >
          {hasImage && dataUrl ? (
            <>
              <img
                src={dataUrl}
                alt={label}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {/* hover 预览覆盖层（Task 3：眼睛图标平滑显示） */}
              <div
                className="thumbnail-hover-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0, 0, 0, 0.5)',
                  opacity: 0,
                  transition: 'opacity 0.25s ease',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const idx = previewableImages.findIndex(
                    (item) => item.url === dataUrl,
                  );
                  if (idx >= 0) setPreviewIndex(idx);
                }}
              >
                <Tooltip title="预览大图">
                  <Button
                    type="text"
                    icon={<EyeOutlined style={{ fontSize: 22, color: '#fff' }} />}
                    style={{ background: 'transparent' }}
                  />
                </Tooltip>
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 12 }}>
              未上传
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            size="small"
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => handleUploadClick(slot)}
            disabled={!hasCharacter}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              borderColor: 'transparent',
            }}
          >
            上传
          </Button>
          <Button
            size="small"
            icon={<RobotOutlined />}
            onClick={() => handleAIGenerate(slot)}
            disabled={!hasCharacter}
          >
            AI 生成
          </Button>
          {hasImage && (
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteSlot(slot, label)}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* 顶部说明栏 */}
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
          borderRadius: 8,
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: 13,
        }}
      >
        上传角色的三视图（正面/侧面/背面），用于 AI 生成时保持角色一致性。每个槽位独立上传与删除，互不影响。
      </div>

      {/* 错误横幅 */}
      {storeError && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 12,
          }}
        >
          {storeError}
        </div>
      )}

      {!hasCharacter ? (
        <Empty description="未选择角色卡，无法管理三视图" />
      ) : loading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 0',
          }}
        >
          <Spin size="large" />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            加载中...
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 穿衣版三视图 */}
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
                color: 'var(--text-primary, #e2e8f0)',
                borderLeft: '3px solid var(--primary-color, #6366f1)',
                paddingLeft: 8,
              }}
            >
              穿衣版
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
              }}
            >
              {THREE_VIEW_SLOTS.filter((s) => !s.nude).map(({ slot, label }) =>
                renderSlot(slot, label),
              )}
            </div>
          </div>
          {/* 裸体版三视图（生成时自动过滤上装/下装/内衣分类特征，配饰保留） */}
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
                color: 'var(--text-primary, #e2e8f0)',
                borderLeft: '3px solid #ec4899',
                paddingLeft: 8,
              }}
            >
              裸体版
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'var(--text-secondary, #94a3b8)',
                  marginLeft: 8,
                }}
              >
                生成时自动过滤上装/下装/内衣分类特征（配饰保留）
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
              }}
            >
              {THREE_VIEW_SLOTS.filter((s) => s.nude).map(({ slot, label }) =>
                renderSlot(slot, label),
              )}
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <ImageCropperModal
        open={cropperOpen}
        imageSrc={cropperImageSrc}
        onConfirm={handleCropperConfirm}
        onCancel={handleCropperCancel}
      />

      {/* 全尺寸预览弹窗（支持上一张/下一张导航） */}
      <ImagePreviewModal
        images={previewableImages}
        index={previewIndex}
        onChange={setPreviewIndex}
      />
    </>
  );
};

// ==================== 子组件：WeightEditorContent（权重编辑器 Popover 内容） ====================

/**
 * 权重编辑器 Popover 内容（Spec: add-sdxl-prompt-weight-support / Task 8.2）。
 *
 * 受控组件：接收当前 weight + onChange/onReset 回调，内部维护 InputNumber/Slider 同步状态。
 * - InputNumber 与 Slider 双向同步（改变一个更新另一个，范围 0.1-10.0，步长 0.1）
 * - 「重置为 1.0」按钮调用 onReset（清空 weight 字段，等价于 1.0）
 * - 快捷预设按钮（0.5 / 0.8 / 1.0 / 1.3 / 1.5）快速选择
 *
 * 与 AssetGenerateModal 中的权重编辑器结构一致（Task 7 复用模式）。
 *
 * UI 风格：暗色主题 + inline styles + 项目 CSS 变量（与外层 Modal 一致）。
 * Popover 内容由 antd 注入 document.body，背景使用 antd 默认浮层（已适配暗色主题）。
 */
const WeightEditorContent: React.FC<{
  weight: number | undefined;
  onChange: (weight: number) => void;
  onReset: () => void;
}> = ({ weight, onChange, onReset }) => {
  // 初始值：weight 为 undefined 时回退到 1.0（UI 显示用，不写回 store）
  const initialValue = weight ?? 1.0;
  const [localValue, setLocalValue] = useState<number>(initialValue);

  // 同步外部 weight 变化（如用户重置后 store 更新触发 props 变化）
  useEffect(() => {
    setLocalValue(weight ?? 1.0);
  }, [weight]);

  // InputNumber / Slider / 预设按钮共用：更新本地 + 通知 store
  const handleChange = useCallback(
    (val: number | null) => {
      if (val === null || Number.isNaN(val)) return;
      setLocalValue(val);
      onChange(val);
    },
    [onChange],
  );

  return (
    <div style={{ width: 220, padding: 4 }}>
      {/* InputNumber + Slider 同一行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <InputNumber
          size="small"
          min={0.1}
          max={10}
          step={0.1}
          precision={1}
          value={localValue}
          onChange={handleChange}
          style={{ width: 80 }}
        />
        <Slider
          min={0.1}
          max={10}
          step={0.1}
          value={localValue}
          onChange={handleChange}
          style={{ flex: 1, margin: 0 }}
        />
      </div>
      {/* 快捷预设按钮 */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {[0.5, 0.8, 1.0, 1.3, 1.5].map((preset) => (
          <Button
            key={preset}
            size="small"
            onClick={() => handleChange(preset)}
            style={{ fontSize: 11, padding: '0 6px' }}
          >
            ×{preset.toFixed(1)}
          </Button>
        ))}
      </div>
      {/* 重置按钮：清空 weight 字段（等价于 1.0） */}
      <Button size="small" block onClick={onReset} style={{ fontSize: 11 }}>
        重置为 1.0
      </Button>
    </div>
  );
};

// ==================== 子组件：CharacterTraitTabContent ====================

/**
 * 角色特征 Tab 内容（Spec: add-asset-and-trait-management / Task 9.5 + add-trait-category-grouping / Task 5）
 *
 * 重构为「分类分组面板 + 组合方案工具栏」（Task 5）：
 * - 顶部工具栏：「AI 生成特征」+「保存」+「组合方案」下拉（切换/保存当前为方案/删除方案）+ 启用统计
 * - 分类分组面板：系统分类 + 自定义分类 + 未分类，按 order 升序；每分类可折叠，展示该分类下特征 chip
 * - 特征 chip 交互：
 *   - 启用/禁用切换（点击左侧圆点 → toggleTraitEnabled，enabled=亮色/disabled=灰色半透明）
 *   - 编辑文字（点击文字进入编辑态 → updateTrait，回车保存 / Esc 取消 / 失焦自动保存）
 *   - 删除（关闭按钮 → removeTrait）
 *   - 移动到分类（SwapOutlined 下拉 → moveTrait）
 * - 分类头操作：自定义分类支持重命名/删除；工具栏附近提供「新建分类」入口
 * - 底部添加区：输入框 + 目标分类下拉（默认未分类）+ 「添加」按钮
 * - 保留：角色外观描述编辑区 / LoRA 模型配置 / AI 生成特征（含多模态）
 *
 * 打开 Tab 时 useEffect 调 characterTraitStore.loadTraits(characterCardId)
 *
 * v2 升级要点（Task 5 / 修复 Task 4 遗留 TS 错误）：
 * - editingIndex:number → editingTraitId:string|null（v2 按 id 定位，index 在分类面板中不稳定）
 * - removeTrait(index) → removeTrait(traitId)
 * - updateTrait(index, value) → updateTrait(traitId, newValue)
 * - saveTraits(cardId, traits, desc) → saveTraits(cardId, appearanceDescription?)
 * - 渲染 {trait} → {trait.text}（traits 现为 CharacterTraitItem[]）
 */
const CharacterTraitTabContent: React.FC<{
  characterCardId: string;
  /** 角色描述，供 Task 13 AI 生成特征使用 */
  characterDescription?: string;
  /** 角色个性，供 Task 13 AI 生成特征使用 */
  characterPersonality?: string;
  /** 角色场景，供 Task 13 AI 生成特征使用 */
  characterScenario?: string;
}> = ({ characterCardId, characterDescription, characterPersonality, characterScenario }) => {
  // ====== v2 store state + actions（Task 4 升级后的完整 API） ======
  // 【重点标记 - 全局分类字典】Spec: fix-asset-trait-and-scene-defects / Task 4
  // - 订阅 `globalCategories`（跨角色卡共享，由 categoryDictionary.load() 填充）
  // - 不再订阅 `customCategories`（已废弃，永远为 []）
  // - 分类 CRUD 改为异步 actions：createCategory / renameCategory / deleteCategory
  //   （通过 IPC 写入全局字典 trait-categories.json，不再写入角色卡 manifest）
  const {
    traits,
    globalCategories,
    combinations,
    activeCombinationId,
    appearanceDescription,
    loading,
    error: storeError,
    loadTraits,
    saveTraits,
    addTrait,
    removeTrait,
    updateTrait,
    setTraits,
    setAppearanceDescription,
    clearTraits,
    createCategory,
    renameCategory,
    deleteCategory,
    moveTrait,
    toggleTraitEnabled,
    // 【Spec: add-sdxl-prompt-weight-support / Task 8.3】权重编辑器调用的 store action
    updateTraitWeight,
    saveCombination,
    overwriteCombination,
    applyCombination,
    deleteCombination,
  } = useCharacterTraitStore();
  // TODO(perf): 整体订阅，待拆分为 selector（25+ 字段，>5 暂缓）

  // ====== 检测当前 AI 引擎是否支持视觉（图片识别） ======
  const setting = useSettingStore(s => s.setting);
  // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
  // 不再使用全局 setting.sdWebui.selectedLoras，改为按角色卡独立持久化
  const characterLoras = useCharacterLoraStore(s => s.loras);
  const loadCharacterLoras = useCharacterLoraStore(s => s.loadLoras);
  const saveCharacterLoras = useCharacterLoraStore(s => s.saveLoras);
  const activeEngine = setting?.aiEngines?.find((e) => e.id === setting?.activeEngineId);
  const supportsVision = activeEngine?.capabilities?.supportsVision === true;

  // ====== 本地编辑状态 ======
  const [newTrait, setNewTrait] = useState<string>('');
  /** 底部添加区目标分类（默认未分类） */
  const [newTraitCategoryId, setNewTraitCategoryId] = useState<string>(UNCATEGORIZED_CATEGORY_ID);
  /** 当前正在编辑的特征 traitId；null 表示无编辑态（v2 改用 id 定位，index 在分类面板中不稳定） */
  const [editingTraitId, setEditingTraitId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  /** AI 生成特征中标志（Task 13 接入 ai:generateCharacterTraits IPC） */
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  /** RAG 质检报告数据（AI 生成特征后填充，含检索参考 + 标签验证结果） */
  const [ragDebug, setRagDebug] = useState<{
    enabled: boolean;
    status: string;
    retrievedTags: Array<{ name: string; category: number; count: number; score: number }>;
    tagValidation: Array<{
      tag: string;
      isValid: boolean;
      canonicalName?: string;
      category?: number;
      count?: number;
      skipReason?: 'rating' | 'no_suggestion';
      suggestions: Array<{ name: string; category: number; count: number; score: number }>;
      replacedBy?: string;
      /** L3 颜色拆分信息（透传 main 进程 validateTagsAgainstLibrary 的 splitTags） */
      splitTags?: { colorPartTag: string; featureTag: string };
      /**
       * 命中轮次标识（Spec: add-multi-round-tag-audit / Task 4 + add-ai-fallback-tag-audit）。
       * 透传 main 进程 validateTagsAgainstLibrary 的 source 字段，
       * 或由 characterTraitAIService.applyAiFallback 写入 'ai-fallback'。
       */
      source?:
        | 'user-map'
        | 'name'
        | 'alias'
        | 'color-split'
        | 'negation-strip'
        | 'knn'
        | 'ai-fallback';
      /**
       * 末轮人工审核替换标记（Spec: add-multi-round-tag-audit / Task 4）。
       * true 表示该 tag 已被用户手动指定替换词。
       */
      manuallyReplaced?: boolean;
      /** 人工指定的替换词（撤销时还原 trait.text 为 originalTag） */
      manualReplacement?: string;
      /**
       * AI 兜底尝试标记（Spec: add-ai-fallback-tag-audit）。
       * - true：已对当前 tag 调过 LLM 生成候选词（无论命中与否）
       * - undefined：未触发 AI 兜底
       * 前端据此区分「未尝试」与「尝试失败」两种 invalid 状态。
       */
      aiFallbackAttempted?: boolean;
      /**
       * AI 兜底返回的候选词数组（Spec: add-ai-fallback-tag-audit）。
       * 命中时含命中的候选词，未命中时含全部候选词供前端展示。
       */
      aiFallbackCandidates?: string[];
    }>;
  } | null>(null);
  /** RAG 质检报告面板展开状态 */
  const [ragReportVisible, setRagReportVisible] = useState<boolean>(false);
  /** 角色外观描述本地编辑态（与 store 同步） */
  const [editingDescription, setEditingDescription] = useState<string>('');
  /** LoRA 选择弹窗开关 */
  const [loraModalOpen, setLoraModalOpen] = useState<boolean>(false);
  /** 折叠面板折叠集合（按分类 id；不在集合中则展开，新增分类自动展开） */
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());

  // ====== 提示词生成面板状态（Spec: replace-dynamic-scene-with-prompt-gen / Task 9） ======
  // 用户在组合方案工具栏下方输入自然语言 → 调用 ai:generateTraitPrompts IPC →
  // 主进程 L0-L5 审计 + RAG 标签库参考注入 → 返回 CategorizedTrait[] + ragDebug →
  // 用户确认「应用」调 store.setTraits 合并到现有特征列表（store 内部 saveTraits 持久化）。
  // 视觉风格：紫色边框 + ThunderboltOutlined（与 AssetGenerateModal 的 renderPromptGenPanel 一致）。
  /** 用户输入的提示词文本（如 "red hair, blue dress, forest background"） */
  const [promptGenInput, setPromptGenInput] = useState<string>('');
  /** AI 生成的分类特征（CategorizedTrait[]，应用前暂存，不直接写入 store） */
  const [promptGenResult, setPromptGenResult] = useState<CategorizedTrait[] | null>(null);
  /** AI 调用 loading（控制生成按钮 disabled + loading 图标） */
  const [promptGenLoading, setPromptGenLoading] = useState<boolean>(false);
  /** RAG 质检报告（inline 类型对齐 RagQualityReport 组件的 RagDebugData 接口） */
  const [promptGenRagDebug, setPromptGenRagDebug] = useState<{
    enabled: boolean;
    status: string;
    retrievedTags: Array<{ name: string; category: number; count: number; score: number }>;
    tagValidation: Array<{
      tag: string;
      isValid: boolean;
      canonicalName?: string;
      category?: number;
      count?: number;
      skipReason?: 'rating' | 'no_suggestion';
      suggestions: Array<{ name: string; category: number; count: number; score: number }>;
      replacedBy?: string;
      splitTags?: { colorPartTag: string; featureTag: string };
      source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn' | 'ai-fallback';
      manuallyReplaced?: boolean;
      manualReplacement?: string;
      aiFallbackAttempted?: boolean;
      aiFallbackCandidates?: string[];
    }>;
  } | null>(null);
  /** RAG 质检面板可见性（用户可折叠/展开，默认展开） */
  const [promptGenRagVisible, setPromptGenRagVisible] = useState<boolean>(true);
  /**
   * 已应用的提示词生成特征 ID 集合（renderTraitChip 据此显示「✨ 新增」徽标）。
   * 应用后新 id 进入 store.traits；setTraits 内部会为新项生成新 id（path 4），
   * 本组件通过 diff store 状态获取实际写入的 id 并加入此集合。
   */
  const [appliedPromptTraitIds, setAppliedPromptTraitIds] = useState<Set<string>>(new Set());


  // ====== 通用文本输入弹窗（新建分类 / 重命名分类 / 保存组合方案 复用） ======
  const [promptModal, setPromptModal] = useState<{
    open: boolean;
    title: string;
    label: string;
    placeholder: string;
    value: string;
    confirmText: string;
    onOk: (value: string) => void;
  }>({ open: false, title: '', label: '', placeholder: '', value: '', confirmText: '确定', onOk: () => {} });

  // 当 store 中的外观描述变化时（加载完成 / AI 生成后），同步到本地编辑态
  useEffect(() => {
    setEditingDescription(appearanceDescription || '');
  }, [appearanceDescription]);

  // 编辑输入框 ref（用于聚焦）
  const editingInputRef = useRef<HTMLInputElement | null>(null);

  // ====== 打开 Tab 时加载特征 + LoRA ======
  useEffect(() => {
    if (characterCardId) {
      loadTraits(characterCardId);
      loadCharacterLoras(characterCardId);
    }
  }, [characterCardId, loadTraits, loadCharacterLoras]);

  // ====== 派生数据：全部分类（系统 + 全局自定义 + 未分类），按 order 升序 ======
  // 【重点标记 - 使用 globalCategories】Spec: fix-asset-trait-and-scene-defects / Task 4
  // - 自定义分类来源改为 `globalCategories`（跨角色卡共享的全局字典缓存）
  // - 系统分类由 `SYSTEM_TRAIT_CATEGORIES` 常量提供，未分类由 `UNCATEGORIZED_CATEGORY` 提供
  const allCategories = useMemo<TraitCategory[]>(
    () =>
      [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories, UNCATEGORIZED_CATEGORY].sort(
        (a, b) => a.order - b.order
      ),
    [globalCategories],
  );

  // ====== 派生数据：按分类分组特征 ======
  const traitsByCategory = useMemo<Record<string, CharacterTraitItem[]>>(() => {
    const map: Record<string, CharacterTraitItem[]> = {};
    for (const cat of allCategories) {
      map[cat.id] = [];
    }
    for (const trait of traits) {
      if (!map[trait.categoryId]) {
        // 防御：categoryId 不在已知分类中（理论上不会发生），归入未分类
        map[UNCATEGORIZED_CATEGORY_ID] = map[UNCATEGORIZED_CATEGORY_ID] || [];
        map[UNCATEGORIZED_CATEGORY_ID].push(trait);
      } else {
        map[trait.categoryId].push(trait);
      }
    }
    return map;
  }, [allCategories, traits]);

  // ====== 派生数据：已启用特征数（SubTask 5.1 启用统计） ======
  const enabledCount = useMemo(() => traits.filter((t) => t.enabled).length, [traits]);

  // ====== 派生数据：折叠面板 activeKey（全部分类 id 减去折叠集合） ======
  const expandedCategoryKeys = useMemo(
    () => allCategories.map((c) => c.id).filter((id) => !collapsedCategoryIds.has(id)),
    [allCategories, collapsedCategoryIds],
  );

  // ====== 添加特征（带目标分类，SubTask 5.5） ======
  const handleAddTrait = useCallback(() => {
    const trimmed = newTrait.trim();
    if (!trimmed) {
      message.warning('特征不能为空');
      return;
    }
    const result = addTrait(trimmed, newTraitCategoryId);
    if (result.success) {
      setNewTrait('');
    } else {
      message.warning(result.error || '添加特征失败');
    }
  }, [newTrait, newTraitCategoryId, addTrait]);

  // ====== 删除特征（v2 改用 traitId） ======
  const handleRemoveTrait = useCallback(
    (traitId: string) => {
      const result = removeTrait(traitId);
      if (!result.success) {
        message.error(result.error || '移除特征失败');
      }
    },
    [removeTrait],
  );

  // ====== 编辑特征（v2 改用 traitId） ======
  const handleStartEdit = useCallback(
    (traitId: string) => {
      const target = traits.find((t) => t.id === traitId);
      setEditingTraitId(traitId);
      setEditingValue(target?.text || '');
      // 等下一帧聚焦，确保 input 已渲染
      setTimeout(() => {
        editingInputRef.current?.focus();
        editingInputRef.current?.select();
      }, 0);
    },
    [traits],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingTraitId(null);
    setEditingValue('');
  }, []);

  const handleSaveEdit = useCallback(
    (traitId: string) => {
      const result = updateTrait(traitId, editingValue);
      if (result.success) {
        setEditingTraitId(null);
        setEditingValue('');
      } else {
        message.warning(result.error || '更新特征失败');
      }
    },
    [editingValue, updateTrait],
  );

  // ====== 切换特征启用（SubTask 5.3，进入手动模式由 store 处理） ======
  const handleToggleEnabled = useCallback(
    (traitId: string) => {
      const result = toggleTraitEnabled(traitId);
      if (!result.success) {
        message.warning(result.error || '切换启用状态失败');
      }
    },
    [toggleTraitEnabled],
  );

  // ====== 移动特征到分类（SubTask 5.3） ======
  const handleMoveTrait = useCallback(
    (traitId: string, targetCategoryId: string) => {
      const result = moveTrait(traitId, targetCategoryId);
      if (!result.success) {
        message.warning(result.error || '移动特征失败');
      }
    },
    [moveTrait],
  );

  // ====== 更新特征权重（Spec: add-sdxl-prompt-weight-support / Task 8.3） ======
  // 直接调 store action 修改本地 state（与 handleToggleEnabled / handleMoveTrait 同模式），
  // 持久化由用户点击「保存」按钮统一调用 saveTraits 落盘（「保存=流程结束」是错误假设，
  // 权重编辑立即生效到 store，但写盘仍需显式保存）。
  // 不显示成功消息：与其他行内编辑 handler 保持一致（仅失败时 warning）。
  const handleUpdateTraitWeight = useCallback(
    (traitId: string, weight: number | undefined) => {
      const result = updateTraitWeight(traitId, weight);
      if (!result.success) {
        message.warning(result.error || '更新权重失败');
      }
    },
    [updateTraitWeight],
  );

  // ====== 保存特征（v2 签名：saveTraits(cardId, appearanceDescription?)） ======
  const handleSaveTraits = useCallback(async () => {
    if (!characterCardId) return;
    setSaving(true);
    try {
      // 保存时持久化完整 v2 数据（traits / combinations / activeCombinationId + 外观描述）
      // 注：customCategories 字段固定为 []（Spec: fix-asset-trait-and-scene-defects / Task 4），
      // 自定义分类由全局字典 trait-categories.json 独立持久化，不通过 saveTraits 写入
      const result = await saveTraits(characterCardId, editingDescription);
      if (result.success) {
        message.success('特征已保存');
      } else {
        message.error(result.error || '保存特征失败');
      }
    } finally {
      setSaving(false);
    }
  }, [characterCardId, editingDescription, saveTraits]);

  // ====== 清空所有特征标签 + 质检报告（Spec: add-clear-traits-button） ======
  // 用户点击「清空」按钮时触发：
  //  1. 二次确认（Modal.confirm）—— 清空是不可逆操作，避免误触
  //  2. 调 clearTraits() 清空全部特征 + 外观描述（绕过 setTraits 的 MERGE 策略，含已分类项）
  //  3. 清空 ragDebug 质检报告（setRagDebug(null)）+ 收起报告面板
  //  4. 清空 editingDescription 本地编辑态（与 store appearanceDescription 同步）
  // 仅清空本地 state，不调 IPC；用户需点「保存」才持久化清空结果
  // 不清空 combinations / globalCategories（组合方案 + 分类体系保留）
  const handleClearAll = useCallback(() => {
    // 无特征且无质检报告时无需清空，直接提示
    if (traits.length === 0 && !ragDebug) {
      message.info('当前没有特征标签和质检报告可清空');
      return;
    }
    Modal.confirm({
      title: '清空所有特征标签和质检报告？',
      content:
        '此操作将清空当前所有特征标签（含已分类项）、外观描述和 RAG 质检报告。组合方案和分类体系会保留。清空后需点击「保存」才会持久化到角色卡。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        const result = clearTraits();
        if (!result.success) {
          message.error(result.error || '清空特征失败');
          return;
        }
        // 清空质检报告 + 收起面板（角色特征报告清空）
        setRagDebug(null);
        setRagReportVisible(false);
        // 清空外观描述本地编辑态（与 store appearanceDescription 同步清空）
        setEditingDescription('');
        message.success('已清空所有特征标签和质检报告，请点击「保存」以持久化');
      },
    });
  }, [traits.length, ragDebug, clearTraits]);

  // ====== AI 生成特征（Task 13 接入 ai:generateCharacterTraits IPC） ======
  // 【重点标记 - 多模态综合特征提取】当 AI 引擎 supportsVision=true 时，
  // 同时发送角色描述文本 + 角色卡 PNG 图片给多模态模型，综合提取更完整的特征 tag。
  const handleAIGenerateTraits = useCallback(async () => {
    if (!characterCardId) {
      message.warning('请先选择角色卡');
      return;
    }
    if (!characterDescription && !characterPersonality && !characterScenario) {
      message.warning('角色卡缺少描述信息，无法生成特征');
      return;
    }

    // 已有特征时二次确认（v2 setTraits 采用 MERGE 策略：仅替换未分类项，已归类项保留）
    if (traits.length > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: 'AI 生成将替换未分类特征',
          content: `当前已有 ${traits.length} 个特征，AI 生成将替换「未分类」中的特征（已手动归类的特征保留）。是否继续？`,
          okText: '继续生成',
          // 注：antd v6 移除了 okType: 'warning'，改用 okButtonProps.danger 标红以表达破坏性
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }

    setAiGenerating(true);
    try {
      // 【重点标记 - 多模态综合特征提取】supportsVision=true 时附带角色卡图片
      const result = await window.electronAPI.ai.generateCharacterTraits({
        characterCardId,
        description: characterDescription || '',
        personality: characterPersonality,
        scenario: characterScenario,
        includeImage: supportsVision,
      });

      if (result?.success && Array.isArray(result.traits)) {
        // 仅更新本地 state（MERGE 策略保留已分类项），用户可继续编辑后点击「保存」持久化
        const setResult = setTraits(result.traits);
        // 【重点标记 - 角色外观描述】AI 生成特征时同时返回外观描述，写入 store 本地 state
        if (result.appearanceDescription) {
          setAppearanceDescription(result.appearanceDescription);
        }
        // 【RAG 质检报告】存储 ragDebug 数据，自动展开报告面板
        if (result.ragDebug) {
          setRagDebug(result.ragDebug);
          setRagReportVisible(true);
        }
        if (setResult.success) {
          if (result.traits.length === 0) {
            message.info('AI 未能从角色描述中提取到视觉特征，请手动添加');
          } else {
            const modeText = supportsVision ? '（综合图片+文本）' : '（仅文本描述）';
            // 附加质检统计到成功消息
            const validCount = result.ragDebug?.tagValidation.filter((v) => v.isValid).length ?? 0;
            const totalCount = result.ragDebug?.tagValidation.length ?? 0;
            const ragHint = result.ragDebug?.enabled
              ? `，质检：${validCount}/${totalCount} 标签在库中`
              : '';
            message.success(`AI 生成了 ${result.traits.length} 个特征${modeText}${ragHint}，请确认后点击「保存」`);
          }
        } else {
          message.error(setResult.error || '写入特征失败');
        }
      } else {
        message.error(result?.error || 'AI 生成特征失败');
      }
    } catch (error) {
      console.error('[CharacterTraitTabContent] AI 生成特征失败:', error);
      message.error(error instanceof Error ? error.message : 'AI 生成特征失败');
    } finally {
      setAiGenerating(false);
    }
  }, [
    characterCardId,
    characterDescription,
    characterPersonality,
    characterScenario,
    traits.length,
    setTraits,
    setAppearanceDescription,
    supportsVision,
  ]);

  // ====== 提示词生成 handlers（Spec: replace-dynamic-scene-with-prompt-gen / Task 9） ======
  // 流程：用户输入提示词 → 调用 ai:generateTraitPrompts IPC → 主进程 L0-L5 审计 →
  //       返回 CategorizedTrait[] + ragDebug → 用户确认「应用」合并到 store.traits。
  // 与 AssetGenerateModal 的实现一致，区别：应用结果调 store.setTraits 直接持久化
  // （store 内部 MERGE + saveTraits），而非操作 editedTraits 工作副本。
  /**
   * 触发 AI 提示词生成。
   *
   * 入参：promptGenInput（用户输入的提示词文本）
   * 上下文：baseTraits（当前已有特征文本，逗号拼接，避免 LLM 重复生成已有 tag）
   *
   * 错误兜底：空输入 message.warning；IPC 失败 / 网络异常 message.error。
   * 成功后：暂存 promptGenResult + ragDebug（应用前不写入 store）。
   */
  const handleGenerateTraitPrompts = useCallback(async () => {
    const trimmed = promptGenInput.trim();
    if (!trimmed) {
      message.warning('请输入提示词');
      return;
    }
    setPromptGenLoading(true);
    setPromptGenRagDebug(null);
    try {
      // baseTraits = 当前已有特征文本（避免 LLM 重复生成已有 tag）
      const baseTraits = traits.map((t) => t.text).join(', ');
      const result = await window.electronAPI.ai.generateTraitPrompts({
        prompt: trimmed,
        baseTraits: baseTraits || undefined,
      });
      if (result?.success) {
        const generatedTraits = result.traits || [];
        if (generatedTraits.length === 0) {
          message.info('AI 未从提示词中提取到任何特征，请尝试更具体的描述');
        } else {
          message.success(`AI 生成 ${generatedTraits.length} 条特征，请确认后应用`);
        }
        setPromptGenResult(generatedTraits);
        if (result.ragDebug) {
          setPromptGenRagDebug(result.ragDebug);
          setPromptGenRagVisible(true);
        }
      } else {
        message.error(result?.error || 'AI 提示词生成失败');
        setPromptGenResult(null);
      }
    } catch (error) {
      console.error('[CharacterTraitTabContent] AI 提示词生成失败:', error);
      message.error(error instanceof Error ? error.message : 'AI 提示词生成失败');
      setPromptGenResult(null);
    } finally {
      setPromptGenLoading(false);
    }
  }, [promptGenInput, traits]);

  /**
   * 应用生成的特征到 store.traits（按生成顺序追加到末尾）。
   *
   * 策略：
   *  - 与已有特征去重：text（忽略大小写 + trim）已存在时跳过
   *  - 生成结果内部去重：AI 可能返回多条相同 tag，仅保留首条
   *  - 调用 store.setTraits([...existing, ...new])：setTraits 的 MERGE 策略在传入完整列表时
   *    会保留所有现有项（已分类项 path 1 保留 / 未分类项 path 2 因在传入集合中而保留）+ 追加新项（path 4）
   *  - setTraits 会为新项生成新 id（path 4，genTraitId），故通过 diff store 状态获取实际写入的 id，
   *    记录到 appliedPromptTraitIds（renderTraitChip 据此显示「✨ 新增」徽标）
   *  - 应用后清空 promptGenResult（避免重复应用导致重复追加）
   *
   * ⚠️ 去重 key 为 text 小写 + trim（与 AssetGenerateModal / SD 标签去重语义一致），
   *    跳过条数通过 message 告知用户，避免静默丢弃。
   */
  const handleApplyGeneratedTraits = useCallback(() => {
    if (!promptGenResult || promptGenResult.length === 0) {
      return;
    }
    // 构建已有特征的 text 集合（小写 + trim），用于与生成结果去重
    const existingTextKeys = new Set(traits.map((t) => t.text.trim().toLowerCase()));
    // 生成结果内部也需要去重（AI 可能返回多条相同 tag）
    const seenInBatch = new Set<string>();
    const newTraits: CategorizedTrait[] = [];
    let skipCount = 0;
    for (const trait of promptGenResult) {
      const key = trait.text.trim().toLowerCase();
      if (existingTextKeys.has(key) || seenInBatch.has(key)) {
        skipCount++;
        continue;
      }
      seenInBatch.add(key);
      newTraits.push({
        text: trait.text,
        categoryId: trait.categoryId,
        translation: trait.translation,
        originalText: trait.originalText,
        weight: trait.weight,
      });
    }
    // 全部重复：提示用户无新增，保留生成结果供用户参考（不清空 promptGenResult）
    if (newTraits.length === 0) {
      message.info(`生成的 ${promptGenResult.length} 条特征均已存在于当前列表，未追加重复项`);
      return;
    }
    // 调用 store.setTraits 合并：传入 [现有特征 + 新增特征]，MERGE 策略保留现有项 + 追加新项。
    // 注：setTraits 内部会为新项生成新 id（path 4），下方通过 diff 获取实际写入的 id。
    setTraits([...traits, ...newTraits]);
    // diff store 状态获取实际写入的新 id（setTraits path 4 用 genTraitId 重新生成 id）
    const freshTraits = useCharacterTraitStore.getState().traits;
    const newTexts = new Set(newTraits.map((t) => t.text));
    const newIds = freshTraits.filter((t) => newTexts.has(t.text)).map((t) => t.id);
    setAppliedPromptTraitIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) {
        next.add(id);
      }
      return next;
    });
    // 应用后清空生成结果（避免重复应用导致重复追加）
    setPromptGenResult(null);
    setPromptGenRagDebug(null);
    setPromptGenInput('');
    if (skipCount > 0) {
      message.success(`已追加 ${newTraits.length} 条特征，跳过 ${skipCount} 条重复项`);
    } else {
      message.success(`已追加 ${newTraits.length} 条 AI 生成特征到下方列表`);
    }
  }, [promptGenResult, traits, setTraits]);

  /**
   * 放弃生成的特征（清空生成结果与 RAG 报告，保留输入文本以便用户修改后重试）。
   */
  const handleDiscardGeneratedTraits = useCallback(() => {
    setPromptGenResult(null);
    setPromptGenRagDebug(null);
  }, []);

  // ====== 标签纠错撤销（RAG 质检报告 onRevertTrait 回调） ======
  // 自动替换的 tag 可在质检报告中点 ↩ 撤销，分两类场景：
  //  1. 规范化撤销 / 语义替换撤销：找到 store 中 text === replacedBy 的 trait，还原为 originalTag
  //  2. 颜色拆分撤销（splitColorTag 存在）：除还原 featureTag 为 originalTag 外，
  //     还需找到 text === splitColorTag 的新增 trait 调 removeTrait 删除
  // 同步更新 ragDebug 清除对应 item 的 replacedBy / splitTags 标记（保持 UI 一致）
  const handleRevertTrait = useCallback(
    (originalTag: string, replacedBy: string, splitColorTag?: string) => {
      const isSplitRevert = !!splitColorTag;
      // 1. 还原 featureTag trait 为 originalTag（拆分/规范化/语义替换 共用）
      const trait = traits.find((t) => t.text === replacedBy);
      if (!trait) {
        message.warning(`未找到标签 "${replacedBy}"，可能已被修改或删除`);
        return;
      }
      const result = updateTrait(trait.id, originalTag);
      if (!result.success) {
        message.error(result.error || '撤销替换失败');
        return;
      }

      // 2. 拆分撤销：删除新增的 colorPartTag trait
      if (isSplitRevert && splitColorTag) {
        const colorTrait = traits.find((t) => t.text === splitColorTag);
        if (colorTrait) {
          const removeResult = removeTrait(colorTrait.id);
          if (!removeResult.success) {
            // 删除失败不阻塞还原流程，仅提示（featureTag 已还原成功）
            message.warning(removeResult.error || `删除颜色标签 "${splitColorTag}" 失败`);
          }
        }
        // 注意：traits 闭包是撤销前的快照，colorTrait 已在上面查到；
        //       若未查到（用户已手动删除）则跳过删除，仅还原 featureTag
      }

      // 3. 同步更新 ragDebug：清除对应 item 的 replacedBy 与 splitTags（UI 不再显示"已替换/已拆分"）
      setRagDebug((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tagValidation: prev.tagValidation.map((v) =>
            v.replacedBy === replacedBy && v.tag === originalTag
              ? { ...v, replacedBy: undefined, splitTags: undefined }
              : v
          ),
        };
      });

      // 4. 撤销提示文案区分（拆分撤销 vs 规范化/语义替换撤销）
      if (isSplitRevert && splitColorTag) {
        message.success(`已撤销拆分：${replacedBy} + ${splitColorTag} → ${originalTag}`);
      } else {
        message.success(`已撤销替换：${replacedBy} → ${originalTag}`);
      }
    },
    [traits, updateTrait, removeTrait],
  );

  // ====== 末轮人工审核：手动替换未匹配标签（Spec: add-multi-round-tag-audit / Task 4.1） ======
  // 用户对 L0-L4 全失败的 tag（如 B-cup）输入替换词（如 medium_breasts）后回车触发：
  //  1. 找到 text === originalTag 的 trait 调 updateTrait(trait.id, replacement) 替换文本
  //  2. 调 IPC tagRag.addUserSynonymMapping(originalTag, replacement) 持久化到 user-synonym-map.json
  //     —— 下次 AI 生成同词时 L0 首轮命中 → medium_breasts（持续优化匹配率）
  //  3. 同步更新 ragDebug 对应项：manuallyReplaced=true, manualReplacement=replacement
  //     前端 RagQualityReport 据此显示紫色 🟣 徽标 + 撤销按钮
  // 失败处理：trait 不存在 → 警告；updateTrait 失败 → 错误提示；IPC 失败 → 警告（不阻塞替换）
  const handleManualReplace = useCallback(
    async (originalTag: string, replacement: string) => {
      // 1. 找到 text === originalTag 的 trait 并替换
      const trait = traits.find((t) => t.text === originalTag);
      if (!trait) {
        message.warning(`未找到标签 "${originalTag}"，可能已被修改或删除`);
        return;
      }
      const result = updateTrait(trait.id, replacement);
      if (!result.success) {
        message.error(result.error || '手动替换失败');
        return;
      }

      // 2. 调 IPC 持久化映射（异步，失败不阻塞替换流程，仅警告）
      //    下次 AI 生成同词时 L0 首轮命中 → replacement
      try {
        const ipcResult = await window.electronAPI.tagRag.addUserSynonymMapping({
          original: originalTag,
          replacement,
        });
        if (!ipcResult.success) {
          message.warning(`映射持久化失败：${ipcResult.error || '未知错误'}（替换已生效，但下次需重新指定）`);
        }
      } catch (err) {
        // IPC 异常不阻塞替换（trait 已更新），仅警告
        message.warning(
          `映射持久化异常：${err instanceof Error ? err.message : String(err)}（替换已生效，但下次需重新指定）`
        );
      }

      // 3. 同步更新 ragDebug：标记该项为已手动替换
      setRagDebug((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tagValidation: prev.tagValidation.map((v) =>
            v.tag === originalTag
              ? { ...v, manuallyReplaced: true, manualReplacement: replacement }
              : v
          ),
        };
      });

      message.success(`已手动替换：${originalTag} → ${replacement}（下次 AI 生成同词将自动命中）`);
    },
    [traits, updateTrait],
  );

  // ====== 撤销手动替换（Spec: add-multi-round-tag-audit / Task 4.2） ======
  // 用户点击紫色 🟣 徽标的撤销按钮时触发：
  //  1. 找到 text === replacement 的 trait 调 updateTrait(trait.id, originalTag) 还原
  //  2. 调 IPC tagRag.removeUserSynonymMapping(originalTag) 删除映射记录
  //     —— 用户撤销 = 映射不正确，避免下次 L0 命中错误映射
  //  3. 清除 ragDebug 对应项 manuallyReplaced/manualReplacement
  // 失败处理：trait 不存在 → 警告；updateTrait 失败 → 错误提示；IPC 失败 → 警告（不阻塞还原）
  const handleRevertManualReplace = useCallback(
    async (originalTag: string, replacement: string) => {
      // 1. 找到 text === replacement 的 trait 并还原为 originalTag
      const trait = traits.find((t) => t.text === replacement);
      if (!trait) {
        message.warning(`未找到标签 "${replacement}"，可能已被修改或删除`);
        return;
      }
      const result = updateTrait(trait.id, originalTag);
      if (!result.success) {
        message.error(result.error || '撤销手动替换失败');
        return;
      }

      // 2. 调 IPC 删除映射（异步，失败不阻塞还原流程，仅警告）
      try {
        const ipcResult = await window.electronAPI.tagRag.removeUserSynonymMapping({
          original: originalTag,
        });
        if (!ipcResult.success) {
          message.warning(
            `删除映射失败：${ipcResult.error || '未知错误'}（还原已生效，但映射记录仍存在，建议手动清理）`
          );
        }
      } catch (err) {
        message.warning(
          `删除映射异常：${err instanceof Error ? err.message : String(err)}（还原已生效，但映射记录仍存在）`
        );
      }

      // 3. 同步更新 ragDebug：清除手动替换标记
      setRagDebug((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tagValidation: prev.tagValidation.map((v) =>
            v.tag === originalTag
              ? { ...v, manuallyReplaced: undefined, manualReplacement: undefined }
              : v
          ),
        };
      });

      message.success(`已撤销手动替换：${replacement} → ${originalTag}`);
    },
    [traits, updateTrait],
  );

  // ====== 撤销 AI 兜底替换（Spec: add-ai-fallback-tag-audit） ======
  // 用户点击橙色 🤖 徽标的撤销按钮时触发：
  //  1. 找到 text === replacement 的 trait 调 updateTrait(trait.id, originalTag) 还原
  //     —— AI 兜底命中时 trait.text 已被替换为 replacement（canonicalName 或候选词）
  //  2. 调 IPC tagRag.removeUserSynonymMapping(originalTag) 删除 AI 兜底持久化的映射
  //     —— AI 兜底命中时已 addMapping 持久化，撤销 = 用户认为映射不正确，避免下次 L0 命中错误映射
  //  3. 清除 ragDebug 对应项 replacedBy/source/aiFallbackCandidates
  //     （保留 aiFallbackAttempted=true：UI 显示「已撤销，请手动编辑」，避免再次触发 AI 兜底）
  // 与 handleRevertManualReplace 的差异：
  //  - 触发来源不同（橙色 🤖 vs 紫色 🟣）
  //  - 撤销后保留 aiFallbackAttempted=true，UI 不再展示 ✏ 入口（避免循环），仅显示无效红 ❌
  //    用户如需重新指定，可改用其他已命中的 trait 入口或重新生成
  // 失败处理：trait 不存在 → 警告；updateTrait 失败 → 错误提示；IPC 失败 → 警告（不阻塞还原）
  const handleRevertAiFallback = useCallback(
    async (originalTag: string, replacement: string) => {
      // 1. 找到 text === replacement 的 trait 并还原为 originalTag
      const trait = traits.find((t) => t.text === replacement);
      if (!trait) {
        message.warning(`未找到标签 "${replacement}"，可能已被修改或删除`);
        return;
      }
      const result = updateTrait(trait.id, originalTag);
      if (!result.success) {
        message.error(result.error || '撤销 AI 兜底替换失败');
        return;
      }

      // 2. 调 IPC 删除映射（异步，失败不阻塞还原流程，仅警告）
      //    AI 兜底命中时已 addMapping 持久化，撤销需同步删除
      try {
        const ipcResult = await window.electronAPI.tagRag.removeUserSynonymMapping({
          original: originalTag,
        });
        if (!ipcResult.success) {
          message.warning(
            `删除映射失败：${ipcResult.error || '未知错误'}（还原已生效，但映射记录仍存在，建议手动清理）`
          );
        }
      } catch (err) {
        message.warning(
          `删除映射异常：${err instanceof Error ? err.message : String(err)}（还原已生效，但映射记录仍存在）`
        );
      }

      // 3. 同步更新 ragDebug：清除 AI 兜底命中标记，但保留 aiFallbackAttempted=true
      //    （已尝试过 AI 兜底，避免再次触发；UI 显示为 invalid 红色 ❌）
      setRagDebug((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tagValidation: prev.tagValidation.map((v) =>
            v.tag === originalTag && v.source === 'ai-fallback'
              ? {
                  ...v,
                  replacedBy: undefined,
                  source: undefined,
                  aiFallbackCandidates: undefined,
                  // aiFallbackAttempted 保留 true：标识已尝试过，避免下次再触发 LLM 调用
                }
              : v
          ),
        };
      });

      message.success(`已撤销 AI 兜底替换：${replacement} → ${originalTag}（请手动编辑或重新生成）`);
    },
    [traits, updateTrait],
  );

  // ====== 组合方案：应用（SubTask 5.1） ======
  // 选择「手动模式」（__manual__）时调 applyCombination(null) 取消激活，
  // 让下拉正确显示「手动模式」并保留当前特征列表供用户手动编辑。
  // （手动模式也可由 toggleTraitEnabled 自动触发 activeCombinationId=null）
  const handleApplyCombination = useCallback(
    (combinationId: string) => {
      if (combinationId === '__manual__') {
        applyCombination(null);
        return;
      }
      const result = applyCombination(combinationId);
      if (!result.success) {
        message.warning(result.error || '应用组合失败');
      }
    },
    [applyCombination],
  );

  // ====== 组合方案：保存当前启用集合为方案（SubTask 5.1） ======
  const handleOpenSaveCombination = useCallback(() => {
    if (enabledCount === 0) {
      message.warning('当前没有启用的特征，无法保存为方案');
      return;
    }
    setPromptModal({
      open: true,
      title: '保存组合方案',
      label: '方案名称',
      placeholder: '输入方案名称，如「日常出街」「战斗形态」',
      value: '',
      confirmText: '保存',
      onOk: (name) => {
        const trimmed = name.trim();
        if (!trimmed) {
          message.warning('方案名不能为空');
          return;
        }
        // 重名时弹二次确认框让用户选择覆盖或取消
        const existing = combinations.some((c) => c.name === trimmed);
        if (existing) {
          Modal.confirm({
            title: '覆盖已有方案',
            content: `已存在同名方案「${trimmed}」，是否覆盖其内容？`,
            okText: '覆盖',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => {
              const result = overwriteCombination(trimmed);
              if (result.success) {
                message.success(`方案「${trimmed}」已覆盖`);
                setPromptModal((s) => ({ ...s, open: false }));
              } else {
                message.warning(result.error || '覆盖组合失败');
              }
            },
          });
          return;
        }
        const result = saveCombination(trimmed);
        if (result.success) {
          message.success(`方案「${trimmed}」已保存`);
          setPromptModal((s) => ({ ...s, open: false }));
        } else {
          message.warning(result.error || '保存组合失败');
        }
      },
    });
  }, [enabledCount, combinations, saveCombination, overwriteCombination]);

  // ====== 组合方案：删除当前方案（SubTask 5.1） ======
  const handleDeleteCombination = useCallback(() => {
    if (!activeCombinationId) return;
    const combination = combinations.find((c) => c.id === activeCombinationId);
    if (!combination) return;
    Modal.confirm({
      title: '删除组合方案',
      content: `确认删除方案「${combination.name}」？此操作不影响特征本身，仅移除方案。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        const result = deleteCombination(activeCombinationId);
        if (!result.success) {
          message.error(result.error || '删除组合失败');
        } else {
          message.success('方案已删除');
        }
      },
    });
  }, [activeCombinationId, combinations, deleteCombination]);

  // ====== 分类 CRUD（SubTask 5.4） ======
  // 【重点标记 - 异步 IPC actions】Spec: fix-asset-trait-and-scene-defects / Task 4
  // - 旧实现调用同步 `addCategory` / `updateCategory` / `deleteCategory`（仅改本地 state，需再调 saveTraits 持久化到角色卡 manifest）
  // - 新实现调用异步 `createCategory` / `renameCategory` / `deleteCategory`（通过 IPC 直接写入全局字典 trait-categories.json，跨角色卡共享）
  // - onOk 改为 async 函数，await 异步结果后再决定 message / 关闭弹窗
  const handleOpenAddCategory = useCallback(() => {
    setPromptModal({
      open: true,
      title: '新建分类',
      label: '分类名称',
      placeholder: '输入分类名称，如「武器装备」「特殊标记」',
      value: '',
      confirmText: '创建',
      onOk: async (name) => {
        const trimmed = name.trim();
        if (!trimmed) {
          message.warning('分类名不能为空');
          return;
        }
        const result = await createCategory(trimmed);
        if (result.success) {
          message.success(`分类「${trimmed}」已创建`);
          setPromptModal((s) => ({ ...s, open: false }));
        } else {
          message.warning(result.error || '添加分类失败');
        }
      },
    });
  }, [createCategory]);

  const handleOpenRenameCategory = useCallback(
    (category: TraitCategory) => {
      setPromptModal({
        open: true,
        title: '重命名分类',
        label: '分类名称',
        placeholder: '输入新的分类名称',
        value: category.name,
        confirmText: '保存',
        onOk: async (name) => {
          const trimmed = name.trim();
          if (!trimmed) {
            message.warning('分类名不能为空');
            return;
          }
          const result = await renameCategory(category.id, trimmed);
          if (result.success) {
            message.success('分类已重命名');
            setPromptModal((s) => ({ ...s, open: false }));
          } else {
            message.warning(result.error || '重命名失败');
          }
        },
      });
    },
    [renameCategory],
  );

  const handleDeleteCategory = useCallback(
    (category: TraitCategory) => {
      const count = traits.filter((t) => t.categoryId === category.id).length;
      Modal.confirm({
        title: '删除分类',
        content: `删除分类「${category.name}」后，其下 ${count} 个特征将回退到「未分类」（特征本身不删除）。是否继续？`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          const result = await deleteCategory(category.id);
          if (!result.success) {
            message.error(result.error || '删除分类失败');
          } else {
            message.success('分类已删除');
          }
        },
      });
    },
    [traits, deleteCategory],
  );

  // ====== 折叠面板切换（SubTask 5.2，本地维护折叠状态，默认全部展开） ======
  const handleCollapseChange = useCallback(
    (keys: string | string[]) => {
      const expanded = Array.isArray(keys) ? keys : [keys];
      const expandedSet = new Set(expanded);
      // 折叠集合 = 全部分类 id 减去当前展开集合（新增分类不在折叠集合中，自动展开）
      const nextCollapsed = new Set<string>();
      for (const id of allCategories.map((c) => c.id)) {
        if (!expandedSet.has(id)) nextCollapsed.add(id);
      }
      setCollapsedCategoryIds(nextCollapsed);
    },
    [allCategories],
  );

  // ====== 移动到分类下拉菜单 items（SubTask 5.3） ======
  const moveMenuItems = useMemo(
    () => allCategories.map((c) => ({ key: c.id, label: c.name })),
    [allCategories],
  );

  const hasCharacter = !!characterCardId;

  // ====== 渲染单个特征 chip（SubTask 5.3：启用切换 / 编辑 / 删除 / 移动） ======
  const renderTraitChip = (trait: CharacterTraitItem) => {
    // 【Spec: add-sdxl-prompt-weight-support】权重徽标显示逻辑：
    // 始终显示权重徽标（包括默认 1.0），让用户能直观看到并点击修改每个 tag 的权重。
    // - weightValue：用于展示的权重值（undefined 兜底为 1.0）
    // - isDefaultWeight：是否为默认权重（1.0 或 undefined），决定徽标视觉弱化
    const weightValue = trait.weight ?? 1.0;
    const isDefaultWeight = trait.weight === undefined || trait.weight === 1.0;
    // 编辑态：渲染 Input（回车保存 / Esc 取消 / 失焦自动保存）
    if (editingTraitId === trait.id) {
      return (
        <input
          key={`edit-${trait.id}`}
          ref={editingInputRef}
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSaveEdit(trait.id);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handleCancelEdit();
            }
          }}
          onBlur={() => handleSaveEdit(trait.id)}
          style={{
            background: '#0f0f1a',
            border: '1px solid var(--primary-color, #6366f1)',
            borderRadius: 4,
            color: 'var(--text-primary, #e2e8f0)',
            padding: '2px 8px',
            fontSize: 13,
            width: Math.max(80, editingValue.length * 8 + 24),
            outline: 'none',
          }}
        />
      );
    }
    // 展示态：自定义 chip（启用圆点 + 文字 + 移动下拉 + 删除按钮）
    return (
      <span
        key={`chip-${trait.id}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px 2px 8px',
          borderRadius: 4,
          fontSize: 13,
          userSelect: 'none',
          background: trait.enabled
            ? 'rgba(99, 102, 241, 0.18)'
            : 'rgba(30, 30, 46, 0.5)',
          border: trait.enabled
            ? '1px solid var(--primary-color, #6366f1)'
            : '1px solid rgba(255, 255, 255, 0.12)',
          color: trait.enabled
            ? 'var(--text-primary, #e2e8f0)'
            : 'var(--text-tertiary, #6b7280)',
          opacity: trait.enabled ? 1 : 0.7,
        }}
      >
        {appliedPromptTraitIds.has(trait.id) && (
          <span
            title="提示词生成新增"
            style={{
              fontSize: 11,
              color: '#a78bfa',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            ✨
          </span>
        )}
        {/* 启用状态圆点（点击切换 enabled） */}
        <span
          onClick={() => handleToggleEnabled(trait.id)}
          title={trait.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: trait.enabled ? '#52c41a' : '#6b7280',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: trait.enabled ? '0 0 4px rgba(82, 196, 26, 0.6)' : 'none',
          }}
        />
        {/* 文字（点击进入编辑态） */}
        {/* 【重点标记 - Tooltip 包裹】Spec: add-ai-tag-chinese-translation / Task 5
            - 用 <Tooltip> 包裹 trait.text 展示态 span，translation 存在时 hover 显示中文翻译
            - translation 为空时 antd Tooltip 默认不弹出（空字符串 title），不影响点击编辑
            - Tooltip 不拦截 click 事件，点击仍进入编辑态
            【Spec: optimize-trait-translation-and-temp-scheme / Task 4】拆分标签视觉标识：
            - 当 trait.originalText 存在（L3 颜色拆分生成）时，Tooltip title 改为多行内容
              （原标签 / 拆分为 / 翻译），帮助用户理解该 tag 由复合标签拆分而来
            - 文字前显示 SplitCellsOutlined 图标作为视觉标识 */}
        <Tooltip
          title={
            trait.originalText || trait.translation || !isDefaultWeight
              ? (
                <div style={{ lineHeight: 1.6 }}>
                  {trait.originalText && <div>原标签：{trait.originalText}</div>}
                  {trait.originalText && <div>拆分为：{trait.text}</div>}
                  {trait.translation && <div>翻译：{trait.translation}</div>}
                  {/* 【Spec: add-sdxl-prompt-weight-support】权重行：
                      - 非默认权重：>1.0 暖橙（强化）/ <1.0 冷蓝（弱化），与徽标配色一致
                      - 默认权重 1.0：使用次级文本色（弱化），让用户在 Tooltip 中也能看到当前权重值 */}
                  <div
                    style={{
                      color: isDefaultWeight
                        ? 'var(--text-secondary, #94a3b8)'
                        : weightValue > 1.0
                          ? '#fa8c16'
                          : '#1677ff',
                    }}
                  >
                    权重：{weightValue.toFixed(1)}
                  </div>
                </div>
              )
              : trait.translation || ''
          }
        >
          <span
            onClick={() => handleStartEdit(trait.id)}
            style={{
              cursor: 'text',
              lineHeight: '20px',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {trait.originalText && (
              <SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />
            )}
            {trait.text}
          </span>
        </Tooltip>
        {/* 权重徽标 + 编辑器 Popover（Spec: add-sdxl-prompt-weight-support / Task 8.1 + 8.2）
            - 始终渲染（包括默认权重 1.0），让用户能随时点击修改任意 tag 的权重
            - 默认权重（1.0/undefined）：灰色弱化 + 虚线边框，提示「可点击调整」
            - 非默认权重：>1.0 暖橙色（#fa8c16 强化）/ <1.0 冷蓝色（#1677ff 弱化），半透明背景
            - 点击徽标弹出 Popover 编辑器（InputNumber + Slider + 预设 + 重置）
            - 颜色为语义指示，inline hex 不冲突暗色主题；背景使用半透明同色系，适配暗色 */}
        <Popover
          trigger="click"
          placement="top"
          title={`权重编辑（${trait.text}）`}
          content={
            <WeightEditorContent
              weight={trait.weight}
              onChange={(val) => handleUpdateTraitWeight(trait.id, val)}
              onReset={() => handleUpdateTraitWeight(trait.id, undefined)}
            />
          }
        >
          <span
            title={`权重 ×${weightValue.toFixed(1)}，点击修改`}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 10,
              padding: '0 4px',
              borderRadius: 4,
              marginLeft: 4,
              cursor: 'pointer',
              lineHeight: '16px',
              // 默认权重：灰色弱化 + 虚线边框（提示可点击调整）
              // 非默认权重：橙色（>1.0 强化）/ 蓝色（<1.0 弱化）+ 半透明背景
              color: isDefaultWeight
                ? 'var(--text-tertiary, #8c8c8c)'
                : weightValue > 1.0
                  ? '#fa8c16'
                  : '#1677ff',
              background: isDefaultWeight
                ? 'transparent'
                : weightValue > 1.0
                  ? 'rgba(250, 140, 22, 0.15)'
                  : 'rgba(22, 119, 255, 0.15)',
              border: isDefaultWeight
                ? '1px dashed rgba(255, 255, 255, 0.2)'
                : `1px solid ${
                    weightValue > 1.0
                      ? 'rgba(250, 140, 22, 0.4)'
                      : 'rgba(22, 119, 255, 0.4)'
                  }`,
              opacity: isDefaultWeight ? 0.7 : 1,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            ×{weightValue.toFixed(1)}
          </span>
        </Popover>
        {/* 移动到分类下拉 */}
        <Dropdown
          menu={{ items: moveMenuItems, onClick: ({ key }) => handleMoveTrait(trait.id, key) }}
          trigger={['click']}
        >
          <span
            title="移动到分类"
            onClick={(e) => e.stopPropagation()}
            style={{
              cursor: 'pointer',
              opacity: 0.6,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 2px',
            }}
          >
            <SwapOutlined style={{ fontSize: 11 }} />
          </span>
        </Dropdown>
        {/* 删除按钮 */}
        <span
          title="删除特征"
          onClick={(e) => {
            e.stopPropagation();
            handleRemoveTrait(trait.id);
          }}
          style={{
            cursor: 'pointer',
            opacity: 0.6,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <CloseOutlined style={{ fontSize: 11 }} />
        </span>
      </span>
    );
  };

  // ====== 渲染分类面板头（SubTask 5.2 / 5.4：分类名 + 计数 + 自定义分类操作） ======
  const renderCategoryHeader = (category: TraitCategory) => {
    const list = traitsByCategory[category.id] || [];
    const enabledInCategory = list.filter((t) => t.enabled).length;
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 4 }}
        onClick={(e) => {
          // 阻止按钮点击触发的折叠/展开（仅在点击操作区时阻止）
          if (e.target instanceof HTMLElement && e.target.closest('span[data-stop-collapse]')) {
            e.stopPropagation();
          }
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-primary, #e2e8f0)', fontWeight: 500 }}>
            {category.name}
          </span>
          <span style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 11 }}>
            （{enabledInCategory}/{list.length}）
          </span>
        </span>
        {/* 自定义分类支持重命名 / 删除；系统分类与未分类不可改 */}
        {!category.isSystem && (
          <span data-stop-collapse style={{ display: 'inline-flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            <Tooltip title="重命名分类">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => handleOpenRenameCategory(category)}
                style={{ color: 'var(--text-secondary, #94a3b8)' }}
              />
            </Tooltip>
            <Tooltip title="删除分类（特征回退未分类）">
              <Button
                size="small"
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteCategory(category)}
                style={{ color: 'var(--text-secondary, #94a3b8)' }}
              />
            </Tooltip>
          </span>
        )}
      </div>
    );
  };

  /**
   * 提示词生成面板（Spec: replace-dynamic-scene-with-prompt-gen / Task 9）。
   *
   * 位置：组合方案工具栏下方、特征列表（分类分组面板）上方。
   * 视觉风格：紫色渐变边框 + ThunderboltOutlined 图标 + Input.TextArea + 主按钮
   *          （与 AssetGenerateModal 的 renderPromptGenPanel 完全一致）。
   *
   * 交互流程：
   *  1. 用户在 TextArea 输入提示词（如 "red hair, blue dress, forest background"）
   *  2. 点击「生成提示词」按钮 → handleGenerateTraitPrompts 调用 ai:generateTraitPrompts IPC
   *  3. 主进程内部走 L0-L5 完整审计链 + RAG 标签库参考注入，返回 CategorizedTrait[] + ragDebug
   *  4. 结果按分类分组展示（Tag + 翻译 Tooltip），下方显示「应用」/「放弃」按钮
   *  5. 用户点击「应用」→ handleApplyGeneratedTraits 合并到 store.traits，
   *     新增项在下方分类分组面板中显示「✨ 新增」徽标
   *  6. RAG 质检报告（RagQualityReport 组件，只读模式）展示 L0-L5 审计命中情况
   */
  const renderPromptGenPanel = () => {
    // 按分类分组生成结果（仅展示有特征的分类）；allCategories 复用组件已有的 useMemo 派生值
    const traitsByCategoryMap = new Map<string, CategorizedTrait[]>();
    if (promptGenResult) {
      for (const trait of promptGenResult) {
        const list = traitsByCategoryMap.get(trait.categoryId);
        if (list) {
          list.push(trait);
        } else {
          traitsByCategoryMap.set(trait.categoryId, [trait]);
        }
      }
    }
    const groupedCategories = allCategories.filter((c) => traitsByCategoryMap.has(c.id));

    return (
      <div
        style={{
          marginBottom: 12,
          padding: 10,
          background: 'rgba(139, 92, 246, 0.05)',
          borderRadius: 8,
          border: '1px solid rgba(139, 92, 246, 0.2)',
          fontSize: 12,
        }}
      >
        {/* 标题行 */}
        <div
          style={{
            color: 'var(--text-primary, #e2e8f0)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            fontWeight: 600,
          }}
        >
          <ThunderboltOutlined style={{ color: '#a78bfa' }} />
          <span>提示词生成</span>
          <span
            style={{
              color: 'var(--text-tertiary, #6b7280)',
              fontSize: 11,
              fontWeight: 400,
            }}
          >
            （AI 解析自然语言为分类特征 tag，应用后追加到下方「携带角色特征」列表）
          </span>
        </div>

        {/* 输入区：TextArea + 生成按钮 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Input.TextArea
            value={promptGenInput}
            onChange={(e) => setPromptGenInput(e.target.value)}
            placeholder="输入提示词，如：red hair, blue dress, forest background；或自然语言：穿着哥特风服装站在森林里"
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={promptGenLoading}
            style={{
              flex: 1,
              background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(139, 92, 246, 0.2)',
            }}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={promptGenLoading}
            onClick={handleGenerateTraitPrompts}
            disabled={promptGenLoading || !promptGenInput.trim()}
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              borderColor: 'transparent',
            }}
          >
            生成提示词
          </Button>
        </div>

        {/* 结果展示区：仅当 promptGenResult 非空时渲染 */}
        {promptGenResult && (
          <div style={{ marginTop: 10 }}>
            {promptGenResult.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-tertiary, #6b7280)',
                  fontSize: 12,
                  padding: '8px 0',
                }}
              >
                AI 未从提示词中提取到任何特征，请尝试更具体的描述
              </div>
            ) : (
              <>
                <div
                  style={{
                    color: 'var(--text-secondary, #94a3b8)',
                    fontSize: 12,
                    marginBottom: 6,
                  }}
                >
                  AI 生成结果（共 {promptGenResult.length} 条，按分类展示，确认后点击「应用」追加到下方特征列表）：
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {groupedCategories.map((category) => {
                    const catTraits = traitsByCategoryMap.get(category.id) || [];
                    return (
                      <div key={`prompt-gen-cat-${category.id}`}>
                        <div
                          style={{
                            color: 'var(--text-secondary, #94a3b8)',
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                        >
                          {category.name}（{catTraits.length}）
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 4,
                            alignItems: 'center',
                            minHeight: 28,
                            padding: '4px 8px',
                            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                            border: '1px solid rgba(139, 92, 246, 0.15)',
                            borderRadius: 4,
                          }}
                        >
                          {catTraits.map((trait, index) => {
                            const hasWeight =
                              trait.weight !== undefined && trait.weight !== 1.0;
                            return (
                            <Tooltip
                              key={`prompt-gen-tag-${category.id}-${index}`}
                              title={
                                trait.translation
                                  ? `翻译：${trait.translation}${trait.originalText ? `（来源：${trait.originalText}）` : ''}${hasWeight ? `（权重 ×${trait.weight!.toFixed(1)}）` : ''}`
                                  : trait.originalText
                                    ? `来源：${trait.originalText}${hasWeight ? `（权重 ×${trait.weight!.toFixed(1)}）` : ''}`
                                    : hasWeight
                                      ? `权重 ×${trait.weight!.toFixed(1)}`
                                      : ''
                              }
                            >
                              <Tag
                                color="purple"
                                style={{
                                  margin: 0,
                                  fontSize: 11,
                                  cursor: 'help',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                }}
                              >
                                {trait.text}
                                {hasWeight && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      padding: '0 4px',
                                      borderRadius: 4,
                                      marginLeft: 4,
                                      cursor: 'default',
                                      lineHeight: '16px',
                                      color: trait.weight! > 1.0 ? '#fa8c16' : '#1677ff',
                                      background:
                                        trait.weight! > 1.0
                                          ? 'rgba(250, 140, 22, 0.15)'
                                          : 'rgba(22, 119, 255, 0.15)',
                                      border: `1px solid ${
                                        trait.weight! > 1.0
                                          ? 'rgba(250, 140, 22, 0.4)'
                                          : 'rgba(22, 119, 255, 0.4)'
                                      }`,
                                      flexShrink: 0,
                                      userSelect: 'none',
                                    }}
                                  >
                                    ×{trait.weight!.toFixed(1)}
                                  </span>
                                )}
                              </Tag>
                            </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 应用 / 放弃按钮 */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={handleApplyGeneratedTraits}
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                      borderColor: 'transparent',
                      fontSize: 11,
                    }}
                  >
                    应用到特征列表
                  </Button>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={handleDiscardGeneratedTraits}
                    style={{ fontSize: 11 }}
                  >
                    放弃
                  </Button>
                  <span
                    style={{
                      color: 'var(--text-tertiary, #6b7280)',
                      fontSize: 11,
                    }}
                  >
                    应用后将追加到下方「携带角色特征」列表末尾，并标记为「✨ 新增」
                  </span>
                </div>

                {/* RAG 质检报告（只读模式，不传 onRevert/onManualReplace 回调） */}
                {promptGenRagDebug && (
                  <div style={{ marginTop: 10 }}>
                    <RagQualityReport
                      ragDebug={promptGenRagDebug}
                      visible={promptGenRagVisible}
                      onToggle={() => setPromptGenRagVisible(!promptGenRagVisible)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* 顶部工具栏（SubTask 5.1：AI 生成 + 保存 + 组合方案下拉 + 启用统计） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          padding: 12,
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
          borderRadius: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 13 }}>
            管理角色的视觉特征 tag，AI 生成图片时会自动携带这些特征以保持一致性。
          </div>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11, marginTop: 2 }}>
            已添加 {traits.length} 个特征，已启用 {enabledCount}/{traits.length}。修改后请点击「保存」持久化。
          </div>
          {/* 【重点标记 - 多模态综合特征提取用户提示】 */}
          <div style={{ color: supportsVision ? 'var(--success-color, #52c41a)' : 'var(--text-tertiary, #6b7280)', fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            {supportsVision ? (
              <>
                <EyeOutlined style={{ fontSize: 12 }} />
                当前模型支持图片识别，点击「AI 生成特征」将同时发送角色描述和角色卡图片，综合提取特征
              </>
            ) : (
              '当前模型不支持图片识别，将仅根据角色描述文本提取特征。如需更精准的识别，请在设置中切换到多模态模型'
            )}
          </div>
        </div>

        {/* 组合方案下拉 + 保存/删除方案 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>组合方案</span>
          <Select
            size="small"
            value={activeCombinationId ?? '__manual__'}
            onChange={handleApplyCombination}
            style={{ width: 160 }}
            options={[
              { value: '__manual__', label: '手动模式' },
              // 【Spec: optimize-trait-translation-and-temp-scheme / Task 8】含 traitSnapshot 的方案
              // 加 📋 标识，帮助用户区分方案类型（含快照的方案应用时会完整替换 traits，
              // 含临时标签/编辑文本；无快照的方案仅切换 enabled，trait 本身不变）
              ...combinations.map((c) => ({
                value: c.id,
                label: c.traitSnapshot ? `${c.name} 📋` : c.name,
              })),
            ]}
          />
          <Tooltip title="将当前启用的特征保存为命名方案">
            <Button size="small" icon={<SaveOutlined />} onClick={handleOpenSaveCombination}>
              存方案
            </Button>
          </Tooltip>
          <Tooltip title="删除当前方案（进入手动模式）">
            <Button
              size="small"
              icon={<DeleteOutlined />}
              disabled={!activeCombinationId}
              onClick={handleDeleteCombination}
            >
              删方案
            </Button>
          </Tooltip>
        </div>

        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleAIGenerateTraits}
          loading={aiGenerating}
          disabled={!hasCharacter}
        >
          AI 生成特征
        </Button>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSaveTraits}
          loading={saving}
          disabled={!hasCharacter}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            borderColor: 'transparent',
          }}
        >
          保存
        </Button>

        {/* 清空按钮：清空所有特征标签 + 质检报告（Spec: add-clear-traits-button） */}
        <Tooltip title="清空当前所有特征标签、外观描述和 RAG 质检报告（组合方案和分类保留，需再点保存才持久化）">
          <Button
            danger
            icon={<ClearOutlined />}
            onClick={handleClearAll}
            disabled={!hasCharacter}
          >
            清空
          </Button>
        </Tooltip>
      </div>

      {/* 错误横幅 */}
      {storeError && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 12,
          }}
        >
          {storeError}
        </div>
      )}

      {/* RAG 质检报告（AI 生成特征后展示） */}
      {ragDebug && (
        <RagQualityReport
          ragDebug={ragDebug}
          visible={ragReportVisible}
          onToggle={() => setRagReportVisible(!ragReportVisible)}
          onRevertTrait={handleRevertTrait}
          onManualReplace={handleManualReplace}
          onRevertManualReplace={handleRevertManualReplace}
          onRevertAiFallback={handleRevertAiFallback}
        />
      )}

      {/* 提示词生成面板（Spec: replace-dynamic-scene-with-prompt-gen / Task 9） */}
      {renderPromptGenPanel()}

      {/* 主体内容 */}
      {!hasCharacter ? (
        <Empty description="未选择角色卡，无法管理特征" />
      ) : loading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 0',
          }}
        >
          <Spin size="large" />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            加载中...
          </span>
        </div>
      ) : (
        <>
          {/* 分类分组面板（SubTask 5.2：系统分类 + 自定义分类 + 未分类，按 order 升序） */}
          <Collapse
            activeKey={expandedCategoryKeys}
            onChange={handleCollapseChange}
            style={{ marginBottom: 16, background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.3))' }}
            items={allCategories.map((category) => {
              const list = traitsByCategory[category.id] || [];
              return {
                key: category.id,
                label: renderCategoryHeader(category),
                children:
                  list.length === 0 ? (
                    <div style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 12, padding: '4px 0' }}>
                      暂无特征，可从其他分类移动或从下方添加
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {list.map((trait) => renderTraitChip(trait))}
                    </div>
                  ),
              };
            })}
          />

          {/* 底部添加区（SubTask 5.5：输入框 + 目标分类下拉 + 添加按钮 + 新建分类入口） */}
          {/* 【Spec: implement-local-tag-autocomplete / Task 7 集成补全】
              原 Input 已替换为 TagAutocomplete，提供基于本地标签库的实时推荐。
              - onTagSelect：选中推荐 tag 后直接通过 store.addTrait 添加到当前分类并清空输入框，
                保留输入框焦点允许连续添加多个 tag（与 AssetGenerateModal 集成模式一致）。
              - onPressEnter：用户输入自定义文本后回车仍走 handleAddTrait（添加并清空）。
              - showSortButton=false：简化底部添加区 UI，排序按钮在设置页配置。
              - 降级开关（setting.tagAutocomplete.enabled=false）时由 TagAutocomplete 内部
                回退为普通 Input（onPressEnter 已透传），功能不中断。 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <TagAutocomplete
              value={newTrait}
              onChange={setNewTrait}
              onTagSelect={(tag) => {
                // 选中推荐 tag 后：直接通过 store 添加到当前分类并清空输入框。
                // 不退出输入模式，允许用户连续添加多个推荐 tag。
                const result = addTrait(tag.name, newTraitCategoryId);
                if (result.success) {
                  setNewTrait('');
                } else {
                  message.warning(result.error || '添加特征失败');
                }
              }}
              placeholder="输入新特征 tag，如 white fur, blue eyes"
              onPressEnter={handleAddTrait}
              showSortButton={false}
              style={{ flex: '1 1 200px' }}
            />
            <Select
              value={newTraitCategoryId}
              onChange={setNewTraitCategoryId}
              style={{ width: 140 }}
              options={allCategories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddTrait}
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                borderColor: 'transparent',
              }}
            >
              添加
            </Button>
            <Button
              icon={<FolderAddOutlined />}
              onClick={handleOpenAddCategory}
              style={{
                background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                color: 'var(--text-primary, #e2e8f0)',
              }}
            >
              新建分类
            </Button>
          </div>

          {/* 角色外观描述（SubTask 5.6：保留原 UI 行为，AI 生成特征时自动提取，可手动编辑） */}
          <div style={{ marginTop: 16 }}>
            <div style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 12,
              marginBottom: 6,
            }}>
              角色外观描述（AI 生成特征时自动提取，可手动编辑）：
            </div>
            <Input.TextArea
              value={editingDescription}
              onChange={(e) => setEditingDescription(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="点击「AI 生成特征」后，此处将自动填入角色的外观描述。也可手动输入。"
              style={{
                background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                color: 'var(--text-primary, #e2e8f0)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
              }}
            />
          </div>

          {/* LoRA 模型配置（与全局 SD WebUI 配置绑定，生成图片时自动应用） */}
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              borderRadius: 8,
              border: '1px solid rgba(99, 102, 241, 0.3)',
            }}
          >
            <div style={{
              color: 'var(--primary-color, #6366f1)',
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 4,
            }}>
              LoRA 模型配置（与此角色绑定）
            </div>
            <div style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 12,
              marginBottom: 8,
            }}>
              为当前角色选择 LoRA 模型，生成图片时自动应用。这些设置仅对当前角色生效。
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setLoraModalOpen(true)}
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  borderColor: 'transparent',
                }}
              >
                选择 LoRA 模型
              </Button>
              {characterLoras.map((lora, index) => (
                <Tag
                  key={index}
                  closable
                  onClose={(e) => {
                    e.preventDefault();
                    const updated = characterLoras.filter((_, i) => i !== index);
                    saveCharacterLoras(characterCardId, updated);
                  }}
                  style={{ background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.8))', border: '1px solid var(--primary-color, #6366f1)', color: 'var(--text-primary, #e2e8f0)', padding: '2px 8px', borderRadius: 4, fontSize: 13 }}
                >
                  {lora.name} ({lora.weight})
                </Tag>
              ))}
            </div>
          </div>

          {/* 提示 */}
          <div
            style={{
              marginTop: 12,
              color: 'var(--text-tertiary, #6b7280)',
              fontSize: 11,
            }}
          >
            提示：点击特征左侧圆点切换启用/禁用，点击文字可编辑，圆点右侧图标可移动分类。LoRA 配置按角色独立存储。
          </div>
        </>
      )}

      {/* 通用文本输入弹窗（新建分类 / 重命名分类 / 保存组合方案 复用） */}
      <Modal
        open={promptModal.open}
        title={promptModal.title}
        okText={promptModal.confirmText}
        cancelText="取消"
        onCancel={() => setPromptModal((s) => ({ ...s, open: false }))}
        onOk={() => promptModal.onOk(promptModal.value)}
      >
        <div style={{ marginTop: 8 }}>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12, marginBottom: 6 }}>
            {promptModal.label}
          </div>
          <Input
            value={promptModal.value}
            onChange={(e) => setPromptModal((s) => ({ ...s, value: e.target.value }))}
            placeholder={promptModal.placeholder}
            onPressEnter={() => promptModal.onOk(promptModal.value)}
            autoFocus
            style={{
              background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              color: 'var(--text-primary, #e2e8f0)',
            }}
          />
        </div>
      </Modal>

      {/* LoRA 选择弹窗 */}
      <LoraSelectModal
        open={loraModalOpen}
        endpoint={setting?.sdWebui?.endpoint || 'http://localhost:7860'}
        selectedLoras={characterLoras}
        onConfirm={(loras) => {
          // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
          // 不再写入全局 AppSetting.sdWebui.selectedLoras，改为按角色卡持久化
          saveCharacterLoras(characterCardId, loras);
          setLoraModalOpen(false);
        }}
        onCancel={() => setLoraModalOpen(false)}
      />
    </>
  );
};

// ==================== 顶层组件：AssetManagerModal ====================

/**
 * 角色素材管理与特征管理弹窗（Spec: add-asset-and-trait-management / Task 9）
 *
 * 顶层结构：Modal + Tabs（5 个 Tab）。
 * 打开时（open=true 且 characterCardId 非空）统一加载：
 * - 表情（expressionStore.loadExpressions）
 * - 三种素材（assetStore.loadAssets for each type）
 * - 特征（characterTraitStore.loadTraits）
 *
 * 各子组件内部也兜底调用各自的 load（防止单独使用时未加载），保证独立可用性。
 */
const AssetManagerModal: React.FC<AssetManagerModalProps> = ({
  open,
  characterCardId,
  characterName,
  characterDescription,
  characterPersonality,
  characterScenario,
  avatarPath,
  onClose,
  inline = false,
  onCardImageReplaced,
}) => {
  // ====== Stores（用于顶层统一加载） ======
  const loadExpressions = useExpressionStore((s) => s.loadExpressions);
  const loadAssets = useAssetStore((s) => s.loadAssets);
  const loadTraits = useCharacterTraitStore((s) => s.loadTraits);

  // ====== AssetGenerateModal 状态（Task 11 接入） ======
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<
    'batch-expression' | 'single-expression' | 'illustration' | 'general' | 'three-view'
  >('batch-expression');
  const [generateTargetEmotionKey, setGenerateTargetEmotionKey] = useState<string | undefined>(undefined);
  const [generateTargetEmotionLabel, setGenerateTargetEmotionLabel] = useState<string | undefined>(undefined);
  const [generateTargetSlot, setGenerateTargetSlot] = useState<ThreeViewSlot | undefined>(undefined);

  // 统一打开 AssetGenerateModal 的入口
  const openGenerateModal = useCallback(
    (
      mode: typeof generateMode,
      options?: {
        targetEmotionKey?: string;
        targetEmotionLabel?: string;
        targetSlot?: ThreeViewSlot;
      }
    ) => {
      setGenerateMode(mode);
      setGenerateTargetEmotionKey(options?.targetEmotionKey);
      setGenerateTargetEmotionLabel(options?.targetEmotionLabel);
      setGenerateTargetSlot(options?.targetSlot);
      setGenerateModalOpen(true);
    },
    []
  );

  // ====== 打开弹窗时统一加载所有数据 ======
  useEffect(() => {
    if (open && characterCardId) {
      // 并行触发，互不阻塞（各自 store 内部 set loading）
      loadExpressions(characterCardId);
      loadAssets(characterCardId, 'illustration');
      loadAssets(characterCardId, 'general');
      loadAssets(characterCardId, 'three-view');
      loadTraits(characterCardId);
    }
  }, [open, characterCardId, loadExpressions, loadAssets, loadTraits]);

  // ====== Tab 配置 ======
  const tabItems = [
    {
      key: 'expression',
      label: '表情',
      children: (
        <ExpressionTabContent
          characterCardId={characterCardId}
          characterName={characterName}
          avatarPath={avatarPath}
          onBatchGenerate={() => openGenerateModal('batch-expression')}
          onSingleGenerate={(emotionKey, label) =>
            openGenerateModal('single-expression', {
              targetEmotionKey: emotionKey,
              targetEmotionLabel: label,
            })
          }
        />
      ),
    },
    {
      key: 'illustration',
      label: '角色立绘',
      children: (
        <AssetGridTabContent
          characterCardId={characterCardId}
          assetType="illustration"
          tabLabel="角色立绘"
          idPrefix="ill"
          onAIGenerate={() => openGenerateModal('illustration')}
          onCardImageReplaced={onCardImageReplaced}
        />
      ),
    },
    {
      key: 'general',
      label: '一般图像',
      children: (
        <AssetGridTabContent
          characterCardId={characterCardId}
          assetType="general"
          tabLabel="一般图像"
          idPrefix="gen"
          onAIGenerate={() => openGenerateModal('general')}
        />
      ),
    },
    {
      key: 'three-view',
      label: '三视图',
      children: (
        <ThreeViewTabContent
          characterCardId={characterCardId}
          onAIGenerate={(slot) => openGenerateModal('three-view', { targetSlot: slot })}
        />
      ),
    },
    {
      key: 'trait',
      label: '角色特征',
      children: (
        <CharacterTraitTabContent
          characterCardId={characterCardId}
          characterDescription={characterDescription}
          characterPersonality={characterPersonality}
          characterScenario={characterScenario}
        />
      ),
    },
  ];

  // ====== 共享内容：Tabs + AssetGenerateModal（inline / Modal 两种模式复用，避免重复） ======
  const tabsElement = (
    <Tabs
      defaultActiveKey="expression"
      items={tabItems}
      style={{ minHeight: 400 }}
    />
  );

  // AssetGenerateModal（Task 11 接入，所有素材/表情 AI 生成入口共用）
  // 无论 inline 与否都需要渲染：它自身是 Modal，会 portal 到 document.body，
  // 由 generateModalOpen 控制显隐，放在哪个父容器都不影响其弹层定位。
  const generateModalElement = (
    <AssetGenerateModal
      open={generateModalOpen}
      characterCardId={characterCardId}
      characterCardPath={characterCardId}
      characterName={characterName}
      mode={generateMode}
      targetEmotionKey={generateTargetEmotionKey}
      targetEmotionLabel={generateTargetEmotionLabel}
      targetSlot={generateTargetSlot}
      onClose={() => setGenerateModalOpen(false)}
      onGenerated={() => {
        // 生成完成后刷新对应 store（各 store 已在子组件中订阅，
        // AssetGenerateModal 内部保存时已调用对应 store 的 save 方法，
        // 这里无需额外操作；保留回调以备未来扩展）
      }}
    />
  );

  // ====== 内联模式：直接渲染 div + Tabs，无 Modal 外壳 ======
  // 用于嵌入 CharacterEditModal 的「素材管理」Tab，内容随父 Modal body 流动并滚动。
  // 不渲染标题（Tab label 已表明用途），与「角色信息」「对话与指令」等 Tab 风格一致。
  if (inline) {
    return (
      <div style={{ width: '100%' }}>
        {tabsElement}
        {generateModalElement}
      </div>
    );
  }

  // ====== 弹窗模式：独立 Modal（供 ChatHeader 按钮调用） ======
  return (
    <Modal
      title={`素材与特征管理 - ${characterName}`}
      open={open}
      onCancel={onClose}
      width={960}
      style={{ top: 20 }}
      styles={{
        body: {
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
          paddingRight: 8,
        },
      }}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      {tabsElement}
      {generateModalElement}
    </Modal>
  );
};

export default AssetManagerModal;
