import React from 'react';
import { Card, Collapse, Button, Input, Tag, Space, Tooltip } from 'antd';
import {
  PlayCircleOutlined,
  ThunderboltOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { ShardOutline, ShardDetail, ShardStatus } from '../../../../shared/types/writing.types';

const { TextArea } = Input;

interface ShardDetailPanelProps {
  chapterIndex: number;
  shardOutlines: ShardOutline[];
  shardDetails: ShardDetail[];
  onGenerateShard: (shardIndex: number) => void;
  onGenerateAll: () => void;
  onShardContentChange: (shardIndex: number, content: string) => void;
  onConfirmShard: (shardIndex: number) => void;
}

// 分片状态 Tag 配置
const getShardStatusTag = (status: ShardStatus) => {
  switch (status) {
    case ShardStatus.PENDING:
      return <Tag color="default">等待中</Tag>;
    case ShardStatus.GENERATING:
      return <Tag color="processing" icon={<span className="ant-tag-dot" />}>生成中</Tag>;
    case ShardStatus.COMPLETED:
      return <Tag color="success">已完成</Tag>;
    case ShardStatus.FAILED:
      return <Tag color="error">失败</Tag>;
    default:
      return <Tag color="default">未知</Tag>;
  }
};

const ShardDetailPanel: React.FC<ShardDetailPanelProps> = ({
  shardOutlines,
  shardDetails,
  onGenerateShard,
  onGenerateAll,
  onShardContentChange,
  onConfirmShard,
}) => {
  // 是否有任何分片正在生成
  const isAnyGenerating = shardDetails.some(d => d.status === ShardStatus.GENERATING);

  // 已完成分片数
  const completedCount = shardDetails.filter(d => d.status === ShardStatus.COMPLETED).length;

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>分片详情</span>
          <Space size="small">
            <span style={{ fontSize: 12, color: '#999' }}>
              {completedCount} / {shardOutlines.length} 已完成
            </span>
            <Tooltip title="从第一个未完成分片开始顺序生成">
              <Button
                type="primary"
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={onGenerateAll}
                disabled={isAnyGenerating || shardOutlines.length === 0}
                loading={isAnyGenerating}
              >
                连续生成
              </Button>
            </Tooltip>
          </Space>
        </div>
      }
    >
      {/* 完整分片大纲只读概览 */}
      <Collapse
        ghost
        size="small"
        style={{ marginBottom: 8 }}
        items={[{
          key: 'overview',
          label: <span style={{ fontSize: 13, fontWeight: 500 }}>分片大纲概览</span>,
          children: (
            <div>
              {shardOutlines.map((outline) => (
                <div
                  key={outline.index}
                  style={{
                    padding: '6px 8px',
                    marginBottom: 4,
                    background: '#fafafa',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500 }}>分片 {outline.index + 1}：{outline.title}</span>
                    <span style={{ color: '#999' }}>{outline.targetWordCount.toLocaleString()} 字</span>
                  </div>
                  <div style={{ color: '#666', marginTop: 2 }}>{outline.summary}</div>
                </div>
              ))}
            </div>
          ),
        }]}
      />

      {/* 每个分片详情卡片 */}
      <Collapse
        ghost
        size="small"
        defaultActiveKey={shardDetails.map((_, i) => String(i))}
        items={shardOutlines.map((outline) => {
          const detail = shardDetails[outline.index];
          const isGenerating = detail?.status === ShardStatus.GENERATING;
          const isCompleted = detail?.status === ShardStatus.COMPLETED;
          const isConfirmed = detail?.confirmed;

          return {
            key: String(outline.index),
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <Space size="small">
                  <span style={{ fontWeight: 500 }}>分片 {outline.index + 1}</span>
                  <span style={{ color: '#999', fontSize: 12 }}>{outline.title}</span>
                </Space>
                <Space size="small">
                  {getShardStatusTag(detail?.status || ShardStatus.PENDING)}
                  <span style={{ fontSize: 11, color: '#999' }}>
                    {detail?.actualWordCount || 0} / {outline.targetWordCount.toLocaleString()} 字
                  </span>
                </Space>
              </div>
            ),
            children: (
              <div>
                {/* 分片内容编辑器 */}
                <TextArea
                  rows={10}
                  value={detail?.content || ''}
                  onChange={(e) => onShardContentChange(outline.index, e.target.value)}
                  placeholder={isCompleted ? '分片内容（可编辑）' : '尚未生成，点击下方按钮生成分片内容'}
                  disabled={isGenerating}
                  style={{ marginBottom: 8, fontSize: 13 }}
                />

                {/* 操作按钮 */}
                <Space size="small">
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => onGenerateShard(outline.index)}
                    loading={isGenerating}
                    disabled={isAnyGenerating && !isGenerating}
                  >
                    {isCompleted ? '重新生成' : '分片生成'}
                  </Button>
                  <Button
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => onConfirmShard(outline.index)}
                    disabled={isGenerating || !detail?.content}
                    type={isConfirmed ? 'default' : 'dashed'}
                  >
                    {isConfirmed ? '已确认（点击覆盖）' : '确认分片内容'}
                  </Button>
                </Space>

                {/* 剧情简介提示 */}
                <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
                  剧情简介：{outline.summary}
                </div>
              </div>
            ),
          };
        })}
      />
    </Card>
  );
};

export default ShardDetailPanel;
