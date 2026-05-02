import React from 'react';
import { Card, List, Avatar, Button, Space, Typography, Empty, Tag } from 'antd';
import { HistoryOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';

const { Text, Title } = Typography;

const CreativeHistory: React.FC = () => {
  const { creativeHistory, clearHistory, setCurrentCreative } = useCreativeStore();

  const handleClearHistory = () => {
    clearHistory();
  };

  const handleSelectHistory = (content: string) => {
    setCurrentCreative(content);
  };

  const handleCopyContent = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  return (
    <Card title={<Title level={4}>历史记录</Title>} className="creative-history-card">
      {creativeHistory.length === 0 ? (
        <Empty description="暂无历史记录" />
      ) : (
        <>
          <div style={{ marginBottom: 16, textAlign: 'right' }}>
            <Button 
              danger 
              icon={<DeleteOutlined />} 
              onClick={handleClearHistory}
            >
              清空历史
            </Button>
          </div>

          <List
            className="creative-history-list"
            itemLayout="vertical"
            dataSource={creativeHistory}
            renderItem={(item) => (
              <List.Item
                key={item.id}
                avatar={<Avatar>{item.type === 'character' ? 'C' : 'W'}</Avatar>}
                actions={[
                  <Button 
                    key="select" 
                    type="link" 
                    onClick={() => handleSelectHistory(item.content)}
                  >
                    选择
                  </Button>,
                  <Button 
                    key="copy" 
                    type="link" 
                    icon={<CopyOutlined />}
                    onClick={() => handleCopyContent(item.content)}
                  >
                    复制
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{item.type === 'character' ? '角色卡' : '世界书'}</Text>
                      <Tag color={item.type === 'character' ? 'blue' : 'green'}>
                        {item.type === 'character' ? '角色卡' : '世界书'}
                      </Tag>
                      <Text type="secondary">
                        {new Date(item.timestamp).toLocaleString()}
                      </Text>
                    </Space>
                  }
                  description={
                    <div style={{ marginTop: 8 }}>
                      <Text ellipsis={{ rows: 3 }}>
                        {item.content}
                      </Text>
                      {item.tags && item.tags.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Space wrap>
                            {item.tags.map((tag, index) => (
                              <Tag key={index}>{tag}</Tag>
                            ))}
                          </Space>
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <Text type="secondary">
          提示：
          <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
            <li>历史记录最多保存最近100条</li>
            <li>点击"选择"可以将历史内容设置为当前创意</li>
            <li>点击"复制"可以复制历史内容到剪贴板</li>
            <li>点击"清空历史"可以删除所有历史记录</li>
          </ul>
        </Text>
      </div>
    </Card>
  );
};

export default CreativeHistory;