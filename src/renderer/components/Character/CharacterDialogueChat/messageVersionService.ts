/**
 * 【Phase 3 / L3 - conversation-mode-optimization-report】消息版本恢复统一服务（R4）。
 *
 * CharacterDialogueChat.hooks.ts 中 retryMessage / rollbackToMessage /
 * retryMessageFromVersion 三个回调共享的版本恢复逻辑收敛于此（纯函数，可单测）：
 * - 流式守卫（同一文案的重复判断）
 * - 消息截断 / 版本消息归一化 / 待重生成空消息构建
 * - 表格快照跟随恢复（versionLinkId 直配 + 时间戳 ±1000ms 联动匹配两种模式合一）
 */
import { message } from 'antd';
import type { ChatMessage } from './CharacterDialogueChat.types';

/** 流式守卫：生成中则提示并返回 true（调用方应直接 return） */
export function guardStreaming(isStreaming: boolean): boolean {
  if (isStreaming) {
    message.warning('请等待当前回复完成');
    return true;
  }
  return false;
}

/** 截取最后一条 assistant 消息之前的消息（retryMessageFromVersion 的截断语义） */
export function truncateBeforeLastAssistant(messages: ChatMessage[]): {
  before: ChatMessage[];
  last: ChatMessage | undefined;
} {
  return { before: messages.slice(0, -1), last: messages[messages.length - 1] };
}

/** 归一化版本文件消息（status 兜底为 'sent'） */
export function normalizeVersionMessages(raw: any[]): ChatMessage[] {
  return raw.map((msg) => ({ ...msg, status: msg.status || 'sent' }));
}

/** 构建待重生成的空 assistant 消息 */
export function buildPendingAssistantMessage(speakerName?: string): ChatMessage {
  return {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'sending',
    ...(speakerName ? { speakerName } : {}),
  };
}

export interface TableSnapshotRestoreDeps {
  memoryService: {
    restoreTableFromSnapshot: (
      chatId: string,
      versionLinkId: string
    ) => Promise<{ success: boolean; error?: string }>;
  };
  fetchMemoryTableData: () => Promise<void>;
  // 兼容 useLogStore.addLog(message, type?, options?) 的宽签名
  addLog: (msg: string, level?: any, options?: any) => void;
}

/**
 * 表格快照跟随恢复（统一 rollbackToMessage 与 retryMessageFromVersion 的两处实现）。
 * 匹配模式：
 * - versionLinkId 直配（版本文件自带联动版本 id）
 * - versionIndex + targetTimestamp 联动匹配（±1000ms 窗口，仅 tableSnapshot.exists 的版本）
 * 内部捕获全部异常，不阻塞卷回/重新生成主流程。
 */
export async function restoreTableSnapshot(
  chatId: string,
  opts: {
    versionLinkId?: string;
    versionIndex?: { versions: any[] };
    targetTimestamp?: number;
  },
  deps: TableSnapshotRestoreDeps
): Promise<void> {
  if (!chatId) return;
  try {
    let versionLinkId = opts.versionLinkId;
    if (!versionLinkId && opts.versionIndex?.versions && opts.targetTimestamp !== undefined) {
      const matched = opts.versionIndex.versions.find(
        (v: any) => v.tableSnapshot?.exists && Math.abs(v.timestamp - opts.targetTimestamp!) <= 1000
      );
      if (matched) {
        versionLinkId = matched.versionLinkId;
        deps.addLog(`[CharacterDialogueChat] 卷回时找到匹配的联动版本: ${matched.versionLinkId}，准备恢复表格快照`, 'info');
      }
    }
    if (versionLinkId) {
      const restoreResult = await deps.memoryService.restoreTableFromSnapshot(chatId, versionLinkId);
      if (restoreResult.success) {
        deps.addLog(`[CharacterDialogueChat] 表格快照恢复成功: ${versionLinkId}`, 'info');
        await deps.fetchMemoryTableData();
      } else {
        deps.addLog(`[CharacterDialogueChat] 表格快照恢复失败: ${restoreResult.error}`, 'warn');
      }
    } else {
      deps.addLog('[CharacterDialogueChat] 卷回时未找到匹配的联动版本，跳过表格回退', 'debug');
    }
  } catch (tableError) {
    deps.addLog(`[CharacterDialogueChat] 表格回退异常: ${tableError}`, 'warn');
    // 不阻塞卷回/重新生成主流程
  }
}
