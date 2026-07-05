/**
 * buildSamplingExtras 单元测试
 *
 * 验证目标（spec Task 6.6 场景 4）：
 *   supportsDrySampler=true 时请求体含 DRY 字段（dry_multiplier/dry_base/dry_allowed_length/no_repeat_ngram_size）
 *   supportsDrySampler=false 时请求体不含 DRY 字段
 *   supportsRepPen=true 时请求体含 repetition_penalty
 *   supportsRepPen=false 时请求体不含 repetition_penalty
 *   config 缺省时使用默认值（REP_PEN_DEFAULT=1.1, DRY_SAMPLER_DEFAULTS）
 *   config 显式提供时覆盖默认值
 *
 * Spec: optimize-chat-ai-intelligence / Task 6.5 / 6.6
 */

import { describe, it, expect } from 'vitest';
import {
  buildSamplingExtras,
  getDefaultEngineCapabilities,
  DRY_SAMPLER_DEFAULTS,
  REP_PEN_DEFAULT,
  AIEngineConfig,
  EngineCapabilities,
} from '../ChatEngine.types';

describe('buildSamplingExtras — supportsDrySampler=true（Spec: Task 6.6 场景 4）', () => {
  const dryCaps: EngineCapabilities = {
    supportsStopArray: true,
    supportsRepPen: true,
    supportsDrySampler: true,
  };

  it('注入全部 DRY 字段（dry_multiplier/dry_base/dry_allowed_length/no_repeat_ngram_size）', () => {
    const extras = buildSamplingExtras({}, dryCaps);
    expect(extras).toHaveProperty('dry_multiplier');
    expect(extras).toHaveProperty('dry_base');
    expect(extras).toHaveProperty('dry_allowed_length');
    expect(extras).toHaveProperty('no_repeat_ngram_size');
  });

  it('缺省时使用 DRY_SAMPLER_DEFAULTS 默认值', () => {
    const extras = buildSamplingExtras({}, dryCaps);
    expect(extras.dry_multiplier).toBe(DRY_SAMPLER_DEFAULTS.dry_multiplier);
    expect(extras.dry_base).toBe(DRY_SAMPLER_DEFAULTS.dry_base);
    expect(extras.dry_allowed_length).toBe(DRY_SAMPLER_DEFAULTS.dry_allowed_length);
    expect(extras.no_repeat_ngram_size).toBe(DRY_SAMPLER_DEFAULTS.no_repeat_ngram_size);
  });

  it('显式提供 config 值时覆盖默认值', () => {
    const config: Partial<AIEngineConfig> = {
      dry_multiplier: 1.5,
      dry_base: 2.5,
      dry_allowed_length: 5,
      no_repeat_ngram_size: 3,
    };
    const extras = buildSamplingExtras(config, dryCaps);
    expect(extras.dry_multiplier).toBe(1.5);
    expect(extras.dry_base).toBe(2.5);
    expect(extras.dry_allowed_length).toBe(5);
    expect(extras.no_repeat_ngram_size).toBe(3);
  });

  it('同时注入 repetition_penalty（supportsRepPen=true）', () => {
    const extras = buildSamplingExtras({}, dryCaps);
    expect(extras).toHaveProperty('repetition_penalty');
    expect(extras.repetition_penalty).toBe(REP_PEN_DEFAULT);
  });
});

describe('buildSamplingExtras — supportsDrySampler=false（Spec: Task 6.6 场景 4）', () => {
  const noDryCaps: EngineCapabilities = {
    supportsStopArray: true,
    supportsRepPen: false,
    supportsDrySampler: false,
  };

  it('不注入任何 DRY 字段', () => {
    const extras = buildSamplingExtras({
      dry_multiplier: 1.5,
      dry_base: 2.5,
      dry_allowed_length: 5,
      no_repeat_ngram_size: 3,
    }, noDryCaps);
    expect(extras).not.toHaveProperty('dry_multiplier');
    expect(extras).not.toHaveProperty('dry_base');
    expect(extras).not.toHaveProperty('dry_allowed_length');
    expect(extras).not.toHaveProperty('no_repeat_ngram_size');
  });

  it('不注入 repetition_penalty（supportsRepPen=false）', () => {
    const extras = buildSamplingExtras({
      repetition_penalty: 1.3,
    }, noDryCaps);
    expect(extras).not.toHaveProperty('repetition_penalty');
  });

  it('返回空对象（无任何额外采样参数）', () => {
    const extras = buildSamplingExtras({}, noDryCaps);
    expect(Object.keys(extras)).toHaveLength(0);
  });
});

describe('buildSamplingExtras — supportsRepPen 显隐', () => {
  it('supportsRepPen=true 时注入 repetition_penalty', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: false,
    };
    const extras = buildSamplingExtras({}, caps);
    expect(extras).toHaveProperty('repetition_penalty');
    expect(extras.repetition_penalty).toBe(REP_PEN_DEFAULT);
  });

  it('supportsRepPen=true 且 config 提供值时覆盖默认值', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: false,
    };
    const extras = buildSamplingExtras({ repetition_penalty: 1.3 }, caps);
    expect(extras.repetition_penalty).toBe(1.3);
  });

  it('supportsRepPen=false 时不注入 repetition_penalty', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: false,
      supportsDrySampler: false,
    };
    const extras = buildSamplingExtras({ repetition_penalty: 1.3 }, caps);
    expect(extras).not.toHaveProperty('repetition_penalty');
  });
});

