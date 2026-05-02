import { Crepe } from '@milkdown/crepe';
import { EditorTheme } from './MarkdownEditor.types';
import { milkdownThemeStyles } from '../../../styles/milkdownTheme';

/**
 * 将主题样式应用到DOM元素
 * @param element - 目标DOM元素
 * @param theme - 主题类型
 */
export function applyThemeStyles(element: HTMLElement, theme: EditorTheme): void {
  const styles = milkdownThemeStyles[theme];
  if (!styles) return;

  Object.entries(styles).forEach(([key, value]) => {
    element.style.setProperty(key, value as string);
  });
}

/**
 * 清理元素的主题样式
 * @param element - 目标DOM元素
 */
export function clearThemeStyles(element: HTMLElement): void {
  const allStyles = {
    ...milkdownThemeStyles.light,
    ...milkdownThemeStyles.dark,
  };

  Object.keys(allStyles).forEach((key) => {
    element.style.removeProperty(key);
  });
}

/**
 * 创建Crepe编辑器实例
 * @param element - 挂载的DOM元素
 * @param config - 编辑器配置
 * @returns Promise<Crepe> 编辑器实例
 */
export async function createEditorInstance(
  element: HTMLElement,
  config: {
    defaultValue?: string;
    placeholder?: string;
    features?: {
      blockEdit?: boolean;
      placeholder?: { text: string };
      [key: string]: unknown;
    };
  }
): Promise<Crepe> {
  // 当内容为空时，使用空段落确保光标可见
  // Milkdown/ProseMirror 需要至少一个段落来放置光标
  const defaultContent = config.defaultValue && config.defaultValue.trim() 
    ? config.defaultValue 
    : '';
  
  // 构建Crepe配置
  const crepeConfig: any = {
    root: element,
    defaultValue: defaultContent,
    features: {
      'block-edit': config.features?.blockEdit !== false,
      ...(config.features?.placeholder ? { placeholder: config.features.placeholder } : {}),
    },
  };

  // 创建编辑器
  const crepe = new Crepe(crepeConfig);
  await crepe.create();

  // 如果内容为空，确保编辑器可聚焦并显示光标
  // 通过确保编辑器区域有最小高度和正确的CSS
  if (!defaultContent) {
    const editorElement = element.querySelector('.milkdown') as HTMLElement | null;
    if (editorElement) {
      // 确保编辑器有最小高度以便光标可见
      editorElement.style.minHeight = '150px';
    }
    
    // 自动聚焦到空编辑器，确保光标可见
    // 使用更长的延迟确保 DOM 完全渲染
    setTimeout(() => {
      const focusable = element.querySelector('[contenteditable="true"]') as HTMLElement;
      if (focusable) {
        // 确保 contenteditable 属性正确设置
        focusable.setAttribute('contenteditable', 'true');
        focusable.focus();
      }
    }, 200);
  }

  return crepe;
}

/**
 * 安全地销毁编辑器实例
 * @param instance - 编辑器实例
 */
export function destroyEditorInstance(instance: Crepe | null): void {
  if (!instance) return;

  try {
    instance.destroy();
  } catch (error) {
    console.warn('销毁编辑器时出错:', error);
  }
}

/**
 * 获取编辑器的milkdown元素
 * @param rootElement - 根元素
 * @returns HTMLElement | null
 */
export function getMilkdownElement(rootElement: HTMLElement | null): HTMLElement | null {
  if (!rootElement) return null;
  return rootElement.querySelector('.milkdown') as HTMLElement | null;
}

/**
 * 合并配置对象
 * @param base - 基础配置
 * @param override - 覆盖配置
 * @returns 合并后的配置
 */
export function mergeConfig<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  return {
    ...base,
    ...override,
  };
}

/**
 * 验证编辑器配置
 * @param config - 待验证的配置
 * @returns 验证结果
 */
export function validateConfig(config: { defaultValue?: string }): {
  valid: boolean;
  error?: string;
} {
  if (config.defaultValue && typeof config.defaultValue !== 'string') {
    return { valid: false, error: 'defaultValue 必须是字符串类型' };
  }
  return { valid: true };
}

/**
 * 生成编辑器的容器类名
 * @param theme - 主题
 * @param className - 自定义类名
 * @returns 完整的类名
 */
export function generateContainerClassName(
  theme: EditorTheme,
  className?: string
): string {
  const classNames = ['milkdown-container'];

  classNames.push(theme === 'dark' ? 'dark-theme' : 'light-theme');

  if (className) {
    classNames.push(className);
  }

  return classNames.join(' ');
}

/**
 * 安全地解析Markdown内容
 * @param content - 输入内容
 * @returns 安全的内容
 */
export function safeParseContent(content: unknown): string {
  if (content === null || content === undefined) {
    return '';
  }
  return String(content);
}
