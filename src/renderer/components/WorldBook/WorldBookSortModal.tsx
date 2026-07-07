import React, { useState } from 'react';
import { Modal, Button, Radio, Card, Input, message } from 'antd';
import { UpOutlined, DownOutlined, ThunderboltOutlined, EditOutlined } from '@ant-design/icons';
import TextEditor from '../Common/TextEditor';

/**
 * 世界书排序/整理 Modal 集合（Task 8 拆分产物）。
 *
 * 从原 WorldBookManager.tsx 迁出的三块排序相关 JSX：
 *  1. 条目整理 Modal（按标题 / AI 智能 / 手动拖拽 三选一）
 *  2. 手动拖拽排序 Modal（上下移动条目）
 *  3. 编辑主题描述 Modal（MarkdownEditor 编辑 worldBook.description）
 *
 * 组件仅为 UI 容器，所有业务逻辑（handleSortEntriesByTitle /
 * handleAISortEntries / handleMoveEntry / handleSaveManualSort）通过 props
 * 由 WorldBookManager 编排层注入，与原实现保持完全一致的行为。
 */
export interface WorldBookSortModalProps {
  // 条目整理 Modal
  isSortModalOpen: boolean;
  setIsSortModalOpen: (open: boolean) => void;
  selectedSortMethod: string;
  setSelectedSortMethod: (method: string) => void;
  // 注意：原 WorldBookManager.tsx 中 handleSortEntriesByTitle 返回 void，
  // handleAISortEntries 返回 Promise<void>。此处用联合类型兼容两者。
  onSortByTitle: () => void | Promise<void>;
  onAISort: () => void | Promise<void>;
  // 手动排序 Modal
  isDragSortModalOpen: boolean;
  setIsDragSortModalOpen: (open: boolean) => void;
  worldBookContent: any;
  onMoveEntry: (index: number, direction: -1 | 1) => void;
  onSaveManualSort: () => void;
  // 编辑主题描述 Modal
  isDescriptionModalOpen: boolean;
  setIsDescriptionModalOpen: (open: boolean) => void;
  editingDescriptionTemp: string;
  setEditingDescriptionTemp: (value: string) => void;
  setWorldBookContent: (updater: (prev: any) => any) => void;
  // AI 生成/润色主题描述
  onAIGenerateDescription: (requirements: string) => Promise<string>;
  onAIPolishDescription: (currentText: string, requirements: string) => Promise<string>;
  // 主题
  appTheme: string;
  // 日志（使用 any 兼容 logStore 中复杂的 addLog 签名）
  addLog: (msg: string, level?: any, options?: any) => void;
}

