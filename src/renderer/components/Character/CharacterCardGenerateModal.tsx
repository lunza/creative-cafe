import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Checkbox,
  Card,
  Typography,
  message,
  Steps,
  Space,
  Tag,
  Spin,
  Descriptions,
  Divider
} from 'antd';
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  StopOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { sendCharacterAIRequest } from '../../utils/characterAIUtils';

const { Text, Paragraph } = Typography;

interface WorldBookItem {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

interface WorldBookWithContent extends WorldBookItem {
  content?: any;
}

interface CharacterCardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string[];
  creator_notes: string;
  nickname: string;
  source: string;
  character_version: string;
  creator: string;
  post_history_instructions: string;
  tags: string[];
  alternate_greetings: string[];
  extensions: Record<string, any>;
  group_only_greetings: string[];
}

interface CharacterCardGenerateModalProps {
  open: boolean;
  onCancel: () => void;
  onCreateCharacterCard: (characterCardData: CharacterCardData) => void;
}

const CharacterCardGenerateModal: React.FC<CharacterCardGenerateModalProps> = ({
  open,
  onCancel,
  onCreateCharacterCard
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [worldBooks, setWorldBooks] = useState<WorldBookWithContent[]>([]);
  const [selectedWorldBookPaths, setSelectedWorldBookPaths] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCard, setGeneratedCard] = useState<CharacterCardData | null>(null);
  const [editingCard, setEditingCard] = useState<CharacterCardData | null>(null);
  const [isLoadingWorldBooks, setIsLoadingWorldBooks] = useState(false);
  const setting = useSettingStore(s => s.setting);
  const fetchSetting = useSettingStore(s => s.fetchSetting);
  const isGeneratingRef = useRef(false);

  useEffect(() => {
    if (open) {
      loadWorldBooks();
      fetchSetting();
    }
  }, [open]);

  const loadWorldBooks = async () => {
    setIsLoadingWorldBooks(true);
    try {
      const books = await window.electronAPI.worldBook.list();
      const bookList = books || [];
      
      const booksWithContent: WorldBookWithContent[] = [];
      for (const book of bookList) {
        try {
          const content = await window.electronAPI.worldBook.read(book.path);
          const entriesSummary = content?.entries ? Object.entries(content.entries).slice(0, 10).map(([key, entry]: [string, any]) => {
            return `条目 ${key}: ${entry.comment || '无标题'} | 关键词: ${Array.isArray(entry.key) ? entry.key.join(', ') : ''}`;
          }).join('\n') : '无条目';
          
          booksWithContent.push({
            ...book,
            content: {
              name: content?.name || book.name,
              description: content?.description || '',
              entriesSummary
            }
          });
        } catch {
          booksWithContent.push({ ...book, content: undefined });
        }
      }
      
      setWorldBooks(booksWithContent);
    } catch (error) {
      message.error(`加载世界书列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoadingWorldBooks(false);
    }
  };

  const getActiveEngineConfig = () => {
    if (!setting) return null;
    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      if (activeEngine) return activeEngine;
    }
    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }
    return null;
  };

  const buildGenerationPrompt = (): string => {
    const params = form.getFieldsValue();
    let prompt = `请根据以下参考信息和参数，创建一个完整的SillyTavern角色卡。

【参考世界书内容】
`;

    selectedWorldBookPaths.forEach(path => {
      const book = worldBooks.find(wb => wb.path === path);
      if (book) {
        prompt += `## 世界书: ${book.content?.name || book.name}\n`;
        if (book.content?.description) prompt += `简介: ${book.content.description}\n`;
        if (book.content?.entriesSummary) prompt += `核心条目:\n${book.content.entriesSummary}\n`;
        prompt += '\n';
      }
    });

    prompt += `【角色参数】\n`;
    if (params.characterRole) prompt += `- 角色定位: ${params.characterRole}\n`;
    if (params.personalityTraits) prompt += `- 性格特征: ${params.personalityTraits}\n`;
    if (params.abilities) prompt += `- 能力设定: ${params.abilities}\n`;
    if (params.appearance) prompt += `- 外观描述: ${params.appearance}\n`;
    if (params.relationships) prompt += `- 关系描述: ${params.relationships}\n`;

    prompt += `\n请生成符合以下JSON格式的角色卡数据：
{
  "name": "角色名称",
  "description": "角色详细描述",
  "personality": "角色性格描述",
  "scenario": "场景设定",
  "first_mes": "角色首次对话消息",
  "mes_example": ["对话示例1", "对话示例2"],
  "creator_notes": "创建者笔记",
  "nickname": "昵称",
  "source": "来源",
  "character_version": "角色版本",
  "creator": "创建者",
  "post_history_instructions": "历史记录后指令",
  "tags": ["标签1", "标签2"],
  "alternate_greetings": ["问候语1", "问候语2"],
  "group_only_greetings": [],
  "extensions": {}
}

【要求】
1. 所有字段都应该有合理的内容，即使是空字符串也应该明确为空字符串
2. description、personality、scenario 应该详细且符合角色设定
3. first_mes 应该体现角色性格和说话方式
4. mes_example 应该包含至少2-3轮对话示例，格式为 <START>\\n角色名：对话内容
5. tags 应该是相关的关键词数组
6. 请只返回JSON数据，不要包含其他说明文字`;

    return prompt;
  };

  const handleGenerate = async () => {
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) {
      message.error('请先在配置管理中设置AI引擎');
      return;
    }

    if (!activeEngine.api_url) {
      message.error('API地址不能为空');
      return;
    }

    setIsGenerating(true);
    isGeneratingRef.current = true;
    try {
      const promptResult = await window.electronAPI.prompt.build('character-card.generate', {});
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      const systemPrompt = promptResult.data.systemPrompt;

      const userPrompt = buildGenerationPrompt();

      const result = await sendCharacterAIRequest(activeEngine, systemPrompt, userPrompt);

      if (!isGeneratingRef.current) {
        message.info('已中断生成');
        return;
      }

      if (!result) {
        message.error('AI未返回有效内容，请重试');
        return;
      }

      // 尝试解析AI返回的JSON
      let parsedData: Partial<CharacterCardData>;
      try {
        // 尝试直接解析
        parsedData = JSON.parse(result);
      } catch {
        // 尝试从markdown代码块中提取
        const cleaned = result.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        try {
          parsedData = JSON.parse(cleaned);
        } catch {
          // 尝试找到第一个{和最后一个}
          const firstBrace = result.indexOf('{');
          const lastBrace = result.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const extracted = result.substring(firstBrace, lastBrace + 1);
            parsedData = JSON.parse(extracted);
          } else {
            throw new Error('无法解析AI返回的数据');
          }
        }
      }

      // 创建完整的角色卡数据，使用默认值填充缺失字段
      const defaultCard: CharacterCardData = {
        name: parsedData.name || '新角色',
        description: parsedData.description || '',
        personality: parsedData.personality || '',
        scenario: parsedData.scenario || '',
        first_mes: parsedData.first_mes || '',
        mes_example: Array.isArray(parsedData.mes_example) ? parsedData.mes_example : [],
        creator_notes: parsedData.creator_notes || '',
        nickname: parsedData.nickname || '',
        source: parsedData.source || '',
        character_version: parsedData.character_version || '',
        creator: parsedData.creator || '',
        post_history_instructions: parsedData.post_history_instructions || '',
        tags: Array.isArray(parsedData.tags) ? parsedData.tags : [],
        alternate_greetings: Array.isArray(parsedData.alternate_greetings) ? parsedData.alternate_greetings : [],
        extensions: parsedData.extensions || {},
        group_only_greetings: Array.isArray(parsedData.group_only_greetings) ? parsedData.group_only_greetings : []
      };

      setGeneratedCard(defaultCard);
      setEditingCard(defaultCard);
      setCurrentStep(1);
      message.success('角色卡生成成功！请在下一步中预览和调整');
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

  const handleCreate = () => {
    if (!editingCard) {
      message.error('没有可创建的角色卡数据');
      return;
    }
    onCreateCharacterCard(editingCard);
  };

  const handleReset = () => {
    form.resetFields();
    setSelectedWorldBookPaths([]);
    setGeneratedCard(null);
    setEditingCard(null);
    setCurrentStep(0);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <Form form={form} layout="vertical">
              <Card
                title={
                  <Space>
                    <FileTextOutlined />
                    <span>选择参考世界书</span>
                  </Space>
                }
                style={{ marginBottom: 16 }}
                size="small"
              >
                {isLoadingWorldBooks ? (
                  <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
                ) : worldBooks.length === 0 ? (
                  <Text type="secondary">暂无世界书，可跳过直接使用参数生成</Text>
                ) : (
                  <Checkbox.Group
                    value={selectedWorldBookPaths}
                    onChange={(checkedValues) => setSelectedWorldBookPaths(checkedValues as string[])}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {worldBooks.map(book => (
                      <Checkbox key={book.path} value={book.path}>
                        <Space>
                          <Tag color="blue">{book.name}</Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {(book.size / 1024).toFixed(1)} KB
                          </Text>
                        </Space>
                      </Checkbox>
                    ))}
                  </Checkbox.Group>
                )}
              </Card>

              <Card
                title={
                  <Space>
                    <ThunderboltOutlined />
                    <span>角色参数配置（可选）</span>
                  </Space>
                }
                size="small"
              >
                <Form.Item name="characterRole" label="角色定位">
                  <Input.TextArea
                    rows={2}
                    placeholder="例如：主角、反派、导师、伙伴等"
                  />
                </Form.Item>

                <Form.Item name="personalityTraits" label="性格特征">
                  <Input.TextArea
                    rows={2}
                    placeholder="例如：冷静、傲娇、活泼、腹黑等"
                  />
                </Form.Item>

                <Form.Item name="abilities" label="能力设定">
                  <Input.TextArea
                    rows={2}
                    placeholder="例如：魔法能力、战斗技能、特殊天赋等"
                  />
                </Form.Item>

                <Form.Item name="appearance" label="外观描述">
                  <Input.TextArea
                    rows={2}
                    placeholder="例如：发色、瞳色、服装风格、体型特征等"
                  />
                </Form.Item>

                <Form.Item name="relationships" label="关系描述">
                  <Input.TextArea
                    rows={2}
                    placeholder="例如：与其他角色的关系、社会地位、家族背景等"
                  />
                </Form.Item>
              </Card>
            </Form>
          </div>
        );

      case 1:
        return (
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {editingCard && (
              <Card
                title={
                  <Space>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <span>角色卡预览与调整</span>
                  </Space>
                }
                size="small"
              >
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="角色名称">
                    <Input
                      value={editingCard.name}
                      onChange={(e) => setEditingCard({ ...editingCard, name: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="昵称">
                    <Input
                      value={editingCard.nickname}
                      onChange={(e) => setEditingCard({ ...editingCard, nickname: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="描述">
                    <Input.TextArea
                      rows={4}
                      value={editingCard.description}
                      onChange={(e) => setEditingCard({ ...editingCard, description: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="性格">
                    <Input.TextArea
                      rows={2}
                      value={editingCard.personality}
                      onChange={(e) => setEditingCard({ ...editingCard, personality: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="场景">
                    <Input.TextArea
                      rows={2}
                      value={editingCard.scenario}
                      onChange={(e) => setEditingCard({ ...editingCard, scenario: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="初始消息">
                    <Input.TextArea
                      rows={3}
                      value={editingCard.first_mes}
                      onChange={(e) => setEditingCard({ ...editingCard, first_mes: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="示例消息">
                    <Input.TextArea
                      rows={4}
                      value={Array.isArray(editingCard.mes_example) ? editingCard.mes_example.join('\n\n') : ''}
                      onChange={(e) => setEditingCard({ ...editingCard, mes_example: e.target.value.split('\n\n').filter(Boolean) })}
                      placeholder="每段对话示例之间用空行分隔"
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="标签">
                    <Input
                      value={Array.isArray(editingCard.tags) ? editingCard.tags.join(', ') : ''}
                      onChange={(e) => setEditingCard({ ...editingCard, tags: e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean) })}
                      placeholder="用逗号分隔多个标签"
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="创建者">
                    <Input
                      value={editingCard.creator}
                      onChange={(e) => setEditingCard({ ...editingCard, creator: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="角色版本">
                    <Input
                      value={editingCard.character_version}
                      onChange={(e) => setEditingCard({ ...editingCard, character_version: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="来源">
                    <Input
                      value={editingCard.source}
                      onChange={(e) => setEditingCard({ ...editingCard, source: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="创建者笔记">
                    <Input.TextArea
                      rows={3}
                      value={editingCard.creator_notes}
                      onChange={(e) => setEditingCard({ ...editingCard, creator_notes: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="历史记录后指令">
                    <Input.TextArea
                      rows={2}
                      value={editingCard.post_history_instructions}
                      onChange={(e) => setEditingCard({ ...editingCard, post_history_instructions: e.target.value })}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="替代问候">
                    <Input.TextArea
                      rows={2}
                      value={Array.isArray(editingCard.alternate_greetings) ? editingCard.alternate_greetings.join('\n\n') : ''}
                      onChange={(e) => setEditingCard({ ...editingCard, alternate_greetings: e.target.value.split('\n\n').filter(Boolean) })}
                      placeholder="每个问候语之间用空行分隔"
                    />
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      title="AI生成角色卡"
      open={open}
      onCancel={() => {
        onCancel();
        handleReset();
      }}
      width={1000}
      footer={
        currentStep === 0 ? [
          <Button key="cancel" onClick={() => {
            onCancel();
            handleReset();
          }}>
            取消
          </Button>,
          isGenerating ? (
            <Space key="generate">
              <Button
                type="primary"
                icon={<LoadingOutlined />}
                loading
                disabled
              >
                生成中...
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleCancelGeneration}
              >
                中断
              </Button>
            </Space>
          ) : (
            <Button
              key="generate"
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
            >
              AI生成角色卡
            </Button>
          )
        ] : currentStep === 1 ? [
          <Button key="back" onClick={() => setCurrentStep(0)}>
            返回修改
          </Button>,
          <Button key="create" type="primary" onClick={handleCreate}>
            确认创建角色卡
          </Button>
        ] : null
      }
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
              title: '选择参考与参数',
              description: '选择世界书并填写角色参数'
            },
            {
              title: '预览与调整',
              description: '查看生成的角色卡并进行调整'
            }
          ]}
        />

        {isGenerating ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <Paragraph style={{ marginTop: 16 }}>
              AI正在根据您选择的参考和参数生成角色卡...
            </Paragraph>
          </div>
        ) : (
          renderStepContent()
        )}
      </div>
    </Modal>
  );
};

export default CharacterCardGenerateModal;
