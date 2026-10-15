/**
 * 【Phase 3 / L2 - conversation-mode-optimization-report】时间格式化工具（R3）。
 *
 * 原两处独立实现合并：
 * - formatTimestamp（HH:mm）原位于 CharacterDialogueChat.utils.ts
 * - formatFullTimestamp（YYYY-MM-DD HH:mm）原位于 V2VersionHistoryModal.tsx 本地函数
 */

/** HH:mm 时间格式（消息气泡时间戳等场景） */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** YYYY-MM-DD HH:mm 完整时间格式（版本历史等场景） */
export function formatFullTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
