/**
 * PARAMETER_CONFIGS / DRY_PARAMETER_CONFIGS / ANTI_REPEAT_PRESETS / MIN_RESPONSE_CHARS_CONFIG 单元测试
 *
 * 验证目标：
 * 1. PARAMETER_CONFIGS 默认值正确（top_p=0.95, frequency_penalty=0.1, presence_penalty=0.1, repetition_penalty=1.1）
 *    （Spec: fix-ai-response-length-degradation / Task 2 — freq/pres penalty 默认值从 0.3 调整为 0.1）
 * 2. repetition_penalty 配置标记了 capability='supportsRepPen'（supportsRepPen=false 时不显示）
 * 3. DRY_PARAMETER_CONFIGS 默认值正确（dry_multiplier=0.8, dry_base=1.75, dry_allowed_length=2, no_repeat_ngram_size=0）
 * 4. DRY 配置组仅在 supportsDrySampler=true 时显示（通过 capability 字段 + filter 逻辑验证）
 * 5. ANTI_REPEAT_PRESETS 三档预设值符合 spec（loose/standard/strict）
 *    （Spec: fix-ai-response-length-degradation / Task 5）
 * 6. MIN_RESPONSE_CHARS_CONFIG 配置正确（min=100, max=2000, defaultValue=300）
 *    （Spec: fix-ai-response-length-degradation / Task 7）
 *
 * Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4 / 6.6
 * Spec: fix-ai-response-length-degradation / Task 2 / 5 / 7 / 8.4
 */

import { describe, it, expect } from 'vitest';
import {
  PARAMETER_CONFIGS,
  DRY_PARAMETER_CONFIGS,
  ANTI_REPEAT_PRESETS,
  MIN_RESPONSE_CHARS_CONFIG,
  ParameterConfig,
  AntiRepeatPreset,
} from '../parameterConfigs';
import { EngineCapabilities } from '../../../Common/ChatEngine/ChatEngine.types';

/**
 * 模拟 ParameterPanel.tsx 中的 visibleParameterConfigs 过滤逻辑。
 *
 * ParameterPanel 按 engineCapabilities 过滤 PARAMETER_CONFIGS：
 *   - 无 capability 字段 → 始终显示
 *   - 有 capability 字段 → 仅当 engineCapabilities[capability] === true 时显示
 * 缺省 engineCapabilities 时，capability-gated 项不显示（保守策略）。
 */
function filterVisibleConfigs(
  configs: ParameterConfig[],
  engineCapabilities?: EngineCapabilities
): ParameterConfig[] {
  return configs.filter(config => {
    if (!config.capability) return true;
    return engineCapabilities?.[config.capability] === true;
  });
}

describe('PARAMETER_CONFIGS 默认值（Spec: Task 6.1）', () => {
  it('top_p 默认值为 0.95（原 0.9，借鉴 SillyTavern Default.json）', () => {
    const topP = PARAMETER_CONFIGS.find(c => c.key === 'top_p');
    expect(topP).toBeDefined();
    expect(topP!.defaultValue).toBe(0.95);
  });

  it('frequency_penalty 默认值为 0.1（Spec: fix-ai-response-length-degradation / Task 2 — 原 0.3 与 DRY 叠加导致回复缩短）', () => {
    const freqPen = PARAMETER_CONFIGS.find(c => c.key === 'frequency_penalty');
    expect(freqPen).toBeDefined();
    expect(freqPen!.defaultValue).toBe(0.1);
  });

  it('presence_penalty 默认值为 0.1（Spec: fix-ai-response-length-degradation / Task 2 — 原 0.3 与 DRY 叠加导致回复缩短）', () => {
    const presPen = PARAMETER_CONFIGS.find(c => c.key === 'presence_penalty');
    expect(presPen).toBeDefined();
    expect(presPen!.defaultValue).toBe(0.1);
  });

  it('temperature 默认值保留为 0.7（未调整）', () => {
    const temp = PARAMETER_CONFIGS.find(c => c.key === 'temperature');
    expect(temp).toBeDefined();
    expect(temp!.defaultValue).toBe(0.7);
  });

  it('max_tokens 默认值为 DEFAULT_MAX_TOKENS（8192）', () => {
    const maxTokens = PARAMETER_CONFIGS.find(c => c.key === 'max_tokens');
    expect(maxTokens).toBeDefined();
    expect(maxTokens!.defaultValue).toBe(8192);
  });

  it('repetition_penalty 默认值为 1.1（借鉴 SillyTavern rep_pen=1.1~1.2）', () => {
    const repPen = PARAMETER_CONFIGS.find(c => c.key === 'repetition_penalty');
    expect(repPen).toBeDefined();
    expect(repPen!.defaultValue).toBe(1.1);
  });

  it('repetition_penalty 范围为 0.8-1.5，步长 0.05', () => {
    const repPen = PARAMETER_CONFIGS.find(c => c.key === 'repetition_penalty');
    expect(repPen).toBeDefined();
    expect(repPen!.min).toBe(0.8);
    expect(repPen!.max).toBe(1.5);
    expect(repPen!.step).toBe(0.05);
  });

  it('repetition_penalty 标记了 capability=supportsRepPen', () => {
    const repPen = PARAMETER_CONFIGS.find(c => c.key === 'repetition_penalty');
    expect(repPen).toBeDefined();
    expect(repPen!.capability).toBe('supportsRepPen');
  });
});

