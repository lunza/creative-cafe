/**
 * 引擎采样参数元数据契约测试（Spec: settings-feature-optimization-report / N8, L-5）
 *
 * 元数据驱动渲染的安全网：新增/修改配置条目时，保证
 * - 字段名不与主参数重复（保存链路 mapEngineFormValues 消费同名键）
 * - 引擎级采样字段必带能力门控（未门控会对不支持的后端误配 4xx）
 * - 默认值落在滑块范围内（否则 Slider 初始值越界）
 * - 防重复三档预设值与滑块范围一致（预设点击值可被滑块精确表示）
 */
import { describe, it, expect } from 'vitest';
import {
  ENGINE_SAMPLING_CONFIGS,
  ENGINE_DRY_CONFIGS,
  ENGINE_DRY_FIELD_KEYS,
} from '../engineSamplingParams';
import { ANTI_REPEAT_PRESETS } from '../../Character/CharacterDialogueChat/parameterConfigs';
import type { AIEngineCapabilities } from '../../../types/setting';

const ALL_CONFIGS = [...ENGINE_SAMPLING_CONFIGS, ...ENGINE_DRY_CONFIGS];
const CAPABILITY_KEYS = new Set<string>([
  'supportsStopArray',
  'supportsRepPen',
  'supportsDrySampler',
  'supportsVision',
  'supportsThinking',
  'supportsToolCalling',
]);

describe('ENGINE_SAMPLING_CONFIGS / ENGINE_DRY_CONFIGS 元数据', () => {
  it('全部配置键名无重复（与保存链路 mapEngineFormValues 同名键消费）', () => {
    const keys = ALL_CONFIGS.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('引擎级采样字段全部带能力门控且为合法 capability 键', () => {
    for (const config of ENGINE_DRY_CONFIGS) {
      expect(config.capability, `${config.key} 缺少能力门控`).toBeTruthy();
      expect(CAPABILITY_KEYS.has(config.capability as string), `${config.key} 的 capability 非法`).toBe(true);
    }
  });

  it('主采样参数不带能力门控（始终显示）', () => {
    for (const config of ENGINE_SAMPLING_CONFIGS) {
      expect(config.capability).toBeUndefined();
    }
  });

  it('默认值落在滑块范围内', () => {
    for (const config of ALL_CONFIGS) {
      expect(config.defaultValue, `${config.key} 默认值越界`)
        .toBeGreaterThanOrEqual(config.min);
      expect(config.defaultValue, `${config.key} 默认值越界`)
        .toBeLessThanOrEqual(config.max);
    }
  });

  it('ENGINE_DRY_FIELD_KEYS 与 ENGINE_DRY_CONFIGS 键名同源', () => {
    expect([...ENGINE_DRY_FIELD_KEYS].sort()).toEqual(
      ENGINE_DRY_CONFIGS.map(c => c.key).sort()
    );
  });
});

describe('防重复三档预设与滑块范围一致', () => {
  it('三档预设的 freq/pres/dry_multiplier 均在对应滑块范围内', () => {
    const byKey = new Map(ALL_CONFIGS.map(c => [c.key, c]));
    for (const preset of ANTI_REPEAT_PRESETS) {
      for (const [key, value] of Object.entries(preset.values)) {
        const config = byKey.get(key);
        expect(config, `预设字段 ${key} 无对应滑块配置`).toBeTruthy();
        expect(value, `${preset.key}.${key} 越界`)
          .toBeGreaterThanOrEqual(config!.min);
        expect(value, `${preset.key}.${key} 越界`)
          .toBeLessThanOrEqual(config!.max);
      }
    }
  });

  it('三档预设键名恰为 loose/standard/strict', () => {
    expect(ANTI_REPEAT_PRESETS.map(p => p.key)).toEqual(['loose', 'standard', 'strict']);
  });
});
