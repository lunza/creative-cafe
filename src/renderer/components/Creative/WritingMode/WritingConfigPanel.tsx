import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Select, InputNumber, Button, Row, Col, message, Checkbox, Collapse, Tag, Spin } from 'antd';
import { BookOutlined, UserOutlined, EditOutlined } from '@ant-design/icons';
import {
  NovelType,
  NarrativePerspective,
  WritingStyle,
  WritingConfig,
  WritingErrorCode
} from '../../../../shared/types/writing.types';
import {
  NOVEL_TYPE_OPTIONS,
  NARRATIVE_PERSPECTIVE_OPTIONS,
  WRITING_STYLE_OPTIONS,
  DEFAULT_WRITING_CONFIG,
  MIN_TARGET_WORD_COUNT,
  MAX_TARGET_WORD_COUNT,
  MIN_CHAPTER_COUNT,
  MAX_CHAPTER_COUNT,
  MIN_DESCRIPTION_LENGTH,
  MAX_DESCRIPTION_LENGTH
} from '../../../../shared/constants/writing.constants';
import { useWritingModeStore } from '../../../stores/writingModeStore';

const { TextArea } = Input;

interface WritingConfigPanelProps {
  onConfirm: (config: WritingConfig) => void;
  onCancel: () => void;
  initialConfig?: Partial<WritingConfig>;
}

