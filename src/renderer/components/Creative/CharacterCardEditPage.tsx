import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Breadcrumb, Button, Card, Space, Typography, message, Modal, Form, Select, Input, Divider, Descriptions, Spin } from 'antd';
import {
  HomeOutlined,
  UserOutlined,
  EditOutlined,
  SaveOutlined,
  RocketOutlined,
  DownloadOutlined,
  ArrowLeftOutlined,
  LoadingOutlined,
  UploadOutlined,
  DeleteOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import MarkdownEditor from '../Common/MarkdownEditor';
import { useCreativeStore } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';
import { useCreativeAI } from './hooks/useCreativeAI';
import { formatCharacterCardV3, downloadCharacterCardPNG } from './utils/exportFormatters';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface FormattedFields {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
}

const CharacterCardEditPage: React.FC = () => {
  const { theme, setCreativeTab, setCreativeView } = useUIStore();
  const {
    currentCreativeId,
    creatives,
    updateCharacterCard,
    loadCreatives
  } = useCreativeStore();
  const { generate, isEngineConfigured } = useCreativeAI();

  const creative = currentCreativeId ? creatives.find(c => c.id === currentCreativeId) : null;
  const characterCard = creative?.characterCard;

  const [editingContent, setEditingContent] = useState(characterCard?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiForm] = Form.useForm();
  const [aiLoading, setAiLoading] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState('');
  const [streamingContent, setStreamingContent] = useState('');

  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [cardImage, setCardImage] = useState<string>(characterCard?.image || '');
  const [formattedFields, setFormattedFields] = useState<FormattedFields | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);
  const [isSavingToDir, setIsSavingToDir] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCreatives();
  }, [loadCreatives]);

  useEffect(() => {
    if (characterCard) {
      setEditingContent(characterCard.content || '');
      setCardImage(characterCard.image || '');
      setFormattedFields(null);
    }
  }, [characterCard]);

  const handleSave = async () => {
    if (!currentCreativeId) {
      message.error('请先选择创意！');
      return;
    }

    setIsSaving(true);
    try {
      updateCharacterCard(currentCreativeId, {
        content: editingContent,
        image: cardImage || undefined
      });
      message.success('角色卡已保存！');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存失败';
      message.error(`保存失败：${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAIGenerate = async (values: any) => {
    if (!creative || !characterCard) {
      message.error('请先选择创意和角色卡！');
      return;
    }

    if (!isEngineConfigured) {
      message.error('请在设置中配置AI引擎');
      return;
    }

    setAiLoading(true);
    setStreamingContent('');
    setGeneratedPreview('');

    try {
      const templateId = values.templateId || 'character_card';
      const result = await generate({
        creativeContent: creative.content || '',
        type: 'character',
        templateId,
        userRequirements: values.requirements,
        streaming: true,
        onStream: (chunk: string) => {
          setStreamingContent(prev => prev + chunk);
        }
      });

      if (result.success && result.data?.content) {
        setGeneratedPreview(result.data.content);
      } else {
        message.error(result.error || '生成失败');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成失败';
      message.error(errorMessage);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveGeneratedContent = () => {
    const contentToSave = generatedPreview || streamingContent;
    if (!contentToSave) {
      message.warning('没有可保存的内容');
      return;
    }

    if (!currentCreativeId) {
      message.error('请先选择创意！');
      return;
    }

    setEditingContent(contentToSave);
    updateCharacterCard(currentCreativeId, {
      content: contentToSave
    });
    message.success('已保存到编辑器');
    setAiModalVisible(false);
    aiForm.resetFields();
    setGeneratedPreview('');
    setStreamingContent('');
  };

  const handleFormatCard = async () => {
    if (!characterCard || !characterCard.content) {
      message.warning('角色卡内容为空，无法格式化');
      return;
    }

    if (!isEngineConfigured) {
      message.error('请在设置中配置AI引擎');
      return;
    }

    setIsFormatting(true);
    setFormattedFields(null);

    try {
      const formatSystemPrompt = `你是一个专业的 SillyTavern 角色卡内容解析与结构化助手。你的任务是深入分析用户提供的 Markdown 角色卡内容，提取、重组并输出符合 SillyTavern V3 标准的 JSON 格式数据。

═══════════════════════════════════════════════════════
【第一步：深度分析】
在提取字段之前，请先从以下维度理解角色：
1. 角色身份：姓名、职业、身份地位、年龄、性别
2. 外貌特征：外表描述、穿着打扮、标志性特征
3. 性格画像：核心性格、行为习惯、价值观、弱点
4. 背景故事：成长经历、重要事件、人物关系
5. 语言风格：说话方式、常用词汇、语气特点
6. 世界设定：所处时代、环境背景、特殊规则

═══════════════════════════════════════════════════════
【第二步：逐字段提取与重组】

请严格按照以下规则输出每个字段：

{
  "name": "角色全名（从标题、#角色名称 或正文中提取）",

  "description": "角色描述（100-300字）。必须包含：\n- 角色的外貌特征（外貌、穿着、体型等）\n- 身份背景（职业、地位、家族等）\n- 基本人物设定（核心特点概述）\n- 如有多个段落，请用空行分隔",

  "personality": "性格特点（80-200字）。必须包含：\n- 核心性格特征（外向/内向、理性/感性等）\n- 行为习惯与偏好\n- 价值观与信念\n- 弱点或矛盾之处\n- 如有多个特点，请用段落或列表形式组织",

  "scenario": "场景设定（50-150字）。必须包含：\n- 角色所处的时代背景\n- 故事发生的环境/地点\n- 世界观设定（如科幻、奇幻、现代等）\n- 角色在当前场景中的状态",

  "first_mes": "角色的第一条消息/开场白（完整对话）。要求：\n- 以角色的口吻直接说出\n- 体现角色性格和语言风格\n- 包含动作描写（用*号包裹）和对话\n- 长度 50-200字\n- 示例：*她微微歪头看着你，嘴角扬起一抹狡黠的微笑* 「呀，来了一位新朋友呢～我是{{char}}，请多指教哦！」",

  "mes_example": "对话示例（多轮对话，使用 <START> 分隔）。要求：\n- 至少包含 2-3 组 <START> 开头的对话\n- 每组对话必须包含 {{user}} 和 {{char}} 的互动\n- 体现角色的说话风格、习惯用语、情绪反应\n- 用 *号* 包裹动作/表情描写\n- 严格遵循以下格式模板：\n<START>\n{{user}}: 你好呀\n{{char}}: *她抬起头，眼睛亮了起来* 啊，你好！欢迎来到这里～\n\n<START>\n{{user}}: 你是谁？\n{{char}}: *她轻笑一声* 我是{{char}}，这里的主人。很高兴认识你！",

  "creator_notes": "创作者备注。包含：\n- 对角色设计的额外说明\n- 使用建议或注意事项\n- 创作者的创作理念或寄语",

  "system_prompt": "系统提示（AI扮演该角色的指令）。要求：\n- 明确AI需要扮演的角色身份\n- 规定回复的语言风格和语气\n- 列出必须遵守的行为规则\n- 指定禁止的行为\n- 示例：你将扮演{{char}}这个角色。始终以第一人称回复，保持[性格特征]的说话风格。禁止打破角色设定。",

  "post_history_instructions": "对话后处理指令。例如：\n- 保持角色一致性检查\n- 记忆重要对话内容\n- 根据对话推进剧情"
}

═══════════════════════════════════════════════════════
【第三步：严格输出要求】

1. 你的回复必须且只能包含一个 JSON 对象
2. 不要使用 markdown 代码块包裹（不要用 \`\`\`json ）
3. 不要在 JSON 前后添加任何解释、前言或后记
4. 所有换行符必须使用 \\n 转义
5. 所有双引号必须使用 \\" 转义
6. 找不到的字段设为空字符串 ""，不要省略任何键
7. 所有字段必须存在，即使内容为空

═══════════════════════════════════════════════════════
【直接输出以下格式的 JSON，不要有任何其他内容】

{"name":"","description":"","personality":"","scenario":"","first_mes":"","mes_example":"","creator_notes":"","system_prompt":"","post_history_instructions":""}

═══════════════════════════════════════════════════════
【角色卡内容】

`;

      const result = await generate({
        creativeContent: characterCard.content,
        type: 'character',
        templateId: 'character_card',
        streaming: false,
        customPrompt: formatSystemPrompt,
      });

      if (!result.success || !result.data?.content) {
        message.error(result.error || '格式化失败');
        return;
      }

      let parsed: any = null;
      let cleaned = result.data.content.trim();

      // 策略1: 直接解析
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // 策略2: 移除markdown代码块标记后解析
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          // 策略3: 找到第一个{和最后一个}来提取
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const extracted = cleaned.substring(firstBrace, lastBrace + 1);
            try {
              parsed = JSON.parse(extracted);
            } catch {
              // 策略4: 修复尾部逗号等常见问题
              let fixed = extracted
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']')
                .replace(/[\u0000-\u001F]/g, '');
              try {
                parsed = JSON.parse(fixed);
              } catch (e) {
                throw new Error('JSON解析失败，请重试');
              }
            }
          }
        }
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        message.error('AI返回的数据格式不正确');
        return;
      }

      const hasAnyField = [
        'name', 'description', 'personality', 'scenario',
        'first_mes', 'mes_example', 'creator_notes',
        'system_prompt', 'post_history_instructions'
      ].some(key => parsed[key] !== undefined);

      if (!hasAnyField) {
        message.error('AI返回的数据中未找到角色卡字段，请重试');
        return;
      }

      setFormattedFields({
        name: parsed.name || '',
        description: parsed.description || '',
        personality: parsed.personality || '',
        scenario: parsed.scenario || '',
        first_mes: parsed.first_mes || '',
        mes_example: parsed.mes_example || '',
        creator_notes: parsed.creator_notes || '',
        system_prompt: parsed.system_prompt || '',
        post_history_instructions: parsed.post_history_instructions || ''
      });
      message.success('格式化成功');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '格式化失败';
      message.error(errorMessage);
    } finally {
      setIsFormatting(false);
    }
  };

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      message.error('图片大小不能超过10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setCardImage(base64);
      message.success('图片已上传');
    };
    reader.onerror = () => {
      message.error('图片读取失败');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setCardImage('');
    message.success('图片已移除');
  }, []);

  const handleExport = async () => {
    if (!characterCard) {
      message.error('没有可导出的角色卡');
      return;
    }

    setIsExporting(true);
    try {
      const cardV3 = formatCharacterCardV3(
        characterCard.name || 'Unknown Character',
        characterCard.content || '',
        creative?.tags || []
      );

      if (formattedFields) {
        if (formattedFields.name) cardV3.data.name = formattedFields.name;
        if (formattedFields.description) cardV3.data.description = formattedFields.description;
        if (formattedFields.personality) cardV3.data.personality = formattedFields.personality;
        if (formattedFields.scenario) cardV3.data.scenario = formattedFields.scenario;
        if (formattedFields.first_mes) cardV3.data.first_mes = formattedFields.first_mes;
        if (formattedFields.mes_example) cardV3.data.mes_example = formattedFields.mes_example;
        if (formattedFields.creator_notes) cardV3.data.creator_notes = formattedFields.creator_notes;
        if (formattedFields.system_prompt) cardV3.data.system_prompt = formattedFields.system_prompt;
        if (formattedFields.post_history_instructions) cardV3.data.post_history_instructions = formattedFields.post_history_instructions;
      }

      downloadCharacterCardPNG(cardV3, characterCard.name || 'character_card', cardImage || undefined);
      message.success('导出成功！');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '导出失败';
      message.error(errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToDirectory = async () => {
    if (!characterCard) {
      message.error('没有可保存的角色卡');
      return;
    }

    setIsSavingToDir(true);
    try {
      const cardV3 = formatCharacterCardV3(
        characterCard.name || 'Unknown Character',
        characterCard.content || '',
        creative?.tags || []
      );

      if (formattedFields) {
        if (formattedFields.name) cardV3.data.name = formattedFields.name;
        if (formattedFields.description) cardV3.data.description = formattedFields.description;
        if (formattedFields.personality) cardV3.data.personality = formattedFields.personality;
        if (formattedFields.scenario) cardV3.data.scenario = formattedFields.scenario;
        if (formattedFields.first_mes) cardV3.data.first_mes = formattedFields.first_mes;
        if (formattedFields.mes_example) cardV3.data.mes_example = formattedFields.mes_example;
        if (formattedFields.creator_notes) cardV3.data.creator_notes = formattedFields.creator_notes;
        if (formattedFields.system_prompt) cardV3.data.system_prompt = formattedFields.system_prompt;
        if (formattedFields.post_history_instructions) cardV3.data.post_history_instructions = formattedFields.post_history_instructions;
      }

      const filename = `${characterCard.name}_${characterCard.id}`;
      
      const checkResult = await window.electronAPI.character.checkPNGExists(filename);
      if (!checkResult.success) {
        throw new Error('检查文件失败');
      }

      if (checkResult.exists) {
        Modal.confirm({
          title: '文件已存在',
          content: `文件 "${filename}.png" 已存在于角色卡目录中，确定要覆盖吗？`,
          okText: '覆盖',
          cancelText: '取消',
          onOk: async () => {
            await savePNGToDirectory(cardV3, filename);
          }
        });
      } else {
        await savePNGToDirectory(cardV3, filename);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存失败';
      message.error(errorMessage);
    } finally {
      setIsSavingToDir(false);
    }
  };

  const savePNGToDirectory = async (cardV3: any, filename: string) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 724;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('无法创建画布');
      }

      ctx.fillStyle = '#2c2c2c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(cardV3.data.name || 'Unknown', canvas.width / 2, canvas.height / 2);

      const base64Image = canvas.toDataURL('image/png');

      const result = await window.electronAPI.character.savePNGToDirectory({
        base64Image,
        filename,
        characterData: cardV3
      });

      if (result.success) {
        message.success(`保存成功！\n路径：${result.path}`);
      } else {
        message.error(`保存失败：${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存失败';
      message.error(errorMessage);
    }
  };

  const handleBack = () => {
    setCreativeTab('character');
    setCreativeView('list');
  };

  if (!creative || !characterCard) {
    return (
      <div style={{ padding: 24 }}>
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            { title: <><HomeOutlined /> 创意管理</> },
            { title: <><UserOutlined /> 角色卡</> },
            { title: '编辑' },
          ]}
        />
        <Card>
          <Text type="secondary">请先在角色卡列表中选择要编辑的角色卡</Text>
        </Card>
      </div>
    );
  }

  return (
    <div className={`character-card-edit-page ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`} style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <><HomeOutlined /> 创意管理</> },
          { title: <><UserOutlined /> 角色卡</> },
          { title: <><EditOutlined /> 编辑</> },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{characterCard.name}</Title>
          <Text type="secondary">所属创意：{creative.title}</Text>
        </div>
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
          >
            返回列表
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              setFormattedFields(null);
              setExportModalVisible(true);
            }}
          >
            格式 & 导出
          </Button>
          <Button
            type="default"
            icon={<RocketOutlined />}
            onClick={() => setAiModalVisible(true)}
            disabled={!isEngineConfigured}
          >
            AI生成
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
          >
            保存
          </Button>
        </Space>
      </div>

      <MarkdownEditor
        value={editingContent}
        onChange={setEditingContent}
        minHeight={600}
        theme={theme}
        enableAITools={true}
        placeholder="在此编辑角色卡内容..."
      />

      <Modal
        title="AI生成角色卡内容"
        open={aiModalVisible}
        onCancel={() => {
          setAiModalVisible(false);
          aiForm.resetFields();
          setGeneratedPreview('');
          setStreamingContent('');
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setAiModalVisible(false);
              aiForm.resetFields();
              setGeneratedPreview('');
              setStreamingContent('');
            }}
          >
            关闭
          </Button>,
          generatedPreview || streamingContent ? (
            <Button
              key="save"
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveGeneratedContent}
            >
              保存到编辑器
            </Button>
          ) : null
        ]}
        width={800}
      >
        <Form form={aiForm} onFinish={handleAIGenerate} layout="vertical">
          <Form.Item
            name="templateId"
            label="生成模板"
            rules={[{ required: true, message: '请选择模板' }]}
            initialValue="character_card"
          >
            <Select>
              <Select.Option value="character_card">角色卡</Select.Option>
              <Select.Option value="system_character">系统角色</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="requirements"
            label="用户需求"
          >
            <TextArea
              rows={3}
              placeholder="输入额外的生成需求（可选）"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={aiLoading ? <LoadingOutlined spin /> : <RocketOutlined />}
              loading={aiLoading}
              style={{ width: '100%' }}
            >
              {aiLoading ? '生成中...' : '开始生成'}
            </Button>
          </Form.Item>
        </Form>

        {(streamingContent || generatedPreview) && (
          <div style={{ marginTop: 16 }}>
            <Text strong>生成预览：</Text>
            <Card
              size="small"
              style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}
            >
              <Text style={{ whiteSpace: 'pre-wrap' }}>
                {generatedPreview || streamingContent}
              </Text>
            </Card>
          </div>
        )}
      </Modal>

      <Modal
        title="格式 & 导出角色卡 (V3)"
        open={exportModalVisible}
        onCancel={() => {
          setExportModalVisible(false);
          setFormattedFields(null);
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setExportModalVisible(false);
              setFormattedFields(null);
            }}
          >
            关闭
          </Button>,
          <Button
            key="saveToDir"
            type="default"
            icon={<UploadOutlined />}
            onClick={handleSaveToDirectory}
            loading={isSavingToDir}
          >
            保存到角色卡目录
          </Button>,
          <Button
            key="export"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExport}
            loading={isExporting}
          >
            导出 PNG
          </Button>
        ]}
        width={800}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>角色卡：</Text>
            <Text>{characterCard.name}</Text>
          </div>

          <Divider orientation="left" style={{ margin: '8px 0' }}>AI 格式化</Divider>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              type="default"
              icon={isFormatting ? <LoadingOutlined spin /> : <CheckCircleOutlined />}
              onClick={handleFormatCard}
              loading={isFormatting}
              disabled={!isEngineConfigured}
            >
              {isFormatting ? '格式化中...' : 'AI 格式化'}
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              使用 AI 自动解析内容，提取 V3 标准字段
            </Text>
          </div>

          {formattedFields && (
            <Card size="small" title={<Text strong><CheckCircleOutlined style={{ marginRight: 4 }} />格式化完成</Text>} type="inner">
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="角色名称">{formattedFields.name || '-'}</Descriptions.Item>
                <Descriptions.Item label="描述">{formattedFields.description || '-'}</Descriptions.Item>
                <Descriptions.Item label="性格">{formattedFields.personality || '-'}</Descriptions.Item>
                <Descriptions.Item label="场景设定">{formattedFields.scenario || '-'}</Descriptions.Item>
                <Descriptions.Item label="第一条消息">{formattedFields.first_mes ? `${formattedFields.first_mes.substring(0, 100)}...` : '-'}</Descriptions.Item>
                <Descriptions.Item label="对话示例">{formattedFields.mes_example ? `${formattedFields.mes_example.substring(0, 100)}...` : '-'}</Descriptions.Item>
                <Descriptions.Item label="创作者备注">{formattedFields.creator_notes || '-'}</Descriptions.Item>
                <Descriptions.Item label="系统提示">{formattedFields.system_prompt ? `${formattedFields.system_prompt.substring(0, 100)}...` : '-'}</Descriptions.Item>
                <Descriptions.Item label="后处理指令">{formattedFields.post_history_instructions || '-'}</Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          <Divider orientation="left" style={{ margin: '8px 0' }}>角色卡图片</Divider>

          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {cardImage ? (
              <Space>
                <img
                  src={cardImage}
                  alt="角色卡"
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }}
                />
                <Button
                  icon={<DeleteOutlined />}
                  danger
                  size="small"
                  onClick={handleRemoveImage}
                >
                  移除图片
                </Button>
                <Button
                  icon={<UploadOutlined />}
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                >
                  更换图片
                </Button>
              </Space>
            ) : (
              <Button
                icon={<UploadOutlined />}
                onClick={() => fileInputRef.current?.click()}
              >
                上传图片
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              支持 PNG、JPG、WEBP 格式，最大 10MB
            </Text>
          </Space>

          <Divider orientation="left" style={{ margin: '8px 0' }}>导出说明</Divider>

          <Card size="small" type="inner">
            <Text type="secondary" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
{`• 导出格式：PNG（SillyTavern V3 标准）
• 嵌入数据：chara chunk（V2兼容）+ ccv3 chunk（V3标准）
• 兼容性：可被 @lenml/char-card-reader 正确读取
• 图片：上传的图片将作为角色卡封面嵌入PNG`}
            </Text>
          </Card>
        </Space>
      </Modal>
    </div>
  );
};

export default CharacterCardEditPage;
