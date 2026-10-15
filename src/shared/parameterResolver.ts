/**
 * 统一参数解析入口（Spec: settings-feature-optimization-report / N7, M-18）
 *
 * 背景：FL-2/FL-4 分链路分裂——同一引擎参数在不同链路的生效性不一致：
 * - 角色对话 ChatEngine 链路曾硬编码 maxTokens=undefined（FL-2，已修复但解析逻辑内联）
 * - LAN 对话 dialogue.ts 仅消费会话级 customParameters，引擎级采样字段
 *   （frequency_penalty / presence_penalty / dry 采样组 / top_k / min_p 等）
 *   全部不进请求体（FL-4）
 * - 世界书/创作链路（useWorldBookAIOperations.ts 18 处）各自内联
 *   `max_tokens > 0 ? max_tokens : DEFAULT_ENGINE_PARAMS.maxTokens` 兜底
 *
 * 本模块把对话模式 ParameterInjector.getEffectiveParams 的三级合并范式
 * （会话级 customParameters > 引擎级 > 默认值）提升为全系统共享纯函数，
 * 角色对话/AIService 探测/LAN 对话三条链路从同一入口取参数。
 *
 * 统一语义裁定（以世界书/创作链路为基准——报告 FL-2 影响场景的「正确参照」）：
 * - temperature：overrides > engine > 0.8（ChatEngine/dialogue 既有缺省）
 * - max_tokens：overrides > engine > DEFAULT_ENGINE_PARAMS.maxTokens（10240），
 *   0 或非法值视为缺失（与 ChatEngine FL-2 修复后、世界书 18 处一致）
 * - 采样参数（top_p / top_k / min_p / rep_pen / frequency_penalty /
 *   presence_penalty / dry 采样组 / no_repeat_ngram_size）：
 *   overrides > engine，两侧均缺失则不注入
 *   （请求体不写该字段，由后端自行默认）
 *
 * 纯函数，无依赖，主进程（lanApiServer/dialogue.ts）与渲染进程
 * （ChatEngine/AIService）均可用。引擎字段为 snake_case（与 AIEngineSetting
 * 落盘格式一致），输出字段名对齐请求体键名（rep_pen → repetition_penalty）。
 */
import { DEFAULT_ENGINE_PARAMS } from './settingDefaults';

/** 引擎参数源（AIEngineSetting 的参数字段子集，允许部分配置） */
export interface EngineParamSource {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  /** SillyTavern 风格重复惩罚字段（请求体键名 repetition_penalty） */
  rep_pen?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  no_repeat_ngram_size?: number;
}

/** 会话级覆盖（LAN customParameters / 角色会话参数），字段名与 EngineParamSource 一致 */
export type EngineParamOverrides = Partial<EngineParamSource>;

/** 三级合并后的有效参数（字段名对齐 chat completions 请求体键名） */
export interface EffectiveEngineParams {
  temperature: number;
  /** 恒为有效正整数（0/缺失回退 DEFAULT_ENGINE_PARAMS.maxTokens） */
  max_tokens: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  no_repeat_ngram_size?: number;
}

/** 有限数字判定（过滤 NaN/Infinity/非数字） */
const isValidNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** 两级取值：覆盖值 > 引擎值，均缺失/非法返回 undefined */
const pick = (override: number | undefined, engine: number | undefined): number | undefined =>
  isValidNum(override) ? override : isValidNum(engine) ? engine : undefined;

/**
 * 三级合并解析引擎参数。
 *
 * @param engine 引擎配置（AIEngineSetting 或同构对象，可为 null/undefined）
 * @param overrides 会话级覆盖（可为 null/undefined）
 * @returns 有效参数；采样字段 undefined 表示请求体不注入
 */
export function resolveEngineParams(
  engine: EngineParamSource | null | undefined,
  overrides?: EngineParamOverrides | null,
): EffectiveEngineParams {
  const ov = overrides || {};
  const e = engine || {};

  const temperature = pick(ov.temperature, e.temperature) ?? 0.8;
  const maxOverride = pick(ov.max_tokens, e.max_tokens);
  const max_tokens =
    maxOverride !== undefined && maxOverride > 0 ? maxOverride : DEFAULT_ENGINE_PARAMS.maxTokens;

  return {
    temperature,
    max_tokens,
    top_p: pick(ov.top_p, e.top_p),
    top_k: pick(ov.top_k, e.top_k),
    min_p: pick(ov.min_p, e.min_p),
    repetition_penalty: pick(ov.rep_pen, e.rep_pen),
    frequency_penalty: pick(ov.frequency_penalty, e.frequency_penalty),
    presence_penalty: pick(ov.presence_penalty, e.presence_penalty),
    dry_multiplier: pick(ov.dry_multiplier, e.dry_multiplier),
    dry_base: pick(ov.dry_base, e.dry_base),
    dry_allowed_length: pick(ov.dry_allowed_length, e.dry_allowed_length),
    no_repeat_ngram_size: pick(ov.no_repeat_ngram_size, e.no_repeat_ngram_size),
  };
}
