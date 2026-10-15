/**
 * 设置保存映射纯函数（Spec: settings-feature-optimization-report / H-9, CR-3）
 *
 * 背景：Settings.tsx 的 handleSave 是 125 行巨型函数，内联「22 引擎字段映射 + 6 面板 ref
 * 聚合 + 展开合并」，且零单测覆盖（ST-2）。本模块把纯计算逻辑抽成两个可测试纯函数：
 *   - mapEngineFormValues：主表单值 → 激活引擎完整配置（22 字段映射 + toOptionalNumber）
 *   - buildUpdatedSetting：激活引擎映射 + 6 面板 ref 聚合 → 完整 AppSetting
 * handleSave 缩减为「验证 → 调纯函数 → saveSetting → 反馈」。
 *
 * 纯函数，无副作用，不依赖 React/IPC，可在 vitest 中直接单测。
 */
import { AIEngineSetting, AIEngineCapabilities, AppSetting, SettingVersion } from '../../types/setting';
import { resolveThinkingMode } from '../../../shared/modelParameterPresets';
import { DEFAULT_ENGINE_PARAMS } from '../../../shared/settingDefaults';
// Spec: settings-feature-optimization-report / N8, L-5（引擎级采样字段可见化：
// 脏检测与表单同步纳入 rep_pen/dry_*，能力门控与 UI 显隐同源）
import { ENGINE_DRY_CONFIGS } from './engineSamplingParams';

/** 设置版本快照滚动上限（N1：20 条） */
export const MAX_SETTING_VERSIONS = 20;

/** 面板表单值（异构配置统一按 Record 处理，便于展开合并） */
export type PanelFormValues = Record<string, any>;

/**
 * 面板 ref 最小契约。
 * current 为 null 表示面板未挂载（未访问的页签 / forceRender 未渲染），
 * 此时 buildUpdatedSetting 省略对应配置键，由 `...setting` 沿用现存值兜底。
 */
export interface SettingPanelRef {
  current: { getFormValues(): PanelFormValues | undefined } | null;
}

/** blockedWords 面板额外暴露对话自然度取值 */
export interface BlockedWordsPanelRef {
  current: {
    getFormValues(): PanelFormValues | undefined;
    getDialogueNaturalnessValues(): PanelFormValues | undefined;
  } | null;
}

/** handleSave 聚合的 6 个面板 ref */
export interface SettingPanelRefs {
  vector: SettingPanelRef;
  sdWebui: SettingPanelRef;
  webSearch: SettingPanelRef;
  tagAutocomplete: SettingPanelRef;
  tagRag: SettingPanelRef;
  blockedWords: BlockedWordsPanelRef;
}

/** 主表单值（form.validateFields 输出）的最小字段集 + 索引签名容错 */
export interface EngineFormValues {
  api_url?: string;
  api_key?: string;
  model_name?: string;
  model_series?: string;
  thinking_mode?: string;
  api_key_transmission?: string;
  agentModeOverride?: string;
  max_tokens?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  top_k?: unknown;
  min_p?: unknown;
  frequency_penalty?: unknown;
  presence_penalty?: unknown;
  connection_timeout?: unknown;
  request_timeout?: unknown;
  system_prompt?: string;
  logLevel?: string;
  [key: string]: unknown;
}

/** 来自组件 state（非表单字段）的额外保存项 */
export interface SaveExtras {
  dashboardBackgroundImage: string;
  debugMode: boolean;
}

/**
 * toOptionalNumber 保留合法 0 值（修复 `Number(x) || undefined` 吞 0 缺陷）。
 * undefined / null / '' / NaN → undefined；合法数字（含 0）→ 该数字。
 */
export function toOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * 把主表单值映射为激活引擎的完整配置（22 字段映射 + 隐藏采样字段兜底）。
 * 纯函数：仅依据入参计算，不读写全局状态。
 *
 * @param values    主表单验证后的值（form.validateFields）
 * @param allValues 全表单值（form.getFieldsValue(true)，含无 Form.Item 的隐藏采样字段）
 * @param engine    激活引擎对象（映射结果以其为基底展开）
 */
