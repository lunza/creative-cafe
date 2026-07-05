import { ChatMessage } from '../CharacterDialogueChat.types';
import { TokenCounter } from './TokenCounter';
import { TruncationConfig, RequiredBudgetItem } from './types';
import {
  STOP_SEQUENCE_RESERVE,
  DEFAULT_ROLE_ANCHOR_RESERVE,
  DEFAULT_EXAMPLE_MESSAGES_RESERVE,
  ARRAY_PADDING_TOKENS,
  LOW_HISTORY_BUDGET_WARNING_THRESHOLD,
} from './constants';

/**
 * 角色深度锚定（depth_prompt）的注入深度。
 *
 * Spec: optimize-chat-ai-intelligence / Task 4.2
 * 借鉴 SillyTavern `data.extensions.depth_prompt` 默认 depth=4。
 * 含义：从裁剪后消息列表末尾往前数第 4 条之前插入锚定 system 消息
 * （即插入后该 system 消息位于倒数第 4 位），让 AI 在生成最近 3 条上下文前
 * 刚好"看到"角色核心设定，防止长对话性格漂移。
 */
const ROLE_ANCHOR_DEPTH = 4;

/**
 * 角色深度锚定注入的 token 阈值因子。
 *
 * Spec Scenario: 长对话角色一致性 / 短对话不锚定
 * 当裁剪后对话历史 token > `maxContextTokens * ROLE_ANCHOR_THRESHOLD_FACTOR` 时注入。
 */
const ROLE_ANCHOR_THRESHOLD_FACTOR = 0.5;

/**
 * TokenBudget —— token 预算管理器
 *
 * Spec: optimize-chat-ai-intelligence / Task 2.1
 *
 * 基于 token budget 的双向预留裁剪算法核心：
 * - 必填项（system prompt / roleAnchor / stopSequenceReserve / exampleMessages / responseReserve）
 *   按顺序 `reserve`，从总预算中扣除；
 * - 可选项（对话历史）通过 `canAfford` 检查后倒序填充，超限即 break；
 * - 必填项即使超出剩余预算也会被"强制"扣除（remaining 钳制到 0，返回 false 以便调用方告警），
 *   从而保证必填项一定注入（spec Requirement: Budget 双向预留上下文裁剪 / 必填项优先注入）。
 *
 * `reserve` 返回值语义：true 表示该项在剩余预算内；false 表示该项导致预算超限（已强制扣除）。
 */
export class TokenBudget {
  private _total: number;
  private _remaining: number;
  private _reservations: Map<string, number> = new Map();

  constructor(total: number) {
    this._total = Math.max(0, Math.floor(total));
    this._remaining = this._total;
  }

  /**
   * 预留 token 预算。
   *
   * @returns true 表示该项在剩余预算内；false 表示超限（已强制扣除并钳制 remaining 到 0）。
   *          无论返回值，预留的 token 都会被计入 reserved（用于后续 free 或审计）。
   */
  reserve(key: string, tokens: number): boolean {
    const t = Math.max(0, Math.floor(tokens));
    const fit = t <= this._remaining;
    this._reservations.set(key, (this._reservations.get(key) ?? 0) + t);
    this._remaining = Math.max(0, this._remaining - t);
    return fit;
  }

  /**
   * 释放某个 key 对应的预留预算（回补到 remaining）。
   */
  free(key: string): void {
    const t = this._reservations.get(key);
    if (t === undefined) return;
    this._remaining = Math.min(this._total, this._remaining + t);
    this._reservations.delete(key);
  }

  /**
   * 检查剩余预算是否还能容纳指定 token 数（不扣除）。
   */
  canAfford(tokens: number): boolean {
    const t = Math.max(0, Math.floor(tokens));
    return this._remaining >= t;
  }

  /** 剩余预算 */
  get remaining(): number {
    return this._remaining;
  }

  /** 已预留预算 */
  get reserved(): number {
    let sum = 0;
    for (const v of this._reservations.values()) sum += v;
    return sum;
  }

  /** 总预算 */
  get total(): number {
    return this._total;
  }
}

