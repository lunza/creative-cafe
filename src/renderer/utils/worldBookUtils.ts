// 世界书工具函数

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\(/g, '_')
    .replace(/\)/g, '_')
    .replace(/\s+/g, '_')
    .replace(/\.+/g, '_')
    .replace(/-+/g, '_')
    .replace(/__+/g, '_')
    .trim()
    .substring(0, 100);
}

export function standardizeWorldBookContent(content: any): any {
  if (!content || typeof content !== 'object') {
    return content;
  }
  
  const standardized = { ...content };
  
  if (standardized.entries && typeof standardized.entries === 'object') {
    const entriesArray = Object.entries(standardized.entries);
    const newEntries: any = {};
    
    entriesArray.forEach(([key, entry]: [string, any], index) => {
      if (!entry) return;
      
      const standardizedEntry = {
        ...entry,
        uid: entry.uid !== undefined ? entry.uid : index,
        key: Array.isArray(entry.key) ? entry.key : (entry.key ? [String(entry.key)] : []),
        keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : (entry.keysecondary ? [String(entry.keysecondary)] : []),
        order: entry.order !== undefined ? entry.order : index,
        probability: entry.probability !== undefined ? entry.probability : 100,
        depth: entry.depth !== undefined ? entry.depth : 0,
        position: entry.position || 'after_char',
        group: entry.group || '',
        disable: entry.disable || false,
        constant: entry.constant || false,
        selective: entry.selective || false,
        useRegex: entry.useRegex !== undefined ? entry.useRegex : (entry.use_regex || false),
        vectorized: entry.vectorized || false,
        caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : (entry.case_sensitive || false),
        automationId: entry.automationId || '',
        scanDepth: entry.scanDepth || 0,
        displayIndex: entry.displayIndex || 0,
        matchWholeWords: entry.matchWholeWords || false,
        useGroupScoring: entry.useGroupScoring || false,
        excludeRecursion: entry.excludeRecursion || false,
        preventRecursion: entry.preventRecursion || false,
        delayUntilRecursion: entry.delayUntilRecursion || false
      };
      
      newEntries[index] = standardizedEntry;
    });
    
    standardized.entries = newEntries;
  }
  
  return standardized;
}

export function formatWorldBookToDocument(content: any, worldBookName: string): string {
  let document = `# 世界书：${worldBookName}\n\n`;
  
  const entriesObj = content?.entries;
  if (entriesObj && typeof entriesObj === 'object') {
    const entryKeys = Object.keys(entriesObj).sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const key of entryKeys) {
      const entry = entriesObj[key];
      if (!entry) continue;
      
      const entryName = entry.comment || entry.name || `条目 ${key}`;
      document += `## ${entryName}\n\n`;
      
      if (entry.key && Array.isArray(entry.key) && entry.key.length > 0) {
        document += `关键词：${entry.key.join(', ')}\n\n`;
      }
      
      if (entry.keysecondary && Array.isArray(entry.keysecondary) && entry.keysecondary.length > 0) {
        document += `次要关键词：${entry.keysecondary.join(', ')}\n\n`;
      }
      
      const entryContent = entry.content || '';
      if (entryContent) {
        document += `${entryContent}\n\n`;
      } else {
        document += `（无内容）\n\n`;
      }
      
      document += `---\n\n`;
    }
  }
  
  return document;
}

export function formatEntryForEdit(entry: any): any {
  return {
    comment: entry.comment || '',
    key: Array.isArray(entry.key) ? entry.key : (entry.key ? [String(entry.key)] : []),
    keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : (entry.keysecondary ? [String(entry.keysecondary)] : []),
    content: entry.content || '',
    order: entry.order !== undefined ? entry.order : 0,
    probability: entry.probability !== undefined ? entry.probability : 100,
    depth: entry.depth !== undefined ? entry.depth : 0,
    position: entry.position || 'after_char',
    group: entry.group || '',
    disable: entry.disable || false,
    constant: entry.constant || false,
    selective: entry.selective || false,
    useRegex: entry.useRegex !== undefined ? entry.useRegex : (entry.use_regex || false),
    vectorized: entry.vectorized || false,
    caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : (entry.case_sensitive || false),
    automationId: entry.automationId || '',
    scanDepth: entry.scanDepth || 0,
    displayIndex: entry.displayIndex || 0,
    matchWholeWords: entry.matchWholeWords || false,
    useGroupScoring: entry.useGroupScoring || false,
    excludeRecursion: entry.excludeRecursion || false,
    preventRecursion: entry.preventRecursion || false,
    delayUntilRecursion: entry.delayUntilRecursion || false
  };
}