export function mapEngineFormValues(
  values: EngineFormValues,
  allValues: Record<string, unknown>,
  engine: AIEngineSetting
): AIEngineSetting {
  return {
    ...engine,
    api_url: values.api_url || DEFAULT_ENGINE_PARAMS.apiBaseUrl,
    api_key: values.api_key || '',
    model_name: values.model_name || '',
    model_series: values.model_series || undefined,
    // 思考联动：表单显式选择（on/off）优先，否则由 model_series 模板推导
    // 表单值是 string，按 resolveThinkingMode 的入参联合类型收敛
    thinking_mode: resolveThinkingMode(
      values.thinking_mode as Parameters<typeof resolveThinkingMode>[0],
      values.model_series
    ),
    api_key_transmission: values.api_key_transmission || 'header',
    agentModeOverride: values.agentModeOverride || 'auto',
    max_tokens: toOptionalNumber(values.max_tokens) ?? DEFAULT_ENGINE_PARAMS.maxTokens,
    temperature: toOptionalNumber(values.temperature) ?? DEFAULT_ENGINE_PARAMS.temperature,
    top_p: toOptionalNumber(values.top_p),
    top_k: toOptionalNumber(values.top_k),
    min_p: toOptionalNumber(values.min_p),
    frequency_penalty: toOptionalNumber(values.frequency_penalty),
    presence_penalty: toOptionalNumber(values.presence_penalty),
    connection_timeout:
      values.connection_timeout !== undefined && values.connection_timeout !== ''
        ? Number(values.connection_timeout)
        : DEFAULT_ENGINE_PARAMS.connectionTimeout,
    request_timeout:
      values.request_timeout !== undefined && values.request_timeout !== ''
        ? Number(values.request_timeout)
        : DEFAULT_ENGINE_PARAMS.requestTimeout,
    system_prompt: values.system_prompt || '',
    // 引擎级采样字段（含合法 0 值，未应用模板时保留引擎原值）
    rep_pen: toOptionalNumber(allValues.rep_pen) ?? engine.rep_pen,
    dry_multiplier: toOptionalNumber(allValues.dry_multiplier) ?? engine.dry_multiplier,
    dry_base: toOptionalNumber(allValues.dry_base) ?? engine.dry_base,
    dry_allowed_length: toOptionalNumber(allValues.dry_allowed_length) ?? engine.dry_allowed_length,
    no_repeat_ngram_size: toOptionalNumber(allValues.no_repeat_ngram_size) ?? engine.no_repeat_ngram_size,
  } as AIEngineSetting;
}

/**
 * 引擎创建/编辑的统一构建入口（Spec: settings-feature-optimization-report / CR-5, M-20）。
 *
 * 背景：useAIEngineSettings.ts 的「编辑分支 / 新建分支」与主表单 handleSave
 * 三条路径各自重复 22 字段兜底逻辑（编辑分支甚至漏掉 api_key_transmission /
 * agentModeOverride 的兜底）。本函数复用 mapEngineFormValues，把三条路径
 * 收敛为一份实现。
 *
 * @param values            引擎表单验证后的值
 * @param allValues         全表单值（form.getFieldsValue(true)，含隐藏采样字段）
 * @param baseEngine        基底引擎：编辑传被编辑引擎（保留未映射字段），
 *                          新建传 AppSetting.defaultSetting.aiEngines[0]
 * @param testCapabilities  测试连通性探测到的能力（覆盖 baseEngine.capabilities），
 *                          undefined 时保留 baseEngine 原能力
 *
 * 注意：id / name 由调用方在返回对象上覆盖（新建生成新 id，编辑保留原值）。
 */
export function buildEngineFromForm(
  values: EngineFormValues,
  allValues: Record<string, unknown>,
  baseEngine: AIEngineSetting,
  testCapabilities?: AIEngineCapabilities
): AIEngineSetting {
  const mapped = mapEngineFormValues(values, allValues, baseEngine);
  return {
    ...mapped,
    // capabilities 显式合并：测试探测值优先，未探测时保留引擎原能力
    // （原编辑路径靠 `...engine` spread 隐式保留，此处显式化避免字段漂移）
    ...(testCapabilities
      ? { capabilities: { ...baseEngine.capabilities, ...testCapabilities } }
      : {}),
  };
}

/**
 * 表单值深度相等（键序无关，逐键 JSON 比较）。
 * 用于脏检测：表单 store 与初始化快照可能键序不同但语义相同，
 * 直接 JSON.stringify 整对象会误判为 dirty。纯函数。
 */
export function areFormValuesEqual(
  a: object | null | undefined,
  b: object | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  // 配置类型多为 interface（无隐式索引签名），此处统一收敛为 Record 比较
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) {
    if (JSON.stringify(ao[key]) !== JSON.stringify(bo[key])) return false;
  }
  return true;
}

/**
 * 由 setting 构建主表单同步值（Spec: settings-feature-optimization-report / M-1, UI-1）。
 *
 * 纯函数，与 Settings.tsx 的 syncFormFromSetting 同源：「表单初始化 / 保存失败回滚」
 * 与「保存按钮脏检测」都从本函数推导期望值，避免两处映射漂移。
 * 含 DEFAULT_ENGINE_PARAMS 兜底（H-5 同源）。debugMode 字段仅为同步保留
 * （其 UI Switch 由组件 state 受控、不回写表单），脏检测用 MAIN_FORM_DIRTY_FIELDS 排除。
 */
