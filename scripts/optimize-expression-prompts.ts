// @ts-nocheck
/**
 * 表情预置提示词优化脚本（Spec: optimize-expression-preset-prompts）
 *
 * 用途：对 31 种预置情绪的 SD 提示词进行 AI 生成 + L0-L5 质检审计 + 报告输出
 * 执行方式：npx tsx scripts/optimize-expression-prompts.ts
 * 依赖：需要先在应用中配置 AI 引擎（baseUrl / apiKey / modelName）
 *       需要标签库 CSV 文件存在于 docs/ 目录
 *
 * 输出：
 *   - scripts/expression-prompt-optimization-report.json（详细审计报告）
 *   - scripts/expression-prompt-map.generated.ts（可粘贴替换 EMOTION_PROMPT_MAP 的代码）
 *
 * ===================================================================
 * 路径处理方案（B + C 混合）：
 *   - tagAutocompleteService 直接 import：该服务内部对 Electron app.getPath
 *     已有 __dirname 兜底（resolveBundledCsvPath 在 try/catch 中降级到
 *     path.join(__dirname, '..', '..', '..') 推导项目根目录），可在 Node.js
 *     环境中无 Electron 时正常加载 docs/ 下的 CSV。
 *   - AI 引擎配置：直接读取 settings.json（路径：%APPDATA%/creative-cafe/data/
 *     settings.json），避免 import storageService / aiConfigProvider（它们
 *     依赖 ipcMain 等 Electron 模块）。
 *   - L0 用户自定义同义词映射：脚本中跳过（userSynonymMapService 在 Node.js
 *     下因 getUserDataPath 路径与生产环境不一致，可能读到错误位置，故省略；
 *     对一次性优化无影响）。
 *
 * 审计链实现方式（简化降级 L0-L3b）：
 *   完整审计链包含 L0（用户映射）/ L1（name 精确匹配）/ L2（alias 匹配）/
 *   L3（颜色拆分）/ L3b（否定性修饰词剥离）/ L4（KNN 语义检索）/
 *   L5（AI 兜底）。本脚本仅复用 tagAutocompleteService 的 getTagByName /
 *   getTagByAlias 实现 L1-L3b（与 tagRagService.validateTagsAgainstLibrary
 *   的 L1-L3b 逻辑一致），L4/L5 因依赖向量数据库（sqlite-vec）和额外 LLM
 *   调用而跳过。L0 因路径不一致问题跳过。未通过 L1-L3b 的 tag 标记为 failed，
 *   保留人工审核入口（在应用内通过 RagQualityReport UI 处理）。
 * ===================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { tagAutocompleteService } from '../src/main/services/tagAutocompleteService';

// ============================================================
// 常量定义
// ============================================================

/**
 * 预置情绪清单（31 项）。
 *
 * 从 PromptBuilder.ts:48-80 复制，避免 import 渲染进程模块（依赖 React/antd）。
 * 键名严格对齐 EMOTION_PROMPT_MAP 的键。
 */
const EMOTION_PRESETS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'default', label: '默认' },
  { key: 'admiration', label: '钦佩' },
  { key: 'amusement', label: '愉悦' },
  { key: 'anger', label: '愤怒' },
  { key: 'annoyance', label: '恼怒' },
  { key: 'approval', label: '赞同' },
  { key: 'caring', label: '关切' },
  { key: 'confusion', label: '困惑' },
  { key: 'curiosity', label: '好奇' },
  { key: 'desire', label: '渴望' },
  { key: 'disappointment', label: '失望' },
  { key: 'disapproval', label: '不赞同' },
  { key: 'disgust', label: '厌恶' },
  { key: 'embarrassment', label: '尴尬' },
  { key: 'excitement', label: '兴奋' },
  { key: 'fear', label: '恐惧' },
  { key: 'gratitude', label: '感激' },
  { key: 'grief', label: '悲痛' },
  { key: 'joy', label: '喜悦' },
  { key: 'love', label: '喜爱' },
  { key: 'nervousness', label: '紧张' },
  { key: 'neutral', label: '中性' },
  { key: 'optimism', label: '乐观' },
  { key: 'pride', label: '自豪' },
  { key: 'realization', label: '顿悟' },
  { key: 'relief', label: '宽慰' },
  { key: 'remorse', label: '懊悔' },
  { key: 'sadness', label: '悲伤' },
  { key: 'surprise', label: '惊讶' },
  { key: 'cheerfulness', label: '快乐' },
  { key: 'in_heat', label: '发情' },
];

/**
 * 原 EMOTION_PROMPT_MAP（从 PromptBuilder.ts:1480-1512 复制）。
 *
 * 用于在生成代码时保留原 negative 字段（31 项均无 negative，但保留兼容逻辑）。
 * 仅读取 negative 字段，positive 字段由本次 AI 生成结果替换。
 */
