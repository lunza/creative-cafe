/**
 * SSE 流式发送消息（Spec: add-android-chat-client / R5）
 *
 * 基于 react-native-sse（Android 上通过 XHR onprogress 增量读取实现）。
 * 协议：POST /api/chats/:characterId/messages → 事件 chunk / emotion / done / error
 *
 * 注意：任何结束/错误后立即 close，杜绝 EventSource 语义的自动重连导致重复发送消息。
 */

import EventSource, { type EventSourceOptions } from 'react-native-sse';

export interface SendMessageHandlers {
  onChunk: (delta: string) => void;
  /** 思考过程增量（think_tag_mode=fold 流式期间；Spec: fix-android-chat-parity-v3） */
  onReasoning?: (delta: string) => void;
  onEmotion: (emotion: string) => void;
  /** 记忆表格编辑指令已执行（Spec: fix-android-chat-feature-parity；至多一次，可能不触发） */
  onTable?: (result: { executed: number; errors: string[] }) => void;
  /** 辅助模式推荐选项（Spec: fix-android-chat-parity-v3；至多一次，可能不触发） */
  onOptions?: (options: string[]) => void;
  onDone: (result: {
    messageId: string;
    /** 用户消息服务端 id（客户端同步本地 id 供卷回/重新生成定位；Spec: fix-android-chat-interaction-parity） */
    userMessageId?: string;
    emotion: string | null;
    content: string;
    timestamp: number;
  }) => void;
  onError: (err: { code: string; message: string }) => void;
}

export interface StreamHandle {
  cancel: () => void;
}

interface ServerErrorPayload {
  code?: string;
  message?: string;
}

export function sendMessageStream(
  baseUrl: string,
  characterId: string,
  content: string,
  handlers: SendMessageHandlers
): StreamHandle {
  let finished = false;
  let source: EventSource<'chunk' | 'reasoning' | 'emotion' | 'table' | 'options' | 'done'> | null = null;

  const close = () => {
    finished = true;
    try {
      source?.close();
    } catch {
      /* ignore */
    }
    source = null;
  };

  const options: EventSourceOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ content }),
    timeoutBeforeConnection: 15000,
  };

  source = new EventSource<'chunk' | 'reasoning' | 'emotion' | 'table' | 'options' | 'done'>(
    `http://${baseUrl}/api/chats/${encodeURIComponent(characterId)}/messages`,
    options
  );

  source.addEventListener('chunk', e => {
    if (finished) return;
    try {
      const data = JSON.parse(e.data || '{}');
      if (typeof data.delta === 'string' && data.delta) handlers.onChunk(data.delta);
    } catch {
      /* 忽略坏行 */
    }
  });

  source.addEventListener('reasoning', e => {
    if (finished) return;
    try {
      const data = JSON.parse(e.data || '{}');
      if (typeof data.delta === 'string' && data.delta) handlers.onReasoning?.(data.delta);
    } catch {
      /* 忽略坏行 */
    }
  });

  source.addEventListener('options', e => {
    if (finished) return;
    try {
      const data = JSON.parse(e.data || '{}');
      if (Array.isArray(data.options)) {
        handlers.onOptions?.(data.options.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0));
      }
    } catch {
      /* 忽略坏行 */
    }
  });

  source.addEventListener('emotion', e => {
    if (finished) return;
    try {
      const data = JSON.parse(e.data || '{}');
      if (typeof data.emotion === 'string' && data.emotion) handlers.onEmotion(data.emotion);
    } catch {
      /* 忽略坏行 */
    }
  });

  source.addEventListener('table', e => {
    if (finished) return;
    try {
      const data = JSON.parse(e.data || '{}');
      if (typeof data.executed === 'number' && handlers.onTable) {
        handlers.onTable({ executed: data.executed, errors: Array.isArray(data.errors) ? data.errors : [] });
      }
    } catch {
      /* 忽略坏行 */
    }
  });

  source.addEventListener('done', e => {
    if (finished) return;
    try {
      const data = JSON.parse(e.data || '{}');
      close();
      handlers.onDone(data);
    } catch {
      close();
      handlers.onError({ code: 'PARSE_DONE', message: '服务端响应解析失败（done 事件异常）' });
    }
  });

  source.addEventListener('error', e => {
    if (finished) return;
    // 服务端业务错误（SSE error 事件带 JSON data）与网络错误（带 message 无 data）区分
    const rawData = (e as unknown as { data?: string | null }).data;
    if (rawData) {
      try {
        const parsed = JSON.parse(rawData) as ServerErrorPayload;
        close();
        handlers.onError({
          code: parsed.code || 'SERVER_ERROR',
          message: parsed.message || '服务端错误',
        });
        return;
      } catch {
        /* 非按 JSON 处理为网络错误 */
      }
    }
    close();
    const message = (e as unknown as { message?: string }).message;
    handlers.onError({
      code: 'NETWORK',
      message: message
        ? `连接中断：${message}`
        : '连接中断（网络错误或服务端已关闭），请重试',
    });
  });

  return { cancel: close };
}