export function buildEngineFormValuesFromSetting(setting: AppSetting): Record<string, unknown> {
  const engines = setting.aiEngines || [];
  const engine = engines.find(e => e.id === setting.activeEngineId) || engines[0];
  return {
    debugMode: setting.debugMode || false,
    logLevel: setting.logLevel || 'info',
    api_url: engine?.api_url || DEFAULT_ENGINE_PARAMS.apiBaseUrl,
    api_key: engine?.api_key || '',
    model_name: engine?.model_name || '',
    model_series: engine?.model_series,
    thinking_mode: engine?.thinking_mode || 'auto',
    api_key_transmission: engine?.api_key_transmission || 'header',
    agentModeOverride: engine?.agentModeOverride || 'auto',
    max_tokens:
      typeof engine?.max_tokens === 'number' && engine.max_tokens > 0
        ? engine.max_tokens
        : DEFAULT_ENGINE_PARAMS.maxTokens,
    temperature:
      typeof engine?.temperature === 'number' && engine.temperature >= 0 && engine.temperature <= 2
        ? engine.temperature
        : DEFAULT_ENGINE_PARAMS.temperature,
    top_p: engine?.top_p,
    top_k: engine?.top_k,
    min_p: engine?.min_p,
    frequency_penalty: engine?.frequency_penalty,
    presence_penalty: engine?.presence_penalty,
    connection_timeout: engine?.connection_timeout ?? DEFAULT_ENGINE_PARAMS.connectionTimeout,
    request_timeout: engine?.request_timeout ?? DEFAULT_ENGINE_PARAMS.requestTimeout,
    system_prompt: engine?.system_prompt || '',
    // Spec: N8/L-5 — 引擎级采样字段可见化后纳入表单同步。
    // 【重点标记 - 能力门控与脏检测同源】仅当对应 capability 为 true 时回显引擎值，
    // 与 EngineSamplingSection 的滑块显隐同一门控：能力缺失时 Form.Item 不注册、
    // 期望值亦为 undefined，双方 JSON.stringify 均为 'undefined' → 不产生幻影脏状态；
    // 若此处无条件回显引擎值，能力缺失的引擎会因「表单无值 vs 期望有值」永久置脏。
    ...Object.fromEntries(
      ENGINE_DRY_CONFIGS.map(config => [
        config.key,
        engine?.capabilities?.[config.capability!] ? engine?.[config.key as keyof AIEngineSetting] : undefined,
      ])
    ),
  };
}

/**
 * 参与主表单脏检测的字段清单（Spec: M-1, UI-1）。
 * 排除 debugMode（受组件 state 受控，由 Settings 顶层 state 比较覆盖）；
 * theme/animation/compact 由 uiStore 驱动、不经 setting 保存，不在此列。
 * Spec: N8/L-5 — 引擎级采样字段（rep_pen/dry_*）可见化后纳入清单，
 * 能力缺失时由 buildEngineFormValuesFromSetting 的 undefined 期望值兜底不置脏。
 */
export const MAIN_FORM_DIRTY_FIELDS: readonly string[] = [
  'logLevel',
  'api_url',
  'api_key',
  'model_name',
  'model_series',
  'thinking_mode',
  'api_key_transmission',
  'agentModeOverride',
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'frequency_penalty',
  'presence_penalty',
  'connection_timeout',
  'request_timeout',
  'system_prompt',
  // 引擎级采样字段（N8 可见化，键名与 ENGINE_DRY_CONFIGS 同源）
  ...ENGINE_DRY_CONFIGS.map(config => config.key),
];

/**
 * 构建保存后的完整设置对象：激活引擎映射 + 6 面板 ref 聚合。
 *
 * null / 未挂载面板的 ref 省略对应配置键，由 `...setting` 展开沿用现存值兜底
 * （与按需渲染 PF-1 的 null ref 分支共用同一语义）。纯函数。
 *
 * @param setting 当前设置（基底展开，保留所有未变更配置域）
 * @param values  主表单验证后的值
 * @param allValues 全表单值（含隐藏采样字段）
 * @param refs    6 个面板 ref（未挂载时为 null，沿用 setting 现存值）
 * @param extras  组件 state 携带的 dashboardBackgroundImage / debugMode
 */
