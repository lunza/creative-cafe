/**
 * settings.json schema 版本 + 迁移链（Spec: settings-feature-optimization-report / H-12 + N3 + M-15）
 *
 * 解决「parse 后即用，结构演进靠隐式兜底」的顽疾（DC-2）：
 * 读取入口（settingsFileIO.readSettingsFile）parse 成功后先过本迁移链，
 * 迁移产生变更时由调用方原子回写磁盘，变更清单记日志可审计。
 *
 * 版本约定：
 * - v1（无 SETTING_SCHEMA_KEY 标记）：历史遗留结构，含孤儿键
 *   aiEngines[].n（SillyTavern 生成次数，全仓无消费）与
 *   aiEngines[].encrypt_api_key（存储层无实现的开关，FL-8）。
 * - v2：上述孤儿键已剥离。
 * - v3（当前，M-15/S-5/S-8/S-9/S-10）：批量剥离 SillyTavern 遗留孤儿键——
 *   aiEngines[] 的 ~95 个无消费采样/提示词/模式字段（保留 31 个真实消费字段，
 *   消费核验见报告 S-5 与 Phase 3 实施记录）、顶层孤儿键
 *   autoOptimize/optimizeLevel/backupBeforeOptimize/sillyTavernRoot/pluginPath、
 *   vector 四孤儿子键（vectorStoreMode/autoRetrieveContext/contextTopK/contextMinScore）、
 *   tagAutocomplete.csvPath（真实生效路径是 tag:setCsvPath IPC，settings 侧为冗余持久化）。
 *
 * 纯函数（对入参做原地修改但语义等价于返回新对象），无依赖，
 * 主进程/渲染进程/单测（node 环境）均可用。
 */

/** 当前 settings.json schema 版本 */
export const SETTING_SCHEMA_VERSION = '3.0.0';

/** 版本标记键名（写入 settings.json 顶层） */
export const SETTING_SCHEMA_KEY = '_version';

/**
 * v3 剥离的 aiEngines[] 孤儿键（S-5：全仓无请求体/UI 消费，仅类型与默认值种子残留）。
 * 保留字段（31 个）：id/name/api_url/api_key/model_name/api_mode/model_series/thinking_mode/
 * capabilities/system_prompt/temperature/max_tokens/streaming/enable_chain_of_thought/
 * top_p/top_k/min_p/rep_pen/no_repeat_ngram_size/dry_multiplier/dry_base/dry_allowed_length/
 * continue_nudge_prompt/frequency_penalty/presence_penalty/use_function_calling/useAgent/
 * agentModeOverride/connection_timeout/request_timeout/api_key_transmission。
 */
export const ORPHAN_ENGINE_KEYS: readonly string[] = [
  // 文本补全模式（整块无消费）
  'prompt_template', 'stop_words', 'max_generation_length', 'custom_optimization_prompt',
  // 聊天补全模式特有参数（SillyTavern 遗留提示词/行为字段）
  'openai_max_context', 'names_behavior', 'send_if_empty', 'impersonation_prompt',
  'new_chat_prompt', 'new_example_chat_prompt', 'bias_preset_selected', 'max_context_unlocked',
  'wi_format', 'scenario_format', 'personality_format', 'assistant_prefill',
  'assistant_impersonation', 'use_sysprompt', 'squash_system_messages', 'media_inlining',
  'continue_prefill', 'continue_postfix', 'seed',
  // NovelAI / AI Horde 模式（整块无消费）
  'novelai_api_key', 'novelai_model', 'novelai_sampler', 'novelai_cfg_scale',
  'ai_horde_api_key', 'ai_horde_model', 'ai_horde_max_wait', 'ai_horde_priority',
  // SillyTavern 官方预设采样参数（resolver/对话链路只消费
  // temperature/top_p/top_k/min_p/rep_pen/frequency_penalty/presence_penalty/
  // no_repeat_ngram_size/dry 采样组，其余全部孤儿）
  'temp', 'temperature_last', 'top_a', 'tfs', 'epsilon_cutoff', 'eta_cutoff', 'typical_p',
  'rep_pen_range', 'rep_pen_decay', 'rep_pen_slope', 'penalty_alpha', 'num_beams',
  'length_penalty', 'min_length', 'encoder_rep_pen', 'freq_pen', 'presence_pen', 'skew',
  'do_sample', 'early_stopping', 'dynatemp', 'min_temp', 'max_temp', 'dynatemp_exponent',
  'smoothing_factor', 'smoothing_curve', 'dry_sequence_breakers', 'dry_penalty_last_n',
  'add_bos_token', 'ban_eos_token', 'skip_special_tokens', 'mirostat_mode', 'mirostat_tau',
  'mirostat_eta', 'guidance_scale', 'negative_prompt', 'grammar_string', 'json_schema',
  'json_schema_allow_empty', 'banned_tokens', 'sampler_priority', 'samplers',
  'samplers_priorities', 'ignore_eos_token', 'spaces_between_special_tokens',
  'speculative_ngram', 'sampler_order', 'logit_bias', 'xtc_threshold', 'xtc_probability',
  'nsigma', 'min_keep', 'extensions', 'adaptive_target', 'adaptive_decay', 'rep_pen_size',
  'genamt', 'max_length',
  // 连接设置（整块无消费）
  'auto_connect', 'skip_status_check', 'use_proxy', 'proxy_url', 'proxy_port',
  'enable_access_control',
];

/**
 * v3 剥离的顶层孤儿键：
 * - autoOptimize/optimizeLevel/backupBeforeOptimize/sillyTavernRoot/pluginPath（S-8：全仓零读写，本就无类型/UI 声明）
 * - animationEnabled/compactMode（S-12：uiStore 双真相源死键，所有 UI 消费方读 uiStore，
 *   settings.json 侧只写不读，restoreDefault 会产生无效果的「重置」）
 */
