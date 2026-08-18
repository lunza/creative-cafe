/**
 * 用户人设图片生成弹窗（轻量化版本）
 *
 * 参考 AssetGenerateModal 的立绘生成模式，但简化为：
 *  - 纯 txt2img 文生图（无 img2img / 表情 / 三视图）
 *  - 特征从人设 JSON 直接读取（无 characterTraitStore / categoryDictionary 依赖）
 *  - 无 LoRA 选择（人设图片生成不需要角色 LoRA）
 *  - 生成结果保存到 persona-assets 目录
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Input, message, Spin, Tag, Space, Tooltip } from 'antd';
import {
  ReloadOutlined,
  SaveOutlined,
  PictureOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { PersonaTrait } from '../Character/CharacterDialogueChat/CharacterDialogueChat.types';
import type { SDWebuiConfig } from '../../types/setting';

const { TextArea } = Input;

const DEFAULT_SD_CONFIG: SDWebuiConfig = {
  endpoint: 'http://localhost:7860',
  model: '',
  denoisingStrength: 0.55,
  steps: 28,
  cfgScale: 7,
  sampler: 'DPM++ 3M SDE',
  scheduler: 'Karras',
  clipSkip: 2,
  adetailerEnabled: true,
  positivePromptTemplate:
    'portrait, {traits}, looking_at_viewer, simple_background, high quality, best quality, masterpiece, detailed face',
  customNegativePrompt: '',
  adModel: 'face_yolov8n.pt',
  adConfidence: 0.3,
  adDenoisingStrength: 0.3,
  adMaskBlur: 8,
  adDilateErode: 8,
  adInpaintOnlyMasked: true,
  adInpaintOnlyMaskedPadding: 64,
  adUseInpaintWidthHeight: true,
  adInpaintWidth: 1024,
  adInpaintHeight: 1024,
  adUseSteps: true,
  adSteps: 30,
  adUseCfgScale: true,
  adCfgScale: 5.0,
  adUseSampler: true,
  adSampler: 'DPM++ 2M SDE',
  adScheduler: 'Use same scheduler',
  adNegativePrompt: '',
  adUseNoiseMultiplier: true,
  adNoiseMultiplier: 1.0,
  adModelClasses: '',
  modelType: 'sdxl',
  nlPromptTemplate:
    'A portrait of a character. {traits} The character is looking at the viewer. High quality, detailed.',
  txt2imgWidth: 1024,
  txt2imgHeight: 1024,
  selectedLoras: [],
  hrFixEnabled: true,
  hrUpscaler: '4x-AnimeSharp',
  hrSteps: 50,
  hrScale: 2.0,
  hrDenoisingStrength: 0.55,
  hrPrompt: '',
  hrNegativePrompt: '',
  hrCfg: 5.0,
  hrSamplerName: 'DPM++ 2M SDE',
  hrScheduler: 'Karras',
  img2imgExtraNoise: 0.05,
  initialNoiseMultiplier: 1.0,
  img2imgHiresMode: 'two-step',
};

const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

interface PersonaImageGenerateModalProps {
  open: boolean;
  personaId: string;
  personaName: string;
  traits: PersonaTrait[];
  onClose: () => void;
  onSaved?: () => void;
}

const PersonaImageGenerateModal: React.FC<PersonaImageGenerateModalProps> = ({
  open,
  personaId,
  personaName,
  traits,
  onClose,
  onSaved,
}) => {
  const [sdConfig, setSdConfig] = useState<SDWebuiConfig>(DEFAULT_SD_CONFIG);
  const [sdStatus, setSdStatus] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [sdError, setSdError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initializedRef = useRef(false);

  // 启用的特征文本
  const enabledTraits = traits.filter((t) => t.enabled);
  const enabledTraitTexts = enabledTraits.map((t) => ({ text: t.text }));

  // 初始化加载 SD 配置 + 检测状态
  useEffect(() => {
    if (!open || !personaId) return;

    let cancelled = false;
    setInitializing(true);
    setSdStatus('checking');
    setSdError(null);
    setGeneratedImage(null);

    (async () => {
      try {
        // 1. 加载 SD 设置
        let config: SDWebuiConfig = DEFAULT_SD_CONFIG;
        try {
          const settingResult = await window.electronAPI.setting.load();
          if (settingResult?.success && settingResult.setting?.sdWebui) {
            config = { ...DEFAULT_SD_CONFIG, ...settingResult.setting.sdWebui };
          }
        } catch (e) {
          console.warn('[PersonaImageGen] 加载 SD 设置失败:', e);
        }
        if (cancelled) return;
        setSdConfig(config);

        // 2. 初始化提示词（仅首次打开时）
        if (!initializedRef.current) {
          const template = config.modelType !== 'sdxl'
            ? config.nlPromptTemplate
            : config.positivePromptTemplate;
          setPositivePrompt(template || DEFAULT_SD_CONFIG.positivePromptTemplate!);
          setNegativePrompt(config.customNegativePrompt || '');
          initializedRef.current = true;
        }

        // 3. 检测 SD WebUI 状态
        try {
          const statusResult = await window.electronAPI.sd.checkStatus(config.endpoint);
          if (cancelled) return;
          if (statusResult?.available) {
            setSdStatus('available');
          } else {
            setSdStatus('unavailable');
            setSdError(statusResult?.error || '未知错误');
          }
        } catch (e) {
          if (cancelled) return;
          setSdStatus('unavailable');
          setSdError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, personaId]);

  // 重置初始化标记（弹窗关闭时）
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
    }
  }, [open]);

  // 构建 SD 生成选项（复用 buildSdOptionsFromConfig 的简化版）
  const buildSdOptions = useCallback(() => {
    return {
      endpoint: sdConfig.endpoint,
      denoisingStrength: sdConfig.denoisingStrength,
      steps: sdConfig.steps,
      cfgScale: sdConfig.cfgScale,
      sampler: sdConfig.sampler,
      scheduler: sdConfig.scheduler,
      clipSkip: sdConfig.clipSkip,
      adetailerEnabled: sdConfig.adetailerEnabled,
      model: sdConfig.model || undefined,
      characterTraits: enabledTraitTexts,
      adModel: sdConfig.adModel,
      adConfidence: sdConfig.adConfidence,
      adDenoisingStrength: sdConfig.adDenoisingStrength,
      adMaskBlur: sdConfig.adMaskBlur,
      adDilateErode: sdConfig.adDilateErode,
      adInpaintOnlyMasked: sdConfig.adInpaintOnlyMasked,
      adInpaintOnlyMaskedPadding: sdConfig.adInpaintOnlyMaskedPadding,
      adUseInpaintWidthHeight: sdConfig.adUseInpaintWidthHeight,
      adInpaintWidth: sdConfig.adInpaintWidth,
      adInpaintHeight: sdConfig.adInpaintHeight,
      adUseSteps: sdConfig.adUseSteps,
      adSteps: sdConfig.adSteps,
      adUseCfgScale: sdConfig.adUseCfgScale,
      adCfgScale: sdConfig.adCfgScale,
      adUseSampler: sdConfig.adUseSampler,
      adSampler: sdConfig.adSampler,
      adScheduler: sdConfig.adScheduler,
      adNegativePrompt: sdConfig.adNegativePrompt,
      adUseNoiseMultiplier: sdConfig.adUseNoiseMultiplier,
      adNoiseMultiplier: sdConfig.adNoiseMultiplier,
      adModelClasses: sdConfig.adModelClasses,
      modelType: sdConfig.modelType,
      txt2imgWidth: sdConfig.txt2imgWidth ?? 1024,
      txt2imgHeight: sdConfig.txt2imgHeight ?? 1024,
      width: sdConfig.txt2imgWidth ?? 1024,
      height: sdConfig.txt2imgHeight ?? 1024,
      selectedLoras: [],
      hrFixEnabled: sdConfig.hrFixEnabled,
      hrUpscaler: sdConfig.hrUpscaler,
      hrSteps: sdConfig.hrSteps,
      hrScale: sdConfig.hrScale,
      hrDenoisingStrength: sdConfig.hrDenoisingStrength,
      hrPrompt: sdConfig.hrPrompt,
      hrNegativePrompt: sdConfig.hrNegativePrompt,
      hrCfg: sdConfig.hrCfg,
      hrSamplerName: sdConfig.hrSamplerName,
      hrScheduler: sdConfig.hrScheduler,
      img2imgExtraNoise: sdConfig.img2imgExtraNoise,
      initialNoiseMultiplier: sdConfig.initialNoiseMultiplier,
      img2imgHiresMode: sdConfig.img2imgHiresMode,
      sourceContext: { source: 'persona-manager' as const },
    };
  }, [sdConfig, enabledTraitTexts]);

  // 生成图片
  const handleGenerate = useCallback(async () => {
    if (sdStatus !== 'available') {
      message.warning('SD WebUI 不可用，请先启动并检查连接');
      return;
    }
    if (!positivePrompt.trim()) {
      message.warning('提示词不能为空');
      return;
    }

    setGenerating(true);
    setGeneratedImage(null);

    try {
      const result = await window.electronAPI.sd.generateTxt2Img({
        endpoint: sdConfig.endpoint,
        prompt: positivePrompt,
        negativePrompt: negativePrompt || undefined,
        options: buildSdOptions(),
      });

      if (result?.success && result.imageBase64) {
        const dataUrl = result.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
          ? result.imageBase64
          : PNG_DATA_URI_PREFIX + result.imageBase64;
        setGeneratedImage(dataUrl);
        message.success('图片生成成功');
      } else {
        message.error(result?.error || '生成失败');
      }
    } catch (e) {
      console.error('[PersonaImageGen] 生成异常:', e);
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [sdStatus, positivePrompt, negativePrompt, sdConfig.endpoint, buildSdOptions]);

  // 保存图片
  const handleSave = useCallback(async () => {
    if (!generatedImage || !personaId) {
      message.warning('无生成结果可保存');
      return;
    }

    setSaving(true);
    try {
      const imageId = `persona-${Date.now()}`;
      const result = await window.electronAPI.personaAsset.save({
        personaId,
        imageId,
        imageBase64: generatedImage,
      });

      if (result?.success) {
        message.success('保存成功');
        onSaved?.();
      } else {
        message.error(result?.error || '保存失败');
      }
    } catch (e) {
      console.error('[PersonaImageGen] 保存异常:', e);
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [generatedImage, personaId, onSaved]);

  // 重新生成（清除当前结果）
  const handleRegenerate = useCallback(() => {
    setGeneratedImage(null);
  }, []);

  return (
    <Modal
      open={open}
      title={`${personaName} - 立绘生成`}
      width={900}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          {generatedImage && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              保存到素材库
            </Button>
          )}
        </Space>
      }
      destroyOnClose
    >
      {initializing ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin tip="正在初始化..." />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* SD 状态 */}
          <div>
            {sdStatus === 'available' ? (
              <Tag color="green">SD WebUI 已连接 {sdConfig.model && `· ${sdConfig.model}`}</Tag>
            ) : (
              <Tag color="red">SD WebUI 不可用：{sdError}</Tag>
            )}
          </div>

          {/* 特征展示 */}
          {enabledTraits.length > 0 && (
            <div>
              <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                视觉特征（{enabledTraits.length} 个已启用）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {enabledTraits.map((t, i) => (
                  <Tooltip key={i} title={t.translation || ''}>
                    <Tag color="blue">{t.text}</Tag>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* 正面提示词 */}
          <div>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
              正面提示词（{'{traits}'} 占位符将被替换为上方特征）
            </div>
            <TextArea
              value={positivePrompt}
              onChange={(e) => setPositivePrompt(e.target.value)}
              rows={3}
              placeholder="portrait, {traits}, looking_at_viewer, simple_background, high quality"
            />
          </div>

          {/* 负面提示词 */}
          <div>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
              负面提示词
            </div>
            <TextArea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="lowres, bad anatomy, bad hands, text, error, missing fingers"
            />
          </div>

          {/* 生成按钮 */}
          <div>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
              loading={generating}
              disabled={sdStatus !== 'available'}
              size="large"
            >
              {generating ? '生成中...' : '生成图片'}
            </Button>
          </div>

          {/* 生成结果 */}
          {generating && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin tip="正在生成图片，请耐心等待..." />
            </div>
          )}

          {generatedImage && !generating && (
            <div style={{ textAlign: 'center' }}>
              <img
                src={generatedImage}
                alt="生成结果"
                style={{
                  maxWidth: '100%',
                  maxHeight: 500,
                  borderRadius: 8,
                  border: '1px solid var(--border-base)',
                }}
              />
              <div style={{ marginTop: 8 }}>
                <Button icon={<ReloadOutlined />} onClick={handleRegenerate}>
                  重新生成
                </Button>
              </div>
            </div>
          )}

          {!generatedImage && !generating && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
              <PictureOutlined style={{ fontSize: 48, opacity: 0.3 }} />
              <p style={{ marginTop: 8 }}>点击「生成图片」开始</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default PersonaImageGenerateModal;
