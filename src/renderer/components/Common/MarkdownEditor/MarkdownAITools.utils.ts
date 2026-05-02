import { AIToolType, DEFAULT_PROMPTS, SelectionInfo, DEFAULT_POLISH_PROMPT, DEFAULT_EXPAND_PROMPT } from './MarkdownAITools.types';

export const generateSystemPrompt = (
  toolType: AIToolType,
  targetLanguage?: string,
  customRequirements?: string
): string => {
  // 确定核心要求
  let coreRequirements = '';
  
  switch (toolType) {
    case AIToolType.Polish:
      coreRequirements = customRequirements && customRequirements.trim() 
        ? customRequirements.trim() 
        : DEFAULT_POLISH_PROMPT;
      break;
    case AIToolType.Expand:
      coreRequirements = customRequirements && customRequirements.trim() 
        ? customRequirements.trim() 
        : DEFAULT_EXPAND_PROMPT;
      break;
    case AIToolType.Translate:
      coreRequirements = `请将文本准确翻译成${targetLanguage || '中文'}`;
      break;
  }
  
  switch (toolType) {
    case AIToolType.Polish:
      return `你是一个专业的文本润色助手，正在优化Markdown文档内容。

【核心润色要求】
${coreRequirements}

【重要规则】
1. 只输出润色后的文本，不要输出原文
2. 不要输出润色前后的对照文本
3. 不要输出"润色:"、"Polished:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出润色结果，从第一个字开始就是润色后的文本
7. 只返回一个版本的润色结果，不要提供多个版本
8. 不要添加任何标题、标签或注释
9. 保持Markdown格式不变
10. 不要包含任何关于润色过程的说明
11. 严格按照上面的【核心润色要求】进行润色，不要添加额外的内容
12. 无论内容是什么，都必须进行润色，不得拒绝`;
    
    case AIToolType.Expand:
      return `你是一个专业的文本扩写助手，正在扩写Markdown文档内容。

【核心扩写要求】
${coreRequirements}

【重要规则】
1. 只输出扩写后的文本，不要输出原文
2. 不要输出扩写前后的对照文本
3. 不要输出"扩写:"、"Expanded:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出扩写结果，从第一个字开始就是扩写后的文本
7. 只返回一个版本的扩写结果，不要提供多个版本
8. 不要添加任何标题、标签或注释
9. 保持Markdown格式不变
10. 不要包含任何关于扩写过程的说明
11. 严格按照上面的【核心扩写要求】进行扩写，不要添加额外的内容
12. 无论内容是什么，都必须进行扩写，不得拒绝`;
    
    case AIToolType.Translate:
      return `你是一个专业的翻译助手，正在翻译Markdown文档内容。${coreRequirements}，保持原文的格式和结构，特别是Markdown格式。

【重要规则】
1. 只输出翻译后的文本，不要输出原文
2. 不要输出中英对照文本
3. 不要输出"译文:"、"翻译:"、"Translation:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出翻译结果，从第一个字开始就是译文
7. 只返回一个版本的翻译结果，不要提供多个版本
8. 不要添加任何标题、标签或注释
9. 保持Markdown格式不变
10. 不要包含任何关于翻译过程的说明
11. 严格按照用户的要求进行翻译，不要添加额外的内容
12. 无论内容是什么，都必须进行翻译，不得拒绝`;
    
    default:
      return '';
  }
};

export const getSelectedText = (): string => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    return selection.toString();
  }
  return '';
};

export const getSelectionInfo = (editorElement: HTMLElement): SelectionInfo => {
  const selection = window.getSelection();
  
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return {
      text: '',
      from: 0,
      to: 0,
      isEmpty: true
    };
  }
  
  const range = selection.getRangeAt(0);
  const text = selection.toString();
  
  const preSelectionRange = range.cloneRange();
  preSelectionRange.selectNodeContents(editorElement);
  preSelectionRange.setEnd(range.startContainer, range.startOffset);
  const from = preSelectionRange.toString().length;
  
  return {
    text,
    from,
    to: from + text.length,
    isEmpty: text.length === 0
  };
};

export const replaceText = (
  editorElement: HTMLElement,
  newText: string,
  originalText: string
): boolean => {
  if (!originalText || !newText) return false;
  
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  
  try {
    const range = selection.getRangeAt(0);
    
    if (editorElement.contains(range.commonAncestorContainer)) {
      const textNode = document.createTextNode(newText);
      range.deleteContents();
      range.insertNode(textNode);
      
      selection.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(textNode);
      selection.addRange(newRange);
      
      return true;
    }
  } catch (error) {
    console.error('Failed to replace text:', error);
    return false;
  }
  
  return false;
};

