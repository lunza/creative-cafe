/**
 * 【Phase 3 / L8 - conversation-mode-optimization-report】SD 请求排队（P4）。
 *
 * 原多个图片生成入口（对话图片生成 useImageGeneration / 素材生成 AssetGenerateModal
 * 的 generateTxt2Img 与 generateExpression）可能同时向 SD WebUI 发起请求，
 * 导致 SD 过载、请求失败或显存溢出。
 *
 * 本队列保证同时最多 1 个 SD 请求在途：后续请求排队等待前一个完成
 * （无论成功或失败）后再执行。纯 Promise 链实现，无轮询、无定时器。
 */

let chain: Promise<unknown> = Promise.resolve();

/**
 * 将 SD 请求任务排入队列。
 * 返回的 Promise 在任务实际执行后 resolve/reject（透传任务的结果与异常）。
 */
export function enqueueSdRequest<T>(task: () => Promise<T>): Promise<T> {
  // 无论前一个任务成功或失败，都继续执行下一个任务
  const result = chain.then(task, task);
  // 链本身永不 reject，保证队列不因单个任务失败而中断
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
