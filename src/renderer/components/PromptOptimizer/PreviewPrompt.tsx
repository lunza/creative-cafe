import React, { useState } from 'react';
import { Card, Form, Input, Button, Space, Typography, message, Divider, Statistic, Progress } from 'antd';
import { EyeOutlined, RocketOutlined } from '@ant-design/icons';
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore';
import { useUIStore } from '../../stores/uiStore';

const { TextArea } = Input;
const { Text, Title } = Typography;

const PreviewPrompt: React.FC = () => {
  const { theme } = useUIStore();
  const { 
    previewPrompt, 
    isPreviewing, 
    previewResult,
    currentPrompt,
    setCurrentPrompt
  } = usePromptOptimizerStore();
  
  const [form] = Form.useForm();

  const handlePreview = async () => {
    try {
      const values = await form.validateFields();
      await previewPrompt({
        prompt: values.prompt,
        testInput: values.testInput,
        parameters: {
          temperature: 0.7,
          maxTokens: 500
        }
      });
      message.success('预览成功');
    } catch (error) {
      message.error('请填写所有必填字段');
    }
  };

  return (
    <div className="preview-prompt">
      <Card title="提示词效果预览" className="preview-prompt-card">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            prompt: currentPrompt,
            testInput: '你好，请介绍一下你自己'
          }}
        >
          <Form.Item
            name="prompt"
            label="系统提示词"
            rules={[{ required: true, message: '请输入系统提示词' }]}
          >
            <TextArea
              rows={5}
              placeholder="请输入系统提示词"
            />
          </Form.Item>

          <Form.Item
            name="testInput"
            label="测试输入"
            rules={[{ required: true, message: '请输入测试输入' }]}
          >
            <TextArea
              rows={2}
              placeholder="请输入测试输入，例如：你好，请介绍一下你自己"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={handlePreview}
              loading={isPreviewing}
              block
              size="large"
            >
              生成预览
            </Button>
          </Form.Item>
        </Form>

        {previewResult && (
          <Card className="preview-result-card" size="small" style={{ marginTop: 16 }}>
            <Title level={4} style={{ marginBottom: 16 }}>预览结果</Title>
            
            <div className="preview-result-content">
              <Text strong>AI输出：</Text>
              <div className="output-content" style={{ marginTop: 8, padding: 12, border: '1px solid #e8e8e8', borderRadius: 4, backgroundColor: theme === 'dark' ? '#1f1f1f' : '#f9f9f9' }}>
                <Text>{previewResult.output}</Text>
              </div>
            </div>

            <Divider />

            <div className="preview-metrics">
              <Space wrap>
                <Statistic 
                  title="响应时间" 
                  value={previewResult.latency} 
                  suffix="ms"
                  size="small"
                />
                <Statistic 
                  title="总Token" 
                  value={previewResult.tokenUsage.total}
                  size="small"
                />
                <Statistic 
                  title="生成Token" 
                  value={previewResult.tokenUsage.completion}
                  size="small"
                />
              </Space>
            </div>

            <div className="token-usage" style={{ marginTop: 16 }}>
              <Text strong>Token使用情况：</Text>
              <div style={{ marginTop: 8 }}>
                <Progress 
                  percent={Math.round((previewResult.tokenUsage.completion / (previewResult.tokenUsage.total || 1)) * 100)} 
                  format={(percent) => `${previewResult.tokenUsage.completion} / ${previewResult.tokenUsage.total}`}
                />
                <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: '0.9em' }}>提示词: {previewResult.tokenUsage.prompt}</Text>
                  <Text type="secondary" style={{ fontSize: '0.9em' }}>生成: {previewResult.tokenUsage.completion}</Text>
                </div>
              </div>
            </div>
          </Card>
        )}
      </Card>
    </div>
  );
};

export default PreviewPrompt;