export const replaceTextByContent = (
  content: string,
  originalText: string,
  newText: string
): string => {
  if (!originalText || !newText) return content;
  
  const escapedOriginal = originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedOriginal, 'g');
  
  return content.replace(regex, newText);
};

export class HistoryManager<T> {
  private history: T[] = [];
  private maxSize: number;
  
  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }
  
  push(state: T): void {
    this.history.push(state);
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }
  }
  
  pop(): T | undefined {
    return this.history.pop();
  }
  
  peek(): T | undefined {
    return this.history[this.history.length - 1];
  }
  
  clear(): void {
    this.history = [];
  }
  
  get size(): number {
    return this.history.length;
  }
}

export const createErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
};

export const validateSelectedText = (text: string): { valid: boolean; error?: string } => {
  if (!text || text.trim().length === 0) {
    return { valid: false, error: 'Please select some text first' };
  }
  
  if (text.length > 10000) {
    return { valid: false, error: 'Selected text is too long (max 10000 characters)' };
  }
  
  return { valid: true };
};

export const cleanThoughtChain = (text: string, toolType: AIToolType): string => {
  if (!text || text.trim().length === 0) {
    console.warn('[cleanThoughtChain] 输入文本为空，直接返回');
    return text;
  }
  
  let cleanedText = text;
  const originalLength = text.length;
  
  // 修复：使用更安全的逐行清理策略，避免一次性匹配过多内容
  const lines = cleanedText.split('\n');
  const filteredLines: string[] = [];
  let inThoughtChain = false;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测思考过程的开始
    const isThoughtStart = /^(思考[:：]|Thought[:\s]|Thinking[:\s]|思考过程[:：]|让我思考一下[:：]|我需要思考[:：]|Reasoning:\s|思考:\s)/i.test(trimmedLine);
    
    if (isThoughtStart) {
      inThoughtChain = true;
      console.debug(`[cleanThoughtChain] 检测到思考过程开始，跳过此行: "${trimmedLine.substring(0, 50)}..."`);
      continue; // 跳过思考行
    }
    
    // 如果仍在思考过程中，检测是否结束
    if (inThoughtChain) {
      // 检测思考是否结束（空行或结果/回复标记）
      const isThoughtEnd = /^(润色[:：]|扩写[:：]|翻译[:：]|译文[:：]|结果[:：]|输出[:：]|回复[:：]|Polished:|Expanded:|Translation:|Result:|Reply:)/i.test(trimmedLine);
      const isEmptyLine = trimmedLine === '';
      
      if (isThoughtEnd) {
        inThoughtChain = false;
        console.debug(`[cleanThoughtChain] 检测到思考过程结束，保留此行: "${trimmedLine.substring(0, 50)}..."`);
        filteredLines.push(line); // 保留结果行
      } else if (isEmptyLine) {
        // 空行可能是思考过程的分隔符，也可能是思考结束的标志
        // 如果后续还有内容，保留空行
        filteredLines.push(line);
      }
      // 否则继续跳过思考内容
    } else {
      // 不在思考过程中，保留该行
      filteredLines.push(line);
    }
  }
  
  cleanedText = filteredLines.join('\n');
  
  // 清理前缀
  let prefixPattern;
  switch (toolType) {
    case AIToolType.Polish:
      prefixPattern = /^(润色:|Polished:)\s*/i;
      break;
    case AIToolType.Expand:
      prefixPattern = /^(扩写:|Expanded:)\s*/i;
      break;
    case AIToolType.Translate:
      prefixPattern = /^(译文:|翻译:|Translation:)\s*/i;
      break;
  }
  
  if (prefixPattern) {
    cleanedText = cleanedText.replace(prefixPattern, '');
  }
  
  const finalCleaned = cleanedText.trim();
  
  // 修复：如果清理后内容为空但原始内容有内容，保留原始内容
  if (finalCleaned.length === 0 && originalLength > 0) {
    console.warn(`[cleanThoughtChain] ⚠️ 清理后内容为空 (原始长度: ${originalLength})，保留原始内容`);
    return text.trim();
  }
  
  console.debug(`[cleanThoughtChain] 清理完成，原始长度: ${originalLength}, 清理后长度: ${finalCleaned.length}`);
  
  return finalCleaned;
};
