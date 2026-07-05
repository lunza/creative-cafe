/**
 * TokenManagement 常量
 *
 * Spec: optimize-chat-ai-intelligence / Task 2
 *
 * ⚠️ 校准说明（基于 Task 1 实测）：
 *   cl100k_base 对中文约 1.3-1.4 token/字（远高于 spec 早期假设的 0.5-0.7）。
 *   接入精确计数后，相同文本的 token 数比字节估算上升约 35-50%。
 *   因此 maxContextTokens 默认值（256000，按百万Token量级模型窗口设定）仍合理，
 *   但 budget 内部分配需基于真实 token 数校准：
 *     - stopSequenceReserve=512：约容纳 6-8 个用户名变体停止串，足够。
 *     - reservedForResponse=4096：约 3000 中文字，足够一轮详细回复（仍由 hooks 默认值控制）。
 *     - roleAnchor 预留：Task 4 实现具体内容，当前默认 0（接口已预留）。
 */

/**
 * AI 响应 max_tokens 的统一默认值。
 *
 * Task 2.4：修复双重默认值不一致。
 * - 原 hooks.ts fallback = 8192
 * - 原 ChatEngine.ts fallback = 10240（不一致）
 * 统一为 8192。所有 max_tokens fallback 均引用此常量。
 */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * Stop sequences 预留 token 预算。
 *
 * Spec Requirement: Budget 双向预留上下文裁剪 — 必填项中为 stop sequences 预留约 512 tokens。
 * 该预算从 maxContextTokens 中先行 reserve，确保即便对话历史很长，
 * Task 3 注入的 stop sequences 也不会因预算耗尽而被挤掉。
 */
export const STOP_SEQUENCE_RESERVE = 512;

/**
 * 角色深度锚定（depth_prompt）预留 token 预算的默认估算值。
 *
 * Task 4 将实现 buildRoleAnchorMessage，内容格式为：
 *   `[角色锚定] {{char}} 的核心设定：{{personality 前 200 字}}。始终以 {{char}} 视角回复，禁止替 {{user}} 发言。`
 * 200 中文字 ≈ 260-280 tokens + 固定文案 ≈ 350 tokens。
 * 当前 Task 2 默认 0（接口已预留），由 Task 4 / 调用方通过 requiredItems 注入真实值。
 */
export const DEFAULT_ROLE_ANCHOR_RESERVE = 0;

/**
 * 示例消息（mes_example）预留 token 预算的默认值。
 *
 * 当前架构中 mes_example 已被 buildCharacterContext 拼入 system prompt
 * （即计入 systemPromptTokens），故此处默认 0，避免重复 reserve。
 * 若未来将 mes_example 独立为单独消息注入，由调用方通过 requiredItems 传入真实值。
 */
export const DEFAULT_EXAMPLE_MESSAGES_RESERVE = 0;

/**
 * OpenAI Chat API 消息数组的固定填充 token 数。
 *
 * 与 TokenCounter 内部 TOKENS_PADDING 对齐：countMessagesTokens 在所有消息 token 之和
 * 基础上额外加 3 tokens（数组结构开销）。ContextTruncator 在 budget 中一次性 reserve
 * 该值，避免按消息逐条 reserve 时漏算。
 */
export const ARRAY_PADDING_TOKENS = 3;

/**
 * 历史预算过低警告阈值。
 *
 * 必填项 reserve 完成后，若剩余可用预算 < 此阈值，输出 warn 日志，
 * 提示用户增大 maxContextTokens 或减小 reservedForResponse。
 */
export const LOW_HISTORY_BUDGET_WARNING_THRESHOLD = 2000;