describe('buildSamplingExtras — capabilities 缺省时按 api_mode 推断', () => {
  it('api_mode=text_completion → supportsRepPen=true / supportsDrySampler=true（注入全部字段）', () => {
    const extras = buildSamplingExtras({ api_mode: 'text_completion' });
    expect(extras).toHaveProperty('repetition_penalty');
    expect(extras).toHaveProperty('dry_multiplier');
    expect(extras).toHaveProperty('dry_base');
    expect(extras).toHaveProperty('dry_allowed_length');
    expect(extras).toHaveProperty('no_repeat_ngram_size');
  });

  it('api_mode=chat_completion → supportsRepPen=false / supportsDrySampler=false（不注入字段）', () => {
    const extras = buildSamplingExtras({ api_mode: 'chat_completion' });
    expect(extras).not.toHaveProperty('repetition_penalty');
    expect(extras).not.toHaveProperty('dry_multiplier');
    expect(Object.keys(extras)).toHaveLength(0);
  });

  it('api_mode 缺省 → 保守策略（不注入字段）', () => {
    const extras = buildSamplingExtras({});
    expect(Object.keys(extras)).toHaveLength(0);
  });

  it('config.capabilities 优先于 api_mode 推断', () => {
    // api_mode=chat_completion 默认会推断为 false/false，
    // 但 config.capabilities 显式指定 supportsDrySampler=true 时应优先使用
    const extras = buildSamplingExtras({
      api_mode: 'chat_completion',
      capabilities: {
        supportsStopArray: true,
        supportsRepPen: false,
        supportsDrySampler: true,
      },
    });
    expect(extras).toHaveProperty('dry_multiplier');
    expect(extras).not.toHaveProperty('repetition_penalty');
  });
});

describe('getDefaultEngineCapabilities — 按 api_mode 预设（Spec: Task 6.2）', () => {
  it('api_mode=text_completion → textgen-webui 类后端：rep_pen=true, dry=true', () => {
    const caps = getDefaultEngineCapabilities('text_completion');
    expect(caps.supportsStopArray).toBe(true);
    expect(caps.supportsRepPen).toBe(true);
    expect(caps.supportsDrySampler).toBe(true);
  });

  it('api_mode=chat_completion → OpenAI 类后端：rep_pen=false, dry=false', () => {
    const caps = getDefaultEngineCapabilities('chat_completion');
    expect(caps.supportsStopArray).toBe(true);
    expect(caps.supportsRepPen).toBe(false);
    expect(caps.supportsDrySampler).toBe(false);
  });

  it('api_mode 缺省/未知 → 保守策略：rep_pen=false, dry=false', () => {
    const caps1 = getDefaultEngineCapabilities(undefined);
    expect(caps1.supportsStopArray).toBe(true);
    expect(caps1.supportsRepPen).toBe(false);
    expect(caps1.supportsDrySampler).toBe(false);

    const caps2 = getDefaultEngineCapabilities('unknown_mode');
    expect(caps2.supportsStopArray).toBe(true);
    expect(caps2.supportsRepPen).toBe(false);
    expect(caps2.supportsDrySampler).toBe(false);
  });

  it('所有 api_mode 的 supportsStopArray 均为 true（spec 约定：默认传数组）', () => {
    for (const mode of ['text_completion', 'chat_completion', undefined, 'unknown']) {
      const caps = getDefaultEngineCapabilities(mode);
      expect(caps.supportsStopArray).toBe(true);
    }
  });
});

describe('buildSamplingExtras — 边界情况', () => {
  it('config 中 repetition_penalty 为 NaN 时不使用 NaN，回退默认值', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: false,
    };
    const extras = buildSamplingExtras({ repetition_penalty: NaN }, caps);
    expect(extras.repetition_penalty).toBe(REP_PEN_DEFAULT);
    expect(Number.isNaN(extras.repetition_penalty)).toBe(false);
  });

  it('config 中 dry_multiplier 为 NaN 时回退默认值', () => {
    const caps: EngineCapabilities = {
      supportsStopArray: true,
      supportsRepPen: false,
      supportsDrySampler: true,
    };
    const extras = buildSamplingExtras({ dry_multiplier: NaN }, caps);
    expect(extras.dry_multiplier).toBe(DRY_SAMPLER_DEFAULTS.dry_multiplier);
  });

  it('capabilities 参数优先于 config.capabilities', () => {
    // config.capabilities 说 false，但直接传入的 capabilities 参数说 true
    const extras = buildSamplingExtras(
      {
        capabilities: { supportsStopArray: true, supportsRepPen: false, supportsDrySampler: false },
      },
      { supportsStopArray: true, supportsRepPen: true, supportsDrySampler: true }
    );
    expect(extras).toHaveProperty('repetition_penalty');
    expect(extras).toHaveProperty('dry_multiplier');
  });
});
