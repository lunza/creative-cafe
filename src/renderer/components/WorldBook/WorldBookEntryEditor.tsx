import React, { memo, useCallback } from 'react';
import { Modal, Input, Select, Switch, Space, Button, message } from 'antd';
import {
  TranslationOutlined,
  EditOutlined,
  StopOutlined
} from '@ant-design/icons';
import type { UseWorldBookFormStateReturn } from './hooks/useWorldBookFormState';

/**
 * 世界书条目编辑 Modal（Task 8 拆分产物 SubTask 8.2）。
 *
 * 从原 WorldBookManager.tsx 中迁出的"编辑条目"弹窗：包含 SillyTavern 核心字段
 * （注释 / 主关键词 / 次关键词 / 内容）+ 标准配置（顺序 / 概率 / 深度 / 位置 /
 * 分组 / 常量 / 选择性 / 禁用 / 正则 / 向量化 / 大小写）+ Creative-Cafe 高级配置
 * （自动化ID / 扫描深度 / 显示索引 / 完整单词 / 组评分 / 递归控制）。
 *
 * 本组件仅承担 Modal 内部表单的渲染与提交，包含两个内部 handler：
 *  - handleEditEntryModalOk（保存编辑并写回 worldbook 文件）
 *  - handleEditEntryModalCancel（关闭 Modal）
 *
 * "打开 Modal" 的 handleEditEntry 触发函数已迁入 WorldBookEntryTable.tsx
 * （条目卡片点击"编辑条目"按钮直接修改 formState.isEditEntryModalOpen 即可）。
 *
 * AI 翻译 / 润色按钮通过 props 注入 handler 触发；中断按钮直接复用上层
 * handleCancelAIRequest。组件本身行为与原实现逐行一致。
 */
export interface WorldBookEntryEditorProps {
  formState: UseWorldBookFormStateReturn;
  /** AI 翻译单字段（field: 'comment' | 'content' | 'key' | 'keysecondary'） */
  onTranslate: (field: string) => void | Promise<void>;
  /** 触发 AI 单字段润色流程（弹出润色要求 Modal） */
  onPolish: (field: string) => void;
  /** 中断 AI 请求 */
  onCancelAIRequest: () => void;
  /** 写日志 */
  addLog: (msg: string, level?: string) => void;
}