export function buildUpdatedSetting(
  setting: AppSetting,
  values: EngineFormValues,
  allValues: Record<string, unknown>,
  refs: SettingPanelRefs,
  extras: SaveExtras
): AppSetting {
  const engines = setting.aiEngines || [];
  // 与原 handleSave 一致：优先按 activeEngineId 匹配，缺省取第一个引擎
  const activeEngine = engines.find(e => e.id === setting.activeEngineId) ?? engines[0];
  const updatedEngines = engines.map(engine =>
    activeEngine && engine.id === activeEngine.id
      ? mapEngineFormValues(values, allValues, engine)
      : engine
  );

  // 【重点标记 - M-11 按需渲染兜底修复】vector 此前用 `|| {}` 兜底，未挂载面板（ref 为 null）
  // 会把 setting.vector 覆盖成空对象，保存即丢光向量化配置。现与其他 5 个域统一为
  // 条件展开：ref 为 null 时省略对应键，由 `...setting` 沿用现存值。
  const vectorConfig = refs.vector?.current?.getFormValues();
  const sdWebuiConfig = refs.sdWebui?.current?.getFormValues();
  const webSearchConfig = refs.webSearch?.current?.getFormValues();
  const tagAutocompleteConfig = refs.tagAutocomplete?.current?.getFormValues();
  const tagRagConfig = refs.tagRag?.current?.getFormValues();
  const blockedWordsConfig = refs.blockedWords?.current?.getFormValues();
  const dialogueNaturalnessConfig = refs.blockedWords?.current?.getDialogueNaturalnessValues();

  return {
    ...setting,
    aiEngines: updatedEngines,
    logLevel: (values.logLevel || 'info') as AppSetting['logLevel'],
    dashboardBackgroundImage: extras.dashboardBackgroundImage,
    debugMode: extras.debugMode,
    ...(vectorConfig ? { vector: vectorConfig } : {}),
    ...(sdWebuiConfig ? { sdWebui: sdWebuiConfig } : {}),
    ...(webSearchConfig ? { webSearch: webSearchConfig } : {}),
    ...(tagAutocompleteConfig ? { tagAutocomplete: tagAutocompleteConfig } : {}),
    ...(tagRagConfig ? { tagRag: tagRagConfig } : {}),
    ...(blockedWordsConfig ? { forbiddenWords: blockedWordsConfig } : {}),
    ...(dialogueNaturalnessConfig ? { dialogueNaturalness: dialogueNaturalnessConfig } : {}),
  } as AppSetting;
}

/**
 * 重置白名单合并（Spec: settings-feature-optimization-report / H-3, DC-4 数据丢失修复）。
 *
 * restoreDefault 此前直接 `save(defaultSetting)` 全量替换，而 defaultSetting 不含
 * knowledgeBase / *Path 七键 / sillyTavernRoot / pluginPath / _version / _lastUpdated
 * 等接口外键 → 重置后这些磁盘数据被静默清除，UI 无感知。
 *
 * 本函数把「当前设置中存在、但默认设置未定义」的顶层键保留下来（白名单合并），
 * 使重置只复位默认设置覆盖的配置域，接口外数据原样保留。纯函数。
 *
 * @param defaultSetting 默认设置（重置基底）
 * @param currentSetting 当前设置（提供需保留的接口外键）；null/undefined 时原样返回默认设置
 */
export function mergePreservedKeys<T extends Record<string, any>>(
  defaultSetting: T,
  currentSetting: T | null | undefined
): T {
  if (!currentSetting) return defaultSetting;
  const preserved: Record<string, any> = {};
  for (const key of Object.keys(currentSetting)) {
    if (!(key in defaultSetting)) {
      preserved[key] = currentSetting[key];
    }
  }
  return { ...defaultSetting, ...preserved };
}

/**
 * 追加设置版本快照（Spec: settings-feature-optimization-report / H-11, N1）。
 *
 * 保存前对「保存前状态」留档：剥离 versions 字段（防嵌套递归）后作为 content，
 * 生成新快照置于历史最前，滚动保留最近 MAX_SETTING_VERSIONS 条。纯函数。
 *
 * @param existingVersions 既有历史（可能为 undefined/空）
 * @param preSaveSetting   保存前的当前设置（快照对象）
 * @param note             备注（默认「自动保存」）
 * @param isAutoGenerated  是否自动保存快照
 */
export function appendSettingSnapshot(
  existingVersions: SettingVersion[] | undefined,
  preSaveSetting: AppSetting | null | undefined,
  note = '自动保存',
  isAutoGenerated = true
): SettingVersion[] {
  const list = Array.isArray(existingVersions) ? existingVersions : [];
  if (!preSaveSetting) return list;
  // 剥离 versions 字段，避免快照内容嵌套历史造成递归/膨胀
  const { versions: _stripped, ...content } = preSaveSetting;
  const snapshot: SettingVersion = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: content as AppSetting,
    timestamp: Date.now(),
    note,
    isAutoGenerated,
  };
  return [snapshot, ...list].slice(0, MAX_SETTING_VERSIONS);
}
