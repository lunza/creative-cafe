import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Tag, Tooltip, Typography, Divider, Button, Modal, message, Card, Row, Col, Space } from 'antd';
import { LockOutlined, EditOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type {
  PromptTemplate,
  PromptPart,
  PromptVariable,
  PromptPolishResult,
} from '../../../shared/types/promptTemplate.types';
import { findModuleDescription } from './PromptManagement';

const { TextArea } = Input;
const { Title, Text } = Typography;

interface PromptEditorProps {
  template: PromptTemplate;
  onPartsChange: (parts: PromptPart[]) => void; // Called when editable parts change
  isDirty: boolean; // Whether there are unsaved changes
}

// 渲染带高亮占位符的文本，{{variable_name}} 以橘色显示并附带变量说明 Tooltip
const renderHighlightedText = (text: string, variables: PromptVariable[]) => {
  const segments = text.split(/(\{\{[^}]+\}\})/g);
  return segments.map((segment, i) => {
    if (segment.match(/^\{\{[^}]+\}\}$/)) {
      const varName = segment.slice(2, -2);
      const varDef = variables.find((v) => v.name === varName);
      return (
        <Tooltip
          key={i}
          title={varDef ? `${varDef.description} (来源: ${varDef.source})` : '未知变量'}
        >
          <span style={{ color: '#fa8c16', fontWeight: 500, cursor: 'help' }}>
            {segment}
          </span>
        </Tooltip>
      );
    }
    return <span key={i}>{segment}</span>;
  });
};