/**
 * ContextTruncator —— 基于预算的上下文裁剪器
 *
 * Spec: optimize-chat-ai-intelligence / Task 2.2 / 2.3 / 4.2
 *
 * 算法（替代原"末尾累加 + minMessagesToKeep 回退"）：
 *  1. 创建 TokenBudget(maxContextTokens)
 *  2. 必填项按顺序 reserve：[systemPrompt, roleAnchor, stopSequenceReserve(512),
 *     exampleMessages, responseReserve]；超限项强制扣除并告警（必填项一定注入）
 *  3. 数组填充开销（ARRAY_PADDING_TOKENS=3）一次性 reserve
 *  4. 软下限（SubTask 2.3）：若最近 minMessagesToKeep*2 条消息整体 canAfford，
 *     则先 reserve 它们（保证短对话/常规对话至少保留最近 N 轮）；预算不允许时不强制
 *  5. 剩余预算倒序填充更早的对话历史，每条 canAfford 检查通过则入栈，超限即 break
 *  6. 至少保留最近 1 条消息（避免空上下文）
 *
 * 角色深度锚定（Task 4.2）二阶段裁剪：
 *  阶段 1：按调用方 requiredItems（或默认，roleAnchor=0）裁剪，得到 firstPass
 *  阶段 2：若传入 roleAnchorMessage 且 firstPass 历史 token > maxContextTokens*0.5：
 *    - 估算 roleAnchorMessage 的真实 token 数，注入 requiredItems 的 roleAnchor 项
 *    - 重新裁剪（含 roleAnchor 预算）
 *    - 在裁剪后消息列表 depth=4 位置插入 roleAnchor system 消息
 *  否则直接返回 firstPass（短对话不锚定，spec Scenario: 短对话不锚定）
 *
 * minMessagesToKeep 语义变更（spec REMOVED Requirement）：
 *   原"预算耗尽时强制回退到最近 N*2 条"会挤占必填项预算，已移除。
 *   现改为软下限：仅在预算允许时尽量保留至少 N 轮最近消息，不强制。
 */
export class ContextTruncator {
  /**
   * 裁剪对话历史消息。
   *
   * @param messages 原始对话历史（按时间顺序，已剔除 system 消息）
   * @param systemPromptTokens 系统提示词 token 数（由 TokenCounter.countSystemPromptTokens 计算）
   * @param config 裁剪配置
   * @param requiredItems 可选：必填预算项。若不传，内部按 spec 顺序构造默认必填项
   *                      （roleAnchor / exampleMessages 默认 0，Task 4 注入真实值）。
   * @param roleAnchorMessage 可选：角色深度锚定 system 消息（Task 4.2）。
   *                          传入时启用二阶段裁剪：若 firstPass 历史 token > maxContextTokens*0.5，
   *                          重新裁剪（含 roleAnchor 真实 token 预留）并在 depth=4 位置插入该消息。
   *                          不传时行为与 Task 2 完全一致（向后兼容）。
   * @returns 裁剪后的消息列表（user/assistant 成对，开头非 assistant；可能含 roleAnchor system 消息）
   */
  static truncateMessages(
    messages: ChatMessage[],
    systemPromptTokens: number,
    config: TruncationConfig,
    requiredItems?: RequiredBudgetItem[],
    roleAnchorMessage?: { role: 'system'; content: string }
  ): ChatMessage[] {
    if (!messages || messages.length === 0) {
      return [];
    }

    // ---------- 1. 构造必填项（按 spec reserve 顺序） ----------
    const items: RequiredBudgetItem[] = requiredItems ?? this.buildDefaultRequiredItems(systemPromptTokens, config);

    // ---------- 2. 阶段 1：按调用方 requiredItems（或默认 roleAnchor=0）裁剪 ----------
    const firstPass = this.truncateCore(messages, config, items);

    // ---------- 3. 阶段 2：判断是否需要注入 roleAnchor ----------
    if (!roleAnchorMessage) {
      return firstPass;
    }

    const truncatedHistoryTokens = TokenCounter.countMessagesTokens(firstPass);
    const shouldInject = truncatedHistoryTokens > config.maxContextTokens * ROLE_ANCHOR_THRESHOLD_FACTOR;

    if (!shouldInject) {
      // spec Scenario: 短对话不锚定 — 裁剪后历史 token ≤ 50% 阈值，避免短对话冗余
      return firstPass;
    }

    // ---------- 4. 重新构造 requiredItems，注入 roleAnchor 真实 token ----------
    const roleAnchorTokens = TokenCounter.countSystemPromptTokens(roleAnchorMessage.content);
    const itemsWithAnchor = this.withRoleAnchorTokens(items, roleAnchorTokens);

    // ---------- 5. 重新裁剪（含 roleAnchor 预算） ----------
    const secondPass = this.truncateCore(messages, config, itemsWithAnchor);

    // ---------- 6. 在 depth=4 位置插入 roleAnchor system 消息 ----------
    return this.insertRoleAnchorMessage(secondPass, roleAnchorMessage);
  }

