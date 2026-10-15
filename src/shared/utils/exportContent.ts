/**
 * 【Phase 3 / L2 - conversation-mode-optimization-report】对话导出构建器（R3）。
 *
 * 纯函数模块（主进程+单测可共用）：支持 TXT / Markdown / HTML 三种格式。
 * 从 CharacterDialogueChat/exportContent.ts 迁入，消息类型改为结构化的
 * DialogueMessageLike（不依赖渲染进程类型），ChatMessage 等具体消息类型
 * 只要含 role/content/timestamp 字段即可直接传入。
 */

import { formatTimestamp } from './timeFormat';

export interface DialogueMessageLike {
  role: string;
  content: string;
  timestamp: number;
}

export type DialogueExportFormat = 'txt' | 'markdown' | 'html';

export const EXPORT_FORMAT_EXTENSIONS: Record<DialogueExportFormat, string> = {
  txt: 'txt',
  markdown: 'md',
  html: 'html',
};

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMarkdown(messages: DialogueMessageLike[], characterName: string): string {
  let output = `# 与 ${characterName} 的对话\n\n`;
  output += `导出时间：${new Date().toLocaleString()}\n\n`;
  output += `---\n\n`;
  messages.forEach((msg) => {
    const role = msg.role === 'user' ? '我' : characterName;
    output += `### ${role}（${formatTimestamp(msg.timestamp)}）\n\n`;
    output += `${msg.content}\n\n`;
    output += `---\n\n`;
  });
  return output;
}

function buildTxt(messages: DialogueMessageLike[], characterName: string): string {
  const lines: string[] = [`与 ${characterName} 的对话`, `导出时间：${new Date().toLocaleString()}`, '═'.repeat(40), ''];
  messages.forEach((msg) => {
    const role = msg.role === 'user' ? '我' : characterName;
    lines.push(`【${role} ${formatTimestamp(msg.timestamp)}】`);
    lines.push(msg.content);
    lines.push('─'.repeat(40));
    lines.push('');
  });
  return lines.join('\n');
}

function buildHtml(messages: DialogueMessageLike[], characterName: string): string {
  const body = messages
    .map((msg) => {
      const isUser = msg.role === 'user';
      const role = isUser ? '我' : characterName;
      return `      <div class="msg ${isUser ? 'user' : 'ai'}">
        <div class="meta">${escapeHtml(role)} · ${formatTimestamp(msg.timestamp)}</div>
        <div class="content">${escapeHtml(msg.content).replace(/\n/g, '<br/>')}</div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>与 ${escapeHtml(characterName)} 的对话</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; color: #1f2937; background: #f9fafb; }
  h1 { font-size: 20px; }
  .export-time { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .msg { margin-bottom: 16px; padding: 10px 14px; border-radius: 10px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .msg.user { background: #eff6ff; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
  .content { white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
</style>
</head>
<body>
  <h1>与 ${escapeHtml(characterName)} 的对话</h1>
  <div class="export-time">导出时间：${new Date().toLocaleString()}</div>
${body}
</body>
</html>`;
}

/** 构建指定格式的导出内容（消息子集导出，N3：消息多选） */
export function buildExportContent(
  messages: DialogueMessageLike[],
  characterName: string,
  format: DialogueExportFormat
): string {
  if (messages.length === 0) return '';
  switch (format) {
    case 'txt':
      return buildTxt(messages, characterName);
    case 'html':
      return buildHtml(messages, characterName);
    case 'markdown':
    default:
      return buildMarkdown(messages, characterName);
  }
}
