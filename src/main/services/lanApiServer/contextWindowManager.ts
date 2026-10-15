/**
 * 【Phase 4 / L9 - conversation-mode-optimization-report】LAN 上下文窗口管理（纯函数）
 *
 * 对齐桌面端 ConfigPanel Token 管理核心功能，语义与桌面端 ContextTruncator 一致：
 * - 开启：消息条数上限 → Token 预算截断（从最新往旧累计，超预算即截断）→ 最少保留轮数保底 → 消息成对保护
 * - 关闭：保留安全网行为（固定保留最近 60 条）
 *
 * 抽取为独立纯函数模块（原内联于 dialogue.ts），便于单元测试与 debug 机制直接验证。
 * countTokens 通过参数注入：生产环境传入 TokenCountService（cl100k_base 精确计数），
 * 测试环境可注入字节估算或 mock。
 */

/** LAN 上下文窗口管理配置（对应 LanSessionConfig 的 Token 管理五字段） */
export interface LanContextWindowConfig {
  /** Token 管理开关 */
  enabled: boolean;
  /** 最大上下文 Token 数（缺省 256000） */
  maxContextTokens: number;
  /** 响应预留 Token 数（缺省 4096） */
  reservedForResponse: number;
  /** 最少保留对话轮数（1 轮 = 2 条消息；缺省 3） */
  minMessagesToKeep: number;
  /** 最多保留消息条数（缺省 60） */
  maxMessagesToKeep: number;
}

/** 安全网：Token 管理关闭时固定保留的消息条数（对齐桌面端关闭行为） */
export const LAN_CONTEXT_SAFETY_NET_MESSAGES = 60;
/** Token 管理开启时默认保留的消息条数上限 */
export const LAN_CONTEXT_DEFAULT_MAX_MESSAGES = 60;

/**
 * 对上下文消息执行窗口管理（截断）。
 *
 * @param messages 按时间顺序的消息列表（user/assistant，已含本轮 user 消息）
 * @param config Token 管理配置（LanSessionConfig 的五字段）
 * @param countTokens 单条消息内容的 Token 计数函数（注入式，生产用 TokenCountService）
 * @returns 截断后的消息列表（前缀子集，消息成对，不以 assistant 开头）
 */
export function applyContextWindowManagement<T extends { role: 'user' | 'assistant'; content: string }>(
  messages: T[],
  config: LanContextWindowConfig,
  countTokens: (text: string) => number
): T[] {
  let result = messages;

  // ---- 关闭：安全网行为（固定保留最近 60 条）----
  if (!config.enabled) {
    if (result.length > LAN_CONTEXT_SAFETY_NET_MESSAGES) {
      result = result.slice(-LAN_CONTEXT_SAFETY_NET_MESSAGES);
      // 消息成对保护：不以 assistant 消息开头
      if (result.length > 0 && result[0].role === 'assistant') {
        result = result.slice(1);
      }
    }
    return result;
  }

  // ---- 开启：可配置 Token 管理 ----
  const maxMessagesToKeep = config.maxMessagesToKeep > 0 ? config.maxMessagesToKeep : LAN_CONTEXT_DEFAULT_MAX_MESSAGES;
  const maxContextTokens = config.maxContextTokens > 0 ? config.maxContextTokens : 256000;
  const reservedForResponse = config.reservedForResponse > 0 ? config.reservedForResponse : 4096;
  const minMessagesToKeep = Math.max(1, config.minMessagesToKeep || 3) * 2; // 轮 → 条
  const budget = Math.max(1000, maxContextTokens - reservedForResponse);

  // 1) 消息条数上限
  if (result.length > maxMessagesToKeep) {
    result = result.slice(-maxMessagesToKeep);
  }

  // 2) Token 预算截断：从最新消息向旧累计，超预算时截断（保底最少保留轮数）
  let totalTokens = 0;
  for (let i = result.length - 1; i >= 0; i--) {
    totalTokens += countTokens(result[i].content) + 4; // +4 = OpenAI 消息格式固定开销
    const keptIfCutHere = result.length - i - 1; // 若移除 i 之后的保留条数
    if (totalTokens > budget && keptIfCutHere >= minMessagesToKeep) {
      result = result.slice(i + 1);
      break;
    }
  }

  // 3) 消息成对保护：不以 assistant 消息开头（对齐桌面端 ContextTruncator 行为）
  if (result.length > 0 && result[0].role === 'assistant') {
    result = result.slice(1);
  }

  return result;
}
