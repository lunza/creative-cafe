/**
 * AgentParamPanel — 智能体对话参数配置面板
 *
 * 包含：
 *  - 人格自定义 TextArea（引导回复语气/表达方式/应答风格/破限规则）
 *  - 辅助模式 Switch + 强度选择（低/中/高）
 *  - 重置为默认按钮
 *
 * 所有参数变更通过 onParamsChange 回调实时上抛，无需确认。
 */
import React, { useState } from 'react';
import { Switch, Radio, Button, Tooltip } from 'antd';
import {
  SettingOutlined, UserOutlined, BulbOutlined,
  UndoOutlined, DownOutlined, RightOutlined,
} from '@ant-design/icons';
import type { AgentParams, AssistModeIntensity } from './hooks/useAgentParams';
import './AgentParamPanel.css';

interface AgentParamPanelProps {
  params: AgentParams;
  onParamsChange: (partial: Partial<AgentParams>) => void;
  onReset: () => void;
}

const AgentParamPanel: React.FC<AgentParamPanelProps> = ({ params, onParamsChange, onReset }) => {
  const [personalityExpanded, setPersonalityExpanded] = useState(true);
  const [assistExpanded, setAssistExpanded] = useState(true);

  return (
    <div className="agent-param-panel">
      <div className="agent-param-header">
        <span className="agent-param-title">
          <SettingOutlined /> 参数配置
        </span>
        <Tooltip title="重置为默认">
          <Button
            size="small"
            type="text"
            icon={<UndoOutlined />}
            onClick={onReset}
            className="agent-param-reset-btn"
          />
        </Tooltip>
      </div>

      {/* 人格自定义区块 */}
      <div className="agent-param-section">
        <div
          className="agent-param-section-header"
          onClick={() => setPersonalityExpanded(!personalityExpanded)}
        >
          {personalityExpanded ? <DownOutlined className="agent-param-collapse-icon" /> : <RightOutlined className="agent-param-collapse-icon" />}
          <UserOutlined className="agent-param-section-icon" />
          <span className="agent-param-section-title">人格自定义</span>
          {params.customPersonality && (
            <span className="agent-param-badge agent-param-badge-purple">已设置</span>
          )}
        </div>
        {personalityExpanded && (
          <div className="agent-param-section-body">
            <textarea
              className="agent-param-textarea"
              value={params.customPersonality}
              onChange={(e) => onParamsChange({ customPersonality: e.target.value })}
              placeholder="输入人格描述，引导智能体的回复语气、表达方式、应答风格及破限规则。例如：&#10;• 用古风文言文回复，语气沉稳内敛&#10;• 以幽默风趣的方式回答，适当使用网络梗&#10;• 回答时先给出结论，再展开分析"
              rows={6}
            />
            <div className="agent-param-hint">
              人格仅影响交互风格，不影响智能体的身份和职责
            </div>
          </div>
        )}
      </div>

      {/* 辅助模式区块 */}
      <div className="agent-param-section">
        <div
          className="agent-param-section-header"
          onClick={() => setAssistExpanded(!assistExpanded)}
        >
          {assistExpanded ? <DownOutlined className="agent-param-collapse-icon" /> : <RightOutlined className="agent-param-collapse-icon" />}
          <BulbOutlined className="agent-param-section-icon" />
          <span className="agent-param-section-title">辅助模式</span>
          {params.assistMode && (
            <span className="agent-param-badge agent-param-badge-orange">
              {params.assistModeIntensity === 'low' ? '低' : params.assistModeIntensity === 'high' ? '高' : '中'}
            </span>
          )}
        </div>
        {assistExpanded && (
          <div className="agent-param-section-body">
            <div className="agent-param-row">
              <span className="agent-param-label">启用辅助引导</span>
              <Switch
                checked={params.assistMode}
                onChange={(checked) => onParamsChange({ assistMode: checked })}
                size="small"
              />
            </div>
            {params.assistMode && (
              <div className="agent-param-row agent-param-row-column">
                <span className="agent-param-label">引导强度</span>
                <Radio.Group
                  value={params.assistModeIntensity}
                  onChange={(e) => onParamsChange({ assistModeIntensity: e.target.value as AssistModeIntensity })}
                  size="small"
                  buttonStyle="solid"
                >
                  <Radio.Button value="low">低</Radio.Button>
                  <Radio.Button value="medium">中</Radio.Button>
                  <Radio.Button value="high">高</Radio.Button>
                </Radio.Group>
                <div className="agent-param-hint">
                  {params.assistModeIntensity === 'low' && '选项贴合当前话题，引导性较弱'}
                  {params.assistModeIntensity === 'medium' && '适度转换角度，保持对话张力'}
                  {params.assistModeIntensity === 'high' && '大胆创新，可能引入全新话题分支'}
                </div>
              </div>
            )}
            {!params.assistMode && (
              <div className="agent-param-hint">
                开启后，AI 回复末尾会生成 3 个推荐选项引导对话方向
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentParamPanel;
