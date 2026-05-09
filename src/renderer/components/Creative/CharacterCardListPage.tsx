import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Typography, Modal, Form, Input, Select, message, Popconfirm, Breadcrumb, Radio, Card } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, HomeOutlined, FolderOutlined, UserOutlined, FileTextOutlined, StarOutlined, BookOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';
import { getCharacterTemplates } from '../../utils/promptTemplates';

interface CharacterCardRow {
  cardId: string;
  cardName: string;
  creativeId: string;
  creativeTitle: string;
  updatedAt: number;
  createdAt: number;
}

const { Text } = Typography;

const CharacterCardListPage: React.FC = () => {
  const { theme, creativeTab, setCreativeTab, setCreativeView } = useUIStore();
  const { creatives, loadCreatives, setCurrentCreativeId, removeCharacterCard } = useCreativeStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalForm] = Form.useForm();

  useEffect(() => {
    loadCreatives();
  }, [loadCreatives]);

  const rows: CharacterCardRow[] = creatives
    .filter((c) => c.characterCard != null)
    .map((c) => ({
      cardId: c.characterCard!.id,
      cardName: c.characterCard!.name,
      creativeId: c.id,
      creativeTitle: c.title,
      updatedAt: c.characterCard!.updatedAt,
      createdAt: c.characterCard!.createdAt,
    }));

  const handleNewCard = async (values: { creativeId: string; name: string; templateId: string }) => {
    const store = useCreativeStore.getState();
    const id = store.setCharacterCard(values.creativeId, values.name);
    if (id) {
      message.success('角色卡创建成功');
      setIsModalOpen(false);
      modalForm.resetFields();
    } else {
      message.error('角色卡创建失败');
    }
  };

  const handleEdit = (record: CharacterCardRow) => {
    setCurrentCreativeId(record.creativeId);
    setCreativeTab('character');
    setCreativeView('edit');
  };

  const handleDelete = (record: CharacterCardRow) => {
    removeCharacterCard(record.creativeId);
    message.success('角色卡已删除');
  };

  const columns = [
    {
      title: '角色卡名称',
      dataIndex: 'cardName',
      key: 'cardName',
      render: (name: string) => (
        <Space>
          <UserOutlined />
          <Text strong>{name}</Text>
        </Space>
      ),
    },
    {
      title: '所属创意',
      dataIndex: 'creativeTitle',
      key: 'creativeTitle',
      render: (title: string, record: CharacterCardRow) => (
        <Space>
          <FolderOutlined />
          <Text>{title}</Text>
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      sorter: (a: CharacterCardRow, b: CharacterCardRow) => a.updatedAt - b.updatedAt,
      render: (timestamp: number) => <Text type="secondary">{new Date(timestamp).toLocaleString()}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: unknown, record: CharacterCardRow) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定要删除这个角色卡吗？" onConfirm={() => handleDelete(record)} okText="确定" cancelText="取消">
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const creativeOptions = creatives.map((c) => ({
    value: c.id,
    label: c.title,
  }));

  const templateOptions = getCharacterTemplates().map((t) => ({
    value: t.id,
    label: t.name,
    description: t.description,
  }));

  return (
    <div className={`character-card-list-page ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`} style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <><FolderOutlined /> 创意管理</> },
          { title: <><UserOutlined /> 角色卡</> },
          { title: '列表' },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Text strong style={{ fontSize: 18 }}>角色卡列表</Text>
          <Text type="secondary" style={{ marginLeft: 12 }}>共 {rows.length} 张角色卡</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)} disabled={creatives.length === 0}>
          新建角色卡
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={rows}
        rowKey="cardId"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <Modal
        title="新建角色卡"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          modalForm.resetFields();
        }}
        onOk={() => modalForm.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form form={modalForm} onFinish={handleNewCard} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="creativeId" label="所属创意" rules={[{ required: true, message: '请选择所属创意' }]}>
            <Select placeholder="请选择创意" options={creativeOptions} />
          </Form.Item>
          <Form.Item name="name" label="角色卡名称" rules={[{ required: true, message: '请输入角色卡名称' }]}>
            <Input placeholder="请输入角色卡名称" />
          </Form.Item>
          <Form.Item name="templateId" label="角色卡模板" initialValue="character_card">
            <Radio.Group>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
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
                          {option.value === 'character_card' && <FileTextOutlined style={{ marginRight: 8, color: '#1890ff' }} />}
                          {option.value === 'game_master' && <PlayCircleOutlined style={{ marginRight: 8, color: '#52c41a' }} />}
                          {option.value === 'simple_character' && <StarOutlined style={{ marginRight: 8, color: '#faad14' }} />}
                          {option.value === 'detailed_character' && <BookOutlined style={{ marginRight: 8, color: '#722ed1' }} />}
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
        </Form>
      </Modal>
    </div>
  );
};

export default CharacterCardListPage;
