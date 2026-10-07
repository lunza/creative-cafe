/**
 * 全流程创作流水线渲染层 service
 *
 * V2 架构规则 G3：渲染层禁止裸调 window.electronAPI，必须经 service 封装。
 */
import type { PipelineAPI } from '../../shared/types/writing-v2.types';
import { getWritingV2API } from './writingV2Service';

/** 获取流水线 API（应用未就绪时为 null） */
export function getPipelineAPI(): PipelineAPI | null {
  return getWritingV2API()?.pipeline ?? null;
}
