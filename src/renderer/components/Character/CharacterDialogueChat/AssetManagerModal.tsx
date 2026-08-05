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
import { Modal, Button, Input, message, Spin, Empty, Tooltip, Tabs, Tag, Collapse, Select, Dropdown } from 'antd';
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
} from '@ant-design/icons';
import {
  SYSTEM_TRAIT_CATEGORIES,
  UNCATEGORIZED_CATEGORY,
  UNCATEGORIZED_CATEGORY_ID,
} from '@shared/types';
import type { CharacterTraitItem, TraitCategory } from '@shared/types';
import { EMOTION_PRESETS } from './PromptBuilder';
import ImageCropperModal from './ImageCropperModal';
import AssetGenerateModal from './AssetGenerateModal';
import LoraSelectModal from './LoraSelectModal';
import { useExpressionStore } from '../../../stores/expressionStore';
import { useSettingStore } from '../../../stores/settingStore';
import type { CustomEmotion } from '../../../stores/expressionStore';
import { useAssetStore } from '../../../stores/assetStore';
import type { AssetType, ThreeViewSlot } from '../../../stores/assetStore';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
import { useCharacterLoraStore } from '../../../stores/characterLoraStore';
import { invalidateCharacterImageCache } from '../utils/characterThumbnailCache';

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
  const [newCustomKey, setNewCustomKey] = useState<string>('');
  const [newCustomLabel, setNewCustomLabel] = useState<string>('');
  const [addCustomLoading, setAddCustomLoading] = useState<boolean>(false);

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
    setNewCustomKey('');
    setNewCustomLabel('');
    setAddCustomOpen(true);
  }, []);

  const handleAddCustomCancel = useCallback(() => {
    setAddCustomOpen(false);
    setNewCustomKey('');
    setNewCustomLabel('');
  }, []);

  /**
   * 提交添加自定义情绪：
   * - 校验 key 格式（^[a-z][a-z0-9_]*$）
   * - 校验与预置/已有自定义 keys 不冲突
   * - 调用 addCustomEmotion，主进程负责 manifest.customEmotions 持久化
   */
  const handleAddCustomSubmit = useCallback(async () => {
    const key = newCustomKey.trim();
    const label = newCustomLabel.trim();

    if (!KEY_PATTERN.test(key)) {
      message.warning(
        '英文键需匹配 ^[a-z][a-z0-9_]*$（小写字母开头，仅含小写字母/数字/下划线）',
      );
      return;
    }
    if (!label) {
      message.warning('请填写中文标签');
      return;
    }
    if (EMOTION_PRESETS.some((e) => e.key === key)) {
      message.warning(`键 "${key}" 与预置情绪重复`);
      return;
    }
    if (manifest?.customEmotions?.some((e) => e.key === key)) {
      message.warning(`键 "${key}" 已存在`);
      return;
    }
    if (!characterCardId) return;

    setAddCustomLoading(true);
    try {
      const result = await addCustomEmotion(characterCardId, key, label);
      if (result.success) {
        message.success('自定义情绪已添加');
        setAddCustomOpen(false);
        setNewCustomKey('');
        setNewCustomLabel('');
      } else {
        message.error(result.error || '添加自定义情绪失败');
      }
    } finally {
      setAddCustomLoading(false);
    }
  }, [newCustomKey, newCustomLabel, manifest, characterCardId, addCustomEmotion]);

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

      {/* 添加自定义情绪弹窗 */}
      <Modal
        title="添加自定义情绪"
        open={addCustomOpen}
        onCancel={handleAddCustomCancel}
        onOk={handleAddCustomSubmit}
        confirmLoading={addCustomLoading}
        okText="添加"
        cancelText="取消"
        width={460}
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
              英文键（仅小写字母/数字/下划线，字母开头）
            </label>
            <Input
              value={newCustomKey}
              onChange={(e) => setNewCustomKey(e.target.value)}
              placeholder="如 shyness"
              autoFocus
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: 6,
                fontSize: 12,
                color: 'var(--text-secondary, #94a3b8)',
              }}
            >
              中文标签
            </label>
            <Input
              value={newCustomLabel}
              onChange={(e) => setNewCustomLabel(e.target.value)}
              placeholder="如 害羞"
            />
          </div>
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {assetIds.map((assetId) => {
            const dataUrl = typeImageCache[assetId];
            return (
              <div
                key={assetId}
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
                  {dataUrl ? (
                    <>
                      <img
                        src={dataUrl}
                        alt={assetId}
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
                        onClick={() => handlePreview(dataUrl)}
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
                    <span style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 11 }}>
                      图片加载中
                    </span>
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
                  {assetType === 'illustration' && dataUrl && (
                    <Tooltip title="设为角色卡图片">
                      <Button
                        size="small"
                        type="text"
                        icon={<SwapOutlined />}
                        onClick={() => handleReplaceCardImage(dataUrl)}
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
                      onClick={() => handleDeleteAsset(assetId)}
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
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
  const {
    imageCache,
    loading,
    loadAssets,
    saveAsset,
    deleteAsset,
  } = useAssetStore();

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
          {/* 裸体版三视图（生成时自动过滤 clothing 分类特征） */}
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
                生成时自动过滤「衣物配饰」分类特征
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
    createCategory,
    renameCategory,
    deleteCategory,
    moveTrait,
    toggleTraitEnabled,
    saveCombination,
    applyCombination,
    deleteCombination,
    // 【动态场景指令】Spec: add-dynamic-scene-prompt-generation / Task 6
    // - dynamicScenePrompts / activeDynamicScenePromptId：方案列表 + 当前激活 id（用于下拉与同步）
    // - saveDynamicScenePrompt / applyDynamicScenePrompt / deleteDynamicScenePrompt：方案 CRUD
    //   （updateDynamicScenePrompt 暂未在 UI 中使用，故不订阅以避免 noUnusedLocals 报错）
    dynamicScenePrompts,
    activeDynamicScenePromptId,
    saveDynamicScenePrompt,
    applyDynamicScenePrompt,
    deleteDynamicScenePrompt,
  } = useCharacterTraitStore();

  // ====== 检测当前 AI 引擎是否支持视觉（图片识别） ======
  const { setting } = useSettingStore();
  // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
  // 不再使用全局 setting.sdWebui.selectedLoras，改为按角色卡独立持久化
  const { loras: characterLoras, loadLoras: loadCharacterLoras, saveLoras: saveCharacterLoras } = useCharacterLoraStore();
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
  /** 角色外观描述本地编辑态（与 store 同步） */
  const [editingDescription, setEditingDescription] = useState<string>('');
  /** LoRA 选择弹窗开关 */
  const [loraModalOpen, setLoraModalOpen] = useState<boolean>(false);
  /** 折叠面板折叠集合（按分类 id；不在集合中则展开，新增分类自动展开） */
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());

  // ====== 动态场景指令本地状态（Spec: add-dynamic-scene-prompt-generation / Task 6） ======
  /** 自然语言指令输入（TextArea 值，AI 解析的源文本） */
  const [dynamicInput, setDynamicInput] = useState<string>('');
  /** 解析结果预览 - 服装（可编辑，覆盖 AI 原始结果） */
  const [parsedClothing, setParsedClothing] = useState<string>('');
  /** 解析结果预览 - 动作（可编辑，覆盖 AI 原始结果） */
  const [parsedPose, setParsedPose] = useState<string>('');
  /** 解析结果预览 - 场景（可编辑，覆盖 AI 原始结果） */
  const [parsedScene, setParsedScene] = useState<string>('');
  /** AI 解析中标志（控制「AI 解析」按钮 loading） */
  const [parsing, setParsing] = useState<boolean>(false);
  /** 方案名输入（保存为方案时使用） */
  const [schemeName, setSchemeName] = useState<string>('');

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

  // ====== 动态场景指令：激活动态场景方案变化时同步解析字段（Spec: add-dynamic-scene-prompt-generation / Task 6） ======
  // 当 activeDynamicScenePromptId 变化时（用户切换方案 / 保存新方案自动激活），
  // 从 store 中查找方案并填充 parsedClothing / parsedPose / parsedScene，
  // 让用户在切换方案后立即看到方案内容（Spec Scenario: 切换激活的动态场景方案）。
  // 无激活方案（null）时不强制清空，保留用户当前编辑或 AI 解析结果。
  useEffect(() => {
    if (!activeDynamicScenePromptId) return;
    const scheme = dynamicScenePrompts.find((p) => p.id === activeDynamicScenePromptId);
    if (scheme) {
      setParsedClothing(scheme.clothing || '');
      setParsedPose(scheme.pose || '');
      setParsedScene(scheme.scene || '');
    }
  }, [activeDynamicScenePromptId, dynamicScenePrompts]);

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

  // ====== 派生数据：基础特征拼接（动态场景指令 Task 6 用于 IPC baseTraits 参数 + 完整预览） ======
  // 仅拼接 enabled=true 的特征 text，逗号分隔
  const baseTraitsText = useMemo(
    () => traits.filter((t) => t.enabled).map((t) => t.text).join(', '),
    [traits],
  );

  // ====== 派生数据：完整提示词预览（基础特征 + clothing + pose + scene，跳过空值） ======
  // 随 parsedClothing / parsedPose / parsedScene 编辑实时更新
  const fullPromptPreview = useMemo(() => {
    const parts: string[] = [];
    if (baseTraitsText) parts.push(baseTraitsText);
    const c = parsedClothing.trim();
    const p = parsedPose.trim();
    const s = parsedScene.trim();
    if (c) parts.push(c);
    if (p) parts.push(p);
    if (s) parts.push(s);
    return parts.join(', ');
  }, [baseTraitsText, parsedClothing, parsedPose, parsedScene]);

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

  // ====== 保存特征（v2 签名：saveTraits(cardId, appearanceDescription?)） ======
  const handleSaveTraits = useCallback(async () => {
    if (!characterCardId) return;
    setSaving(true);
    try {
      // 保存时持久化完整 v2 数据（traits / combinations / activeCombinationId + 外观描述 + 动态场景方案）
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
        if (setResult.success) {
          if (result.traits.length === 0) {
            message.info('AI 未能从角色描述中提取到视觉特征，请手动添加');
          } else {
            const modeText = supportsVision ? '（综合图片+文本）' : '（仅文本描述）';
            message.success(`AI 生成了 ${result.traits.length} 个特征${modeText}，请确认后点击「保存」`);
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

  // ====== 组合方案：应用（SubTask 5.1） ======
  // 选择「手动模式」（__manual__）时不调 applyCombination，仅展示
  // （手动模式由 toggleTraitEnabled 自动触发 activeCombinationId=null）
  const handleApplyCombination = useCallback(
    (combinationId: string) => {
      if (combinationId === '__manual__') return;
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
        const result = saveCombination(trimmed);
        if (result.success) {
          message.success(`方案「${trimmed}」已保存`);
          setPromptModal((s) => ({ ...s, open: false }));
        } else {
          message.warning(result.error || '保存组合失败');
        }
      },
    });
  }, [enabledCount, saveCombination]);

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

  // ==================== 动态场景指令 handlers（Spec: add-dynamic-scene-prompt-generation / Task 6） ====================

  // ====== AI 解析自然语言为服装/动作/场景三组 SD tag（SubTask 6.2） ======
  // 调用 window.electronAPI.ai.generateDynamicScenePrompts IPC，传入 NL 输入与基础特征上下文。
  // 成功后填充 parsedClothing / parsedPose / parsedScene 供用户编辑预览。
  const handleParseDynamicScene = useCallback(async () => {
    const trimmed = dynamicInput.trim();
    if (!trimmed) {
      message.warning('请输入动态场景指令');
      return;
    }
    setParsing(true);
    try {
      const result = await window.electronAPI.ai.generateDynamicScenePrompts({
        naturalLanguageInput: trimmed,
        baseTraits: baseTraitsText || undefined,
      });
      if (result?.success) {
        setParsedClothing(result.clothing || '');
        setParsedPose(result.pose || '');
        setParsedScene(result.scene || '');
        message.success('AI 解析完成，可在下方编辑后保存为方案');
      } else {
        message.error(result?.error || 'AI 解析失败');
      }
    } catch (error) {
      console.error('[CharacterTraitTabContent] AI 解析动态场景失败:', error);
      message.error(error instanceof Error ? error.message : 'AI 解析失败');
    } finally {
      setParsing(false);
    }
  }, [dynamicInput, baseTraitsText]);

  // ====== 保存为方案（SubTask 6.5） ======
  // 调用 store.saveDynamicScenePrompt，创建方案并自动激活。
  // sourceCommand 透传原始 NL 输入，用于溯源。保存成功后清空 NL 输入与方案名。
  // 注：parsedClothing / pose / scene 由 useEffect（activeDynamicScenePromptId 变化）自动同步为新方案内容。
  const handleSaveDynamicScene = useCallback(async () => {
    const trimmedName = schemeName.trim();
    if (!trimmedName) {
      message.warning('请输入方案名');
      return;
    }
    const result = await saveDynamicScenePrompt(
      trimmedName,
      parsedClothing.trim(),
      parsedPose.trim(),
      parsedScene.trim(),
      dynamicInput.trim(),
    );
    if (result.success) {
      message.success(`方案「${trimmedName}」已保存并激活`);
      // 清空 NL 输入与方案名（parsed* 字段会被 useEffect 同步为新激活方案的内容）
      setSchemeName('');
      setDynamicInput('');
    } else {
      message.error(result.error || '保存方案失败');
    }
  }, [schemeName, parsedClothing, parsedPose, parsedScene, dynamicInput, saveDynamicScenePrompt]);

  // ====== 切换激活动态场景方案（SubTask 6.5） ======
  // Select onChange 回调，调用 store.applyDynamicScenePrompt 持久化激活 id。
  const handleApplyDynamicScene = useCallback(
    async (id: string) => {
      const result = await applyDynamicScenePrompt(id);
      if (!result.success) {
        message.warning(result.error || '应用方案失败');
      }
    },
    [applyDynamicScenePrompt],
  );

  // ====== 删除当前激活动态场景方案（SubTask 6.5） ======
  // Modal.confirm 二次确认后调用 store.deleteDynamicScenePrompt。
  // store 内部会在删除激活方案时自动重置 activeDynamicScenePromptId 为 null。
  const handleDeleteDynamicScene = useCallback(() => {
    if (!activeDynamicScenePromptId) return;
    const scheme = dynamicScenePrompts.find((p) => p.id === activeDynamicScenePromptId);
    if (!scheme) return;
    Modal.confirm({
      title: '删除动态场景方案',
      content: `确认删除方案「${scheme.name}」？若它是当前激活方案，将重置为无激活状态。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await deleteDynamicScenePrompt(activeDynamicScenePromptId);
        if (result.success) {
          message.success('方案已删除');
        } else {
          message.error(result.error || '删除方案失败');
        }
      },
    });
  }, [activeDynamicScenePromptId, dynamicScenePrompts, deleteDynamicScenePrompt]);

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
        <span
          onClick={() => handleStartEdit(trait.id)}
          style={{ cursor: 'text', lineHeight: '20px' }}
        >
          {trait.text}
        </span>
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
              ...combinations.map((c) => ({ value: c.id, label: c.name })),
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <Input
              value={newTrait}
              onChange={(e) => setNewTrait(e.target.value)}
              placeholder="输入新特征 tag，如 white fur, blue eyes"
              onPressEnter={handleAddTrait}
              style={{
                flex: '1 1 200px',
                background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                color: 'var(--text-primary, #e2e8f0)',
              }}
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

          {/* ====== 动态场景指令面板（Spec: add-dynamic-scene-prompt-generation / Task 6） ====== */}
          {/* 默认折叠，紫色边框区分于特征分类面板。包含 NL 输入 + AI 解析 + 三组可编辑 tag + 完整预览 + 方案 CRUD */}
          <Collapse
            defaultActiveKey={[]}
            style={{
              marginTop: 16,
              marginBottom: 16,
              background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.3))',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              borderRadius: 8,
            }}
            items={[
              {
                key: 'dynamic-scene',
                label: (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#a78bfa',
                      fontWeight: 600,
                    }}
                  >
                    <ThunderboltOutlined />
                    动态场景指令
                    <span
                      style={{
                        color: 'var(--text-tertiary, #6b7280)',
                        fontSize: 11,
                        fontWeight: 400,
                      }}
                    >
                      （AI 解析自然语言为服装 / 动作 / 场景提示词，独立于基础特征）
                    </span>
                  </span>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* SubTask 6.2：NL 输入 + AI 解析按钮 */}
                    <div>
                      <div
                        style={{
                          color: 'var(--text-secondary, #94a3b8)',
                          fontSize: 12,
                          marginBottom: 6,
                        }}
                      >
                        自然语言指令：
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <Input.TextArea
                          value={dynamicInput}
                          onChange={(e) => setDynamicInput(e.target.value)}
                          placeholder="输入动态场景指令，如：让角色穿上一套哥特风的衣服，骑着摩托驰骋在高速公路上"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          style={{
                            flex: 1,
                            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                            color: 'var(--text-primary, #e2e8f0)',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                          }}
                        />
                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={parsing}
                          onClick={handleParseDynamicScene}
                          style={{
                            background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                            borderColor: 'transparent',
                          }}
                        >
                          AI 解析
                        </Button>
                      </div>
                    </div>

                    {/* SubTask 6.3：解析结果预览 - 三个可编辑 TextArea（clothing=蓝 / pose=绿 / scene=橙） */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label
                          style={{
                            color: '#60a5fa',
                            fontSize: 12,
                            marginBottom: 4,
                            display: 'block',
                          }}
                        >
                          服装 (clothing)
                        </label>
                        <Input.TextArea
                          value={parsedClothing}
                          onChange={(e) => setParsedClothing(e.target.value)}
                          autoSize={{ minRows: 1, maxRows: 3 }}
                          placeholder="如：gothic dress, black lace, choker, dark makeup"
                          style={{
                            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                            color: 'var(--text-primary, #e2e8f0)',
                            borderColor: 'rgba(96, 165, 250, 0.3)',
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            color: '#52c41a',
                            fontSize: 12,
                            marginBottom: 4,
                            display: 'block',
                          }}
                        >
                          动作 (pose)
                        </label>
                        <Input.TextArea
                          value={parsedPose}
                          onChange={(e) => setParsedPose(e.target.value)}
                          autoSize={{ minRows: 1, maxRows: 3 }}
                          placeholder="如：riding motorcycle, holding handlebars, leaning forward"
                          style={{
                            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                            color: 'var(--text-primary, #e2e8f0)',
                            borderColor: 'rgba(82, 196, 26, 0.3)',
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            color: '#f59e0b',
                            fontSize: 12,
                            marginBottom: 4,
                            display: 'block',
                          }}
                        >
                          场景 (scene)
                        </label>
                        <Input.TextArea
                          value={parsedScene}
                          onChange={(e) => setParsedScene(e.target.value)}
                          autoSize={{ minRows: 1, maxRows: 3 }}
                          placeholder="如：highway, motion blur, sunset, road"
                          style={{
                            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                            color: 'var(--text-primary, #e2e8f0)',
                            borderColor: 'rgba(245, 158, 11, 0.3)',
                          }}
                        />
                      </div>
                    </div>

                    {/* SubTask 6.4：完整提示词预览（基础特征 + clothing + pose + scene，只读、等宽字体、实时更新） */}
                    <div>
                      <div
                        style={{
                          color: 'var(--text-secondary, #94a3b8)',
                          fontSize: 12,
                          marginBottom: 4,
                        }}
                      >
                        完整提示词预览（基础特征 + 动态场景）：
                      </div>
                      <Input.TextArea
                        value={fullPromptPreview}
                        readOnly
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        placeholder="（基础特征 + 服装 + 动作 + 场景 将在此处实时拼接显示）"
                        style={{
                          background: 'rgba(15, 15, 26, 0.6)',
                          color: 'var(--text-secondary, #94a3b8)',
                          borderColor: 'rgba(255, 255, 255, 0.08)',
                          fontFamily: 'monospace',
                          fontSize: 12,
                        }}
                      />
                    </div>

                    {/* SubTask 6.5：保存 / 切换 / 删除 */}
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <Input
                        value={schemeName}
                        onChange={(e) => setSchemeName(e.target.value)}
                        placeholder="方案名，如：哥特公路"
                        onPressEnter={handleSaveDynamicScene}
                        style={{
                          flex: '1 1 180px',
                          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                          borderColor: 'rgba(255, 255, 255, 0.1)',
                          color: 'var(--text-primary, #e2e8f0)',
                        }}
                      />
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleSaveDynamicScene}
                        style={{
                          background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                          borderColor: 'transparent',
                        }}
                      >
                        保存为方案
                      </Button>
                      <span
                        style={{
                          color: 'var(--text-secondary, #94a3b8)',
                          fontSize: 12,
                          marginLeft: 4,
                        }}
                      >
                        已保存方案
                      </span>
                      <Select
                        value={activeDynamicScenePromptId ?? undefined}
                        placeholder="未激活"
                        onChange={handleApplyDynamicScene}
                        style={{ width: 180 }}
                        options={dynamicScenePrompts.map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                      />
                      <Tooltip title="删除当前激活动态场景方案">
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          disabled={!activeDynamicScenePromptId}
                          onClick={handleDeleteDynamicScene}
                        />
                      </Tooltip>
                    </div>

                    {/* 提示文字 */}
                    <div
                      style={{
                        color: 'var(--text-tertiary, #6b7280)',
                        fontSize: 11,
                      }}
                    >
                      提示：AI 解析后可手动编辑三组 tag，保存为方案后将在立绘 / 一般图像生成时自动携带。
                      切换方案可一键加载已保存的服装 / 动作 / 场景。
                    </div>
                  </div>
                ),
              },
            ]}
          />

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
