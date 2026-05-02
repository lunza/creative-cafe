import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Tag, Modal, Form, Select, Space, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { useLogStore } from '../../stores/logStore';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagAssociation {
  tagId: string;
  entryUid: string | number;
}

interface TagData {
  tags: Tag[];
  associations: TagAssociation[];
}

interface WorldBookEntry {
  uid: string | number;
  comment?: string;
  key?: string[];
  content?: string;
}

interface TagManagerProps {
  worldBookPath: string;
  worldBookEntries?: Record<string, any>;
  onTagsChanged: () => void;
}

const TagManager: React.FC<TagManagerProps> = ({ worldBookPath, worldBookEntries, onTagsChanged }) => {
  const { addLog } = useLogStore();
  const [tags, setTags] = useState<Tag[]>([]);
  const [associations, setAssociations] = useState<TagAssociation[]>([]);
  const [isAddTagModalOpen, setIsAddTagModalOpen] = useState(false);
  const [isEditTagModalOpen, setIsEditTagModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [form] = Form.useForm();
  
  // 标签颜色选项
  const tagColors = [
    'blue', 'green', 'orange', 'red', 'purple', 'cyan', 'geekblue', 'magenta', 'volcano', 'gold', 'lime'
  ];

  // 加载标签数据
  const loadTags = async () => {
    try {
      const tagData = await window.electronAPI.worldBook.readTags(worldBookPath);
      if (tagData) {
        setTags(tagData.tags || []);
        setAssociations(tagData.associations || []);
      }
    } catch (error) {
      addLog(`[TagManager] 加载标签数据失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  // 保存标签数据
  const saveTags = async () => {
    try {
      const tagData: TagData = {
        tags,
        associations
      };
      await window.electronAPI.worldBook.writeTags(worldBookPath, tagData);
      addLog('[TagManager] 标签数据保存成功', 'info');
      onTagsChanged();
    } catch (error) {
      addLog(`[TagManager] 保存标签数据失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error('保存标签失败');
    }
  };

  // 添加标签
  const handleAddTag = async (values: { name: string; color: string }) => {
    const newTag: Tag = {
      id: Date.now().toString(),
      name: values.name,
      color: values.color
    };
    setTags([...tags, newTag]);
    setIsAddTagModalOpen(false);
    form.resetFields();
    await saveTags();
    message.success('标签添加成功');
  };

  // 编辑标签
  const handleEditTag = async (values: { name: string; color: string }) => {
    if (editingTag) {
      const updatedTags = tags.map(tag => 
        tag.id === editingTag.id 
          ? { ...tag, name: values.name, color: values.color }
          : tag
      );
      setTags(updatedTags);
      setIsEditTagModalOpen(false);
      setEditingTag(null);
      form.resetFields();
      await saveTags();
      message.success('标签编辑成功');
    }
  };

  // 删除标签
  const handleDeleteTag = async (tagId: string) => {
    // 删除标签和相关关联
    const updatedTags = tags.filter(tag => tag.id !== tagId);
    const updatedAssociations = associations.filter(assoc => assoc.tagId !== tagId);
    setTags(updatedTags);
    setAssociations(updatedAssociations);
    await saveTags();
    message.success('标签删除成功');
  };

  // 为条目添加标签
  const addTagToEntry = async (entryUid: string | number, tagId: string) => {
    // 检查是否已存在关联
    const existingAssociation = associations.find(
      assoc => assoc.entryUid === entryUid && assoc.tagId === tagId
    );
    if (!existingAssociation) {
      const newAssociation: TagAssociation = {
        tagId,
        entryUid
      };
      setAssociations([...associations, newAssociation]);
      await saveTags();
    }
  };

  // 从条目移除标签
  const removeTagFromEntry = async (entryUid: string | number, tagId: string) => {
    const updatedAssociations = associations.filter(
      assoc => !(assoc.entryUid === entryUid && assoc.tagId === tagId)
    );
    setAssociations(updatedAssociations);
    await saveTags();
  };

  // 获取条目的标签
  const getEntryTags = (entryUid: string | number) => {
    const entryTagIds = associations
      .filter(assoc => assoc.entryUid === entryUid)
      .map(assoc => assoc.tagId);
    return tags.filter(tag => entryTagIds.includes(tag.id));
  };

  // 初始化加载标签
  useEffect(() => {
    if (worldBookPath) {
      loadTags();
    }
  }, [worldBookPath]);

  return (
    <div>
      {/* 标签管理界面 */}
      <Card title="标签管理" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3>现有标签</h3>
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={() => setIsAddTagModalOpen(true)}
          >
            添加标签
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {tags.map(tag => (
            <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag color={tag.color}>{tag.name}</Tag>
              <Button 
                type="link" 
                icon={<EditOutlined />}
                onClick={() => {
                  setEditingTag(tag);
                  form.setFieldsValue({ name: tag.name, color: tag.color });
                  setIsEditTagModalOpen(true);
                }}
              />
              <Button 
                type="link" 
                danger 
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteTag(tag.id)}
              />
            </div>
          ))}
          {tags.length === 0 && (
            <div style={{ color: '#666' }}>暂无标签，请添加标签</div>
          )}
        </div>
      </Card>

      {/* 条目标签分配 */}
      {worldBookEntries && Object.keys(worldBookEntries).length > 0 && (
        <Card title="条目标签分配" style={{ marginBottom: 16 }}>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {Object.values(worldBookEntries).map((entry: any, index: number) => {
              const uid = entry.uid || index;
              const entryTags = getEntryTags(uid);
              
              return (
                <Card key={uid} size="small" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                        条目 {uid}: {entry.comment || '无注释'}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        {entryTags.length > 0 ? (
                          entryTags.map(tag => (
                            <Tag 
                              key={tag.id} 
                              color={tag.color}
                              closable
                              onClose={() => removeTagFromEntry(uid, tag.id)}
                            >
                              {tag.name}
                            </Tag>
                          ))
                        ) : (
                          <Tag color="default">无标签</Tag>
                        )}
                      </div>
                      <Select
                        mode="multiple"
                        placeholder="添加标签..."
                        style={{ width: '100%' }}
                        value={entryTags.map(tag => tag.id)}
                        onChange={(selectedTagIds) => {
                          // 计算需要添加和删除的标签
                          const currentTagIds = entryTags.map(tag => tag.id);
                          const tagsToAdd = selectedTagIds.filter(id => !currentTagIds.includes(id));
                          const tagsToRemove = currentTagIds.filter(id => !selectedTagIds.includes(id));
                          
                          // 添加新标签
                          tagsToAdd.forEach(tagId => addTagToEntry(uid, tagId));
                          // 移除标签
                          tagsToRemove.forEach(tagId => removeTagFromEntry(uid, tagId));
                        }}
                        options={tags.map(tag => ({
                          value: tag.id,
                          label: (
                            <span>
                              <Tag color={tag.color} style={{ marginRight: 4 }}>{tag.name}</Tag>
                            </span>
                          )
                        }))}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </Card>
      )}

      {/* 添加标签模态框 */}
      <Modal
        title="添加标签"
        open={isAddTagModalOpen}
        onCancel={() => setIsAddTagModalOpen(false)}
        footer={null}
      >
        <Form form={form} onFinish={handleAddTag}>
          <Form.Item
            name="name"
            label="标签名称"
            rules={[{ required: true, message: '请输入标签名称' }]}
          >
            <Input placeholder="请输入标签名称" />
          </Form.Item>
          <Form.Item
            name="color"
            label="标签颜色"
            rules={[{ required: true, message: '请选择标签颜色' }]}
          >
            <Select placeholder="请选择标签颜色">
              {tagColors.map(color => (
                <Select.Option key={color} value={color}>
                  <Tag color={color}>{color}</Tag>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setIsAddTagModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑标签模态框 */}
      <Modal
        title="编辑标签"
        open={isEditTagModalOpen}
        onCancel={() => setIsEditTagModalOpen(false)}
        footer={null}
      >
        <Form form={form} onFinish={handleEditTag}>
          <Form.Item
            name="name"
            label="标签名称"
            rules={[{ required: true, message: '请输入标签名称' }]}
          >
            <Input placeholder="请输入标签名称" />
          </Form.Item>
          <Form.Item
            name="color"
            label="标签颜色"
            rules={[{ required: true, message: '请选择标签颜色' }]}
          >
            <Select placeholder="请选择标签颜色">
              {tagColors.map(color => (
                <Select.Option key={color} value={color}>
                  <Tag color={color}>{color}</Tag>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setIsEditTagModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TagManager;
export type { Tag, TagAssociation, TagData };
export { TagManager };