const WritingConfigPanel: React.FC<WritingConfigPanelProps> = ({ onConfirm, onCancel, initialConfig }) => {
  const [form] = Form.useForm();
  const [selectedWorldBooks, setSelectedWorldBooks] = useState<any[]>([]);
  const [selectedCharacters, setSelectedCharacters] = useState<any[]>([]);
  const [availableWorldBooks, setAvailableWorldBooks] = useState<any[]>([]);
  const [availableCharacters, setAvailableCharacters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingResources, setLoadingResources] = useState(true);
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [isAiConfigLoaded, setIsAiConfigLoaded] = useState(false);

  useEffect(() => {
    loadAiConfig();
    loadResources();
  }, []);

  const loadAiConfig = async () => {
    try {
      const allSettings = await window.electronAPI?.setting?.load?.();
      const aiSettings = allSettings?.ai || {};
      setAiConfig(aiSettings);
      setIsAiConfigLoaded(true);
      if (!aiSettings?.baseUrl && !aiSettings?.apiBaseUrl && !aiSettings?.apiKey && !aiSettings?.apiToken) {
        message.warning('请先在设置中配置 AI 服务地址和 API Key');
      }
    } catch {
      setIsAiConfigLoaded(true);
    }
  };

  const loadResources = async () => {
    setLoadingResources(true);
    try {
      const wbResult = await window.electronAPI?.worldBook?.list?.();
      if (wbResult && Array.isArray(wbResult)) {
        setAvailableWorldBooks(wbResult.map((wb: any) => ({
          id: wb.path,
          name: wb.name.replace(/\.(json|json5)$/i, ''),
          path: wb.path
        })));
      }
      
      const charResult = await window.electronAPI?.character?.list?.();
      if (charResult && Array.isArray(charResult)) {
        setAvailableCharacters(charResult.map((ch: any) => ({
          id: ch.path,
          name: ch.characterName || ch.name.replace(/\.(png|jpg|jpeg|webp)$/i, ''),
          path: ch.path
        })));
      }
    } catch (error) {
      console.error('Failed to load resources:', error);
    } finally {
      setLoadingResources(false);
    }
  };

  const handleGenerateOutline = async (values: any) => {
    if (values.creativeDescription.length < MIN_DESCRIPTION_LENGTH) {
      message.error(`创意描述至少需要 ${MIN_DESCRIPTION_LENGTH} 个字符`);
      return;
    }

    if (!isAiConfigLoaded) {
      message.error('AI 配置尚未加载完成，请稍后重试');
      return;
    }

    const modelConfig = {
      model: aiConfig?.model || DEFAULT_WRITING_CONFIG.model,
      temperature: aiConfig?.temperature ?? DEFAULT_WRITING_CONFIG.temperature,
      maxTokens: aiConfig?.maxTokens ?? DEFAULT_WRITING_CONFIG.maxTokens
    };

    const config: WritingConfig = {
      resources: {
        worldBookIds: selectedWorldBooks.map(wb => wb.id),
        characterCardIds: selectedCharacters.map(c => c.id)
      },
      parameters: {
        creativeDescription: values.creativeDescription,
        novelType: values.novelType,
        targetWordCount: values.targetWordCount,
        chapterCount: values.chapterCount,
        narrativePerspective: values.narrativePerspective,
        writingStyle: values.writingStyle,
        additionalRequirements: values.additionalRequirements,
        forbiddenContent: values.forbiddenContent?.split('\n').filter(Boolean) || []
      },
      modelConfig
    };

    setLoading(true);
    try {
      if (!window.electronAPI?.writing) {
        message.error('写作模块未加载');
        return;
      }

      const result = await window.electronAPI.writing.generateOutline({
        resources: config.resources,
        parameters: config.parameters,
        modelConfig: config.modelConfig
      });

      if (result.success && result.outline) {
        const { useWritingProjectStore } = require('../../../stores/writingProjectStore');
        const projectId = await useWritingProjectStore.getState().createProject(config);
        if (projectId) {
          useWritingProjectStore.getState().setCurrentProject(projectId);
        }
        useWritingModeStore.getState().setOutline(result.outline);
        onConfirm(config);
      } else {
        message.error(result.error || '大纲生成失败');
      }
    } catch (error: any) {
      message.error(error.message || '大纲生成出错');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Spin spinning={loadingResources}>
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 24 }}>创作配置</h2>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            novelType: DEFAULT_WRITING_CONFIG.novelType,
            narrativePerspective: DEFAULT_WRITING_CONFIG.narrativePerspective,
            targetWordCount: DEFAULT_WRITING_CONFIG.targetWordCount,
            chapterCount: DEFAULT_WRITING_CONFIG.chapterCount,
            writingStyle: WritingStyle.RELAXED
          }}
          onFinish={handleGenerateOutline}
        >
          <Collapse defaultActiveKey={['resources', 'parameters']} style={{ marginBottom: 24 }}>
            <Collapse.Panel key="resources" header="资源选择" icon={<BookOutlined />}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="世界书">
                    <Checkbox.Group
                      value={selectedWorldBooks.map(wb => wb.id)}
                      onChange={(checkedIds) => {
                        const selected = availableWorldBooks.filter(wb => (checkedIds as string[]).includes(wb.id));
                        setSelectedWorldBooks(selected);
                      }}
                      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    >
                      {availableWorldBooks.map(wb => (
                        <Checkbox key={wb.id} value={wb.id}>{wb.name}</Checkbox>
                      ))}
                      {availableWorldBooks.length === 0 && <div style={{ color: '#999' }}>暂无世界书</div>}
                    </Checkbox.Group>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="角色卡">
                    <Checkbox.Group
                      value={selectedCharacters.map(c => c.id)}
                      onChange={(checkedIds) => {
                        const selected = availableCharacters.filter(c => (checkedIds as string[]).includes(c.id));
                        setSelectedCharacters(selected);
                      }}
                      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    >
                      {availableCharacters.map(c => (
                        <Checkbox key={c.id} value={c.id}>{c.name}</Checkbox>
                      ))}
                      {availableCharacters.length === 0 && <div style={{ color: '#999' }}>暂无角色卡</div>}
                    </Checkbox.Group>
                  </Form.Item>
                </Col>
              </Row>
              {(selectedWorldBooks.length > 0 || selectedCharacters.length > 0) && (
                <div style={{ marginTop: 8 }}>
                  <Tag color="blue">已选 {selectedWorldBooks.length} 个世界书</Tag>
                  <Tag color="green">已选 {selectedCharacters.length} 个角色卡</Tag>
                </div>
              )}
            </Collapse.Panel>

            <Collapse.Panel key="parameters" header="创作参数" icon={<EditOutlined />}>
              <Form.Item
                label="创意描述"
                name="creativeDescription"
                rules={[{ required: true, message: '请输入创意描述' }]}
              >
                <TextArea
                  rows={4}
                  placeholder="描述你的创作创意、主题、背景等"
                  showCount
                  maxLength={MAX_DESCRIPTION_LENGTH}
                />
              </Form.Item>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="小说类型" name="novelType" rules={[{ required: true }]}>
                    <Select options={NOVEL_TYPE_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="叙事视角" name="narrativePerspective" rules={[{ required: true }]}>
                    <Select options={NARRATIVE_PERSPECTIVE_OPTIONS} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="写作风格" name="writingStyle">
                    <Select options={WRITING_STYLE_OPTIONS} allowClear />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="目标字数" name="targetWordCount">
                    <InputNumber
                      min={MIN_TARGET_WORD_COUNT}
                      max={MAX_TARGET_WORD_COUNT}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="章节数量" name="chapterCount">
                    <InputNumber
                      min={MIN_CHAPTER_COUNT}
                      max={MAX_CHAPTER_COUNT}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="额外要求" name="additionalRequirements">
                <TextArea rows={2} placeholder="其他特殊要求或说明" />
              </Form.Item>

              <Form.Item label="禁止内容" name="forbiddenContent">
                <TextArea rows={2} placeholder="每行一个禁止出现的内容" />
              </Form.Item>
            </Collapse.Panel>
          </Collapse>

          <Form.Item>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" htmlType="submit" loading={loading} size="large">
                生成大纲
              </Button>
            </div>
          </Form.Item>
        </Form>
      </div>
    </Spin>
  );
};

export default WritingConfigPanel;
