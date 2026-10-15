/**
 * 设置模块 IPC 类型契约（Spec: settings-feature-optimization-report / N6, M-17）
 *
 * 设计原则（对照 writing-v2.types.ts 的全类型化契约模式）：
 * 1. 禁止 any 穿透：preload `setting` 命名空间的每个通道都有显式 Result 信封类型。
 * 2. 渲染层禁裸调 window.electronAPI.setting.*，统一经 renderer/services/settingServiceClient.ts。
 *
 * 通道与主进程 handler（src/main/ipc/handlers/settingHandlers.ts）一一对应：
 * - setting:load  → SettingLoadResult
 * - setting:save  → SettingSaveResult
 * - setting:getPath → SettingPathResult
 */

import type { AppSetting } from '../../renderer/types/setting';

/** setting:load 结果信封 */
export type SettingLoadResult =
  | { success: true; setting: AppSetting }
  | { success: false; error: string };

/** setting:save 结果信封 */
export type SettingSaveResult =
  | { success: true }
  | { success: false; error: string };

/** setting:getPath 结果信封 */
export type SettingPathResult =
  | { success: true; path: string }
  | { success: false; error: string };

/** preload `setting` 命名空间完整契约 */
export interface SettingAPI {
  load(): Promise<SettingLoadResult>;
  save(setting: AppSetting): Promise<SettingSaveResult>;
  getPath(): Promise<SettingPathResult>;
}

/** 设置校验结果（M-10/ST-6：validateSetting 真实校验，与 N3 迁移链共用校验器） */
export interface SettingValidationResult {
  valid: boolean;
  /** 校验失败原因清单（valid=true 时为空数组） */
  errors: string[];
}
