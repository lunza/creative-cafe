import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Typography, message, Select, Switch, InputNumber, Space, Tag, Row, Col, Collapse, Divider, Badge } from 'antd';
import { BookOutlined, GlobalOutlined, EnvironmentOutlined, TeamOutlined, ToolOutlined, UsergroupAddOutlined, CalendarOutlined, PlusOutlined, DeleteOutlined, CheckCircleOutlined, ThunderboltOutlined, LoadingOutlined, EyeOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { ALL_WORLDBOOK_TEMPLATES, WorldBookTemplate, getTemplateCategories } from '../../utils/worldBookTemplates';
import { createDefaultEntry } from '../../utils/worldBookUtils';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface TemplateSelectorProps {
  onGenerateEntries: (template: WorldBookTemplate, params: Record<string, any>, theme: string) => Promise<any[]>;
  theme: string;
}

interface SelectedTemplateConfig {
  template: WorldBookTemplate;
  params: Record<string, any>;
}

const iconMap: Record<string, any> = {
  BookOutlined,
  GlobalOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  ToolOutlined,
  UsergroupAddOutlined,
  CalendarOutlined
};

const WorldBookTemplateSelector: React.FC<TemplateSelectorProps> = ({
  onGenerateEntries,
  theme
}) => {
  const [mode, setMode] = useState<'select' | 'configure' | 'preview'>('select');
  const [selectedTemplates, setSelectedTemplates] = useState<SelectedTemplateConfig[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedEntries, setGeneratedEntries] = useState<any[]>([]);

  const categories = getTemplateCategories();

  useEffect(() => {
    if (selectedTemplates.length > 0 && mode === 'configure') {
      const allFilled = selectedTemplates.every(config => {
        return config.template.parameters
          .filter(p => p.required)
          .every(p => config.params[p.key] !== undefined && config.params[p.key] !== '');
      });
      if (allFilled) {
        setMode('preview');
      }
    }
  }, [selectedTemplates, mode]);

  const handleTemplateSelect = (templateId: string) => {
    const template = ALL_WORLDBOOK_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    const defaultParams: Record<string, any> = {};
    template.parameters.forEach(param => {
      if (param.defaultValue !== undefined) {
        defaultParams[param.key] = param.defaultValue;
      }
    });

    setSelectedTemplates(prev => [...prev, { template, params: defaultParams }]);
    setMode('configure');
  };

  const handleRemoveTemplate = (templateId: string) => {
    setSelectedTemplates(prev => prev.filter(c => c.template.id !== templateId));
    if (selectedTemplates.length <= 1) {
      setMode('select');
    }
  };

  const handleParamChange = (templateId: string, key: string, value: any) => {
    setSelectedTemplates(prev => prev.map(config => {
      if (config.template.id === templateId) {
        return {
          ...config,
          params: {
            ...config.params,
            [key]: value
          }
        };
      }
      return config;
    }));
  };

  const handleGenerate = async () => {
    if (selectedTemplates.length === 0) {
      message.warning('请至少选择一个模板');
      return;
    }

    setIsGenerating(true);
    setGeneratedEntries([]);

    try {
      const allEntries: any[] = [];
      for (const config of selectedTemplates) {
        const missingParams = config.template.parameters
          .filter(p => p.required && (config.params[p.key] === undefined || config.params[p.key] === ''))
          .map(p => p.label);
        if (missingParams.length > 0) {
          message.warning(`模板"${config.template.name}"缺少必填参数：${missingParams.join('、')}`);
          setIsGenerating(false);
          return;
        }

        const entries = await onGenerateEntries(config.template, config.params, theme);
        allEntries.push(...entries);
      }

      setGeneratedEntries(allEntries);
      message.success(`成功生成 ${allEntries.length} 个条目`);
    } catch (error) {
      message.error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEntryChange = (index: number, field: string, value: any) => {
    setGeneratedEntries(prev => {
      const newEntries = [...prev];
      newEntries[index] = {
        ...newEntries[index],
        [field]: value
      };
      return newEntries;
    });
  };

  const handleDeleteEntry = (index: number) => {
    setGeneratedEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddEntry = () => {
    const newIndex = generatedEntries.length;
    setGeneratedEntries(prev => [...prev, createDefaultEntry(newIndex, [], '', '')]);
  };

  const renderParamField = (templateId: string, param: any) => {
    const config = selectedTemplates.find(c => c.template.id === templateId);
    const value = config?.params[param.key];

    switch (param.type) {
      case 'select':
        return (
          <Select
            value={value}
            onChange={(val) => handleParamChange(templateId, param.key, val)}
            placeholder={param.placeholder}
            style={{ width: '100%' }}
            options={param.options?.map(opt => ({ label: opt, value: opt }))}
          />
        );
      case 'textarea':
        return (
          <TextArea
            value={value || ''}
            onChange={(e) => handleParamChange(templateId, param.key, e.target.value)}
            placeholder={param.placeholder}
            rows={3}
          />
        );
      case 'number':
        return (
          <InputNumber
            value={value}
            onChange={(val) => handleParamChange(templateId, param.key, val)}
            placeholder={param.placeholder}
            style={{ width: '100%' }}
            min={1}
          />
        );
      case 'checkbox':
        return (
          <Switch
            checked={value !== false}
            onChange={(checked) => handleParamChange(templateId, param.key, checked)}
          />
        );
      default:
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleParamChange(templateId, param.key, e.target.value)}
            placeholder={param.placeholder}
          />
        );
    }
  };

  const renderTemplateConfigCard = (config: SelectedTemplateConfig) => {
    const allRequiredFilled = config.template.parameters
      .filter(p => p.required)
      .every(p => config.params[p.key] !== undefined && config.params[p.key] !== '');

    return (
      <Card
        key={config.template.id}
        size="small"
        style={{
          marginBottom: 12,
          borderColor: allRequiredFilled ? '#52c41a' : undefined,
          borderWidth: allRequiredFilled ? 2 : 1,
          borderStyle: 'solid'
        }}
        title={
          <Space>
            <Tag color={config.template.color}>{config.template.name}</Tag>
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveTemplate(config.template.id)}
            />
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
          {config.template.description}
        </Paragraph>
        {config.template.parameters.map(param => (
          <div key={param.key} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 13 }}>{param.label}</Text>
              {param.required && <Text type="danger"> *</Text>}
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              {param.description}
            </Text>
            {renderParamField(config.template.id, param)}
          </div>
        ))}
      </Card>
    );
  };

  const renderPreviewSection = () => {
    const totalEntries = selectedTemplates.reduce((sum, config) => {
      const count = config.params.entryCount || 0;
      return sum + (typeof count === 'number' ? count : parseInt(count) || 0);
    }, 0);

    return (
      <div>
        <Divider orientation="left">
          <Space>
            <EyeOutlined />
            <span>组合预览</span>
          </Space>
        </Divider>
        <div style={{ marginBottom: 16 }}>
          <Space size="large">
            <Text>已选择 <Badge count={selectedTemplates.length} style={{ backgroundColor: '#1890ff' }} /> 个模板</Text>
            <Text>预计生成 <Badge count={totalEntries} style={{ backgroundColor: '#52c41a' }} /> 个条目</Text>
          </Space>
        </div>
        {selectedTemplates.map(config => {
          const IconComponent = iconMap[config.template.icon];
          const entryCount = config.params.entryCount || 0;
          return (
            <Card key={config.template.id} size="small" style={{ marginBottom: 8 }}>
              <Space>
                {IconComponent && <IconComponent style={{ color: config.template.color }} />}
                <Text strong>{config.template.name}</Text>
                <Text type="secondary">({config.params.ruleType || config.params.worldType || config.params.locationType || config.params.glossaryType || config.params.factionType || config.params.itemType || config.params.groupType || config.params.eventType || ''})</Text>
                <Tag>{entryCount} 个条目</Tag>
              </Space>
            </Card>
          );
        })}
        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            size="large"
            icon={isGenerating ? <LoadingOutlined /> : <ThunderboltOutlined />}
            loading={isGenerating}
            onClick={handleGenerate}
            block
          >
            {isGenerating ? '生成中...' : `AI生成全部 ${totalEntries} 个条目`}
          </Button>
        </div>
      </div>
    );
  };

  const renderEntryEditor = (entry: any, index: number) => (
    <Card
      key={index}
      size="small"
      style={{ marginBottom: 12 }}
      type="inner"
      title={
        <Space>
          <span>条目 {index + 1}: {entry.comment || '未命名'}</span>
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteEntry(index)}
          />
        </Space>
      }
    >
      <Row gutter={16}>
        <Col span={12}>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>注释</Text>
            <Input
              value={entry.comment}
              onChange={(e) => handleEntryChange(index, 'comment', e.target.value)}
              placeholder="条目注释"
            />
          </div>
        </Col>
        <Col span={12}>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>关键词（逗号分隔）</Text>
            <Input
              value={Array.isArray(entry.key) ? entry.key.join(', ') : ''}
              onChange={(e) => handleEntryChange(index, 'key', e.target.value.split(/[,，]/).map((k: string) => k.trim()).filter((k: string) => k))}
              placeholder="关键词"
            />
          </div>
        </Col>
      </Row>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>内容</Text>
        <TextArea
          value={entry.content}
          onChange={(e) => handleEntryChange(index, 'content', e.target.value)}
          placeholder="条目内容"
          rows={4}
        />
      </div>
    </Card>
  );

  if (mode === 'select') {
    return (
      <div>
        <Text strong style={{ fontSize: 15, marginBottom: 12, display: 'block' }}>
          选择模板类型（可多选组合）
        </Text>
        <Row gutter={[12, 12]}>
          {categories.map(cat => {
            const templates = ALL_WORLDBOOK_TEMPLATES.filter(t => t.category === cat.key);
            const IconComponent = iconMap[cat.icon];
            const selectedCount = selectedTemplates.filter(c => c.template.category === cat.key).length;
            return (
              <Col span={12} key={cat.key}>
                <Card
                  hoverable
                  style={{
                    borderColor: selectedCount > 0 ? cat.color : undefined,
                    borderWidth: selectedCount > 0 ? 2 : 1,
                    borderStyle: 'solid'
                  }}
                >
                  <Space align="start" style={{ width: '100%' }}>
                    {IconComponent && <IconComponent style={{ fontSize: 20, color: cat.color }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong style={{ fontSize: 14 }}>{cat.name}</Text>
                        {selectedCount > 0 && (
                          <Tag color={cat.color}>已选 {selectedCount}</Tag>
                        )}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        {templates.map(t => {
                          const isSelected = selectedTemplates.some(c => c.template.id === t.id);
                          return (
                            <Tag
                              key={t.id}
                              color={isSelected ? cat.color : 'default'}
                              style={{
                                cursor: 'pointer',
                                marginRight: 4,
                                marginBottom: 4,
                                fontWeight: isSelected ? 'bold' : 'normal'
                              }}
                              onClick={() => {
                                if (isSelected) {
                                  handleRemoveTemplate(t.id);
                                } else {
                                  handleTemplateSelect(t.id);
                                }
                              }}
                            >
                              {isSelected ? '✓ ' : ''}{t.name}
                            </Tag>
                          );
                        })}
                      </div>
                    </div>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
        {selectedTemplates.length > 0 && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button
              type="primary"
              onClick={() => setMode('configure')}
            >
              下一步：配置参数 ({selectedTemplates.length} 个模板)
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'configure') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Space>
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              onClick={() => setMode('select')}
            >
              返回选择
            </Button>
            <Text strong>配置模板参数</Text>
          </Space>
          <Button
            type="primary"
            onClick={() => setMode('preview')}
          >
            下一步：预览组合
          </Button>
        </div>

        <Collapse
          defaultActiveKey={selectedTemplates.map(c => c.template.id)}
          ghost
        >
          {selectedTemplates.map(config => (
            <Collapse.Panel
              key={config.template.id}
              header={
                <Space>
                  <Tag color={config.template.color}>{config.template.name}</Tag>
                  <Text>{config.template.description}</Text>
                </Space>
              }
            >
              {renderTemplateConfigCard(config)}
            </Collapse.Panel>
          ))}
        </Collapse>
      </div>
    );
  }

  if (mode === 'preview') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            onClick={() => setMode('configure')}
          >
            返回配置
          </Button>
        </div>

        {renderPreviewSection()}

        {generatedEntries.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <Divider orientation="left">
              <Space>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <span>生成结果 ({generatedEntries.length} 个条目)</span>
              </Space>
            </Divider>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleAddEntry}
              >
                添加条目
              </Button>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {generatedEntries.map((entry, index) => renderEntryEditor(entry, index))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default WorldBookTemplateSelector;