export function createDefaultEntry(uid: number | string, key: string[] = [], comment: string = '', content: string = ''): any {
  return {
    uid,
    key,
    comment,
    content,
    keysecondary: [],
    order: 0,
    probability: 100,
    depth: 0,
    position: 'after_char',
    group: '',
    disable: false,
    constant: false,
    selective: false,
    useRegex: false,
    vectorized: false,
    caseSensitive: false,
    automationId: '',
    scanDepth: 0,
    displayIndex: 0,
    matchWholeWords: false,
    useGroupScoring: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false
  };
}

export function cleanAIThoughts(text: string): string {
  const thoughtPatterns = [
    /思考[:：]\s*[^]*?(?=\n\n|$)/gi,
    /Thought[:\s]+[^]*?(?=\n\n|$)/gi,
    /Thinking[:\s]+[^]*?(?=\n\n|$)/gi,
    /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
    /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
    /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
    /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
    /思考:\s*[^]*?(?=\n\n|$)/gi
  ];

  let cleanedText = text;
  for (const pattern of thoughtPatterns) {
    cleanedText = cleanedText.replace(pattern, '').trim();
  }

  // 移除可能的"译文:"、"Translation:"等前缀
  cleanedText = cleanedText.replace(/^(译文:|翻译:|Translation:)\s*/i, '').trim();

  return cleanedText;
}

export function parseAIJsonResponse(response: string): any {
  let cleanedResponse = response.trim();
  
  if (cleanedResponse.startsWith('```json')) {
    cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  } else if (cleanedResponse.startsWith('```')) {
    cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }
  
  try {
    return JSON.parse(cleanedResponse);
  } catch (error) {
    console.error('JSON解析失败:', error);
    return null;
  }
}

export function sortEntriesByTitle(entries: any): any {
  const entriesArray = Object.entries(entries).map(([key, entry]: [string, any]) => ({
    key,
    entry
  }));
  
  entriesArray.sort((a, b) => {
    const commentA = a.entry.comment || '';
    const commentB = b.entry.comment || '';
    return commentA.localeCompare(commentB);
  });
  
  const newEntries: any = {};
  entriesArray.forEach((item, index) => {
    newEntries[index] = {
      ...item.entry,
      uid: index
    };
  });
  
  return newEntries;
}

export function sortEntriesByOrder(entries: any): any {
  const entriesArray = Object.entries(entries).map(([key, entry]: [string, any]) => ({
    key,
    entry
  }));
  
  entriesArray.sort((a, b) => (a.entry.order || 0) - (b.entry.order || 0));
  
  const newEntries: any = {};
  entriesArray.forEach((item, index) => {
    newEntries[index] = {
      ...item.entry,
      uid: index,
      order: index
    };
  });
  
  return newEntries;
}

export function moveEntry(entries: any, index: number, direction: number): any {
  const entriesArray = Object.entries(entries).map(([key, entry]: [string, any]) => ({
    key,
    entry
  }));
  
  entriesArray.sort((a, b) => (a.entry.order || 0) - (b.entry.order || 0));
  
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= entriesArray.length) {
    return entries;
  }
  
  [entriesArray[index], entriesArray[newIndex]] = [entriesArray[newIndex], entriesArray[index]];
  
  const newEntries: any = {};
  entriesArray.forEach((item, idx) => {
    newEntries[item.key] = {
      ...item.entry,
      order: idx
    };
  });
  
  return newEntries;
}
