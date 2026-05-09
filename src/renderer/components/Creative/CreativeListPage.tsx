import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Typography, message, Popconfirm, Modal, Form, Input, Breadcrumb } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  HomeOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';
import type { CreativeTabType } from '../../stores/uiStore';

const { Title, Text } = Typography;

const CreativeListPage: React.FC = () => {
  const {
    creatives,
    loadCreatives,
    addCreative,
    updateCreative,
    deleteCreative,
    setCurrentCreativeId
  } = useCreativeStore();

  const { theme, setCreativeTab, setCreativeView } = useUIStore();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renamingCreativeId, setRenamingCreativeId] = useState<string | null>(null);

  useEffect(() => {
    loadCreatives();
  }, [loadCreatives]);

  const handleCreate = (values: { title: string; description: string }) => {
    addCreative(values.title, values.description);
    setCreateModalVisible(false);
    form.resetFields();
    message.success('创意创建成功！');
  };

  const handleEdit = (record: any) => {
    setCurrentCreativeId(record.id);
    setCreativeTab('creative' as CreativeTabType);
    setCreativeView('edit');
  };

  const handleDelete = (id: string) => {
    if (deleteCreative(id)) {
      message.success('创意已删除！');
    } else {
      message.error('删除创意失败！');
    }
  };

  const handleRename = (record: any) => {
    setRenamingCreativeId(record.id);
    form.setFieldsValue({
      title: record.title,
      description: record.description
    });
    setRenameModalVisible(true);
  };

  const handleRenameOk = (values: { title: string; description: string }) => {
    if (renamingCreativeId) {
      updateCreative(renamingCreativeId, {
        title: values.title,
        description: values.description
      });
      setRenameModalVisible(false);
      setRenamingCreativeId(null);
      form.resetFields();
      message.success('创意更新成功！');
    }
  };

  const handleCreateModalCancel = () => {
    setCreateModalVisible(false);
    form.resetFields();
  };

  const handleRenameModalCancel = () => {
    setRenameModalVisible(false);
    setRenamingCreativeId(null);
    form.resetFields();
  };

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (title: string) => (
        <Text strong style={{ color: theme === 'dark' ? '#40a9ff' : '#1890ff' }}>
          {title}
        </Text>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (description: string) => (
        <Text type="secondary">{description || '-'}</Text>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 200,
      render: (timestamp: number) => (
        <Text type="secondary">{new Date(timestamp).toLocaleString()}</Text>
      )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 200,
      render: (timestamp: number) => (
        <Text type="secondary">{new Date(timestamp).toLocaleString()}</Text>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑内容
          </Button>
          <Button
            type="link"
            onClick={() => handleRename(record)}
          >
            改名
          </Button>
          <Popconfirm
            title="确定要删除这个创意吗？"
            onConfirm={() => handleDelete(record.id)}
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

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          {
            href: '#',
            title: <><HomeOutlined /> 创意管理</>
          },
          {
            title: '创意'
          },
          {
            title: <><UnorderedListOutlined /> 列表</>
          }
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>创意列表</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          新建创意
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={creatives}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50']
        }}
      />

      <Modal
        title="新建创意"
        open={createModalVisible}
        onCancel={handleCreateModalCancel}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder="请输入创意标题" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea
              placeholder="请输入创意描述（可选）"
              rows={4}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑创意信息"
        open={renameModalVisible}
        onCancel={handleRenameModalCancel}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleRenameOk}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder="请输入创意标题" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea
              placeholder="请输入创意描述（可选）"
              rows={4}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CreativeListPage;
