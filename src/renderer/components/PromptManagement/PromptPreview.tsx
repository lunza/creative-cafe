import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Form,
  Input,
  Button,
  Card,
  Tag,
  Typography,
  Spin,
  Divider,
  Empty,
  Row,
  Col,
  message,
} from 'antd';
import { EyeOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { PromptTemplate } from '../../../shared/types/promptTemplate.types';

const { Text } = Typography;

interface PromptPreviewProps {
  template: PromptTemplate;
}

// prompt IPC 接口类型（与 window.electronAPI.prompt 一致）
interface PromptBuildResult {
  success: boolean;
  data?: { systemPrompt: string; userPrompt: string };
  error?: string;
}
interface PromptAPI {
  build: (
    moduleId: string,
    variables: Record<string, string>
  ) => Promise<PromptBuildResult>;
}

// 获取 prompt IPC 接口（绕过全局类型声明冲突）
const getPromptAPI = (): PromptAPI =>
  (window.electronAPI as unknown as { prompt: PromptAPI }).prompt;

const loadEngineSystemPrompt = async (): Promise<string> => {
  try {
    const result = await window.electronAPI.setting.load();
    if (result.success && result.setting) {
      const engines = result.setting.aiEngines || [];
      const activeEngineId = result.setting.activeEngineId;
      const activeEngine = engines.find((e: any) => e.id === activeEngineId);
      return activeEngine?.system_prompt?.trim() || '';
    }
  } catch {}
  return '';
};

const PromptPreview: React.FC<PromptPreviewProps> = ({ template }) => {
  const [engineSystemPrompt, setEngineSystemPrompt] = useState('');
  useEffect(() => {
    loadEngineSystemPrompt().then(setEngineSystemPrompt);
  }, [template.id]);

  // 默认变量值（来自模板 defaultValue），仅在切换模块时重新计算
  const defaultVars = useMemo<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    template.variables.forEach((v) => {
      init[v.name] = v.defaultValue ?? '';
    });
    return init;
  }, [template.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [exampleVariables, setExampleVariables] = useState<Record<string, string>>(defaultVars);
  const [building, setBuilding] = useState(false);
  const [builtResult, setBuiltResult] = useState<{
    systemPrompt: string;
    userPrompt: string;
  } | null>(null);
  const prevIdRef = useRef<string>(template.id);

  // 切换模块时重置示例变量与最终预览结果
  useEffect(() => {
    if (prevIdRef.current !== template.id) {
      prevIdRef.current = template.id;
      setExampleVariables(defaultVars);
      setBuiltResult(null);
    }
  }, [template.id, defaultVars]);

  const sortedParts = useMemo(
    () => [...template.parts].sort((a, b) => a.order - b.order),
    [template.parts]
  );

  // 单步预览：用示例值替换变量；无示例值则用 defaultValue，仍无则显示 [未设置: ...]
  const renderSingleStepContent = (content: string): string => {
    return content.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
      const exampleVal = exampleVariables[varName];
      if (exampleVal !== undefined && exampleVal !== '') {
        return exampleVal;
      }
      const def = template.variables.find((v) => v.name === varName);
      if (def?.defaultValue !== undefined && def.defaultValue !== '') {
        return def.defaultValue;
      }
      return `[未设置: ${varName}]`;
    });
  };

  const handleBuild = async () => {
    setBuilding(true);
    try {
      const result = await getPromptAPI().build(
        template.moduleId,
        exampleVariables
      );
      if (result.success && result.data) {
        setBuiltResult(result.data);
        message.success('最终预览生成成功');
      } else {
        message.error(result.error || '生成最终预览失败');
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : '生成最终预览时发生错误';
      message.error(msg);
    } finally {
      setBuilding(false);
    }
  };

  const preStyle: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    padding: 12,
    backgroundColor: 'var(--bg-hover, #fafafa)',
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1.6,
    border: '1px solid var(--border-divider, #e8e8e8)',
    maxHeight: 400,
    overflow: 'auto',
  };

  return (
    <div className="prompt-preview" style={{ padding: '4px 0' }}>
      {/* 示例变量面板 */}
      <Card
        size="small"
        title={
          <span>
            <EyeOutlined style={{ marginRight: 6 }} />
            示例变量
          </span>
        }
        style={{ marginBottom: 16 }}
      >
        {template.variables.length === 0 ? (
          <Empty description="此模板没有变量" />
        ) : (
          <Form
            key={template.id}
            layout="vertical"
            initialValues={defaultVars}
            onValuesChange={(_, allValues) =>
              setExampleVariables(allValues as Record<string, string>)
            }
          >
            <Row gutter={16}>
              {template.variables.map((v) => (
                <Col span={12} key={v.name}>
                  <Form.Item
                    name={v.name}
                    label={
                      <span>
                        {v.name}
                        {v.required && <Text type="danger"> *</Text>}
                        {v.description && (
                          <Text
                            type="secondary"
                            style={{ fontSize: 12, marginLeft: 4 }}
                          >
                            ({v.description})
                          </Text>
                        )}
                      </span>
                    }
                  >
                    <Input
                      placeholder={
                        v.defaultValue ? `默认: ${v.defaultValue}` : '请输入示例值'
                      }
                    />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </Form>
        )}
      </Card>

      {/* 单步预览 */}
      <Card
        size="small"
        title={
          <span>
            <EyeOutlined style={{ marginRight: 6 }} />
            单步预览
          </span>
        }
        style={{ marginBottom: 16 }}
      >
        {engineSystemPrompt && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                flexWrap: 'wrap',
              }}
            >
              <Text strong>引擎系统提示词</Text>
              <Tag color="purple">system</Tag>
              <Tag color="default">固定</Tag>
            </div>
            <pre style={preStyle}>{engineSystemPrompt}</pre>
          </div>
        )}
        {sortedParts.map((part) => (
          <div key={part.id} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                flexWrap: 'wrap',
              }}
            >
              <Text strong>{part.label}</Text>
              <Tag color={part.role === 'system' ? 'purple' : 'cyan'}>
                {part.role}
              </Tag>
              <Tag color={part.type === 'fixed' ? 'default' : 'blue'}>
                {part.type === 'fixed' ? '固定' : '可编辑'}
              </Tag>
            </div>
            <pre style={preStyle}>{renderSingleStepContent(part.content)}</pre>
          </div>
        ))}
      </Card>

      {/* 最终预览 */}
      <Card
        size="small"
        title={
          <span>
            <PlayCircleOutlined style={{ marginRight: 6 }} />
            最终预览
          </span>
        }
        extra={
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleBuild}
            loading={building}
          >
            生成最终预览
          </Button>
        }
      >
        {building ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin tip="正在生成..." />
          </div>
        ) : builtResult ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}>
                <Tag color="purple">System Prompt</Tag>
              </div>
              {engineSystemPrompt && (
                <Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginBottom: 6 }}
                >
                  已包含引擎系统提示词（全局设置）
                </Text>
              )}
              <pre style={preStyle}>{builtResult.systemPrompt}</pre>
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <div>
              <div style={{ marginBottom: 6 }}>
                <Tag color="cyan">User Prompt</Tag>
              </div>
              {builtResult.userPrompt ? (
                <pre style={preStyle}>{builtResult.userPrompt}</pre>
              ) : (
                <Text
                  type="secondary"
                  style={{ display: 'block', padding: 12 }}
                >
                  此模块的 User Prompt 由业务模块直接提供
                </Text>
              )}
            </div>
          </div>
        ) : (
          <Empty description="点击「生成最终预览」查看完整提示词" />
        )}
      </Card>
    </div>
  );
};

export default PromptPreview;
