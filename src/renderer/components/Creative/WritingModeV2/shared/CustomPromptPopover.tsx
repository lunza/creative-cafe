/**
 * 用户自定义提示词输入 Popover（可复用）
 *
 * Spec: add-ai-custom-prompt-and-interrupt
 * 约定（.learnings/LEARNINGS.md）：所有审核/润色/生成类 AI 功能入口
 * 均接入本组件，输入按 storageKey 持久化到 localStorage，
 * 触发 AI 请求时通过 readCustomPrompt(storageKey) 读取并透传。
 */
import { useEffect, useState } from 'react';
import { Button, Input, Popover, Tooltip, message } from 'antd';
import { DeleteOutlined, FormOutlined } from '@ant-design/icons';

/** 读取已持久化的自定义提示词（父组件触发 AI 请求时调用） */
export function readCustomPrompt(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) || '';
  } catch {
    return '';
  }
}

interface CustomPromptPopoverProps {
  /** localStorage 持久化 key（不同功能入口必须唯一，互不串扰） */
  storageKey: string;
  /** Popover 标题（如"AI 大纲审核 - 自定义提示词"） */
  title: string;
  /** 输入框占位提示 */
  placeholder?: string;
  /** 请求运行中禁用输入 */
  disabled?: boolean;
}

export default function CustomPromptPopover({
  storageKey,
  title,
  placeholder = '输入自定义要求，将作为最高优先级约束附加到 AI 提示词（可选）',
  disabled,
}: CustomPromptPopoverProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(() => readCustomPrompt(storageKey));

  // storageKey 变化时同步（组件实例复用到其他入口的场景）
  useEffect(() => {
    setValue(readCustomPrompt(storageKey));
  }, [storageKey]);

  const handleSave = () => {
    const trimmed = value.trim();
    try {
      if (trimmed) {
        localStorage.setItem(storageKey, trimmed);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      /* localStorage 不可用时静默降级（仅本次会话生效） */
    }
    message.success(trimmed ? '自定义提示词已保存，下次触发时生效' : '自定义提示词已清空');
    setOpen(false);
  };

  const handleClear = () => {
    setValue('');
  };

  const content = (
    <div style={{ width: 360 }}>
      <Input.TextArea
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={2000}
        showCount
        autoFocus
      />
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button size="small" icon={<DeleteOutlined />} onClick={handleClear} disabled={!value}>
          清空
        </Button>
        <Button size="small" type="primary" onClick={handleSave}>
          保存
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      title={title}
      open={open}
      onOpenChange={(v) => {
        if (!disabled) setOpen(v);
      }}
      trigger="click"
      placement="bottomRight"
    >
      <Tooltip title={value ? '自定义提示词（已配置）' : '自定义提示词（未配置）'}>
        <Button
          size="small"
          type="text"
          icon={<FormOutlined />}
          disabled={disabled}
          style={value ? { color: '#1677ff' } : undefined}
        />
      </Tooltip>
    </Popover>
  );
}
