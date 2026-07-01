import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import './StreamingTextEditor.css';

export interface StreamingTextEditorRef {
  setContent: (text: string) => void;
  appendContent: (text: string) => void;
  getContent: () => string;
  setReadOnly: (readOnly: boolean) => void;
  scrollToBottom: () => void;
}

interface StreamingTextEditorProps {
  value?: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  enableMarkdown?: boolean;
  onContentChange?: (content: string) => void;
}

const StreamingTextEditor = forwardRef<StreamingTextEditorRef, StreamingTextEditorProps>(
  ({ value = '', onChange, readOnly = false, className = '', placeholder = '', onContentChange }, ref) => {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const [content, setContent] = useState<string>(value);
    const contentRef = useRef<string>(value);

    // 同步外部 value 变化
    useEffect(() => {
      if (value !== contentRef.current) {
        setContent(value);
        contentRef.current = value;
      }
    }, [value]);

    // 处理用户输入
    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return;

      const newContent = e.target.value;
      setContent(newContent);
      contentRef.current = newContent;

      if (onChange) {
        onChange(newContent);
      }
      if (onContentChange) {
        onContentChange(newContent);
      }
    }, [readOnly, onChange, onContentChange]);

    // 暴露 API
    useImperativeHandle(ref, () => ({
      setContent: (text: string) => {
        setContent(text);
        contentRef.current = text;
      },
      appendContent: (text: string) => {
        const newContent = contentRef.current + text;
        setContent(newContent);
        contentRef.current = newContent;
      },
      getContent: () => contentRef.current,
      setReadOnly: (ro: boolean) => {
        if (editorRef.current) {
          editorRef.current.readOnly = ro;
        }
      },
      scrollToBottom: () => {
        if (editorRef.current) {
          editorRef.current.scrollTop = editorRef.current.scrollHeight;
        }
      }
    }), []);

    return (
      <div className={`streaming-text-editor ${className} ${readOnly ? 'read-only' : ''}`}>
        <textarea
          ref={editorRef}
          className="streaming-editor-content"
          value={content}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={handleInput}
          spellCheck={false}
        />
      </div>
    );
  }
);

StreamingTextEditor.displayName = 'StreamingTextEditor';

export default StreamingTextEditor;
