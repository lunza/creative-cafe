/**
 * 模型系列官方推荐参数模板（Spec: analyze-llamacpp-model-compatibility / 修复 H1+H3）
 *
 * 背景：应用"一套引擎参数打天下"导致 qwen/muse-glimmer 与 gemma 表现差异巨大。
 * 各系列模型的官方推荐采样参数差异显著（详见 docs/llamacpp-model-compat-analysis.md §2.2），
 * 本模块提供按模型系列预填的参数模板，供引擎设置 UI 手动选择应用。
 *
 * 注意：
 * - 仅收录有官方来源的系列；来源见各条目 source 注释
 * - "通用/其他"为应用既有默认基线（与 parameterConfigs.ts 保持一致），无官方来源
 * - 主/渲染进程均可引用（src/shared），与 humanizerPolish.ts 同层
 */

/** 引擎级可预填参数集合（与 AIEngineSetting 字段名一致） */
export interface EngineModelPresetParams {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  /** 引擎级重复惩罚（aiEngines.rep_pen，对话链 ParameterInjector 读取） */
  repetition_penalty: number;
  dry_multiplier: number;
  dry_base: number;
  dry_allowed_length: number;
  no_repeat_ngram_size: number;
}

export interface ModelSeriesPreset {
  id: string;
  label: string;
  /** Select option 的 tooltip 说明 */
  tooltip: string;
  params: EngineModelPresetParams;
  /**
   * 思考模式联动（Spec: analyze-llamacpp-model-compatibility）：
   * - 'off'：应用请求体显式携带 enable_thinking=false（Qwen 非思考模板）
   * - 'on' ：请求体显式携带 enable_thinking=true（Qwen 思考模板）
   * - 缺省：不干预思考开关（由 llama-server --reasoning / 模板默认值决定）
   * 保存引擎时由 model_series 推导写入 engine.thinking_mode（单一来源）。
   */
  thinking?: 'on' | 'off';
}

/**
 * 全部采样参数（用户决策：范围=全部；Qwen 双模式两条目；纯手动选择应用）。
 *
 * ⚠ 权威依据：G:\AI\Llama.cpp\docs\16_THINKING_MODE_SAMPLING_CONFIG.md（2026-08-28 定稿）
 * - 服务端 preset 思考常开（--reasoning auto），采样为官方思考模式值
 * - Qwen 思考模式 presence_penalty 必须为 0（1.5 是指令模式值，勿混用——Ollama 曾因此出 bug）
 * - Qwen 所有代际所有模式：min_p 0.0、repetition_penalty 1.0
 * - GLM：官方 API 无 top_k（禁用），temp 与 top_p 二选一调整
 *
 * DRY 策略：qwen/glm/muse-glimmer 模板 dry_multiplier=0（关闭，官方未推荐且对
 * 中文/格式标签有干扰）；gemma/通用保留 0.4（沿用应用"标准"防重复档）。
 */
