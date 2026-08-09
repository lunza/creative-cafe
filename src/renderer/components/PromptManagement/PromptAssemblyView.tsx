import React, { useMemo, useState, useEffect } from 'react';
import { Card, Tag, Tooltip, Collapse, Typography, Empty } from 'antd';
import {
  LockOutlined,
  EditOutlined,
  ArrowDownOutlined,
  UserOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import type { PromptTemplate } from '../../../shared/types/promptTemplate.types';

const { Text } = Typography;

interface PromptAssemblyViewProps {
  template: PromptTemplate;
}

const CONTENT_PREVIEW_LENGTH = 200;

const loadEngineSystemPrompt = async (): Promise<string> => {
  try {
    const result = await window.electronAPI.setting.load();
    if (result.success && result.setting) {
      const engines = result.setting.aiEngines || [];
      const activeEngineId = result.setting.activeEngineId;
      const activeEngine = engines.find((e: any) => e.id === activeEngineId) || engines[0];
      return activeEngine?.system_prompt?.trim() || '';
    }
  } catch {}
  return '';
};

const PromptAssemblyView: React.FC<PromptAssemblyViewProps> = ({ template }) => {
  const theme = useUIStore(s => s.theme);
  const isDark = theme === 'dark';

  const [engineSystemPrompt, setEngineSystemPrompt] = useState('');
  useEffect(() => {
    loadEngineSystemPrompt().then(setEngineSystemPrompt);
  }, []);

  const sortedParts = useMemo(() => {
    return [...template.parts].sort((a, b) => a.order - b.order);
  }, [template.parts]);

  if (!sortedParts.length) {
    return (
      <div style={{ padding: 40 }}>
        <Empty description="暂无提示词部件" />
      </div>
    );
  }

  const getCardStyle = (type: 'fixed' | 'editable'): React.CSSProperties => {
    if (type === 'fixed') {
      return {
        backgroundColor: isDark ? '#2c2c2c' : '#f5f5f5',
        borderColor: isDark ? '#434343' : '#d9d9d9',
      };
    }
    return {
      backgroundColor: isDark ? '#1c2536' : '#e6f7ff',
      borderColor: isDark ? '#1c3a5a' : '#91d5ff',
    };
  };

  const getContentBg = (): string => {
    return isDark ? '#1f1f1f' : '#fafafa';
  };

  const getContentColor = (): string => {
    return isDark ? '#d9d9d9' : '#595959';
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 0' }}>
      {engineSystemPrompt && (
        <React.Fragment>
          <Card
            size="small"
            style={{
              ...getCardStyle('fixed'),
              marginBottom: 0,
            }}
          >
            {/* Header: icon + label + tag + role badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                flexWrap: 'wrap',
              }}
            >
              <LockOutlined style={{ color: isDark ? '#8c8c8c' : '#8c8c8c' }} />
              <Text strong>引擎系统提示词</Text>
              <Tag color="default">不可修改</Tag>
              <Tag icon={<DesktopOutlined />} color="purple">
                system
              </Tag>
            </div>

            {/* Source description */}
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                来源：AI引擎全局设置
              </Text>
            </div>

            {/* Content preview / expandable full content */}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                内容预览：
              </Text>
              {engineSystemPrompt.length > CONTENT_PREVIEW_LENGTH ? (
                <Collapse
                  ghost
                  size="small"
                  style={{ marginTop: 4 }}
                  items={[
                    {
                      key: 'engine-system-prompt',
                      label: (
                        <Tooltip title="点击展开/收起完整内容">
                          <Text
                            type="secondary"
                            style={{ fontSize: 12, cursor: 'pointer' }}
                          >
                            {engineSystemPrompt.slice(0, CONTENT_PREVIEW_LENGTH)}
                            <span style={{ color: '#1890ff' }}>...</span>
                          </Text>
                        </Tooltip>
                      ),
                      children: (
                        <pre
                          style={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: 12,
                            margin: 0,
                            color: getContentColor(),
                            backgroundColor: getContentBg(),
                            padding: 8,
                            borderRadius: 4,
                            maxHeight: 400,
                            overflowY: 'auto',
                          }}
                        >
                          {engineSystemPrompt}
                        </pre>
                      ),
                    },
                  ]}
                />
              ) : (
                <div
                  style={{
                    marginTop: 4,
                    padding: 8,
                    backgroundColor: getContentBg(),
                    borderRadius: 4,
                  }}
                >
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {engineSystemPrompt}
                  </Text>
                </div>
              )}
            </div>
          </Card>

          {/* Down arrow to first template part */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '8px 0',
            }}
          >
            <Tooltip title={`下一步：${sortedParts[0]?.label || ''}`}>
              <ArrowDownOutlined
                style={{ color: isDark ? '#555' : '#bbb', fontSize: 20 }}
              />
            </Tooltip>
          </div>
        </React.Fragment>
      )}
      {sortedParts.map((part, index) => {
        const isFixed = part.type === 'fixed';
        const preview = part.content.slice(0, CONTENT_PREVIEW_LENGTH);
        const needsTruncation = part.content.length > CONTENT_PREVIEW_LENGTH;

        return (
          <React.Fragment key={part.id}>
            <Card
              size="small"
              style={{
                ...getCardStyle(part.type),
                marginBottom: 0,
              }}
            >
              {/* Header: icon + label + tag + role badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: 'wrap',
                }}
              >
                {isFixed ? (
                  <LockOutlined style={{ color: isDark ? '#8c8c8c' : '#8c8c8c' }} />
                ) : (
                  <EditOutlined style={{ color: '#1890ff' }} />
                )}
                <Text strong>{part.label}</Text>
                <Tag color={isFixed ? 'default' : 'blue'}>
                  {isFixed ? '不可修改' : '可编辑'}
                </Tag>
                <Tag
                  icon={part.role === 'system' ? <DesktopOutlined /> : <UserOutlined />}
                  color={part.role === 'system' ? 'purple' : 'cyan'}
                >
                  {part.role}
                </Tag>
              </div>

              {/* Source description */}
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  来源：{part.source}
                </Text>
              </div>

              {/* Variables used */}
              {part.variables.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>
                    变量：
                  </Text>
                  {part.variables.map((v) => (
                    <Tag key={v} color="green" style={{ marginBottom: 2 }}>
                      {v}
                    </Tag>
                  ))}
                </div>
              )}

              {/* Content preview / expandable full content */}
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  内容预览：
                </Text>
                {needsTruncation ? (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: 4 }}
                    items={[
                      {
                        key: part.id,
                        label: (
                          <Tooltip title="点击展开/收起完整内容">
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, cursor: 'pointer' }}
                            >
                              {preview}
                              <span style={{ color: '#1890ff' }}>...</span>
                            </Text>
                          </Tooltip>
                        ),
                        children: (
                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: 12,
                              margin: 0,
                              color: getContentColor(),
                              backgroundColor: getContentBg(),
                              padding: 8,
                              borderRadius: 4,
                              maxHeight: 400,
                              overflowY: 'auto',
                            }}
                          >
                            {part.content}
                          </pre>
                        ),
                      },
                    ]}
                  />
                ) : (
                  <div
                    style={{
                      marginTop: 4,
                      padding: 8,
                      backgroundColor: getContentBg(),
                      borderRadius: 4,
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {part.content}
                    </Text>
                  </div>
                )}
              </div>
            </Card>

            {/* Down arrow between cards */}
            {index < sortedParts.length - 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '8px 0',
                }}
              >
                <Tooltip title={`下一步：${sortedParts[index + 1].label}`}>
                  <ArrowDownOutlined
                    style={{ color: isDark ? '#555' : '#bbb', fontSize: 20 }}
                  />
                </Tooltip>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default PromptAssemblyView;