describe('PARAMETER_CONFIGS 显隐过滤（Spec: Task 6.1 / 6.6 场景 2）', () => {
  it('supportsRepPen=false 时 repetition_penalty 滑块不显示', () => {
    const visible = filterVisibleConfigs(PARAMETER_CONFIGS, {
      supportsStopArray: true,
      supportsRepPen: false,
      supportsDrySampler: false,
    });
    const repPen = visible.find(c => c.key === 'repetition_penalty');
    expect(repPen).toBeUndefined();
  });

  it('supportsRepPen=true 时 repetition_penalty 滑块显示', () => {
    const visible = filterVisibleConfigs(PARAMETER_CONFIGS, {
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: false,
    });
    const repPen = visible.find(c => c.key === 'repetition_penalty');
    expect(repPen).toBeDefined();
  });

  it('engineCapabilities 缺省时 repetition_penalty 滑块不显示（保守策略）', () => {
    const visible = filterVisibleConfigs(PARAMETER_CONFIGS, undefined);
    const repPen = visible.find(c => c.key === 'repetition_penalty');
    expect(repPen).toBeUndefined();
  });

  it('无论 capabilities 如何，top_p / freq_pen / pres_pen / temperature / max_tokens 始终显示', () => {
    const alwaysVisibleKeys = ['max_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];
    // 即使所有 capabilities 都为 false
    const visible = filterVisibleConfigs(PARAMETER_CONFIGS, {
      supportsStopArray: false,
      supportsRepPen: false,
      supportsDrySampler: false,
    });
    for (const key of alwaysVisibleKeys) {
      expect(visible.find(c => c.key === key)).toBeDefined();
    }
  });
});

describe('DRY_PARAMETER_CONFIGS 默认值（Spec: Task 6.4 / 6.6 场景 3）', () => {
  it('dry_multiplier 默认值为 0.8（借鉴 SillyTavern textgen-settings.js）', () => {
    const dryMult = DRY_PARAMETER_CONFIGS.find(c => c.key === 'dry_multiplier');
    expect(dryMult).toBeDefined();
    expect(dryMult!.defaultValue).toBe(0.8);
  });

  it('dry_base 默认值为 1.75', () => {
    const dryBase = DRY_PARAMETER_CONFIGS.find(c => c.key === 'dry_base');
    expect(dryBase).toBeDefined();
    expect(dryBase!.defaultValue).toBe(1.75);
  });

  it('dry_allowed_length 默认值为 2', () => {
    const dryLen = DRY_PARAMETER_CONFIGS.find(c => c.key === 'dry_allowed_length');
    expect(dryLen).toBeDefined();
    expect(dryLen!.defaultValue).toBe(2);
  });

  it('no_repeat_ngram_size 默认值为 0（关闭，避免影响中文流畅性）', () => {
    const ngram = DRY_PARAMETER_CONFIGS.find(c => c.key === 'no_repeat_ngram_size');
    expect(ngram).toBeDefined();
    expect(ngram!.defaultValue).toBe(0);
  });

  it('dry_multiplier 范围 0-2，步长 0.1', () => {
    const dryMult = DRY_PARAMETER_CONFIGS.find(c => c.key === 'dry_multiplier');
    expect(dryMult!.min).toBe(0);
    expect(dryMult!.max).toBe(2);
    expect(dryMult!.step).toBe(0.1);
  });

  it('dry_base 范围 1-3，步长 0.05', () => {
    const dryBase = DRY_PARAMETER_CONFIGS.find(c => c.key === 'dry_base');
    expect(dryBase!.min).toBe(1);
    expect(dryBase!.max).toBe(3);
    expect(dryBase!.step).toBe(0.05);
  });

  it('dry_allowed_length 范围 1-10，步长 1', () => {
    const dryLen = DRY_PARAMETER_CONFIGS.find(c => c.key === 'dry_allowed_length');
    expect(dryLen!.min).toBe(1);
    expect(dryLen!.max).toBe(10);
    expect(dryLen!.step).toBe(1);
  });

  it('no_repeat_ngram_size 范围 0-10，步长 1', () => {
    const ngram = DRY_PARAMETER_CONFIGS.find(c => c.key === 'no_repeat_ngram_size');
    expect(ngram!.min).toBe(0);
    expect(ngram!.max).toBe(10);
    expect(ngram!.step).toBe(1);
  });

  it('DRY 配置组包含且仅包含 4 个参数', () => {
    expect(DRY_PARAMETER_CONFIGS).toHaveLength(4);
    const keys = DRY_PARAMETER_CONFIGS.map(c => c.key);
    expect(keys).toContain('dry_multiplier');
    expect(keys).toContain('dry_base');
    expect(keys).toContain('dry_allowed_length');
    expect(keys).toContain('no_repeat_ngram_size');
  });
});

describe('DRY 折叠区显隐（Spec: Task 6.6 场景 3）', () => {
  it('supportsDrySampler=false 时 DRY 折叠区不显示（showDrySection=false）', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: false,
    };
    // ParameterPanel 中：const showDrySection = engineCapabilities?.supportsDrySampler === true;
    const showDrySection = caps?.supportsDrySampler === true;
    expect(showDrySection).toBe(false);
  });

  it('supportsDrySampler=true 时 DRY 折叠区显示（showDrySection=true）', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: true,
    };
    const showDrySection = caps?.supportsDrySampler === true;
    expect(showDrySection).toBe(true);
  });

  it('engineCapabilities 缺省时 DRY 折叠区不显示（保守策略）', () => {
    // 使用 as 断言避免 TS 将 const caps 收窄为 undefined（never）类型
    const caps = undefined as EngineCapabilities | undefined;
    const showDrySection = caps?.supportsDrySampler === true;
    expect(showDrySection).toBe(false);
  });
});

