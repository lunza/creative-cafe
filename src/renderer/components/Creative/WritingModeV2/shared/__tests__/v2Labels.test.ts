/**
 * v2Labels 单元测试
 *
 * 覆盖：
 * - buildModelConfigFromEngine（新建向导 AI 引擎取值规则，与 V1 WritingConfigModal 对齐）
 * - V2_PROJECT_STATUS_LABELS（回归 V1 writing.constants.ts PROJECT_STATUS_LABELS
 *   引用不存在枚举值的存量缺陷：V2 标签表必须与 ProjectStatus 枚举严格一一对应）
 * - 各 options 数组与 labels 的一致性
 */
import { describe, it, expect } from 'vitest';
import {
  ProjectStatus,
  NovelType,
  NarrativePerspective,
  WritingStyle,
} from '../../../../../../shared/types/writing-v2.types';
import {
  buildModelConfigFromEngine,
  V2_PROJECT_STATUS_LABELS,
  V2_NOVEL_TYPE_LABELS,
  V2_NOVEL_TYPE_OPTIONS,
  V2_PERSPECTIVE_LABELS,
  V2_PERSPECTIVE_OPTIONS,
  V2_WRITING_STYLE_LABELS,
  V2_WRITING_STYLE_OPTIONS,
} from '../v2Labels';

describe('v2Labels.buildModelConfigFromEngine', () => {
  it('完整引擎：直接采用 model_name / temperature / max_tokens', () => {
    const config = buildModelConfigFromEngine({
      model_name: 'deepseek-chat',
      temperature: 0.9,
      max_tokens: 8192,
    });
    expect(config).toEqual({ model: 'deepseek-chat', temperature: 0.9, maxTokens: 8192 });
  });

  it('缺少 model_name 时回退到 model 字段', () => {
    const config = buildModelConfigFromEngine({ model: 'gpt-4o-mini' });
    expect(config.model).toBe('gpt-4o-mini');
  });

  it('model_name 优先于 model', () => {
    const config = buildModelConfigFromEngine({ model_name: 'a', model: 'b' });
    expect(config.model).toBe('a');
  });

  it('引擎为 null/undefined 且无 overrides：model 为空串，temperature=0.7，maxTokens=4096', () => {
    expect(buildModelConfigFromEngine(null)).toEqual({ model: '', temperature: 0.7, maxTokens: 4096 });
    expect(buildModelConfigFromEngine(undefined)).toEqual({ model: '', temperature: 0.7, maxTokens: 4096 });
  });

  it('overrides.temperature / overrides.maxTokens 覆盖引擎值', () => {
    const config = buildModelConfigFromEngine(
      { model_name: 'm', temperature: 0.5, max_tokens: 1024 },
      { temperature: 1.2, maxTokens: 2048 }
    );
    expect(config.temperature).toBe(1.2);
    expect(config.maxTokens).toBe(2048);
  });

  it('overrides 缺省时回退引擎值，引擎缺省时回退默认值', () => {
    expect(
      buildModelConfigFromEngine({ model_name: 'm', temperature: 0.3 }, { maxTokens: 512 })
    ).toEqual({ model: 'm', temperature: 0.3, maxTokens: 512 });

    expect(
      buildModelConfigFromEngine({ model_name: 'm', max_tokens: 1024 }, { temperature: 0.1 })
    ).toEqual({ model: 'm', temperature: 0.1, maxTokens: 1024 });
  });
});

describe('v2Labels.V2_PROJECT_STATUS_LABELS', () => {
  it('与 ProjectStatus 枚举严格一一对应（不遗漏、不多余）', () => {
    const enumValues = Object.values(ProjectStatus) as string[];
    const labelKeys = Object.keys(V2_PROJECT_STATUS_LABELS);
    expect(labelKeys.sort()).toEqual([...enumValues].sort());
    // 每个值都有非空中文标签
    for (const value of enumValues) {
      expect(V2_PROJECT_STATUS_LABELS[value as ProjectStatus]).toBeTruthy();
    }
  });

  it('不包含 V1 PROJECT_STATUS_LABELS 中引用不存在的 IN_PROGRESS/REVIEWING/ARCHIVED', () => {
    expect('IN_PROGRESS' in V2_PROJECT_STATUS_LABELS).toBe(false);
    expect('REVIEWING' in V2_PROJECT_STATUS_LABELS).toBe(false);
    expect('ARCHIVED' in V2_PROJECT_STATUS_LABELS).toBe(false);
  });
});

describe('v2Labels.options 与 labels 一致性', () => {
  it('V2_NOVEL_TYPE_OPTIONS 与 V2_NOVEL_TYPE_LABELS 一一对应', () => {
    expect(V2_NOVEL_TYPE_OPTIONS).toHaveLength(Object.keys(V2_NOVEL_TYPE_LABELS).length);
    for (const opt of V2_NOVEL_TYPE_OPTIONS) {
      expect(V2_NOVEL_TYPE_LABELS[opt.value as NovelType]).toBe(opt.label);
    }
  });

  it('V2_PERSPECTIVE_OPTIONS 与 V2_PERSPECTIVE_LABELS 一一对应', () => {
    expect(V2_PERSPECTIVE_OPTIONS).toHaveLength(Object.keys(V2_PERSPECTIVE_LABELS).length);
    for (const opt of V2_PERSPECTIVE_OPTIONS) {
      expect(V2_PERSPECTIVE_LABELS[opt.value as NarrativePerspective]).toBe(opt.label);
    }
  });

  it('V2_WRITING_STYLE_OPTIONS 与 V2_WRITING_STYLE_LABELS 一一对应', () => {
    expect(V2_WRITING_STYLE_OPTIONS).toHaveLength(Object.keys(V2_WRITING_STYLE_LABELS).length);
    for (const opt of V2_WRITING_STYLE_OPTIONS) {
      expect(V2_WRITING_STYLE_LABELS[opt.value as WritingStyle]).toBe(opt.label);
    }
  });
});
