/**
 * AI 参数滑块配置（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）
 *
 * 从 ParameterPanel.tsx 抽取为独立 .ts 模块，便于单元测试（避免 antd/React 依赖）。
 * 结构保持不变：每个 entry 包含 key/label/min/max/step/tooltip/defaultValue，
 * 新增可选 `capability` 字段标记该滑块仅当对应后端能力为 true 时显示。
 *
 * 借鉴来源：
 *   - SillyTavern textgen/Default.json: top_p=0.95, rep_pen=1.1~1.2
 *   - SillyTavern textgen-settings.js:143: DRY 采样 (dry_multiplier/dry_base/dry_allowed_length + no_repeat_ngram_size)
 */
import { AIParameterConfig } from './CharacterDialogueChat.types';
import { EngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import { DEFAULT_MAX_TOKENS } from './TokenManagement';

export interface ParameterConfig {
  key: keyof AIParameterConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  tooltip: string;
  defaultValue: number;
  /**
   * 可选：该滑块仅当对应 capability 为 true 时显示。
   *
   * Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4
   * - 'supportsRepPen' → repetition_penalty 滑块（仅 textgen-webui/koboldcpp 等后端显示）
   * - 'supportsDrySampler' → DRY 采样滑块组（同上）
   * 缺省时始终显示（向后兼容现有 top_p / freq_pen / pres_pen / temperature / max_tokens）。
   */
  capability?: keyof EngineCapabilities;
}

/**
 * 主参数配置（始终显示，不依赖 capabilities）。
 *
 * Spec: optimize-chat-ai-intelligence / Task 6.1
 * 调整默认值基线（借鉴 SillyTavern textgen/Default.json: top_p=0.95）：
 *   - top_p: 0.9 → 0.95
 *   - frequency_penalty: 0.0 → 0.3（原 0.0 是重复内容的核心成因之一）
 *   - presence_penalty: 0.0 → 0.3
 *   - temperature / max_tokens 保留原值
 */
export const PARAMETER_CONFIGS: ParameterConfig[] = [
  {
    key: 'max_tokens',
    label: 'Max Tokens',
    min: 256,
    max: 32768,
    step: 256,
    defaultValue: DEFAULT_MAX_TOKENS,
    tooltip: '模型生成的最大 token 数量。值越大，模型能输出的内容越长。默认值：8192',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0.1,
    max: 2.0,
    step: 0.05,
    defaultValue: 0.7,
    tooltip: '控制输出的随机性。较低值（0.1-0.5）使输出更确定和保守，较高值（0.8-2.0）使输出更创意和多样。推荐值：0.7-1.0',
  },
  {
    key: 'top_p',
    label: 'Top P',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    defaultValue: 0.95,
    tooltip: '核采样参数，控制输出的多样性。较低值使输出更集中，较高值使输出更多样。借鉴 SillyTavern Default.json 调整默认值为 0.95。推荐值：0.9-1.0',
  },
  {
    key: 'frequency_penalty',
    label: 'Frequency Penalty',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    defaultValue: 0.1,
    tooltip: '降低重复 token 的权重。正值减少重复，负值增加重复。原默认值 0.3 与 DRY 采样叠加导致回复过度缩短，现调整为 0.1。推荐值：0.1-0.3',
  },
  {
    key: 'presence_penalty',
    label: 'Presence Penalty',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    defaultValue: 0.1,
    tooltip: '鼓励模型谈论新话题。正值使模型更愿意引入新话题。原默认值 0.3 与 DRY 采样叠加导致回复过度缩短，现调整为 0.1。推荐值：0.1-0.3',
  },
  // repetition_penalty：仅当 engineCapabilities.supportsRepPen=true 时显示
  // Spec: optimize-chat-ai-intelligence / Task 6.1
  // 借鉴 SillyTavern textgen/Default.json (rep_pen=1.1~1.2)，默认 1.1。
  // 对不支持的后端（OpenAI/Anthropic）省略此字段，避免 4xx 错误。
  {
    key: 'repetition_penalty',
    label: 'Repetition Penalty',
    min: 0.8,
    max: 1.5,
    step: 0.05,
    defaultValue: 1.1,
    tooltip: '重复惩罚系数（仅 textgen-webui/koboldcpp 等后端支持）。借鉴 SillyTavern Default.json (rep_pen=1.1~1.2)。值 > 1 减少重复，过高会影响流畅性。推荐值：1.1-1.2',
    capability: 'supportsRepPen',
  },
];

/**
 * DRY 采样参数配置组（仅当 supportsDrySampler=true 时显示，位于"高级采样参数"折叠区）。
 *
 * Spec: optimize-chat-ai-intelligence / Task 6.4
 * 借鉴 SillyTavern textgen-settings.js:143，作为防重复采样层第二道防线，
 * 与应用层 n-gram Jaccard 去重（Task 5）形成双重防护。
 */
export const DRY_PARAMETER_CONFIGS: ParameterConfig[] = [
  {
    key: 'dry_multiplier',
    label: 'DRY Multiplier',
    min: 0,
    max: 2,
    step: 0.1,
    defaultValue: 0.8,
    tooltip: 'DRY 采样惩罚强度。0 = 禁用 DRY 采样；值越大对重复序列惩罚越强。借鉴 SillyTavern 默认值 0.8。',
  },
  {
    key: 'dry_base',
    label: 'DRY Base',
    min: 1,
    max: 3,
    step: 0.05,
    defaultValue: 1.75,
    tooltip: 'DRY 采样惩罚基数。值越大惩罚增长越陡峭。借鉴 SillyTavern 默认值 1.75。',
  },
  {
    key: 'dry_allowed_length',
    label: 'DRY Allowed Length',
    min: 1,
    max: 10,
    step: 1,
    defaultValue: 2,
    tooltip: '允许重复的最短 token 长度。短于此长度的重复不受惩罚。借鉴 SillyTavern 默认值 2。',
  },
  {
    key: 'no_repeat_ngram_size',
    label: 'No Repeat Ngram Size',
    min: 0,
    max: 10,
    step: 1,
    defaultValue: 0,
    tooltip: 'n-gram 硬约束：禁止生成长度为此值的重复 n-gram。0 = 关闭（默认，避免影响中文流畅性）。建议保持 0 或 2-3。',
  },
];

/**
 * 防重复强度三档预设（Spec: fix-ai-response-length-degradation / Task 5）。
 *
 * 用于 ParameterPanel 中的"防重复强度预设"区块，避免用户不理解
 * frequency_penalty / presence_penalty / dry_multiplier 三个参数关系
 * 导致过度惩罚（叠加后 AI 为避免重复而过度缩短回复）。
 *
 * 三档语义：
 *   - loose（宽松）：关闭所有防重复，适合短对话或创意写作
 *   - standard（标准）：轻微惩罚，兼顾流畅性与防重复（新默认档）
 *   - strict（严格）：强惩罚，适合长篇重复严重的场景（可能缩短回复）
 */
export interface AntiRepeatPreset {
  key: 'loose' | 'standard' | 'strict';
  label: string;
  values: {
    frequency_penalty: number;
    presence_penalty: number;
    dry_multiplier: number;
  };
}

export const ANTI_REPEAT_PRESETS: AntiRepeatPreset[] = [
  { key: 'loose', label: '宽松', values: { frequency_penalty: 0, presence_penalty: 0, dry_multiplier: 0 } },
  { key: 'standard', label: '标准', values: { frequency_penalty: 0.1, presence_penalty: 0.1, dry_multiplier: 0.4 } },
  { key: 'strict', label: '严格', values: { frequency_penalty: 0.3, presence_penalty: 0.3, dry_multiplier: 0.8 } },
];

/**
 * 回复长度引导配置（Spec: fix-ai-response-length-degradation / Task 7）。
 *
 * 独立于 PARAMETER_CONFIGS（因为它不是采样参数，而是提示词引导约束）。
 * 在 ParameterPanel 中以 Slider 形式暴露，写入 customParameters.min_response_chars。
 * PromptBuilder 读取该值并在系统提示末尾追加"每次回复应不少于 X 字"约束。
 */
export const MIN_RESPONSE_CHARS_CONFIG = {
  min: 100,
  max: 2000,
  step: 50,
  defaultValue: 300,
  tooltip: '回复长度引导约束。系统提示会要求 AI 每次回复不少于该字数。默认 300。设置为 100 以下可视为关闭。',
};
