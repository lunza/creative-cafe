/**
 * 用户自定义提示词输入 Popover（可复用）
 *
 * Spec: add-ai-custom-prompt-and-interrupt
 * 约定（.learnings/LEARNINGS.md）：所有审核/润色/生成类 AI 功能入口
 * 均接入本组件，输入按 storageKey 持久化到 localStorage，
 * 触发 AI 请求时通过 readCustomPrompt(storageKey) 读取并透传。
 *
 * 作用域扩展（2026-10-08）：scope 参数支持"按漫画"等维度的独立配置——
 * 实际存储 key 为 `${storageKey}:${scope}`，读取时先取作用域配置、
 * 为空则回退全局配置（原有全局 key 保持默认值语义，向后兼容）。
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

/** 作用域存储 key（如按漫画：`${baseKey}:${folderPath}`） */
export function scopedPromptKey(baseKey: string, scope: string): string {
  return `${baseKey}:${scope}`;
}

/**
 * 带作用域的读取（2026-10-08 三级回退链）：
 * 作用域配置（`${baseKey}:${scope}`）→ 中间层 fallbackKey（如项目级 `${baseKey}:${projectId}`）→ 全局 baseKey。
 * scope 为空时从 fallbackKey 开始回退。每一级为空才落到下一级，保证"章节覆盖项目、项目覆盖全局"的优先级。
 */
export function readScopedCustomPrompt(baseKey: string, scope?: string, fallbackKey?: string): string {
  if (scope) {
    const scoped = readCustomPrompt(scopedPromptKey(baseKey, scope));
    if (scoped) return scoped;
  }
  if (fallbackKey) {
    const fallback = readCustomPrompt(fallbackKey);
    if (fallback) return fallback;
  }
  return readCustomPrompt(baseKey);
}

interface CustomPromptPopoverProps {
  /** localStorage 持久化 key（不同功能入口必须唯一，互不串扰）；设置 scope 时实际 key 为 `${storageKey}:${scope}` */
  storageKey: string;
  /** 作用域（如漫画 folderPath / 章节 `${projectId}:${chapterIndex}`）：同一 storageKey 在不同作用域下互不串扰，未配置时回退 */
  scope?: string;
  /** 中间层回退 key（如项目级 `${storageKey}:${projectId}`）：作用域未配置时先取它，再回退全局 storageKey */
  fallbackKey?: string;
  /** 作用域标题后缀（默认"本漫画专属"；章节场景传"本章专属"等） */
  scopeLabel?: string;
  /** Popover 标题（如"AI 大纲审核 - 自定义提示词"） */
  title: string;
  /** 输入框占位提示 */
  placeholder?: string;
  /** 请求运行中禁用输入 */
  disabled?: boolean;
}

export default function CustomPromptPopover({
  storageKey,
  scope,
  fallbackKey,
  scopeLabel = '本漫画专属',
  title,
  placeholder = '输入自定义要求，将作为最高优先级约束附加到 AI 提示词（可选）',
  disabled,
}: CustomPromptPopoverProps) {
  // 实际持久化 key：有作用域时为 `${storageKey}:${scope}`，否则为 storageKey（全局）
  const effectiveKey = scope ? scopedPromptKey(storageKey, scope) : storageKey;
  const [open, setOpen] = useState(false);
  // 初始值 = 作用域配置 || 中间层（fallbackKey）|| 全局配置（可视化当前实际生效的默认值，可在此基础上改）
  const [value, setValue] = useState<string>(() =>
    readScopedCustomPrompt(storageKey, scope, fallbackKey)
  );

  // storageKey/scope/fallbackKey 变化时同步（组件实例复用到其他入口/其他章节的场景）
  useEffect(() => {
    setValue(readScopedCustomPrompt(storageKey, scope, fallbackKey));
  }, [storageKey, scope, fallbackKey]);

  const handleSave = () => {
    const trimmed = value.trim();
    try {
      if (trimmed) {
        localStorage.setItem(effectiveKey, trimmed);
      } else {
        localStorage.removeItem(effectiveKey);
      }
    } catch {
      /* localStorage 不可用时静默降级（仅本次会话生效） */
    }
    message.success(
      trimmed
        ? scope
          ? `已保存为${scopeLabel}提示词`
          : '自定义提示词已保存，下次触发时生效'
        : scope
          ? `已清空${scopeLabel}提示词（回退上级配置）`
          : '自定义提示词已清空'
    );
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
        placeholder={
          scope
            ? placeholder + '（留空保存则回退全局配置）'
            : placeholder
        }
        maxLength={2000}
        showCount
        autoFocus
      />
      {scope && !readCustomPrompt(effectiveKey) && readScopedCustomPrompt(storageKey, undefined, fallbackKey) && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#faad14' }}>
          当前显示的是上级默认提示词（{scopeLabel}尚未单独配置，保存后即生效为专属配置）
        </div>
      )}
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
      title={scope ? `${title}（${scopeLabel}）` : title}
      open={open}
      onOpenChange={(v) => {
        if (!disabled) setOpen(v);
      }}
      trigger="click"
      placement="bottomRight"
    >
      <Tooltip
        title={
          value
            ? scope && !readCustomPrompt(effectiveKey)
                ? '自定义提示词（使用上级默认）'
                : '自定义提示词（已配置）'
            : '自定义提示词（未配置）'
        }
      >
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
