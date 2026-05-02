import React, { useState, useEffect } from 'react';
import { Table, Button, Input, Modal, Form, Select, Tag, Space, Popconfirm, message, Card, Tabs, Pagination } from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, CloudUploadOutlined, HistoryOutlined } from '@ant-design/icons';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBaseStore';
import type { ColumnsType } from 'antd/es/table';

const { TextArea } = Input;
const { Option } = Select;

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source: string;
  category: string[];
  tags: string[];
  relatedCharacterIds: string[];
  relatedWorldBookPaths: string[];
  version: number;
  metadata: Record<string, any>;
}

export const KnowledgeBaseManager: React.FC = () => {
  const {
    items,
    loading,
    selectedId,
    searchResults,
    isSearching,
    currentPage,
    totalPages,
    totalItems,
    fetchItems,
    createItem,
    updateItem,
    deleteItem,
    searchItems,
    vectorizeItem,
    vectorizeAll,
    selectItem
  } = useKnowledgeBaseStore();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [form] = Form.useForm();

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleCreate = () => {
    setEditingItem(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleEdit = (record: KnowledgeItem) => {
    setEditingItem(record);
    form.setFieldsValue(record);
    setIsModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const success = await deleteItem(id);
    if (success) {
      message.success('删除成功');
    } else {
      message.error('删除失败');
    }
  };

  const handleVectorize = async (id: string) => {
    const success = await vectorizeItem(id);
    if (success) {
      message.success('向量化成功');
    } else {
      message.error('向量化失败');
    }
  };

  const handleVectorizeAll = async () => {
    const count = await vectorizeAll();
    message.success(`已向量化 ${count} 个条目`);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    await searchItems(searchQuery, { topK: 10, minScore: 0.7 });
  };

  const handleSubmit = async (values: any) => {
    if (editingItem) {
      const success = await updateItem(editingItem.id, values);
      if (success) {
        message.success('更新成功');
      }
    } else {
      const now = Date.now();
      const newItem: KnowledgeItem = {
        ...values,
        id: '',
        source: values.source || 'manual',
        version: 1,
        metadata: {
          createdAt: now,
          updatedAt: now,
          createdBy: 'user'
        }
      };
      const id = await createItem(newItem);
      if (id) {
        message.success('创建成功');
      }
    }
    setIsModalVisible(false);
  };

  const columns: ColumnsType<KnowledgeItem> = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: true
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 150,
      render: (categories: string[]) => (
        <>
          {categories?.map(cat => (
            <Tag key={cat} color="blue">
              {cat}
            </Tag>
          ))}
        </>
      )
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 150,
      render: (tags: string[]) => (
        <>
          {tags?.map(tag => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </>
      )
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 80
    },
    {
      title: '操作',
      key: 'action',
      width: 250,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<CloudUploadOutlined />}
            onClick={() => handleVectorize(record.id)}
          >
            向量化
          </Button>
          <Popconfirm
            title="确认删除"
            description="确定要删除这个知识条目吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const tabItems = [
    {
      key: 'list',
      label: '知识列表',
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新建知识
              </Button>
              <Button icon={<CloudUploadOutlined />} onClick={handleVectorizeAll}>
                全部向量化
              </Button>
            </Space>
          </div>
          <Table
            columns={columns}
            dataSource={items}
            rowKey="id"
            loading={loading}
            size="small"
            pagination={false}
            scroll={{ y: 400 }}
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Pagination
              current={currentPage}
              total={totalItems}
              pageSize={20}
              onChange={(page) => fetchItems(undefined, page)}
              showSizeChanger={false}
            />
          </div>
        </>
      )
    },
    {
      key: 'search',
      label: '向量搜索',
      children: (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Input
              style={{ width: 400 }}
              placeholder="输入搜索关键词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={isSearching}>
              搜索
            </Button>
          </Space>
          <Table
            columns={[
              { title: '相关性', dataIndex: 'score', key: 'score', width: 100, render: (s: number) => `${(s * 100).toFixed(1)}%` },
              { title: '标题', dataIndex: ['metadata', 'title'], key: 'title', width: 200 },
              { title: '内容', dataIndex: ['metadata', 'text'], key: 'content', ellipsis: true },
              { title: '分类', dataIndex: ['metadata', 'category'], key: 'category', render: (cats: string[]) => cats?.map(c => <Tag key={c}>{c}</Tag>) }
            ]}
            dataSource={searchResults}
            rowKey="id"
            loading={isSearching}
            size="small"
            pagination={false}
            scroll={{ y: 400 }}
          />
        </>
      )
    }
  ];

  return (
    <Card title="知识库管理" size="small">
      <Tabs items={tabItems} />

      <Modal
        title={editingItem ? '编辑知识' : '新建知识'}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="知识条目标题" />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={8} placeholder="知识条目内容" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select mode="tags" placeholder="选择或输入分类">
              <Option value="角色信息">角色信息</Option>
              <Option value="关系">关系</Option>
              <Option value="事件">事件</Option>
              <Option value="地点">地点</Option>
              <Option value="物品">物品</Option>
              <Option value="设定">设定</Option>
            </Select>
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="选择或输入标签" />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Select>
              <Option value="manual">手动录入</Option>
              <Option value="memory_extract">记忆提取</Option>
              <Option value="import">导入</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingItem ? '更新' : '创建'}
              </Button>
              <Button onClick={() => setIsModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};
