import React, { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, Typography, message, Popconfirm, Input, Select } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  RocketOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';

interface CreativeListProps {
  onSelectCreative: (id: string) => void;
}

const { Text, Title } = Typography;
const { Search } = Input;

const CreativeList: React.FC<CreativeListProps> = ({ onSelectCreative }) => {
  const { theme } = useUIStore();
  const {
    creativeItems,
    currentCreativeId,
    setCurrentCreativeId,
    deleteCreative,
    loadCreatives
  } = useCreativeStore();

  const [filteredItems, setFilteredItems] = useState(creativeItems);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'ascend' | 'descend'>('descend');
  const [sortField, setSortField] = useState<string>('updatedAt');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    loadCreatives();
  }, []);

  useEffect(() => {
    filterAndSortItems();
  }, [creativeItems, searchText, typeFilter, statusFilter, sortOrder, sortField]);

  const filterAndSortItems = () => {
    let filtered = [...creativeItems];

    // 搜索过滤
    if (searchText) {
      const text = searchText.toLowerCase();
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(text) ||
        item.content.toLowerCase().includes(text) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(text)))
      );
    }

    // 类型过滤
    if (typeFilter !== 'all') {
      filtered = filtered.filter(item => item.type === typeFilter);
    }

    // 状态过滤
    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => item.status === statusFilter);
    }

    // 排序
    filtered.sort((a, b) => {
      if (sortField === 'title') {
        return sortOrder === 'ascend' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title);
      } else if (sortField === 'createdAt' || sortField === 'updatedAt') {
        return sortOrder === 'ascend' ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
      }
      return 0;
    });

    setFilteredItems(filtered);
  };

  const handleSearch = (value: string) => {
    setSearchText(value);
    setPage(1);
  };

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value);
    setPage(1);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleSort = (sorter: any) => {
    setSortField(sorter.field as string);
    setSortOrder(sorter.order as 'ascend' | 'descend');
  };

  const handlePageChange = (page: number, pageSize: number) => {
    setPage(page);
    setPageSize(pageSize);
  };

  const handleSelectCreative = (id: string) => {
    setCurrentCreativeId(id);
    message.success('已选择创意！');
    if (onSelectCreative) {
      onSelectCreative(id);
    }
  };

  const handleDeleteCreative = (id: string) => {
    if (deleteCreative(id)) {
      message.success('创意已删除！');
    } else {
      message.error('删除创意失败！');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft':
        return <ClockCircleOutlined style={{ color: '#1890ff' }} />;
      case 'in_progress':
        return <RocketOutlined style={{ color: '#faad14' }} />;
      case 'completed':
        return <CheckOutlined style={{ color: '#52c41a' }} />;
      default:
        return null;
    }
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'draft':
        return <Tag color="blue">草稿</Tag>;
      case 'in_progress':
        return <Tag color="orange">进行中</Tag>;
      case 'completed':
        return <Tag color="green">已完成</Tag>;
      default:
        return <Tag>未知</Tag>;
    }
  };

  const getTypeIcon = (type: string) => {
    return type === 'character' ? <FileTextOutlined /> : <RocketOutlined />;
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 100,
      render: (id: string) => <Text type="secondary">{id.substring(0, 8)}...</Text>
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      sorter: true,
      sortOrder: sortField === 'title' ? sortOrder : false,
      render: (title: string, record: any) => (
        <Space orientation="vertical" size={4}>
          <Text strong onClick={() => handleSelectCreative(record.id)} style={{ cursor: 'pointer', color: theme === 'dark' ? '#40a9ff' : '#1890ff' }}>
            {title}
          </Text>
          <Text type="secondary" ellipsis style={{ width: 300 }}>
            {record.content.substring(0, 100)}...
          </Text>
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Space>
          {getTypeIcon(type)}
          <Text>{type === 'character' ? '角色卡' : '世界书'}</Text>
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Space>
          {getStatusIcon(status)}
          {getStatusTag(status)}
        </Space>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: true,
      sortOrder: sortField === 'createdAt' ? sortOrder : false,
      render: (timestamp: number) => (
        <Text type="secondary">{new Date(timestamp).toLocaleString()}</Text>
      )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      sorter: true,
      sortOrder: sortField === 'updatedAt' ? sortOrder : false,
      render: (timestamp: number) => (
        <Text type="secondary">{new Date(timestamp).toLocaleString()}</Text>
      )
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 200,
      render: (tags: string[]) => (
        <Space wrap>
          {tags && tags.map(tag => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button 
            type="link" 
            icon={<EyeOutlined />} 
            onClick={() => handleSelectCreative(record.id)}
          >
            查看
          </Button>
          <Button 
            type="link" 
            icon={<EditOutlined />}
            onClick={() => handleSelectCreative(record.id)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个创意吗？"
            onConfirm={() => handleDeleteCreative(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              type="link" 
              danger 
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedItems = filteredItems.slice(startIndex, endIndex);

  return (
    <div className={`creative-list ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`}>
      <div className="creative-list-header">
        <Title level={4}>创意列表</Title>
        <Text type="secondary">
          管理和操作所有创意项目
        </Text>
      </div>

      <div className="creative-list-filters" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Search
            placeholder="搜索创意..."
            allowClear
            style={{ width: 300 }}
            onSearch={handleSearch}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Select
            placeholder="筛选类型"
            style={{ width: 120 }}
            defaultValue="all"
            onChange={handleTypeFilterChange}
          >
            <Select.Option value="all">全部</Select.Option>
            <Select.Option value="character">角色卡</Select.Option>
            <Select.Option value="worldbook">世界书</Select.Option>
          </Select>
          <Select
            placeholder="筛选状态"
            style={{ width: 120 }}
            defaultValue="all"
            onChange={handleStatusFilterChange}
          >
            <Select.Option value="all">全部</Select.Option>
            <Select.Option value="draft">草稿</Select.Option>
            <Select.Option value="in_progress">进行中</Select.Option>
            <Select.Option value="completed">已完成</Select.Option>
          </Select>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={paginatedItems}
        rowKey="id"
        pagination={{
          current: page,
          pageSize: pageSize,
          total: filteredItems.length,
          onChange: handlePageChange,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100']
        }}
        onSort={handleSort}
        rowClassName={(record) => record.id === currentCreativeId ? 'current-creative-row' : ''}
      />

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Text type="secondary">
          共 {filteredItems.length} 个创意
        </Text>
      </div>
    </div>
  );
};

export default CreativeList;