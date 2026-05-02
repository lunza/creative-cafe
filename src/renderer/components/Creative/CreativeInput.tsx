import React, { useState } from 'react';
import { Card, Form, Input, Button, Radio, Tag, Space, Typography, message } from 'antd';
import { PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';

const { TextArea } = Input;
const { Text, Title } = Typography;

const CreativeInput: React.FC = () => {
  const [form] = Form.useForm();
  const [tags, setTags] = useState<string[]>([]);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const { addCreative } = useCreativeStore();

  const handleSubmit = (values: any) => {
    const { title, content, type } = values;
    
    if (!title.trim()) {
      message.error('请输入创意标题');
      return;
    }

    if (!content.trim()) {
      message.error('请输入创意内容');
      return;
    }

    // 添加创意
    const creativeId = addCreative(title, content, type, tags);
    
    if (creativeId) {
      message.success('创意创建成功！');
      form.resetFields();
      setTags([]);
    } else {
      message.error('创意创建失败！');
    }
  };

  const handleCloseTag = (removedTag: string) => {
    const newTags = tags.filter(tag => tag !== removedTag);
    setTags(newTags);
  };

  const showInput = () => {
    setInputVisible(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputConfirm = () => {
    if (inputValue && tags.indexOf(inputValue) === -1) {
      setTags([...tags, inputValue]);
    }
    setInputVisible(false);
    setInputValue('');
  };

  return (
    <Card title={<Title level={4}>新增创意</Title>} className="creative-input-card">
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item 
          name="title" 
          label="创意标题"
          rules={[{ required: true, message: '请输入创意标题' }]}
        >
          <Input 
            placeholder="请输入创意标题..."
            maxLength={100}
            showCount
          />
        </Form.Item>

        <Form.Item 
          name="type" 
          label="创意类型"
          rules={[{ required: true, message: '请选择创意类型' }]}
        >
          <Radio.Group>
            <Radio value="character">角色卡</Radio>
            <Radio value="worldbook">世界书</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item 
          name="content" 
          label="创意内容"
          rules={[{ required: true, message: '请输入创意内容' }]}
        >
          <TextArea 
            rows={8} 
            placeholder="请输入初始提示词、创意想法或开发方向..."
            showCount 
            maxLength={2000}
            style={{ resize: 'vertical' }}
          />
        </Form.Item>

        <Form.Item label="标签">
          <div>
            <Space wrap>
              {tags.map(tag => (
                <Tag 
                  key={tag} 
                  closable 
                  onClose={() => handleCloseTag(tag)}
                >
                  {tag}
                </Tag>
              ))}
              {inputVisible && (
                <Input
                  type="text"
                  size="small"
                  style={{ width: 78 }}
                  value={inputValue}
                  onChange={handleInputChange}
                  onBlur={handleInputConfirm}
                  onPressEnter={handleInputConfirm}
                  autoFocus
                />
              )}
              {!inputVisible && (
                <Tag onClick={showInput} style={{ background: '#fff', borderStyle: 'dashed' }}>
                  <PlusOutlined /> 新增标签
                </Tag>
              )}
            </Space>
            <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
              标签用于分类和组织创意，方便后续管理
            </Text>
          </div>
        </Form.Item>

        <Form.Item>
          <Button 
            type="primary" 
            htmlType="submit" 
            icon={<SendOutlined />}
            size="large"
            style={{ width: '100%' }}
          >
            创建创意
          </Button>
        </Form.Item>

        <div style={{ marginTop: 16 }}>
          <Text type="secondary">
            提示：
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
              <li>输入详细的创意描述，有助于AI生成更符合预期的内容</li>
              <li>选择正确的创意类型，确保AI使用适当的生成策略</li>
              <li>添加标签可以帮助你更好地组织和管理创意</li>
            </ul>
          </Text>
        </div>
      </Form>
    </Card>
  );
};

export default CreativeInput;