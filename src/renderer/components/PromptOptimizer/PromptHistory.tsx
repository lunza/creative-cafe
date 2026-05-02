import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Space, Typography, Tag, Input, message, Pagination } from 'antd';
import { HistoryOutlined, DeleteOutlined, CopyOutlined, EditOutlined } from '@ant-design/icons';
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore';
import { PromptHistory as PromptHistoryType } from '../../types/promptOptimizer';
import { useUIStore } from '../../stores/uiStore';

const { Text, Title } = Typography;
const { Search } = Input;

const PromptHistory: React.FC = () => {
  const { theme } = useUIStore();
  const { 
    history, 
    historyPagination, 
    loadHistory, 
    deleteHistory, 
    updateHistoryTags,
    setCurrentPrompt,
    searchHistory
  } = usePromptOptimizerStore();
  
  const [searchText, setSearchText] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<PromptHistoryType | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const handleSearch = (value: string) => {
    setSearchText(value);
    if (value) {
      setIsSearching(true);
    } else {
      setIsSearching(false);
      loadHistory();
    }
  };

  const handlePageChange = (page: number, pageSize: number) => {
    loadHistory({ page, pageSize });
  };

  const handleDelete = (id: string) => {
    deleteHistory(id);
    message.success('删除成功');
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      message.success('已复制到剪贴板');
    } catch (error) {
      message.error('复制失败');
    }
  };

  const handleApply = (content: string) => {
    setCurrentPrompt(content);
    message.success('已应用到当前提示词');
  };

  const handleViewDetails = (item: PromptHistoryType) => {
    setSelectedHistory(item);
  };

  const displayHistory = isSearching ? searchHistory(searchText) : history;

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: 'generation' | 'optimization') => (
        <Tag color={type === 'generation' ? 'blue' : 'green'}>
          {type === 'generation' ? '生成' : '优化'}
        </Tag>
      )
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: PromptHistoryType) => (
        <Text onClick={() => handleViewDetails(record)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
          {title}
        </Text>
      )
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[]) => (
        <Space>
          {tags.map((tag, index) => (
            <Tag key={index} size="small">{tag}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (createdAt: string) => (
        <Text type="secondary">
          {new Date(createdAt).toLocaleString()}
        </Text>
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: PromptHistoryType) => (
        <Space size="small">
          <Button
            type="link"
            icon={<CopyOutlined />}
            size="small"
            onClick={() => handleCopy(record.result)}
          >
            复制
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleApply(record.result)}
          >
            应用
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            size="small"
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div className="prompt-history">
      <Card title="提示词历史记录" className="prompt-history-card">
        <div className="history-search" style={{ marginBottom: 16 }}>
          <Search
            placeholder="搜索历史记录"
            onSearch={handleSearch}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ width: 300 }}
          />
        </div>

        <Table
          columns={columns}
          dataSource={displayHistory}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: '暂无历史记录' }}
        />

        {!isSearching && (
          <Pagination
            current={historyPagination.page}
            pageSize={historyPagination.pageSize}
            total={historyPagination.total}
            onChange={handlePageChange}
            style={{ marginTop: 16, textAlign: 'center' }}
          />
        )}

        {selectedHistory && (
          <Card className="history-details-card" size="small" style={{ marginTop: 16 }}>
            <Title level={4} style={{ marginBottom: 16 }}>历史记录详情</Title>
            <div className="history-details">
              <Text strong>类型：</Text>
              <Tag color={selectedHistory.type === 'generation' ? 'blue' : 'green'}>
                {selectedHistory.type === 'generation' ? '生成' : '优化'}
              </Tag>
              
              <div style={{ marginTop: 8 }}>
                <Text strong>标题：</Text>
                <Text>{selectedHistory.title}</Text>
              </div>
              
              <div style={{ marginTop: 8 }}>
                <Text strong>创建时间：</Text>
                <Text type="secondary">
                  {new Date(selectedHistory.createdAt).toLocaleString()}
                </Text>
              </div>
              
              <div style={{ marginTop: 8 }}>
                <Text strong>标签：</Text>
                <Space>
                  {selectedHistory.tags.map((tag, index) => (
                    <Tag key={index} size="small">{tag}</Tag>
                  ))}
                </Space>
              </div>
              
              <div style={{ marginTop: 16 }}>
                <Text strong>输入：</Text>
                <div className="prompt-content" style={{ marginTop: 4 }}>
                  <Text>{selectedHistory.content}</Text>
                </div>
              </div>
              
              <div style={{ marginTop: 16 }}>
                <Text strong>结果：</Text>
                <div className="prompt-content" style={{ marginTop: 4 }}>
                  <Text>{selectedHistory.result}</Text>
                </div>
              </div>
              
              <div className="history-actions" style={{ marginTop: 16 }}>
                <Space size="small">
                  <Button
                    type="primary"
                    icon={<EditOutlined />}
                    size="small"
                    onClick={() => handleApply(selectedHistory.result)}
                  >
                    应用
                  </Button>
                  <Button
                    icon={<CopyOutlined />}
                    size="small"
                    onClick={() => handleCopy(selectedHistory.result)}
                  >
                    复制
                  </Button>
                </Space>
              </div>
            </div>
          </Card>
        )}
      </Card>
    </div>
  );
};

export default PromptHistory;
