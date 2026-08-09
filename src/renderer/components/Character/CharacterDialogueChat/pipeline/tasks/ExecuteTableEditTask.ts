/**
 * 逻辑任务 — ExecuteTableEditTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / ExecuteTableEditTask
 *
 * 当后处理管线解析到 tableEdit 命令时，异步执行记忆表格编辑命令。
 * 采用 fire-and-forget 模式，不阻塞其他任务执行。
 *
 * 对应当前逻辑：hooks onComplete 中异步解析 tableEdit 标签并调用
 * window.electronAPI.memory.executeTableEditCommands
 * （CharacterDialogueChat.hooks.ts L1326-L1371）
 *
 * Priority: 300
 */

import type { LogicTask, DialoguePipelineContext } from '../pipeline.types';

/** ExecuteTableEditTask 构造参数 */
export interface ExecuteTableEditTaskOptions {
  /** 聊天会话 ID（characterCardName 或 characterCardId） */
  chatId: string;
  /** 角色卡 ID（预留，未来可能用于多角色卡场景） */
  characterCardId: string;
}

export class ExecuteTableEditTask implements LogicTask {
  readonly name = 'ExecuteTableEditTask';
  readonly priority = 300;

  private readonly options: ExecuteTableEditTaskOptions;

  constructor(options: ExecuteTableEditTaskOptions) {
    this.options = options;
  }

  condition(context: DialoguePipelineContext): boolean {
    return context.tableEditCommands !== null && context.tableEditCommands.length > 0;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    const commands = context.tableEditCommands!;
    const chatId = this.options.chatId;

    console.log(`[ExecuteTableEditTask] 执行表格编辑命令: chatId=${chatId}, count=${commands.length}`);

    // fire-and-forget：不 await 执行结果，避免阻塞后续任务
    // 实际执行通过 electronAPI.memory.executeTableEditCommands 调用主进程
    const memoryApi = (window as any).electronAPI?.memory;
    if (!memoryApi) {
      console.warn('[ExecuteTableEditTask] electronAPI.memory 不可用，跳过表格编辑');
      return;
    }

    memoryApi
      .executeTableEditCommands(chatId, commands)
      .then((result: { success: boolean; executed?: number; errors?: string[] }) => {
        if (result.success) {
          console.log(`[ExecuteTableEditTask] 表格编辑完成: 执行 ${result.executed ?? 0} 个命令`);
        } else {
          console.warn(`[ExecuteTableEditTask] 表格编辑有错误: ${result.errors?.join('; ') ?? '未知错误'}`);
        }
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ExecuteTableEditTask] 表格编辑异常: ${errMsg}`);
      });
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[ExecuteTableEditTask] 任务执行失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `表格编辑任务失败: ${error.message}`,
    });
  }
}
