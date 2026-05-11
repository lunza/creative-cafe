import React, { useState, useCallback, useEffect } from 'react';
import { InputNumber, Space, Typography, Tooltip, Tag, Button, Select, Switch, Card } from 'antd';
import { DownOutlined, RightOutlined, InfoCircleOutlined, RocketOutlined, ThunderboltOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import './ConfigPanel.css';

const { Text } = Typography;
const { Option } = Select;

interface TokenManagementConfig {
  enabled?: boolean;
  maxContextTokens?: number;
  reservedForResponse?: number;
  minMessagesToKeep?: number;
  maxMessagesToKeep?: number;
}

interface TokenManagementPanelProps {
  config: TokenManagementConfig;
  onConfigChange: (config: Partial<TokenManagementConfig>) => void;
}

const modelPresets = [
  {
    name: 'Qwen3.5-27B',
    contextWindow: '262K tokens',
    maxOutput: '66K tokens',
    maxContextTokens: 128000,
    reservedForResponse: 8192,
    minMessagesToKeep: 3,
    maxMessagesToKeep: 80,
    color: 'blue',
    tags: ['256K原生', '视觉支持', '高性价比'],
    tips: '建议启用Token计数缓存，Dense模型在长上下文时推理速度会下降。向量检索结果建议限制在20条以内。',
  },
  {
    name: 'Gemma 4 31B',
    contextWindow: '262K tokens',
    maxOutput: '33K tokens',
    maxContextTokens: 128000,
    reservedForResponse: 8192,
    minMessagesToKeep: 3,
    maxMessagesToKeep: 80,
    color: 'green',
    tags: ['256K原生', '多模态', 'Apache 2.0'],
    tips: '31B Dense模型支持原生多模态，建议System Prompt中使用结构化格式。启用function calling时可减少消息数量以提升工具调用效率。',
  },
  {
    name: 'DeepSeek V3.2',
    contextWindow: '128K tokens',
    maxOutput: '8K (chat) / 64K (reasoner)',
    maxContextTokens: 64000,
    reservedForResponse: 4096,
    minMessagesToKeep: 3,
    maxMessagesToKeep: 60,
    color: 'purple',
    tags: ['128K窗口', '上下文缓存', '低成本'],
    tips: 'Chat模型默认输出4K，Reasoner模型支持64K输出。建议启用上下文缓存（cache hit）以降低75%成本。稳定System Prompt可显著提升缓存命中率。',
  },
  {
    name: 'DeepSeek V4 Pro/Flash',
    contextWindow: '1M tokens',
    maxOutput: '384K tokens',
    maxContextTokens: 512000,
    reservedForResponse: 32768,
    minMessagesToKeep: 5,
    maxMessagesToKeep: 200,
    color: 'orange',
    tags: ['1M超大窗口', 'MoE架构', 'DSA稀疏注意力'],
    tips: 'V4 Pro (1.6T参数/49B active)和V4 Flash (284B/13B active)均支持1M上下文。采用DeepSeek Sparse Attention (DSA)，KV缓存仅为V3.2的10%。建议保留更多历史消息以充分利用长上下文优势。',
  },
  {
    name: 'Gemini 2.5 Pro / 3 Pro',
    contextWindow: '1M tokens',
    maxOutput: '64K tokens',
    maxContextTokens: 512000,
    reservedForResponse: 16384,
    minMessagesToKeep: 5,
    maxMessagesToKeep: 200,
    color: 'red',
    tags: ['1M窗口', '原生多模态', 'Thinking Mode'],
    tips: '超过200K tokens会自动触发2x价格附加费。建议在200K以内优化上下文。内置Thinking Mode适合复杂推理，但会增加token消耗。',
  },
  {
    name: 'GPT-5 / GPT-5.5',
    contextWindow: '400K (GPT-5) / 1.05M (GPT-5.5)',
    maxOutput: '128K tokens',
    maxContextTokens: 272000,
    reservedForResponse: 16384,
    minMessagesToKeep: 5,
    maxMessagesToKeep: 150,
    color: 'magenta',
    tags: ['统一架构', '5级推理强度', 'Agentic工作流'],
    tips: 'GPT-5实际最大输入为272K (400K-128K输出)。GPT-5.5支持约1.05M上下文。支持5级reasoning effort (none/xhigh)，复杂任务可提高推理强度但会增加token消耗。',
  },
];

const TokenManagementPanel: React.FC<TokenManagementPanelProps> = ({
  config,
  onConfigChange,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('token-management-panel-collapsed');
    return saved === 'true';
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    localStorage.setItem('token-management-panel-collapsed', String(collapsed));
  }, [collapsed]);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  return (
    <div className="token-management-panel">
      <div className="token-management-panel-header" onClick={toggleCollapse} style={{ cursor: 'pointer' }}>
        <div className="token-management-panel-title">
          <div className="token-management-collapse-icon">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </div>
          <RocketOutlined className="token-management-icon" />
          <span>上下文窗口设置</span>
          <Tooltip title="控制发送给AI的对话上下文长度，防止上下文过长导致性能问题">
            <QuestionCircleOutlined className="token-management-tooltip-icon" />
          </Tooltip>
        </div>
      </div>

      <div className={`token-management-panel-content ${collapsed ? 'collapsed' : ''}`}>
        <div className="token-management-settings">
          <div className="memory-table-toggle-row">
            <div className="memory-table-toggle-label">
              <span>是否启用</span>
              <Tooltip title="开启后将自动进行Token计数与上下文截断，关闭时发送所有对话历史">
                <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} />
              </Tooltip>
            </div>
            <Switch
              checked={config.enabled ?? true}
              onChange={(checked) => onConfigChange({ enabled: checked })}
              className="memory-table-switch"
            />
          </div>

          <div className={`token-config-fields ${config.enabled === false ? 'disabled' : ''}`}>
            <div className="token-config-item">
              <div className="token-config-label">
                <span>最大上下文Token数</span>
                <Tooltip title="对话上下文（不含System Prompt）的最大Token数。默认6000，适合8K上下文模型">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} />
                </Tooltip>
              </div>
              <InputNumber
                min={1000}
                max={1000000}
                step={1000}
                disabled={config.enabled === false}
                value={config.maxContextTokens ?? 6000}
                onChange={(value) => onConfigChange({ maxContextTokens: value ?? 6000 })}
                style={{ width: '100%' }}
                addonAfter="tokens"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                限制发送给AI的对话历史Token总数（不包含角色卡、系统提示等）
              </Text>
            </div>

            <div className="token-config-item">
              <div className="token-config-label">
                <span>响应预留Token数</span>
                <Tooltip title="为AI响应预留的Token数，确保AI有足够的空间生成回复。默认1024">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} />
                </Tooltip>
              </div>
              <InputNumber
                min={256}
                max={65536}
                step={256}
                disabled={config.enabled === false}
                value={config.reservedForResponse ?? 1024}
                onChange={(value) => onConfigChange({ reservedForResponse: value ?? 1024 })}
                style={{ width: '100%' }}
                addonAfter="tokens"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                从总预算中扣除，预留给AI生成回复的空间
              </Text>
            </div>

            <div className="token-config-item">
              <div className="token-config-label">
                <span>最少保留对话轮数</span>
                <Tooltip title="即使Token超限，也至少保留的对话轮数（1轮=用户+AI各1条消息）。默认2轮">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} />
                </Tooltip>
              </div>
              <InputNumber
                min={1}
                max={20}
                step={1}
                disabled={config.enabled === false}
                value={config.minMessagesToKeep ?? 2}
                onChange={(value) => onConfigChange({ minMessagesToKeep: value ?? 2 })}
                style={{ width: '100%' }}
                addonAfter="轮"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                截断时最少保留的对话轮数（1轮=用户消息+AI回复）
              </Text>
            </div>

            <div className="token-config-item">
              <div className="token-config-label">
                <span>最多保留消息条数</span>
                <Tooltip title="即使Token未超限，也最多发送的消息条数。默认40条，防止发送过多历史消息">
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} />
                </Tooltip>
              </div>
              <InputNumber
                min={10}
                max={500}
                step={5}
                disabled={config.enabled === false}
                value={config.maxMessagesToKeep ?? 40}
                onChange={(value) => onConfigChange({ maxMessagesToKeep: value ?? 40 })}
                style={{ width: '100%' }}
                addonAfter="条"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Token未超限时的消息数量上限，防止发送过多历史
              </Text>
            </div>
          </div>
        </div>

        <div className="token-management-preset-row">
          <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>快捷配置：</Text>
          <Select
            size="small"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="选择模型快速配置"
            dropdownMatchSelectWidth={false}
            popupClassName="token-model-dropdown"
            onChange={(value) => {
              const preset = modelPresets.find(p => p.name === value);
              if (preset) {
                onConfigChange({
                  enabled: true,
                  maxContextTokens: preset.maxContextTokens,
                  reservedForResponse: preset.reservedForResponse,
                  minMessagesToKeep: preset.minMessagesToKeep,
                  maxMessagesToKeep: preset.maxMessagesToKeep,
                });
              }
            }}
          >
            {modelPresets.map((preset) => (
              <Option key={preset.name} value={preset.name}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong style={{ fontSize: 13 }}>{preset.name}</Text>
                  <Space size={4}>
                    {preset.tags.slice(0, 2).map((tag) => (
                      <Tag key={tag} color={preset.color} style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>{tag}</Tag>
                    ))}
                  </Space>
                </Space>
              </Option>
            ))}
          </Select>
        </div>

        {showAdvanced && (
          <div className="token-management-advanced">
            <Card size="small" title="1. 上下文管理策略" style={{ marginBottom: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11 }}>
                <li><Text strong>上下文折叠</Text>：对超长对话，可将早期消息压缩为摘要而非完整保留</li>
                <li><Text strong>动态窗口调整</Text>：根据对话复杂度动态调整maxContextTokens</li>
                <li><Text strong>中间位置退化</Text>：模型在长上下文中对中间部分信息的检索能力下降约30%</li>
              </ul>
            </Card>

            <Card size="small" title="2. Token计数与估算优化" style={{ marginBottom: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11 }}>
                <li><Text strong>UTF-8估算精度</Text>：对中文可能偏差±15%，建议关键场景接入后端精确计数API</li>
                <li><Text strong>缓存命中率提升</Text>：保持System Prompt稳定不变可显著提升缓存命中率至70-80%</li>
                <li><Text strong>消息格式开销</Text>：OpenAI API每条消息有4 tokens固定开销，3 tokens数组填充</li>
              </ul>
            </Card>

            <Card size="small" title="3. 推理效率提升" style={{ marginBottom: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11 }}>
                <li><Text strong>Thinking Mode优化</Text>：简单任务关闭thinking（节省30-50% token），复杂任务开启</li>
                <li><Text strong>批量处理vs流式</Text>：流式体验更好，批量处理可节省10-20% API调用时间</li>
                <li><Text strong>并发请求管理</Text>：多步骤操作使用并发可缩短40-60%总耗时</li>
              </ul>
            </Card>

            <Card size="small" title="4. 资源分配建议" style={{ marginBottom: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11 }}>
                <li><Text strong>价格阈值管理</Text>：Gemini超过200K tokens触发2x价格附加费</li>
                <li><Text strong>离线vs在线模型</Text>：开源模型可本地部署，无token费用但需要GPU资源</li>
                <li><Text strong>MoE架构优势</Text>：稀疏架构推理成本仅为同参数量Dense模型的20-30%</li>
              </ul>
            </Card>

            <Card size="small" title="5. 向量检索与RAG优化" style={{ marginBottom: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11 }}>
                <li><Text strong>检索结果数量</Text>：建议限制向量检索返回10-20条文档</li>
                <li><Text strong>重排序</Text>：re-ranking可将top-k从20条减少到5-8条高质量结果</li>
                <li><Text strong>文档摘要策略</Text>：长文档先AI生成摘要（200-500 tokens），而非直接注入完整文档</li>
              </ul>
            </Card>

            <Card size="small" title="6. 对话历史管理最佳实践" style={{ marginBottom: 8 }}>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 11 }}>
                <li><Text strong>消息成对保护</Text>：截断时确保user+assistant消息成对保留</li>
                <li><Text strong>关键轮次标记</Text>：对重要轮次添加标记，截断时优先保留</li>
                <li><Text strong>定期记忆整理</Text>：每20-30轮对话后执行记忆表格整理</li>
              </ul>
            </Card>
          </div>
        )}

        <div className="token-management-tips">
          <Text type="secondary" style={{ fontSize: 11 }}>
            <strong>💡 提示：</strong>当对话历史超过Token限制时，系统会自动从最旧的消息开始截断。关闭启用开关将发送完整对话历史。所有配置按角色独立保存。
          </Text>
        </div>
      </div>
    </div>
  );
};

export default TokenManagementPanel;
