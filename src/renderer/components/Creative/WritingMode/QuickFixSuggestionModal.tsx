import React from 'react';
import { Modal, Button, Space, Typography, Tag, Divider } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ArrowRightOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { QuickFixSuggestion } from '../../../../shared/types/writing.types';

const { Title, Text, Paragraph } = Typography;

interface QuickFixSuggestionModalProps {
  visible: boolean;
  suggestion: QuickFixSuggestion | null;
  issueTitle: string;
  issueType: string;
  onAccept: (onComplete?: () => void) => void;
  onReject: (onComplete?: () => void) => void;
  onCancel: (onComplete?: () => void) => void;
}

const QuickFixSuggestionModal: React.FC<QuickFixSuggestionModalProps> = ({
  visible,
  suggestion,
  issueTitle,
  issueType,
  onAccept,
  onReject,
  onCancel
}) => {
  if (!suggestion) return null;

  const maxPreviewLength = 500;

  const truncateText = (text: string, maxLength: number = maxPreviewLength): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <Modal
      title={
        <Space>
          <FileTextOutlined style={{ color: '#1890ff' }} />
          <span>快速修正建议</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={750}
      footer={
        <Space>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={onAccept}>
            接受修正
          </Button>
          <Button danger icon={<CloseCircleOutlined />} onClick={onReject}>
            拒绝修正
          </Button>
          <Button onClick={onCancel}>关闭</Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 问题信息 */}
        <div>
          <Text type="secondary">问题：</Text>
          <Text strong>{issueTitle}</Text>
          <Tag style={{ marginLeft: 8 }}>{issueType}</Tag>
        </div>

        {/* 差异对比 */}
        <Divider style={{ margin: '8px 0' }} />
        <Title level={5}>修改对比</Title>

        {/* 原文本 */}
        <div>
          <Tag color="error" size="small">原文本</Tag>
          <div
            style={{
              margin: '6px 0 0',
              padding: '12px',
              backgroundColor: '#fff1f0',
              border: '1px solid #ffccc7',
              borderRadius: 6,
              color: '#000',
              fontSize: 13,
              lineHeight: 1.8,
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap'
            }}
          >
            {truncateText(suggestion.originalText || '(空)', 300)}
          </div>
        </div>

        {/* 箭头 */}
        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <ArrowRightOutlined style={{ color: '#1890ff', fontSize: 18 }} />
        </div>

        {/* 修正后 */}
        <div>
          <Tag color="success" size="small">修正后</Tag>
          <div
            style={{
              margin: '6px 0 0',
              padding: '12px',
              backgroundColor: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: 6,
              color: '#000',
              fontSize: 13,
              lineHeight: 1.8,
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap'
            }}
          >
            {truncateText(suggestion.fixedText || '(空)', 300)}
          </div>
        </div>

        {/* 修正理由 */}
        <Divider style={{ margin: '8px 0' }} />
        <Title level={5}>修正理由</Title>
        <div
          style={{
            padding: '12px',
            backgroundColor: '#f5f5f5',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            color: '#000',
            fontSize: 13,
            lineHeight: 1.8,
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap'
          }}
        >
          {suggestion.reason}
        </div>

        {/* 位置信息 */}
        {suggestion.position && (
          <div>
            <Text type="secondary">位置：</Text>
            <Text>第 {suggestion.position.startIndex} 到 {suggestion.position.endIndex} 字符</Text>
          </div>
        )}
      </Space>
    </Modal>
  );
};

export default QuickFixSuggestionModal;
