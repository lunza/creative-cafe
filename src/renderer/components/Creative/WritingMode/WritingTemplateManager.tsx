import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Button, List, Tag, Space, message, Form, Input, InputNumber, Popconfirm, Empty, Spin } from 'antd';
import { PlusOutlined, EditOutlined, CopyOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import { CustomNovelTypeTemplate, CustomWritingStyleTemplate } from '../../../../shared/types/writing.types';

const { TextArea } = Input;

interface WritingTemplateManagerProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'novelType' | 'writingStyle';
  onTemplatesChanged?: () => void;
}

// 生成自定义模板 ID
function generateTemplateId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

const WritingTemplateManager: React.FC<WritingTemplateManagerProps> = ({ open, onClose, initialTab = 'novelType', onTemplatesChanged }) => {
  const [activeTab, setActiveTab] = useState<'novelType' | 'writingStyle'>(initialTab);
  const [novelTypeTemplates, setNovelTypeTemplates] = useState<CustomNovelTypeTemplate[]>([]);
  const [writingStyleTemplates, setWritingStyleTemplates] = useState<CustomWritingStyleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingNovelType, setEditingNovelType] = useState<CustomNovelTypeTemplate | null>(null);
  const [editingWritingStyle, setEditingWritingStyle] = useState<CustomWritingStyleTemplate | null>(null);
  const [editMode, setEditMode] = useState<'create' | 'edit' | 'copy'>('create');
  const [saving, setSaving] = useState(false);
  const [novelTypeForm] = Form.useForm();
  const [writingStyleForm] = Form.useForm();

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      loadTemplates();
    }
  }, [open, initialTab]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const [novelTypeResult, writingStyleResult] = await Promise.all([
        window.electronAPI?.writing?.template?.novelType?.list?.(),
        window.electronAPI?.writing?.template?.writingStyle?.list?.()
      ]);
      if (novelTypeResult?.success) {
        setNovelTypeTemplates(novelTypeResult.templates || []);
      }
      if (writingStyleResult?.success) {
        setWritingStyleTemplates(writingStyleResult.templates || []);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
      message.error('加载模板列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateNovelType = () => {
    setEditMode('create');
    setEditingNovelType(null);
    novelTypeForm.resetFields();
    novelTypeForm.setFieldsValue({
      typicalChapterLength: 3000,
      outlineStructure: ['故事背景', '人物设定', '核心冲突', '发展脉络', '章节大纲']
    });
    setEditModalOpen(true);
  };

  const handleCreateWritingStyle = () => {
    setEditMode('create');
    setEditingWritingStyle(null);
    writingStyleForm.resetFields();
    setEditModalOpen(true);
  };

  const handleEditNovelType = (template: CustomNovelTypeTemplate) => {
    setEditMode('edit');
    setEditingNovelType(template);
    novelTypeForm.setFieldsValue({
      name: template.name,
      systemPrompt: template.systemPrompt,
      outlineStructure: template.outlineStructure,
      writingStyle: template.writingStyle,
      typicalChapterLength: template.typicalChapterLength
    });
    setEditModalOpen(true);
  };

  const handleEditWritingStyle = (template: CustomWritingStyleTemplate) => {
    setEditMode('edit');
    setEditingWritingStyle(template);
    writingStyleForm.setFieldsValue({
      name: template.name,
      description: template.description
    });
    setEditModalOpen(true);
  };

  const handleCopyNovelType = (template: CustomNovelTypeTemplate) => {
    setEditMode('copy');
    setEditingNovelType(template);
    novelTypeForm.setFieldsValue({
      name: `${template.name} (副本)`,
      systemPrompt: template.systemPrompt,
      outlineStructure: template.outlineStructure,
      writingStyle: template.writingStyle,
      typicalChapterLength: template.typicalChapterLength
    });
    setEditModalOpen(true);
  };

  const handleCopyWritingStyle = (template: CustomWritingStyleTemplate) => {
    setEditMode('copy');
    setEditingWritingStyle(template);
    writingStyleForm.setFieldsValue({
      name: `${template.name} (副本)`,
      description: template.description
    });
    setEditModalOpen(true);
  };

  const handleDeleteNovelType = async (template: CustomNovelTypeTemplate) => {
    try {
      const result = await window.electronAPI?.writing?.template?.novelType?.delete?.(template.id);
      if (result?.success) {
        message.success('已删除');
        loadTemplates();
        onTemplatesChanged?.();
      } else {
        message.error(result?.error || '删除失败');
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleDeleteWritingStyle = async (template: CustomWritingStyleTemplate) => {
    try {
      const result = await window.electronAPI?.writing?.template?.writingStyle?.delete?.(template.id);
      if (result?.success) {
        message.success('已删除');
        loadTemplates();
        onTemplatesChanged?.();
      } else {
        message.error(result?.error || '删除失败');
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleSaveNovelType = async () => {
    try {
      const values = await novelTypeForm.validateFields();
      setSaving(true);

      // 解析 outlineStructure（可能是数组或换行分隔的字符串）
      let outlineStructure = values.outlineStructure;
      if (typeof outlineStructure === 'string') {
        outlineStructure = outlineStructure.split('\n').map((s: string) => s.trim()).filter(Boolean);
      }

      const now = Date.now();
      const template: CustomNovelTypeTemplate = {
        id: editMode === 'edit' && editingNovelType ? editingNovelType.id : generateTemplateId(),
        name: values.name,
        systemPrompt: values.systemPrompt,
        outlineStructure,
        writingStyle: values.writingStyle,
        typicalChapterLength: values.typicalChapterLength,
        isPreset: false,
        baseType: editMode === 'copy' && editingNovelType ? (editingNovelType as any).baseType || (editingNovelType.isPreset ? (editingNovelType.id as any) : undefined) : (editMode === 'edit' ? editingNovelType?.baseType : undefined),
        createdAt: editMode === 'edit' && editingNovelType ? editingNovelType.createdAt : now,
        updatedAt: now
      };

      const result = await window.electronAPI?.writing?.template?.novelType?.save?.(template);
      if (result?.success) {
        message.success(editMode === 'edit' ? '已更新' : '已创建');
        setEditModalOpen(false);
        loadTemplates();
        onTemplatesChanged?.();
      } else {
        message.error(result?.error || '保存失败');
      }
    } catch (error: any) {
      if (error?.errorFields) return; // 表单验证错误
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWritingStyle = async () => {
    try {
      const values = await writingStyleForm.validateFields();
      setSaving(true);

      const now = Date.now();
      const template: CustomWritingStyleTemplate = {
        id: editMode === 'edit' && editingWritingStyle ? editingWritingStyle.id : generateTemplateId(),
        name: values.name,
        description: values.description,
        isPreset: false,
        baseStyle: editMode === 'copy' && editingWritingStyle ? (editingWritingStyle as any).baseStyle || (editingWritingStyle.isPreset ? (editingWritingStyle.id as any) : undefined) : (editMode === 'edit' ? editingWritingStyle?.baseStyle : undefined),
        createdAt: editMode === 'edit' && editingWritingStyle ? editingWritingStyle.createdAt : now,
        updatedAt: now
      };

      const result = await window.electronAPI?.writing?.template?.writingStyle?.save?.(template);
      if (result?.success) {
        message.success(editMode === 'edit' ? '已更新' : '已创建');
        setEditModalOpen(false);
        loadTemplates();
        onTemplatesChanged?.();
      } else {
        message.error(result?.error || '保存失败');
      }
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const isEditingNovelType = activeTab === 'novelType';

  return (
    <>
      <Modal
        title="模板管理"
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
        width={800}
      >
        <Spin spinning={loading}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'novelType' | 'writingStyle')}
            items={[
              {
                key: 'novelType',
                label: '小说类型',
                children: (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateNovelType}>
                        新建类型
                      </Button>
                    </div>
                    <List
                      dataSource={novelTypeTemplates}
                      locale={{ emptyText: <Empty description="暂无模板" /> }}
                      renderItem={(template) => (
                        <List.Item
                          actions={[
                            !template.isPreset && (
                              <Button key="edit" type="link" icon={<EditOutlined />} onClick={() => handleEditNovelType(template)}>
                                编辑
                              </Button>
                            ),
                            <Button key="copy" type="link" icon={<CopyOutlined />} onClick={() => handleCopyNovelType(template)}>
                              复制
                            </Button>,
                            !template.isPreset && (
                              <Popconfirm
                                key="delete"
                                title="确认删除"
                                description={`确定要删除"${template.name}"吗？`}
                                onConfirm={() => handleDeleteNovelType(template)}
                                okText="删除"
                                cancelText="取消"
                              >
                                <Button type="link" danger icon={<DeleteOutlined />}>
                                  删除
                                </Button>
                              </Popconfirm>
                            )
                          ].filter(Boolean)}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <span>{template.name}</span>
                                {template.isPreset && <Tag color="blue">预置</Tag>}
                                {!template.isPreset && <Tag color="green">自定义</Tag>}
                              </Space>
                            }
                            description={
                              <span style={{ color: '#999', fontSize: 12 }}>
                                {template.writingStyle} · 典型章长 {template.typicalChapterLength} 字
                              </span>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </>
                )
              },
              {
                key: 'writingStyle',
                label: '写作风格',
                children: (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateWritingStyle}>
                        新建风格
                      </Button>
                    </div>
                    <List
                      dataSource={writingStyleTemplates}
                      locale={{ emptyText: <Empty description="暂无模板" /> }}
                      renderItem={(template) => (
                        <List.Item
                          actions={[
                            !template.isPreset && (
                              <Button key="edit" type="link" icon={<EditOutlined />} onClick={() => handleEditWritingStyle(template)}>
                                编辑
                              </Button>
                            ),
                            <Button key="copy" type="link" icon={<CopyOutlined />} onClick={() => handleCopyWritingStyle(template)}>
                              复制
                            </Button>,
                            !template.isPreset && (
                              <Popconfirm
                                key="delete"
                                title="确认删除"
                                description={`确定要删除"${template.name}"吗？`}
                                onConfirm={() => handleDeleteWritingStyle(template)}
                                okText="删除"
                                cancelText="取消"
                              >
                                <Button type="link" danger icon={<DeleteOutlined />}>
                                  删除
                                </Button>
                              </Popconfirm>
                            )
                          ].filter(Boolean)}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <span>{template.name}</span>
                                {template.isPreset && <Tag color="blue">预置</Tag>}
                                {!template.isPreset && <Tag color="green">自定义</Tag>}
                              </Space>
                            }
                            description={
                              <span style={{ color: '#999', fontSize: 12 }}>
                                {template.description.substring(0, 60)}...
                              </span>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </>
                )
              }
            ]}
          />
        </Spin>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={isEditingNovelType
          ? (editMode === 'edit' ? '编辑小说类型' : editMode === 'copy' ? '复制小说类型' : '新建小说类型')
          : (editMode === 'edit' ? '编辑写作风格' : editMode === 'copy' ? '复制写作风格' : '新建写作风格')
        }
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={isEditingNovelType ? handleSaveNovelType : handleSaveWritingStyle}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={700}
        destroyOnClose
      >
        {isEditingNovelType ? (
          <Form form={novelTypeForm} layout="vertical" preserve={false}>
            <Form.Item
              label="类型名称"
              name="name"
              rules={[{ required: true, message: '请输入类型名称' }]}
            >
              <Input placeholder="如：赛博朋克、末日生存、无限流" />
            </Form.Item>
            <Form.Item
              label="系统提示词"
              name="systemPrompt"
              rules={[{ required: true, message: '请输入系统提示词' }]}
              extra="定义该类型的核心创作特征、叙事结构、人物塑造方式等"
            >
              <TextArea rows={8} placeholder="详细描述该小说类型的创作指导..." showCount />
            </Form.Item>
            <Form.Item
              label="大纲结构"
              name="outlineStructure"
              rules={[{ required: true, message: '请输入大纲结构' }]}
              extra="每行一个结构要素，如：故事背景、主角设定、主线剧情等"
            >
              <TextArea rows={4} placeholder="每行一个结构要素" />
            </Form.Item>
            <Form.Item
              label="写作风格描述"
              name="writingStyle"
              rules={[{ required: true, message: '请输入写作风格描述' }]}
            >
              <Input placeholder="如：节奏明快，每章结尾设置悬念..." />
            </Form.Item>
            <Form.Item
              label="典型章节字数"
              name="typicalChapterLength"
              rules={[{ required: true, message: '请输入典型章节字数' }]}
            >
              <InputNumber min={500} max={20000} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        ) : (
          <Form form={writingStyleForm} layout="vertical" preserve={false}>
            <Form.Item
              label="风格名称"
              name="name"
              rules={[{ required: true, message: '请输入风格名称' }]}
            >
              <Input placeholder="如：简洁明快、细腻抒情、幽默讽刺" />
            </Form.Item>
            <Form.Item
              label="风格详细描述"
              name="description"
              rules={[{ required: true, message: '请输入风格描述' }]}
              extra="详细描述该写作风格的语言特色、节奏控制、情感渲染等特征"
            >
              <TextArea rows={10} placeholder="详细描述该写作风格的特征..." showCount />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </>
  );
};

export default WritingTemplateManager;
