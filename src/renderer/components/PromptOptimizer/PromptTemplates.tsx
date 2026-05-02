import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Typography, Tag, Select, Input, Modal, Form, message } from 'antd';
import { 
  FileOutlined, 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined, 
  StarOutlined, 
  StarFilled,
  CopyOutlined,
  CheckOutlined
} from '@ant-design/icons';
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore';
import { PromptTemplate, TemplateCategory } from '../../types/promptOptimizer';
import { useUIStore } from '../../stores/uiStore';

const { Text, Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const PromptTemplates: React.FC = () => {
  const { theme } = useUIStore();
  const { 
    templates, 
    loadTemplates, 
    createTemplate, 
    updateTemplate, 
    deleteTemplate, 
    toggleFavoriteTemplate,
    applyTemplate,
    setCurrentPrompt
  } = usePromptOptimizerStore();
  
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [form] = Form.useForm();
  const [variables, setVariables] = useState<{ name: string; description: string; required: boolean; defaultValue?: string }[]>([]);

  useEffect(() => {
    loadTemplates(selectedCategory || undefined);
  }, [selectedCategory]);

  const handleCategoryChange = (category: TemplateCategory | null) => {
    setSelectedCategory(category);
  };

  const handleCreateTemplate = () => {
    setIsEditMode(false);
    setVariables([]);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleEditTemplate = (template: PromptTemplate) => {
    if (template.isBuiltin) {
      message.warning('内置模板不能编辑');
      return;
    }
    setIsEditMode(true);
    setSelectedTemplate(template);
    setVariables(template.variables);
    form.setFieldsValue({
      name: template.name,
      description: template.description,
      category: template.category,
      content: template.content,
      example: template.example
    });
    setIsModalVisible(true);
  };

  const handleDeleteTemplate = (template: PromptTemplate) => {
    if (template.isBuiltin) {
      message.warning('内置模板不能删除');
      return;
    }
    deleteTemplate(template.id);
    message.success('模板删除成功');
  };

  const handleToggleFavorite = (template: PromptTemplate) => {
    toggleFavoriteTemplate(template.id);
  };

  const handleApplyTemplate = (template: PromptTemplate) => {
    if (template.variables.length > 0) {
      // 这里可以添加变量填写模态框
      // 现在简化处理，直接应用
      const result = applyTemplate(template.id, {});
      if (result) {
        message.success('模板应用成功');
      }
    } else {
      const result = applyTemplate(template.id, {});
      if (result) {
        message.success('模板应用成功');
      }
    }
  };

  const handleCopyTemplate = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      message.success('已复制到剪贴板');
    } catch (error) {
      message.error('复制失败');
    }
  };

  const handleAddVariable = () => {
    setVariables([...variables, { name: '', description: '', required: false }]);
  };

  const handleRemoveVariable = (index: number) => {
    const newVariables = [...variables];
    newVariables.splice(index, 1);
    setVariables(newVariables);
  };

  const handleSaveTemplate = async () => {
    try {
      const values = await form.validateFields();
      
      if (isEditMode && selectedTemplate) {
        updateTemplate(selectedTemplate.id, {
          name: values.name,
          description: values.description,
          category: values.category,
          content: values.content,
          variables,
          example: values.example
        });
        message.success('模板更新成功');
      } else {
        createTemplate({
          name: values.name,
          description: values.description,
          category: values.category,
          content: values.content,
          variables,
          example: values.example,
          isFavorite: false
        });
        message.success('模板创建成功');
      }
      setIsModalVisible(false);
    } catch (error) {
      message.error('请填写所有必填字段');
    }
  };

  const categories: { value: TemplateCategory | null; label: string }[] = [
    { value: null, label: '全部' },
    { value: 'assistant', label: '助手类' },
    { value: 'creative', label: '创意类' },
    { value: 'technical', label: '技术类' },
    { value: 'business', label: '商业类' },
    { value: 'education', label: '教育类' },
    { value: 'entertainment', label: '娱乐类' },
    { value: 'custom', label: '自定义' }
  ];

  return (
    <div className="prompt-templates">
      <Card title={<><FileOutlined /> 提示词模板库</>} className="prompt-templates-card">
        <div className="templates-header" style={{ marginBottom: 16 }}>
          <Space>
            <Select
              value={selectedCategory}
              onChange={handleCategoryChange}
              style={{ width: 200 }}
              placeholder="选择分类"
            >
              {categories.map(category => (
                <Option key={category.value || 'all'} value={category.value}>
                  {category.label}
                </Option>
              ))}
            </Select>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateTemplate}
            >
              新建模板
            </Button>
          </Space>
        </div>

        <div className="templates-grid">
          {templates.length === 0 ? (
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: '40px 0' }}>
              暂无模板
            </Text>
          ) : (
            templates.map(template => (
              <Card
                key={template.id}
                className="template-card"
                size="small"
                extra={
                  <Space size="small">
                    <Button
                      type="text"
                      icon={template.isFavorite ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                      onClick={() => handleToggleFavorite(template)}
                    />
                  </Space>
                }
              >
                <div className="template-header">
                  <Title level={5} style={{ marginBottom: 8 }}>{template.name}</Title>
                  <Tag color={template.isBuiltin ? 'blue' : 'green'}>
                    {template.isBuiltin ? '内置' : '自定义'}
                  </Tag>
                </div>
                
                <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                  {template.description}
                </Text>
                
                <div className="template-content" style={{ marginBottom: 12 }}>
                  <Text ellipsis={{ rows: 3 }}>{template.content}</Text>
                </div>
                
                {template.variables.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: '0.9em' }}>
                      变量: {template.variables.map(v => v.name).join(', ')}
                    </Text>
                  </div>
                )}
                
                <div className="template-footer">
                  <Text type="secondary" style={{ fontSize: '0.8em' }}>
                    使用 {template.usageCount} 次
                  </Text>
                  <Space size="small">
                    <Button
                      type="link"
                      icon={<CheckOutlined />}
                      size="small"
                      onClick={() => handleApplyTemplate(template)}
                    >
                      应用
                    </Button>
                    <Button
                      type="link"
                      icon={<CopyOutlined />}
                      size="small"
                      onClick={() => handleCopyTemplate(template.content)}
                    >
                      复制
                    </Button>
                    <Button
                      type="link"
                      icon={<EditOutlined />}
                      size="small"
                      onClick={() => handleEditTemplate(template)}
                      disabled={template.isBuiltin}
                    >
                      编辑
                    </Button>
                    <Button
                      type="link"
                      danger
                      icon={<DeleteOutlined />}
                      size="small"
                      onClick={() => handleDeleteTemplate(template)}
                      disabled={template.isBuiltin}
                    >
                      删除
                    </Button>
                  </Space>
                </div>
              </Card>
            ))
          )}
        </div>

        <Modal
          title={isEditMode ? '编辑模板' : '新建模板'}
          open={isModalVisible}
          onCancel={() => setIsModalVisible(false)}
          onOk={handleSaveTemplate}
          width={800}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="模板名称"
              rules={[{ required: true, message: '请输入模板名称' }]}
            >
              <Input placeholder="请输入模板名称" />
            </Form.Item>

            <Form.Item
              name="description"
              label="模板描述"
              rules={[{ required: true, message: '请输入模板描述' }]}
            >
              <TextArea rows={2} placeholder="请输入模板描述" />
            </Form.Item>

            <Form.Item
              name="category"
              label="模板分类"
              rules={[{ required: true, message: '请选择模板分类' }]}
            >
              <Select placeholder="请选择模板分类">
                {categories.filter(c => c.value).map(category => (
                  <Option key={category.value} value={category.value}>
                    {category.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="content"
              label="模板内容"
              rules={[{ required: true, message: '请输入模板内容' }]}
            >
              <TextArea rows={5} placeholder="请输入模板内容，变量使用 {{变量名}} 格式" />
            </Form.Item>

            <Form.Item label="模板变量">
              <div className="variables-list">
                {variables.map((variable, index) => (
                  <div key={index} className="variable-item" style={{ marginBottom: 8, padding: 8, border: '1px solid #e8e8e8', borderRadius: 4 }}>
                    <Space style={{ width: '100%' }} orientation="vertical">
                      <Space style={{ width: '100%' }}>
                        <Input
                          placeholder="变量名"
                          value={variable.name}
                          onChange={(e) => {
                            const newVariables = [...variables];
                            newVariables[index].name = e.target.value;
                            setVariables(newVariables);
                          }}
                          style={{ flex: 1 }}
                        />
                        <Input
                          placeholder="默认值"
                          value={variable.defaultValue}
                          onChange={(e) => {
                            const newVariables = [...variables];
                            newVariables[index].defaultValue = e.target.value;
                            setVariables(newVariables);
                          }}
                          style={{ flex: 1 }}
                        />
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          size="small"
                          onClick={() => handleRemoveVariable(index)}
                        />
                      </Space>
                      <Space style={{ width: '100%' }}>
                        <Input
                          placeholder="变量描述"
                          value={variable.description}
                          onChange={(e) => {
                            const newVariables = [...variables];
                            newVariables[index].description = e.target.value;
                            setVariables(newVariables);
                          }}
                          style={{ flex: 1 }}
                        />
                        <Space>
                          <span>必填</span>
                          <input
                            type="checkbox"
                            checked={variable.required}
                            onChange={(e) => {
                              const newVariables = [...variables];
                              newVariables[index].required = e.target.checked;
                              setVariables(newVariables);
                            }}
                          />
                        </Space>
                      </Space>
                    </Space>
                  </div>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={handleAddVariable}
                  style={{ width: '100%' }}
                >
                  添加变量
                </Button>
              </div>
            </Form.Item>

            <Form.Item
              name="example"
              label="使用示例"
            >
              <TextArea rows={3} placeholder="请输入使用示例" />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </div>
  );
};

export default PromptTemplates;
