import React, { useState, useEffect } from 'react';
import { Button, Space, Typography, Input, message, Breadcrumb, Card } from 'antd';
import { SaveOutlined, ArrowLeftOutlined, HomeOutlined, UnorderedListOutlined, EditOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../stores/creativeStore';
import { useUIStore } from '../../stores/uiStore';
import MarkdownEditor from '../Common/MarkdownEditor';

const { Text, Title } = Typography;
const { TextArea } = Input;

const CreativeEditPage: React.FC = () => {
  const { theme, setCreativeTab, setCreativeView } = useUIStore();
  const { currentCreativeId, creatives, updateCreative, loadCreatives } = useCreativeStore();

  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const currentCreative = creatives.find(c => c.id === currentCreativeId);

  useEffect(() => {
    if (currentCreative) {
      setEditingTitle(currentCreative.title || '');
      setEditingDescription(currentCreative.description || '');
      setEditingContent(currentCreative.content || '');
    }
  }, [currentCreative]);

  const handleSave = async () => {
    if (!currentCreativeId) {
      message.error('请先选择要编辑的创意！');
      return;
    }

    setIsSaving(true);
    try {
      updateCreative(currentCreativeId, {
        title: editingTitle,
        description: editingDescription,
        content: editingContent
      });
      loadCreatives();
      message.success('创意保存成功！');
    } catch (error) {
      message.error('保存失败，请重试！');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    setCreativeTab('creative');
    setCreativeView('list');
  };

  if (!currentCreative) {
    return (
      <div style={{ padding: 24 }}>
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            {
              href: '#',
              title: <><HomeOutlined /> 创意管理</>
            },
            {
              title: '创意'
            },
            {
              title: <><EditOutlined /> 编辑</>
            }
          ]}
        />
        <Card>
          <Text type="secondary">请先从创意列表中选择一个创意进行编辑。</Text>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          {
            href: '#',
            title: <><HomeOutlined /> 创意管理</>
          },
          {
            title: '创意'
          },
          {
            title: <><EditOutlined /> 编辑</>
          }
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>编辑创意</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            返回列表
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
          >
            保存
          </Button>
        </Space>
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>标题</Text>
          <Input
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            placeholder="请输入创意标题"
            size="large"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>描述</Text>
          <TextArea
            value={editingDescription}
            onChange={(e) => setEditingDescription(e.target.value)}
            placeholder="请输入创意描述"
            rows={3}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>创意内容</Text>
          <MarkdownEditor
            value={editingContent}
            onChange={setEditingContent}
            minHeight={400}
            theme={theme}
            enableAITools={true}
            placeholder="在此输入您的创意详情..."
          />
        </div>
      </Card>
    </div>
  );
};

export default CreativeEditPage;
