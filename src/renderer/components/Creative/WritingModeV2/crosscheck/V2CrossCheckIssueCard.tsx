/**
 * 跨章审查问题卡片（Spec: add-cross-chapter-coherence-review）
 * 类型/严重度/来源 Tag + 章节A/B 引文对照（点击章节号跳转）+ 生成修复建议按钮。
 */
import React from 'react';
import { Button, Tag, theme, Typography } from 'antd';
import {
  CheckCircleOutlined,
  HighlightOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  CROSS_CHECK_ISSUE_TYPE_LABELS,
  CROSS_CHECK_SEVERITY_LABELS,
  type CrossCheckIssue,
  type CrossCheckIssueType,
  type CrossCheckSeverity,
} from '../../../../../shared/types/cross-chapter-review.types';

const TYPE_COLORS: Record<CrossCheckIssueType, string> = {
  plot_contradiction: 'volcano',
  plot_repetition: 'orange',
  text_repetition: 'blue',
};

const SEVERITY_COLORS: Record<CrossCheckSeverity, string> = {
  high: 'red',
  medium: 'gold',
  low: 'default',
};

function QuoteBlock({
  pos,
  title,
  quote,
  located,
  onJump,
}: {
  pos: number;
  title: string;
  quote: string;
  located?: boolean;
  onJump: (pos: number) => void;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 6,
        padding: '6px 8px',
        background: token.colorFillQuaternary,
      }}
    >
      <div
        onClick={() => onJump(pos)}
        style={{
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          color: token.colorPrimary,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
        title="点击跳转到该章节"
      >
        第{pos + 1}章（{title}）
        <RightOutlined style={{ fontSize: 10 }} />
      </div>
      {!located && (
        <Tag color="warning" style={{ marginLeft: 6, fontSize: 10 }}>
          引文未逐字定位
        </Tag>
      )}
      <div
        style={{
          fontSize: 12,
          color: token.colorTextSecondary,
          lineHeight: 1.6,
          marginTop: 4,
          maxHeight: 84,
          overflow: 'auto',
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap',
        }}
      >
        {quote || '（无引文）'}
      </div>
    </div>
  );
}

interface V2CrossCheckIssueCardProps {
  issue: CrossCheckIssue;
  fixed: boolean;
  onJump: (pos: number) => void;
  onSuggestFix: (issue: CrossCheckIssue) => void;
  suggestLoading: boolean;
}

const V2CrossCheckIssueCard: React.FC<V2CrossCheckIssueCardProps> = ({
  issue,
  fixed,
  onJump,
  onSuggestFix,
  suggestLoading,
}) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        background: token.colorBgContainer,
        opacity: fixed ? 0.65 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Tag color={TYPE_COLORS[issue.type]} style={{ marginInlineEnd: 0 }}>
          {CROSS_CHECK_ISSUE_TYPE_LABELS[issue.type]}
        </Tag>
        <Tag color={SEVERITY_COLORS[issue.severity]} style={{ marginInlineEnd: 0 }}>
          严重度：{CROSS_CHECK_SEVERITY_LABELS[issue.severity]}
        </Tag>
        <Tag style={{ marginInlineEnd: 0 }}>{issue.source === 'local' ? '本地扫描' : issue.source === 'ai' ? 'AI 审查' : '本地+AI'}</Tag>
        {fixed && (
          <Tag color="success" icon={<CheckCircleOutlined />} style={{ marginInlineEnd: 0 }}>
            已修复
          </Tag>
        )}
      </div>
      <Typography.Text style={{ fontSize: 12, display: 'block', margin: '6px 0' }}>
        {issue.description}
      </Typography.Text>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <QuoteBlock
          pos={issue.chapterA.index}
          title={issue.chapterA.title}
          quote={issue.chapterA.quote}
          located={issue.chapterA.located}
          onJump={onJump}
        />
        <QuoteBlock
          pos={issue.chapterB.index}
          title={issue.chapterB.title}
          quote={issue.chapterB.quote}
          located={issue.chapterB.located}
          onJump={onJump}
        />
      </div>
      {issue.similarPairs && issue.similarPairs.length > 0 && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: token.colorTextTertiary,
            background: token.colorFillQuaternary,
            borderRadius: 6,
            padding: '4px 8px',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {issue.similarPairs.map((p, i) => (
            <div key={i} style={{ marginBottom: i === issue.similarPairs!.length - 1 ? 0 : 4 }}>
              <ThunderboltOutlined style={{ marginRight: 4 }} />
              公共片段「{p.phrase}」（相似度 {Math.round(p.similarity * 100)}%）
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <Button
          size="small"
          icon={<HighlightOutlined />}
          loading={suggestLoading}
          disabled={fixed}
          onClick={() => onSuggestFix(issue)}
        >
          {fixed ? '已应用修复' : '生成修复建议'}
        </Button>
      </div>
    </div>
  );
};

export default V2CrossCheckIssueCard;
