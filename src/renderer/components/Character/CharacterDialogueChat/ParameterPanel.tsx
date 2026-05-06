import React, { useState, useCallback } from 'react';
import { Tooltip, Button, Slider } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { AIParameterConfig, EffectiveAIParams } from './CharacterDialogueChat.types';
import './ConfigPanel.css';

interface ParameterConfig {
  key: keyof AIParameterConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  tooltip: string;
  defaultValue: number;
}

const PARAMETER_CONFIGS: ParameterConfig[] = [
  {
    key: 'max_tokens',
    label: 'Max Tokens',
    min: 256,
    max: 32768,
    step: 256,
    defaultValue: 8192,
    tooltip: '模型生成的最大 token 数量。值越大，模型能输出的内容越长。默认值：8192',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0.1,
    max: 2.0,
    step: 0.05,
    defaultValue: 0.7,
    tooltip: '控制输出的随机性。较低值（0.1-0.5）使输出更确定和保守，较高值（0.8-2.0）使输出更创意和多样。推荐值：0.7-1.0',
  },
  {
    key: 'top_p',
    label: 'Top P',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    defaultValue: 0.9,
    tooltip: '核采样参数，控制输出的多样性。较低值使输出更集中，较高值使输出更多样。推荐值：0.9-1.0',
  },
  {
    key: 'frequency_penalty',
    label: 'Frequency Penalty',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    defaultValue: 0.0,
    tooltip: '降低重复token的权重。正值减少重复，负值增加重复。推荐值：0.0-0.5',
  },
  {
    key: 'presence_penalty',
    label: 'Presence Penalty',
    min: -2.0,
    max: 2.0,
    step: 0.1,
    defaultValue: 0.0,
    tooltip: '鼓励模型谈论新话题。正值使模型更愿意引入新话题。推荐值：0.0-0.5',
  },
];

interface ParameterPanelProps {
  effectiveParams: EffectiveAIParams;
  customParameters: AIParameterConfig | undefined;
  onParameterChange: (params: Partial<AIParameterConfig>) => void;
  onResetParameters: () => void;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  effectiveParams,
  customParameters,
  onParameterChange,
  onResetParameters,
}) => {
  const [localValues, setLocalValues] = useState<AIParameterConfig>(
    customParameters || {}
  );

  const handleSliderChange = useCallback((key: keyof AIParameterConfig, value: number) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSliderAfterChange = useCallback((key: keyof AIParameterConfig, value: number) => {
    const configDef = PARAMETER_CONFIGS.find(c => c.key === key);
    const effectiveValue = value;
    const defaultValue = configDef?.defaultValue;
    
    if (defaultValue !== undefined && Math.abs(effectiveValue - defaultValue) < 0.001) {
      const newValues = { ...localValues };
      delete newValues[key];
      setLocalValues(newValues);
      const newCustomParams = { ...(customParameters || {}) };
      delete newCustomParams[key];
      if (Object.keys(newCustomParams).length === 0) {
        onParameterChange({});
      } else {
        onParameterChange(newCustomParams);
      }
    } else {
      onParameterChange({ [key]: value });
    }
  }, [localValues, customParameters, onParameterChange]);

  const handleReset = useCallback(() => {
    setLocalValues({});
    onResetParameters();
  }, [onResetParameters]);

  const isCustomized = customParameters && Object.keys(customParameters).length > 0;

  return (
    <div className="parameter-panel">
      <div className="parameter-panel-header">
        <div className="parameter-panel-title">AI 参数配置</div>
        {isCustomized && (
          <Tooltip title="已使用自定义参数">
            <span className="parameter-custom-badge">自定义</span>
          </Tooltip>
        )}
      </div>

      <div className="parameter-list">
        {PARAMETER_CONFIGS.map(config => {
          const currentValue = localValues[config.key] ?? effectiveParams[config.key] ?? config.defaultValue;
          const isModified = localValues[config.key] !== undefined;

          return (
            <div key={config.key} className="parameter-item">
              <div className="parameter-header">
                <div className="parameter-label-group">
                  <span className="parameter-label">{config.label}</span>
                  <Tooltip title={config.tooltip}>
                    <QuestionCircleOutlined className="parameter-tooltip-icon" />
                  </Tooltip>
                </div>
                <span className={`parameter-value ${isModified ? 'modified' : ''}`}>
                  {config.key === 'max_tokens' ? Math.round(currentValue).toString() : currentValue.toFixed(2)}
                </span>
              </div>
              <Slider
                min={config.min}
                max={config.max}
                step={config.step}
                value={currentValue}
                onChange={(value) => handleSliderChange(config.key, value)}
                onAfterChange={(value) => handleSliderAfterChange(config.key, value as number)}
                className="parameter-slider"
              />
            </div>
          );
        })}
      </div>

      <div className="parameter-actions">
        <Button
          type="default"
          icon={<ReloadOutlined />}
          onClick={handleReset}
          disabled={!isCustomized}
          className="parameter-reset-btn"
        >
          重置为默认值
        </Button>
      </div>
    </div>
  );
};

export default ParameterPanel;
