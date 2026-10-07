/**
 * 共享 JSON 修复工具 — 本地 LLM 输出的 JSON 容错解析
 *
 * 背景：本地模型（abliterated）输出 JSON 时常见不干净格式：
 * 字符串值内未转义的换行/引号、尾逗号、单引号、未加引号的 key、
 * 输出被截断、夹带 markdown 标记。直接 JSON.parse 会频繁失败。
 *
 * 来源：原 OutlineGenerator.parseOutlineResponse 的 6 种修复策略，
 * 抽取为共享模块供 OutlineGenerator（大纲）与 ContentGenerator（分片大纲）复用，
 * 消除两处"保持一致"注释的漂移风险。
 */

/** 修复 AI 返回的中文弯引号（U+201C/U+201D → 直引号） */
export function fixChineseQuotes(jsonStr: string): string {
  let result = jsonStr;
  result = result.replace(/\u201c/g, '"');
  result = result.replace(/\u201d/g, '"');
  return result;
}

/** 移除 JSON 字符串值中的 Markdown 格式标记（**bold**、*italic*、~~strikethrough~~ 等） */
export function stripMarkdownFromValues(jsonStr: string): string {
  let result = jsonStr;
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');
  result = result.replace(/~~(.+?)~~/g, '$1');
  return result;
}

/**
 * 逐字符扫描修复未转义字符：
 * 1. 字符串值内未转义的换行/回车/Tab/控制字符
 * 2. 字符串值内未转义的引号（本地 LLM 失败主因）
 */
export function fixUnescapedCharacters(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < jsonStr.length) {
    const ch = jsonStr[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      i++;
      continue;
    }

    if (ch === '"') {
      if (inString) {
        // 判断是真正的闭合引号还是值内未转义的引号：
        // 后面紧跟 , } ] : 视为闭合引号，否则转义
        const nextChars = jsonStr.substring(i + 1).trimStart().substring(0, 3);
        if (nextChars.startsWith(',') || nextChars.startsWith('}') || nextChars.startsWith(']') || nextChars.startsWith(':')) {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
        i++;
        continue;
      } else {
        inString = true;
        result += ch;
        i++;
        continue;
      }
    }

    if (inString) {
      if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else if (ch === '\t') {
        result += '\\t';
      } else if (ch.charCodeAt(0) < 0x20) {
        result += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
      } else {
        result += ch;
      }
    } else {
      result += ch;
    }

    i++;
  }

  return result;
}

/** 截断尾部垃圾：跟踪括号深度找最后一个完整结构（处理响应被截断的情况） */
export function fixTrailingGarbage(jsonStr: string): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastValidEnd = -1;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') {
      depth++;
      lastValidEnd = i;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        lastValidEnd = i;
      }
    }
  }

  if (lastValidEnd >= 0 && lastValidEnd < jsonStr.length - 1) {
    return jsonStr.substring(0, lastValidEnd + 1);
  }

  return jsonStr;
}

/** 截断修复（最后手段）：移除未完成字符串 + 补齐未闭合括号 */
export function fixByErrorPosition(jsonStr: string): string {
  let fixed = jsonStr;

  // Remove trailing commas
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  // Add quotes to unquoted keys
  fixed = fixed.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

  // Replace single quotes with double quotes for string values
  fixed = fixed.replace(/:\s*'([^']*)'/g, ':"$1"');

  // Find and handle unclosed strings - truncate to BEFORE the incomplete string value
  let inString = false;
  let escape = false;
  let lastStringStart = -1;

  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      if (inString) {
        inString = false;
      } else {
        inString = true;
        lastStringStart = i;
      }
    }
  }

  // If still in a string, truncate to just before the incomplete string starts
  if (inString && lastStringStart >= 0) {
    let cutPos = lastStringStart;
    while (cutPos > 0) {
      const ch = fixed[cutPos - 1];
      if (ch === ':' || ch === ',' || ch === '{' || ch === '[') {
        break;
      }
      cutPos--;
    }
    fixed = fixed.substring(0, cutPos);

    const trimmed = fixed.trimEnd();
    if (trimmed.endsWith(':') || trimmed.endsWith(',')) {
      let endPos = trimmed.length - 1;
      while (endPos > 0 && (fixed[endPos - 1] === ' ' || fixed[endPos - 1] === '\n' || fixed[endPos - 1] === '\t')) {
        endPos--;
      }
      if (endPos > 0 && (fixed[endPos - 1] === ':' || fixed[endPos - 1] === ',')) {
        fixed = fixed.substring(0, endPos - 1);
      }
    }
  }

  // Now close any remaining open braces/brackets
  let depth = 0;
  let lastStructuralChar = -1;
  let openBrackets: ('{' | '[')[] = [];
  inString = false;
  escape = false;

  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') {
      openBrackets.push(ch);
      depth++;
      lastStructuralChar = i;
    } else if (ch === '}' || ch === ']') {
      if (openBrackets.length > 0) openBrackets.pop();
      depth--;
      if (depth === 0) {
        lastStructuralChar = i;
      }
    }
  }

  // If depth > 0, we have unclosed braces/brackets - truncate and close
  if (depth > 0 && lastStructuralChar >= 0) {
    fixed = fixed.substring(0, lastStructuralChar + 1);
    while (openBrackets.length > 0) {
      const open = openBrackets.pop()!;
      fixed += open === '{' ? '}' : ']';
      depth--;
    }
    console.log('[jsonRepair] fixByErrorPosition: closed remaining braces/brackets');
  }

  return fixed;
}

