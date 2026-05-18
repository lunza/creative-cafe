import React, { useState, useEffect, useRef } from 'react';
import { Card, Form, Input, Select, InputNumber, Button, Row, Col, message, Checkbox, Collapse, Tag, Spin, Modal, List } from 'antd';
import { BookOutlined, UserOutlined, EditOutlined, IdcardOutlined, SaveOutlined, FolderOpenOutlined, DeleteOutlined } from '@ant-design/icons';
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
  const [selectedPersonas, setSelectedPersonas] = useState<any[]>([]);
  const [availableWorldBooks, setAvailableWorldBooks] = useState<any[]>([]);
  const [availableCharacters, setAvailableCharacters] = useState<any[]>([]);
  const [availablePersonas, setAvailablePersonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingResources, setLoadingResources] = useState(true);
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [isAiConfigLoaded, setIsAiConfigLoaded] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const streamRef = useRef<HTMLTextAreaElement>(null);
  const [savedConfigs, setSavedConfigs] = useState<{ name: string; config: any; timestamp: number }[]>([]);
  const [showSavedConfigs, setShowSavedConfigs] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [saveName, setSaveName] = useState('');

  const CONFIG_STORAGE_KEY = 'writing-config-saved';

  useEffect(() => {
    loadSavedConfigs();
  }, []);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamContent]);

  useEffect(() => {
    loadAiConfig();
    loadResources();
  }, []);

  const loadSavedConfigs = () => {
    try {
      const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (stored) {
        setSavedConfigs(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load saved configs:', e);
    }
  };

  const saveConfigToStorage = (name: string, config: any) => {
    try {
      const existing = [...savedConfigs];
      const index = existing.findIndex(c => c.name === name);
      const entry = { name, config, timestamp: Date.now() };
      if (index >= 0) {
        existing[index] = entry;
      } else {
        existing.push(entry);
      }
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(existing));
      setSavedConfigs(existing);
      message.success(`配置 "${name}" 已保存`);
    } catch (e) {
      console.error('Failed to save config:', e);
      message.error('保存配置失败');
    }
  };

  const handleSaveConfig = () => {
    form.validateFields().then(values => {
      setSaveName('');
      setSaveModalVisible(true);
    }).catch(() => {
      message.warning('请先填写必填项后再保存配置');
    });
  };

  const handleConfirmSave = () => {
    if (!saveName.trim()) {
      message.warning('请输入配置名称');
      return;
    }
    const values = form.getFieldsValue();
    const config = {
      resources: {
        worldBookIds: selectedWorldBooks.map(wb => wb.id),
        characterCardIds: selectedCharacters.map(c => c.id),
        userPersonaIds: selectedPersonas.length > 0 ? selectedPersonas.map(p => p.id) : undefined
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
      }
    };
    saveConfigToStorage(saveName.trim(), config);
    setSaveModalVisible(false);
  };

  const handleLoadConfig = (entry: { name: string; config: any }) => {
    const { config } = entry;
    form.setFieldsValue(config.parameters);
    const worldBooks = availableWorldBooks.filter(wb => config.resources?.worldBookIds?.includes(wb.id));
    const characters = availableCharacters.filter(c => config.resources?.characterCardIds?.includes(c.id));
    const personas = availablePersonas.filter(p => config.resources?.userPersonaIds?.includes(p.id));
    setSelectedWorldBooks(worldBooks);
    setSelectedCharacters(characters);
    setSelectedPersonas(personas);
    setShowSavedConfigs(false);
    message.success(`已加载配置 "${entry.name}"`);
  };

  const handleDeleteConfig = (name: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除配置 "${name}" 吗？`,
      onOk: () => {
        const updated = savedConfigs.filter(c => c.name !== name);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
        setSavedConfigs(updated);
        message.success('已删除');
      }
    });
  };

  const loadAiConfig = async () => {
    try {
      const loadResult = await window.electronAPI?.setting?.load?.();
      const allSettings = loadResult?.setting || loadResult;
      const aiEngines = allSettings?.aiEngines || [];
      const activeEngine = allSettings?.activeEngineId
        ? aiEngines.find((e: any) => e.id === allSettings.activeEngineId)
        : aiEngines[0];
      
      setAiConfig(activeEngine || {});
      setIsAiConfigLoaded(true);
      if (!activeEngine?.api_url || !activeEngine?.api_key) {
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

      const personaResult = await window.electronAPI?.avatar?.list?.();
      if (personaResult && Array.isArray(personaResult)) {
        setAvailablePersonas(personaResult.filter((p: any) => p.path.endsWith('.json') && !p.path.includes('user-profile.json')).map((p: any) => ({
          id: p.path,
          name: p.name || p.path.replace(/\.json$/i, ''),
          path: p.path,
          description: p.description || ''
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
        characterCardIds: selectedCharacters.map(c => c.id),
        userPersonaIds: selectedPersonas.length > 0 ? selectedPersonas.map(p => p.id) : undefined
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
    setIsGenerating(true);
    setStreamContent('');
    try {
      if (!window.electronAPI?.writing) {
        message.error('写作模块未加载');
        return;
      }

      // Set up stream listeners before making the request
      const unsubscribeChunk = window.electronAPI.writing.onStreamChunk((data: any) => {
        setStreamContent(prev => prev + data.chunk);
      });

      const unsubscribeComplete = window.electronAPI.writing.onStreamComplete((_data: any) => {
        // Stream complete
      });

      const unsubscribeError = window.electronAPI.writing.onStreamError((data: any) => {
        console.error('[WritingConfig] Stream error:', data.error);
      });

      console.log('[WritingConfig] Sending outline generation request:', {
        resources: config.resources,
        parameters: {
          ...config.parameters,
          creativeDescription: `[${config.parameters.creativeDescription.length} characters]`
        }
      });

      const result = await window.electronAPI.writing.generateOutline({
        resources: config.resources,
        parameters: config.parameters,
        modelConfig: config.modelConfig
      });

      // Clean up stream listeners
      unsubscribeChunk();
      unsubscribeComplete();
      unsubscribeError();

      console.log('[WritingConfig] Outline generation result:', {
        success: result.success,
        hasOutline: !!result.outline,
        hasOutlineRaw: !!result.outlineRaw,
        outlineRawLength: result.outlineRaw?.length || 0
      });

      if (result.success && result.outline) {
        useWritingModeStore.getState().setOutline(result.outline);
        useWritingModeStore.getState().setConfig(config);
        if (result.outlineRaw) {
          useWritingModeStore.getState().setOutlineRaw(result.outlineRaw);
        }
        onConfirm(config);
      } else if (result.outlineRaw) {
        message.warning({
          content: result.error || '大纲解析失败，但原始内容已保留',
          duration: 8
        });
      } else {
        message.error(result.error || '大纲生成失败');
      }
    } catch (error: any) {
      console.error('[WritingConfig] Outline generation error:', error);
      const errorMessage = error?.message || error?.toString() || '大纲生成出错';
      message.error(errorMessage);
    } finally {
      setLoading(false);
      setIsGenerating(false);
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
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="用户人设">
                    <Checkbox.Group
                      value={selectedPersonas.map(p => p.id)}
                      onChange={(checkedIds) => {
                        const selected = availablePersonas.filter(p => (checkedIds as string[]).includes(p.id));
                        setSelectedPersonas(selected);
                      }}
                      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    >
                      {availablePersonas.map(p => (
                        <Checkbox key={p.id} value={p.id}>{p.name}</Checkbox>
                      ))}
                      {availablePersonas.length === 0 && <div style={{ color: '#999' }}>暂无用户人设</div>}
                    </Checkbox.Group>
                  </Form.Item>
                </Col>
              </Row>
              {(selectedWorldBooks.length > 0 || selectedCharacters.length > 0 || selectedPersonas.length > 0) && (
                <div style={{ marginTop: 8 }}>
                  <Tag color="blue">已选 {selectedWorldBooks.length} 个世界书</Tag>
                  <Tag color="green">已选 {selectedCharacters.length} 个角色卡</Tag>
                  <Tag color="purple">已选 {selectedPersonas.length} 个用户人设</Tag>
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

          {isGenerating && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14 }}>AI 生成中...</div>
              <TextArea
                ref={streamRef}
                value={streamContent}
                readOnly
                rows={12}
                style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
              />
            </div>
          )}

          <Form.Item>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={onCancel}>取消</Button>
                <Button icon={<FolderOpenOutlined />} onClick={() => setShowSavedConfigs(true)} disabled={savedConfigs.length === 0}>
                  加载配置 ({savedConfigs.length})
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button icon={<SaveOutlined />} onClick={handleSaveConfig}>
                  保存配置
                </Button>
                <Button type="primary" htmlType="submit" loading={loading} size="large">
                  生成大纲
                </Button>
              </div>
            </div>
          </Form.Item>

          <Modal
            title="保存配置"
            open={saveModalVisible}
            onOk={handleConfirmSave}
            onCancel={() => setSaveModalVisible(false)}
            okText="保存"
            cancelText="取消"
          >
            <Input
              placeholder="请输入配置名称"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onPressEnter={handleConfirmSave}
              autoFocus
            />
          </Modal>

          <Modal
            title="已保存的配置"
            open={showSavedConfigs}
            onCancel={() => setShowSavedConfigs(false)}
            footer={<Button onClick={() => setShowSavedConfigs(false)}>关闭</Button>}
            width={600}
          >
            <List
              dataSource={savedConfigs}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="load" type="link" onClick={() => handleLoadConfig(item)}>加载</Button>,
                    <Button key="delete" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDeleteConfig(item.name)} />
                  ]}
                >
                  <List.Item.Meta
                    title={item.name}
                    description={`保存于 ${new Date(item.timestamp).toLocaleString()}`}
                  />
                </List.Item>
              )}
              locale={{ emptyText: '暂无已保存的配置' }}
            />
          </Modal>
        </Form>
      </div>
    </Spin>
  );
};

export default WritingConfigPanel;