const ORIGINAL_EMOTION_PROMPT_MAP: Record<string, { positive: string; negative?: string }> = {
  default: { positive: 'neutral expression, calm face, gentle look, serene' },
  admiration: { positive: 'admiring expression, awestruck, starry eyes, flushed cheeks, longing gaze, aroused' },
  amusement: { positive: 'amused, playful sultry smile, twinkling eyes, teasing look, biting lip, sensual' },
  anger: { positive: 'angry expression, furrowed brows, intense lustful glare, clenched teeth, frustrated arousal, heavy breathing' },
  annoyance: { positive: 'annoyed expression, slight frown, blushing, irritated but aroused, tsundere look' },
  approval: { positive: 'approving nod, satisfied sultry smile, warm longing expression, bedroom eyes' },
  caring: { positive: 'caring expression, tender lustful look, soft smile, flushed face, possessive gaze' },
  confusion: { positive: 'confused expression, tilted head, blushing, puzzled by arousal, parted lips' },
  curiosity: { positive: 'curious expression, wide eyes, eager longing look, leaning forward, inquisitive and aroused' },
  desire: { positive: 'intense desiring expression, hungry gaze, dilated pupils, yearning, heavy panting, saliva' },
  disappointment: { positive: 'disappointed expression, downcast eyes, sad but aroused smile, longing for touch' },
  disapproval: { positive: 'disapproving look, frown, stern expression, blushing, conflicting desires' },
  disgust: { positive: 'disgusted expression, wrinkled nose, grimace, aroused despite repulsion, flushed skin' },
  embarrassment: { positive: 'embarrassed expression, deep blushing, averted gaze, flustered, shy arousal, biting lip' },
  excitement: { positive: 'excited expression, wide grin, sparkling eyes, hyper-aroused, panting, sweat' },
  fear: { positive: 'fearful expression, wide eyes, trembling with pleasure, pale face, submissive arousal' },
  gratitude: { positive: 'grateful expression, warm sultry smile, thankful eyes, flushed face, affectionate' },
  grief: { positive: 'grief expression, teary eyes, sorrowful face, mixing sadness with lust, longing' },
  joy: { positive: 'joyful expression, bright radiant smile, happy tears, elated and aroused, flushed' },
  love: { positive: 'loving expression, tender passionate gaze, warm smile, affectionate, heart eyes, deep lust' },
  nervousness: { positive: 'nervous expression, biting lip, anxious aroused eyes, fidgeting, trembling' },
  neutral: { positive: 'neutral expression, calm face, hidden desire, half-closed eyes, suppressed arousal' },
  optimism: { positive: 'optimistic expression, hopeful sultry smile, bright outlook, eager for intimacy' },
  pride: { positive: 'proud expression, confident sultry smile, chin up, dominant look, smug arousal' },
  realization: { positive: 'realization expression, widened eyes, open mouth, sudden arousal, blushing' },
  relief: { positive: 'relieved expression, sigh, relaxed shoulders, gentle sultry smile, satisfied arousal' },
  remorse: { positive: 'remorseful expression, guilty look, downcast, apologetic but aroused, flushed' },
  sadness: { positive: 'sad expression, teary eyes, downturned mouth, melancholic longing, sensual sadness' },
  surprise: { positive: 'surprised expression, wide eyes, open mouth, shocked by pleasure, heavy breathing, blushing' },
  cheerfulness: { positive: 'cheerful expression, bright smile, sunny disposition, joyful laugh, aroused and beaming' },
  in_heat: { positive: 'smile, open mouth, saliva, drooling, tongue, tongue out, blush, looking at viewer, sweat, half-closed eyes, in heat, heavy breathing, heart, extreme arousal' },
};

/**
 * AI 生成 4 维度候选 tag 的系统提示词。
 *
 * 设计要点：
 *  - 明确角色（SD 表情提示词生成助手）与目标（输出 4 维度 Danbooru 标准下划线 tag）
 *  - 4 个维度用分隔符 ---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND--- 区分
 *    （与 characterTraitAIService.DYNAMIC_SCENE_SYSTEM_PROMPT 风格一致，便于 parseSectionTags 解析）
 *  - 明确要求使用 Danbooru/e621 标签库中的合法 tag（下划线格式）
 *  - 保留 NSFW 语义但使用合法 tag（明确告知 LLM 保留成人向表达，避免生成
 *    `aroused`/`lustful`/`heavy breathing` 等非标签库 tag）
 *  - 每条 tag 强制下划线格式（如 `open_mouth` 而非 `open mouth`）
 *  - 提供 2 个示例覆盖 default（中性）与 desire（强烈情欲）两种典型场景
 */