  /**
   * 核心裁剪逻辑（私有）：基于 budget 的双向预留裁剪。
   *
   * 必填项 reserve + 数组填充 + 软下限 + 倒序填充 + ensureMessagePairs。
   * 不处理 roleAnchor 注入（由 truncateMessages 上层负责）。
   */
  private static truncateCore(
    messages: ChatMessage[],
    config: TruncationConfig,
    items: RequiredBudgetItem[]
  ): ChatMessage[] {
    if (!messages || messages.length === 0) {
      return [];
    }

    // ---------- 1. 创建 budget 并 reserve 必填项 ----------
    const budget = new TokenBudget(config.maxContextTokens);
    for (const item of items) {
      const fit = budget.reserve(item.key, item.tokens);
      if (!fit) {
        console.warn(
          `[ContextTruncator] ⚠️ 必填项 "${item.key}" 超出剩余预算：` +
          `需 ${item.tokens} tokens，剩余 ${budget.remaining} tokens（已强制扣除）。` +
          `建议：增大 maxContextTokens（当前 ${config.maxContextTokens}）或精简该项内容。`
        );
      }
    }

    // ---------- 2. 数组填充开销 ----------
    budget.reserve('__arrayPadding__', ARRAY_PADDING_TOKENS);

    // 历史预算过低告警
    if (budget.remaining < LOW_HISTORY_BUDGET_WARNING_THRESHOLD) {
      console.warn(
        `[ContextTruncator] ⚠️ 对话历史预算过低：剩余 ${budget.remaining} tokens ` +
        `（总 ${budget.total}，必填项已预留 ${budget.reserved - ARRAY_PADDING_TOKENS}）。` +
        `建议：maxContextTokens >= 256000，reservedForResponse >= 4096。`
      );
    }

    // ---------- 3. 预计算每条消息 token 数（命中 Task 1 预热缓存，走精确路径） ----------
    const msgTokens = messages.map(m => TokenCounter.countMessageTokens(m));

    // ---------- 4. 软下限：尽量保留最近 minMessagesToKeep*2 条 ----------
    const minRecentCount = Math.max(0, config.minMessagesToKeep * 2);
    const recentStartIdx = Math.max(0, messages.length - minRecentCount);
    let recentTokensSum = 0;
    for (let i = recentStartIdx; i < messages.length; i++) {
      recentTokensSum += msgTokens[i];
    }

    const softGuaranteeHeld = minRecentCount > 0 && budget.canAfford(recentTokensSum);
    let result: ChatMessage[] = [];
    if (softGuaranteeHeld) {
      budget.reserve('__softRecent__', recentTokensSum);
      result = messages.slice(recentStartIdx);
    }

    // ---------- 5. 倒序填充更早的历史（或软下限未成立时从最新向前全量填充） ----------
    const startIdx = softGuaranteeHeld ? recentStartIdx - 1 : messages.length - 1;
    for (let i = startIdx; i >= 0; i--) {
      if (result.length >= config.maxMessagesToKeep) {
        break;
      }
      const t = msgTokens[i];
      if (!budget.canAfford(t)) {
        // 至少保留最近 1 条消息（避免空上下文）；仅在尚未保留任何消息时强制
        if (result.length === 0) {
          budget.reserve(`__history_${i}__`, t);
          result.unshift(messages[i]);
        }
        break;
      }
      budget.reserve(`__history_${i}__`, t);
      result.unshift(messages[i]);
    }

    return this.ensureMessagePairs(result);
  }

  /**
   * 构造默认必填预算项（向后兼容：调用方未传 requiredItems 时使用）。
   *
   * reserve 顺序严格按 spec：[systemPrompt, roleAnchor, stopSequenceReserve, exampleMessages, responseReserve]
   * - roleAnchor 默认 0（Task 4 通过 requiredItems 注入真实值）
   * - exampleMessages 默认 0（mes_example 当前已拼入 systemPrompt，避免重复 reserve）
   */
  private static buildDefaultRequiredItems(
    systemPromptTokens: number,
    config: TruncationConfig
  ): RequiredBudgetItem[] {
    return [
      { key: 'systemPrompt', tokens: Math.max(0, systemPromptTokens) },
      { key: 'roleAnchor', tokens: DEFAULT_ROLE_ANCHOR_RESERVE },
      { key: 'stopSequenceReserve', tokens: STOP_SEQUENCE_RESERVE },
      { key: 'exampleMessages', tokens: DEFAULT_EXAMPLE_MESSAGES_RESERVE },
      { key: 'responseReserve', tokens: Math.max(0, config.reservedForResponse) },
    ];
  }

  /**
   * 在 requiredItems 中注入 roleAnchor 真实 token 数（Task 4.2）。
   *
   * - 若 items 已包含 `roleAnchor` key：替换其 tokens
   * - 否则：在 `stopSequenceReserve` 之前插入新项（保持 spec reserve 顺序）
   * - 兜底：找不到 `stopSequenceReserve` 时 push 到末尾
   *
   * 不修改原数组，返回新数组。
   */
  private static withRoleAnchorTokens(items: RequiredBudgetItem[], tokens: number): RequiredBudgetItem[] {
    const idx = items.findIndex(item => item.key === 'roleAnchor');
    if (idx >= 0) {
      const newItems = [...items];
      newItems[idx] = { ...newItems[idx], tokens };
      return newItems;
    }
    const stopIdx = items.findIndex(item => item.key === 'stopSequenceReserve');
    if (stopIdx >= 0) {
      const newItems = [...items];
      newItems.splice(stopIdx, 0, { key: 'roleAnchor', tokens });
      return newItems;
    }
    return [...items, { key: 'roleAnchor', tokens }];
  }

