/**
 * 用户自定义提示词统一注入助手
 *
 * Spec: add-ai-custom-prompt-and-interrupt
 *
 * 约定（全局，见 .learnings/LEARNINGS.md）：
 * 所有审核/润色/生成类 AI 功能均支持用户自定义提示词。
 * 注入位置：system prompt 最末尾（引擎全局提示词、功能 system 正文、
 * humanizer 规则块之后），语义为"最高优先级，可覆盖默认规则"。
 *
 * 空值（undefined/''/纯空白）时原样返回，保证既有行为逐字节不变。
 */
export function withCustomPrompt(systemPrompt: string, customPrompt?: string): string {
  const trimmed = (customPrompt || '').trim();
  if (!trimmed) return systemPrompt;
  return (
    systemPrompt.trimEnd() +
    '\n\n## 用户自定义要求（最高优先级，与上述默认要求冲突时以本节约束为准）\n' +
    trimmed
  );
}
