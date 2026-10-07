import React, { useState } from 'react';
import { Button, Card, Input, InputNumber, Space, Spin, Tag, Typography, message, theme } from 'antd';
import {
  PartitionOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  CheckOutlined,
  MergeCellsOutlined,
} from '@ant-design/icons';
import { ShardStatus } from '../../../../../shared/types/writing-v2.types';
import { useV2GenerationStore, V2PipelinePhase } from '../stores/useV2GenerationStore';

const { Text } = Typography;

interface V2ShardPipelinePanelProps {
  planShards: (count: number) => Promise<boolean>;
  generateShard: (index: number) => Promise<void>;
  /** 合并分片到章节正文（返回 false 表示无内容可合并） */
  mergeToChapter: () => Promise<boolean>;
}

const PHASE_LABELS: Record<V2PipelinePhase, string> = {
  IDLE: '就绪',
  PLANNING: '生成分片大纲…',
  STREAMING: '分片内容生成中…',
  INTEGRATING: '合并中…',
  DONE: '已完成合并',
  ERROR: '出错',
};

/**
 * V2 分片流水线面板（Phase 1 / P0）
 * 三步操作：生成分片大纲 → 逐片生成/重生成/确认 → 合并进章节正文。
 */
const V2ShardPipelinePanel: React.FC<V2ShardPipelinePanelProps> = ({
  planShards,
  generateShard,
  mergeToChapter,
}) => {
  const { token } = theme.useToken();
  const [shardCount, setShardCount] = useState(3);

  const phase = useV2GenerationStore((s) => s.phase);
  const error = useV2GenerationStore((s) => s.error);
  const shardOutlines = useV2GenerationStore((s) => s.shardOutlines);
  const shardDetails = useV2GenerationStore((s) => s.shardDetails);
  const streamingShardIndex = useV2GenerationStore((s) => s.streamingShardIndex);
  const updateShardOutline = useV2GenerationStore((s) => s.updateShardOutline);
  const setShardContent = useV2GenerationStore((s) => s.setShardContent);
  const setShardConfirmed = useV2GenerationStore((s) => s.setShardConfirmed);

  const hasShards = shardOutlines.length > 0;
  const completedCount = shardDetails.filter((d) => d.status === ShardStatus.COMPLETED).length;

  const handlePlan = async () => {
    const ok = await planShards(shardCount);
    if (ok) message.success(`已生成 ${shardCount} 个分片大纲`);
  };

  const handleMerge = async () => {
    const ok = await mergeToChapter();
    if (ok) message.success('分片内容已合并到章节正文');
    else message.warning('没有可合并的分片内容');
  };

  return (
    <Card
      size="small"
      title={
        <span>
          <PartitionOutlined style={{ marginRight: 8 }} />
          分片生成流水线
          <Tag style={{ marginLeft: 8 }}>{PHASE_LABELS[phase]}</Tag>
          {hasShards && (
            <Tag color="blue" style={{ marginLeft: 4 }}>
              {completedCount}/{shardOutlines.length}
            </Tag>
          )}
        </span>
      }
    >
      {/* 第一步：生成分片大纲 */}
      <Space style={{ marginBottom: 12 }} wrap>
        <InputNumber
          min={1}
          max={10}
          value={shardCount}
          onChange={(v) => setShardCount(v ?? 3)}
          addonBefore="分片数"
          size="small"
        />
        <Button
          type="primary"
          size="small"
          icon={<PlayCircleOutlined />}
          loading={phase === 'PLANNING'}
          onClick={handlePlan}
        >
          {hasShards ? '重新规划分片' : '生成分片大纲'}
        </Button>
      </Space>
      {error && <Text type="danger">{error}</Text>}

      {/* 分片列表 */}
      {hasShards && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflow: 'auto' }}>
          {shardDetails.map((detail, i) => {
            const isStreaming = streamingShardIndex === i;
            // 思考模型正文前会先输出思考流：无正文但有思考内容时显示"思考中"
            const isThinking = detail.status === ShardStatus.GENERATING && !detail.content && Boolean(detail.reasoning);
            const statusTag =
              detail.status === ShardStatus.GENERATING ? (
                isThinking ? (
                  <Tag icon={<Spin size="small" />} color="gold">AI 思考中</Tag>
                ) : (
                  <Tag icon={<Spin size="small" />} color="processing">生成中</Tag>
                )
              ) : detail.status === ShardStatus.COMPLETED ? (
                <Tag color="success">已完成</Tag>
              ) : detail.status === ShardStatus.FAILED ? (
                <Tag color="error">失败</Tag>
              ) : (
                <Tag>待生成</Tag>
              );
            return (
              <div
                key={i}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 6,
                  padding: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Text strong style={{ width: 40 }}>分片 {i + 1}</Text>
                  {statusTag}
                  {detail.confirmed && <Tag color="cyan">已确认</Tag>}
                  <span style={{ flex: 1 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {detail.actualWordCount} 字
                  </Text>
                  <Button
                    size="small"
                    type={detail.status === ShardStatus.COMPLETED ? 'default' : 'primary'}
                    icon={detail.status === ShardStatus.COMPLETED ? <RedoOutlined /> : <PlayCircleOutlined />}
                    loading={isStreaming}
                    disabled={isStreaming || phase === 'PLANNING' || phase === 'INTEGRATING'}
                    onClick={() => generateShard(i)}
                  >
                    {detail.status === ShardStatus.COMPLETED ? '重新生成' : '生成'}
                  </Button>
                  <Button
                    size="small"
                    icon={<CheckOutlined />}
                    disabled={detail.status !== ShardStatus.COMPLETED}
                    type={detail.confirmed ? 'default' : 'primary'}
                    onClick={() => setShardConfirmed(i, !detail.confirmed)}
                  >
                    {detail.confirmed ? '取消确认' : '确认'}
                  </Button>
                </div>
                {/* 分片大纲（可编辑） */}
                <Input.TextArea
                  size="small"
                  value={detail.summary}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  placeholder="分片剧情简介（可编辑，作为该分片生成的核心依据）"
                  disabled={isStreaming}
                  onChange={(e) => updateShardOutline(i, { summary: e.target.value })}
                  style={{ marginBottom: 6 }}
                />
                {/* 分片内容（可编辑预览）；思考期显示思考流，正文开始后显示正文 */}
                {detail.content || isStreaming ? (
                  <Input.TextArea
                    size="small"
                    value={detail.content || detail.reasoning || ''}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    placeholder={isStreaming ? (isThinking ? 'AI 思考中…' : '内容生成中…') : '（空）'}
                    disabled={isStreaming}
                    onChange={(e) => setShardContent(i, e.target.value)}
                    style={{ fontFamily: 'inherit', color: isThinking ? '#b3791a' : undefined }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* 合并 */}
      {hasShards && (
        <Button
          block
          type="primary"
          icon={<MergeCellsOutlined />}
          style={{ marginTop: 12 }}
          loading={phase === 'INTEGRATING'}
          disabled={completedCount === 0}
          onClick={handleMerge}
        >
          合并 {completedCount} 个分片到章节正文
        </Button>
      )}
    </Card>
  );
};

export default V2ShardPipelinePanel;
