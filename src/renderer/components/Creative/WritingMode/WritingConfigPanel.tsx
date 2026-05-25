import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Form, Input, Select, InputNumber, Button, Row, Col, message, Checkbox, Collapse, Tag, Spin, Modal, List, Slider } from 'antd';
import { BookOutlined, UserOutlined, EditOutlined, IdcardOutlined, SaveOutlined, FolderOpenOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
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
  const [error, setError] = useState<string | null>(null);
  const lastConfigRef = useRef<{ values: any; config: WritingConfig } | null>(null);
  const [pendingRawJson, setPendingRawJson] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generationAborted, setGenerationAborted] = useState(false);

  const CONFIG_STORAGE_KEY = 'writing-config-saved';

  useEffect(() => {
    loadSavedConfigs();
  }, []);

  const prevIncludeEndingRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const currentIncludeEnding = form.getFieldValue('includeEnding');
    if (currentIncludeEnding === false && prevIncludeEndingRef.current !== false) {
      const chapterCount = form.getFieldValue('chapterCount') || DEFAULT_WRITING_CONFIG.chapterCount;
      form.setFieldsValue({
        chapterRangeStart: 1,
        chapterRangeEnd: chapterCount
      });
    }
    prevIncludeEndingRef.current = currentIncludeEnding;
  }, [form]);

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
    } catch (e: any) {
      console.error('Failed to save config:', e);
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        message.error('保存失败：本地存储空间已满，请清理浏览器缓存或检查磁盘空间');
      } else {
        message.error(`保存配置失败: ${e?.message || String(e)}`);
      }
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

  const handleConfirmSave = async () => {
    if (!saveName.trim()) {
      message.warning('请输入配置名称');
      return;
    }
    try {
      setSaving(true);
      const values = await form.getFieldsValue();
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
    } catch (e: any) {
      console.error('保存配置失败:', e);
      message.error(`保存配置失败: ${e?.message || String(e)}`);
    } finally {
      setSaving(false);
    }
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
      model: values.model || aiConfig?.model || DEFAULT_WRITING_CONFIG.model,
      temperature: values.temperature ?? aiConfig?.temperature ?? DEFAULT_WRITING_CONFIG.temperature,
      maxTokens: values.maxTokens ?? aiConfig?.maxTokens ?? DEFAULT_WRITING_CONFIG.maxTokens
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
        forbiddenContent: values.forbiddenContent?.split('\n').filter(Boolean) || [],
        includeEnding: values.includeEnding !== false,
        chapterRangeStart: values.includeEnding === false ? values.chapterRangeStart || 1 : undefined,
        chapterRangeEnd: values.includeEnding === false ? values.chapterRangeEnd || values.chapterCount : undefined
      },
      modelConfig
    };

    setLoading(true);
    setIsGenerating(true);
    setStreamContent('');
    setError(null);
    lastConfigRef.current = { values, config };
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
      setError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  const handleCancelGeneration = useCallback(() => {
    setLoading(false);
    setIsGenerating(false);
    setStreamContent('');
    message.info('已取消生成');
  }, []);

  const handleRetryGeneration = useCallback(async () => {
    if (!lastConfigRef.current) {
      message.error('无法重试：未找到上次生成的配置');
      return;
    }
    setError(null);
    const { values, config: savedConfig } = lastConfigRef.current;
    
    setLoading(true);
    setIsGenerating(true);
    setStreamContent('');
    try {
      if (!window.electronAPI?.writing) {
        message.error('写作模块未加载');
        return;
      }

      const unsubscribeChunk = window.electronAPI.writing.onStreamChunk((data: any) => {
        setStreamContent(prev => prev + data.chunk);
      });

      const unsubscribeComplete = window.electronAPI.writing.onStreamComplete((_data: any) => {
        // Stream complete
      });

      const unsubscribeError = window.electronAPI.writing.onStreamError((data: any) => {
        console.error('[WritingConfig] Stream error:', data.error);
      });

      const result = await window.electronAPI.writing.generateOutline({
        resources: savedConfig.resources,
        parameters: savedConfig.parameters,
        modelConfig: savedConfig.modelConfig
      });

      unsubscribeChunk();
      unsubscribeComplete();
      unsubscribeError();

      if (result.success && result.outline) {
        useWritingModeStore.getState().setOutline(result.outline);
        useWritingModeStore.getState().setConfig(savedConfig);
        if (result.outlineRaw) {
          useWritingModeStore.getState().setOutlineRaw(result.outlineRaw);
        }
        onConfirm(savedConfig);
      } else if (result.outlineRaw) {
        message.warning({
          content: result.error || '大纲解析失败，但原始内容已保留',
          duration: 8
        });
      } else {
        message.error(result.error || '大纲生成失败');
      }
    } catch (retryError: any) {
      console.error('[WritingConfig] Retry error:', retryError);
      const errorMessage = retryError?.message || retryError?.toString() || '大纲生成出错';
      setError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  }, [onConfirm]);

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

              <Form.Item
                name="includeEnding"
                valuePropName="checked"
                initialValue={true}
              >
                <Checkbox>是否包含结局（取消勾选为连载模式）</Checkbox>
              </Form.Item>

              <Form.Item noStyle shouldUpdate={(prevValues, currentValues) =>
                prevValues.includeEnding !== currentValues.includeEnding ||
                prevValues.chapterCount !== currentValues.chapterCount
              }>
                {({ getFieldValue }) => {
                  const includeEnding = getFieldValue('includeEnding');
                  const chapterCount = getFieldValue('chapterCount');
                  if (includeEnding === false) {
                    return (
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item
                            label="起始章节"
                            name="chapterRangeStart"
                            rules={[
                              { required: true, message: '请输入起始章节' },
                              ({ getFieldValue }) => ({
                                validator(_, value) {
                                  const end = getFieldValue('chapterRangeEnd');
                                  if (value && end && value > end) {
                                    return Promise.reject('起始章节不能大于结束章节');
                                  }
                                  return Promise.resolve();
                                }
                              })
                            ]}
                          >
                            <InputNumber
                              min={1}
                              max={chapterCount || MAX_CHAPTER_COUNT}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            label="结束章节"
                            name="chapterRangeEnd"
                            rules={[
                              { required: true, message: '请输入结束章节' },
                              ({ getFieldValue }) => ({
                                validator(_, value) {
                                  const start = getFieldValue('chapterRangeStart');
                                  if (value && start && value < start) {
                                    return Promise.reject('结束章节不能小于起始章节');
                                  }
                                  if (value && value > chapterCount) {
                                    return Promise.reject(`结束章节不能超过总章节数(${chapterCount})`);
                                  }
                                  return Promise.resolve();
                                }
                              })
                            ]}
                          >
                            <InputNumber
                              min={1}
                              max={chapterCount || MAX_CHAPTER_COUNT}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    );
                  }
                  return null;
                }}
              </Form.Item>

              <Form.Item
                label="额外要求"
                name="additionalRequirements"
                extra="如需加粗重要内容（如金额、重要物品等），请直接说明即可，系统会自动处理格式，无需输入 Markdown 标记"
              >
                <TextArea rows={2} placeholder="其他特殊要求或说明" />
              </Form.Item>

              <Form.Item label="禁止内容" name="forbiddenContent">
                <TextArea rows={2} placeholder="每行一个禁止出现的内容" />
              </Form.Item>
            </Collapse.Panel>

            <Collapse.Panel key="model" header="模型参数" icon={<SettingOutlined />}>
              <Form.Item name="temperature" label="Temperature" initialValue={DEFAULT_WRITING_CONFIG.temperature}>
                <Slider min={0} max={2} step={0.1} tooltip={{ formatter: (v) => v?.toFixed(1) }} />
              </Form.Item>
              <Form.Item name="maxTokens" label="最大 Token" initialValue={DEFAULT_WRITING_CONFIG.maxTokens}>
                <Slider min={1000} max={32000} step={1000} tooltip={{ formatter: (v) => v?.toLocaleString() }} />
              </Form.Item>
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                AI 模型使用全局引擎设置中的配置，可在「设置 → AI引擎设置」中修改
              </div>
            </Collapse.Panel>
          </Collapse>

          {isGenerating && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>AI 生成中...</span>
                <Button danger onClick={handleCancelGeneration}>取消生成</Button>
              </div>
              <TextArea
                ref={streamRef}
                value={streamContent}
                readOnly
                rows={12}
                style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
              />
            </div>
          )}

          {error && !isGenerating && (
            <div style={{ marginTop: 16, textAlign: 'center', padding: '20px 0' }}>
              <div style={{ marginBottom: 16, color: '#ff4d4f' }}>{error}</div>
              <Button type="primary" onClick={handleRetryGeneration}>重试</Button>
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
                <Button onClick={() => {
                  form.validateFields().then(values => {
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
                      modelConfig: {
                        model: values.model || aiConfig?.model || DEFAULT_WRITING_CONFIG.model,
                        temperature: values.temperature ?? aiConfig?.temperature ?? DEFAULT_WRITING_CONFIG.temperature,
                        maxTokens: values.maxTokens ?? aiConfig?.maxTokens ?? DEFAULT_WRITING_CONFIG.maxTokens
                      },
                      manualMode: true
                    };
                    onConfirm(config);
                  }).catch(() => {
                    message.warning('请先填写必填项后再继续');
                  });
                }}>
                  手动创建大纲
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
            confirmLoading={saving}
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