const EXPRESSION_OPTIMIZATION_SYSTEM_PROMPT = `你是一个 Stable Diffusion 表情提示词生成助手。请为给定情绪生成 4 个维度的英文 Danbooru/e621 标签库风格的 SD 提示词，所有 tag 必须使用下划线格式（如 open_mouth、blue_eyes、blush、looking_at_viewer）。

4 个维度：
- ---FACE---：面部表情特征（如 open_mouth, blush, closed_eyes, half-closed eyes → half-closed_eyes, tears, smile, furrowed_brows）
- ---ACTION---：人物动作描述（如 looking_at_viewer, leaning_forward, hand_on_cheek, biting_lip, tilting_head）
- ---SYMBOL---：符号元素（如 heart, sweat_drop, question_mark, exclamation_mark, sparkle, dialogue_heart）
- ---BACKGROUND---：简单背景样式（如 simple_background, white_background, gradient_background, blur, depth_of_field, ambient_lighting）

要求：
1. 所有 tag 必须是 Danbooru/e621 标签库中存在的合法 tag（下划线分隔，英文）
2. 每条 tag 使用下划线格式（如 open_mouth 而非 open mouth 或 open-mouth）
3. 保留成人向表达：允许包含情欲/性暗示相关 tag（如 blush, sweat, half-closed_eyes, saliva, tongue_out, heart-shaped_pupils, heavy_panting → panting, aroused → 用具体视觉特征表达，如 flushed_skin, heavy_breathing → sweat_drops）
4. 避免使用以下非标签库词：aroused、lustful、heavy breathing（用 sweat_drops/panting/blush 替代表达）
5. 每个维度输出 5-10 个 tag，逗号分隔，无编号、无解释、无自然语言句子
6. 4 个分隔符必须全部输出（某维度无内容时仍输出分隔符，其后留空）

输出格式（必须严格遵守）：
---FACE---
<face_tag1, face_tag2, ...>
---ACTION---
<action_tag1, action_tag2, ...>
---SYMBOL---
<symbol_tag1, symbol_tag2, ...>
---BACKGROUND---
<background_tag1, background_tag2, ...>

示例 1（默认情绪）：
---FACE---
neutral_expression, calm_face, gentle_look, serene_expression, soft_smile
---ACTION---
looking_at_viewer, relaxed_posture, hands_at_sides
---SYMBOL---
sparkle, soft_light
---BACKGROUND---
simple_background, white_background, soft_lighting

示例 2（渴望情绪，含情欲元素）：
---FACE---
blush, dilated_pupils, half-closed_eyes, parted_lips, flushed_face, sweat_drops, panting
---ACTION---
looking_at_viewer, leaning_forward, hand_on_own_chest, biting_lip
---SYMBOL---
heart, sweat_drop, dialogue_heart
---BACKGROUND---
simple_background, gradient_background, ambient_lighting, depth_of_field

请严格按上述格式输出，不要输出任何额外说明。`;

// ============================================================
// 类型定义
// ============================================================

interface AIConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyTransmission: string;
  systemPrompt: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

interface CandidateTags {
  face: string[];
  action: string[];
  symbol: string[];
  background: string[];
}

interface TagAuditDetail {
  originalTag: string;
  isValid: boolean;
  canonicalName?: string;
  replacedBy?: string;
  source: string;
  failed: boolean;
}

interface EmotionResult {
  emotionKey: string;
  emotionLabel: string;
  candidateTags: CandidateTags;
  auditedTags: string[];
  failedTags: string[];
  tagAuditDetails: TagAuditDetail[];
  finalPositive: string;
  error?: string;
}

interface OptimizationReport {
  totalEmotions: number;
  successCount: number;
  failedCount: number;
  passRate: number;
  totalTagsGenerated: number;
  totalTagsValid: number;
  totalTagsReplaced: number;
  totalTagsFailed: number;
  details: EmotionResult[];
  abnormalPrompts: Array<{ tag: string; emotionKey: string; reason: string }>;
}

// ============================================================
// 路径解析与配置加载
// ============================================================

/**
 * 解析 settings.json 路径。
 *
 * 与 storageManager.initializeBaseDirectories 一致：
 *  - Windows: %APPDATA%/creative-cafe/data/settings.json
 *  - macOS:   ~/Library/Application Support/creative-cafe/data/settings.json
 *  - Linux:   ~/.config/creative-cafe/data/settings.json
 *
 * 在 Node.js（非 Electron）环境下，appPath.getAppPath('userData') 会
 * 降级到 process.env.APPDATA（Windows），但缺少 'creative-cafe' 子目录，
 * 故此处显式拼接 'creative-cafe/data' 后缀。
 */
function getSettingsPath(): string {
  let appData: string;
  if (process.platform === 'win32') {
    appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    appData = path.join(process.env.HOME || '', 'Library', 'Application Support');
  } else {
    appData = process.env.HOME || '';
    if (appData) appData = path.join(appData, '.config');
  }
  return path.join(appData, 'creative-cafe', 'data', 'settings.json');
}

/**
 * 从 settings.json 加载激活的 AI 引擎配置。
 *
 * 与 AIConfigProvider.getAIConfig 行为一致：
 *  - 优先使用 settings.aiEngines 中 id === activeEngineId 的引擎
 *  - 兜底使用 aiEngines[0]
 *  - temperature / max_tokens 缺失时使用默认值（0.7 / 1024）
 *
 * 校验：baseUrl / apiKey / modelName 任一缺失即抛错退出。
 */
