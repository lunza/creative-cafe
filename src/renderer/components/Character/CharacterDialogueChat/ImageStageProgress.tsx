/**
 * 【Phase 2 / M2 - conversation-mode-optimization-report】图片生成阶段进度条。
 *
 * 在消息气泡的图片占位区显示"标签生成 → 标签审计 → 图片生成"三阶段流水线，
 * 参考 V2ShardPipelinePanel 的逐项状态模式（完成=对勾 / 进行中=旋转 / 未开始=空心点）。
 * 活跃阶段额外显示实时已耗秒数与基于历史统计（imagePhaseTracker）的预计耗时，
 * 减少用户"卡死"误判（报告 U2 / I2）。
 *
 * 注：后端当前未推送独立的 'ai-optimizing' 阶段事件（AI 标签优化在
 * tag-auditing → image-generating 窗口内执行），阶段列表为可扩展设计，
 * 后端补齐该事件后在此追加第四阶段即可。
 */
import React, { useEffect, useState } from 'react';
import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import type { TraitPromptPhase } from '../../../services/characterChatService';
import { getPhaseEstimateSeconds } from './imagePhaseTracker';

const STAGES: { key: TraitPromptPhase; label: string }[] = [
  { key: 'tag-generating', label: '标签生成' },
  { key: 'tag-auditing', label: '标签审计' },
  { key: 'image-generating', label: '图片生成' },
];

interface ImageStageProgressProps {
  /** 当前生成阶段（status='generating' 时有效；'error'/undefined 时组件不会被渲染） */
  phase?: TraitPromptPhase | 'error';
}

const ImageStageProgress: React.FC<ImageStageProgressProps> = ({ phase }) => {
  // 实时已耗秒数：阶段激活时每秒 tick 一次
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!phase) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const activeIndex = STAGES.findIndex((s) => s.key === phase);
  // phase 可能为 'error'（非生成阶段），需收窄后再查预计耗时
  const estimate = phase && phase !== 'error' ? getPhaseEstimateSeconds(phase) : null;

  return (
    <div className="chat-msg-image-stage-progress">
      {STAGES.map((stage, i) => {
        const stageState = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending';
        return (
          <div key={stage.key} className={`chat-msg-image-stage ${stageState}`}>
            <span className="stage-icon">
              {stageState === 'done' ? (
                <CheckOutlined />
              ) : stageState === 'active' ? (
                <LoadingOutlined spin />
              ) : (
                <span className="stage-dot" />
              )}
            </span>
            <span className="stage-label">{stage.label}</span>
          </div>
        );
      })}
      {activeIndex >= 0 && (
        <span className="stage-elapsed">
          {elapsed}s{estimate != null ? ` · 预计≈${estimate}s` : ''}
        </span>
      )}
    </div>
  );
};

export default ImageStageProgress;
