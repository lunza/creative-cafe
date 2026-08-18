import React, { memo, useCallback, useState } from 'react';
import { Button, Tag, Typography, Tooltip } from 'antd';
import {
  FileTextOutlined,
  MessageOutlined,
  SettingOutlined,
  SmileOutlined,
  EnvironmentOutlined,
  CommentOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { Suggestion, SuggestionType } from '@shared/types';

const { Paragraph } = Typography;

/** 建议类型 → 图标 + 颜色 + 中文名 映射 */
const TYPE_META: Record<SuggestionType, { icon: React.ReactNode; color: string; label: string }> = {
  description: { icon: <FileTextOutlined />, color: 'blue', label: '角色描述' },
  dialogue: { icon: <MessageOutlined />, color: 'purple', label: '对话样例' },
  system_prompt: { icon: <SettingOutlined />, color: 'geekblue', label: '系统提示词' },
  personality: { icon: <SmileOutlined />, color: 'magenta', label: '角色性格' },
  scenario: { icon: <EnvironmentOutlined />, color: 'cyan', label: '场景设定' },
  first_message: { icon: <CommentOutlined />, color: 'gold', label: '初始消息' },
};

interface AssistantSuggestionCardProps {
  suggestion: Suggestion;
}

/**
 * 单条建议展示卡片（Spec: add-ai-assistant-for-character-card-editor / Task 3）
 *
 * 结构：类型标签 + 标题 + 说明 + 可复制内容块（代码块样式）+ 操作提示 + 复制全部按钮。
 * 使用 React.memo 避免列表重渲染时无效刷新。
 */
const AssistantSuggestionCard: React.FC<AssistantSuggestionCardProps> = ({ suggestion }) => {
  const [copied, setCopied] = useState<'content' | 'all' | null>(null);

  const copyText = useCallback(async (text: string, kind: 'content' | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      // 2 秒后自动清除"已复制!"提示
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }, []);

  const meta = TYPE_META[suggestion.type] ?? TYPE_META.description;

  const copyAll = useCallback(() => {
    const fullText = [
      `【${meta.label}】${suggestion.title}`,
      suggestion.description,
      suggestion.editContent,
      suggestion.actionTip ? `操作建议：${suggestion.actionTip}` : '',
    ].filter(Boolean).join('\n\n');
    void copyText(fullText, 'all');
  }, [suggestion, meta, copyText]);

  return (
    <div className="assistant-suggestion-card" style={{ marginBottom: 12 }}>
      {/* 头部：类型标签 + 标题 + 复制全部 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <Tag color={meta.color} icon={meta.icon} style={{ marginRight: 0, flexShrink: 0 }}>
          {meta.label}
        </Tag>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, lineHeight: '20px', color: 'var(--text-primary, #fff)' }}>
          {suggestion.title}
        </span>
        <Tooltip title={copied === 'all' ? '已复制!' : '复制全部'}>
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            style={{ flexShrink: 0 }}
            onClick={copyAll}
          />
        </Tooltip>
      </div>

      {/* 说明 */}
      {suggestion.description && (
        <Paragraph
          style={{ marginBottom: 8, fontSize: 12.5, color: 'var(--text-secondary, #a0a0a0)', whiteSpace: 'pre-wrap' }}
        >
          {suggestion.description}
        </Paragraph>
      )}

      {/* 可复制内容块 */}
      {suggestion.editContent && (
        <div
          style={{
            position: 'relative',
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-base, #404040)',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 6,
          }}
        >
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.6,
              maxHeight: 200,
              overflowY: 'auto',
              color: 'var(--text-primary, #eee)',
              fontFamily: 'Consolas, Menlo, monospace',
            }}
          >
            {suggestion.editContent}
          </pre>
          <Tooltip title={copied === 'content' ? '已复制!' : '复制内容'}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                background: 'rgba(0,0,0,0.5)',
                color: copied === 'content' ? '#52c41a' : 'inherit',
              }}
              onClick={() => void copyText(suggestion.editContent, 'content')}
            />
          </Tooltip>
        </div>
      )}

      {/* 操作建议 */}
      {suggestion.actionTip && (
        <div style={{ fontSize: 12, color: '#1890ff' }}>
          <span style={{ color: 'var(--text-secondary, #a0a0a0)' }}>操作：</span>
          {suggestion.actionTip}
        </div>
      )}
    </div>
  );
};

export default memo(AssistantSuggestionCard);