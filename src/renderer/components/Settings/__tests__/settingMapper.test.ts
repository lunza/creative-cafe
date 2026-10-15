import { describe, it, expect } from 'vitest';
import { AIEngineSetting, AppSetting } from '../../../types/setting';
import { buildDefaultEngine, DEFAULT_ENGINE_PARAMS } from '../../../../shared/settingDefaults';
import {
  toOptionalNumber,
  mapEngineFormValues,
  buildEngineFromForm,
  buildUpdatedSetting,
  buildEngineFormValuesFromSetting,
  MAIN_FORM_DIRTY_FIELDS,
  mergePreservedKeys,
  appendSettingSnapshot,
  MAX_SETTING_VERSIONS,
  SettingPanelRefs,
  SettingPanelRef,
  EngineFormValues,
} from '../settingMapper';
import { ENGINE_DRY_CONFIGS } from '../engineSamplingParams';

// Spec: settings-feature-optimization-report / H-9（handleSave 纯函数化 + 单测）
// 覆盖：22 字段映射 + 6 ref 聚合 + null ref 缺省分支 + toOptionalNumber 保 0 值边界

const makeEngine = (overrides: Partial<AIEngineSetting> = {}): AIEngineSetting =>
  ({ ...buildDefaultEngine(), id: 'default', ...overrides } as AIEngineSetting);

const makeSetting = (engines: AIEngineSetting[], activeEngineId = 'default'): AppSetting =>
  ({
    preset_name: 'test',
    aiEngines: engines,
    activeEngineId,
    defaultEngineId: 'default',
    dashboardBackgroundImage: 'old-bg.png',
    logLevel: 'info',
    debugMode: false,
  } as unknown as AppSetting);

/** 构造 6 面板 ref；字段缺省（undefined）表示该面板未挂载（current=null） */
type PanelKey = 'vector' | 'sdWebui' | 'webSearch' | 'tagAutocomplete' | 'tagRag' | 'blockedWords';
const makeRefs = (
  values: Partial<Record<PanelKey, Record<string, any>>>,
  dialogueNaturalness?: Record<string, any>
): SettingPanelRefs => {
  const ref = (v?: Record<string, any>): SettingPanelRef =>
    v === undefined ? { current: null } : { current: { getFormValues: () => v } };
  return {
    vector: ref(values.vector),
    sdWebui: ref(values.sdWebui),
    webSearch: ref(values.webSearch),
    tagAutocomplete: ref(values.tagAutocomplete),
    tagRag: ref(values.tagRag),
    blockedWords: {
      current:
        values.blockedWords === undefined
          ? null
          : {
              getFormValues: () => values.blockedWords,
              getDialogueNaturalnessValues: () => dialogueNaturalness,
            },
    },
  };
};

describe('toOptionalNumber', () => {
  it('保留合法 0 值（修复 Number(x) || undefined 吞 0 缺陷）', () => {
    expect(toOptionalNumber(0)).toBe(0);
    expect(toOptionalNumber('0')).toBe(0);
  });

  it('空值归一为 undefined', () => {
    expect(toOptionalNumber(undefined)).toBeUndefined();
    expect(toOptionalNumber(null)).toBeUndefined();
    expect(toOptionalNumber('')).toBeUndefined();
  });

  it('非数字字符串归一为 undefined（NaN）', () => {
    expect(toOptionalNumber('abc')).toBeUndefined();
  });

  it('合法数字（含小数/字符串数字）原样返回', () => {
    expect(toOptionalNumber(3.5)).toBe(3.5);
    expect(toOptionalNumber('42')).toBe(42);
    expect(toOptionalNumber(-1)).toBe(-1);
  });
});