  /**
   * 在裁剪后消息列表的 depth=4 位置插入角色深度锚定 system 消息（Task 4.2）。
   *
   * depth=4 含义（spec + SillyTavern 标准）：插入后该 system 消息位于列表的倒数第 4 位
   * （即 roleAnchor 之后还有 3 条对话消息，AI 在生成最近 3 条上下文前刚好"看到"锚定）。
   *
   * 推导：若 roleAnchor 索引 = result.length - 4，则其后有 3 条消息。
   * 在原 messages（长度 N）中插入位置 insertIndex 满足：insertIndex = N - 3（即 messages.length - (depth - 1)）。
   *
   * 边界处理（spec 约束："消息少于 4 条时插在末尾"）：
   * - messages.length >= 4：insertIndex = messages.length - 3（roleAnchor 位于倒数第 4 位）
   * - messages.length < 4：insertIndex = messages.length（插在末尾，无法满足"倒数第 4 位"）
   *
   * @param messages 裁剪后消息列表（不含 roleAnchor）
   * @param roleAnchorMessage 锚定消息内容（role: 'system', content: string）
   * @returns 含 roleAnchor 的新消息列表
   */
  private static insertRoleAnchorMessage(
    messages: ChatMessage[],
    roleAnchorMessage: { role: 'system'; content: string }
  ): ChatMessage[] {
    // depth=4：roleAnchor 之后应有 3 条消息（即 roleAnchor 位于倒数第 4 位）
    // 边界：消息少于 4 条时插在末尾
    const insertIndex = messages.length >= ROLE_ANCHOR_DEPTH
      ? messages.length - (ROLE_ANCHOR_DEPTH - 1)
      : messages.length;
    const anchorMessage: ChatMessage = {
      id: `role-anchor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'system',
      content: roleAnchorMessage.content,
      timestamp: Date.now(),
    };
    return [...messages.slice(0, insertIndex), anchorMessage, ...messages.slice(insertIndex)];
  }

  /**
   * 保证消息以 user 开头且 user/assistant 成对（保留原实现，增强极端紧凑预算兜底）。
   *
   * 截断可能从中间切断一组对话，导致开头是 assistant 消息或角色错位，
   * 此方法丢弃开头无法成对的 assistant 消息，避免模型混淆轮次。
   *
   * Task 2.3 增强：若丢弃开头 assistant 后结果为空（极端紧凑预算下仅能装下 1 条
   * assistant 消息），保留最后一条消息避免完全无上下文（部分 API 要求 messages 非空）。
   *
   * Task 4.2 注意：roleAnchor system 消息由 truncateMessages 上层在 ensureMessagePairs
   * 之后插入，因此 ensureMessagePairs 不需要识别 system 消息（保持原行为）。
   */
  static ensureMessagePairs(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return messages;

    let startIndex = 0;
    if (messages[0].role === 'assistant') {
      startIndex = 1;
    }

    const pairs: ChatMessage[] = [];
    for (let i = startIndex; i < messages.length; i += 2) {
      if (i + 1 < messages.length) {
        if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
          pairs.push(messages[i], messages[i + 1]);
        } else {
          pairs.push(messages[i]);
        }
      } else {
        pairs.push(messages[i]);
      }
    }

    // 兜底：丢弃开头 assistant 后若结果为空，保留最后一条消息避免完全无上下文
    if (pairs.length === 0 && messages.length > 0) {
      return [messages[messages.length - 1]];
    }

    return pairs;
  }

  static analyzeTruncation(
    originalMessages: ChatMessage[],
    truncatedMessages: ChatMessage[],
    _systemPromptTokens: number,
    _config: TruncationConfig
  ): {
    originalCount: number;
    truncatedCount: number;
    removedCount: number;
    originalTokens: number;
    truncatedTokens: number;
    wasTruncated: boolean;
  } {
    const originalTokens = TokenCounter.countMessagesTokens(originalMessages);
    const truncatedTokens = TokenCounter.countMessagesTokens(truncatedMessages);

    return {
      originalCount: originalMessages.length,
      truncatedCount: truncatedMessages.length,
      removedCount: originalMessages.length - truncatedMessages.length,
      originalTokens,
      truncatedTokens,
      wasTruncated: truncatedMessages.length < originalMessages.length,
    };
  }
}
