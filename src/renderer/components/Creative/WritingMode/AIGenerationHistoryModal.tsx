import React, { useState, useEffect } from 'react';
import { Modal, List, Button, Tag, Typography, Space, Popconfirm, message, Collapse } from 'antd';
import { ScissorOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { AIGenerationHistory, AISplitSuggestion, AIMergeSuggestion } from '../../../../shared/types/writing.types';

const { Text } = Typography;

interface AIGenerationHistoryModalProps {
  visible: boolean;
  projectId: string;
  onCancel: () => void;
  onRestore: (history: AIGenerationHistory) => void;
}

const AIGenerationHistoryModal: React.FC<AIGenerationHistoryModalProps> = ({
  visible,
  projectId,
  onCancel,
  onRestore
}) => {
  const [history, setHistory] = useState<AIGenerationHistory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && projectId) {
      loadHistory();
    }
  }, [visible, projectId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const result = await (window as any).electronAPI.writing.loadAIGenerationHistory({ projectId });
      if (result.success) {
        setHistory((result.history || []).sort((a, b) => b.timestamp - a.timestamp));
      } else {
        message.error(result.error?.message || '加载历史记录失败');
      }
    } catch (err) {
      message.error('加载历史记录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    try {
      const result = await (window as any).electronAPI.writing.clearAIGenerationHistory({ projectId });
      if (result.success) {
        message.success('历史记录已清空');
        setHistory([]);
      } else {
        message.error(result.error?.message || '清空失败');
      }
    } catch (err) {
      message.error('清空历史记录失败');
    }
  };

  const handleRestore = (item: AIGenerationHistory) => {
    onRestore(item);
    onCancel();
  };

  return (
    <Modal
      title="AI生成历史记录"
      open={visible}
      onCancel={onCancel}
      footer={
        <Space>
          <Popconfirm
            title="确定要清空所有历史记录吗？"
            onConfirm={handleClear}
            okText="确定"
            cancelText="取消"
          >
            <Button danger>清空历史</Button>
          </Popconfirm>
          <Button onClick={onCancel}>关闭</Button>
        </Space>
      }
      width={700}
    >
      <List
        loading={loading}
        dataSource={history}
        locale={{ emptyText: '暂无AI生成历史记录' }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button
                type="primary"
                size="small"
                onClick={() => handleRestore(item)}
              >
                回溯
              </Button>
            ]}
          >
            <List.Item.Meta
              avatar={
                item.type === 'split' ? (
                  <ScissorOutlined style={{ fontSize: 20, color: '#1890ff' }} />
                ) : (
                  <MergeCellsOutlined style={{ fontSize: 20, color: '#52c41a' }} />
                )
              }
              title={
                <Space>
                  <Tag color={item.type === 'split' ? 'blue' : 'green'}>
                    {item.type === 'split' ? '章节拆分' : '章节合并'}
                  </Tag>
                  <Text strong>
                    {item.type === 'split'
                      ? `拆分为${(item.suggestion as AISplitSuggestion).splitCount}个子章节`
                      : `合并${(item.suggestion as AIMergeSuggestion).chapterIndices?.length || 2}个章节`
                    }
                  </Text>
                </Space>
              }
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text type="secondary">
                    {new Date(item.timestamp).toLocaleString()}
                  </Text>
                  <Space>
                    <Tag>
                      状态: {item.isAccepted ? (
                        <span style={{ color: '#52c41a' }}>✓ 已采纳</span>
                      ) : (
                        <span style={{ color: '#999' }}>○ 未采纳</span>
                      )}
                    </Tag>
                    <Tag>
                      信心度: {Math.round(item.suggestion.confidence * 100)}%
                    </Tag>
                  </Space>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};

export default AIGenerationHistoryModal;
