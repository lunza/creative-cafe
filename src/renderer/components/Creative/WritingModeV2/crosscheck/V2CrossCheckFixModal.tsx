/**
 * 跨章审查修复建议确认弹窗（展示组件）
 * Spec: add-cross-chapter-coherence-review（从 V2CrossCheckPanel 拆出，保持单组件 ≤400 行）
 * diff 式展示：原文（红删除线）→ 替换文本（绿）+ 修改理由 + 目标章节号。
 */
import React from 'react';
import { Alert, Button, Modal, Space, Tag, theme, Typography } from 'antd';
import { DeleteOutlined, HighlightOutlined } from '@ant-design/icons';
import type {
  CrossCheckFixSuggestion,
  CrossCheckIssue,
} from '../../../../../shared/types/cross-chapter-review.types';

export interface V2CrossCheckFixState {
  issue: CrossCheckIssue;
  loading: boolean;
  applying: boolean;
  suggestion: CrossCheckFixSuggestion | null;
  error: string;
}

interface V2CrossCheckFixModalProps {
  fixState: V2CrossCheckFixState | null;
  onApply: () => void;
  onClose: () => void;
}

const V2CrossCheckFixModal: React.FC<V2CrossCheckFixModalProps> = ({ fixState, onApply, onClose }) => {
  const { token } = theme.useToken();
  return (
    <Modal
      title={
        fixState?.suggestion ? (
          <Space>
            <HighlightOutlined />
            修复建议
            <Tag color="blue">
              第{fixState.suggestion.chapterIndex + 1}章（{fixState.suggestion.chapterTitle}）
            </Tag>
          </Space>
        ) : (
          '修复建议'
        )
      }
      open={!!fixState}
      onCancel={onClose}
      width={720}
      footer={
        fixState?.suggestion ? (
          <>
            <Button icon={<DeleteOutlined />} onClick={onClose}>
              取消
            </Button>
            <Button type="primary" loading={fixState.applying} onClick={onApply}>
              确认应用
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>关闭</Button>
        )
      }
    >
      {fixState?.loading && (
        <Typography.Text type="secondary">AI 正在生成修复建议…</Typography.Text>
      )}
      {fixState?.error && !fixState.loading && (
        <Alert type="warning" showIcon message="建议生成失败" description={fixState.error} />
      )}
      {fixState?.suggestion && !fixState.loading && !fixState.error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Typography.Text style={{ fontSize: 12 }}>
            <strong>修改理由：</strong>
            {fixState.suggestion.explanation}
          </Typography.Text>
          <div
            style={{
              border: `1px solid ${token.colorErrorBorder}`,
              background: token.colorErrorBg,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            <Typography.Text type="danger" strong style={{ fontSize: 11 }}>
              原文（将替换）
            </Typography.Text>
            <div
              style={{
                textDecoration: 'line-through',
                color: token.colorErrorText,
                marginTop: 4,
                whiteSpace: 'pre-wrap',
              }}
            >
              {fixState.suggestion.originalText}
            </div>
          </div>
          <div
            style={{
              border: `1px solid ${token.colorSuccessBorder}`,
              background: token.colorSuccessBg,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 12,
            }}
          >
            <Typography.Text type="success" strong style={{ fontSize: 11 }}>
              替换为
            </Typography.Text>
            <div style={{ color: token.colorSuccessText, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {fixState.suggestion.replacementText}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default V2CrossCheckFixModal;
