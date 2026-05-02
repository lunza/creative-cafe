import React from 'react';

/**
 * Markdown编辑器主题类型
 */
export type EditorTheme = 'light' | 'dark';

/**
 * 编辑器功能配置
 */
export interface EditorFeatures {
  blockEdit?: boolean;
  placeholder?: {
    text: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Markdown编辑器配置接口
 */
export interface MarkdownEditorConfig {
  theme?: EditorTheme;
  defaultValue?: string;
  placeholder?: string;
  features?: EditorFeatures;
}

/**
 * Markdown编辑器暴露的接口（通过 forwardRef）
 */
export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (content: string) => void;
  getEditorElement: () => HTMLElement | null;
  /**
   * 手动触发保存
   */
  save: () => Promise<void>;
}

/**
 * Markdown编辑器主组件属性接口
 */
export interface MarkdownEditorProps {
  /**
   * 编辑器主题
   * @default 'light'
   */
  theme?: EditorTheme;

  /**
   * 编辑器内容（受控模式）
   */
  value?: string;

  /**
   * 编辑器默认内容（非受控模式）
   */
  defaultValue?: string;

  /**
   * 内容变化回调
   */
  onChange?: (content: string) => void;

  /**
   * 占位符文本
   * @default '输入 / 以使用指令...'
   */
  placeholder?: string;

  /**
   * 是否启用AI工具栏
   * @default true
   */
  enableAITools?: boolean;

  /**
   * 是否启用保存功能
   * @default false
   */
  enableSave?: boolean;

  /**
   * 本地存储键名
   * @default 'markdown_editor_content'
   */
  storageKey?: string;

  /**
   * 保存成功回调
   */
  onSave?: (content: string) => void;

  /**
   * 从本地存储加载回调
   */
  onLoad?: (content: string) => void;

  /**
   * AI工具配置
   */
  aitoolsConfig?: {
    polishEnabled?: boolean;
    expandEnabled?: boolean;
    translateEnabled?: boolean;
  };

  /**
   * 自定义类名
   */
  className?: string;

  /**
   * 自定义样式
   */
  style?: React.CSSProperties;

  /**
   * 编辑器的最小高度
   * @default '700px'
   */
  minHeight?: string | number;

  /**
   * 编辑器的容器样式
   */
  containerStyle?: React.CSSProperties;
}

/**
 * AI工具上下文类型
 */
export interface MarkdownEditorContextType {
  getEditorContent: () => string;
  setEditorContent: (content: string) => void;
  getEditorElement: () => HTMLElement | null;
}

/**
 * 编辑器初始化状态
 */
export interface EditorState {
  isInitialized: boolean;
  error: Error | null;
}
