/**
 * 语义化色彩 token —— 适配 openclaw 主题系统
 *
 * 来源：参考 openclaw 色彩设计系统
 * 决策：基于现有 ui-variables.css CSS 变量体系，新增工具调用状态色彩 token
 *
 * 职责：
 *  1. 定义语义化色彩 token 常量（JS 侧引用 CSS 变量）
 *  2. 提供工具调用三态色彩（pending/success/error）
 *  3. 提供通用语义色彩（text/dim/accent/border/quote/code/link）
 *
 * 使用方式：
 *  在内联样式中使用 `color: themeTokens.text` 替代 `color: '#e2e8f0'`
 *  themeTokens.text 的值为 `'var(--text-primary)'`，会自动跟随主题切换
 */

/**
 * 语义化色彩 token 映射表。
 *
 * 每个值为 CSS 变量引用，主题切换时自动生效。
 */
export const themeTokens = {
  // ==================== 通用语义色彩 ====================

  /** 主文字色 */
  text: 'var(--text-primary)',
  /** 次要文字色（dimmed） */
  dim: 'var(--text-secondary)',
  /** 强调色 */
  accent: 'var(--color-primary)',
  /** 边框色 */
  border: 'var(--border-base)',
  /** 用户消息背景 */
  userBg: 'var(--chat-bubble-user-bg)',
  /** 引用块 */
  quote: 'var(--chat-bubble-assistant-bg)',
  /** 代码块 */
  code: 'var(--bg-code)',
  /** 链接色 */
  link: 'var(--text-link)',
  /** 错误色 */
  error: 'var(--color-error)',
  /** 成功色 */
  success: 'var(--color-success)',

  // ==================== 工具调用状态色彩 ====================

  /** 工具调用 - 等待中 背景 */
  toolPendingBg: 'var(--tool-pending-bg)',
  /** 工具调用 - 等待中 文字 */
  toolPendingText: 'var(--tool-pending-text)',
  /** 工具调用 - 等待中 边框 */
  toolPendingBorder: 'var(--tool-pending-border)',

  /** 工具调用 - 成功 背景 */
  toolSuccessBg: 'var(--tool-success-bg)',
  /** 工具调用 - 成功 文字 */
  toolSuccessText: 'var(--tool-success-text)',
  /** 工具调用 - 成功 边框 */
  toolSuccessBorder: 'var(--tool-success-border)',

  /** 工具调用 - 错误 背景 */
  toolErrorBg: 'var(--tool-error-bg)',
  /** 工具调用 - 错误 文字 */
  toolErrorText: 'var(--tool-error-text)',
  /** 工具调用 - 错误 边框 */
  toolErrorBorder: 'var(--tool-error-border)',

  /** 工具调用 - 标题 */
  toolTitle: 'var(--tool-title)',
  /** 工具调用 - 输出内容 */
  toolOutput: 'var(--tool-output)',
} as const;

/**
 * 主题模式类型。
 */
export type ThemeMode = 'light' | 'dark' | 'auto';

/**
 * 获取实际生效的主题（将 auto 解析为 light 或 dark）。
 *
 * @param mode 主题模式
 * @param systemDark 系统是否为暗色（auto 模式下使用）
 * @returns 'light' 或 'dark'
 */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  if (mode === 'auto') {
    return systemDark ? 'dark' : 'light';
  }
  return mode;
}
