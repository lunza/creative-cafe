import React, { useState } from 'react';
import { Card, Form, Input, Button, Select, Space, Typography, message, Spin } from 'antd';
import { RocketOutlined, SaveOutlined, CopyOutlined } from '@ant-design/icons';
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore';
import { useUIStore } from '../../stores/uiStore';

const { TextArea } = Input;
const { Option } = Select;
const { Text, Title } = Typography;

const GeneratePrompt: React.FC = () => {
  const { theme } = useUIStore();
  const { generatePrompt, isGenerating, generationResult, setCurrentPrompt } = usePromptOptimizerStore();
  const [form] = Form.useForm();
  const [isCopying, setIsCopying] = useState(false);

  const handleGenerate = async () => {
    try {
      const values = await form.validateFields();
      await generatePrompt({
        sceneRequirement: values.sceneRequirement,
        applicationField: values.applicationField,
        functionalGoal: values.functionalGoal,
        language: values.language,
        complexity: values.complexity
      });
      message.success('提示词生成成功');
    } catch (error) {
      message.error('请填写所有必填字段');
    }
  };

  const handleCopy = async () => {
    if (generationResult?.systemPrompt) {
      try {
        setIsCopying(true);
        await navigator.clipboard.writeText(generationResult.systemPrompt);
        message.success('已复制到剪贴板');
      } catch (error) {
        message.error('复制失败');
      } finally {
        setIsCopying(false);
      }
    }
  };

  const handleApply = () => {
    if (generationResult?.systemPrompt) {
      setCurrentPrompt(generationResult.systemPrompt);
      message.success('已应用到当前提示词');
    }
  };

  return (
    <div className="generate-prompt">
      <Card title="自动生成系统提示词" className="generate-prompt-card">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            language: 'zh',
            complexity: 'moderate'
          }}
        >
          <Form.Item
            name="sceneRequirement"
            label="场景需求"
            rules={[{ required: true, message: '请描述具体的使用场景' }]}
          >
            <TextArea
              rows={3}
              placeholder="请描述您的使用场景，例如：客户服务、创意写作、技术支持等"
            />
          </Form.Item>

          <Form.Item
            name="applicationField"
            label="应用领域"
            rules={[{ required: true, message: '请选择应用领域' }]}
          >
            <Select placeholder="请选择应用领域">
              <Option value="customer_service">客户服务</Option>
              <Option value="creative_writing">创意写作</Option>
              <Option value="technical_support">技术支持</Option>
              <Option value="education">教育学习</Option>
              <Option value="business">商业分析</Option>
              <Option value="healthcare">医疗健康</Option>
              <Option value="entertainment">娱乐休闲</Option>
              <Option value="other">其他</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="functionalGoal"
            label="功能目标"
            rules={[{ required: true, message: '请描述功能目标' }]}
          >
            <TextArea
              rows={2}
              placeholder="请描述您希望提示词实现的具体功能目标"
            />
          </Form.Item>

          <Form.Item
            name="language"
            label="语言"
          >
            <Select>
              <Option value="zh">中文</Option>
              <Option value="en">英文</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="complexity"
            label="复杂度"
          >
            <Select>
              <Option value="simple">简单</Option>
              <Option value="moderate">中等</Option>
              <Option value="complex">复杂</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={handleGenerate}
              loading={isGenerating}
              block
              size="large"
            >
              生成提示词
            </Button>
          </Form.Item>
        </Form>

        {generationResult && (
          <Card className="generation-result-card" size="small">
            <div className="generation-result-header">
              <Title level={4} style={{ marginBottom: 16 }}>生成结果</Title>
              <Space size="small">
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  size="small"
                  onClick={handleApply}
                >
                  应用
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  size="small"
                  onClick={handleCopy}
                  loading={isCopying}
                >
                  复制
                </Button>
              </Space>
            </div>

            <div className="generation-result-content">
              <Text strong>系统提示词：</Text>
              <div className="prompt-content">
                <Text>{generationResult.systemPrompt}</Text>
              </div>

              <Text strong style={{ marginTop: 16, display: 'block' }}>说明：</Text>
              <Text type="secondary">{generationResult.explanation}</Text>

              {generationResult.suggestedParameters && (
                <div style={{ marginTop: 16 }}>
                  <Text strong>建议参数：</Text>
                  <div className="suggested-parameters">
                    <Text>温度: {generationResult.suggestedParameters.temperature}</Text>
                    <Text>最大Token: {generationResult.suggestedParameters.maxTokens}</Text>
                    <Text>Top P: {generationResult.suggestedParameters.topP}</Text>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
      </Card>
    </div>
  );
};

export default GeneratePrompt;
