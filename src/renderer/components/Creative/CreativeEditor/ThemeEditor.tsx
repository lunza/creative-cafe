import React from 'react';
import { Select, Input, Space, Typography, Row, Col, Tag } from 'antd';
import { ThemeEditorProps, CreativeTheme, GENRE_OPTIONS, TONE_OPTIONS } from './CreativeEditor.types';

const { Text } = Typography;

const ThemeEditor: React.FC<ThemeEditorProps> = ({ theme, onChange }) => {
  const handleThemeChange = (key: keyof CreativeTheme, value: string) => {
    const newTheme = { ...theme, [key]: value };
    onChange?.(newTheme);
  };

  return (
    <div style={{ padding: '16px 0' }}>
      <Text strong style={{ display: 'block', marginBottom: 16 }}>
        主题设定
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
          （设置创意的主题背景，有助于AI生成更准确的内容）
        </Text>
      </Text>
      
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Text>类型</Text>
          <Select
            value={theme?.genre}
            onChange={(value) => handleThemeChange('genre', value)}
            options={GENRE_OPTIONS}
            style={{ width: '100%', marginTop: 8 }}
            placeholder="选择创意类型"
          />
        </Col>
        <Col span={12}>
          <Text>基调</Text>
          <Select
            value={theme?.tone}
            onChange={(value) => handleThemeChange('tone', value)}
            options={TONE_OPTIONS}
            style={{ width: '100%', marginTop: 8 }}
            placeholder="选择故事基调"
          />
        </Col>
        <Col span={24}>
          <Text>背景设定</Text>
          <Input.TextArea
            value={theme?.setting}
            onChange={(e) => handleThemeChange('setting', e.target.value)}
            placeholder="描述故事发生的背景环境..."
            style={{ marginTop: 8 }}
            rows={3}
          />
        </Col>
        <Col span={24}>
          <Text>目标受众</Text>
          <Input
            value={theme?.targetAudience}
            onChange={(e) => handleThemeChange('targetAudience', e.target.value)}
            placeholder="例如：青少年、成人、全年龄段..."
            style={{ marginTop: 8 }}
          />
        </Col>
      </Row>
    </div>
  );
};

export default ThemeEditor;
