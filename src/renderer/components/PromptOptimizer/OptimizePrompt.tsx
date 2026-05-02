import React, { useState } from 'react';
import { Card, Form, Input, Button, Checkbox, Space, Typography, message, Divider, Progress } from 'antd';
import { EditOutlined, SaveOutlined, CopyOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore';
import { OptimizationGoal } from '../../types/promptOptimizer';
import { useUIStore } from '../../stores/uiStore';

const { TextArea } = Input;
const { Text, Title } = Typography;

const OptimizePrompt: React.FC = () => {
  const { theme } = useUIStore();
  const { optimizePrompt, isOptimizing, optimizationResult, setCurrentPrompt, currentPrompt } = usePromptOptimizerStore();
  const [form] = Form.useForm();
  const [isCopying, setIsCopying] = useState(false);

  const optimizationGoals: { value: OptimizationGoal; label: string; description: string }[] = [
    { value: 'clarity', label: '清晰度提升', description: '使表达更加明确易懂' },
    { value: 'specificity', label: '指令明确性', description: '增强指令的具体性和可操作性' },
    { value: 'roleDefinition', label: '角色定位', description: '优化角色定位和职责描述' },
    { value: 'contextControl', label: '上下文控制', description: '改进上下文理解和信息处理' },
    { value: 'outputFormat', label: '输出格式', description: '规范输出格式和结构' },
    { value: 'constraint', label: '约束条件', description: '完善约束和限制条件' },
    { value: 'example', label: '示例补充', description: '添加示例说明' }
  ];

  const handleOptimize = async () => {
    try {
      const values = await form.validateFields();
      const selectedGoals = values.goals || [];
      
      if (selectedGoals.length === 0) {
        message.error('请至少选择一个优化目标');
        return;
      }

      await optimizePrompt({
        originalPrompt: values.originalPrompt,
        optimizationGoals: selectedGoals as OptimizationGoal[]
      });
      message.success('提示词优化成功');
    } catch (error) {
      message.error('请填写原始提示词');
    }
  };

  const handleCopy = async () => {
    if (optimizationResult?.optimizedPrompt) {
      try {
        setIsCopying(true);
        await navigator.clipboard.writeText(optimizationResult.optimizedPrompt);
        message.success('已复制到剪贴板');
      } catch (error) {
        message.error('复制失败');
      } finally {
        setIsCopying(false);
      }
    }
  };

  const handleApply = () => {
    if (optimizationResult?.optimizedPrompt) {
      setCurrentPrompt(optimizationResult.optimizedPrompt);
      message.success('已应用到当前提示词');
    }
  };

  return (
    <div className="optimize-prompt">
      <Card title="优化系统提示词" className="optimize-prompt-card">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            originalPrompt: currentPrompt,
            goals: ['clarity', 'specificity', 'roleDefinition']
          }}
        >
          <Form.Item
            name="originalPrompt"
            label="原始提示词"
            rules={[{ required: true, message: '请输入原始提示词' }]}
          >
            <TextArea
              rows={5}
              placeholder="请输入您需要优化的系统提示词"
            />
          </Form.Item>

          <Form.Item
            name="goals"
            label="优化目标"
            rules={[{ required: true, message: '请至少选择一个优化目标' }]}
          >
            <Space orientation="vertical" style={{ width: '100%' }}>
              {optimizationGoals.map(goal => (
                <Checkbox key={goal.value} value={goal.value}>
                  <Space>
                    <Text>{goal.label}</Text>
                    <Text type="secondary" style={{ fontSize: '0.9em' }}>{goal.description}</Text>
                  </Space>
                </Checkbox>
              ))}
            </Space>
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={handleOptimize}
              loading={isOptimizing}
              block
              size="large"
            >
              优化提示词
            </Button>
          </Form.Item>
        </Form>

        {optimizationResult && (
          <div className="optimization-result">
            <Card className="optimization-result-card" size="small">
              <Title level={4} style={{ marginBottom: 16 }}>优化结果</Title>
              
              <div className="optimization-comparison">
                <div className="comparison-item">
                  <Text strong>原始提示词：</Text>
                  <div className="prompt-content">
                    <Text>{optimizationResult.originalPrompt}</Text>
                  </div>
                </div>
                
                <ArrowRightOutlined style={{ textAlign: 'center', display: 'block', margin: '16px 0' }} />
                
                <div className="comparison-item">
                  <Text strong>优化后提示词：</Text>
                  <div className="prompt-content">
                    <Text>{optimizationResult.optimizedPrompt}</Text>
                  </div>
                </div>
              </div>

              <Divider />

              <div className="optimization-metrics">
                <Text strong>优化指标：</Text>
                <div className="metrics-list">
                  <div className="metric-item">
                    <Text>整体评分</Text>
                    <Progress 
                      percent={optimizationResult.beforeAfterComparison.overall.after} 
                      status="success"
                      size="small"
                    />
                    <Text type="secondary">
                      {optimizationResult.beforeAfterComparison.overall.before.toFixed(0)} → {optimizationResult.beforeAfterComparison.overall.after.toFixed(0)}
                    </Text>
                  </div>
                  <div className="metric-item">
                    <Text>清晰度</Text>
                    <Progress 
                      percent={optimizationResult.beforeAfterComparison.clarity.after} 
                      status="success"
                      size="small"
                    />
                    <Text type="secondary">
                      {optimizationResult.beforeAfterComparison.clarity.before.toFixed(0)} → {optimizationResult.beforeAfterComparison.clarity.after.toFixed(0)}
                    </Text>
                  </div>
                  <div className="metric-item">
                    <Text>明确性</Text>
                    <Progress 
                      percent={optimizationResult.beforeAfterComparison.specificity.after} 
                      status="success"
                      size="small"
                    />
                    <Text type="secondary">
                      {optimizationResult.beforeAfterComparison.specificity.before.toFixed(0)} → {optimizationResult.beforeAfterComparison.specificity.after.toFixed(0)}
                    </Text>
                  </div>
                  <div className="metric-item">
                    <Text>角色定位</Text>
                    <Progress 
                      percent={optimizationResult.beforeAfterComparison.roleDefinition.after} 
                      status="success"
                      size="small"
                    />
                    <Text type="secondary">
                      {optimizationResult.beforeAfterComparison.roleDefinition.before.toFixed(0)} → {optimizationResult.beforeAfterComparison.roleDefinition.after.toFixed(0)}
                    </Text>
                  </div>
                </div>
              </div>

              <Divider />

              <div className="optimization-improvements">
                <Text strong>改进点：</Text>
                <div className="improvements-list">
                  {optimizationResult.improvements.map((improvement, index) => (
                    <div key={index} className="improvement-item">
                      <Text strong>{improvement.description}</Text>
                      <Text type="secondary">{improvement.suggestion}</Text>
                    </div>
                  ))}
                </div>
              </div>

              <div className="optimization-actions" style={{ marginTop: 16 }}>
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
            </Card>
          </div>
        )}
      </Card>
    </div>
  );
};

export default OptimizePrompt;
