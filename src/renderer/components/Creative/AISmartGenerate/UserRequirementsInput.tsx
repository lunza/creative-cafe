import React from 'react';
import { Input, Typography, Space, Button } from 'antd';
import { BulbOutlined, ThunderboltOutlined, CrownOutlined, HeartOutlined, SettingOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface QuickSuggestion {
  label: string;
  icon: React.ReactNode;
  prefix: string;
}

const CHARACTER_SUGGESTIONS: QuickSuggestion[] = [
  { label: '性格描写', icon: <HeartOutlined />, prefix: '请着重描写角色的性格特点，' },
  { label: '背景故事', icon: <BulbOutlined />, prefix: '请丰富角色的背景故事，' },
  { label: '能力设定', icon: <ThunderboltOutlined />, prefix: '请详细设定角色的特殊能力，' },
  { label: '外观描述', icon: <CrownOutlined />, prefix: '请详细描述角色的外观特征，' },
  { label: '关系网络', icon: <SettingOutlined />, prefix: '请补充角色的人际关系网络，' },
];

const WORLDBOOK_SUGGESTIONS: QuickSuggestion[] = [
  { label: '地理环境', icon: <BulbOutlined />, prefix: '请详细描述世界的地理环境，' },
  { label: '势力分布', icon: <CrownOutlined />, prefix: '请设定不同势力之间的关系，' },
  { label: '历史背景', icon: <ThunderboltOutlined />, prefix: '请补充世界的重要历史事件，' },
  { label: '文化习俗', icon: <HeartOutlined />, prefix: '请描述世界的文化习俗和社会结构，' },
  { label: '魔法系统', icon: <SettingOutlined />, prefix: '请设定世界的魔法/科技系统，' },
];

interface UserRequirementsInputProps {
  value: string;
  onChange: (value: string) => void;
  generateType: 'character' | 'worldbook';
}

const UserRequirementsInput: React.FC<UserRequirementsInputProps> = ({ value, onChange, generateType }) => {
  const suggestions = generateType === 'character' ? CHARACTER_SUGGESTIONS : WORLDBOOK_SUGGESTIONS;

  const handleSuggestionClick = (prefix: string) => {
    const currentValue = value.trim();
    if (currentValue) {
      onChange(currentValue + '\n' + prefix);
    } else {
      onChange(prefix);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text strong>用户需求</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {value.length}/1000
        </Text>
      </div>

      <Input.TextArea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 1000))}
        placeholder={
          generateType === 'character'
            ? '描述您希望生成的角色特点，例如：角色应该具有怎样的性格？有什么特殊能力？...'
            : '描述您希望生成的世界特点，例如：这是一个什么样的世界？有什么特殊设定？...'
        }
        rows={4}
        maxLength={1000}
        showCount={false}
        style={{ marginBottom: 12 }}
      />

      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>快速添加：</Text>
      </div>
      <Space wrap size="small">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.label}
            size="small"
            icon={suggestion.icon}
            onClick={() => handleSuggestionClick(suggestion.prefix)}
          >
            {suggestion.label}
          </Button>
        ))}
      </Space>
    </div>
  );
};

export default UserRequirementsInput;
