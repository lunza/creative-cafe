/**
 * 表情预置提示词映射表（由 scripts/optimize-expression-prompts.ts 生成，请勿手动修改）
 * 最后更新：2026-08-06
 * Spec: optimize-expression-preset-prompts
 *
 * 4 维度结构：面部表情 / 人物动作 / 符号元素 / 简单背景
 * 所有 tag 已通过 L0-L3b 审计链验证（Danbooru/e621 标签库）
 * L4 KNN / L5 AI 兜底未在脚本中实现（保留人工审核入口）
 *
 * 替换方法：将本文件中的 EMOTION_PROMPT_MAP 整体复制粘贴到
 * src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts
 * 中原 EMOTION_PROMPT_MAP 的位置（约 1480-1512 行）。
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
