/**
 * AI 引擎采样参数交互区（Spec: settings-feature-optimization-report / N8, L-5）
 *
 * 对话模式 ParameterPanel 富交互范式迁移到设置页：
 * - 主采样参数：滑块 + 精确输入框双驱动（普通用户拖动，专业用户直接输入）
 * - 防重复强度三档预设（宽松/标准/严格）：复用对话模式 ANTI_REPEAT_PRESETS，
 *   避免用户不理解 freq/pres/dry 关系导致过度惩罚叠加
 * - 引擎级采样（rep_pen + DRY 组）：能力门控显隐（supportsRepPen /
 *   supportsDrySampler 决定滑块显隐，保守策略——未探测到能力时不显示，
 *   避免给不支持的后端误配），从「隐藏字段 setFieldsValue」变为可见可调
 *
 * 主表单与引擎编辑 Modal 表单共用本组件。字段名与保存链路
 * （settingMapper.mapEngineFormValues）严格一致。
 */
import React from 'react';
import { Form, Slider, InputNumber, Button, Tooltip, Collapse, Space } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import { AIEngineCapabilities } from '../../types/setting';
import { ENGINE_SAMPLING_CONFIGS, ENGINE_DRY_CONFIGS, EngineSamplingConfig } from './engineSamplingParams';
// 防重复三档预设复用对话模式常量（单一数据源，防两处数值漂移）
import { ANTI_REPEAT_PRESETS, AntiRepeatPreset } from '../Character/CharacterDialogueChat/parameterConfigs';

interface SliderInputProps {
  /** Form.Item 注入的表单值（未交互过为 undefined） */
  value?: number;
  /** Form.Item 注入的写回回调 */
  onChange?: (value: number | null) => void;
  min: number;
  max: number;
  step: number;
  /** 无表单值时的显示兜底（不写回表单，避免幻影脏检测） */
  defaultValue: number;
}

/** 滑块 + 精确输入框双驱动（滑块拖动与直接输入写同一表单字段） */
const SliderInput: React.FC<SliderInputProps> = ({ value, onChange, min, max, step, defaultValue }) => {
  const display = typeof value === 'number' ? value : defaultValue;
  const isInteger = step >= 1;
  const format = (v: number) => (isInteger ? Math.round(v).toString() : Number(v).toFixed(2));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Slider
        style={{ flex: 1, margin: '0 8px' }}
        min={min}
        max={max}
        step={step}
        value={display}
        onChange={v => onChange?.(v)}
        tooltip={{ formatter: v => (v === undefined ? '' : format(v)) }}
      />
      <InputNumber
        min={min}
        max={max}
        step={step}
        value={typeof value === 'number' ? value : undefined}
        placeholder={String(defaultValue)}
        style={{ width: 92 }}
        onChange={v => onChange?.(v)}
      />
    </div>
  );
};

interface EngineSamplingSectionProps {
  /** 所属表单（主表单或引擎编辑 Modal 表单） */
  form: FormInstance;
  /** 引擎能力探测结果，决定 rep_pen / DRY 滑块显隐（保守策略：未探测不显示） */
  capabilities?: AIEngineCapabilities;
}

/** 渲染单个采样参数 Form.Item（元数据驱动；Form 上下文由外层 <Form> 提供） */
const renderSamplingItem = (config: EngineSamplingConfig): React.ReactNode => (
  <Form.Item
    key={config.key}
    label={config.label}
    name={config.key}
    tooltip={config.tooltip}
  >
    <SliderInput
      min={config.min}
      max={config.max}
      step={config.step}
      defaultValue={config.defaultValue}
    />
  </Form.Item>
);

/**
 * AI 引擎采样参数交互区。
 *
 * 防重复预设选中态与点击语义与对话模式 ParameterPanel 一致：
 * - 选中态：freq/pres（+DRY 后端的 dry_multiplier）与某档预设完全匹配时高亮
 * - 点击：一次性写入三参数；后端不支持 DRY 时跳过 dry_multiplier
 */
