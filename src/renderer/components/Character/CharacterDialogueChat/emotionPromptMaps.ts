/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——情绪预置与 SD 提示词映射（EMOTION_PRESETS + EMOTION_PROMPT_MAP + buildExpressionGenerationPrompt）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L40-L81 L1616-L1811。
 */
// ==================== 预置常量 ====================

/**
 * 预置情绪类别清单（Spec: add-character-expression-system）。
 *
 * 基于 GoEmotions 分类（27 项）+ default（默认）+ cheerfulness（快乐）共 30 项。
 * 每项含唯一英文键（AI 输出用）与中文标签（UI 展示用）。
 * 预置类别不可删除，用户可在此基础上追加自定义情绪。
 */
export const EMOTION_PRESETS: ReadonlyArray<{ key: string; label: string }> = [
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

// ==================== AI 表情生成：情绪 → SD 提示词映射 ====================
// Spec: add-ai-expression-generation / Task 3
// 用于 AI 表情生成（img2img）：以角色卡基底图片 + 情绪提示词生成对应表情图像，
// 与上方 `buildExpressionPrompt`（让 AI 在回复文本中输出情绪标记）为两套独立机制。

/**
 * 31 种预置情绪 → Stable Diffusion 提示词映射（Spec: add-ai-expression-generation / Task 3）。
 *
 * 用于 AI 表情生成：以角色卡基底图片 + img2img + 情绪提示词生成对应表情。
 * positive 为情绪正面提示词（英文，SD 语义），negative 为该情绪特有的负面提示词（可选）。
 *
 * 键名严格对齐 `EMOTION_PRESETS` 的 31 个 key（default / admiration / ... / cheerfulness / in_heat），
 * 自定义情绪（不在预置清单内）由 `buildExpressionGenerationPrompt` 通过 customLabel 兜底处理。
 *
 * 【Spec: optimize-expression-preset-prompts】
 * 由 scripts/optimize-expression-prompts.ts 生成，最后更新日期 2026-08-07，请勿手动修改。
 * 4 维度结构：面部表情（FACE）/ 人物动作（ACTION）/ 符号元素（SYMBOL）/ 简单背景（BACKGROUND）。
 * 所有 tag 已通过 L1-L3b 审计链验证（Danbooru/e621 标签库，317600 tags / 81700 aliases）。
 * 重新生成：`npx tsx scripts/optimize-expression-prompts.ts`（需配置 AI 引擎）。
 * 审计详情见 scripts/expression-prompt-optimization-report.json。
 */
export const EMOTION_PROMPT_MAP: Record<string, { positive: string; negative?: string }> = {
  default: { positive: 'neutral_expression, closed_mouth, light_smile, looking_at_viewer, standing, arms_at_sides, sparkle, simple_background, white_background, depth_of_field' },
  admiration: { positive: 'sparkling_eyes, wide-eyed, smile, blush, open_mouth, dilated_pupils, happy, looking_up, looking_at_viewer, leaning_forward, hands_together, clenched_hands, head_tilt, sparkle, star, heart, exclamation_point, simple_background, white_background, gradient_background, light_rays, ambient_lighting' },
  amusement: { positive: 'smile, grin, laughing, closed_eyes, happy, open_mouth, sparkling_eyes, playful_expression, looking_at_viewer, hand_on_mouth, head_tilt, leaning_back, wink, sparkle, musical_note, heart, simple_background, white_background, gradient_background, soft_lighting' },
  anger: { positive: 'angry, scowl, open_mouth, shouting, clenched_teeth, glaring, flushed_face, looking_at_viewer, clenched_hand, pointing, crossed_arms, leaning_forward, shaking, anger_vein, exclamation_point, fire, lightning, symbol, simple_background, red_background, speed_lines, motion_blur, ambient_lighting' },
  annoyance: { positive: 'scowl, frown, narrowed_eyes, pouting, annoyed, crossed_arms, looking_away, rolling_eyes, sighing, hand_on_hip, head_tilt, anger_vein, sweatdrop, exclamation_point, simple_background, white_background, gradient_background' },
  approval: { positive: 'smile, closed_eyes, pleased, closed_mouth, blush, happy, nodding, looking_at_viewer, thumbs_up, head_tilt, hands_on_hips, sparkle, heart, star, simple_background, white_background, gradient_background' },
  caring: { positive: 'blush, looking_at_viewer, reaching_out, hand_on_cheek, head_tilt, leaning_forward, hand_to_face, sparkle, heart, floating_heart, simple_background, white_background, blurred_background, soft_lighting, ambient_lighting' },
  confusion: { positive: 'open_mouth, squinting, blank_stare, head_tilt, scratching_head, hand_on_chin, hand_on_cheek, looking_away, looking_at_viewer, question_mark, sweatdrop, ellipsis, simple_background, white_background, gradient_background' },
  curiosity: { positive: 'wide-eyed, raised_eyebrows, parted_lips, slight_smile, open_mouth, looking_sideways, head_tilt, leaning_forward, hand_on_chin, looking_at_viewer, hand_on_cheek, finger_to_own_chin, question_mark, sparkle, thought_bubble, exclamation_point, emoji, simple_background, white_background, depth_of_field, ambient_lighting, gradient_background' },
  desire: { positive: 'blush, dilated_pupils, parted_lips, flushed_face, sweatdrop, panting, looking_at_viewer, leaning_forward, biting_lip, hand_on_cheek, hand_on_own_breast, head_tilt, reaching_out, heart, sparkle, simple_background, gradient_background, ambient_lighting, depth_of_field' },
  disappointment: { positive: 'sad, disappointed, frown, pout, downcast_eyes, unhappy, looking_away, looking_down, sigh, head_down, hand_on_face, sweatdrop, tears, blue_lines, simple_background, white_background, grey_background, dim_lighting' },
  disapproval: { positive: 'narrowed_eyes, scowl, frown, side_eye, displeased, closed_mouth, pout, crossed_arms, looking_away, hand_on_hip, head_tilt, looking_at_viewer, sighing, anger_vein, sweatdrop, exclamation_point, question_mark, simple_background, white_background, gradient_background' },
  disgust: { positive: 'disgust, scowl, sneer, frown, looking_down, looking_away, covering_mouth, crossed_arms, shrugging, sweatdrop, vein, exclamation_point, simple_background, white_background, depth_of_field' },
  embarrassment: { positive: 'blush, awkward_smile, open_mouth, flushed_face, looking_away, covering_mouth, scratching_head, fidgeting, shrugging, hand_on_cheek, sweatdrop, question_mark, exclamation_point, speech_bubble, simple_background, white_background, gradient_background, depth_of_field' },
  excitement: { positive: 'wide_eyed, open_mouth, blush, smile, grin, sparkling_eyes, dilated_pupils, flushed_face, looking_at_viewer, leaning_forward, arms_up, clenched_hands, jumping, hand_on_cheek, sparkle, exclamation_point, heart, musical_note, star, simple_background, white_background, gradient_background, depth_of_field' },
  fear: { positive: 'wide_eyed, dilated_pupils, open_mouth, trembling, pale_skin, teary_eyes, sweatdrop, shaking, cowering, covering_mouth, self_hug, looking_away, hand_on_face, exclamation_point, shadow, dark_aura, simple_background, dark_background, vignette, depth_of_field' },
  gratitude: { positive: 'smile, closed_eyes, blush, happy, sparkling_eyes, clasped_hands, bowing, looking_at_viewer, hand_on_chest, head_tilt, sparkle, heart, floating_heart, simple_background, white_background, soft_lighting, bokeh, ambient_lighting' },
  grief: { positive: 'crying, tears, streaming_tears, sad, sorrow, closed_eyes, open_mouth, trembling, covering_face, hand_on_face, looking_down, shaking, clutching_chest, kneeling, sobbing, rain, broken_heart, dark_aura, gloom_(expression), simple_background, dark_background, depth_of_field' },
  joy: { positive: 'smile, laughing, open_mouth, blush, closed_eyes, sparkling_eyes, wide_smile, looking_at_viewer, arms_up, jumping, head_tilt, clenched_hands, heart, sparkle, musical_note, flower, confetti, star, simple_background, white_background, gradient_background, colorful_background' },
  love: { positive: 'blush, closed_eyes, sparkling_eyes, happy, joyful, open_mouth, looking_at_viewer, leaning_forward, hand_on_cheek, head_tilt, self_hug, heart, heart_bubbles, sparkle, musical_note, flower, simple_background, white_background, pink_background, gradient_background, pastel_background' },
  nervousness: { positive: 'blush, sweatdrop, nervous_smile, wide-eyed, worried, looking_away, interlocked_fingers, hand_to_mouth, hand_to_face, exclamation_point, question_mark, swirl, speech_bubble, simple_background, white_background, gradient_background, depth_of_field' },
  neutral: { positive: 'neutral_expression, expressionless, closed_mouth, blank_stare, looking_at_viewer, standing, arms_at_sides, staring, sparkle, simple_background, white_background, grey_background, flat_color, ambient_lighting' },
  optimism: { positive: 'smile, happy, sparkling_eyes, open_mouth, wide_eyed, cheerful, looking_at_viewer, waving, head_tilt, arms_up, jumping, v_sign, sparkle, star, musical_note, sun, heart, simple_background, white_background, sunny, blue_sky' },
  pride: { positive: 'smug, raised_eyebrow, grin, looking_down, smirk, crossed_arms, hand_on_hip, chin_up, leaning_back, looking_at_viewer, sparkle, star, light_rays, shining, simple_background, white_background, spotlight, gradient_background' },
  realization: { positive: 'wide-eyed, open_mouth, raised_eyebrows, dilated_pupils, surprised, staring, looking_up, raised_finger, hand_on_forehead, gasp, head_tilt, looking_at_viewer, exclamation_point, sparkle, sweatdrop, light_bulb, simple_background, white_background, speed_lines, gradient_background' },
  relief: { positive: 'closed_eyes, light_smile, relaxed_expression, serene, slight_blush, sighing, hand_on_chest, leaning_back, looking_up, hand_on_forehead, closing_eyes, sweatdrop, sparkle, light_particles, musical_note, simple_background, white_background, gradient_background, soft_lighting' },
  remorse: { positive: 'sad, frown, downcast_eyes, tears, pained_expression, crying, looking_down, hand_on_face, covering_face, head_down, kneeling, curled_up, clenched_hands, teardrop, dark_aura, rain, shadow, broken_heart, simple_background, grey_background, dim_lighting, dark_background' },
  sadness: { positive: 'tears, crying, sad, frown, downcast_eyes, watery_eyes, sobbing, pout, looking_down, covering_face, self_hug, wiping_tears, curled_up, slouching, looking_away, teardrop, broken_heart, rain, gloom_(expression), simple_background, grey_background, dark_background, depth_of_field, ambient_lighting' },
  surprise: { positive: 'surprised, wide_eyed, open_mouth, raised_eyebrows, shocked, blush, dilated_pupils, looking_at_viewer, covering_mouth, hands_up, leaning_back, startled, head_tilt, exclamation_point, sweatdrop, sparkle, simple_background, white_background, gradient_background, depth_of_field' },
  cheerfulness: { positive: 'smile, open_mouth, happy, blush, closed_eyes, sparkling_eyes, wide_eyed, looking_at_viewer, laughing, v, waving, jumping, head_tilt, arms_up, sparkle, heart, musical_note, star, petals, confetti, simple_background, white_background, sunlight, colorful_background, gradient_background' },
  in_heat: { positive: 'blush, saliva, tongue_out, parted_lips, flushed_face, sweatdrop, dilated_pupils, panting, looking_at_viewer, biting_lip, hand_on_breast, hand_on_thigh, leaning_forward, arched_back, heart, sparkle, steam, simple_background, white_background, gradient_background, depth_of_field' },
};

/**
 * 构建 AI 表情生成的 SD 提示词（Spec: add-ai-expression-generation / Task 3）。
 *
 * 【重点标记 - 提示词可编辑】
 * 原实现使用角色卡 description 字段（自然语言长文本）作为 SD 提示词基底，
 * 但 description 通常是完整的段落描述（如"她是一个温柔的女孩..."），不适合 SD 的
 * tag 格式。修改后改为使用用户可编辑的正面提示词模板（含 {emotion} 占位符），
 * 用户可在设置页或生成弹窗中自定义角色外观 tag（如 "1girl, silver hair, blue eyes"）。
 *
 * 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】
 * 函数签名新增 `characterTraits?: Array<{ text: string; weight?: number }>` 参数，用于将角色视觉特征 tag
 * （如 `['white fur', 'dog girl']`）注入到正面提示词模板的 `{traits}` 占位符中。
 *
 * 提示词组合规则：
 *   - 正面提示词：先替换 `{traits}` 占位符为特征 tag 字符串，再替换 `{emotion}` 占位符为情绪专用提示词
 *   - 预置情绪：从 `EMOTION_PROMPT_MAP` 取 positive / negative
 *   - 自定义情绪（key 不在 MAP 中）：以 customLabel 兜底，组成 `${customLabel} expression, emotional face`
 *   - 负面提示词：用户自定义负面词优先；否则使用通用默认 + 情绪特有负面（若有）
 *
 * 【重点标记 - 特征携带机制 - 占位符注入逻辑】
 * - 若模板含 `{traits}` 占位符：将 traits 拼接为逗号分隔字符串替换占位符
 *   （空 traits 替换为空字符串，并清理多余逗号与空格）
 * - 若模板不含 `{traits}` 占位符（旧配置兼容）：traitsStr 非空时在 prompt 开头
 *   追加 `traitsStr + ', '`；traitsStr 为空时不追加，保持原模板行为
 * - 与 sdGenerationService.generateExpression 的清理逻辑形成"上游 + 下游"双重保险：
 *   本函数（上游）先做一次清理，sdGenerationService（下游）再做一次清理，
 *   两处都清理是安全的（幂等操作，不会引入副作用）
 *
 * @param emotionKey - 情绪键名（EMOTION_PRESETS 的 key 或用户自定义 key）
 * @param options - 可选配置
 *   - positivePromptTemplate: 正面提示词模板（含 {emotion} / {traits} / {camera} 占位符），默认使用内置模板
 *     【2026-08-06 重构】默认模板移除写死的 portrait + looking at viewer，改为 {camera} 占位符（由视角镜头下拉默认值注入）；
 *     {camera} 由下游 sdGenerationService.applyTraitsAndLora 替换（本函数仅替换 {traits} / {emotion}）
 *   - customNegativePrompt: 用户自定义负面提示词，为空时使用默认负面
 *   - customLabel: 自定义情绪的中文标签
 *   - characterTraits: 角色视觉特征 tag 数组（Spec: add-asset-and-trait-management / Task 5），用于替换 {traits} 占位符
 * @returns `{ prompt: string; negativePrompt: string }`
 */
export function buildExpressionGenerationPrompt(
  emotionKey: string,
  options?: {
    positivePromptTemplate?: string;
    customNegativePrompt?: string;
    customLabel?: string;
    customPrompts?: { positive: string; negative?: string };
    characterTraits?: Array<{ text: string; weight?: number }>;
  },
): { prompt: string; negativePrompt: string } {
  const {
    positivePromptTemplate,
    customNegativePrompt,
    customLabel,
    customPrompts,
    characterTraits,
  } = options || {};

  // 情绪提示词解析（Spec: enhance-custom-emotion-system）：
  // 优先级：customPrompts.positive > EMOTION_PROMPT_MAP[key] > customLabel 兜底 > neutral
  let emotionPositive: string;
  let emotionNegative: string | undefined;
  const mapped = EMOTION_PROMPT_MAP[emotionKey];
  if (customPrompts && customPrompts.positive) {
    emotionPositive = customPrompts.positive;
    emotionNegative = customPrompts.negative;
  } else if (mapped) {
    emotionPositive = mapped.positive;
    emotionNegative = mapped.negative;
  } else if (customLabel && customLabel.trim()) {
    emotionPositive = `${customLabel.trim()} expression, emotional face`;
  } else {
    emotionPositive = EMOTION_PROMPT_MAP.neutral.positive;
  }

  // 【重点标记 - 特征携带机制】拼接角色特征 tag 字符串
  // 过滤空字符串与纯空白串，trim 后以逗号 + 空格连接（SD tag 标准格式）
  // 【Spec: add-sdxl-prompt-weight-support / Task 3】characterTraits 升级为
  // Array<{ text: string; weight?: number }>，此处仅取 .text 拼接（权重由
  // sdGenerationService.applyTraitsAndLora 在下游格式化为 (text:weight) 语法）。
  const traitsStr = (characterTraits || [])
    .map((t) => t.text.trim())
    .filter((t) => t.length > 0)
    .join(', ');

  // 正面提示词：使用模板，将 {traits} 与 {emotion} 占位符依次替换
  // 默认模板同时含 {camera} / {traits} / {emotion} 三个占位符
  // 【2026-08-06 重构】移除写死的 `portrait` + `looking at viewer`（改为由 {camera} 下拉默认值注入），
  //   避免与用户选的 full body / close-up 等同类 tag 冲突；
  //   弹窗打开时表情模式默认初始化 selectedCameraAngle='portrait, looking at viewer'
  //   （由 AssetGenerateModal getCameraDefaultForMode 提供），用户可改选/加选 from above 等
  //   {camera} 由下游 sdGenerationService.applyTraitsAndLora 替换（本函数仅替换 {traits} / {emotion}，
  //   {camera} 保持字面量传给下游，applyTraitsAndLora 会替换并清理逗号）
  // 【2026-08-06 标签库审计】simple background → simple_background（Danbooru 标准下划线格式）
  // high quality / best quality / masterpiece / detailed face 虽不在标签库，但 NoobAI 训练时注入，模型理解
  const defaultTemplate = '{camera}, {traits}, simple_background, {emotion}, high quality, best quality, masterpiece, detailed face';
  const template = (positivePromptTemplate && positivePromptTemplate.trim()) || defaultTemplate;

  // 【重点标记 - 特征携带机制 - 占位符注入逻辑】
  // 1. 若模板含 {traits} 占位符：替换为 traitsStr（可能为空字符串）
  // 2. 若模板不含 {traits} 占位符（旧配置兼容）：traitsStr 非空时在开头追加，为空时保持原样
  let prompt: string;
  if (template.includes('{traits}')) {
    // 使用函数形式替换，避免 $ 等特殊字符干扰（与 sdGenerationService 保持一致）
    prompt = template.replace(/\{traits\}/g, () => traitsStr);
  } else if (traitsStr) {
    // 旧配置兼容：模板不含 {traits} 占位符，但传入了非空特征 → 在开头追加
    prompt = `${traitsStr}, ${template}`;
  } else {
    // 旧配置兼容：模板不含 {traits} 占位符，且特征为空 → 保持原模板
    prompt = template;
  }

  // 替换 {emotion} 占位符
  // 若模板含 {emotion}：替换为情绪提示词；否则追加到末尾（与原行为一致）
  prompt = prompt.includes('{emotion}')
    ? prompt.replace(/\{emotion\}/g, emotionPositive)
    : `${prompt}, ${emotionPositive}`;

  // 【重点标记 - 特征携带机制 - 清理多余逗号与空格】
  // 场景：模板 `{camera}, {traits}, simple background` + 空 traits → `{camera}, , simple background`
  // 循环处理连续逗号（如 `a, , , b` 需多次匹配才能完全收敛）
  // 注：{camera} 占位符是字面字符串（含花括号），不参与逗号清理，保持原样传给下游
  // 与 sdGenerationService.generateExpression 的清理逻辑保持一致（下游会再清理一次，幂等安全）
  let prevPrompt: string;
  do {
    prevPrompt = prompt;
    prompt = prompt.replace(/,\s*,/g, ',');
  } while (prompt !== prevPrompt);
  prompt = prompt.replace(/^\s*,\s*/, ''); // 清理开头逗号
  prompt = prompt.replace(/\s*,\s*$/, ''); // 清理结尾逗号

  // 负面提示词：用户自定义优先；否则使用默认 + 情绪特有负面
  // 【2026-08-06 标签库审计】多词 tag 改为下划线版本（bad_anatomy / multiple_faces / extra_digits / bad_proportions）
  // ugly / low quality / mutated_hands / missing_fingers 虽不在 Danbooru 标签库，但 SD 社区通用负面，模型理解
  const baseNegative = 'deformed, ugly, bad_anatomy, multiple_faces, text, watermark, low quality, blurry, mutated_hands, extra_digits, missing_fingers, bad_proportions';
  const userNegative = (customNegativePrompt && customNegativePrompt.trim()) || '';
  const negativePrompt = userNegative
    ? (emotionNegative ? `${userNegative}, ${emotionNegative}` : userNegative)
    : (emotionNegative ? `${baseNegative}, ${emotionNegative}` : baseNegative);

  return { prompt, negativePrompt };
}