describe('ANTI_REPEAT_PRESETS 防重复强度三档预设（Spec: fix-ai-response-length-degradation / Task 5 / 8.4）', () => {
  it('包含且仅包含 3 档预设', () => {
    expect(ANTI_REPEAT_PRESETS).toHaveLength(3);
  });

  it('预设 key 与 label 一一对应（loose/standard/strict）', () => {
    const keys = ANTI_REPEAT_PRESETS.map(p => p.key);
    expect(keys).toEqual(['loose', 'standard', 'strict']);
    // label 字段存在且非空
    for (const preset of ANTI_REPEAT_PRESETS) {
      expect(typeof preset.label).toBe('string');
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('loose 预设（宽松）：所有防重复参数为 0', () => {
    const loose = ANTI_REPEAT_PRESETS[0] as AntiRepeatPreset;
    expect(loose.key).toBe('loose');
    expect(loose.values.frequency_penalty).toBe(0);
    expect(loose.values.presence_penalty).toBe(0);
    expect(loose.values.dry_multiplier).toBe(0);
  });

  it('standard 预设（标准）：freq=0.1, pres=0.1, dry=0.4', () => {
    const standard = ANTI_REPEAT_PRESETS[1] as AntiRepeatPreset;
    expect(standard.key).toBe('standard');
    expect(standard.values.frequency_penalty).toBe(0.1);
    expect(standard.values.presence_penalty).toBe(0.1);
    expect(standard.values.dry_multiplier).toBe(0.4);
  });

  it('strict 预设（严格）：freq=0.3, pres=0.3, dry=0.8', () => {
    const strict = ANTI_REPEAT_PRESETS[2] as AntiRepeatPreset;
    expect(strict.key).toBe('strict');
    expect(strict.values.frequency_penalty).toBe(0.3);
    expect(strict.values.presence_penalty).toBe(0.3);
    expect(strict.values.dry_multiplier).toBe(0.8);
  });

  it('每个预设的 values 仅包含三个字段（frequency_penalty / presence_penalty / dry_multiplier）', () => {
    for (const preset of ANTI_REPEAT_PRESETS) {
      const valueKeys = Object.keys(preset.values).sort();
      expect(valueKeys).toEqual(['dry_multiplier', 'frequency_penalty', 'presence_penalty']);
    }
  });

  it('标准预设与新默认值一致（frequency_penalty=0.1, presence_penalty=0.1）', () => {
    // Spec Task 2 调整后的 PARAMETER_CONFIGS 默认值应与 standard 预设对齐
    const standard = ANTI_REPEAT_PRESETS[1];
    const freqPen = PARAMETER_CONFIGS.find(c => c.key === 'frequency_penalty');
    const presPen = PARAMETER_CONFIGS.find(c => c.key === 'presence_penalty');
    expect(standard.values.frequency_penalty).toBe(freqPen!.defaultValue);
    expect(standard.values.presence_penalty).toBe(presPen!.defaultValue);
  });
});

describe('MIN_RESPONSE_CHARS_CONFIG 回复长度引导配置（Spec: fix-ai-response-length-degradation / Task 7 / 8.4）', () => {
  it('defaultValue 为 300（spec 默认值）', () => {
    expect(MIN_RESPONSE_CHARS_CONFIG.defaultValue).toBe(300);
  });

  it('min 为 100（最低 100 字）', () => {
    expect(MIN_RESPONSE_CHARS_CONFIG.min).toBe(100);
  });

  it('max 为 2000（最高 2000 字）', () => {
    expect(MIN_RESPONSE_CHARS_CONFIG.max).toBe(2000);
  });

  it('step 为 50（步进 50）', () => {
    expect(MIN_RESPONSE_CHARS_CONFIG.step).toBe(50);
  });

  it('tooltip 字段存在且非空', () => {
    expect(typeof MIN_RESPONSE_CHARS_CONFIG.tooltip).toBe('string');
    expect(MIN_RESPONSE_CHARS_CONFIG.tooltip.length).toBeGreaterThan(0);
  });
});