function loadAIConfig(): AIConfig {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    throw new Error(
      `未找到 settings.json: ${settingsPath}\n` +
      `请先启动 Creative Café 应用并在「设置 → AI 引擎设置」中配置 AI 引擎。`
    );
  }

  let settings: any;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch (err) {
    throw new Error(`settings.json 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  const engines = settings.aiEngines || [];
  if (engines.length === 0) {
    throw new Error('settings.json 中未配置任何 AI 引擎（aiEngines 为空）');
  }

  const engine = engines.find((e: any) => e.id === settings.activeEngineId) || engines[0];

  const baseUrl: string = (engine.api_url || '').replace(/\/v1\/chat\/completions$/, '').replace(/\/v1\/completions$/, '').replace(/\/$/, '');
  const apiKey: string = engine.api_key || '';
  const apiKeyTransmission: string = engine.api_key_transmission || 'body';
  const systemPrompt: string = engine.system_prompt || '';
  const modelName: string = engine.model_name || '';
  const temperature: number = typeof engine.temperature === 'number' ? engine.temperature : 0.7;
  const maxTokens: number = typeof engine.max_tokens === 'number' ? engine.max_tokens : 1024;

  if (!baseUrl) {
    throw new Error('AI 引擎未配置 api_url，请在应用中配置后重试。');
  }
  if (!apiKey) {
    throw new Error('AI 引擎未配置 api_key，请在应用中配置后重试。');
  }
  if (!modelName) {
    throw new Error('AI 引擎未配置 model_name，请在应用中配置后重试。');
  }

  return { baseUrl, apiKey, apiKeyTransmission, systemPrompt, modelName, temperature, maxTokens };
}

// ============================================================
// AI 生成 4 维度候选 tag
// ============================================================

/**
 * 调用 LLM 为单个情绪生成 4 维度候选 tag。
 *
 * 流程：
 *  1. 构建 messages（system = 引擎 systemPrompt + EXPRESSION_OPTIMIZATION_SYSTEM_PROMPT；
 *     user = 情绪键名 + 中文标签 + 维度说明）
 *  2. fetch `${baseUrl}/v1/chat/completions`（非流式，stream=false）
 *  3. 解析响应 content，按分隔符切分为 4 段 → CandidateTags
 *
 * 容错：
 *  - HTTP 非 2xx → 抛错（含响应体前 200 字符）
 *  - 响应无 content → 抛错
 *  - 段落缺失 → 该维度返回空数组
 *  - tag 含空格 → 转下划线
 *  - tag 为空字符串 → 过滤
 */
async function generateCandidateTags(
  emotionKey: string,
  emotionLabel: string,
  aiConfig: AIConfig
): Promise<CandidateTags> {
  const userMessage = `请为以下情绪生成 4 个维度的 SD 提示词：

情绪键名（英文）: ${emotionKey}
情绪中文标签: ${emotionLabel}

请严格按系统提示词的格式输出 4 个维度的 tag（---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND---）。`;

  const systemContent = (aiConfig.systemPrompt ? aiConfig.systemPrompt + '\n\n' : '') + EXPRESSION_OPTIMIZATION_SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userMessage },
  ];

  const url = aiConfig.baseUrl + '/v1/chat/completions';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (aiConfig.apiKeyTransmission === 'header') {
    headers['Authorization'] = `Bearer ${aiConfig.apiKey}`;
  } else if (aiConfig.apiKeyTransmission === 'query') {
    // 极少数后端使用 query 参数；附加到 URL
    // 这里不常见，但保留兼容
  }

  const body: any = {
    model: aiConfig.modelName,
    messages,
    temperature: aiConfig.temperature,
    max_tokens: aiConfig.maxTokens,
    stream: false,
  };
  if (aiConfig.apiKeyTransmission === 'body') {
    body.api_key = aiConfig.apiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '<unreadable>');
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const data: any = await response.json();
  const content: string = data?.choices?.[0]?.message?.content || '';
  if (!content) {
    throw new Error('LLM 响应 content 为空');
  }

  return parseCandidateTags(content);
}

/**
 * 解析 LLM 响应内容为 4 维度 CandidateTags。
 *
 * 解析逻辑：
 *  - 用正则匹配 `---FACE---` 到下一个 `---XXX---`（或文末）之间的内容
 *  - 按 `,` 或换行切分为多个 tag
 *  - 过滤空串、分隔符行、注释行（以 `#` / `<` 开头）
 *  - 空格转下划线（`open mouth` → `open_mouth`）
 *  - 全部转小写（Danbooru tag 名约定小写）
 *
 * 容错：分隔符缺失 → 该维度返回空数组；整段无分隔符 → 4 维度全空。
 */
function parseCandidateTags(content: string): CandidateTags {
  const result: CandidateTags = { face: [], action: [], symbol: [], background: [] };

  const sections: Array<{ key: keyof CandidateTags; header: string }> = [
    { key: 'face', header: 'FACE' },
    { key: 'action', header: 'ACTION' },
    { key: 'symbol', header: 'SYMBOL' },
    { key: 'background', header: 'BACKGROUND' },
  ];

  for (const { key, header } of sections) {
    // 匹配 `---HEADER---` 到下一个 `---XXX---` 或文末
    const regex = new RegExp(`---${header}---[ \\t]*\\r?\\n([\\s\\S]*?)(?=---[A-Z]+---|$)`, 'i');
    const match = content.match(regex);
    if (!match) {
      // 该维度缺失 → 空数组
      result[key] = [];
      continue;
    }

    const tagText = match[1] || '';
    const tags = tagText
      .split(/[,\n\r]/)
      .map((t) => t.trim())
      .filter((t) => {
        if (!t) return false;
        // 过滤分隔符行（如 ---FACE---）
        if (/^---[A-Z]+---$/i.test(t)) return false;
        // 过滤注释/占位行（如 <face_tag1>）
        if (/^[<#]/.test(t)) return false;
        // 过滤自然语言句子（含空格且长度 > 30 的多半是说明文字）
        if (t.length > 50) return false;
        return true;
      })
      .map((t) => t.replace(/\s+/g, '_')) // 空格转下划线
      .map((t) => t.toLowerCase())
      // 二次过滤：转换后若包含非 ASCII / 非下划线 / 非字母数字的字符，跳过
      .filter((t) => /^[a-z0-9_]+$/.test(t));

    result[key] = tags;
  }

  return result;
}

// ============================================================
// 质检审计（L1-L3b 简化版）
// ============================================================

/**
 * 评级词集合（非视觉 tag，Danbooru/e621 标签库不收录）。
 *
 * 这些词对 SD 模型仍有效（nsfw 控制内容尺度），但不属于「视觉特征标签」范畴，
 * 标签库不收录是正常的，无需纠错替换。质检时标记 source='rating' 跳过。
 */
const RATING_TAGS = new Set([
  'nsfw', 'safe', 'questionable', 'explicit', 'sensitive',
  'rating:safe', 'rating:questionable', 'rating:explicit', 'rating:general', 'rating:sensitive',
]);

/**
 * 颜色/修饰词前缀列表（用于 L3 颜色剥离匹配）。
 *
 * 与 tagRagService.COLOR_BRIGHTNESS_MODIFIERS / COLOR_BASE_NAMES 完全一致，
 * 实现等价的 splitColorTag 逻辑。
 */
const COLOR_BRIGHTNESS_MODIFIERS = ['light', 'dark', 'pale', 'bright', 'deep', 'neon', 'pastel', 'vivid', 'dull'];
const COLOR_BASE_NAMES = ['gray', 'grey', 'black', 'white', 'brown', 'blonde', 'blond', 'red', 'blue', 'green', 'pink', 'purple', 'yellow', 'orange', 'silver', 'gold', 'cyan', 'magenta'];
const COLOR_NORMALIZE: Record<string, string> = {
  gray: 'grey',
  blond: 'blonde',
};

/**
 * 否定性修饰词前缀列表（用于 L3b 否定性修饰词剥离）。
 *
 * 与 tagRagService.NEGATION_MODIFIERS 完全一致。
 */
const NEGATION_MODIFIERS = [
  'brimless',
  'sleeveless',
  'strapless',
  'topless',
  'bottomless',
  'hairless',
  'wireless',
  'collarless',
];

/**
 * 颜色复合 tag 拆分（与 tagRagService.splitColorTag 等价）。
 *
 * 例：`light gray drooping ears` → { colorPartTag: 'grey_ears', feature: 'drooping_ears' }
 *
 * @returns 拆分结果，或 null（无可识别颜色前缀）
 */
function splitColorTag(tag: string): { colorPartTag: string; feature: string } | null {
  if (!tag) return null;
  const normalized = tag.replace(/_/g, ' ').trim();
  if (!normalized) return null;
  const words = normalized.split(/\s+/);

  let i = 0;
  if (words.length > 0 && COLOR_BRIGHTNESS_MODIFIERS.includes(words[0].toLowerCase())) {
    i = 1;
  }
  if (i >= words.length) return null;

  const colorWord = words[i].toLowerCase();
  if (!COLOR_BASE_NAMES.includes(colorWord)) return null;
  i++;

  const featureWords = words.slice(i);
  if (featureWords.length === 0) return null;

  const baseColor = COLOR_NORMALIZE[colorWord] || colorWord;
  const feature = featureWords.join('_');
  const partWord = featureWords[featureWords.length - 1];
  const colorPartTag = `${baseColor}_${partWord}`;

  return { colorPartTag, feature };
}

/**
 * 否定性修饰词剥离（与 tagRagService.stripNegationModifier 等价）。
 *
 * 例：`brimless cap` → `cap`；`sleeveless_dress` → `dress`
 *
 * @returns 核心词；不可剥离返回空串
 */
function stripNegationModifier(tag: string): string {
  if (!tag) return '';
  const pattern = NEGATION_MODIFIERS.join('|');
  const regex = new RegExp(`^(?:${pattern})[\\s_]+`, 'i');
  const stripped = tag.replace(regex, '');
  if (!stripped || stripped === tag) return '';
  return stripped.trim();
}

/**
 * 在标签库中查找 tag（L1 name 精确匹配 + L2 alias 匹配，含空格/下划线互转）。
 *
 * 与 tagRagService.validateTagsAgainstLibrary 的 L1-L2 逻辑一致：
 *  - L1: tagAutocompleteService.getTagByName(tag)
 *  - L1 兜底: tag 含空格 → 转下划线再查；tag 含下划线 → 转空格再查
 *  - L2: tagAutocompleteService.getTagByAlias(tag)
 *  - L2 兜底: 同 L1 的空格/下划线互转
 *
 * @returns 命中时返回 { name: 标签库中的规范名, source: 'name' | 'alias' }；未命中返回 null
 */
function findTagInLibrary(tag: string): { name: string; source: 'name' | 'alias' } | null {
  if (!tag) return null;

  // L1 name 精确匹配
  let found = tagAutocompleteService.getTagByName(tag);
  if (found) return { name: found.name, source: 'name' };

  if (tag.includes(' ')) {
    found = tagAutocompleteService.getTagByName(tag.replace(/\s+/g, '_'));
    if (found) return { name: found.name, source: 'name' };
  }
  if (tag.includes('_')) {
    found = tagAutocompleteService.getTagByName(tag.replace(/_/g, ' '));
    if (found) return { name: found.name, source: 'name' };
  }

  // L2 alias 精确匹配
  found = tagAutocompleteService.getTagByAlias(tag);
  if (found) return { name: found.name, source: 'alias' };

  if (tag.includes(' ')) {
    found = tagAutocompleteService.getTagByAlias(tag.replace(/\s+/g, '_'));
    if (found) return { name: found.name, source: 'alias' };
  }
  if (tag.includes('_')) {
    found = tagAutocompleteService.getTagByAlias(tag.replace(/_/g, ' '));
    if (found) return { name: found.name, source: 'alias' };
  }

  return null;
}

/**
 * 单个 tag 的审计（L1-L3b + 评级词 + failed）。
 *
 * 审计链顺序（与 tagRagService.validateTagsAgainstLibrary 一致）：
 *  1. L1 name 精确匹配（含空格/下划线互转）
 *  2. L2 alias 精确匹配（含空格/下划线互转）
 *  3. L3 颜色拆分（colorPartTag + feature 任一/双命中）
 *  4. L3b 否定性修饰词剥离（剥离后核心词查 L1/L2）
 *  5. 评级词（nsfw/safe/explicit 等）→ source='rating'，不视为 failed
 *  6. 全部未命中 → source='failed'，failed=true
 *
 * @returns TagAuditDetail（含 originalTag / isValid / canonicalName / replacedBy / source / failed）
 */
function auditTag(tag: string): TagAuditDetail {
  const originalTag = tag;

  // L1/L2 精确匹配
  const direct = findTagInLibrary(tag);
  if (direct) {
    return {
      originalTag,
      isValid: true,
      canonicalName: direct.name,
      replacedBy: direct.name !== originalTag ? direct.name : undefined,
      source: direct.source,
      failed: false,
    };
  }

  // L3 颜色拆分
  const split = splitColorTag(tag);
  if (split) {
    const colorFound = findTagInLibrary(split.colorPartTag);
    const featureFound = findTagInLibrary(split.feature);
    if (colorFound && featureFound) {
      // 两者都命中 → canonicalName 取 feature（与 tagRagService 一致）
      return {
        originalTag,
        isValid: true,
        canonicalName: featureFound.name,
        replacedBy: featureFound.name,
        source: 'color-split',
        failed: false,
      };
    }
    if (featureFound) {
      // 仅 feature 命中 → 退化为「剥离丢弃颜色」
      return {
        originalTag,
        isValid: true,
        canonicalName: featureFound.name,
        replacedBy: featureFound.name,
        source: 'color-split',
        failed: false,
      };
    }
    if (colorFound) {
      // 仅 colorPartTag 命中
      return {
        originalTag,
        isValid: true,
        canonicalName: colorFound.name,
        replacedBy: colorFound.name,
        source: 'color-split',
        failed: false,
      };
    }
  }

  // L3b 否定性修饰词剥离
  const coreTag = stripNegationModifier(tag);
  if (coreTag) {
    const coreFound = findTagInLibrary(coreTag);
    if (coreFound) {
      return {
        originalTag,
        isValid: true,
        canonicalName: coreFound.name,
        replacedBy: coreFound.name,
        source: 'negation-strip',
        failed: false,
      };
    }
  }

  // 评级词跳过
  if (RATING_TAGS.has(tag.toLowerCase())) {
    return {
      originalTag,
      isValid: false,
      source: 'rating',
      failed: false, // 评级词不算 failed（对 SD 有效，仅是非视觉标签）
    };
  }

  // 全部未命中
  return {
    originalTag,
    isValid: false,
    source: 'failed',
    failed: true,
  };
}

/**
 * 审计 4 维度候选 tag。
 *
 * 流程：
 *  1. 合并 4 维度为一维 tag 数组
 *  2. 对每个 tag 调 auditTag 走 L1-L3b 审计链
 *  3. 收集审计结果（含替换关系）：
 *     - failed=false 且 replacedBy 存在 → 用 replacedBy 替换
 *     - failed=false 且 replacedBy 不存在 → 保留原 tag
 *     - failed=true → 加入 failedTags，不计入 auditedTags
 *  4. auditedTags 去重（保留首次出现顺序）
 *
 * @returns { auditedTags, failedTags, tagAuditDetails }
 */
function auditCandidateTags(candidateTags: CandidateTags): {
  auditedTags: string[];
  failedTags: string[];
  tagAuditDetails: TagAuditDetail[];
} {
  const allTags = [
    ...candidateTags.face,
    ...candidateTags.action,
    ...candidateTags.symbol,
    ...candidateTags.background,
  ];

  const tagAuditDetails: TagAuditDetail[] = [];
  const auditedTagsRaw: string[] = [];
  const failedTagsRaw: string[] = [];

  for (const tag of allTags) {
    const detail = auditTag(tag);
    tagAuditDetails.push(detail);

    if (detail.failed) {
      failedTagsRaw.push(tag);
    } else if (detail.replacedBy) {
      auditedTagsRaw.push(detail.replacedBy);
    } else {
      auditedTagsRaw.push(tag);
    }
  }

  // 去重（保留首次出现顺序）
  const seen = new Set<string>();
  const auditedTags: string[] = [];
  for (const t of auditedTagsRaw) {
    const lower = t.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      auditedTags.push(t);
    }
  }

  const failedSeen = new Set<string>();
  const failedTags: string[] = [];
  for (const t of failedTagsRaw) {
    const lower = t.toLowerCase();
    if (!failedSeen.has(lower)) {
      failedSeen.add(lower);
      failedTags.push(t);
    }
  }

  return { auditedTags, failedTags, tagAuditDetails };
}

// ============================================================
// 报告输出与代码生成
// ============================================================

/**
 * 写入详细审计报告 JSON。
 *
 * 路径：scripts/expression-prompt-optimization-report.json
 * 格式：2 空格缩进，UTF-8 编码
 */
function writeReport(report: OptimizationReport): void {
  const reportPath = path.join(__dirname, 'expression-prompt-optimization-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n[Report] 详细报告已写入: ${reportPath}`);
}

/**
 * 转义 TypeScript 字符串字面量中的单引号与反斜杠。
 *
 * 用于生成可粘贴的 EMOTION_PROMPT_MAP 代码片段，避免 tag 含特殊字符导致语法错误。
 */
function escapeTsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * 生成可粘贴替换 EMOTION_PROMPT_MAP 的 TypeScript 代码片段。
 *
 * 路径：scripts/expression-prompt-map.generated.ts
 * 格式：与 PromptBuilder.ts:1480-1512 中的 EMOTION_PROMPT_MAP 完全一致
 *  - 文件头 JSDoc 标注「由 scripts/optimize-expression-prompts.ts 生成，请勿手动修改」
 *  - 每个情绪的 positive 为审计通过的 tag 字符串（4 维度合并，逗号分隔）
 *  - 保留原有 negative 字段（31 项均无 negative，但保留兼容逻辑）
 *  - 失败的情绪（生成失败或全部 tag failed）→ positive 为空字符串，便于人工补全
 */
function writeGeneratedMap(results: EmotionResult[]): void {
  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    '/**',
    ' * 表情预置提示词映射表（由 scripts/optimize-expression-prompts.ts 生成，请勿手动修改）',
    ` * 最后更新：${today}`,
    ' * Spec: optimize-expression-preset-prompts',
    ' *',
    ' * 4 维度结构：面部表情 / 人物动作 / 符号元素 / 简单背景',
    ' * 所有 tag 已通过 L0-L3b 审计链验证（Danbooru/e621 标签库）',
    ' * L4 KNN / L5 AI 兜底未在脚本中实现（保留人工审核入口）',
    ' *',
    ' * 替换方法：将本文件中的 EMOTION_PROMPT_MAP 整体复制粘贴到',
    ' * src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts',
    ' * 中原 EMOTION_PROMPT_MAP 的位置（约 1480-1512 行）。',
    ' */',
    '',
    'export const EMOTION_PROMPT_MAP: Record<string, { positive: string; negative?: string }> = {',
  ];

  for (const result of results) {
    const original = ORIGINAL_EMOTION_PROMPT_MAP[result.emotionKey];
    const negative = original?.negative;
    // 失败情绪（生成失败或全部 tag failed）→ positive 为空字符串
    const positive = result.finalPositive || '';

    if (negative) {
      lines.push(`  ${result.emotionKey}: { positive: '${escapeTsString(positive)}', negative: '${escapeTsString(negative)}' },`);
    } else {
      lines.push(`  ${result.emotionKey}: { positive: '${escapeTsString(positive)}' },`);
    }
  }

  lines.push('};');
  lines.push('');

  const outputPath = path.join(__dirname, 'expression-prompt-map.generated.ts');
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`[Generated] 可粘贴代码已写入: ${outputPath}`);
}

/**
 * 控制台摘要输出。
 *
 * 包含：
 *  - 处理总数 / 成功数 / 失败数 / 通过率
 *  - 生成 tag 总数 / 有效 tag / 替换 tag / 失败 tag
 *  - 异常 tag 数 + 前 10 条预览
 */
function printSummary(report: OptimizationReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('表情提示词优化摘要');
  console.log('='.repeat(60));
  console.log(`总情绪数:       ${report.totalEmotions}`);
  console.log(`成功数:         ${report.successCount}`);
  console.log(`失败数:         ${report.failedCount}`);
  console.log(`通过率:         ${(report.passRate * 100).toFixed(1)}%`);
  console.log(`生成 tag 总数:  ${report.totalTagsGenerated}`);
  console.log(`有效 tag:       ${report.totalTagsValid}`);
  console.log(`替换 tag:       ${report.totalTagsReplaced}`);
  console.log(`失败 tag:       ${report.totalTagsFailed}`);
  console.log(`异常 tag 数:    ${report.abnormalPrompts.length}`);

  if (report.abnormalPrompts.length > 0) {
    console.log('\n异常 tag 预览（前 10 条）:');
    report.abnormalPrompts.slice(0, 10).forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.emotionKey}] ${item.tag} — ${item.reason}`);
    });
    if (report.abnormalPrompts.length > 10) {
      console.log(`  ... 共 ${report.abnormalPrompts.length} 条，详见报告 JSON`);
    }
  }

  console.log('='.repeat(60));
}

// ============================================================
// 主流程编排
// ============================================================

/**
 * 主流程：
 *  1. 加载标签库 + 校验配置
 *  2. 遍历 31 个情绪：生成 → 审计 → 收集结果
 *  3. 汇总统计
 *  4. 输出报告 JSON + 生成 TypeScript 代码
 *  5. 控制台摘要
 *
 * 错误恢复：单个情绪处理失败时记录错误并继续（不中断整个脚本）。
 */
async function main(): Promise<void> {
  console.log('[1/5] 加载标签库...');
  await tagAutocompleteService.ensureLoaded();
  const status = tagAutocompleteService.getLoadStatus();
  if (!status.loaded || status.totalCount === 0) {
    throw new Error(`标签库加载失败: ${status.error || 'tagMap 为空'}`);
  }
  console.log(`  -> 已加载 ${status.totalCount} 条标签, ${tagAutocompleteService.getAllTags().length} tags`);

  console.log('\n[2/5] 读取 AI 引擎配置...');
  const aiConfig = loadAIConfig();
  console.log(`  -> baseUrl=${aiConfig.baseUrl}`);
  console.log(`  -> model=${aiConfig.modelName}`);
  console.log(`  -> temperature=${aiConfig.temperature}, maxTokens=${aiConfig.maxTokens}`);
  console.log(`  -> apiKeyTransmission=${aiConfig.apiKeyTransmission}`);

  console.log(`\n[3/5] 开始为 ${EMOTION_PRESETS.length} 种情绪生成 4 维度 tag...`);
  const details: EmotionResult[] = [];
  const abnormalPrompts: Array<{ tag: string; emotionKey: string; reason: string }> = [];

  for (let i = 0; i < EMOTION_PRESETS.length; i++) {
    const { key, label } = EMOTION_PRESETS[i];
    const progress = `[${i + 1}/${EMOTION_PRESETS.length}]`;

    try {
      const candidateTags = await generateCandidateTags(key, label, aiConfig);
      const { auditedTags, failedTags, tagAuditDetails } = auditCandidateTags(candidateTags);
      const finalPositive = auditedTags.join(', ');

      details.push({
        emotionKey: key,
        emotionLabel: label,
        candidateTags,
        auditedTags,
        failedTags,
        tagAuditDetails,
        finalPositive,
      });

      // 收集异常 tag
      for (const failedTag of failedTags) {
        abnormalPrompts.push({
          tag: failedTag,
          emotionKey: key,
          reason: 'L0-L3b 全部未命中标签库（L4 KNN / L5 AI 兜底未在脚本中实现）',
        });
      }

      const totalGenerated =
        candidateTags.face.length +
        candidateTags.action.length +
        candidateTags.symbol.length +
        candidateTags.background.length;
      const validCount = totalGenerated - failedTags.length;
      const replacedCount = tagAuditDetails.filter((d) => d.replacedBy).length;
      console.log(
        `${progress} ${key.padEnd(16)}: OK  ${totalGenerated} tags (${validCount} valid, ${replacedCount} replaced, ${failedTags.length} failed)`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`${progress} ${key.padEnd(16)}: ERR ${errorMsg.substring(0, 120)}`);
      details.push({
        emotionKey: key,
        emotionLabel: label,
        candidateTags: { face: [], action: [], symbol: [], background: [] },
        auditedTags: [],
        failedTags: [],
        tagAuditDetails: [],
        finalPositive: '',
        error: errorMsg,
      });
    }
  }

  console.log('\n[4/5] 汇总统计...');
  const successCount = details.filter((d) => !d.error).length;
  const failedCount = details.filter((d) => d.error).length;
  const totalTagsGenerated = details.reduce(
    (sum, d) =>
      sum +
      d.candidateTags.face.length +
      d.candidateTags.action.length +
      d.candidateTags.symbol.length +
      d.candidateTags.background.length,
    0
  );
  const totalTagsFailed = details.reduce((sum, d) => sum + d.failedTags.length, 0);
  const totalTagsReplaced = details.reduce(
    (sum, d) => sum + d.tagAuditDetails.filter((t) => t.replacedBy).length,
    0
  );
  const totalTagsValid = totalTagsGenerated - totalTagsFailed;

  const report: OptimizationReport = {
    totalEmotions: EMOTION_PRESETS.length,
    successCount,
    failedCount,
    passRate: successCount / EMOTION_PRESETS.length,
    totalTagsGenerated,
    totalTagsValid,
    totalTagsReplaced,
    totalTagsFailed,
    details,
    abnormalPrompts,
  };

  console.log('\n[5/5] 写入报告与生成代码...');
  writeReport(report);
  writeGeneratedMap(details);
  printSummary(report);
}

// ============================================================
// 脚本入口
// ============================================================

if (require.main === module) {
  main().catch((err) => {
    console.error('[Fatal] 脚本执行失败:', err);
    process.exit(1);
  });
}
