import type { IpcMainInvokeEvent } from 'electron';

/**
 * 高阶函数：统一包装 IPC handler 的 try/catch 错误处理。
 *
 * 包装后的 handler 会捕获内部异常并通过 console.error 统一记录，
 * 然后重新抛出错误以保持 Electron IPC 行为不变。
 *
 * 注意：若业务 handler 需要在出错时执行副作用（例如向渲染进程发送
 * `xxx:error` 事件），请保留内部 try/catch；wrapHandler 仅作为最外层
 * 兜底，避免业务逻辑异常逃逸到 Electron IPC 边界。
 *
 * @example
 * ipcMain.handle('foo:bar', wrapHandler(async (arg1, arg2) => {
 *   return await service.doSomething(arg1, arg2);
 * }));
 */
export function wrapHandler<TArgs extends any[], TResult>(
  fn: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> {
  return async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (error) {
      console.error('[IPC Handler Error]', error);
      throw error;
    }
  };
}
