/**
 * 格式化工具类
 */
export const formatUtils = {
  /**
   * 转义大括号，用于在React JSX中显示{{}}形式的占位符
   * @param text 需要转义的文本
   * @returns 转义后的文本
   */
  escapeBraces: (text: string): string => {
    return text
      .replace(/\{\{/g, "{'{{'}")
      .replace(/\}\}/g, "{'}}'");
  },
  
  /**
   * 生成占位符字符串
   * @param name 占位符名称
   * @returns 格式化后的占位符字符串
   */
  placeholder: (name: string): string => {
    return `{'{{'}}${name}{{'}}'}`;
  }
};

export default formatUtils;