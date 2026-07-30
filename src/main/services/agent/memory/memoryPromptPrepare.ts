/**
 * 记忆 Prompt 准备 —— 适配 openclaw memoryPromptPrepare 理念
 *
 * 来源：spec §二 Task 8.2（memoryPromptPrepare.ts）
 *       参考 openclaw AGENTS.md "记忆是 prompt" 章节
 * 决策：适配（spec §三）。openclaw 将检索到的记忆注入 systemPrompt，
 *       本项目照搬其理念，提供格式化 + 截断 + 注入工具。
 *
 * 职责：
 *  1. formatMemoryEntries：将 MemoryEntry[] 格式化为 prompt 文本
 *  2. injectIntoPrompt：将记忆注入 systemPrompt（按位置：头部/尾部/分隔块）
 *  3. truncateByTokenBudget：按 token 预算截断（防止记忆溢出上下文窗口）
 *  4. deduplicateEntries：按 source 去重（同一来源仅保留最新/最高分）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 记忆是 prompt：返回模型下一步需要的信息，格式清晰可读
 *  - token 预算：记忆注入不应占用过多上下文窗口
 *  - 去重：同一来源的多个记忆仅保留最有价值的
 */

import type { MemoryEntry, MemoryQuery } from '../contracts';

// ==================== 类型定义 ====================

/**
 * 记忆注入位置。
 */
export type MemoryInjectionPosition =
  | 'before-system' // systemPrompt 之前（全局背景知识）
  | 'after-system' // systemPrompt 之后（动态上下文）
  | 'before-user' // 用户消息之前（最近相关记忆）
  | 'inline'; // 内联到对话中（工具结果形式）

/**
 * 记忆格式化选项。
 */
export interface MemoryFormatOptions {
  /** 注入位置（默认 'after-system'） */
  position?: MemoryInjectionPosition;
  /** 是否包含来源标识（默认 true，便于模型引用） */
  includeSource?: boolean;
  /** 是否包含时间戳（默认 false，减少噪音） */
  includeTimestamp?: boolean;
  /** 每条记忆的最大字符数（防止超长记忆，默认 500） */
  maxCharsPerEntry?: number;
  /** token 预算（粗略按 1 token ≈ 4 chars 估算，默认 2000 tokens） */
  tokenBudget?: number;
  /** 分隔块标题（默认 'Relevant Memory'） */
  sectionTitle?: string;
}

// ==================== 格式化 ====================

/**
 * 将记忆条目格式化为 prompt 文本。
 *
 * 输出格式示例：
 * ```
 * === Relevant Memory ===
 * [worldBook:entry_1] 王国首都位于大陆中央，名为艾尔兰...
 * [character:card_2] 角色性格：冷静、理性，擅长剑术...
 * [agent:mem_3] 用户偏好：喜欢悬疑剧情，讨厌冗长描写
 * ```
 *
 * @param entries 记忆条目列表
 * @param options 格式化选项
 * @returns 格式化后的 prompt 文本（空字符串表示无记忆）
 */
export function formatMemoryEntries(
  entries: MemoryEntry[],
  options: MemoryFormatOptions = {}
): string {
  if (entries.length === 0) return '';

  const {
    includeSource = true,
    includeTimestamp = false,
    maxCharsPerEntry = 500,
    tokenBudget = 2000,
    sectionTitle = 'Relevant Memory',
  } = options;

  // 去重 + 排序
  const deduped = deduplicateEntries(entries);
  const sorted = deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // 按字符预算截断（粗略 1 token ≈ 4 chars）
  const charBudget = tokenBudget * 4;
  const lines: string[] = [`=== ${sectionTitle} ===`];
  let usedChars = lines[0].length;

  for (const entry of sorted) {
    let content = entry.content;
    if (content.length > maxCharsPerEntry) {
      content = content.slice(0, maxCharsPerEntry) + '...';
    }

    let line = '';
    if (includeSource) {
      line += `[${entry.source}] `;
    }
    line += content;
    if (includeTimestamp) {
      line += ` (timestamp: ${new Date(entry.timestamp).toISOString()})`;
    }

    if (usedChars + line.length > charBudget) break;
    lines.push(line);
    usedChars += line.length + 1; // +1 for newline
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * 将记忆注入 systemPrompt。
 *
 * @param systemPrompt 原始 systemPrompt
 * @param memoryText 格式化后的记忆文本（由 formatMemoryEntries 生成）
 * @param position 注入位置
 * @returns 注入后的 systemPrompt
 */
export function injectIntoPrompt(
  systemPrompt: string,
  memoryText: string,
  position: MemoryInjectionPosition = 'after-system'
): string {
  if (!memoryText) return systemPrompt;

  switch (position) {
    case 'before-system':
      return `${memoryText}\n\n${systemPrompt}`;
    case 'after-system':
      return `${systemPrompt}\n\n${memoryText}`;
    case 'before-user':
      // before-user 位置由调用方在构建 messages 时处理
      // 此处回退到 after-system
      return `${systemPrompt}\n\n${memoryText}`;
    case 'inline':
      // inline 位置由调用方作为独立消息插入
      // 此处回退到 after-system
      return `${systemPrompt}\n\n${memoryText}`;
    default:
      return systemPrompt;
  }
}

// ==================== 去重 ====================

/**
 * 按 source 去重。
 *
 * 同一来源的多个记忆仅保留最高分（或最新）的。
 */
export function deduplicateEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const bySource = new Map<string, MemoryEntry>();
  for (const entry of entries) {
    const existing = bySource.get(entry.source);
    if (!existing) {
      bySource.set(entry.source, entry);
      continue;
    }
    // 保留 score 更高的（score 相同时保留 timestamp 更新的）
    const entryScore = entry.score ?? 0;
    const existingScore = existing.score ?? 0;
    if (entryScore > existingScore ||
        (entryScore === existingScore && entry.timestamp > existing.timestamp)) {
      bySource.set(entry.source, entry);
    }
  }
  return Array.from(bySource.values());
}

// ==================== 完整流程 ====================

/**
 * 准备记忆并注入 systemPrompt（完整流程）。
 *
 * 1. 通过 memoryProvider 检索记忆
 * 2. 格式化为 prompt 文本
 * 3. 注入 systemPrompt
 *
 * @param systemPrompt 原始 systemPrompt
 * @param memoryProvider 记忆提供方
 * @param query 检索查询
 * @param options 格式化选项
 * @returns 注入记忆后的 systemPrompt
 */
export async function prepareMemoryPrompt(
  systemPrompt: string,
  memoryProvider: { search(query: MemoryQuery): Promise<MemoryEntry[]> },
  query: MemoryQuery,
  options: MemoryFormatOptions = {}
): Promise<string> {
  try {
    const entries = await memoryProvider.search(query);
    const memoryText = formatMemoryEntries(entries, options);
    return injectIntoPrompt(systemPrompt, memoryText, options.position);
  } catch (err) {
    // 记忆检索失败不应中断 agent 运行（降级：返回原始 prompt）
    console.warn('[memoryPromptPrepare] Memory search failed, using original prompt:', err);
    return systemPrompt;
  }
}
