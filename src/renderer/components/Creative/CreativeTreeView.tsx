import React, { useState } from 'react';
import { Tree, Button, Space, Dropdown, Modal, Input, Form, message } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOutlined,
  UserOutlined,
  BookOutlined,
  MoreOutlined
} from '@ant-design/icons';
import type { DataNode, TreeProps } from 'antd/es/tree';
import { useCreativeStore } from '../../stores/creativeStore';

interface CreativeTreeViewProps {
}

const CreativeTreeView: React.FC<CreativeTreeViewProps> = () => {
  const {
    creatives,
    currentCreativeId,
    currentEditorTarget,
    addCreative,
    setCurrentCreativeId,
    setCurrentEditorTarget,
    setCharacterCard,
    setWorldBook,
    deleteCreative,
    removeCharacterCard,
    removeWorldBook
  } = useCreativeStore();

  const [isAddCreativeModalOpen, setIsAddCreativeModalOpen] = useState(false);
  const [isAddCharacterModalOpen, setIsAddCharacterModalOpen] = useState(false);
  const [isAddWorldBookModalOpen, setIsAddWorldBookModalOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string[]>([]);
  const [creativeForm] = Form.useForm();
  const [characterForm] = Form.useForm();
  const [worldbookForm] = Form.useForm();

  const buildTreeData = (): DataNode[] => {
    return creatives.map(creative => {
      const children: DataNode[] = [];

      if (creative.characterCard) {
        children.push({
          key: `character-${creative.id}`,
          title: `角色卡: ${creative.characterCard.name}`,
          icon: <UserOutlined />
        });
      }

      if (creative.worldBook) {
        children.push({
          key: `worldbook-${creative.id}`,
          title: `世界书: ${creative.worldBook.name}`,
          icon: <BookOutlined />
        });
      }

      return {
        key: `creative-${creative.id}`,
        title: creative.title,
        icon: <FolderOutlined />,
        children: children.length > 0 ? children : undefined
      };
    });
  };

  const handleSelect: TreeProps['onSelect'] = (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const key = String(selectedKeys[0]);
      setSelectedKey([key]);

      if (key.startsWith('creative-')) {
        const creativeId = key.replace('creative-', '');
        setCurrentCreativeId(creativeId);
        setCurrentEditorTarget(null);
      } else if (key.startsWith('character-')) {
        const creativeId = key.replace('character-', '');
        setCurrentCreativeId(creativeId);
        setCurrentEditorTarget('character');
      } else if (key.startsWith('worldbook-')) {
        const creativeId = key.replace('worldbook-', '');
        setCurrentCreativeId(creativeId);
        setCurrentEditorTarget('worldbook');
      }
    }
  };

  const handleDeleteCreative = (creativeId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个创意吗？所有关联的角色卡和世界书也将被删除。',
      onOk: () => {
        deleteCreative(creativeId);
        message.success('创意已删除');
      }
    });
  };

  const handleDeleteCharacter = (creativeId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个角色卡吗？',
      onOk: () => {
        removeCharacterCard(creativeId);
        message.success('角色卡已删除');
      }
    });
  };

  const handleDeleteWorldBook = (creativeId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个世界书吗？',
      onOk: () => {
        removeWorldBook(creativeId);
        message.success('世界书已删除');
      }
    });
  };

  const renderTreeNode = (node: DataNode) => {
    let menuItems = [];
    const nodeKey = String(node.key);

    if (nodeKey.startsWith('creative-')) {
      const creativeId = nodeKey.replace('creative-', '');
      menuItems = [
        {
          key: 'add-character',
          icon: <UserOutlined />,
          label: '创建/编辑角色卡',
          onClick: () => {
            setCurrentCreativeId(creativeId);
            setIsAddCharacterModalOpen(true);
          }
        },
        {
          key: 'add-worldbook',
          icon: <BookOutlined />,
          label: '创建/编辑世界书',
          onClick: () => {
            setCurrentCreativeId(creativeId);
            setIsAddWorldBookModalOpen(true);
          }
        },
        { type: 'divider' as const },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: '删除',
          onClick: () => handleDeleteCreative(creativeId),
          danger: true
        }
      ];
    } else if (nodeKey.startsWith('character-')) {
      const creativeId = nodeKey.replace('character-', '');
      menuItems = [
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: '删除',
          onClick: () => handleDeleteCharacter(creativeId),
          danger: true
        }
      ];
    } else if (nodeKey.startsWith('worldbook-')) {
      const creativeId = nodeKey.replace('worldbook-', '');
      menuItems = [
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          label: '删除',
          onClick: () => handleDeleteWorldBook(creativeId),
          danger: true
        }
      ];
    }

    return (
      <Space>
        <span>{node.title}</span>
        {menuItems.length > 0 && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button type="text" icon={<MoreOutlined />} size="small" />
          </Dropdown>
        )}
      </Space>
    );
  };

  const handleAddCreative = async (values: { title: string; description: string }) => {
    addCreative(values.title, values.description);
    setIsAddCreativeModalOpen(false);
    creativeForm.resetFields();
    message.success('创意创建成功');
  };

  const handleAddCharacter = async (values: { name: string }) => {
    if (!currentCreativeId) {
      message.error('请先选择一个创意');
      return;
    }
    setCharacterCard(currentCreativeId, values.name);
    setIsAddCharacterModalOpen(false);
    characterForm.resetFields();
    message.success('角色卡创建成功');
  };

  const handleAddWorldBook = async (values: { name: string }) => {
    if (!currentCreativeId) {
      message.error('请先选择一个创意');
      return;
    }
    setWorldBook(currentCreativeId, values.name);
    setIsAddWorldBookModalOpen(false);
    worldbookForm.resetFields();
    message.success('世界书创建成功');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsAddCreativeModalOpen(true)}
          style={{ width: '100%' }}
        >
          新建创意
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <Tree
          showIcon
          defaultExpandAll
          onSelect={handleSelect}
          selectedKeys={selectedKey}
          treeData={buildTreeData()}
          titleRender={renderTreeNode}
        />
      </div>

      <Modal
        title="新建创意"
        open={isAddCreativeModalOpen}
        onCancel={() => {
          setIsAddCreativeModalOpen(false);
          creativeForm.resetFields();
        }}
        onOk={() => creativeForm.submit()}
      >
        <Form form={creativeForm} onFinish={handleAddCreative} layout="vertical">
          <Form.Item
            name="title"
            label="创意名称"
            rules={[{ required: true, message: '请输入创意名称' }]}
          >
            <Input placeholder="请输入创意名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入创意描述" rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建/编辑角色卡"
        open={isAddCharacterModalOpen}
        onCancel={() => {
          setIsAddCharacterModalOpen(false);
          characterForm.resetFields();
        }}
        onOk={() => characterForm.submit()}
      >
        <Form form={characterForm} onFinish={handleAddCharacter} layout="vertical">
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="请输入角色名称" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建/编辑世界书"
        open={isAddWorldBookModalOpen}
        onCancel={() => {
          setIsAddWorldBookModalOpen(false);
          worldbookForm.resetFields();
        }}
        onOk={() => worldbookForm.submit()}
      >
        <Form form={worldbookForm} onFinish={handleAddWorldBook} layout="vertical">
          <Form.Item
            name="name"
            label="世界书名称"
            rules={[{ required: true, message: '请输入世界书名称' }]}
          >
            <Input placeholder="请输入世界书名称" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CreativeTreeView;