describe('mapEngineFormValues（22 字段映射）', () => {
  const engine = makeEngine();

  it('消费表单显式值', () => {
    const values: EngineFormValues = {
      api_url: 'http://10.0.0.1:9000',
      api_key: 'sk-secret',
      model_name: 'test-model',
      temperature: 0.3,
      max_tokens: 2048,
      system_prompt: 'be kind',
    };
    const out = mapEngineFormValues(values, {}, engine);
    expect(out.api_url).toBe('http://10.0.0.1:9000');
    expect(out.api_key).toBe('sk-secret');
    expect(out.model_name).toBe('test-model');
    expect(out.temperature).toBe(0.3);
    expect(out.max_tokens).toBe(2048);
    expect(out.system_prompt).toBe('be kind');
  });

  it('空/缺省值回退默认值单一来源', () => {
    const out = mapEngineFormValues({}, {}, engine);
    expect(out.api_url).toBe(DEFAULT_ENGINE_PARAMS.apiBaseUrl);
    expect(out.api_key).toBe('');
    expect(out.model_name).toBe('');
    expect(out.max_tokens).toBe(DEFAULT_ENGINE_PARAMS.maxTokens);
    expect(out.temperature).toBe(DEFAULT_ENGINE_PARAMS.temperature);
    expect(out.connection_timeout).toBe(DEFAULT_ENGINE_PARAMS.connectionTimeout);
    expect(out.request_timeout).toBe(DEFAULT_ENGINE_PARAMS.requestTimeout);
    expect(out.api_key_transmission).toBe('header');
    expect(out.agentModeOverride).toBe('auto');
  });

  it('max_tokens=0 保留为 0（不吞 0，不触发默认兜底）', () => {
    const out = mapEngineFormValues({ max_tokens: 0 }, {}, engine);
    expect(out.max_tokens).toBe(0);
  });

  it('采样隐藏字段从 allValues 消费，未提供时保留引擎原值', () => {
    const withSampler = mapEngineFormValues({}, { rep_pen: 1.2, dry_base: 2.5 }, engine);
    expect(withSampler.rep_pen).toBe(1.2);
    expect(withSampler.dry_base).toBe(2.5);
    // 未提供的采样字段保留引擎原值（buildDefaultEngine 的 rep_pen=1 / dry_multiplier=0）
    expect(withSampler.dry_multiplier).toBe(engine.dry_multiplier);
    expect(withSampler.no_repeat_ngram_size).toBe(engine.no_repeat_ngram_size);
  });

  it('非映射字段经展开保留（不丢失引擎既有配置）', () => {
    const out = mapEngineFormValues({}, {}, engine);
    expect(out.id).toBe('default');
    expect(out).toHaveProperty('top_k');
    // M-15/S-5：rep_pen_size 等孤儿键已从类型与默认值删除，改用真实消费字段断言
    expect(out).toHaveProperty('connection_timeout');
  });
});

describe('buildEngineFromForm（CR-5/M-20 三路径合一）', () => {
  const formValues: EngineFormValues = {
    api_url: 'http://10.0.0.1:9000',
    api_key: 'sk-secret',
    model_name: 'test-model',
    temperature: 0.3,
    max_tokens: 2048,
    rep_pen: undefined,
  };
  const allValues = { rep_pen: 1.2, dry_multiplier: 0 };

  it('编辑与新建路径对同一表单值生成字段级一致的引擎对象（快照）', () => {
    const editingEngine = makeEngine({ id: 'edit-target', name: '旧名字', model_name: 'old-model' });
    const defaultEngine = makeEngine({ id: 'default', name: '默认引擎' });
    const edited = buildEngineFromForm(formValues, allValues, editingEngine);
    const created = buildEngineFromForm(formValues, allValues, defaultEngine);
    // 除 id/name 外字段级一致（id/name 由调用方覆盖）
    const strip = (e: AIEngineSetting) => {
      const { id: _id, name: _name, ...rest } = e;
      return rest;
    };
    expect(strip(edited)).toEqual(strip(created));
  });

  it('capabilities 未探测时保留基底引擎原能力', () => {
    const engine = makeEngine({ capabilities: { supportsVision: true } as any });
    const out = buildEngineFromForm(formValues, allValues, engine);
    expect(out.capabilities).toEqual({ supportsVision: true });
  });

  it('capabilities 探测值与引擎原能力合并（探测值优先）', () => {
    const engine = makeEngine({ capabilities: { supportsVision: true } as any });
    const out = buildEngineFromForm(formValues, allValues, engine, { supportsRepPen: true } as any);
    expect(out.capabilities).toEqual({ supportsVision: true, supportsRepPen: true });
  });

  it('采样隐藏字段从 allValues 消费，未提供时保留基底原值', () => {
    const engine = makeEngine();
    const out = buildEngineFromForm(formValues, allValues, engine);
    expect(out.rep_pen).toBe(1.2);
    expect(out.dry_multiplier).toBe(0);
    expect(out.dry_base).toBe(engine.dry_base);
  });
});

