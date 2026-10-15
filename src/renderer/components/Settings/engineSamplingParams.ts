/**
 * AI 引擎采样参数滑块元数据（Spec: settings-feature-optimization-report / N8, L-5）
 *
 * 背景：设置页 AI 引擎区原为纯数字输入框，普通用户对 temperature/top_p/rep_pen/dry_*
 * 等采样参数无从下手。迁移对话模式 ParameterPanel 的成熟交互范式：
 * 滑块 + 防重复强度三档预设 + DRY/重复惩罚能力门控显隐。元数据驱动渲染——
 * 新增参数只改本文件配置条目，不改组件。
 *
 * 字段名严格对齐保存链路（settingMapper.mapEngineFormValues）：
 * - 主参数（temperature/top_p/top_k/min_p/frequency_penalty/presence_penalty）
 *   由 values 直接消费；
 * - 引擎级采样字段（rep_pen/dry_multiplier/dry_base/dry_allowed_length/
 *   no_repeat_ngram_size）此前为「隐藏字段 setFieldsValue」（无 Form.Item，
 *   仅经 form.getFieldsValue(true) 持久化），N8 起变为可见可调的 Form.Item，
 *   name 必须与此处 key 一致。
 *
 * 防重复三档预设直接复用对话模式 parameterConfigs 的 ANTI_REPEAT_PRESETS 常量
 * （单一数据源，防止两处数值漂移）。
 */
import { AIEngineCapabilities } from '../../types/setting';
import { DEFAULT_ENGINE_PARAMS } from '../../../shared/settingDefaults';

/** 滑块元数据条目 */
export interface EngineSamplingConfig {
  /** 表单字段名（与 mapEngineFormValues 消费名一致） */
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  tooltip: string;
  /** 滑块无值时的显示兜底（不写入表单 store，避免幻影脏检测） */
  defaultValue: number;
  /** 设置后仅当对应 capability 为 true 时显示（保守策略，与对话模式 ParameterPanel 一致） */
  capability?: keyof AIEngineCapabilities;
}

/**
 * 主采样参数（始终显示）。
 * 范围/步进与既有输入框一致，默认值来源：DEFAULT_ENGINE_PARAMS（H-5 单一来源）
 * 与既有 placeholder 标注值（top_p 0.95 / top_k 40 / min_p 0.1）。
 */
export const ENGINE_SAMPLING_CONFIGS: EngineSamplingConfig[] = [
  {
    key: 'temperature',
    label: '温度参数 (temperature)',
    min: 0,
    max: 2,
    step: 0.1,
    defaultValue: DEFAULT_ENGINE_PARAMS.temperature,
    tooltip: '控制输出的随机性。较低值使输出更确定，较高值更创意。范围 0-2，默认 0.7。',
  },
  {
    key: 'top_p',
    label: 'Top P (top_p)',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 0.95,
    tooltip: '核采样参数。较低值使输出更集中，较高值更多样。范围 0-1，例如 0.95。',
  },
  {
    key: 'top_k',
    label: 'Top K (top_k)',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 40,
    tooltip: '限制模型从概率最高的 K 个 token 中采样。0 表示禁用。范围 0-200，例如 40。',
  },
  {
    key: 'min_p',
    label: 'Min P (min_p)',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 0.1,
    tooltip: '动态最低概率阈值，仅保留概率 >= top_p * min_p 的 token。范围 0-1，例如 0.1。',
  },
  {
    key: 'frequency_penalty',
    label: '频率惩罚 (frequency_penalty)',
    min: -2,
    max: 2,
    step: 0.1,
    defaultValue: 0,
    tooltip: '降低重复 token 的权重。正值减少重复，负值增加重复。范围 -2 到 2。',
  },
  {
    key: 'presence_penalty',
    label: '存在惩罚 (presence_penalty)',
    min: -2,
    max: 2,
    step: 0.1,
    defaultValue: 0,
    tooltip: '鼓励模型谈论新话题。正值使模型更愿意引入新话题。范围 -2 到 2。',
  },
];

/**
 * 引擎级采样字段（能力门控显示）。
 *
 * - rep_pen（重复惩罚）：仅 supportsRepPen=true 时显示（textgen-webui/koboldcpp 等后端；
 *   OpenAI 系后端不支持，误配会 4xx）。
 * - DRY 采样组：仅 supportsDrySampler=true 时显示（借鉴 SillyTavern textgen-settings.js）。
 *
 * 数值参考与对话模式 parameterConfigs.DRY_PARAMETER_CONFIGS 同源（SillyTavern 默认值）。
 */
export const ENGINE_DRY_CONFIGS: EngineSamplingConfig[] = [
  {
    key: 'rep_pen',
    label: '重复惩罚 (rep_pen)',
    min: 0.8,
    max: 1.5,
    step: 0.05,
    defaultValue: 1.1,
    capability: 'supportsRepPen',
    tooltip: '重复惩罚系数（仅部分本地后端支持）。值 > 1 减少重复，过高影响流畅性。推荐 1.1-1.2。',
  },
  {
    key: 'dry_multiplier',
    label: 'DRY Multiplier',
    min: 0,
    max: 2,
    step: 0.1,
    defaultValue: 0.8,
    capability: 'supportsDrySampler',
    tooltip: 'DRY 采样惩罚强度。0 = 禁用 DRY 采样；值越大对重复序列惩罚越强。',
  },
  {
    key: 'dry_base',
    label: 'DRY Base',
    min: 1,
    max: 3,
    step: 0.05,
    defaultValue: 1.75,
    capability: 'supportsDrySampler',
    tooltip: 'DRY 采样惩罚基数。值越大惩罚增长越陡峭。',
  },
  {
    key: 'dry_allowed_length',
    label: 'DRY Allowed Length',
    min: 1,
    max: 10,
    step: 1,
    defaultValue: 2,
    capability: 'supportsDrySampler',
    tooltip: '允许重复的最短 token 长度。短于此长度的重复不受惩罚。',
  },
  {
    key: 'no_repeat_ngram_size',
    label: 'No Repeat Ngram Size',
    min: 0,
    max: 10,
    step: 1,
    defaultValue: 0,
    capability: 'supportsDrySampler',
    tooltip: 'n-gram 硬约束：禁止生成长度为此值的重复 n-gram。0 = 关闭（避免影响中文流畅性）。',
  },
];

/** 引擎级采样字段键名清单（脏检测 / 表单同步用） */
export const ENGINE_DRY_FIELD_KEYS: readonly string[] = ENGINE_DRY_CONFIGS.map(c => c.key);
