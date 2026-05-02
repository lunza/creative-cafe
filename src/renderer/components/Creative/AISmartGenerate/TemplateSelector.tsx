import React from 'react';
import { Typography, Card } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';

const { Text } = Typography;

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'character' | 'game_master' | 'worldbook';
  systemPrompt: string;
  buildPrompt: (creative: string) => string;
}

interface TemplateSelectorProps {
  templates: PromptTemplate[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
  theme: 'light' | 'dark';
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  templates,
  selectedTemplateId,
  onSelect,
  theme,
}) => {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong>选择模板</Text>
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
          （不同模板使用不同的生成策略）
        </Text>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {templates.map((template) => {
          const isSelected = selectedTemplateId === template.id;
          return (
            <Card
              key={template.id}
              size="small"
              hoverable
              onClick={() => onSelect(template.id)}
              style={{
                cursor: 'pointer',
                border: isSelected
                  ? '2px solid #1890ff'
                  : `1px solid ${theme === 'dark' ? '#303030' : '#d9d9d9'}`,
                transition: 'all 0.2s',
                position: 'relative',
              }}
            >
              {isSelected && (
                <CheckCircleFilled
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    color: '#1890ff',
                    fontSize: 16,
                  }}
                />
              )}
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                {template.name}
              </Text>
              <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {template.description}
              </Text>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TemplateSelector;