export const MODEL_SERIES_PRESETS: ModelSeriesPreset[] = [
  {
    id: 'qwen-instruct',
    label: 'Qwen（指令模式·备用）',
    tooltip:
      '指令模式（备用参考）：temperature=0.7, top_p=0.8, top_k=20, min_p=0, presence_penalty=1.5。' +
      '应用后请求级关闭思考（嵌套 chat_template_kwargs.enable_thinking=false）。' +
      '⚠ 当前服务端 preset 思考常开，仅在你明确需要非思考输出时选用。' +
      '来源：16_THINKING_MODE_SAMPLING_CONFIG.md §2.1/2.2 指令模式列',
    params: {
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      min_p: 0,
      frequency_penalty: 0,
      presence_penalty: 1.5,
      repetition_penalty: 1.0,
      dry_multiplier: 0,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
    thinking: 'off',
  },
  {
    id: 'qwen-thinking',
    label: 'Qwen（思考·通用任务）',
    tooltip:
      '思考模式通用任务档（Qwen3.8/3.6 权威基线）：temperature=1.0, top_p=0.95, top_k=20, min_p=0, presence_penalty=0。' +
      '⚠ 思考模式 presence_penalty 必须为 0（1.5 是指令模式值）。' +
      '应用后请求级显式开启思考（嵌套 chat_template_kwargs.enable_thinking=true）。' +
      '来源：16_THINKING_MODE_SAMPLING_CONFIG.md §2.1/2.2 + HF 官方模型卡',
    params: {
      temperature: 1.0,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
      repetition_penalty: 1.0,
      dry_multiplier: 0,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
    thinking: 'on',
  },
  {
    id: 'qwen-thinking-coding',
    label: 'Qwen（思考·精确编码）',
    tooltip:
      '思考模式精确编码档（Qwen3.6 WebDev 等）：temperature=0.6, top_p=0.95, top_k=20, min_p=0, presence_penalty=0。' +
      '适用于代码生成等需要低温度的任务。来源：16_THINKING_MODE_SAMPLING_CONFIG.md §2.2 注',
    params: {
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
      repetition_penalty: 1.0,
      dry_multiplier: 0,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
    thinking: 'on',
  },
  {
    id: 'glm',
    label: 'GLM-5.3 / GLM-5',
    tooltip:
      'GLM 官方推荐：temperature=1.0, top_p=0.95, top_k 禁用（官方 API 无 top_k 参数）, min_p=0, presence_penalty=0。' +
      '原则：temperature 与 top_p 二选一调整，勿同时调整。' +
      '思考开关不干预（服务端 preset 思考常开；推理强度 reasoning_effort 默认 max）。' +
      '来源：16_THINKING_MODE_SAMPLING_CONFIG.md §2.3 + docs.z.ai / bigmodel.cn',
    params: {
      temperature: 1.0,
      top_p: 0.95,
      top_k: 0,
      min_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
      repetition_penalty: 1.0,
      dry_multiplier: 0,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
  },
  {
    id: 'muse-glimmer',
    label: 'Muse-Glimmer',
    tooltip:
      'Meta Muse-Glimmer-30B：temperature=1.0, top_p=0.95, top_k=64, min_p=0。' +
      '⚠ 官方模型卡仅给出 temp/top_p/top_k 三项，min_p/rep_pen/presence_penalty 按全局规则 0/1.0/0。' +
      '⚠ 思考无法关闭：chat template 无 enable_thinking 分支，思考常开只能调档' +
      '（reasoning_effort: low/medium/high/xhigh，默认 high）。' +
      '来源：16_THINKING_MODE_SAMPLING_CONFIG.md §2.4 + HF meta-models/Muse-Glimmer-30B 模型卡',
    params: {
      temperature: 1.0,
      top_p: 0.95,
      top_k: 64,
      min_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
      repetition_penalty: 1.0,
      dry_multiplier: 0,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
  },
  {
    id: 'gemma',
    label: 'Gemma',
    tooltip:
      'Gemma 3/4 系列：temperature=1.0, top_p=0.95, top_k=64, min_p=0.01。' +
      '来源：Gemma 模型卡 / Ollama gemma4 params / Unsloth Gemma 指南',
    params: {
      temperature: 1.0,
      top_p: 0.95,
      top_k: 64,
      min_p: 0.01,
      frequency_penalty: 0,
      presence_penalty: 0,
      repetition_penalty: 1.0,
      dry_multiplier: 0.4,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
  },
  {
    id: 'generic',
    label: '通用/其他',
    tooltip: '应用默认基线（temperature=0.7, top_p=0.95, top_k=40, min_p=0，DRY 0.4 防重复）。无官方来源，适合未收录系列',
    params: {
      temperature: 0.7,
      top_p: 0.95,
      top_k: 40,
      min_p: 0,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
      repetition_penalty: 1.1,
      dry_multiplier: 0.4,
      dry_base: 1.75,
      dry_allowed_length: 2,
      no_repeat_ngram_size: 0,
    },
  },
];

export const GENERIC_MODEL_SERIES_ID = 'generic';

/** 按 id 取系列模板；未收录 id 返回 undefined */
export function getModelSeriesPreset(id: string | undefined | null): ModelSeriesPreset | undefined {
  if (!id) return undefined;
  return MODEL_SERIES_PRESETS.find(p => p.id === id);
}

/** 通用基线参数（各处硬编码兜底值的统一来源） */
export const GENERIC_MODEL_PARAMS: EngineModelPresetParams =
  getModelSeriesPreset(GENERIC_MODEL_SERIES_ID)!.params;

/**
 * 表单数值安全转换：空串/undefined/NaN → undefined；**保留合法的 0**。
 *
 * 修复背景：原保存链路普遍使用 `Number(x) || undefined`，会把用户显式设置的 0
 * （如 qwen 模板 min_p=0、DRY 关闭 dry_multiplier=0）吞成 undefined，
 * 导致引擎值被库默认值（min_p 0.1 / DRY 0.4）顶替——这正是 H1 分析中
 * "引擎配 0 实际发 0.4" 的根因。
 */
export function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}
