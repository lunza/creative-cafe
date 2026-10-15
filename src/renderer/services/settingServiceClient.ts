/**
 * 设置模块渲染层服务封装（Spec: settings-feature-optimization-report / N6, M-17）
 *
 * 架构规则（对照 writingV2Service.ts 的封装纪律）：
 * 渲染层组件/store 禁止直接裸调 window.electronAPI.setting.*，必须通过本封装访问，
 * 保证 IPC 契约类型集中、可测（mock 本对象即可）。
 */

import type { SettingAPI } from '../../shared/types/setting.types';

/** 获取 setting API；preload 未注入时（如纯浏览器环境）返回 null，调用方需判空 */
export function getSettingAPI(): SettingAPI | null {
  const api = (window as Window & { electronAPI?: { setting?: SettingAPI } }).electronAPI?.setting;
  return api ?? null;
}

/** 同步取 API；不可用时抛错（用于确定运行在 Electron 内的调用点） */
export function requireSettingAPI(): SettingAPI {
  const api = getSettingAPI();
  if (!api) {
    throw new Error('setting API 不可用：当前环境未注入 preload');
  }
  return api;
}
