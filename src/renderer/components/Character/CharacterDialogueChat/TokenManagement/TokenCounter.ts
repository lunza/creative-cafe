import { ChatMessage } from '../CharacterDialogueChat.types';
import { TokenCountResult, MessageTokenInfo } from './types';

/**
 * TokenCounter
 *
 * 双模式 Token 计数器：
 * - 异步精确路径（`estimateTokensAsync` / `precountMessages` / `precountSystemPrompt`）：
 *   通过 IPC 调用主进程 TokenCountService（gpt-tokenizer / cl100k_base，误差 ±3%）
 * - 同步降级路径（`estimateTokens` / `estimateTokensSync`）：
 *   优先返回缓存中已预计算的精确值；缓存未命中时回退字节估算（`byteLength / 3.35`，误差 ±15%）
 *
 * 缓存策略：
 * - `tokenCache`：按 messageId 索引，用于稳定 id 的对话消息（命中即不调 IPC）
 * - `textTokenCache`：按文本内容索引，用于无 id 的文本（如 system prompt）
 * - 缓存上限：textTokenCache 限制 512 条，避免 system prompt 频繁变更导致无界增长
 *
 * Spec: optimize-chat-ai-intelligence / Task 1.4
 */

const BYTES_PER_TOKEN = 3.35;
const FORMAT_OVERHEAD_PER_MESSAGE = 4;
const TOKENS_PADDING = 3;
const TEXT_CACHE_MAX = 512;

const tokenCache = new Map<string, number>(); // messageId -> tokens
const textTokenCache = new Map<string, number>(); // text -> tokens

/**
 * 取文本的字节估算 token 数（同步降级路径）。
 * 不写缓存：避免低精度值污染后续精确计数。
 */
function byteEstimate(text: string): number {
  if (!text) return 0;
  const byteLength = new TextEncoder().encode(text).length;
  return Math.ceil(byteLength / BYTES_PER_TOKEN);
}

/**
 * 安全调用 IPC token.countBatch。
 * 若 IPC 失败（preload 未注入 / 主进程未就绪），返回 null，调用方走 fallback。
 */
async function ipcCountBatch(items: Array<{ id: string; text: string }>): Promise<Array<{ id: string; count: number }> | null> {
  try {
    const api = (window as any).electronAPI;
    if (!api?.token?.countBatch) return null;
    return await api.token.countBatch(items);
  } catch (err) {
    console.warn('[TokenCounter] IPC token.countBatch failed, falling back to byte estimation:', err);
    return null;
  }
}

export class TokenCounter {
  // ============================================================
  // 同步降级路径（保留原 API 以兼容 ContextTruncator 等同步调用方）
  // ============================================================

  /**
   * 同步估算 token 数。
   * 优先返回缓存中已预计算的精确值；缓存未命中时返回字节估算（不写缓存）。
   *
   * 注意：此方法不会触发 IPC。要获取精确值，请在调用前使用
   * `await precountMessages(...)` / `await precountSystemPrompt(...)` 预热缓存。
   */
  static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;

    // 1) 文本缓存命中（来自 precountSystemPrompt / estimateTokensAsync）
    const cached = textTokenCache.get(text);
    if (cached !== undefined) return cached;

