import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Typography, Input, Tag, Badge, message, Alert } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import MarkdownEditor from '../Common/MarkdownEditor';
import { useCreativeStore } from '../../stores/creativeStore';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';

const { Text, Title } = Typography;
const { TextArea } = Input;

const CreativeDetail: React.FC = () => {
  const { theme } = useUIStore();
  const { 
    currentCreativeId, 
    getCurrentCreative, 
    updateCreative 
  } = useCreativeStore();
  const { addLog } = useLogStore();
  
  const currentCreative = getCurrentCreative();
  const [editingTitle, setEditingTitle] = useState(currentCreative?.title || '');
  const [editingDescription, setEditingDescription] = useState(currentCreative?.description || '');
  const [editingContent, setEditingContent] = useState(currentCreative?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (currentCreative) {
      setEditingTitle(currentCreative.title || '');
      setEditingDescription(currentCreative.description || '');
      setEditingContent(currentCreative.content || '');
    }
  }, [currentCreative]);

  const handleSaveCreative = async () => {
    if (!currentCreativeId) {
      message.error('请先选择或创建一个创意！');
      return;
    }

    setIsSaving(true);
    try {
      updateCreative(currentCreativeId, {
        title: editingTitle,
        description: editingDescription,
        content: editingContent
      });
      
      addLog('[Creative] 创意内容已保存');
      message.success('创意内容已保存！');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存失败';
      addLog(`[Creative] 保存失败: ${errorMessage}`, 'error');
      message.error('保存失败，请重试！');
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentCreative) {
    return (
      <Card className="current-creative-card" size="small">
        <Alert 
          message="提示" 
          description="请在左侧树状图中选择或创建一个创意" 
          type="info" 
          showIcon 
        />
      </Card>
    );
  }

  return (
    <Card className="current-creative-card" size="small">
      <div className="current-creative-header">
        <Title level={4} style={{ margin: 0 }}>创意编辑</Title>
        <Space size="small">
          <Badge 
            count={editingContent.length} 
            showZero 
            style={{ backgroundColor: theme === 'dark' ? '#40a9ff' : '#1890ff' }} 
          />
          <Button 
            type="primary" 
            size="small" 
            icon={<SaveOutlined />}
            onClick={handleSaveCreative}
            loading={isSaving}
          >
            保存
          </Button>
        </Space>
      </div>
      
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>创意标题</Text>
          <Input 
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            placeholder="输入创意标题"
            size="large"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>创意描述</Text>
          <TextArea 
            value={editingDescription}
            onChange={(e) => setEditingDescription(e.target.value)}
            placeholder="简单描述一下这个创意"
            rows={3}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            创意内容 
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              （在此处输入您的完整创意，角色卡和世界书将基于此内容生成）
            </Text>
          </Text>
          <MarkdownEditor
            value={editingContent}
            onChange={setEditingContent}
            minHeight={400}
            theme={theme}
            enableAITools={true}
            placeholder="在此输入您的创意详情..."
          />
        </div>

        <Alert
          message="使用说明"
          description={
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
              <li>在此处编辑您的创意详细内容</li>
              <li>在左侧树状图中创建角色卡或世界书</li>
              <li>在角色卡或世界书编辑器中使用智能生成功能时，将基于此创意内容进行生成</li>
              <li>点击保存按钮保存您的创意修改</li>
            </ul>
          }
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      </div>
    </Card>
  );
};

export default CreativeDetail;
