import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Typography, Breadcrumb, Popconfirm, message, Radio, Card } from 'antd';
import { BookOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CloudServerOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCreativeStore, type WorldBook } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';
import { getWorldbookTemplates } from '../../utils/promptTemplates';

const { Title, Text } = Typography;

interface WorldBookListRecord {
  key: string;
  worldBook: WorldBook;
  creativeId: string;
  creativeTitle: string;
}

const WorldBookListPage: React.FC = () => {
  const { creatives, loadCreatives, setWorldBook, updateWorldBook, removeWorldBook, setCurrentCreativeId } = useCreativeStore();
  const { theme, setCreativeTab, setCreativeView } = useUIStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [editingWorldBook, setEditingWorldBook] = useState<{ creativeId: string; worldBook: WorldBook } | null>(null);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    loadCreatives();
  }, []);

  const worldBookList: WorldBookListRecord[] = creatives
    .filter(c => c.worldBook)
    .map(c => ({
      key: c.worldBook!.id,
      worldBook: c.worldBook!,
      creativeId: c.id,
      creativeTitle: c.title,
    }));

  const handleNew = () => {
    setEditingWorldBook(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const handleEdit = (record: WorldBookListRecord) => {
    setEditingWorldBook({ creativeId: record.creativeId, worldBook: record.worldBook });
    form.setFieldsValue({ creativeId: record.creativeId, name: record.worldBook.name });
    setIsModalOpen(true);
  };

  const handleDelete = (creativeId: string) => {
    removeWorldBook(creativeId);
    message.success('世界书已删除');
  };

  const handleModalOk = async () => {
    const values = await form.validateFields();
    if (editingWorldBook) {
      updateWorldBook(editingWorldBook.creativeId, { name: values.name });
      message.success('世界书已更新');
    } else {
      setWorldBook(values.creativeId, values.name);
      message.success('世界书已创建');
    }
    setIsModalOpen(false);
    form.resetFields();
  };

  const handleEditInEditor = (record: WorldBookListRecord) => {
    setCurrentCreativeId(record.creativeId);
    setCreativeTab('worldbook');
    setCreativeView('edit');
  };

  const columns: ColumnsType<WorldBookListRecord> = [
    {
      title: '世界书名称',
      dataIndex: 'worldBook',
      key: 'name',
      render: (wb: WorldBook) => <Text strong>{wb.name}</Text>,
    },
    {
      title: '所属创意',
      dataIndex: 'creativeTitle',
      key: 'creativeTitle',
    },
    {
      title: '更新时间',
      dataIndex: 'worldBook',
      key: 'updatedAt',
      render: (wb: WorldBook) => new Date(wb.updatedAt).toLocaleString(),
      sorter: (a, b) => a.worldBook.updatedAt - b.worldBook.updatedAt,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditInEditor(record)}>
            编辑
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            改名
          </Button>
          <Popconfirm title="确定删除此世界书？" onConfirm={() => handleDelete(record.creativeId)} okText="确定" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const creativeOptions = creatives.map(c => ({ label: c.title, value: c.id }));

  const templateOptions = getWorldbookTemplates().map((t) => ({
    value: t.id,
    label: t.name,
    description: t.description,
  }));

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: '创意管理' },
          { title: '世界书' },
          { title: '列表' },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BookOutlined style={{ marginRight: 8 }} />
          世界书列表
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
          新建世界书
        </Button>
      </div>

      <div className="table-container">
        <Table
          columns={columns}
          dataSource={worldBookList}
          rowKey="key"
          bordered
          locale={{ emptyText: '暂无世界书，请先在创意中创建世界书' }}
          pagination={{
            pageSize,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            className: 'table-pagination-wrapper',
            onChange: (page, size) => { setPageSize(size); },
          }}
        />
      </div>

      <Modal
        title={editingWorldBook ? '编辑世界书' : '新建世界书'}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => { setIsModalOpen(false); form.resetFields(); }}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="creativeId"
            label="所属创意"
            rules={[{ required: true, message: '请选择所属创意' }]}
          >
            <Select
              placeholder="选择创意"
              options={creativeOptions}
              disabled={!!editingWorldBook}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="世界书名称"
            rules={[{ required: true, message: '请输入世界书名称' }]}
          >
            <Input placeholder="输入世界书名称" />
          </Form.Item>
          {!editingWorldBook && (
            <Form.Item name="templateId" label="世界书模板" initialValue="worldbook">
              <Radio.Group>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  {templateOptions.map((option) => (
                    <Card
                      key={option.value}
                      hoverable
                      className="template-select-card"
                      style={{ cursor: 'pointer', borderWidth: 2 }}
                    >
                      <Radio value={option.value}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                            {option.value === 'worldbook' && <CloudServerOutlined style={{ marginRight: 8, color: '#1890ff' }} />}
                            <Typography.Text strong>{option.label}</Typography.Text>
                          </div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {option.description}
                          </Typography.Text>
                        </div>
                      </Radio>
                    </Card>
                  ))}
                </div>
              </Radio.Group>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default WorldBookListPage;
