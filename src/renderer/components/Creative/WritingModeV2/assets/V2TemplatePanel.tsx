import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tabs,
  Tag,
  theme,
  message,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import type {
  CustomNovelTypeTemplate,
  CustomWritingStyleTemplate,
} from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';

/**
 * V2 模板管理面板（Phase 3 / P2 扩展能力）
 *
 * 两个子页：小说类型模板 / 写作风格模板。
 * 预置模板只读（isPreset=true 不可编辑/删除，主进程亦会拒绝）；自定义模板可新建/编辑/删除。
 * 复用 writing:template:* 通道（writingV2.templates 类型化封装）。
 */
const V2TemplatePanel: React.FC = () => {
  const { token } = theme.useToken();
  const [tab, setTab] = useState<'novelType' | 'writingStyle'>('novelType');
  const [novelTypes, setNovelTypes] = useState<CustomNovelTypeTemplate[]>([]);
  const [styles, setStyles] = useState<CustomWritingStyleTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // 编辑态（null = 关闭；editing=null 时创建新模板）
  const [editNovel, setEditNovel] = useState<{ template: CustomNovelTypeTemplate | null } | null>(null);
  const [editStyle, setEditStyle] = useState<{ template: CustomWritingStyleTemplate | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [novelForm] = Form.useForm();
  const [styleForm] = Form.useForm();

  const api = getWritingV2API();

  const reload = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [ntRes, wsRes] = await Promise.all([
        api.templates.novelTypeList(),
        api.templates.writingStyleList(),
      ]);
      setNovelTypes(ntRes.success ? ntRes.templates : []);
      setStyles(wsRes.success ? wsRes.templates : []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ---------- 小说类型模板 ----------
  const openNovelEdit = (template: CustomNovelTypeTemplate | null) => {
    setEditNovel({ template });
    if (template) {
      novelForm.setFieldsValue({
        name: template.name,
        systemPrompt: template.systemPrompt,
        outlineStructure: (template.outlineStructure ?? []).join('\n'),
        writingStyle: template.writingStyle,
        typicalChapterLength: template.typicalChapterLength,
      });
    } else {
      novelForm.resetFields();
    }
  };

  const saveNovel = async () => {
    if (!api) return;
    const values = await novelForm.validateFields();
    const existing = editNovel?.template ?? null;
    const payload: CustomNovelTypeTemplate = {
      id: existing?.id || `custom_nt_${Date.now()}`,
      name: values.name,
      systemPrompt: values.systemPrompt,
      outlineStructure: (values.outlineStructure ?? '')
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean),
      writingStyle: values.writingStyle ?? '',
      typicalChapterLength: values.typicalChapterLength ?? 3000,
      isPreset: false,
      baseType: existing?.baseType,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    setSaving(true);
    try {
      const res = await api.templates.novelTypeSave(payload);
      if (res.success) {
        message.success('小说类型模板已保存');
        setEditNovel(null);
        reload();
      } else {
        message.error(res.error || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteNovel = async (id: string) => {
    if (!api) return;
    const res = await api.templates.novelTypeDelete(id);
    if (res.success) {
      message.success('模板已删除');
      reload();
    } else {
      message.error(res.error || '删除失败（预置模板不可删除）');
    }
  };

  // ---------- 写作风格模板 ----------
  const openStyleEdit = (template: CustomWritingStyleTemplate | null) => {
    setEditStyle({ template });
    if (template) {
      styleForm.setFieldsValue({ name: template.name, description: template.description });
    } else {
      styleForm.resetFields();
    }
  };

  const saveStyle = async () => {
    if (!api) return;
    const values = await styleForm.validateFields();
    const existing = editStyle?.template ?? null;
    const payload: CustomWritingStyleTemplate = {
      id: existing?.id || `custom_ws_${Date.now()}`,
      name: values.name,
      description: values.description,
      isPreset: false,
      baseStyle: existing?.baseStyle,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    setSaving(true);
    try {
      const res = await api.templates.writingStyleSave(payload);
      if (res.success) {
        message.success('写作风格模板已保存');
        setEditStyle(null);
        reload();
      } else {
        message.error(res.error || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteStyle = async (id: string) => {
    if (!api) return;
    const res = await api.templates.writingStyleDelete(id);
    if (res.success) {
      message.success('模板已删除');
      reload();
    } else {
      message.error(res.error || '删除失败（预置模板不可删除）');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载模板…" />
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', height: '100%' }}>
      <Space size={8}>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => (tab === 'novelType' ? openNovelEdit(null) : openStyleEdit(null))}
        >
          新建模板
        </Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          预置模板只读；自定义模板用于新建项目向导的类型/风格选项
        </span>
      </Space>

      <Tabs
        size="small"
        activeKey={tab}
        onChange={(k) => setTab(k as typeof tab)}
        items={[
          {
            key: 'novelType',
            label: `小说类型（${novelTypes.length}）`,
            children: (
              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                <List
                  size="small"
                  bordered
                  dataSource={novelTypes}
                  renderItem={(t) => (
                    <List.Item
                      actions={[
                        !t.isPreset && (
                          <Button
                            key="edit"
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openNovelEdit(t)}
                          >
                            编辑
                          </Button>
                        ),
                        !t.isPreset && (
                          <Popconfirm
                            key="del"
                            title="确认删除该模板？"
                            onConfirm={() => deleteNovel(t.id)}
                            okText="删除"
                            okButtonProps={{ danger: true }}
                          >
                            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                              删除
                            </Button>
                          </Popconfirm>
                        ),
                      ].filter(Boolean) as React.ReactNode[]}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={8}>
                            {t.name}
                            {t.isPreset ? (
                              <Tag>预置</Tag>
                            ) : (
                              <Tag color="blue">自定义</Tag>
                            )}
                          </Space>
                        }
                        description={
                          <span style={{ fontSize: 12 }}>
                            典型章节 {t.typicalChapterLength} 字 · 大纲要求 {t.outlineStructure?.length ?? 0} 条
                          </span>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            ),
          },
          {
            key: 'writingStyle',
            label: `写作风格（${styles.length}）`,
            children: (
              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                <List
                  size="small"
                  bordered
                  dataSource={styles}
                  renderItem={(t) => (
                    <List.Item
                      actions={[
                        !t.isPreset && (
                          <Button
                            key="edit"
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openStyleEdit(t)}
                          >
                            编辑
                          </Button>
                        ),
                        !t.isPreset && (
                          <Popconfirm
                            key="del"
                            title="确认删除该模板？"
                            onConfirm={() => deleteStyle(t.id)}
                            okText="删除"
                            okButtonProps={{ danger: true }}
                          >
                            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                              删除
                            </Button>
                          </Popconfirm>
                        ),
                      ].filter(Boolean) as React.ReactNode[]}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={8}>
                            {t.name}
                            {t.isPreset ? (
                              <Tag>预置</Tag>
                            ) : (
                              <Tag color="blue">自定义</Tag>
                            )}
                          </Space>
                        }
                        description={<span style={{ fontSize: 12 }}>{t.description}</span>}
                      />
                    </List.Item>
                  )}
                />
              </div>
            ),
          },
        ]}
      />

      {/* 小说类型模板编辑弹窗 */}
      <Modal
        title={editNovel?.template ? '编辑小说类型模板' : '新建小说类型模板'}
        open={!!editNovel}
        onCancel={() => setEditNovel(null)}
        onOk={saveNovel}
        confirmLoading={saving}
        okText="保存"
        width={640}
      >
        <Form form={novelForm} layout="vertical" size="small">
          <Form.Item name="name" label="类型名称" rules={[{ required: true, message: '请输入类型名称' }]}>
            <Input placeholder="如：悬疑推理" />
          </Form.Item>
          <Form.Item
            name="systemPrompt"
            label="系统提示词"
            rules={[{ required: true, message: '请输入系统提示词' }]}
          >
            <Input.TextArea rows={4} placeholder="约束 AI 生成该类型小说时的整体要求" />
          </Form.Item>
          <Form.Item name="outlineStructure" label="大纲结构要求（每行一条）">
            <Input.TextArea rows={3} placeholder={'开篇钩子\n递进悬念\n高潮反转'} />
          </Form.Item>
          <Form.Item name="writingStyle" label="写作风格描述">
            <Input.TextArea rows={2} placeholder="如：冷峻克制的短句，注重环境渲染" />
          </Form.Item>
          <Form.Item name="typicalChapterLength" label="典型章节字数" initialValue={3000}>
            <InputNumber min={500} max={20000} step={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 写作风格模板编辑弹窗 */}
      <Modal
        title={editStyle?.template ? '编辑写作风格模板' : '新建写作风格模板'}
        open={!!editStyle}
        onCancel={() => setEditStyle(null)}
        onOk={saveStyle}
        confirmLoading={saving}
        okText="保存"
        width={560}
      >
        <Form form={styleForm} layout="vertical" size="small">
          <Form.Item name="name" label="风格名称" rules={[{ required: true, message: '请输入风格名称' }]}>
            <Input placeholder="如：汪曾祺式散文化" />
          </Form.Item>
          <Form.Item
            name="description"
            label="风格详细描述"
            rules={[{ required: true, message: '请输入风格描述' }]}
          >
            <Input.TextArea rows={5} placeholder="详细描述该风格的语言特征、叙事结构、可模仿元素" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default V2TemplatePanel;