export const ORPHAN_TOP_LEVEL_KEYS: readonly string[] = [
  'autoOptimize', 'optimizeLevel', 'backupBeforeOptimize', 'sillyTavernRoot', 'pluginPath',
  'animationEnabled', 'compactMode',
];

/** v3 剥离的 vector 孤儿子键（S-9：cross-check 冲突 2，接口与磁盘键名对齐后无消费） */
export const ORPHAN_VECTOR_KEYS: readonly string[] = [
  'vectorStoreMode', 'autoRetrieveContext', 'contextTopK', 'contextMinScore',
];

export interface MigrateSettingsResult {
  /** 迁移后的设置对象（无迁移时原引用透传） */
  setting: any;
  /** 变更描述清单（审计用，空 = 无字段级变更） */
  changes: string[];
  /** 结果与磁盘内容不一致（迁移发生或版本键补写），调用方应原子回写 */
  needsWriteBack: boolean;
}

/** 版本比较：a > b → 1，a < b → -1，相等 → 0（按 '.' 分段数值比较） */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 迁移入口：把磁盘读出的原始设置升级到当前 schema 版本。
 *
 * 行为约定：
 * - null / 非对象输入：原样透传，needsWriteBack=false
 * - 版本标记高于当前（代码未升级的未来文件）：原样透传，不迁移不补写
 * - v1 文件：剥离 aiEngines[].n 与 aiEngines[].encrypt_api_key，补写版本键
 * - v2/v1 文件：v3 批量剥离孤儿键（引擎 ~95 键 / 顶层 5 键 / vector 4 子键 /
 *   tagAutocomplete.csvPath），剥离幂等（无键可删不产生变更）
 * - 已是当前版本的干净文件：不迁移、不产生变更、needsWriteBack=false
 *
 * @param raw 磁盘 parse 后的原始值
 */
export function migrateSettings(raw: unknown): MigrateSettingsResult {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { setting: raw, changes: [], needsWriteBack: false };
  }
  const data = raw as Record<string, unknown>;

  // 未来版本（代码未升级）：原样透传
  const version = data[SETTING_SCHEMA_KEY];
  if (typeof version === 'string' && compareVersion(version, SETTING_SCHEMA_VERSION) > 0) {
    return { setting: data, changes: [], needsWriteBack: false };
  }

  const changes: string[] = [];
  let needsWriteBack = false;

  // v1 → v2：剥离 aiEngines[] 孤儿键
  const engines = data.aiEngines;
  if (Array.isArray(engines)) {
    engines.forEach((engine, i) => {
      if (!engine || typeof engine !== 'object' || Array.isArray(engine)) return;
      const e = engine as Record<string, unknown>;
      if ('n' in e) {
        delete e.n;
        changes.push(`aiEngines[${i}].n 剥离（孤儿键，无消费方）`);
        needsWriteBack = true;
      }
      if ('encrypt_api_key' in e) {
        delete e.encrypt_api_key;
        changes.push(`aiEngines[${i}].encrypt_api_key 剥离（存储层无实现的开关）`);
        needsWriteBack = true;
      }
    });
  }

  // v2 → v3：批量剥离孤儿键（M-15/S-5/S-8/S-9/S-10）
  // 幂等剥离：键不存在则跳过，不产生变更条目。按「前缀 + 键名」聚合描述，
  // 避免单引擎 95 键各推一条 changes 撑爆日志。
  if (Array.isArray(engines)) {
    engines.forEach((engine, i) => {
      if (!engine || typeof engine !== 'object' || Array.isArray(engine)) return;
      const e = engine as Record<string, unknown>;
      const removed = ORPHAN_ENGINE_KEYS.filter(key => key in e);
      if (removed.length > 0) {
        removed.forEach(key => delete e[key]);
        changes.push(`aiEngines[${i}] 剥离 ${removed.length} 个孤儿键（S-5 SillyTavern 遗留）`);
        needsWriteBack = true;
      }
    });
  }

  const removedTop = ORPHAN_TOP_LEVEL_KEYS.filter(key => key in data);
  if (removedTop.length > 0) {
    removedTop.forEach(key => delete data[key]);
    changes.push(`顶层剥离 ${removedTop.length} 个孤儿键（S-8：${removedTop.join('/')}）`);
    needsWriteBack = true;
  }

  const vector = data.vector;
  if (vector && typeof vector === 'object' && !Array.isArray(vector)) {
    const v = vector as Record<string, unknown>;
    const removedVector = ORPHAN_VECTOR_KEYS.filter(key => key in v);
    if (removedVector.length > 0) {
      removedVector.forEach(key => delete v[key]);
      changes.push(`vector 剥离 ${removedVector.length} 个孤儿子键（S-9）`);
      needsWriteBack = true;
    }
  }

  const tagAutocomplete = data.tagAutocomplete;
  if (tagAutocomplete && typeof tagAutocomplete === 'object' && !Array.isArray(tagAutocomplete)) {
    const t = tagAutocomplete as Record<string, unknown>;
    if ('csvPath' in t) {
      delete t.csvPath;
      changes.push('tagAutocomplete.csvPath 剥离（S-10 冗余持久化，真实路径为 tag:setCsvPath IPC）');
      needsWriteBack = true;
    }
  }

  // 版本键补写（v1/v2 文件无标记或版本滞后；补写本身即需要回写）
  if (data[SETTING_SCHEMA_KEY] !== SETTING_SCHEMA_VERSION) {
    data[SETTING_SCHEMA_KEY] = SETTING_SCHEMA_VERSION;
    needsWriteBack = true;
  }

  return { setting: data, changes, needsWriteBack };
}