    // 2) 降级：字节估算（不写缓存，避免污染后续精确值）
    return byteEstimate(text);
  }

  /**
   * 同步估算的显式别名（spec 要求：用于不能改异步的场景）。
   */
  static estimateTokensSync(text: string): number {
    return this.estimateTokens(text);
  }

  // ============================================================
  // 异步精确路径（新增）
  // ============================================================

  /**
   * 异步精确估算 token 数。
   * 缓存命中时直接返回；未命中调用 IPC，结果同步写入 messageId 缓存与 text 缓存。
   * 失败回退字节估算。
   *
   * @param text 待计数文本
   * @param messageId 可选 messageId；提供则按 id 缓存，便于后续 countMessageTokens 命中
   */
  static async estimateTokensAsync(text: string, messageId?: string): Promise<number> {
    if (!text || text.length === 0) return 0;

    // 1) messageId 缓存命中
    if (messageId && tokenCache.has(messageId)) {
      return tokenCache.get(messageId)!;
    }
    // 2) text 缓存命中
    const cachedText = textTokenCache.get(text);
    if (cachedText !== undefined) return cachedText;

    // 3) IPC 精确计数
    const id = messageId ?? `__text_${hashText(text)}`;
    const results = await ipcCountBatch([{ id, text }]);
    let count: number;
    if (results && results.length > 0) {
      count = results[0].count;
    } else {
      // IPC 失败 -> 字节估算
      count = byteEstimate(text);
    }

    // 写双缓存（messageId 缓存仅当外部传入 messageId 时；text 缓存始终写）
    if (messageId) {
      tokenCache.set(messageId, count);
    }
    writeTextCache(text, count);
    return count;
  }

  /**
   * 单条消息异步计数。返回值包含 FORMAT_OVERHEAD_PER_MESSAGE，与同步 countMessageTokens 对齐。
   */
  static async countMessageTokensAsync(message: ChatMessage): Promise<number> {
    if (tokenCache.has(message.id)) {
      return tokenCache.get(message.id)!;
    }
    const contentTokens = await this.estimateTokensAsync(message.content || '', message.id);
    const totalTokens = contentTokens + FORMAT_OVERHEAD_PER_MESSAGE;
    tokenCache.set(message.id, totalTokens);
    return totalTokens;
  }

  /**
   * system prompt 异步计数。
   */
  static async countSystemPromptTokensAsync(systemPrompt: string): Promise<number> {
    return this.estimateTokensAsync(systemPrompt);
  }

  // ============================================================
  // 批量预热（推荐用法：在请求前一次性预热所有要计数的文本）
  // ============================================================

  /**
   * 批量预热消息 token 计数缓存。
   * 跳过已缓存的 messageId，仅对未命中的批量调一次 IPC。
   * 用于 ContextTruncator.truncateMessages 前的预热：之后同步 countMessageTokens 全部命中缓存。
   */
  static async precountMessages(messages: ChatMessage[]): Promise<void> {
    if (!messages || messages.length === 0) return;

    const pending: Array<{ id: string; text: string }> = [];
    for (const msg of messages) {
      if (tokenCache.has(msg.id)) continue;
      const content = msg.content || '';
      // text 缓存命中也可复用（避免重复 IPC）
      const cachedText = textTokenCache.get(content);
      if (cachedText !== undefined) {
        tokenCache.set(msg.id, cachedText + FORMAT_OVERHEAD_PER_MESSAGE);
      } else {
        pending.push({ id: msg.id, text: content });
      }
    }
    if (pending.length === 0) return;

    const results = await ipcCountBatch(pending);
    if (!results) {
      // IPC 失败：不写缓存，让后续同步路径走字节估算
      return;
    }

    for (const r of results) {
      const total = r.count + FORMAT_OVERHEAD_PER_MESSAGE;
      tokenCache.set(r.id, total);
      // 同步写 text 缓存（content -> contentTokens，不含 overhead）
      const original = pending.find((p) => p.id === r.id);
      if (original) writeTextCache(original.text, r.count);
    }
  }

  /**
   * 批量预热无 id 文本（如 system prompt）。
   */
  static async precountTexts(texts: string[]): Promise<void> {
    if (!texts || texts.length === 0) return;

    const pending: Array<{ id: string; text: string }> = [];
    for (const text of texts) {
      if (!text) continue;
      if (textTokenCache.has(text)) continue;
      pending.push({ id: `__text_${hashText(text)}`, text });
    }
    if (pending.length === 0) return;

    const results = await ipcCountBatch(pending);
    if (!results) return;

    for (let i = 0; i < results.length; i++) {
      writeTextCache(pending[i].text, results[i].count);
    }
  }

  /**
   * 预热单个 system prompt（常用场景的便捷封装）。
   */
  static async precountSystemPrompt(systemPrompt: string): Promise<void> {
    if (!systemPrompt) return;
    await this.precountTexts([systemPrompt]);
  }

  // ============================================================
  // 同步 API（保留原签名；缓存命中时返回精确值）
  // ============================================================

  static countMessageTokens(message: ChatMessage): number {
    const cacheKey = message.id;
    if (tokenCache.has(cacheKey)) {
      return tokenCache.get(cacheKey)!;
    }

    const contentTokens = this.estimateTokens(message.content || '');
    const totalTokens = contentTokens + FORMAT_OVERHEAD_PER_MESSAGE;

    tokenCache.set(cacheKey, totalTokens);
    return totalTokens;
  }

  static countMessagesTokens(messages: ChatMessage[]): number {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.countMessageTokens(msg);
    }
    return totalTokens + TOKENS_PADDING;
  }

  static countSystemPromptTokens(systemPrompt: string): number {
    return this.estimateTokens(systemPrompt);
  }

  static getMessageTokenDetails(messages: ChatMessage[]): MessageTokenInfo[] {
    return messages.map(msg => ({
      messageId: msg.id,
      role: msg.role,
      content: msg.content || '',
      tokenCount: this.countMessageTokens(msg),
    }));
  }

  static countTotalUsage(
    systemPrompt: string,
    messages: ChatMessage[],
    reservedForResponse: number = 1024
  ): TokenCountResult {
    const systemPromptTokens = this.countSystemPromptTokens(systemPrompt);
    const messagesTokens = this.countMessagesTokens(messages);
    return {
      totalTokens: systemPromptTokens + messagesTokens + reservedForResponse,
      systemPromptTokens,
      messagesTokens,
      reservedForResponse,
    };
  }

  // ============================================================
  // 缓存管理
  // ============================================================

  static clearCache(): void {
    tokenCache.clear();
    textTokenCache.clear();
  }

  static evictCache(messageId: string): void {
    tokenCache.delete(messageId);
  }

  /**
   * 显式按 messageId 写入缓存（用于流式生成完成后将精确 token 数注入缓存，
   * 避免下轮裁剪时再次走字节估算）。
   */
  static setCachedMessageTokens(messageId: string, count: number): void {
    tokenCache.set(messageId, count);
  }
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 简易文本哈希（FNV-1a 32-bit）。
 * 仅用于生成 text 缓存的内部 id，非密码学用途。
 */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/**
 * 写 text 缓存，带 LRU 上限保护。
 * 直接用 Map 的插入顺序作为简易 LRU：超限时删除最早条目。
 */
function writeTextCache(text: string, count: number): void {
  if (textTokenCache.size >= TEXT_CACHE_MAX) {
    // 删除最早插入的 key
    const firstKey = textTokenCache.keys().next().value;
    if (firstKey !== undefined) textTokenCache.delete(firstKey);
  }
  textTokenCache.set(text, count);
}
