/**
 * 【Phase 2 / M5 - conversation-mode-optimization-report】多格式导出对话框（N3，参考 V2ExportDialog）。
 *
 * 能力：
 * - 格式选择：TXT / Markdown / HTML（自包含页面）
 * - 消息多选：默认全选，可只导出精选片段（I3：导出仅支持单格式且必须全量 → 多格式 + 子集）
 * - 保存为文件（经调用方 onSave 回调走 fileService）+ 复制到剪贴板
 */
import React, { useMemo, useState } from 'react';
import { Button, Checkbox, Modal, Radio, Space, Tag, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { ChatMessage } from './CharacterDialogueChat.types';
import { buildExportContent, DialogueExportFormat } from './exportContent';
import { formatTimestamp } from './CharacterDialogueChat.utils';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  characterName: string;
  /** 保存导出内容（调用方负责 fileService 交互与文件名生成） */
  onSave: (content: string, format: DialogueExportFormat) => Promise<void>;
}

const FORMAT_OPTIONS: { value: DialogueExportFormat; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'txt', label: 'TXT' },
  { value: 'html', label: 'HTML' },
];

const ExportDialog: React.FC<ExportDialogProps> = ({ open, onClose, messages, characterName, onSave }) => {
  const [format, setFormat] = useState<DialogueExportFormat>('markdown');
  // 默认全选（消息 id 列表）
  const [selected, setSelected] = useState<string[]>(() => messages.map((m) => m.id));
  const [saving, setSaving] = useState(false);

  const allIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const allChecked = selected.length === allIds.length && allIds.length > 0;
  const indeterminate = selected.length > 0 && !allChecked;

  const selectedMessages = useMemo(
    () => messages.filter((m) => selected.includes(m.id)),
    [messages, selected]
  );

  const handleToggleAll = (checked: boolean) => setSelected(checked ? allIds : []);

  const handleToggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const handleSave = async () => {
    if (selectedMessages.length === 0) {
      message.warning('请至少选择一条消息');
      return;
    }
    setSaving(true);
    try {
      const content = buildExportContent(selectedMessages, characterName, format);
      await onSave(content, format);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    if (selectedMessages.length === 0) {
      message.warning('请至少选择一条消息');
      return;
    }
    const content = buildExportContent(selectedMessages, characterName, format);
    navigator.clipboard.writeText(content).then(
      () => message.success('已复制到剪贴板'),
      () => message.error('复制失败')
    );
  };

  return (
    <Modal
      title={
        <Space>
          多格式导出对话
          <Tag>{characterName}</Tag>
        </Space>
      }
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="导出保存"
      okButtonProps={{ disabled: selectedMessages.length === 0 }}
      width={600}
      footer={
        <Space>
          <Button onClick={handleCopy} icon={<CopyOutlined />} disabled={selectedMessages.length === 0}>
            复制所选
          </Button>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} disabled={selectedMessages.length === 0} onClick={handleSave}>
            导出保存
          </Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <span style={{ marginRight: 12 }}>导出格式</span>
        <Radio.Group
          value={format}
          onChange={(e) => setFormat(e.target.value as DialogueExportFormat)}
          options={FORMAT_OPTIONS}
          optionType="button"
          size="small"
        />
      </div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Checkbox
          checked={allChecked}
          indeterminate={indeterminate}
          onChange={(e) => handleToggleAll(e.target.checked)}
        >
          全选（{selectedMessages.length}/{messages.length} 条）
        </Checkbox>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border-color, #334155)', borderRadius: 6, padding: 8 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ padding: '4px 0' }}>
            <Checkbox
              checked={selected.includes(m.id)}
              onChange={(e) => handleToggleOne(m.id, e.target.checked)}
            >
              <span style={{ color: m.role === 'user' ? '#60a5fa' : undefined, marginRight: 6 }}>
                {m.role === 'user' ? '我' : characterName}
              </span>
              <span style={{ color: '#64748b', marginRight: 6, fontSize: 12 }}>{formatTimestamp(m.timestamp)}</span>
              <span style={{ color: '#94a3b8' }}>
                {m.content.slice(0, 40)}{m.content.length > 40 ? '…' : ''}
              </span>
            </Checkbox>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default ExportDialog;
