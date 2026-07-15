import React, { useState } from 'react';
import { Modal, Form, Input, Button, Card, Typography, message } from 'antd';
import { PlusOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';
import { createDefaultEntry } from '../../utils/worldBookUtils';

const { Text } = Typography;

interface WorldBookCreateModalProps {
  open: boolean;
  onCancel: () => void;
  onCreateWorldBook: (name: string, description: string, entries: any[]) => void;
  onGenerateEntries: (theme: string) => Promise<any[]>;
  onExpandKeywords: (keywords: string, fieldName: 'key' | 'keysecondary') => Promise<string>;
  onGenerateDescription: (keywords: string, theme: string) => Promise<string>;
}

const WorldBookCreateModal: React.FC<WorldBookCreateModalProps> = ({
  open,
  onCancel,
  onCreateWorldBook,
  onGenerateEntries,
  onExpandKeywords,
  onGenerateDescription
}) => {
  const [form] = Form.useForm();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedEntries, setGeneratedEntries] = useState<any[]>([]);
  const [generatedDescription, setGeneratedDescription] = useState('');

  const handleGenerateEntries = async () => {
    const theme = form.getFieldValue('themeDescription');
    if (!theme) {
      message.warning('请先输入主题描述');
      return;
    }
    
    setIsGenerating(true);
    try {
      const entries = await onGenerateEntries(theme);
      setGeneratedEntries(entries);
    } catch (error) {
      message.error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    onCreateWorldBook(values.worldBookName, generatedDescription || values.worldBookDescription || '', generatedEntries);
  };

  const handleAddManualEntry = () => {
    const comment = (document.getElementById('manual-comment') as HTMLInputElement)?.value || '';
    const keyStr = (document.getElementById('manual-key') as HTMLTextAreaElement)?.value || '';
    const content = (document.getElementById('manual-content') as HTMLTextAreaElement)?.value || '';
    
    const key = keyStr.split(/[,，]/).map(k => k.trim()).filter(k => k);
    const newEntry = createDefaultEntry(generatedEntries.length, key, comment, content);
    setGeneratedEntries([...generatedEntries, newEntry]);
    
    (document.getElementById('manual-comment') as HTMLInputElement).value = '';
    (document.getElementById('manual-key') as HTMLTextAreaElement).value = '';
    (document.getElementById('manual-content') as HTMLTextAreaElement).value = '';
    
    message.success('条目添加成功');
  };

  return (
    <Modal
      title="新建世界书"
      open={open}
      onCancel={() => {
        onCancel();
        form.resetFields();
        setGeneratedEntries([]);
        setGeneratedDescription('');
      }}
      width={1000}
      footer={[
        <Button key="cancel" onClick={() => {
          onCancel();
          form.resetFields();
          setGeneratedEntries([]);
        }}>
          取消
        </Button>,
        <Button key="create" type="primary" onClick={handleCreate}>
          创建世界书
        </Button>
      ]}
      style={{
        backgroundColor: 'var(--bg-container, #1f1f1f)',
        color: 'var(--text-primary, #ffffff)'
      }}
    >
      <div style={{ color: 'var(--text-primary, #ffffff)' }}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="worldBookName"
            label="世界书名称"
            rules={[{ required: true, message: '请输入世界书名称' }]}
          >
            <Input placeholder="请输入世界书名称" />
          </Form.Item>

          <Form.Item
            name="worldBookDescription"
            label="世界书简介"
          >
            <Input.TextArea 
              rows={4} 
              placeholder="请输入世界书简介（支持富文本格式）"
              value={generatedDescription}
              onChange={(e) => setGeneratedDescription(e.target.value)}
            />
          </Form.Item>

          <Form.Item
            name="themeDescription"
            label="主题描述"
            rules={[{ required: true, message: '请输入主题描述' }]}
          >
            <Input.TextArea 
              rows={4} 
              placeholder="例如：我想生成一个基于奇幻世界RPG的世界书，包含魔法和科技等"
            />
          </Form.Item>

          <div style={{ marginBottom: 16 }}>
            <Button 
              type="primary" 
              icon={isGenerating ? <LoadingOutlined /> : <ThunderboltOutlined />}
              loading={isGenerating}
              onClick={handleGenerateEntries}
              style={{ marginBottom: 16 }}
            >
              {isGenerating ? 'AI生成中...' : 'AI生成条目'}
            </Button>

            {generatedEntries.length > 0 && (
              <Card title={`已生成 ${generatedEntries.length} 个条目`} style={{ marginBottom: 16 }}>
                {generatedEntries.map((entry, index) => (
                  <Card key={index} size="small" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      条目 {index + 1}: {entry.comment || '无注释'}
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary">关键词: </Text>
                      {entry.key?.join(', ') || '无'}
                    </div>
                    <div style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary, #8c8c8c)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '120px',
                      overflowY: 'auto',
                      padding: '4px 8px',
                      backgroundColor: 'var(--bg-elevated, rgba(0,0,0,0.2))',
                      borderRadius: 4,
                    }}>
                      {entry.content || '无'}
                    </div>
                  </Card>
                ))}
              </Card>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 'bold' }}>手动添加条目</div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>注释</label>
              <Input placeholder="输入注释" id="manual-comment" />
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>主要关键词 (逗号分隔)</label>
              <Input.TextArea placeholder="输入关键词，用逗号分隔" id="manual-key" />
              <Button 
                type="link" 
                onClick={async () => {
                  const keywords = (document.getElementById('manual-key') as HTMLTextAreaElement)?.value;
                  if (keywords) {
                    const expanded = await onExpandKeywords(keywords, 'key');
                    if (expanded) {
                      (document.getElementById('manual-key') as HTMLTextAreaElement).value = expanded;
                    }
                  } else {
                    message.warning('请先输入关键词');
                  }
                }}
              >
                AI扩写
              </Button>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>内容</label>
              <Input.TextArea rows={6} placeholder="输入条目内容" id="manual-content" />
              <Button 
                type="link" 
                onClick={async () => {
                  const keywords = (document.getElementById('manual-key') as HTMLTextAreaElement)?.value;
                  const theme = form.getFieldValue('themeDescription');
                  if (keywords && theme) {
                    const description = await onGenerateDescription(keywords, theme);
                    if (description) {
                      (document.getElementById('manual-content') as HTMLTextAreaElement).value = description;
                    }
                  } else {
                    message.warning('请先输入关键词和主题描述');
                  }
                }}
              >
                AI生成描述
              </Button>
            </div>
            
            <Button 
              type="default" 
              icon={<PlusOutlined />}
              onClick={handleAddManualEntry}
            >
              添加手动条目
            </Button>
          </div>
        </Form>
      </div>
    </Modal>
  );
};

export default WorldBookCreateModal;
