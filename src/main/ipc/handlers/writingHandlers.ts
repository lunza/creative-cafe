/**
 * 写作模式 IPC handler 聚合注册入口
 *
 * Task 12: 将原本 1900+ 行的 writingHandlers.ts 按领域拆分为 6 个子文件：
 *   - writing/writingProjectHandlers.ts        项目 CRUD / 资源 / 版本 / AI 历史 / cleanup
 *   - writing/writingOutlineHandlers.ts         大纲生成 / 保存 / 续写 / CRUD
 *   - writing/writingChapterHandlers.ts         章节生成 / 分片 chunk / shard / AI 拆并建议
 *                                                （并托管共享的 activeAbortControllers 与
 *                                                  abortAllActiveRequests 函数）
 *   - writing/writingTableHandlers.ts           表格数据 / 配置 / 整理 / 版本快照
 *   - writing/writingStyleHandlers.ts           风格学习 / 创意描述润色
 *   - writing/writingPlotCheckHandlers.ts       剧情检查 / 自动修正 / 逻辑记录
 *
 * 本文件仅做聚合注册，不再持有具体业务逻辑。
 *
 * 入口签名保持不变：
 *   - export function registerWritingHandlers()
 *   - export function abortAllActiveRequests()   （由 writingChapterHandlers 重新导出）
 *
 * utils/wrapHandler.ts 提供高阶函数统一 try/catch + console.error + throw 兜底。
 */
import { registerWritingProjectHandlers } from './writing/writingProjectHandlers';
import { registerWritingOutlineHandlers } from './writing/writingOutlineHandlers';
import { registerWritingChapterHandlers, abortAllActiveRequests } from './writing/writingChapterHandlers';
import { registerWritingTableHandlers } from './writing/writingTableHandlers';
import { registerWritingStyleHandlers } from './writing/writingStyleHandlers';
import { registerWritingPlotCheckHandlers } from './writing/writingPlotCheckHandlers';
import { registerWritingTemplateHandlers } from './writing/writingTemplateHandlers';
import { registerWritingAgentHandlers, abortActiveWritingAgent } from './writing/writingAgentHandlers';

// 重新导出 abortAllActiveRequests，保持 main/index.ts 调用方式不变
// （main/index.ts: import { registerWritingHandlers, abortAllActiveRequests } from './ipc/handlers/writingHandlers'）
export { abortAllActiveRequests, abortActiveWritingAgent };

export function registerWritingHandlers(): void {
  registerWritingProjectHandlers();
  registerWritingOutlineHandlers();
  registerWritingChapterHandlers();
  registerWritingTableHandlers();
  registerWritingStyleHandlers();
  registerWritingPlotCheckHandlers();
  registerWritingTemplateHandlers();
  // Task 15.2: 写作智能体编排 IPC（run/cancel/status/resume + progress 流）
  registerWritingAgentHandlers();
}
