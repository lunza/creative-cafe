import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Button, Input, message, Spin, Empty, Tooltip } from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  PlusOutlined,
  CloseOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  EditOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { EMOTION_PRESETS } from './PromptBuilder';
import ImageCropperModal from './ImageCropperModal';
// Spec: add-ai-expression-generation / Task 5
import ExpressionGenerateModal from './ExpressionGenerateModal';
import { useExpressionStore } from '../../../stores/expressionStore';
import type { CustomEmotion } from '../../../stores/expressionStore';

/**
 * 表情管理弹窗（Spec: add-character-expression-system / Task 7）
 *
 * 职责：
 * - 渲染 30 个预置情绪 + 用户自定义情绪的网格，展示每个情绪的当前表情缩略图
 * - 上传流程：file input → FileReader → ImageCropperModal → saveExpression
 * - 删除流程：删除单张表情图（Modal.confirm）→ deleteExpression
 * - 自定义情绪：添加（key/label 校验 + addCustomEmotion）/ 移除类别（removeCustomEmotion）
 *
 * 数据来源：`useExpressionStore`（Zustand）。保存/删除后 store 同步更新本地 manifest
 * 与 imageCache，UI 通过引用变化自动重渲染，无需显式 reload。
 *
 * UI 风格：暗色主题 + inline styles + 项目 CSS 变量，参照 CharacterEditModal /
 * ChatMessageBubble / ImageCropperModal 一致。
 *
 * 【重点标记 - 错误展示策略】store.error 仅以 inline 横幅展示，避免 toast 重复弹出；
 * 具体操作的失败（save/delete/add/remove）由对应 handler 通过 message.error 反馈。
 */

interface ExpressionManagerModalProps {
  open: boolean;
  characterCardId: string;
  characterName: string;
  /** 默认表情（角色卡 PNG）预览，用于 default 卡片 + 未上传情绪的占位 */
  avatarPath?: string;
  onClose: () => void;
}