/** 常见 JSON 问题：尾逗号 / 未加引号的 key / 单引号字符串值 */
export function fixCommonJsonIssues(jsonStr: string): string {
  let fixed = jsonStr;

  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  fixed = fixed.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  fixed = fixed.replace(/:\s*'([^']*)'/g, ':"$1"');

  return fixed;
}

/** 括号配平：截断到完整结构或补齐未闭合括号 */
export function validateAndBalanceBraces(jsonStr: string): string {
  let result = jsonStr;

  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escape = false;
  let lastValidEnd = -1;
  let lastStructuralChar = -1;

  for (let i = 0; i < result.length; i++) {
    const ch = result[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      braceDepth++;
      lastStructuralChar = i;
    } else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        lastValidEnd = i;
      }
    } else if (ch === '[') {
      bracketDepth++;
      lastStructuralChar = i;
    } else if (ch === ']') {
      bracketDepth--;
      if (bracketDepth === 0 && braceDepth === 0) {
        lastValidEnd = i;
      }
    }
  }

  // If we found a valid complete structure, truncate to that point
  if (lastValidEnd > 0) {
    result = result.substring(0, lastValidEnd + 1);
  } else if (lastStructuralChar > 0) {
    // If we have unclosed structures, try to close them
    result = result.substring(0, lastStructuralChar + 1);
    const openBraces: string[] = [];

    braceDepth = 0;
    bracketDepth = 0;
    inString = false;
    escape = false;

    for (let i = 0; i < result.length; i++) {
      const ch = result[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }

      if (ch === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{') {
        braceDepth++;
        openBraces.push('{');
      } else if (ch === '}') {
        if (braceDepth > 0) {
          braceDepth--;
          openBraces.pop();
        }
      } else if (ch === '[') {
        bracketDepth++;
        openBraces.push('[');
      } else if (ch === ']') {
        if (bracketDepth > 0) {
          bracketDepth--;
          openBraces.pop();
        }
      }
    }

    // Close any remaining open braces/brackets
    while (openBraces.length > 0) {
      const open = openBraces.pop()!;
      result += open === '{' ? '}' : ']';
    }
  }

  return result;
}

/**
 * 鲁棒 JSON 解析：直接 parse → 依次尝试 6 种修复策略 → 全部失败返回 null。
 *
 * @param jsonStr 已剥离代码块/弯引号后的 JSON 文本
 * @returns 解析结果；全部策略失败返回 null
 */
export function tryParseJsonWithRepair(jsonStr: string): any | null {
  // Try direct parse first
  try {
    return JSON.parse(jsonStr);
  } catch {
    console.log('[jsonRepair] Initial parse failed, attempting fix strategies...');
  }

  // Try multiple fix strategies in order of robustness
  const fixStrategies = [
    { name: 'stripMarkdown', strategy: () => stripMarkdownFromValues(jsonStr) },
    { name: 'unescapeControl', strategy: () => fixUnescapedCharacters(jsonStr) },
    { name: 'truncateTrailing', strategy: () => fixTrailingGarbage(jsonStr) },
    { name: 'errorPositionFix', strategy: () => fixByErrorPosition(jsonStr) },
    { name: 'commonJsonFix', strategy: () => fixCommonJsonIssues(jsonStr) },
    { name: 'validateAndBalanceBraces', strategy: () => validateAndBalanceBraces(jsonStr) },
  ];

  for (const { name, strategy } of fixStrategies) {
    try {
      const fixed = strategy();
      if (!fixed || fixed.length < 50) {
        console.log(`[jsonRepair] Fix ${name} produced too short output, skipping`);
        continue;
      }
      const parsed = JSON.parse(fixed);
      console.log(`[jsonRepair] Fix ${name} succeeded, length:`, fixed.length);
      return parsed;
    } catch (fixError) {
      console.log(`[jsonRepair] Fix ${name} failed:`, fixError instanceof Error ? fixError.message : String(fixError));
    }
  }

  console.error('[jsonRepair] All JSON fix strategies failed');
  return null;
}
