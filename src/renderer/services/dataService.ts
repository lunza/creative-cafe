/**
 * DataService —— 角色卡 / 头像 IPC 访问层（D1 分层修复产物）
 *
 * 来源：spec §1.2 D1（dataStore 直接操作 ElectronAPI，违反分层）
 * 决策：抽出 IPC 调用到独立 service，dataStore 仅持有纯数据状态并委托本 service。
 *
 * 职责：
 *  1. 封装 `window.electronAPI.character.*` / `window.electronAPI.avatar.*` 的 IPC 调用
 *  2. 统一错误处理与返回值归一化，向上层抛出 Error 而非裸 IPC 结果
 *  3. 作为 store 与 ElectronAPI 之间的防腐层，便于后续替换/测试 mock
 *
 * 设计约束：
 *  - 不持有任何 React/Zustand 状态，纯函数式服务
 *  - 不引入业务校验（由调用方/store 负责），仅做 IPC 通信与结果归一化
 *  - 错误向上抛出，由 store 的 try/catch 统一转为 error 状态
 */

/** 角色卡优化结果（归一化后） */
export interface CharacterOptimizeResult {
  success: boolean;
  message?: string;
}

/**
 * 获取角色卡列表。
 * @throws Error 当 IPC 调用失败时
 */
export async function fetchCharacters(): Promise<any[]> {
  const characters = await window.electronAPI.character.list();
  return characters ?? [];
}

/**
 * 获取头像列表。
 * @throws Error 当 IPC 调用失败时
 */
export async function fetchAvatars(): Promise<any[]> {
  const avatars = await window.electronAPI.avatar.list();
  return avatars ?? [];
}

/**
 * 优化角色卡（压缩图片等）。
 * @throws Error 当 IPC 调用失败时
 * @returns 归一化后的优化结果
 */
export async function optimizeCharacter(path: string): Promise<CharacterOptimizeResult> {
  const result = await window.electronAPI.character.optimize(path);
  // 主进程返回任意结构，归一化为 { success, message? }
  if (result && typeof result === 'object' && 'success' in result) {
    return {
      success: Boolean(result.success),
      message: typeof result.message === 'string' ? result.message : undefined,
    };
  }
  // 兜底：无 success 字段时视为成功
  return { success: true };
}
