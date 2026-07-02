import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Input, Button, Space, Tooltip, Typography, theme as antTheme } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CodeOutlined,
  MessageOutlined,
  LineOutlined,
  LinkOutlined,
  FontSizeOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

/**
 * TextEditor - 轻量级长文本编辑器
 *
 * 基于 Ant Design 原生组件构建，完全使用系统 CSS 变量，
 * 替代 Milkdown 编辑器，视觉风格与系统主题高度一致。
 *
 * 支持纯文本编辑 + Markdown 快捷工具栏 + 自动行号。
 */

export type TextEditorTheme = 'light' | 'dark';

export interface TextEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (content: string) => void;
  getEditorElement: () => HTMLTextAreaElement | null;
  save: () => Promise<void>;
}

export interface TextEditorProps {
  theme?: TextEditorTheme;
  value?: string;
  defaultValue?: string;
  onChange?: (content: string) => void;
  placeholder?: string;
  enableAITools?: boolean;
  enableSave?: boolean;
  storageKey?: string;
  onSave?: (content: string) => void;
  onLoad?: (content: string) => void;
  className?: string;
  style?: React.CSSProperties;
  minHeight?: string | number;
  containerStyle?: React.CSSProperties;
  /** 是否显示工具栏 */
  showToolbar?: boolean;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
}

// 工具栏按钮配置
interface ToolbarButton {
  key: string;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}

