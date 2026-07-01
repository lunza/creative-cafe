import React from 'react';
import { Modal, Button, Radio, Card } from 'antd';
import { UpOutlined, DownOutlined } from '@ant-design/icons';
import MarkdownEditor from '../Common/MarkdownEditor';

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
  appTheme,
  addLog,
}) => {
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
          <MarkdownEditor
            value={editingDescriptionTemp}
            onChange={(value) => setEditingDescriptionTemp(value || '')}
            minHeight={300}
            enableAITools={false}
          />
        </div>
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