const WorldBookEntryEditor: React.FC<WorldBookEntryEditorProps> = ({
  formState,
  onTranslate,
  onPolish,
  onCancelAIRequest,
  addLog,
}) => {
  const {
    isEditEntryModalOpen,
    setIsEditEntryModalOpen,
    editingEntry,
    setEditingEntry,
    editingEntryUid,
    setEditingEntryUid,
    formValues,
    setFormValues,
    translatingField,
    polishingField,
    worldBookContent,
    setWorldBookContent,
    viewingItem,
  } = formState;

  // 注：原 handleEditEntry（打开 Modal 的触发函数）已迁入 WorldBookEntryTable.tsx
  // 通过 WorldBookEntryTable 的"编辑条目"按钮调用，由其直接修改 formState 中的
  // isEditEntryModalOpen / editingEntry / editingEntryUid / formValues 即可打开本 Modal。
  // 本组件仅负责 Modal 内部表单的渲染与提交（onOk）/ 取消（onCancel）。

  // 保存编辑
  const handleEditEntryModalOk = useCallback(async () => {
    addLog(`[WorldBook] 保存条目编辑: UID=${editingEntryUid}`);
    try {
      if (worldBookContent && worldBookContent.entries && editingEntryUid !== null) {
        const newWorldBookContent = JSON.parse(JSON.stringify(worldBookContent));

        let entryFound = false;
        for (const key in newWorldBookContent.entries) {
          const entry = newWorldBookContent.entries[key];
          if (entry.uid === editingEntryUid || key === String(editingEntryUid)) {
            addLog(`[WorldBook] 找到匹配条目: Key=${key}, EntryUID=${entry.uid}`);

            newWorldBookContent.entries[key] = {
              ...entry,
              ...formValues,
              // 确保数组字段存在
              key: formValues.key.length > 0 ? formValues.key : [''],
              keysecondary: formValues.keysecondary.length > 0 ? formValues.keysecondary : [],
              // 保留 Creative-Cafe 独有字段
              automationId: formValues.automationId,
              scanDepth: formValues.scanDepth,
              displayIndex: formValues.displayIndex,
              matchWholeWords: formValues.matchWholeWords,
              useGroupScoring: formValues.useGroupScoring,
              excludeRecursion: formValues.excludeRecursion,
              preventRecursion: formValues.preventRecursion,
              delayUntilRecursion: formValues.delayUntilRecursion
            };

            entryFound = true;
            break;
          }
        }

        if (!entryFound) {
          addLog(`[WorldBook] 未找到匹配的条目: UID=${editingEntryUid}`, 'error');
          message.error('未找到匹配的条目');
          return;
        }

        await window.electronAPI.worldBook.write(viewingItem!.path, newWorldBookContent);
        addLog(`[WorldBook] 条目编辑保存成功: UID=${editingEntryUid}`, 'info');

        message.success('编辑成功');
        setWorldBookContent(newWorldBookContent);
        setIsEditEntryModalOpen(false);
        setEditingEntry(null);
        setEditingEntryUid(null);
      }
    } catch (error) {
      addLog(`[WorldBook] 条目编辑保存失败: UID=${editingEntryUid}`, 'error');
      message.error('编辑失败');
    }
  }, [addLog, worldBookContent, editingEntryUid, formValues, viewingItem, setWorldBookContent, setIsEditEntryModalOpen, setEditingEntry, setEditingEntryUid]);

  // 取消编辑
  const handleEditEntryModalCancel = useCallback(() => {
    setIsEditEntryModalOpen(false);
    setEditingEntry(null);
    setEditingEntryUid(null);
  }, [setIsEditEntryModalOpen, setEditingEntry, setEditingEntryUid]);

  return (
    <Modal
      title={`编辑条目: ${editingEntry?.comment || '无注释'}`}
      open={isEditEntryModalOpen}
      onOk={handleEditEntryModalOk}
      onCancel={handleEditEntryModalCancel}
      width="90vw"
      getContainer={() => document.body}
      zIndex={3000}
      maskStyle={{ zIndex: 3000 }}
      style={{
        maxWidth: '1200px',
        backgroundColor: 'var(--bg-container, #1f1f1f)',
        color: 'var(--text-primary, #ffffff)',
        zIndex: 3000
      }}
    >
      <div style={{ color: 'var(--text-primary, #ffffff)' }}>
        {/* SillyTavern 核心字段 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>注释 (Comment)</label>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input
              value={formValues.comment}
              onChange={(e) => setFormValues(prev => ({ ...prev, comment: e.target.value }))}
              placeholder="条目备注说明"
            />
            <Space>
              {translatingField === 'comment' ? (
                <Button type="link" danger icon={<StopOutlined />} onClick={onCancelAIRequest} size="small">
                  中断翻译
                </Button>
              ) : (
                <Button type="link" icon={<TranslationOutlined />} onClick={() => onTranslate('comment')} size="small">
                  AI翻译
                </Button>
              )}
              {polishingField === 'comment' ? (
                <Button type="link" danger icon={<StopOutlined />} onClick={onCancelAIRequest} size="small">
                  中断润色
                </Button>
              ) : (
                <Button type="link" icon={<EditOutlined />} onClick={() => onPolish('comment')} size="small">
                  AI润色
                </Button>
              )}
            </Space>
          </Space>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>主要关键词 (Key) - 输入后按回车添加</label>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={formValues.key}
            onChange={(value) => setFormValues(prev => ({ ...prev, key: value }))}
            placeholder="输入关键词后按回车添加"
            tokenSeparators={[',']}
            allowClear
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>次要关键词 (Secondary Key) - 输入后按回车添加</label>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={formValues.keysecondary}
            onChange={(value) => setFormValues(prev => ({ ...prev, keysecondary: value }))}
            placeholder="输入次要关键词后按回车添加"
            tokenSeparators={[',']}
            allowClear
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>内容 (Content)</label>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input.TextArea
              rows={6}
              value={formValues.content}
              onChange={(e) => setFormValues(prev => ({ ...prev, content: e.target.value }))}
              placeholder="条目注入的内容"
            />
            <Space>
              {translatingField === 'content' ? (
                <Button type="link" danger icon={<StopOutlined />} onClick={onCancelAIRequest} size="small">
                  中断翻译
                </Button>
              ) : (
                <Button type="link" icon={<TranslationOutlined />} onClick={() => onTranslate('content')} size="small">
                  AI翻译
                </Button>
              )}
              {polishingField === 'content' ? (
                <Button type="link" danger icon={<StopOutlined />} onClick={onCancelAIRequest} size="small">
                  中断润色
                </Button>
              ) : (
                <Button type="link" icon={<EditOutlined />} onClick={() => onPolish('content')} size="small">
                  AI润色
                </Button>
              )}
            </Space>
          </Space>
        </div>

        {/* SillyTavern 标准配置 */}
        <div style={{ marginBottom: 12, fontWeight: 500, color: '#1890ff' }}>SillyTavern 标准配置</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>排序权重 (Order)</label>
            <Input type="number" value={formValues.order} onChange={(e) => setFormValues(prev => ({ ...prev, order: parseInt(e.target.value) || 0 }))} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>激活概率 (Probability %)</label>
            <Input type="number" min={0} max={100} value={formValues.probability} onChange={(e) => { const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0)); setFormValues(prev => ({ ...prev, probability: val })); }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>递归深度 (Depth)</label>
            <Input type="number" min={0} value={formValues.depth} onChange={(e) => setFormValues(prev => ({ ...prev, depth: parseInt(e.target.value) || 0 }))} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>注入位置 (Position)</label>
            <Select
              style={{ width: '100%' }}
              value={formValues.position}
              onChange={(value) => setFormValues(prev => ({ ...prev, position: value }))}
              options={[
                { label: '角色之前 (before_char)', value: 'before_char' },
                { label: '角色之后 (after_char)', value: 'after_char' },
                { label: '示例之前 (before_example)', value: 'before_example' },
                { label: '按深度注入 (at_depth)', value: 'at_depth' }
              ]}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>分组 (Group)</label>
            <Input value={formValues.group} onChange={(e) => setFormValues(prev => ({ ...prev, group: e.target.value }))} placeholder="分组名称" />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.constant} onChange={(checked) => setFormValues(prev => ({ ...prev, constant: checked }))} />
            <span>常量 (Constant)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.selective} onChange={(checked) => setFormValues(prev => ({ ...prev, selective: checked }))} />
            <span>选择性 (Selective)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.disable} onChange={(checked) => setFormValues(prev => ({ ...prev, disable: checked }))} />
            <span>禁用 (Disable)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.useRegex} onChange={(checked) => setFormValues(prev => ({ ...prev, useRegex: checked }))} />
            <span>正则匹配 (use_regex)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.vectorized} onChange={(checked) => setFormValues(prev => ({ ...prev, vectorized: checked }))} />
            <span>向量化 (Vectorized)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.caseSensitive} onChange={(checked) => setFormValues(prev => ({ ...prev, caseSensitive: checked }))} />
            <span>区分大小写 (case_sensitive)</span>
          </div>
        </div>

        {/* Creative-Cafe 高级配置 */}
        <div style={{ marginBottom: 12, fontWeight: 500, color: '#52c41a' }}>Creative-Cafe 高级配置</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>自动化ID</label>
            <Input value={formValues.automationId} onChange={(e) => setFormValues(prev => ({ ...prev, automationId: e.target.value }))} placeholder="可选" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>扫描深度</label>
            <Input type="number" value={formValues.scanDepth} onChange={(e) => setFormValues(prev => ({ ...prev, scanDepth: parseInt(e.target.value) || 0 }))} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>显示索引</label>
            <Input type="number" value={formValues.displayIndex} onChange={(e) => setFormValues(prev => ({ ...prev, displayIndex: parseInt(e.target.value) || 0 }))} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.matchWholeWords} onChange={(checked) => setFormValues(prev => ({ ...prev, matchWholeWords: checked }))} />
            <span>完整单词匹配</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.useGroupScoring} onChange={(checked) => setFormValues(prev => ({ ...prev, useGroupScoring: checked }))} />
            <span>使用组评分</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.excludeRecursion} onChange={(checked) => setFormValues(prev => ({ ...prev, excludeRecursion: checked }))} />
            <span>排除递归</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={formValues.preventRecursion} onChange={(checked) => setFormValues(prev => ({ ...prev, preventRecursion: checked }))} />
            <span>防止递归</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={!!formValues.delayUntilRecursion} onChange={(checked) => setFormValues(prev => ({ ...prev, delayUntilRecursion: checked ? 1 : 0 }))} />
            <span>延迟到递归</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default memo(WorldBookEntryEditor);