const TextEditorComponent = (
  props: TextEditorProps,
  ref: React.Ref<TextEditorHandle>
) => {
  const {
    theme = 'light',
    value: controlledValue,
    defaultValue = '',
    onChange,
    placeholder = '在此输入内容...',
    enableSave = false,
    storageKey = 'text_editor_content',
    onSave,
    className,
    style,
    minHeight = 600,
    containerStyle,
    showToolbar = true,
    showLineNumbers = false,
  } = props;

  const { token } = antTheme.useToken();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<string>(controlledValue ?? defaultValue);
  const [innerValue, setInnerValue] = useState<string>(
    controlledValue ?? defaultValue
  );

  // 同步外部受控值
  useEffect(() => {
    if (controlledValue !== undefined && controlledValue !== contentRef.current) {
      contentRef.current = controlledValue;
      setInnerValue(controlledValue);
    }
  }, [controlledValue]);

  // 从本地存储加载
  useEffect(() => {
    if (enableSave && storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored && controlledValue === undefined) {
          contentRef.current = stored;
          setInnerValue(stored);
          props.onLoad?.(stored);
        }
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      contentRef.current = newValue;
      setInnerValue(newValue);
      onChange?.(newValue);
    },
    [onChange]
  );

  const getMarkdown = useCallback((): string => {
    return contentRef.current;
  }, []);

  const setMarkdown = useCallback(
    (newContent: string) => {
      const safeContent = newContent || '';
      contentRef.current = safeContent;
      setInnerValue(safeContent);
      onChange?.(safeContent);
    },
    [onChange]
  );

  const getEditorElement = useCallback((): HTMLTextAreaElement | null => {
    return textareaRef.current;
  }, []);

  const handleSave = useCallback(async () => {
    const currentContent = getMarkdown();
    if (enableSave && storageKey) {
      try {
        localStorage.setItem(storageKey, currentContent);
      } catch {
        // ignore
      }
    }
    onSave?.(currentContent);
  }, [enableSave, storageKey, getMarkdown, onSave]);

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown,
      setMarkdown,
      getEditorElement,
      save: handleSave,
    }),
    [getMarkdown, setMarkdown, getEditorElement, handleSave]
  );

  // ==================== 工具栏操作 ====================

  const wrapSelection = useCallback(
    (before: string, after: string = before, placeholderText: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = contentRef.current;
      const selectedText = currentValue.substring(start, end);
      const textToInsert = selectedText || placeholderText;
      const newValue =
        currentValue.substring(0, start) +
        before +
        textToInsert +
        after +
        currentValue.substring(end);

      setMarkdown(newValue);

      // 恢复光标位置
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newCursorPos = start + before.length + textToInsert.length;
          textareaRef.current.focus();
          if (selectedText) {
            textareaRef.current.setSelectionRange(
              start + before.length,
              newCursorPos
            );
          } else {
            textareaRef.current.setSelectionRange(
              start + before.length,
              newCursorPos
            );
          }
        }
      });
    },
    [setMarkdown]
  );

  const insertAtLineStart = useCallback(
    (prefix: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const currentValue = contentRef.current;
      const lineStart = currentValue.lastIndexOf('\n', start - 1) + 1;
      const newValue =
        currentValue.substring(0, lineStart) +
        prefix +
        currentValue.substring(lineStart);

      setMarkdown(newValue);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(
            start + prefix.length,
            start + prefix.length
          );
        }
      });
    },
    [setMarkdown]
  );

  const insertText = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = contentRef.current;
      const newValue =
        currentValue.substring(0, start) +
        text +
        currentValue.substring(end);

      setMarkdown(newValue);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(
            start + text.length,
            start + text.length
          );
        }
      });
    },
    [setMarkdown]
  );

  const toolbarButtons: ToolbarButton[] = useMemo(
    () => [
      {
        key: 'heading',
        icon: <FontSizeOutlined />,
        title: '标题',
        onClick: () => insertAtLineStart('## '),
      },
      {
        key: 'bold',
        icon: <BoldOutlined />,
        title: '粗体',
        onClick: () => wrapSelection('**', '**', '粗体文本'),
      },
      {
        key: 'italic',
        icon: <ItalicOutlined />,
        title: '斜体',
        onClick: () => wrapSelection('*', '*', '斜体文本'),
      },
      {
        key: 'strikethrough',
        icon: <StrikethroughOutlined />,
        title: '删除线',
        onClick: () => wrapSelection('~~', '~~', '删除线文本'),
      },
      {
        key: 'unorderedList',
        icon: <UnorderedListOutlined />,
        title: '无序列表',
        onClick: () => insertAtLineStart('- '),
      },
      {
        key: 'orderedList',
        icon: <OrderedListOutlined />,
        title: '有序列表',
        onClick: () => insertAtLineStart('1. '),
      },
      {
        key: 'quote',
        icon: <MessageOutlined />,
        title: '引用',
        onClick: () => insertAtLineStart('> '),
      },
      {
        key: 'code',
        icon: <CodeOutlined />,
        title: '行内代码',
        onClick: () => wrapSelection('`', '`', 'code'),
      },
      {
        key: 'codeblock',
        icon: <CodeOutlined />,
        title: '代码块',
        onClick: () => insertText('\n```\n代码\n```\n'),
      },
      {
        key: 'link',
        icon: <LinkOutlined />,
        title: '链接',
        onClick: () => wrapSelection('[', '](url)', '链接文本'),
      },
      {
        key: 'divider',
        icon: <LineOutlined />,
        title: '分隔线',
        onClick: () => insertText('\n---\n'),
      },
    ],
    [insertAtLineStart, wrapSelection, insertText]
  );

  // ==================== 样式计算 ====================

  const isDark = theme === 'dark';

  const editorContainerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      borderRadius: token.borderRadius,
      border: `1px solid ${isDark ? '#333' : '#d9d9d9'}`,
      overflow: 'hidden',
      transition: `border-color ${token.motionDurationMid} ${token.motionEaseInOut}`,
      background: isDark ? '#1f1f1f' : '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      ...containerStyle,
    }),
    [token, isDark, containerStyle]
  );

  const toolbarStyle: React.CSSProperties = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '6px 12px',
      borderBottom: `1px solid ${isDark ? '#333' : '#f0f0f0'}`,
      background: isDark ? '#1a1a1a' : '#fafafa',
      flexShrink: 0,
      flexWrap: 'wrap',
    }),
    [isDark]
  );

  const textareaStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
      border: 'none',
      borderRadius: 0,
      resize: 'vertical',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: '15px',
      lineHeight: 1.8,
      padding: '20px 24px',
      background: isDark ? '#1f1f1f' : '#ffffff',
      color: isDark ? '#e0e0e0' : '#333333',
      outline: 'none',
      boxShadow: 'none',
    }),
    [minHeight, isDark]
  );

  return (
    <div
      className={`cc-text-editor ${isDark ? 'cc-text-editor-dark' : ''} ${className || ''}`}
      style={{ ...editorContainerStyle, ...style }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = token.colorPrimary;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = isDark ? '#333' : '#d9d9d9';
      }}
    >
      {/* 工具栏 */}
      {showToolbar && (
        <div style={toolbarStyle}>
          <Space size={2}>
            {toolbarButtons.map((btn) => (
              <Tooltip key={btn.key} title={btn.title}>
                <Button
                  type="text"
                  size="small"
                  icon={btn.icon}
                  onClick={btn.onClick}
                  style={{
                    color: isDark ? '#a0a0a0' : '#595959',
                    minWidth: 28,
                    height: 28,
                  }}
                />
              </Tooltip>
            ))}
          </Space>
        </div>
      )}

      {/* 编辑区 */}
      <textarea
        ref={textareaRef}
        value={innerValue}
        onChange={handleChange}
        placeholder={placeholder}
        style={textareaStyle}
        spellCheck={false}
      />
    </div>
  );
};

const TextEditor = forwardRef(TextEditorComponent);

export default TextEditor;