/** 自定义情绪英文键校验正则（与主进程 expressionService 保持一致） */
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const ExpressionManagerModal: React.FC<ExpressionManagerModalProps> = ({
  open,
  characterCardId,
  characterName,
  avatarPath,
  onClose,
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
    updateCustomEmotion,
  } = useExpressionStore();
  // TODO(perf): 整体订阅，待拆分为 selector（7 字段，>5 暂缓）

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

  // ====== 编辑自定义情绪状态（Spec: enhance-custom-emotion-system） ======
  const [editCustomOpen, setEditCustomOpen] = useState<boolean>(false);
  const [editCustomKey, setEditCustomKey] = useState<string>('');
  const [editCustomLabel, setEditCustomLabel] = useState<string>('');
  const [editCustomPositive, setEditCustomPositive] = useState<string>('');
  const [editCustomNlPrompt, setEditCustomNlPrompt] = useState<string>('');
  const [editCustomLoading, setEditCustomLoading] = useState<boolean>(false);
  const [editGeneratingPrompts, setEditGeneratingPrompts] = useState<boolean>(false);

  // ====== AI 生成表情弹窗状态（Spec: add-ai-expression-generation / Task 5） ======
  const [generateModalOpen, setGenerateModalOpen] = useState<boolean>(false);
  const [generateMode, setGenerateMode] = useState<'batch' | 'single'>('batch');
  const [generateTargetKey, setGenerateTargetKey] = useState<string | undefined>(undefined);
  const [generateTargetLabel, setGenerateTargetLabel] = useState<string | undefined>(undefined);

  // 隐藏的 file input ref（用于触发文件选择对话框）
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ====== 打开时加载表情包 ======
  useEffect(() => {
    if (open && characterCardId) {
      loadExpressions(characterCardId);
    }
  }, [open, characterCardId, loadExpressions]);

  // ====== 关闭时重置局部状态（避免下次打开残留裁剪/表单状态） ======
  const resetCropperState = useCallback(() => {
    setCropperOpen(false);
    setCropperImageSrc(null);
    setCropperTargetKey(null);
    setCropperIsCustom(false);
    setCropperLabel('');
  }, []);

  useEffect(() => {
    if (!open) {
      resetCropperState();
      setAddCustomOpen(false);
      setNewCustomLabel('');
    }
  }, [open, resetCropperState]);

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
        // store 已同步本地 imageCache；为保险起见可触发一次 reload 同步服务端状态，
        // 但为了避免网格闪烁，这里依赖 store 的乐观更新。
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

  // ====== 添加自定义情绪（简化流程：用户仅输入中文词，AI 自动生成全部字段） ======

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
        console.warn('[ExpressionManagerModal] AI key still conflicts after avoidance, using fallback:', finalKey);
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

  // ====== 编辑自定义情绪（Spec: enhance-custom-emotion-system） ======

  const handleEditCustomOpen = useCallback((emotion: CustomEmotion) => {
    setEditCustomKey(emotion.key);
    setEditCustomLabel(emotion.label);
    setEditCustomPositive(emotion.prompts?.positive || '');
    setEditCustomNlPrompt(emotion.prompts?.nlPrompt || '');
    setEditCustomOpen(true);
  }, []);

  const handleEditCustomCancel = useCallback(() => {
    setEditCustomOpen(false);
    setEditCustomKey('');
    setEditCustomLabel('');
    setEditCustomPositive('');
    setEditCustomNlPrompt('');
  }, []);

  const handleEditCustomSubmit = useCallback(async () => {
    if (!characterCardId || !editCustomKey) return;

    const label = editCustomLabel.trim();
    if (!label) {
      message.warning('请填写中文标签');
      return;
    }

    setEditCustomLoading(true);
    try {
      const prompts = editCustomPositive
        ? { positive: editCustomPositive, nlPrompt: editCustomNlPrompt || `${label} expression` }
        : undefined;

      const result = await updateCustomEmotion(characterCardId, editCustomKey, label, prompts);
      if (result.success) {
        message.success('自定义情绪已更新');
        setEditCustomOpen(false);
      } else {
        message.error(result.error || '更新自定义情绪失败');
      }
    } finally {
      setEditCustomLoading(false);
    }
  }, [characterCardId, editCustomKey, editCustomLabel, editCustomPositive, editCustomNlPrompt, updateCustomEmotion]);

  /**
   * 编辑弹窗中重新生成提示词。
   */
  const handleEditGeneratePrompts = useCallback(async () => {
    if (!editCustomLabel.trim()) {
      message.warning('请先输入中文标签');
      return;
    }
    setEditGeneratingPrompts(true);
    try {
      const result = await window.electronAPI.ai.generateEmotionPrompts({
        emotionLabel: editCustomLabel.trim(),
      });
      if (result?.success && result.positive) {
        setEditCustomPositive(result.positive);
        setEditCustomNlPrompt(result.nlPrompt || '');
        message.success('提示词生成成功');
      } else {
        message.error(result?.error || '提示词生成失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提示词生成异常');
    } finally {
      setEditGeneratingPrompts(false);
    }
  }, [editCustomLabel]);

  // ====== AI 生成流程（Spec: add-ai-expression-generation / Task 5） ======

  /**
   * 打开「AI 生成全部表情」弹窗。
   * 若已有任何表情图（manifest.expressions 非空），先弹出二次确认避免误覆盖。
   */
  const handleBatchGenerate = useCallback(() => {
    const hasExisting =
      !!manifest?.expressions && Object.keys(manifest.expressions).length > 0;
    if (hasExisting) {
      Modal.confirm({
        title: '覆盖现有表情？',
        content: '部分情绪已有表情图片，AI 生成将覆盖这些表情。是否继续？',
        okText: '覆盖并生成',
        cancelText: '取消',
        onOk: () => {
          setGenerateMode('batch');
          setGenerateTargetKey(undefined);
          setGenerateTargetLabel(undefined);
          setGenerateModalOpen(true);
        },
      });
    } else {
      setGenerateMode('batch');
      setGenerateTargetKey(undefined);
      setGenerateTargetLabel(undefined);
      setGenerateModalOpen(true);
    }
  }, [manifest]);

  /**
   * 打开「AI 生成单张表情」弹窗（针对某个具体情绪）。
   * stopPropagation 由调用方在按钮 onClick 中处理，避免触发卡片父级事件。
   */
  const handleSingleGenerate = useCallback(
    (emotionKey: string, label: string) => {
      setGenerateMode('single');
      setGenerateTargetKey(emotionKey);
      setGenerateTargetLabel(label);
      setGenerateModalOpen(true);
    },
    [],
  );

  // ====== 渲染辅助 ======

  const customEmotions: CustomEmotion[] = manifest?.customEmotions ?? [];
  const hasCharacter = !!characterCardId;

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
          <span
            style={{
              color: '#cbd5e1',
              fontSize: 24,
              fontWeight: 600,
            }}
          >
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
          {/* 缩略图（正方形） */}
          <div
            style={{
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
          >
            {thumbnail}
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
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary, #6b7280)',
                }}
              >
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
                {/* Spec: add-ai-expression-generation / Task 5 - 单张 AI 生成入口 */}
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
                  <>
                    <Tooltip title="编辑">
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          const emotion = customEmotions.find(em => em.key === emotionKey);
                          if (emotion) handleEditCustomOpen(emotion);
                        }}
                        style={{ color: 'var(--primary-color, #6366f1)' }}
                      />
                    </Tooltip>
                    <Tooltip title="移除类别">
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<CloseOutlined />}
                        onClick={() => handleRemoveCustomEmotion(emotionKey)}
                      />
                    </Tooltip>
                  </>
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
      customEmotions,
      handleUploadClick,
      handleDeleteImage,
      handleRemoveCustomEmotion,
      handleSingleGenerate,
      handleEditCustomOpen,
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

  // ====== 主渲染 ======
  return (
    <>
      <Modal
        title={`表情管理 - ${characterName}`}
        open={open}
        onCancel={onClose}
        width={900}
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

          {/* Spec: add-ai-expression-generation / Task 5 - 批量 AI 生成入口 */}
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
      </Modal>

      {/* 图片裁剪弹窗（始终挂载，由 cropperOpen 控制可见） */}
      <ImageCropperModal
        open={cropperOpen}
        imageSrc={cropperImageSrc}
        onConfirm={handleCropperConfirm}
        onCancel={handleCropperCancel}
      />

      {/* Spec: add-ai-expression-generation / Task 5 - AI 生成表情弹窗 */}
      <ExpressionGenerateModal
        open={generateModalOpen}
        characterCardId={characterCardId}
        characterName={characterName}
        avatarPath={avatarPath}
        mode={generateMode}
        targetEmotionKey={generateTargetKey}
        targetEmotionLabel={generateTargetLabel}
        onClose={() => setGenerateModalOpen(false)}
        onGenerated={() => {
          // 生成完成后刷新 store，展示新生成的图片
          loadExpressions(characterCardId);
        }}
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
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
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

      {/* 编辑自定义情绪弹窗（Spec: enhance-custom-emotion-system） */}
      <Modal
        title={`编辑自定义情绪 - ${editCustomLabel || editCustomKey}`}
        open={editCustomOpen}
        onCancel={handleEditCustomCancel}
        onOk={handleEditCustomSubmit}
        confirmLoading={editCustomLoading}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
              英文键（不可修改）
            </label>
            <Input value={editCustomKey} disabled />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
              中文标签
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={editCustomLabel}
                onChange={(e) => setEditCustomLabel(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button
                icon={<ExperimentOutlined />}
                onClick={handleEditGeneratePrompts}
                loading={editGeneratingPrompts}
                disabled={!editCustomLabel.trim()}
              >
                重新生成提示词
              </Button>
            </div>
          </div>

          {editGeneratingPrompts && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Spin tip="正在生成提示词..." />
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
              SD 提示词（可编辑）
            </label>
            <Input.TextArea
              value={editCustomPositive}
              onChange={(e) => setEditCustomPositive(e.target.value)}
              rows={3}
              placeholder="点击「重新生成提示词」自动生成，或手动输入"
              style={{ fontSize: 12 }}
            />
          </div>
          {editCustomNlPrompt && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
                NL 自然语言描述
              </label>
              <div style={{ padding: '6px 8px', background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.6))', borderRadius: 4, fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
                {editCustomNlPrompt}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default ExpressionManagerModal;