describe('buildUpdatedSetting（6 ref 聚合 + null ref 缺省）', () => {
  it('仅更新激活引擎，其余引擎原样保留', () => {
    const active = makeEngine({ id: 'a', model_name: 'a-model' });
    const other = makeEngine({ id: 'b', model_name: 'b-model' });
    const setting = makeSetting([active, other], 'a');
    const out = buildUpdatedSetting(setting, { model_name: 'a-renamed' }, {}, makeRefs({}), {} as any);
    expect(out.aiEngines.find(e => e.id === 'a')?.model_name).toBe('a-renamed');
    expect(out.aiEngines.find(e => e.id === 'b')?.model_name).toBe('b-model');
  });

  it('activeEngineId 未匹配时回退取第一个引擎', () => {
    const first = makeEngine({ id: 'first', model_name: 'first-model' });
    const setting = makeSetting([first, makeEngine({ id: 'second' })], 'missing-id');
    const out = buildUpdatedSetting(setting, { model_name: 'renamed' }, {}, makeRefs({}), {} as any);
    expect(out.aiEngines.find(e => e.id === 'first')?.model_name).toBe('renamed');
  });

  it('已挂载面板 ref 的值写入对应配置域', () => {
    const setting = makeSetting([makeEngine()]);
    const out = buildUpdatedSetting(
      setting,
      {},
      {},
      makeRefs(
        {
          // M-15/S-9：contextTopK 已成孤儿键，改用合法向量键 dimension
          vector: { dimension: 4096 },
          sdWebui: { enabled: true },
          webSearch: { enabled: false },
          tagAutocomplete: { enabled: true },
          tagRag: { enabled: true },
          blockedWords: { categories: [] },
        },
        { deAiEnabled: true }
      ),
      { dashboardBackgroundImage: 'new-bg.png', debugMode: true }
    );
    expect(out.vector).toEqual({ dimension: 4096 });
    expect(out.sdWebui).toEqual({ enabled: true });
    expect(out.webSearch).toEqual({ enabled: false });
    expect(out.tagAutocomplete).toEqual({ enabled: true });
    expect(out.tagRag).toEqual({ enabled: true });
    expect(out.forbiddenWords).toEqual({ categories: [] });
    expect(out.dialogueNaturalness).toEqual({ deAiEnabled: true });
    expect(out.dashboardBackgroundImage).toBe('new-bg.png');
    expect(out.debugMode).toBe(true);
    expect(out.logLevel).toBe('info');
  });

  it('vector 面板 ref 为 null 时省略 vector 键，沿用 setting 现存值（修复 `|| {}` 兜底丢数据缺陷）', () => {
    const setting = makeSetting([makeEngine()]);
    setting.vector = { embeddingMode: 'remote' } as any; // 预置现存值
    const out = buildUpdatedSetting(setting, {}, {}, makeRefs({ vector: undefined }), {} as any);
    expect(out.vector).toEqual({ embeddingMode: 'remote' });
  });

  it('null/未挂载面板 ref 省略对应配置键，沿用 setting 现存值', () => {
    const setting = makeSetting([makeEngine()], 'default');
    setting.sdWebui = { enabled: true } as any; // 预置现存值
    setting.webSearch = { enabled: false } as any;
    const out = buildUpdatedSetting(setting, {}, {}, makeRefs({}), {} as any);
    // sdWebui/webSearch ref 为 null → 不覆盖，保留 setting 现存值
    expect(out.sdWebui).toEqual({ enabled: true });
    expect(out.webSearch).toEqual({ enabled: false });
    // 未预置且 ref 为 null 的域不存在该键
    expect(out).not.toHaveProperty('tagAutocomplete');
    expect(out).not.toHaveProperty('forbiddenWords');
    expect(out).not.toHaveProperty('dialogueNaturalness');
  });

  it('extras 的 dashboardBackgroundImage/debugMode 覆盖 setting 值', () => {
    const setting = makeSetting([makeEngine()]);
    setting.dashboardBackgroundImage = 'old.png';
    setting.debugMode = false;
    const out = buildUpdatedSetting(
      setting,
      {},
      {},
      makeRefs({}),
      { dashboardBackgroundImage: 'new.png', debugMode: true }
    );
    expect(out.dashboardBackgroundImage).toBe('new.png');
    expect(out.debugMode).toBe(true);
  });
});

