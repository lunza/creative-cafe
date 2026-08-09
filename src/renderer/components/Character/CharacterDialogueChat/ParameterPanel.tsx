import React, { useState, useCallback, useEffect } from 'react';
import { Tooltip, Button, Slider, Switch, Input, Select } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined, DownOutlined, RightOutlined, SlidersOutlined, ExperimentOutlined } from '@ant-design/icons';
import { AIParameterConfig, EffectiveAIParams, ThinkTagMode } from './CharacterDialogueChat.types';
import { EngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import {
  PARAMETER_CONFIGS,
  DRY_PARAMETER_CONFIGS,
  ParameterConfig,
  ANTI_REPEAT_PRESETS,
  AntiRepeatPreset,
  MIN_RESPONSE_CHARS_CONFIG,
} from './parameterConfigs';
import './ConfigPanel.css';

const { TextArea } = Input;

interface ParameterPanelProps {
  effectiveParams: EffectiveAIParams;
  customParameters: AIParameterConfig | undefined;
  onParameterChange: (params: Partial<AIParameterConfig>) => void;
  onResetParameters: () => void;
  // 自定义停止序列（Spec: optimize-chat-ai-intelligence / Task 3.4）
  customStopSequencesEnabled?: boolean;
  customStopSequences?: string[];
  onCustomStopSequencesToggle?: (enabled: boolean) => void;
  onCustomStopSequencesChange?: (stops: string[]) => void;
  // Think 标签处理三态选择
  thinkTagMode?: ThinkTagMode;
  onThinkTagModeChange?: (mode: ThinkTagMode) => void;
  // 辅助模式开关（Spec: add-assist-mode-options）
  assistMode?: boolean;
  onAssistModeToggle?: (enabled: boolean) => void;
  // 语言要求
  language?: 'zh' | 'en' | 'ja';
  onLanguageChange?: (language: 'zh' | 'en' | 'ja') => void;
  /**
   * 后端能力探测结果（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）。
   * 决定 repetition_penalty 滑块与 DRY 采样折叠区的显隐。
   * 缺省时按"保守"策略：不显示 capability-gated 滑块（避免给不支持的后端误配）。
   */
  engineCapabilities?: EngineCapabilities;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  effectiveParams,
  customParameters,
  onParameterChange,
  onResetParameters,
  customStopSequencesEnabled = false,
  customStopSequences = [],
  onCustomStopSequencesToggle,
  onCustomStopSequencesChange,
  thinkTagMode = 'strip',
  onThinkTagModeChange,
  assistMode = false,
  onAssistModeToggle,
  language = 'zh',
  onLanguageChange,
  engineCapabilities,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('param-panel-collapsed');
    return saved === 'true';
  });
  const [localValues, setLocalValues] = useState<AIParameterConfig>(
    customParameters || {}
  );
  // 自定义停止序列 TextArea 的本地文本（每行一个停止串），便于用户编辑
  const [stopSequencesText, setStopSequencesText] = useState<string>(
    Array.isArray(customStopSequences) ? customStopSequences.join('\n') : ''
  );
  // 高级采样参数折叠区状态（默认收起，避免 UI 过载）
  // Spec: optimize-chat-ai-intelligence / Task 6.4
  const [advancedCollapsed, setAdvancedCollapsed] = useState(() => {
    const saved = localStorage.getItem('param-panel-advanced-collapsed');
    // 默认收起（'true' 或 null 都视为收起；仅 'false' 时展开）
    return saved !== 'false';
  });

  useEffect(() => {
    localStorage.setItem('param-panel-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem('param-panel-advanced-collapsed', String(advancedCollapsed));
  }, [advancedCollapsed]);

  // 当外部 customStopSequences 变化时（如切换角色卡），同步本地文本
  useEffect(() => {
    setStopSequencesText(Array.isArray(customStopSequences) ? customStopSequences.join('\n') : '');
  }, [customStopSequences]);

  const handleSliderChange = useCallback((key: keyof AIParameterConfig, value: number) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSliderAfterChange = useCallback((key: keyof AIParameterConfig, value: number) => {
    const configDef = [...PARAMETER_CONFIGS, ...DRY_PARAMETER_CONFIGS].find(c => c.key === key);
    const effectiveValue = value;
    const defaultValue = configDef?.defaultValue;

    if (defaultValue !== undefined && Math.abs(effectiveValue - defaultValue) < 0.001) {
      const newValues = { ...localValues };
      delete newValues[key];
      setLocalValues(newValues);
      const newCustomParams = { ...(customParameters || {}) };
      delete newCustomParams[key];
      if (Object.keys(newCustomParams).length === 0) {
        onParameterChange({});
      } else {
        onParameterChange(newCustomParams);
      }
    } else {
      onParameterChange({ [key]: value });
    }
  }, [localValues, customParameters, onParameterChange]);

  const handleReset = useCallback(() => {
    setLocalValues({});
    onResetParameters();
  }, [onResetParameters]);

  // 自定义停止序列：TextArea 失焦时解析行并持久化
  const handleStopSequencesBlur = useCallback(() => {
    if (!onCustomStopSequencesChange) return;
    const stops = stopSequencesText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    onCustomStopSequencesChange(stops);
  }, [stopSequencesText, onCustomStopSequencesChange]);

  // 防重复强度预设：点击时一次性写入 frequency_penalty / presence_penalty / dry_multiplier
  // Spec: fix-ai-response-length-degradation / Task 5.2 / 5.4
  // 当后端不支持 DRY 采样时，仅写入 freq + pres，跳过 dry_multiplier（但仍允许点击所有预设）。
  const handlePresetClick = useCallback((preset: AntiRepeatPreset) => {
    const supportsDry = engineCapabilities?.supportsDrySampler === true;
    const newValues: Partial<AIParameterConfig> = {
      frequency_penalty: preset.values.frequency_penalty,
      presence_penalty: preset.values.presence_penalty,
    };
    if (supportsDry) {
      newValues.dry_multiplier = preset.values.dry_multiplier;
    }
    // 同步 localValues，使下方滑块立即反映预设值
    setLocalValues(prev => ({ ...prev, ...newValues }));
    onParameterChange(newValues);
  }, [engineCapabilities, onParameterChange]);

  // min_response_chars Slider 的 onAfterChange 处理
  // Spec: fix-ai-response-length-degradation / Task 7.3 / 7.4
  // 与 handleSliderAfterChange 模式一致：值等于默认值时从 customParameters 中移除字段，
  // 避免"已使用自定义参数"徽章误显示；值不等于默认值时持久化到 customParameters。
  const handleMinResponseCharsAfterChange = useCallback((value: number) => {
    if (Math.abs(value - MIN_RESPONSE_CHARS_CONFIG.defaultValue) < 0.001) {
      // 等于默认值：从 customParameters 与 localValues 中移除该字段
      const newLocalValues = { ...localValues };
      delete newLocalValues.min_response_chars;
      setLocalValues(newLocalValues);
      const newCustomParams = { ...(customParameters || {}) };
      delete newCustomParams.min_response_chars;
      if (Object.keys(newCustomParams).length === 0) {
        onParameterChange({});
      } else {
        onParameterChange(newCustomParams);
      }
    } else {
      setLocalValues(prev => ({ ...prev, min_response_chars: value }));
      onParameterChange({ min_response_chars: value });
    }
  }, [localValues, customParameters, onParameterChange]);

  const isCustomized = customParameters && Object.keys(customParameters).length > 0;

  // 按 capabilities 过滤主参数配置（Spec: Task 6.1）
  // 缺省 capabilities 时，capability-gated 项不显示（保守策略，避免给不支持的后端误配）
  const visibleParameterConfigs = PARAMETER_CONFIGS.filter(config => {
    if (!config.capability) return true;
    return engineCapabilities?.[config.capability] === true;
  });

  // DRY 采样折叠区仅在 supportsDrySampler=true 时显示
  const showDrySection = engineCapabilities?.supportsDrySampler === true;

  // 防重复强度预设选中态：根据 customParameters 中三个参数的实际值反推
  // Spec: fix-ai-response-length-degradation / Task 5.3
  // 仅当 freq/pres/dry 三者（DRY 模式）或 freq/pres 两者（非 DRY 模式）均与某预设
  // 完全匹配时高亮该预设；否则不高亮。Number() 强制转换后用 === 严格比较
  // （undefined 经 Number() 变为 NaN，与任何数字 === 均为 false，自然不匹配）。
  const activePresetKey: AntiRepeatPreset['key'] | null = (() => {
    const cp = customParameters || {};
    const supportsDry = engineCapabilities?.supportsDrySampler === true;
    const freq = Number(cp.frequency_penalty);
    const pres = Number(cp.presence_penalty);
    const dry = Number(cp.dry_multiplier);
    for (const preset of ANTI_REPEAT_PRESETS) {
      const freqMatch = freq === preset.values.frequency_penalty;
      const presMatch = pres === preset.values.presence_penalty;
      if (supportsDry) {
        const dryMatch = dry === preset.values.dry_multiplier;
        if (freqMatch && presMatch && dryMatch) return preset.key;
      } else {
        // 非 DRY 后端：预设点击时不会写入 dry_multiplier，故仅凭 freq+pres 判定
        if (freqMatch && presMatch) return preset.key;
      }
    }
    return null;
  })();

  // 回复长度引导当前值与修改态
  // Spec: fix-ai-response-length-degradation / Task 7.2
  const currentMinResponseChars =
    localValues.min_response_chars ?? customParameters?.min_response_chars ?? MIN_RESPONSE_CHARS_CONFIG.defaultValue;
  const minResponseCharsModified = localValues.min_response_chars !== undefined;

  // 渲染单个滑块项（主参数与 DRY 参数共用）
  const renderSlider = (config: ParameterConfig) => {
    const rawValue = localValues[config.key] ?? effectiveParams[config.key];
    const currentValue = typeof rawValue === 'number' ? rawValue : config.defaultValue;
    const isModified = localValues[config.key] !== undefined;
    const isInteger = config.step >= 1;

    return (
      <div key={config.key} className="parameter-item">
        <div className="parameter-header">
          <div className="parameter-label-group">
            <span className="parameter-label">{config.label}</span>
            <Tooltip title={config.tooltip}>
              <QuestionCircleOutlined className="parameter-tooltip-icon" />
            </Tooltip>
          </div>
          <span className={`parameter-value ${isModified ? 'modified' : ''}`}>
            {config.key === 'max_tokens' && currentValue === 0
              ? '无限制'
              : isInteger
                ? Math.round(currentValue).toString()
                : Number(currentValue).toFixed(2)}
          </span>
        </div>
        <Slider
          min={config.min}
          max={config.max}
          step={config.step}
          value={currentValue}
          onChange={(value) => handleSliderChange(config.key, value)}
          onAfterChange={(value) => handleSliderAfterChange(config.key, value as number)}
          className="parameter-slider"
        />
      </div>
    );
  };

  return (
    <div className="parameter-panel">
      <div className="parameter-panel-header" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
        <div className="parameter-panel-title">
          <div className="parameter-collapse-icon">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </div>
          <SlidersOutlined className="parameter-icon" />
          <span>AI 参数配置</span>
          <Tooltip title="调整AI模型生成的参数，控制输出的长度、随机性和多样性">
            <QuestionCircleOutlined className="parameter-tooltip-icon" />
          </Tooltip>
        </div>
        {!collapsed && (
          <div className="parameter-panel-header-right">
            {isCustomized && (
              <Tooltip title="已使用自定义参数">
                <span className="parameter-custom-badge">自定义</span>
              </Tooltip>
            )}
          </div>
        )}
        {collapsed && isCustomized && (
          <span className="parameter-custom-badge-mini">!</span>
        )}
      </div>

      <div className={`parameter-panel-content ${collapsed ? 'collapsed' : ''}`}>
        <div className="parameter-panel-inner">
          <div className="parameter-list">
            {visibleParameterConfigs.map(renderSlider)}
          </div>

          <div className="parameter-actions">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={handleReset}
              disabled={!isCustomized}
              className="parameter-reset-btn"
            >
              重置为默认值
            </Button>
          </div>

          {/* 防重复强度预设（Spec: fix-ai-response-length-degradation / Task 5） */}
          {/* 三档预设避免用户不理解 freq/pres/dry 关系导致过度惩罚叠加，从而过度缩短回复。 */}
          <div className="parameter-anti-repeat-preset-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="parameter-label-group" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span className="parameter-label" style={{ fontSize: 13 }}>防重复强度预设</span>
              <Tooltip title="防重复强度预设。宽松=关闭所有防重复；标准=轻微惩罚；严格=强惩罚（可能导致回复缩短）">
                <QuestionCircleOutlined className="parameter-tooltip-icon" />
              </Tooltip>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {ANTI_REPEAT_PRESETS.map(preset => (
                <Button
                  key={preset.key}
                  size="small"
                  type={activePresetKey === preset.key ? 'primary' : 'default'}
                  onClick={() => handlePresetClick(preset)}
                  style={{ flex: 1 }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 回复长度引导（Spec: fix-ai-response-length-degradation / Task 7） */}
          {/* Slider 写入 customParameters.min_response_chars，PromptBuilder 读取并注入系统提示末尾。 */}
          <div className="parameter-min-response-chars-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="parameter-header">
              <div className="parameter-label-group">
                <span className="parameter-label" style={{ fontSize: 13 }}>回复长度引导</span>
                <Tooltip title={MIN_RESPONSE_CHARS_CONFIG.tooltip}>
                  <QuestionCircleOutlined className="parameter-tooltip-icon" />
                </Tooltip>
              </div>
              <span className={`parameter-value ${minResponseCharsModified ? 'modified' : ''}`}>
                {currentMinResponseChars}
              </span>
            </div>
            <Slider
              min={MIN_RESPONSE_CHARS_CONFIG.min}
              max={MIN_RESPONSE_CHARS_CONFIG.max}
              step={MIN_RESPONSE_CHARS_CONFIG.step}
              value={currentMinResponseChars}
              onChange={(value) => handleSliderChange('min_response_chars', value)}
              onAfterChange={(value) => handleMinResponseCharsAfterChange(value as number)}
              className="parameter-slider"
            />
          </div>

          {/* 语言要求 */}
          <div className="parameter-language-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="parameter-language-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="parameter-label-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="parameter-label" style={{ fontSize: 13 }}>语言</span>
                <Tooltip title="控制 AI 回复使用的语言。默认中文。">
                  <QuestionCircleOutlined className="parameter-tooltip-icon" />
                </Tooltip>
              </div>
              <Select
                size="small"
                value={language}
                onChange={onLanguageChange}
                style={{ width: 100 }}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                  { value: 'ja', label: '日本語' },
                ]}
              />
            </div>
          </div>

          {/* Think 标签处理（合并原 strip_think_tags + show_thinking 两开关） */}
          <div className="parameter-think-tag-mode-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="parameter-think-tag-mode-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="parameter-label-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="parameter-label" style={{ fontSize: 13 }}>思考内容处理</span>
                <Tooltip title="控制 AI 回复中 think/thinking/thought 推理标签的处理方式。移除：存储前彻底剥离；仅渲染剥离：存储保留但界面不可见；折叠展示：以可展开折叠块显示 AI 思考过程。">
                  <QuestionCircleOutlined className="parameter-tooltip-icon" />
                </Tooltip>
              </div>
              <Select
                size="small"
                value={thinkTagMode}
                onChange={onThinkTagModeChange}
                style={{ width: 120 }}
                options={[
                  { value: 'strip', label: '移除' },
                  { value: 'strip_render', label: '仅渲染剥离' },
                  { value: 'fold', label: '折叠展示' },
                ]}
              />
            </div>
          </div>

          {/* 自定义停止序列配置区（Spec: optimize-chat-ai-intelligence / Task 3.4） */}
          {/* 借鉴 SillyTavern names_as_stop_strings 防抢话机制；默认用户名变体停止序列已内置，
              此处供用户追加自定义停止串，与默认数组合并注入请求体 stop 字段。 */}
          <div className="parameter-stop-sequences-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="parameter-stop-sequences-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="parameter-label-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="parameter-label" style={{ fontSize: 13 }}>自定义停止序列</span>
                <Tooltip title="开启后，下方每行一个停止串将与默认用户名变体停止序列（如 \n用户:、\n张三: 等）合并写入请求体 stop 字段，用于阻断 AI 代替用户发言或重复角色名。默认已内置中英文用户名变体，此处仅需追加额外停止串。">
                  <QuestionCircleOutlined className="parameter-tooltip-icon" />
                </Tooltip>
              </div>
              <Switch
                size="small"
                checked={customStopSequencesEnabled}
                onChange={onCustomStopSequencesToggle}
              />
            </div>
            {customStopSequencesEnabled && (
              <TextArea
                value={stopSequencesText}
                onChange={(e) => setStopSequencesText(e.target.value)}
                onBlur={handleStopSequencesBlur}
                placeholder="每行一个停止串，例如：&#10;\n助理:&#10;\nAssistant:&#10;<END>"
                autoSize={{ minRows: 2, maxRows: 6 }}
                style={{ fontSize: 12, fontFamily: 'monospace' }}
              />
            )}
          </div>

          {/* 辅助模式（Spec: add-assist-mode-options） */}
          {/* 开启后，AI 在常规回复之外额外生成 3 个推荐选项，用户可点击选项快速填入输入框 */}
          <div className="parameter-assist-mode-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="parameter-assist-mode-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="parameter-label-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="parameter-label" style={{ fontSize: 13 }}>辅助模式</span>
                <Tooltip title="开启后，AI 在每次回复正文之外额外生成 3 个推荐选项（类似 Galgame 剧情选项），用户可点击选项快速填入输入框进行润色或直接发送，降低输入负担并引导对话推进。默认关闭。">
                  <QuestionCircleOutlined className="parameter-tooltip-icon" />
                </Tooltip>
              </div>
              <Switch
                size="small"
                checked={assistMode}
                onChange={onAssistModeToggle}
              />
            </div>
          </div>

          {/* 高级采样参数折叠区（Spec: optimize-chat-ai-intelligence / Task 6.4） */}
          {/* DRY 采样作为防重复采样层第二道防线，与应用层 n-gram Jaccard 去重形成双重防护。
              仅当 engineCapabilities.supportsDrySampler=true 时显示。默认折叠避免 UI 过载。 */}
          {showDrySection && (
            <div className="parameter-advanced-section" style={{ paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
              <div
                className="parameter-advanced-header"
                onClick={() => setAdvancedCollapsed(!advancedCollapsed)}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: advancedCollapsed ? 0 : 12 }}
              >
                <div className="parameter-collapse-icon">
                  {advancedCollapsed ? <RightOutlined /> : <DownOutlined />}
                </div>
                <ExperimentOutlined className="parameter-icon" />
                <span className="parameter-label" style={{ fontSize: 13 }}>高级采样参数（DRY 防重复）</span>
                <Tooltip title="DRY 采样借鉴 SillyTavern textgen-settings.js，作为防重复的采样层第二道防线。与应用层 n-gram Jaccard 去重形成双重防护。仅 textgen-webui/koboldcpp 等后端支持。">
                  <QuestionCircleOutlined className="parameter-tooltip-icon" />
                </Tooltip>
              </div>
              {!advancedCollapsed && (
                <div className="parameter-list">
                  {DRY_PARAMETER_CONFIGS.map(renderSlider)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParameterPanel;
