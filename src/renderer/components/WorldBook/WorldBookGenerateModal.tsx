import React, { useState, useEffect, useRef } from 'react';
import { Modal, Steps, Checkbox, Button, Card, Typography, message, Input, Spin, Space, Tag, Form, Collapse, Select, Switch, Row, Col } from 'antd';
import { ThunderboltOutlined, LoadingOutlined, CheckCircleOutlined, DeleteOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { createDefaultEntry } from '../../utils/worldBookUtils';

const { Text, Paragraph } = Typography;

interface CharacterCard {
  path: string;
  name: string;
  characterName: string;
  description?: string;
  personality?: string;
  scenario?: string;
  creatorNotes?: string;
  tags?: string[];
}

interface WorldBookGenerateModalProps {
  open: boolean;
  onCancel: () => void;
  onCreateWorldBook: (name: string, description: string, entries: any[]) => void;
  onGenerateFromCharacters: (charactersInfo: string, instructions: string) => Promise<{ name: string; description: string; entries: any[] }>;
}

const WorldBookGenerateModal: React.FC<WorldBookGenerateModalProps> = ({
  open,
  onCancel,
  onCreateWorldBook,
  onGenerateFromCharacters
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [selectedCharacterPaths, setSelectedCharacterPaths] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [worldBookName, setWorldBookName] = useState('');
  const [worldBookDescription, setWorldBookDescription] = useState('');
  const [generatedEntries, setGeneratedEntries] = useState<any[]>([]);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [generateInstructions, setGenerateInstructions] = useState('');
  const [form] = Form.useForm();
  const isGeneratingRef = useRef(false);

  useEffect(() => {
    if (open && currentStep === 0) {
      loadCharacters();
    }
  }, [open, currentStep]);

  const loadCharacters = async () => {
    setIsLoadingCharacters(true);
    try {
      const result = await window.electronAPI.character.list();
      const charList = Array.isArray(result) ? result : [];
      
      const detailedChars: CharacterCard[] = [];
      for (const char of charList) {
        try {
          const charData = await window.electronAPI.character.read(char.path);
          detailedChars.push({
            path: char.path,
            name: char.name,
            characterName: char.characterName || char.name,
            description: charData?.data?.description || '',
            personality: charData?.data?.personality || '',
            scenario: charData?.data?.scenario || '',
            creatorNotes: charData?.data?.creator_notes || '',
            tags: charData?.data?.tags || []
          });
        } catch {
          detailedChars.push({
            path: char.path,
            name: char.name,
            characterName: char.characterName || char.name
          });
        }
      }
      
      setCharacters(detailedChars);
    } catch (error) {
      message.error(`加载角色卡失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoadingCharacters(false);
    }
  };

  const handleCharacterSelect = (checkedValues: string[]) => {
    setSelectedCharacterPaths(checkedValues);
  };

  const handleNextStep = () => {
    if (currentStep === 0) {
      if (selectedCharacterPaths.length === 0) {
        message.warning('请至少选择一个角色卡');
        return;
      }
      setCurrentStep(1);
    } else if (currentStep === 1) {
      setCurrentStep(2);
    }
  };

  const handlePrevStep = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
  };

  const handleGenerate = async () => {
    if (selectedCharacterPaths.length === 0) {
      message.warning('请先选择角色卡');
      return;
    }

    setIsGenerating(true);
    isGeneratingRef.current = true;
    try {
      const selectedChars = characters.filter(c => selectedCharacterPaths.includes(c.path));
      
      const charInfoText = selectedChars.map((char, index) => {
        let info = `角色 ${index + 1}：${char.characterName || char.name}`;
        if (char.description) info += `\n描述：${char.description}`;
        if (char.personality) info += `\n性格：${char.personality}`;
        if (char.scenario) info += `\n场景：${char.scenario}`;
        if (char.creatorNotes) info += `\n创作者备注：${char.creatorNotes}`;
        if (char.tags && char.tags.length > 0) info += `\n标签：${char.tags.join(', ')}`;
        return info;
      }).join('\n\n---\n\n');

      const result = await onGenerateFromCharacters(charInfoText, generateInstructions);

      if (!isGeneratingRef.current) {
        message.info('已中断生成');
        return;
      }

      setWorldBookName(result.name || '未命名世界书');
      setWorldBookDescription(result.description || '');

      const entries = result.entries.map((entry: any, index: number) => {
        return createDefaultEntry(
          index,
          Array.isArray(entry.key) ? entry.key : [],
          entry.comment || '',
          entry.content || ''
        );
      });

      setGeneratedEntries(entries);
      message.success('生成成功，请检查并调整生成结果');
    } catch (error) {
      if (!isGeneratingRef.current) {
        message.info('已中断生成');
        return;
      }
      message.error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGenerating(false);
      isGeneratingRef.current = false;
    }
  };

  const handleCancelGeneration = () => {
    isGeneratingRef.current = false;
    window.electronAPI?.ai?.cancel?.();
    message.info('正在中断AI请求...');
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

  const handleCreate = async () => {
    if (!worldBookName) {
      message.warning('请输入世界书名称');
      return;
    }

    if (generatedEntries.length === 0) {
      message.warning('没有可保存的条目');
      return;
    }

    onCreateWorldBook(worldBookName, worldBookDescription, generatedEntries);
    handleReset();
  };

  const handleReset = () => {
    setCurrentStep(0);
    setSelectedCharacterPaths([]);
    setWorldBookName('');
    setWorldBookDescription('');
    setGeneratedEntries([]);
    setGenerateInstructions('');
    form.resetFields();
  };

  const handleClose = () => {
    handleReset();
    onCancel();
  };

  const getSelectedCharactersInfo = () => {
    return characters
      .filter(c => selectedCharacterPaths.includes(c.path))
      .map(c => c.characterName || c.name);
  };

  const renderEntryEditor = (entry: any, index: number, readonly = false) => {
    return (
      <Card
        key={index}
        size="small"
        style={{ marginBottom: 12 }}
        type="inner"
        title={
          <Space>
            <span>条目 {index + 1}</span>
            {!readonly && (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteEntry(index)}
              >
                删除
              </Button>
            )}
          </Space>
        }
      >
        <Row gutter={16}>
          <Col span={12}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>注释</Text>
              <Input
                value={entry.comment}
                onChange={(e) => !readonly && handleEntryChange(index, 'comment', e.target.value)}
                placeholder="条目注释"
                disabled={readonly}
              />
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>次要关键词（逗号分隔）</Text>
              <Input
                value={Array.isArray(entry.keysecondary) ? entry.keysecondary.join(', ') : ''}
                onChange={(e) => !readonly && handleEntryChange(index, 'keysecondary', e.target.value.split(/[,，]/).map((k: string) => k.trim()).filter((k: string) => k))}
                placeholder="次要关键词"
                disabled={readonly}
              />
            </div>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>触发概率</Text>
              <Input
                type="number"
                value={entry.probability || 100}
                onChange={(e) => !readonly && handleEntryChange(index, 'probability', Number(e.target.value))}
                disabled={readonly}
              />
            </div>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>插入顺序</Text>
              <Input
                type="number"
                value={entry.order ?? 0}
                onChange={(e) => !readonly && handleEntryChange(index, 'order', Number(e.target.value))}
                disabled={readonly}
              />
            </div>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>插入深度</Text>
              <Input
                type="number"
                value={entry.depth ?? 0}
                onChange={(e) => !readonly && handleEntryChange(index, 'depth', Number(e.target.value))}
                disabled={readonly}
              />
            </div>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>插入位置</Text>
              <Select
                value={entry.position || 'after_char'}
                onChange={(value) => !readonly && handleEntryChange(index, 'position', value)}
                style={{ width: '100%' }}
                disabled={readonly}
              >
                <Select.Option value="after_char">角色后</Select.Option>
                <Select.Option value="before_char">角色前</Select.Option>
                <Select.Option value="after_def">默认后</Select.Option>
              </Select>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>分组</Text>
              <Input
                value={entry.group || ''}
                onChange={(e) => !readonly && handleEntryChange(index, 'group', e.target.value)}
                placeholder="分组名称"
                disabled={readonly}
              />
            </div>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>常开</Text>
              <div style={{ marginTop: 4 }}>
                <Switch
                  checked={entry.constant || false}
                  onChange={(checked) => !readonly && handleEntryChange(index, 'constant', checked)}
                  disabled={readonly}
                />
              </div>
            </div>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>选择性触发</Text>
              <div style={{ marginTop: 4 }}>
                <Switch
                  checked={entry.selective || false}
                  onChange={(checked) => !readonly && handleEntryChange(index, 'selective', checked)}
                  disabled={readonly}
                />
              </div>
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>已禁用</Text>
              <div style={{ marginTop: 4 }}>
                <Switch
                  checked={entry.disable || false}
                  onChange={(checked) => !readonly && handleEntryChange(index, 'disable', checked)}
                  disabled={readonly}
                />
              </div>
            </div>
          </Col>
        </Row>

        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>内容</Text>
          <Input.TextArea
            value={entry.content}
            onChange={(e) => !readonly && handleEntryChange(index, 'content', e.target.value)}
            placeholder="条目内容"
            rows={4}
            disabled={readonly}
          />
        </div>

        {entry.tags && Array.isArray(entry.tags) && entry.tags.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>标签： </Text>
            {entry.tags.map((tag: string, i: number) => (
              <Tag key={i} style={{ marginRight: 4, marginBottom: 4 }}>{tag}</Tag>
            ))}
          </div>
        )}
      </Card>
    );
  };

  return (
    <Modal
      title="从角色卡生成世界书"
      open={open}
      onCancel={handleClose}
      width={1000}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          取消
        </Button>,
        currentStep > 0 && (
          <Button key="prev" onClick={handlePrevStep}>
            上一步
          </Button>
        ),
        currentStep < 2 && (
          <Button key="next" type="primary" onClick={handleNextStep}>
            下一步
          </Button>
        ),
        currentStep === 2 && (
          <Button
            key="create"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={handleCreate}
          >
            确认创建
          </Button>
        )
      ]}
      style={{
        backgroundColor: 'var(--bg-container, #1f1f1f)',
        color: 'var(--text-primary, #ffffff)'
      }}
    >
      <div style={{ color: 'var(--text-primary, #ffffff)' }}>
        <Steps
          current={currentStep}
          style={{ marginBottom: 24 }}
          items={[
            {
              title: '选择参考角色卡',
              description: '选择要作为参考的角色卡'
            },
            {
              title: 'AI生成预览与调整',
              description: 'AI基于角色卡生成世界书'
            },
            {
              title: '确认创建',
              description: '检查并确认创建世界书'
            }
          ]}
        />

        {currentStep === 0 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>请选择要作为参考的角色卡（可多选）：</Text>
            </div>
            
            {isLoadingCharacters ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="large" />
                <div style={{ marginTop: 16 }}>加载角色卡中...</div>
              </div>
            ) : characters.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Text type="secondary">没有找到角色卡，请先创建角色卡</Text>
              </div>
            ) : (
              <Checkbox.Group
                style={{ width: '100%' }}
                value={selectedCharacterPaths}
                onChange={handleCharacterSelect}
              >
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {characters.map(char => (
                    <Card
                      key={char.path}
                      size="small"
                      style={{ marginBottom: 8, cursor: 'pointer', backgroundColor: 'var(--bg-container, #1f1f1f)', color: 'var(--text-primary, #ffffff)', border: '1px solid var(--border-base, #333)' }}
                      hoverable
                    >
                      <Checkbox value={char.path}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                            {char.characterName || char.name}
                          </div>
                          {char.tags && char.tags.length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              {char.tags.slice(0, 5).map((tag, i) => (
                                <Tag key={i} style={{ marginRight: 4, marginBottom: 4 }}>
                                  {tag}
                                </Tag>
                              ))}
                              {char.tags.length > 5 && (
                                <Tag>+{char.tags.length - 5}</Tag>
                              )}
                            </div>
                          )}
                          {char.description && (
                            <Paragraph
                              ellipsis={{ rows: 2 }}
                              style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary, #8c8c8c)' }}
                            >
                              {char.description}
                            </Paragraph>
                          )}
                        </div>
                      </Checkbox>
                    </Card>
                  ))}
                </div>
              </Checkbox.Group>
            )}

            {selectedCharacterPaths.length > 0 && (
              <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--bg-elevated, #2a2a2a)', borderRadius: 4, border: '1px solid var(--border-base, #333)' }}>
                <Text strong>已选择 {selectedCharacterPaths.length} 个角色卡：</Text>
                <div style={{ marginTop: 4 }}>
                  {getSelectedCharactersInfo().map((name, i) => (
                    <Tag key={i} color="blue" style={{ marginRight: 4, marginBottom: 4 }}>
                      {name}
                    </Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 1 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>已选择的角色卡：</Text>
              <div style={{ marginTop: 4 }}>
                {getSelectedCharactersInfo().map((name, i) => (
                  <Tag key={i} color="blue" style={{ marginRight: 4, marginBottom: 4 }}>
                    {name}
                  </Tag>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Text strong>生成指令（可选）：</Text>
              <Input.TextArea
                rows={3}
                placeholder="请输入生成指令，例如：生成偏向可爱风格的内容、增加更多战斗规则、生成魔法相关的场景和物品..."
                value={generateInstructions}
                onChange={(e) => setGenerateInstructions(e.target.value)}
                style={{ marginTop: 8 }}
              />
            </div>

            {isGenerating ? (
              <Space style={{ marginBottom: 16 }}>
                <Button
                  type="primary"
                  icon={<LoadingOutlined />}
                  loading
                  disabled
                >
                  AI生成中...
                </Button>
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={handleCancelGeneration}
                >
                  中断生成
                </Button>
              </Space>
            ) : (
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={handleGenerate}
                style={{ marginBottom: 16 }}
              >
                AI生成世界书
              </Button>
            )}

            {generatedEntries.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong>已生成 {generatedEntries.length} 个条目</Text>
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
        )}

        {currentStep === 2 && (
          <div>
            <Form form={form} layout="vertical">
              <Form.Item label="世界书名称" required>
                <Input
                  value={worldBookName}
                  onChange={(e) => setWorldBookName(e.target.value)}
                  placeholder="请输入世界书名称"
                />
              </Form.Item>

              <Form.Item label="世界书简介">
                <Input.TextArea
                  value={worldBookDescription}
                  onChange={(e) => setWorldBookDescription(e.target.value)}
                  placeholder="请输入世界书简介"
                  rows={4}
                />
              </Form.Item>
            </Form>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
              <Text strong>生成条目（共 {generatedEntries.length} 个）</Text>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {generatedEntries.map((entry, index) => renderEntryEditor(entry, index))}
            </div>

            <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--bg-elevated, #2a2a2a)', borderRadius: 4, border: '1px solid var(--border-base, #333)' }}>
              <Space>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <Text>参考角色卡：{getSelectedCharactersInfo().join(', ')}</Text>
              </Space>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default WorldBookGenerateModal;
