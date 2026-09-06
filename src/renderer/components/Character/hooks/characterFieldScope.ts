/**
 * Spec: fix-character-card-field-scope-flash-models — 角色卡字段作用域工具
 *
 * 背景：Flash 类模型（glm5.3-flash / qwen3.8-flash 等 100B+ MoE）在角色卡编辑器
 * 字段级生成/翻译/润色时，会忽略"仅处理目标字段"的要求，返回包含所有字段的完整
 * 角色卡内容（Gemma4-31B 无此问题）。根因是提示词作用域缺失：目标文本与全量字段
 * 上下文无边界标识平铺混排，且系统提示不知道目标字段是什么。
 *
 * 本模块提供字段元数据与输出越界防御（三重防御），供 useCharacterAIOperations
 * 在结果写回表单前净化：
 *
 * 防御 1（字段段落提取）：输出匹配多字段结构（行首"描述："、"【个性】"、"# 场景"等
 *   字段标签段落）时，提取目标字段段落作为结果
 * 防御 2（越界回退判定）：无法提取目标字段段落，但输出中出现 ≥2 个其他字段标签时，
 *   判定为越界输出（overflow=true，调用方恢复原文并提示用户）
 * 防御 3（标签残留清理）：清除输出中残留的 translate_target/polish_target/context_reference 标签
 */

export const FIELD_DESCRIPTIONS: Record<string, { label: string; guide: string }> = {
  post_history_instructions: {
    label: '历史记录后指令',
    guide: '一段在对话历史后追加给AI的额外指令，用于控制AI在长对话中的行为倾向。'
  },
  system_prompt: {
    label: '系统提示',
    guide: '一段指导AI如何扮演该角色的核心指令，包含角色行为准则、对话风格和注意事项。'
  },
  first_mes: {
    label: '初始消息',
    guide: '角色首次与用户对话时的开场白，应体现角色的性格和说话方式。'
  },
  mes_example: {
    label: '示例消息',
    guide: '多轮对话示例，展示角色在不同场景下的回应方式，每轮对话之间用空行分隔。'
  },
  description: {
    label: '描述',
    guide: '角色的详细描述，包括外貌、性格、背景等，供AI理解角色特征。'
  },
  personality: {
    label: '个性',
    guide: '角色性格的简洁描述，可以用关键词或短句，如"冷静、理智、略带傲娇"。'
  },
  scenario: {
    label: '场景',
    guide: '角色所处的环境背景和情境设定，描述角色生活的世界和当前状况。'
  },
  alternate_greetings: {
    label: '替代问候',
    guide: '角色的多个备选开场白，每段之间用空行分隔，提供不同的对话起点。'
  },
  creator_notes: {
    label: '创建者笔记',
    guide: '角色创建者对该角色的额外说明或使用建议，可以是创作思路或注意事项。'
  }
};

/**
 * 输出越界防御：检测并净化 Flash 模型全字段泛化输出。
 *
 * @param raw 模型原始输出
 * @param targetFieldKey 目标字段 key（FIELD_DESCRIPTIONS 的键，如 'description'）
 * @param addLog 可选日志函数
 * @returns { content: 净化后的内容, overflow: 是否越界且无法恢复 }
 */
export function extractTargetFieldContent(
  raw: string,
  targetFieldKey: string,
  addLog?: (msg: string, level?: 'info' | 'error' | 'warn' | 'debug') => void
): { content: string; overflow: boolean } {
  // 防御 3：标签残留清理
  const text = raw
    .replace(/<\/?(translate_target|polish_target|context_reference)>/gi, '')
    .trim();

  const targetLabel = FIELD_DESCRIPTIONS[targetFieldKey]?.label;
  if (!targetLabel) {
    return { content: text, overflow: false };
  }

  // 构建每个字段的行首标签识别正则（捕获同行剩余内容）：
  // - 冒号形式："描述：xxx" / "**描述**: xxx" / "- 描述：xxx" / "【描述】：xxx"
  // - 括号形式（无冒号）："【描述】xxx"
  // - Markdown 标题形式："# 描述" / "## 描述"（标签独占一行，内容在后续行）
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelPatterns: Array<{
    label: string;
    colonRe: RegExp;
    bracketRe: RegExp;
    headingRe: RegExp;
  }> = [];
  for (const [, info] of Object.entries(FIELD_DESCRIPTIONS)) {
    labelPatterns.push({
      label: info.label,
      colonRe: new RegExp(`^\\s*(?:[-*#>\\s]|\\*\\*)*(?:【\\s*)?${escapeRe(info.label)}(?:\\s*】)?(?:\\s*\\*\\*)?\\s*[:：]\\s*(.*)$`),
      bracketRe: new RegExp(`^\\s*(?:[-*#>\\s]|\\*\\*)*【\\s*${escapeRe(info.label)}\\s*】\\s*(.*)$`),
      headingRe: new RegExp(`^\\s*#{1,6}\\s*${escapeRe(info.label)}\\s*$`)
    });
  }

  // 按行扫描，切分出各字段段落（标签后的同行剩余内容计入该段首行）
  const lines = text.split('\n');
  const segments: Array<{ label: string; content: string[] }> = [];
  for (const line of lines) {
    let matchedLabel: string | null = null;
    let remainder = '';
    for (const p of labelPatterns) {
      const colonMatch = line.match(p.colonRe);
      if (colonMatch) {
        matchedLabel = p.label;
        remainder = colonMatch[1] ?? '';
        break;
      }
      const bracketMatch = line.match(p.bracketRe);
      if (bracketMatch) {
        matchedLabel = p.label;
        remainder = bracketMatch[1] ?? '';
        break;
      }
      if (p.headingRe.test(line)) {
        matchedLabel = p.label;
        remainder = '';
        break;
      }
    }
    if (matchedLabel) {
      segments.push({ label: matchedLabel, content: remainder ? [remainder] : [] });
    } else if (segments.length > 0) {
      segments[segments.length - 1].content.push(line);
    }
  }

  if (segments.length === 0) {
    // 无字段标签结构：正常单字段输出，原样透传
    return { content: text, overflow: false };
  }

  const otherSegments = segments.filter(s => s.label !== targetLabel);
  const targetSegment = segments.find(s => s.label === targetLabel);

  if (targetSegment) {
    // 防御 1：存在目标字段段落 → 提取该段落（无论其他字段是否存在）
    const extracted = targetSegment.content.join('\n').trim();
    if (otherSegments.length > 0) {
      addLog?.(`[Character] 输出越界防御：检测到 ${otherSegments.length} 个其他字段段落，已提取目标字段【${targetLabel}】段落`, 'warn');
    }
    if (extracted) {
      return { content: extracted, overflow: false };
    }
    // 目标段落为空但存在其他字段内容 → 越界
    addLog?.(`[Character] 输出越界防御：目标字段【${targetLabel}】段落为空，判定为越界输出`, 'warn');
    return { content: text, overflow: true };
  }

  if (otherSegments.length >= 2) {
    // 防御 2：无目标字段段落，且 ≥2 个其他字段标签 → 越界
    addLog?.(`[Character] 输出越界防御：输出含 ${otherSegments.length} 个其他字段段落且无目标字段【${targetLabel}】，判定为越界`, 'warn');
    return { content: text, overflow: true };
  }

  // 仅 1 个其他字段标签（可能误报，如正文合法包含"个性："行首）且无目标标签 → 原样透传
  return { content: text, overflow: false };
}