describe('mergePreservedKeys（DC-4 重置白名单合并）', () => {
  it('保留当前设置中默认设置未定义的接口外键', () => {
    const def = { logLevel: 'info', debugMode: false } as any;
    const cur = {
      logLevel: 'debug',
      debugMode: true,
      knowledgeBase: { entries: [{ id: 'kb1', name: '设定集' }] },
      worldBookPath: 'C:\\wb',
      sillyTavernRoot: 'C:\\st',
      _version: 12,
      _lastUpdated: 1700000000000,
    } as any;
    const out = mergePreservedKeys(def, cur);
    // 默认设置覆盖的配置域被复位为默认值
    expect(out.logLevel).toBe('info');
    expect(out.debugMode).toBe(false);
    // 接口外键原样保留
    expect(out.knowledgeBase).toEqual({ entries: [{ id: 'kb1', name: '设定集' }] });
    expect(out.worldBookPath).toBe('C:\\wb');
    expect(out.sillyTavernRoot).toBe('C:\\st');
    expect(out._version).toBe(12);
    expect(out._lastUpdated).toBe(1700000000000);
  });

  it('默认设置已有的键不被当前值污染（只保留缺失键）', () => {
    const def = { aiEngines: [], activeEngineId: 'd' } as any;
    const cur = { aiEngines: [{ id: 'x' }], activeEngineId: 'x', extraKey: 1 } as any;
    const out = mergePreservedKeys(def, cur);
    expect(out.aiEngines).toEqual([]); // 用默认，不沿用当前
    expect(out.activeEngineId).toBe('d');
    expect(out.extraKey).toBe(1); // 仅保留缺失键
  });

  it('currentSetting 为 null/undefined 时原样返回默认设置', () => {
    const def = { logLevel: 'info' } as any;
    expect(mergePreservedKeys(def, null)).toBe(def);
    expect(mergePreservedKeys(def, undefined)).toBe(def);
  });

  it('空对象当前设置 → 返回默认设置（无额外键）', () => {
    const def = { logLevel: 'info', debugMode: false } as any;
    const out = mergePreservedKeys(def, {});
    expect(out).toEqual(def);
  });
});

