import React from 'react';
import { Modal, Button, Space, Typography, Tag, Divider, List } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DiffOutlined,
  ArrowRightOutlined
} from '@ant-design/icons';
import { AutoFixResult } from '../../../../shared/types/writing.types';

const { Title, Text, Paragraph } = Typography;

interface AutoFixResultModalProps {
  visible: boolean;
  result: AutoFixResult | null;
  issueTitle: string;
  issueType: string;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}

const AutoFixResultModal: React.FC<AutoFixResultModalProps> = ({
  visible,
  result,
  issueTitle,
  issueType,
  onAccept,
  onReject,
  onCancel
}) => {
  if (!result) return null;

  const maxPreviewLength = 200;

  const truncateText = (text: string, maxLength: number = maxPreviewLength): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <Modal
      title={
        <Space>
          {result.success ? (
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
          ) : (
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
          )}
          <span>{result.success ? '修正完成' : '修正失败'}</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={700}
      footer={
        <Space>
          {result.success && result.diffs.length > 0 && (
            <>
              <Button type="primary" onClick={onAccept}>
                接受修正
              </Button>
              <Button danger onClick={onReject}>
                拒绝修正
              </Button>
            </>
          )}
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

        {result.success ? (
          <>
            {/* 修正结果摘要 */}
            <div>
              <Text type="secondary">修正状态：</Text>
              <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
            </div>

            <div>
              <Text type="secondary">修改位置数：</Text>
              <Tag icon={<DiffOutlined />} color="blue">{result.diffs.length} 处</Tag>
            </div>

            {/* 差异对比 */}
            {result.diffs.length > 0 && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <Title level={5}>修改详情</Title>
                <List
                  size="small"
                  dataSource={result.diffs}
                  renderItem={(diff, index) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Space>
                            <Tag color="blue">修改 {index + 1}</Tag>
                            {diff.position && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                位置: {diff.position.startIndex}-{diff.position.endIndex}
                              </Text>
                            )}
                          </Space>
                        }
                        description={
                          <Space direction="vertical" style={{ width: '100%' }} size="small">
                            <div>
                              <Tag color="error" size="small">原文本</Tag>
                              <div
                                style={{
                                  margin: '4px 0 0',
                                  padding: '8px',
                                  backgroundColor: 'var(--bg-diff-original, #fff1f0)',
                                  border: '1px solid var(--border-diff-original, #ffccc7)',
                                  borderRadius: 4,
                                  color: 'var(--text-diff-original, #000)',
                                  fontSize: 13,
                                  lineHeight: 1.6,
                                  wordBreak: 'break-all',
                                  whiteSpace: 'pre-wrap'
                                }}
                              >
                                {truncateText(diff.originalText || '(空)', 150)}
                              </div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <ArrowRightOutlined style={{ color: '#1890ff' }} />
                            </div>
                            <div>
                              <Tag color="success" size="small">修正后</Tag>
                              <div
                                style={{
                                  margin: '4px 0 0',
                                  padding: '8px',
                                  backgroundColor: 'var(--bg-diff-fixed, #f6ffed)',
                                  border: '1px solid var(--border-diff-fixed, #b7eb8f)',
                                  borderRadius: 4,
                                  color: 'var(--text-diff-fixed, #000)',
                                  fontSize: 13,
                                  lineHeight: 1.6,
                                  wordBreak: 'break-all',
                                  whiteSpace: 'pre-wrap'
                                }}
                              >
                                {truncateText(diff.fixedText || '(空)', 150)}
                              </div>
                            </div>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              </>
            )}

            {/* 无差异的情况 */}
            {result.diffs.length === 0 && (
              <Paragraph style={{ textAlign: 'center', color: '#faad14' }}>
                AI 返回了修正内容，但未检测到具体差异。请手动检查编辑器内容确认是否已修正。
              </Paragraph>
            )}
          </>
        ) : (
          /* 失败信息 */
          <>
            <Paragraph style={{ color: '#ff4d4f', textAlign: 'center' }}>
              <CloseCircleOutlined /> {result.error || '修正失败，请重试'}
            </Paragraph>
          </>
        )}
      </Space>
    </Modal>
  );
};

export default AutoFixResultModal;