const WorldBookSortModal: React.FC<WorldBookSortModalProps> = ({
  isSortModalOpen,
  setIsSortModalOpen,
  selectedSortMethod,
  setSelectedSortMethod,
  onSortByTitle,
  onAISort,
  isDragSortModalOpen,
  setIsDragSortModalOpen,
  worldBookContent,
  onMoveEntry,
  onSaveManualSort,
  isDescriptionModalOpen,
  setIsDescriptionModalOpen,
  editingDescriptionTemp,
  setEditingDescriptionTemp,
  setWorldBookContent,
  onAIGenerateDescription,
  onAIPolishDescription,
  appTheme,
  addLog,
}) => {
  // AI 生成/润色主题描述的本地状态
  const [aiActionType, setAiActionType] = useState<'generate' | 'polish' | null>(null);
  const [aiRequirements, setAiRequirements] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const handleExecuteAIAction = async () => {
    if (aiActionType === 'generate') {
      if (!editingDescriptionTemp && !aiRequirements.trim()) {
        // 生成时无需现有文本，但要有条目（hook 内部会校验）
      }
    } else if (aiActionType === 'polish') {
      if (!editingDescriptionTemp.trim()) {
        message.warning('当前没有可润色的主题描述文本');
        return;
      }
    }

    setAiLoading(true);
    try {
      let result = '';
      if (aiActionType === 'generate') {
        result = await onAIGenerateDescription(aiRequirements);
      } else {
        result = await onAIPolishDescription(editingDescriptionTemp, aiRequirements);
      }
      if (result) {
        setEditingDescriptionTemp(result);
        message.success(aiActionType === 'generate' ? 'AI 生成完成' : 'AI 润色完成');
      }
    } catch (error) {
      message.error(`AI 操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setAiLoading(false);
      setAiActionType(null);
      setAiRequirements('');
    }
  };
  return (
    <>
      {/* 手动拖拽排序模态框 */}
      <Modal
        title="手动排序条目"
        open={isDragSortModalOpen}
        onCancel={() => setIsDragSortModalOpen(false)}
        width={800}
        footer={[
          <Button key="save" type="primary" onClick={onSaveManualSort}>
            保存排序
          </Button>,
          <Button key="cancel" onClick={() => setIsDragSortModalOpen(false)}>
            取消
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)'
        }}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          {worldBookContent && worldBookContent.entries && (
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {Object.entries(worldBookContent.entries)
                .map(([key, entry]) => ({ key, entry }))
                .map(({ key, entry }: any, index: number) => (
                  <Card key={key} style={{ marginBottom: 8, border: '1px solid var(--border-base, #333)', backgroundColor: 'var(--bg-elevated, #2a2a2a)', color: 'var(--text-primary, #ffffff)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold' }}>{entry.comment || '无注释'}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary, #8c8c8c)', marginTop: 4 }}>
                          关键词: {entry.key?.join(', ') || '无'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          icon={<UpOutlined />}
                          size="small"
                          onClick={() => onMoveEntry(index, -1)}
                          disabled={index === 0}
                        />
                        <Button
                          icon={<DownOutlined />}
                          size="small"
                          onClick={() => onMoveEntry(index, 1)}
                          disabled={index === Object.keys(worldBookContent.entries).length - 1}
                        />
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          )}
        </div>
      </Modal>

      {/* 编辑主题描述模态框 */}
      <Modal
        title="编辑主题描述"
        open={isDescriptionModalOpen}
        onCancel={() => setIsDescriptionModalOpen(false)}
        width="90vw"
        style={{
          maxWidth: '800px',
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)',
          zIndex: 3000
        }}
        getContainer={() => document.body}
        zIndex={3000}
        maskClosable={false}
        maskStyle={{ zIndex: 3000 }}
        footer={[
          <Button
            key="cancel"
            onClick={() => setIsDescriptionModalOpen(false)}
          >
            取消
          </Button>,
          <Button
            key="ai-generate"
            icon={<ThunderboltOutlined />}
            loading={aiLoading && aiActionType === 'generate'}
            disabled={aiLoading}
            onClick={() => { setAiActionType('generate'); setAiRequirements(''); }}
          >
            AI 生成
          </Button>,
          <Button
            key="ai-polish"
            icon={<EditOutlined />}
            loading={aiLoading && aiActionType === 'polish'}
            disabled={aiLoading || !editingDescriptionTemp.trim()}
            onClick={() => { setAiActionType('polish'); setAiRequirements(''); }}
          >
            AI 润色
          </Button>,
          <Button
            key="save"
            type="primary"
            onClick={() => {
              setWorldBookContent(prev => prev ? { ...prev, description: editingDescriptionTemp } : null);
              setIsDescriptionModalOpen(false);
            }}
          >
            保存
          </Button>
        ]}
        className={appTheme === 'dark' ? 'dark' : ''}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          <TextEditor
            value={editingDescriptionTemp}
            onChange={(value) => setEditingDescriptionTemp(value || '')}
            minHeight={500}
            enableAITools={false}
            theme={appTheme}
            placeholder="在此编辑世界书描述..."
          />
        </div>
      </Modal>

      {/* AI 生成/润色主题描述 - 要求输入模态框 */}
      <Modal
        title={aiActionType === 'generate' ? 'AI 生成主题描述' : 'AI 润色主题描述'}
        open={aiActionType !== null}
        onCancel={() => { if (!aiLoading) { setAiActionType(null); setAiRequirements(''); } }}
        width="600px"
        style={{ zIndex: 3100 }}
        zIndex={3100}
        maskClosable={false}
        footer={[
          <Button key="cancel" disabled={aiLoading} onClick={() => { setAiActionType(null); setAiRequirements(''); }}>
            取消
          </Button>,
          <Button key="execute" type="primary" loading={aiLoading} onClick={handleExecuteAIAction}>
            {aiActionType === 'generate' ? '开始生成' : '开始润色'}
          </Button>
        ]}
      >
        <div style={{ marginBottom: 12, color: 'var(--text-secondary, #8c8c8c)', fontSize: 13 }}>
          {aiActionType === 'generate'
            ? '根据世界书中的现有条目内容，AI 将逆向还原/生成一段主题描述。可在下方输入额外要求（可选）：'
            : 'AI 将根据你的要求润色当前主题描述文本。可在下方输入润色要求（可选）：'}
        </div>
        <Input.TextArea
          value={aiRequirements}
          onChange={(e) => setAiRequirements(e.target.value)}
          rows={4}
          placeholder={aiActionType === 'generate'
            ? '例如：侧重描述世界观的政治格局和科技水平...'
            : '例如：使语言更精炼、增强文学性、统一术语...'}
          disabled={aiLoading}
        />
        {aiActionType === 'polish' && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary, #8c8c8c)' }}>
            当前文本长度：{editingDescriptionTemp.length} 字符
          </div>
        )}
      </Modal>

      {/* 排序模态框 */}
      <Modal
        title="条目整理"
        open={isSortModalOpen}
        onCancel={() => setIsSortModalOpen(false)}
        width={500}
        getContainer={() => document.body}
        zIndex={3000}
        maskStyle={{ zIndex: 3000 }}
        footer={[
          <Button key="cancel" onClick={() => setIsSortModalOpen(false)}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={async () => {
            addLog('[WorldBook] 用户点击了确定按钮，开始执行排序...');
            addLog(`[WorldBook] 选择的排序方法: ${selectedSortMethod}`);

            setIsSortModalOpen(false);

            if (selectedSortMethod === 'title') {
              addLog('[WorldBook] 执行按标题排序...');
              await onSortByTitle();
            } else if (selectedSortMethod === 'ai') {
              addLog('[WorldBook] 执行AI智能排序...');
              await onAISort();
            } else if (selectedSortMethod === 'manual') {
              addLog('[WorldBook] 打开手动排序弹窗...');
              setIsDragSortModalOpen(true);
            }
          }}>
            确定
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)'
        }}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          <p>请选择整理方式：</p>
          <Radio.Group
            value={selectedSortMethod}
            onChange={(e) => setSelectedSortMethod(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <Radio value="title">按标题排序</Radio>
            <Radio value="ai">AI智能排序</Radio>
            <Radio value="manual">手动拖拽排序</Radio>
          </Radio.Group>
        </div>
      </Modal>
    </>
  );
};

export default WorldBookSortModal;