const PromptEditor: React.FC<PromptEditorProps> = ({
  template,
  onPartsChange,
  isDirty,
}) => {
  const [parts, setParts] = useState<PromptPart[]>(template.parts);
  const [optimizingPartId, setOptimizingPartId] = useState<string | null>(null);
  const [compareModal, setCompareModal] = useState<{
    visible: boolean;
    partId: string;
    originalContent: string;
    polishResult: PromptPolishResult | null;
  }>({ visible: false, partId: '', originalContent: '', polishResult: null });
  // 通过 template.id + updatedAt 判断模板是否真正变更（切换模块或保存后刷新）
  const syncKeyRef = useRef<string>(
    `${template.id}-${template.metadata.updatedAt}`
  );

  useEffect(() => {
    const newKey = `${template.id}-${template.metadata.updatedAt}`;
    if (newKey !== syncKeyRef.current) {
      syncKeyRef.current = newKey;
      setParts(template.parts);
    }
  }, [template]);

  const sortedParts = useMemo(
    () => [...parts].sort((a, b) => a.order - b.order),
    [parts]
  );

  // 本地暂存：编辑可编辑部分时更新本地状态并通知父组件
  const handlePartChange = (partId: string, content: string) => {
    const updatedParts = parts.map((p) =>
      p.id === partId ? { ...p, content } : p
    );
    setParts(updatedParts);
    onPartsChange(updatedParts);
  };

  const handleOptimize = async (partId: string, content: string) => {
    if (!content.trim()) {
      message.warning('内容为空，无需优化');
      return;
    }
    setOptimizingPartId(partId);
    try {
      const result = await window.electronAPI.prompt.optimize({
        content,
        framework: template.framework,
        moduleId: template.moduleId,
        taskDescription: findModuleDescription(template.moduleId),
      });
      if (result.success && result.data) {
        setCompareModal({
          visible: true,
          partId,
          originalContent: content,
          polishResult: result.data as PromptPolishResult,
        });
      } else {
        message.error(result.error || 'AI 优化失败');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 优化请求失败');
    } finally {
      setOptimizingPartId(null);
    }
  };

  const handleAcceptOptimize = () => {
    if (compareModal.polishResult) {
      handlePartChange(compareModal.partId, compareModal.polishResult.polishedContent);
    }
    setCompareModal({ visible: false, partId: '', originalContent: '', polishResult: null });
  };

  const handleRejectOptimize = () => {
    setCompareModal({ visible: false, partId: '', originalContent: '', polishResult: null });
  };

  return (
    <div className="prompt-editor" style={{ padding: '4px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Title level={5} style={{ margin: 0 }}>
          分区编辑器
        </Title>
        {isDirty && <Tag color="orange">未保存</Tag>}
      </div>
      <Text
        type="secondary"
        style={{ display: 'block', marginBottom: 12, fontSize: 13 }}
      >
        固定部分为系统结构（只读），可编辑部分可自由修改。橘色文字为变量占位符，悬停可查看详情。
      </Text>
      <Divider style={{ margin: '0 0 16px 0' }} />

      {sortedParts.map((part) => (
        <div key={part.id} style={{ marginBottom: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            {part.type === 'fixed' ? (
              <LockOutlined style={{ color: 'var(--text-secondary)' }} />
            ) : (
              <EditOutlined style={{ color: 'var(--color-primary)' }} />
            )}
            <Text strong>{part.label}</Text>
            <Tag color={part.type === 'fixed' ? 'default' : 'blue'}>
              {part.type === 'fixed' ? '固定部分' : '可编辑部分'}
            </Tag>
            <Tag color={part.role === 'system' ? 'purple' : 'cyan'}>
              {part.role}
            </Tag>
            {part.type !== 'fixed' && (
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={optimizingPartId === part.id}
                onClick={() => handleOptimize(part.id, part.content)}
                style={{ marginLeft: 'auto' }}
              >
                AI 润色
              </Button>
            )}
          </div>

          {part.type === 'fixed' ? (
            <div
              style={{
                padding: 12,
                backgroundColor: 'var(--bg-disabled, #f5f5f5)',
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1.6,
                border: '1px solid var(--border-divider, #e8e8e8)',
              }}
            >
              {renderHighlightedText(part.content, template.variables)}
            </div>
          ) : (
            <div>
              <TextArea
                value={part.content}
                onChange={(e) => handlePartChange(part.id, e.target.value)}
                autoSize={{ minRows: 3, maxRows: 20 }}
                style={{ marginBottom: 8 }}
              />
              <div
                style={{
                  padding: 12,
                  backgroundColor: 'var(--bg-hover, #fafafa)',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 13,
                  lineHeight: 1.6,
                  border: '1px dashed var(--border-divider, #d9d9d9)',
                }}
              >
                <Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                >
                  占位符预览：
                </Text>
                {renderHighlightedText(part.content, template.variables)}
              </div>
            </div>
          )}
        </div>
      ))}

      <Modal
        title="AI 润色结果"
        open={compareModal.visible}
        onCancel={handleRejectOptimize}
        width={900}
        footer={[
          <Button key="reject" onClick={handleRejectOptimize}>
            放弃
          </Button>,
          <Button key="accept" type="primary" onClick={handleAcceptOptimize}>
            接受
          </Button>,
        ]}
      >
        {/* 推荐框架 + 理由 + 优化点区块 */}
        {compareModal.polishResult && (
          <Card
            size="small"
            style={{
              marginBottom: 16,
              background: '#f6ffed',
              borderColor: '#b7eb8f',
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <div>
                <Tag color="green" icon={<ThunderboltOutlined />}>推荐框架</Tag>
                <Text strong>
                  {compareModal.polishResult.recommendedFramework || '未推荐'}
                </Text>
              </div>
              {compareModal.polishResult.frameworkReasoning && (
                <div>
                  <Text type="secondary">推荐理由：</Text>
                  <div style={{ marginTop: 4, lineHeight: 1.6 }}>
                    {compareModal.polishResult.frameworkReasoning}
                  </div>
                </div>
              )}
              {compareModal.polishResult.optimizationPoints.length > 0 && (
                <div>
                  <Text type="secondary">优化点：</Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
                    {compareModal.polishResult.optimizationPoints.map((pt, i) => (
                      <li key={i}>{pt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Space>
          </Card>
        )}

        {/* 原始内容 vs 润色后内容对比 */}
        <Row gutter={16}>
          <Col span={12}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              原始内容
            </Text>
            <Input.TextArea
              value={compareModal.originalContent}
              readOnly
              autoSize={{ minRows: 10, maxRows: 25 }}
            />
          </Col>
          <Col span={12}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              润色后内容
            </Text>
            <Input.TextArea
              value={compareModal.polishResult?.polishedContent || ''}
              readOnly
              autoSize={{ minRows: 10, maxRows: 25 }}
            />
          </Col>
        </Row>
      </Modal>
    </div>
  );
};

export default PromptEditor;
