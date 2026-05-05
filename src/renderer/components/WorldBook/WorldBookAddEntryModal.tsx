import React, { useState } from 'react';
import { Modal, Form, Input, Button, Card, Typography, message } from 'antd';
import { PlusOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';
import { createDefaultEntry } from '../../utils/worldBookUtils';

const { Text } = Typography;

interface WorldBookAddEntryModalProps {
  open: boolean;
  onCancel: () => void;
  onGenerateEntries: (expectedContent: string, count: number) => Promise<any[]>;
  onExpandKeywords: (keywords: string, fieldName: 'key' | 'keysecondary') => Promise<string>;
  onGenerateDescription: (keywords: string, theme: string) => Promise<string>;
  onSaveEntries: (entries: any[]) => Promise<boolean>;
}

const WorldBookAddEntryModal: React.FC<WorldBookAddEntryModalProps> = ({
  open,
  onCancel,
  onGenerateEntries,
  onExpandKeywords,
  onGenerateDescription,
  onSaveEntries
}) => {
  const [form] = Form.useForm();
  const [isGenerating, setIsGenerating] = useState(false);
  const [addedEntries, setAddedEntries] = useState<any[]>([]);

  const handleGenerateEntries = async () => {
    const values = await form.validateFields();
    const expectedContent = values.expectedContent?.trim();
    const count = parseInt(values.count);
    if (!expectedContent || !count) {
      message.warning('请填写完整信息');
      return;
    }
    
    setIsGenerating(true);
    try {
      const entries = await onGenerateEntries(expectedContent, count);
      setAddedEntries(entries);
    } catch (error) {
      message.error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (addedEntries.length === 0) {
      message.warning('没有可保存的条目');
      return;
    }
    
    const success = await onSaveEntries(addedEntries);
    if (success) {
      onCancel();
      form.resetFields();
      setAddedEntries([]);
    }
  };

  const handleAddManualEntry = () => {
    const comment = (document.getElementById('manual-comment-add') as HTMLInputElement)?.value || '';
    const keyStr = (document.getElementById('manual-key-add') as HTMLTextAreaElement)?.value || '';
    const content = (document.getElementById('manual-content-add') as HTMLTextAreaElement)?.value || '';
    
    const key = keyStr.split(/[,，]/).map(k => k.trim()).filter(k => k);
    const newEntry = createDefaultEntry(Date.now(), key, comment, content);
    setAddedEntries([...addedEntries, newEntry]);
    
    (document.getElementById('manual-comment-add') as HTMLInputElement).value = '';
    (document.getElementById('manual-key-add') as HTMLTextAreaElement).value = '';
    (document.getElementById('manual-content-add') as HTMLTextAreaElement).value = '';
    
    message.success('条目添加成功');
  };

  return (
    <Modal
      title="添加条目"
      open={open}
      onCancel={() => {
        onCancel();
        form.resetFields();
        setAddedEntries([]);
      }}
      width={1000}
      footer={[
        <Button key="cancel" onClick={() => {
          onCancel();
          form.resetFields();
          setAddedEntries([]);
        }}>
          取消
        </Button>,
        <Button key="save" type="primary" onClick={handleSave}>
          保存条目
        </Button>
      ]}
      style={{
        backgroundColor: 'var(--bg-color, #fff)',
        color: 'var(--text-color, #000)'
      }}
    >
      <div style={{ color: 'var(--text-color, #000)' }}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="expectedContent"
            label="预期内容"
            rules={[{ required: true, message: '请输入预期内容' }]}
          >
            <Input.TextArea 
              rows={3} 
              placeholder="例如：生成角色信息、生成地点信息、生成游戏规则等"
            />
          </Form.Item>

          <Form.Item
            name="count"
            label="生成条目数量"
            rules={[
              { required: true, message: '请输入生成条目数量' },
              {
                validator: (_, value) => {
                  const num = parseInt(value);
                  if (isNaN(num) || num < 1 || num > 20) {
                    return Promise.reject(new Error('数量应在1-20之间'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Input type="number" min={1} max={20} placeholder="输入生成条目数量" />
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

            {addedEntries.length > 0 && (
              <Card title={`已生成 ${addedEntries.length} 个条目`} style={{ marginBottom: 16 }}>
                {addedEntries.map((entry, index) => (
                  <Card key={index} size="small" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      条目 {index + 1}: {entry.comment || '无注释'}
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary">关键词: </Text>
                      {entry.key?.join(', ') || '无'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-color, #666)' }}>
                      {entry.content?.substring(0, 100)}{entry.content?.length > 100 ? '...' : ''}
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
              <Input placeholder="输入注释" id="manual-comment-add" />
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>主要关键词 (逗号分隔)</label>
              <Input.TextArea placeholder="输入关键词，用逗号分隔" id="manual-key-add" />
              <Button 
                type="link" 
                onClick={async () => {
                  const keywords = (document.getElementById('manual-key-add') as HTMLTextAreaElement)?.value;
                  if (keywords) {
                    const expanded = await onExpandKeywords(keywords, 'key');
                    if (expanded) {
                      (document.getElementById('manual-key-add') as HTMLTextAreaElement).value = expanded;
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
              <Input.TextArea rows={6} placeholder="输入条目内容" id="manual-content-add" />
              <Button 
                type="link" 
                onClick={async () => {
                  const keywords = (document.getElementById('manual-key-add') as HTMLTextAreaElement)?.value;
                  const expectedContent = form.getFieldValue('expectedContent');
                  if (keywords && expectedContent) {
                    const description = await onGenerateDescription(keywords, expectedContent);
                    if (description) {
                      (document.getElementById('manual-content-add') as HTMLTextAreaElement).value = description;
                    }
                  } else {
                    message.warning('请先输入关键词和预期内容');
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

export default WorldBookAddEntryModal;
