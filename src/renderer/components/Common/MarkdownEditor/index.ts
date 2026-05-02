/**
 * MarkdownEditor 通用组件模块
 * 
 * 一个功能完整、可复用的Markdown编辑器组件，基于Milkdown Crepe
 * 
 * @example
 * ```tsx
 * import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';
 * 
 * function MyComponent() {
 *   const editorRef = useRef<MarkdownEditorHandle>(null);
 *   const [content, setContent] = useState('');
 * 
 *   return (
 *     <MarkdownEditor
 *       theme="dark"
 *       value={content}
 *       onChange={setContent}
 *       enableAITools={true}
 *       ref={editorRef}
 *     />
 *   );
 * }
 * ```
 */

// 导出默认组件
export { default } from './MarkdownEditor';

// 导出类型定义
export type {
  MarkdownEditorProps,
  MarkdownEditorHandle,
  EditorTheme,
  EditorFeatures,
  MarkdownEditorConfig,
  MarkdownEditorContextType,
} from './MarkdownEditor.types';

// 导出默认配置
export {
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_EDITOR_CONTENT,
  DEFAULT_AI_TOOLS_CONFIG,
  DEFAULT_PLACEHOLDER,
  DEFAULT_CONTAINER_STYLE,
} from './MarkdownEditor.defaults';

// 导出工具函数
export {
  applyThemeStyles,
  clearThemeStyles,
  createEditorInstance,
  destroyEditorInstance,
  getMilkdownElement,
  mergeConfig,
  validateConfig,
  generateContainerClassName,
  safeParseContent,
} from './MarkdownEditor.utils';

// 导出上下文和Hook
export {
  MarkdownEditorContext,
  useMarkdownEditorContext,
} from './MarkdownEditor';

// === AI工具相关导出 ===
// 导出AI工具组件
export { default as MarkdownAITools } from './MarkdownAITools';

// 导出AI工具类型定义
export type {
  AIToolType,
  TranslationLanguage,
  AIToolConfig,
  AIToolResult,
  UseAIToolsOptions,
  AIToolState,
  SelectionInfo,
  ModalState,
} from './MarkdownAITools.types';

// 导出AI工具常量
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_POLISH_PROMPT,
  DEFAULT_EXPAND_PROMPT,
  DEFAULT_PROMPTS,
} from './MarkdownAITools.types';

// 导出AI工具函数
export {
  generateSystemPrompt,
  getSelectedText,
  getSelectionInfo,
  replaceText,
  replaceTextByContent,
  HistoryManager,
  createErrorMessage,
  validateSelectedText,
  cleanThoughtChain,
} from './MarkdownAITools.utils';
