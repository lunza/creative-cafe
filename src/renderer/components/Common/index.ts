export * from './AIService';
export * from './AIService.types';
export * from './AIService.utils';
export * from './MarkdownEditor';

// 标签自动推荐输入框（Spec: implement-local-tag-autocomplete / Task 5）
export { default as TagAutocomplete } from './TagAutocomplete';
export type { TagAutocompleteProps } from './TagAutocomplete';

// 保持向后兼容
export { default as MarkdownAITools } from './MarkdownEditor/MarkdownAITools';
export * from './MarkdownEditor/MarkdownAITools.types';
export * from './MarkdownEditor/MarkdownAITools.utils';
