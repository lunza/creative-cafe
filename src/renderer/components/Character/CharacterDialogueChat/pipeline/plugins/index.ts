/**
 * PostProcessPlugin 模块导出与批量注册
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 *
 * 导出全部 7 个预置后处理插件实现，并提供 registerAllPlugins
 * 便捷函数一次性注册所有预置插件。
 *
 * 插件执行顺序由 priority 决定（数值越小越先执行）：
 *   100 ThinkTagPlugin          — 思考标签处理
 *   200 ExpressionPlugin        — 表情情绪标签解析
 *   300 SuggestedOptionsPlugin   — 辅助模式推荐选项解析
 *   400 TableEditPlugin         — 表格编辑命令检测
 *   500 ImageGenPlugin          — 图片生成请求解析（预留）
 *   600 ContentProtectionPlugin — 内容长度保护检查
 *   700 DedupPlugin             — 去重检测
 */

export { ThinkTagPlugin } from './ThinkTagPlugin';
export { ExpressionPlugin } from './ExpressionPlugin';
export { SuggestedOptionsPlugin } from './SuggestedOptionsPlugin';
export { TableEditPlugin } from './TableEditPlugin';
export { ImageGenPlugin } from './ImageGenPlugin';
export { ContentProtectionPlugin } from './ContentProtectionPlugin';
export { DedupPlugin } from './DedupPlugin';

import { ThinkTagPlugin } from './ThinkTagPlugin';
import { ExpressionPlugin } from './ExpressionPlugin';
import { SuggestedOptionsPlugin } from './SuggestedOptionsPlugin';
import { TableEditPlugin } from './TableEditPlugin';
import { ImageGenPlugin } from './ImageGenPlugin';
import { ContentProtectionPlugin } from './ContentProtectionPlugin';
import { DedupPlugin } from './DedupPlugin';

import type { PostProcessingPipeline } from '../PostProcessingPipeline';

/**
 * 一次性注册全部 7 个预置后处理插件到 PostProcessingPipeline。
 *
 * 注册顺序不影响最终执行顺序（由 priority 决定），
 * 但同 priority 的插件按注册顺序稳定排列。
 *
 * @param pipeline 目标 PostProcessingPipeline 实例
 */
export function registerAllPlugins(pipeline: PostProcessingPipeline): void {
  // priority 100-700，按执行顺序注册
  pipeline.registerPlugin(new ThinkTagPlugin());
  pipeline.registerPlugin(new ExpressionPlugin());
  pipeline.registerPlugin(new SuggestedOptionsPlugin());
  pipeline.registerPlugin(new TableEditPlugin());
  pipeline.registerPlugin(new ImageGenPlugin());
  pipeline.registerPlugin(new ContentProtectionPlugin());
  pipeline.registerPlugin(new DedupPlugin());
}