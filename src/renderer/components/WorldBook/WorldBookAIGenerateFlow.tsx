import React, { memo, useCallback } from 'react';
import { Modal, Form, Input, Button, Card, Space, Typography, message } from 'antd';
import { PlusOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';
import WorldBookTemplateSelector from './WorldBookTemplateSelector';
import WorldBookGenerateModal from './WorldBookGenerateModal';
import { createDefaultEntry } from '../../utils/worldBookUtils';
import type { UseWorldBookFormStateReturn } from './hooks/useWorldBookFormState';

const { Text } = Typography;

/**
 * 世界书 AI 生成全流程组件（Task 8 拆分产物 SubTask 8.3）。
 *
 * 从原 WorldBookManager.tsx 中迁出的三块 AI 生成相关 UI：
 *  1. 新建世界书 Modal（输入名称/简介/主题描述 + WorldBookTemplateSelector +
 *     手动添加条目 + AI 扩写关键词 + AI 生成描述 + handleCreateWorldBook）
 *  2. 添加条目 Modal（输入预期内容 + 生成数量 + AI 生成条目 + 手动添加 +
 *     AI 扩写关键词 + AI 生成描述 + handleSaveAddedEntries）
 *  3. AI 生成世界书 Modal（WorldBookGenerateModal：从角色生成世界书）
 *
 * 组件仅承担 UI 渲染，业务逻辑（handleCreateWorldBook /
 * handleTemplateGenerateEntries / handleExpandKeywords /
 * handleGenerateDescription / handleGenerateNewEntries /
 * handleSaveAddedEntries / handleCreateFromAI / handleGenerateFromCharacters）
 * 通过 props 注入。
 */
export interface WorldBookAIGenerateFlowProps {
  formState: UseWorldBookFormStateReturn;
  /** antd Form 实例（新建世界书） */
  createForm: any;
  /** antd Form 实例（添加条目） */
  addEntryForm: any;
  /** 创建世界书（基于 generatedEntries） */
  onCreateWorldBook: () => void | Promise<void>;
  /** 模板生成条目 */
  onTemplateGenerateEntries: (template: any, params: Record<string, any>, theme: string) => Promise<any[]>;
  /** AI 扩写关键词 */
  onExpandKeywords: (keywords: string, fieldName: 'key' | 'keysecondary') => Promise<string | undefined>;
  /** AI 根据关键词 + 主题生成描述 */
  onGenerateDescription: (keywords: string, themeDescription: string) => Promise<string | undefined>;
  /** AI 生成新条目（添加条目 Modal 内） */
  onGenerateNewEntries: (expectedContent: string, count: number) => void | Promise<void>;
  /** 保存添加的条目到当前世界书 */
  onSaveAddedEntries: () => void | Promise<void>;
  /** 从 AI 创建新世界书（基于角色） */
  onCreateFromAI: (name: string, description: string, entries: any[]) => void | Promise<void>;
  /** 从角色信息生成世界书 */
  onGenerateFromCharacters: (charactersInfo: string, instructions: string) => Promise<{ name: string; description: string; entries: any[] }>;
}

const WorldBookAIGenerateFlow: React.FC<WorldBookAIGenerateFlowProps> = ({
  formState,
  createForm,
  addEntryForm,
  onCreateWorldBook,
  onTemplateGenerateEntries,
  onExpandKeywords,
  onGenerateDescription,
  onGenerateNewEntries,
  onSaveAddedEntries,
  onCreateFromAI,
  onGenerateFromCharacters,
}) => {
  const {
    isCreateModalOpen,
    setIsCreateModalOpen,
    generatedEntries,
    setGeneratedEntries,
    generatedWorldBookDescription,
    setGeneratedWorldBookDescription,
    setGeneratedWorldBookName,
    isAddEntryModalOpen,
    setIsAddEntryModalOpen,
    addedEntries,
    setAddedEntries,
    isAddingEntry,
    isGenerateModalOpen,
    setIsGenerateModalOpen,
  } = formState;

  // 关闭新建世界书 Modal
  const closeCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
    createForm.resetFields();
    setGeneratedEntries([]);
    setGeneratedWorldBookName('');
    setGeneratedWorldBookDescription('');
  }, [setIsCreateModalOpen, createForm, setGeneratedEntries, setGeneratedWorldBookName, setGeneratedWorldBookDescription]);

  // 关闭添加条目 Modal
  const closeAddEntryModal = useCallback(() => {
    setIsAddEntryModalOpen(false);
    addEntryForm.resetFields();
    setAddedEntries([]);
  }, [setIsAddEntryModalOpen, addEntryForm, setAddedEntries]);

  // 新建 Modal 中：手动添加条目
  const handleAddManualEntry = useCallback(() => {
    const comment = (document.getElementById('manual-comment') as HTMLInputElement)?.value || '';
    const keyStr = (document.getElementById('manual-key') as HTMLTextAreaElement)?.value || '';
    const content = (document.getElementById('manual-content') as HTMLTextAreaElement)?.value || '';

    const key = keyStr.split(/[,，]/).map(k => k.trim()).filter(k => k);

    const newEntry = createDefaultEntry(generatedEntries.length, key, comment, content);
    setGeneratedEntries([...generatedEntries, newEntry]);

    // 清空输入框
    (document.getElementById('manual-comment') as HTMLInputElement).value = '';
    (document.getElementById('manual-key') as HTMLTextAreaElement).value = '';
    (document.getElementById('manual-content') as HTMLTextAreaElement).value = '';

    message.success('条目添加成功');
  }, [generatedEntries, setGeneratedEntries]);

  // 新建 Modal 中：AI 扩写关键词
  const handleExpandKeyCreate = useCallback(async () => {
    const keywords = (document.getElementById('manual-key') as HTMLTextAreaElement)?.value;
    if (keywords) {
      const expanded = await onExpandKeywords(keywords, 'key');
      if (expanded) {
        (document.getElementById('manual-key') as HTMLTextAreaElement).value = expanded;
      }
    } else {
      message.warning('请先输入关键词');
    }
  }, [onExpandKeywords]);

  // 新建 Modal 中：AI 生成描述
  const handleGenerateDescCreate = useCallback(async () => {
    const keywords = (document.getElementById('manual-key') as HTMLTextAreaElement)?.value;
    const theme = createForm.getFieldValue('themeDescription');
    if (keywords && theme) {
      const description = await onGenerateDescription(keywords, theme);
      if (description) {
        (document.getElementById('manual-content') as HTMLTextAreaElement).value = description;
      }
    } else {
      message.warning('请先输入关键词和主题描述');
    }
  }, [onGenerateDescription, createForm]);

  // 添加条目 Modal 中：手动添加条目
  const handleAddManualEntryAdd = useCallback(() => {
    const comment = (document.getElementById('manual-comment-add') as HTMLInputElement)?.value || '';
    const keyStr = (document.getElementById('manual-key-add') as HTMLTextAreaElement)?.value || '';
    const content = (document.getElementById('manual-content-add') as HTMLTextAreaElement)?.value || '';

    const key = keyStr.split(/[,，]/).map(k => k.trim()).filter(k => k);

    const newEntry = createDefaultEntry(Date.now(), key, comment, content);
    setAddedEntries([...addedEntries, newEntry]);

    // 清空输入框
    (document.getElementById('manual-comment-add') as HTMLInputElement).value = '';
    (document.getElementById('manual-key-add') as HTMLTextAreaElement).value = '';
    (document.getElementById('manual-content-add') as HTMLTextAreaElement).value = '';

    message.success('条目添加成功');
  }, [addedEntries, setAddedEntries]);

  // 添加条目 Modal 中：AI 扩写关键词
  const handleExpandKeyAdd = useCallback(async () => {
    const keywords = (document.getElementById('manual-key-add') as HTMLTextAreaElement)?.value;
    if (keywords) {
      const expanded = await onExpandKeywords(keywords, 'key');
      if (expanded) {
        (document.getElementById('manual-key-add') as HTMLTextAreaElement).value = expanded;
      }
    } else {
      message.warning('请先输入关键词');
    }
  }, [onExpandKeywords]);

  // 添加条目 Modal 中：AI 生成描述
  const handleGenerateDescAdd = useCallback(async () => {
    const keywords = (document.getElementById('manual-key-add') as HTMLTextAreaElement)?.value;
    const expectedContent = addEntryForm.getFieldValue('expectedContent');
    if (keywords && expectedContent) {
      const description = await onGenerateDescription(keywords, expectedContent);
      if (description) {
        (document.getElementById('manual-content-add') as HTMLTextAreaElement).value = description;
      }
    } else {
      message.warning('请先输入关键词和预期内容');
    }
  }, [onGenerateDescription, addEntryForm]);

  // 添加条目 Modal 中：AI 生成条目按钮
  const handleGenerateEntriesClick = useCallback(async () => {
    const values = await addEntryForm.validateFields();
    const expectedContent = values.expectedContent?.trim();
    const count = parseInt(values.count);
    if (expectedContent && count) {
      await onGenerateNewEntries(expectedContent, count);
    }
  }, [addEntryForm, onGenerateNewEntries]);

  return (
    <>
      {/* 新建世界书 Modal */}
      <Modal
        title="新建世界书"
        open={isCreateModalOpen}
        onCancel={closeCreateModal}
        width={1000}
        footer={[
          <Button key="cancel" onClick={closeCreateModal}>
            取消
          </Button>,
          <Button key="create" type="primary" onClick={onCreateWorldBook}>
            创建世界书
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)'
        }}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          <Form form={createForm} layout="vertical">
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
                rows={3}
                placeholder="请输入世界书简介"
                value={generatedWorldBookDescription}
                onChange={(e) => setGeneratedWorldBookDescription(e.target.value)}
              />
            </Form.Item>

            <Form.Item
              name="themeDescription"
              label="主题描述"
              rules={[{ required: true, message: '请输入主题描述' }]}
            >
              <Input.TextArea
                rows={3}
                placeholder="例如：奇幻世界RPG、剑与魔法的世界、末日废土生存..."
              />
            </Form.Item>
          </Form>

          <div style={{ marginTop: 16 }}>
            <WorldBookTemplateSelector
              onGenerateEntries={onTemplateGenerateEntries}
              theme={createForm.getFieldValue('themeDescription') || ''}
            />
          </div>

          {generatedEntries.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Card title={`已生成 ${generatedEntries.length} 个条目`} size="small" style={{ marginBottom: 16 }}>
                {generatedEntries.map((entry, index) => (
                  <Card key={index} size="small" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      条目 {index + 1}: {entry.comment || '无注释'}
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary">关键词: </Text>
                      {entry.key?.join(', ') || '无'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary, #8c8c8c)' }}>
                      {entry.content?.substring(0, 100)}{entry.content?.length > 100 ? '...' : ''}
                    </div>
                  </Card>
                ))}
              </Card>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 'bold' }}>手动添加条目</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>注释</label>
              <Input
                placeholder="输入注释"
                id="manual-comment"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>主要关键词 (逗号分隔)</label>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  placeholder="输入关键词，用逗号分隔"
                  id="manual-key"
                />
                <Button
                  type="link"
                  onClick={handleExpandKeyCreate}
                >
                  AI扩写
                </Button>
              </Space>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>内容</label>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  rows={6}
                  placeholder="输入条目内容"
                  id="manual-content"
                />
                <Button
                  type="link"
                  onClick={handleGenerateDescCreate}
                >
                  AI生成描述
                </Button>
              </Space>
            </div>

            <Button
              type="default"
              icon={<PlusOutlined />}
              onClick={handleAddManualEntry}
            >
              添加手动条目
            </Button>
          </div>
        </div>
      </Modal>

      {/* 添加条目 Modal */}
      <Modal
        title="添加条目"
        open={isAddEntryModalOpen}
        onCancel={closeAddEntryModal}
        width={1000}
        getContainer={() => document.body}
        zIndex={3000}
        maskStyle={{ zIndex: 3000 }}
        footer={[
          <Button key="cancel" onClick={closeAddEntryModal}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={onSaveAddedEntries}>
            保存条目
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)',
          zIndex: 3000
        }}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          <Form form={addEntryForm} layout="vertical">
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
                icon={isAddingEntry ? <LoadingOutlined /> : <ThunderboltOutlined />}
                loading={isAddingEntry}
                onClick={handleGenerateEntriesClick}
                style={{ marginBottom: 16 }}
              >
                {isAddingEntry ? 'AI生成中...' : 'AI生成条目'}
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
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary, #8c8c8c)' }}>
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
                <Input
                  placeholder="输入注释"
                  id="manual-comment-add"
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>主要关键词 (逗号分隔)</label>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea
                    placeholder="输入关键词，用逗号分隔"
                    id="manual-key-add"
                  />
                  <Button
                    type="link"
                    onClick={handleExpandKeyAdd}
                  >
                    AI扩写
                  </Button>
                </Space>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>内容</label>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea
                    rows={6}
                    placeholder="输入条目内容"
                    id="manual-content-add"
                  />
                  <Button
                    type="link"
                    onClick={handleGenerateDescAdd}
                  >
                    AI生成描述
                  </Button>
                </Space>
              </div>

              <Button
                type="default"
                icon={<PlusOutlined />}
                onClick={handleAddManualEntryAdd}
              >
                添加手动条目
              </Button>
            </div>
          </Form>
        </div>
      </Modal>

      {/* AI 生成世界书 Modal */}
      <WorldBookGenerateModal
        open={isGenerateModalOpen}
        onCancel={() => setIsGenerateModalOpen(false)}
        onCreateWorldBook={onCreateFromAI}
        onGenerateFromCharacters={onGenerateFromCharacters}
      />
    </>
  );
};

export default memo(WorldBookAIGenerateFlow);
