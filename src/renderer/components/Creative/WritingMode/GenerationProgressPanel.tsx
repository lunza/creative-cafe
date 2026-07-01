import React, { useMemo } from 'react';
import { Progress, Collapse, Tag, Button, Tooltip, Space } from 'antd';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import { ChapterChunk, ChunkStatus, GenerationProgress } from '../../../../shared/types/writing.types';
import './GenerationProgressPanel.css';

interface GenerationProgressPanelProps {
  /** 是否可见 */
  visible: boolean;
  /** 生成进度数据 */
  progress: GenerationProgress | null;
  /** 分片列表 */
  chunks: ChapterChunk[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 重新生成分片的回调 */
  onRegenerateChunk?: (chunkIndex: number) => void;
  /** 跳转到编辑器对应位置的回调 */
  onScrollToChunk?: (chunkIndex: number) => void;
  /** 类名 */
  className?: string;
}

const { Panel } = Collapse;

const GenerationProgressPanel: React.FC<GenerationProgressPanelProps> = ({
  visible,
  progress,
  chunks,
  isGenerating,
  onRegenerateChunk,
  onScrollToChunk,
  className = '',
}) => {
  // 计算进度百分比
  const progressPercent = useMemo(() => {
    if (!progress || progress.totalWords === 0) return 0;
    return Math.round((progress.completedWords / progress.totalWords) * 100);
  }, [progress]);

  // 格式化剩余时间
  const formatRemainingTime = (seconds: number): string => {
    if (seconds <= 0) return '即将完成';
    if (seconds < 60) return `${Math.round(seconds)}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}时${remainingMinutes}分`;
  };

  // 获取分片状态图标
  const getChunkStatusIcon = (status: ChunkStatus) => {
    switch (status) {
      case ChunkStatus.COMPLETED:
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case ChunkStatus.GENERATING:
        return <LoadingOutlined style={{ color: '#1890ff' }} spin />;
      case ChunkStatus.PENDING:
        return <ClockCircleOutlined style={{ color: '#d9d9d9' }} />;
      case ChunkStatus.FAILED:
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return null;
    }
  };

  // 获取分片状态标签
  const getChunkStatusTag = (status: ChunkStatus) => {
    switch (status) {
      case ChunkStatus.COMPLETED:
        return <Tag color="success">已完成</Tag>;
      case ChunkStatus.GENERATING:
        return <Tag color="processing">生成中</Tag>;
      case ChunkStatus.PENDING:
        return <Tag color="default">等待中</Tag>;
      case ChunkStatus.FAILED:
        return <Tag color="error">失败</Tag>;
      default:
        return null;
    }
  };

  // 获取进度条颜色
  const getProgressStrokeColor = () => {
    if (!isGenerating) return '#52c41a';
    return {
      '0%': '#108ee9',
      '100%': '#87d068',
    };
  };

  if (!visible || !progress) {
    return null;
  }

  return (
    <div className={`generation-progress-panel ${className}`}>
      {/* 总体进度 */}
      <div className="progress-header">
        <div className="progress-title">
          <span className="progress-label">生成进度</span>
          <span className="progress-stats">
            {progress.completedWords.toLocaleString()} / {progress.totalWords.toLocaleString()} 字
          </span>
        </div>
        <Progress
          percent={progressPercent}
          strokeColor={getProgressStrokeColor()}
          size="small"
          format={(percent) => `${percent}%`}
        />
        <div className="progress-meta">
          <span className="chunk-info">
            分片 {progress.currentChunkIndex + 1} / {progress.totalChunks}
          </span>
          {isGenerating && progress.estimatedTimeRemaining > 0 && (
            <span className="time-remaining">
              预计剩余：{formatRemainingTime(progress.estimatedTimeRemaining)}
            </span>
          )}
        </div>
      </div>

      {/* 分片详情（可折叠） */}
      <Collapse
        ghost
        defaultActiveKey={isGenerating ? ['chunks'] : []}
        className="chunks-collapse"
      >
        <Panel
          header={
            <span className="chunks-header">
              <span>分片详情</span>
              <span className="chunks-summary">
                已完成 {progress.completedChunks} / {progress.totalChunks}
              </span>
            </span>
          }
          key="chunks"
        >
          <div className="chunks-list">
            {chunks.map((chunk) => (
              <div
                key={chunk.id}
                className={`chunk-item ${chunk.status}`}
                onClick={() => onScrollToChunk?.(chunk.index)}
              >
                <div className="chunk-status">{getChunkStatusIcon(chunk.status)}</div>
                <div className="chunk-info">
                  <span className="chunk-title">分片 {chunk.index + 1}</span>
                  <span className="chunk-words">
                    {chunk.actualWordCount.toLocaleString()} / {chunk.targetWordCount.toLocaleString()} 字
                  </span>
                </div>
                <div className="chunk-actions">
                  {getChunkStatusTag(chunk.status)}
                  {chunk.status === ChunkStatus.COMPLETED && onRegenerateChunk && (
                    <Tooltip title="重新生成此分片">
                      <Button
                        type="text"
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRegenerateChunk(chunk.index);
                        }}
                      />
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </Collapse>
    </div>
  );
};

export default GenerationProgressPanel;