const EngineSamplingSection: React.FC<EngineSamplingSectionProps> = ({ form, capabilities }) => {
  const supportsRepPen = capabilities?.supportsRepPen === true;
  const supportsDry = capabilities?.supportsDrySampler === true;
  const visibleDryConfigs = ENGINE_DRY_CONFIGS.filter(c => capabilities?.[c.capability!] === true);

  // 预设选中态反推（监听三个表单字段）
  // 【重点标记 - 回归走查发现崩溃】antd v6 的 Form.useWatch 不再支持「多字段数组」
  // 参数——rc-component/form 的 getNamePath(toArray) 把 ['a','b','c'] 当成单条
  // 嵌套路径 store.a.b.c，getValue 返回 undefined，下方解构
  // `const [freq, pres, dry] = undefined` 抛 TypeError: undefined is not iterable
  // （无错误边界 → 整树卸载白屏）。改三个独立 useWatch（官方当前推荐用法）。
  const freq = Form.useWatch('frequency_penalty', form);
  const pres = Form.useWatch('presence_penalty', form);
  const dry = Form.useWatch('dry_multiplier', form);
  const activePresetKey: AntiRepeatPreset['key'] | null = (() => {
    const f = Number(freq);
    const p = Number(pres);
    const d = Number(dry);
    for (const preset of ANTI_REPEAT_PRESETS) {
      const freqMatch = f === preset.values.frequency_penalty;
      const presMatch = p === preset.values.presence_penalty;
      if (supportsDry) {
        if (freqMatch && presMatch && d === preset.values.dry_multiplier) return preset.key;
      } else if (freqMatch && presMatch) {
        // 非 DRY 后端：预设点击不写 dry_multiplier，仅凭 freq+pres 判定
        return preset.key;
      }
    }
    return null;
  })();

  const handlePresetClick = (preset: AntiRepeatPreset) => {
    form.setFieldsValue({
      frequency_penalty: preset.values.frequency_penalty,
      presence_penalty: preset.values.presence_penalty,
      // 后端不支持 DRY 采样时跳过 dry_multiplier（与对话模式语义一致）
      ...(supportsDry ? { dry_multiplier: preset.values.dry_multiplier } : {}),
    });
  };

  return (
    <>
      {ENGINE_SAMPLING_CONFIGS.map(renderSamplingItem)}

      {/* 防重复强度三档预设 */}
      <Form.Item
        label="防重复强度预设"
        tooltip="宽松=关闭所有防重复（适合创意写作）；标准=轻微惩罚（兼顾流畅性与防重复）；严格=强惩罚（适合重复严重的长文，可能导致回复缩短）"
      >
        <Space>
          {ANTI_REPEAT_PRESETS.map(preset => (
            <Button
              key={preset.key}
              size="small"
              type={activePresetKey === preset.key ? 'primary' : 'default'}
              onClick={() => handlePresetClick(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </Space>
      </Form.Item>

      {/* 引擎级采样（重复惩罚 + DRY 防重复）：能力门控，未探测到能力不显示 */}
      {visibleDryConfigs.length > 0 && (
        <Collapse
          ghost
          items={[{
            key: 'engine-dry',
            label: (
              <span>
                高级采样参数（重复惩罚 / DRY 防重复）
                <Tooltip title="仅当前引擎探测到对应能力时显示。DRY 采样借鉴 SillyTavern，作为防重复的采样层第二道防线。">
                  <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999' }} />
                </Tooltip>
              </span>
            ),
            children: (
              <>
                {visibleDryConfigs.map(renderSamplingItem)}
              </>
            ),
          }]}
        />
      )}

      {/* 能力未探测提示：用户知道为何看不到高级采样参数 */}
      {!supportsRepPen && !supportsDry && (
        <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
          未探测到重复惩罚/DRY 采样能力——点击「测试连通性」探测模型能力后，
          对应的高级采样参数将在此显示。
        </div>
      )}
    </>
  );
};

export default EngineSamplingSection;