describe('appendSettingSnapshot（N1 版本快照）', () => {
  const base = makeSetting([makeEngine()]) as any;

  it('生成新快照置于最前，content 剥离 versions 字段', () => {
    base.versions = [{ id: 'old', content: base, timestamp: 1, note: '旧', isAutoGenerated: true }];
    const out = appendSettingSnapshot(base.versions, base);
    expect(out.length).toBe(2);
    expect(out[0].id).not.toBe('old');
    expect(out[1].id).toBe('old');
    // content 不含 versions（防递归）
    expect(out[0].content).not.toHaveProperty('versions');
    expect(out[0].note).toBe('自动保存');
    expect(out[0].isAutoGenerated).toBe(true);
    expect(out[0].content.logLevel).toBe(base.logLevel);
  });

  it('preSaveSetting 为 null 时原样返回既有历史', () => {
    const existing = [{ id: 'a', content: base, timestamp: 1, isAutoGenerated: true }];
    expect(appendSettingSnapshot(existing, null)).toBe(existing);
    expect(appendSettingSnapshot(undefined, undefined)).toEqual([]);
  });

  it('滚动保留最近 MAX_SETTING_VERSIONS 条', () => {
    const many = Array.from({ length: MAX_SETTING_VERSIONS + 5 }, (_, i) => ({
      id: `v${i}`, content: base, timestamp: i, isAutoGenerated: true,
    }));
    const out = appendSettingSnapshot(many, base);
    expect(out.length).toBe(MAX_SETTING_VERSIONS);
    // 最旧被裁掉，最新快照在首，末条为保留的最旧快照 v18
    expect(out[0].id).not.toMatch(/^v\d+$/);
    expect(out[out.length - 1].id).toBe('v18');
  });

  it('自定义 note 与 isAutoGenerated=false（手动/回滚留档）', () => {
    const out = appendSettingSnapshot(undefined, base, '回滚前留档', false);
    expect(out[0].note).toBe('回滚前留档');
    expect(out[0].isAutoGenerated).toBe(false);
  });
});

describe('buildEngineFormValuesFromSetting 引擎级采样字段能力门控（N8/L-5）', () => {
  it('能力探测为 true 时回显引擎 DRY/重复惩罚值（与滑块显隐同源）', () => {
    const engine = makeEngine({
      rep_pen: 1.2,
      dry_multiplier: 0.6,
      dry_base: 1.5,
      dry_allowed_length: 3,
      no_repeat_ngram_size: 2,
      capabilities: { supportsRepPen: true, supportsDrySampler: true },
    });
    const out = buildEngineFormValuesFromSetting(makeSetting([engine]));
    expect(out.rep_pen).toBe(1.2);
    expect(out.dry_multiplier).toBe(0.6);
    expect(out.dry_base).toBe(1.5);
    expect(out.dry_allowed_length).toBe(3);
    expect(out.no_repeat_ngram_size).toBe(2);
  });

  it('能力未探测/为 false 时 DRY 字段期望值为 undefined（不产生幻影脏状态）', () => {
    const engine = makeEngine({
      rep_pen: 1.2,
      dry_multiplier: 0.6,
      capabilities: undefined,
    });
    const out = buildEngineFormValuesFromSetting(makeSetting([engine]));
    for (const config of ENGINE_DRY_CONFIGS) {
      expect(out[config.key], `${config.key} 应随能力缺失而为 undefined`).toBeUndefined();
    }
  });

  it('部分能力：supportsRepPen 开启而 supportsDrySampler 关闭时仅回显 rep_pen', () => {
    const engine = makeEngine({
      rep_pen: 1.3,
      dry_multiplier: 0.9,
      capabilities: { supportsRepPen: true },
    });
    const out = buildEngineFormValuesFromSetting(makeSetting([engine]));
    expect(out.rep_pen).toBe(1.3);
    expect(out.dry_multiplier).toBeUndefined();
  });

  it('MAIN_FORM_DIRTY_FIELDS 覆盖全部引擎级采样字段（可见化后拖动滑块须置脏）', () => {
    for (const config of ENGINE_DRY_CONFIGS) {
      expect(MAIN_FORM_DIRTY_FIELDS).toContain(config.key);
    }
    // 原有 18 字段不丢失
    expect(MAIN_FORM_DIRTY_FIELDS).toContain('temperature');
    expect(MAIN_FORM_DIRTY_FIELDS).toContain('system_prompt');
  });
});
