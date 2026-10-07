/**
 * 写作模式 2.0（V2）渲染层服务封装
 *
 * Spec: refactor-writing-mode-v2 / Phase 0
 *
 * 架构规则（spec.md「G. 关键架构规则」第 3 条）：
 * V2 渲染层组件禁止直接裸调 window.electronAPI，必须通过本封装访问，
 * 保证 IPC 契约类型集中、可测（mock 本对象即可）。
 */

import type { WritingV2API } from '../../shared/types/writing-v2.types';

/** 获取 V2 API；preload 未注入时（如纯浏览器环境）返回 null，调用方需判空 */
export function getWritingV2API(): WritingV2API | null {
  const api = (window as Window & { electronAPI?: { writingV2?: WritingV2API } }).electronAPI
    ?.writingV2;
  return api ?? null;
}

/** 同步取 API；不可用时抛错（用于确定运行在 Electron 内的调用点） */
export function requireWritingV2API(): WritingV2API {
  const api = getWritingV2API();
  if (!api) {
    throw new Error('writingV2 API 不可用：当前环境未注入 preload');
  }
  return api;
}
