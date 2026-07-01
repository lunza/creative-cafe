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

/**
 * 标准化世界书内容 - 确保符合 SillyTavern 规范的完整版本。
 *
 * 这是合并后的唯一实现（Task 15 SubTask 15.1）。原 WorldBookManager.tsx 中的本地副本
 * 和 worldBookService.ts 中的私有方法应统一引用本版本。注意：worldBookService.ts 保留
 * 其自身实现（不可修改），但前端统一使用本工具函数。
 */
export function standardizeWorldBookContent(content: any): any {
  if (!content) return content;

  const standardized = { ...content };

  // 1. 添加缺失的根级字段
  if (standardized.is_creation === undefined) standardized.is_creation = false;
  if (standardized.scan_depth === undefined) standardized.scan_depth = 50;
  if (standardized.token_budget === undefined) standardized.token_budget = 1082;
  if (standardized.recursive_scanning === undefined) standardized.recursive_scanning = true;
  if (!standardized.extensions) {
    standardized.extensions = {
      chub: {
        id: 0,
        full_path: '',
        expressions: null,
        alt_expressions: {},
        related_lorebooks: []
      }
    };
  }

  // 2. 修复 entries
  if (standardized.entries) {
    const entries = standardized.entries;
    const fixedEntries: any = {};
    let newIndex = 1;

    // 按原始索引排序
    const sortedKeys = Object.keys(entries).sort((a, b) => parseInt(a) - parseInt(b));

    for (const oldKey of sortedKeys) {
      const entry = entries[oldKey];

      // 标准化每个条目
      const fixedEntry = {
        ...entry,
        // 修正索引
        uid: newIndex,
        id: newIndex,
        // 确保必需字段存在
        priority: entry.priority !== undefined ? entry.priority : (entry.order || 100),
        insertion_order: entry.insertion_order !== undefined ? entry.insertion_order : (entry.order || 100),
        enabled: entry.enabled !== undefined ? entry.enabled : true,
        name: entry.name || entry.comment || `Entry ${newIndex}`,
        // 修正数据类型
        // position 字段：SillyTavern 使用数字类型 (0=before_char, 1=after_char, 2=before_example, 3=at_depth)
        position: typeof entry.position === 'number' ? entry.position : 1,
        delayUntilRecursion: entry.delayUntilRecursion ?? 0,
        // 确保 extensions 字段存在
        extensions: entry.extensions || {
          depth: entry.depth || 4,
          weight: 10,
          addMemo: entry.addMemo !== undefined ? entry.addMemo : true,
          displayIndex: entry.displayIndex || 0,
          useProbability: entry.useProbability !== undefined ? entry.useProbability : true,
          characterFilter: null,
          excludeRecursion: entry.excludeRecursion || false
        },
        // 确保数组字段存在
        keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
        secondary_keys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [],
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        triggers: Array.isArray(entry.triggers) ? entry.triggers : [],
        // 确保 characterFilter 存在
        characterFilter: entry.characterFilter || {
          isExclude: false,
          names: [],
          tags: []
        },
        // 确保其他必需字段
        caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : null,
        matchWholeWords: entry.matchWholeWords !== undefined ? entry.matchWholeWords : null,
        useGroupScoring: entry.useGroupScoring !== undefined ? entry.useGroupScoring : null,
        scanDepth: entry.scanDepth !== undefined ? entry.scanDepth : null,
        groupOverride: entry.groupOverride !== undefined ? entry.groupOverride : false,
        groupWeight: entry.groupWeight !== undefined ? entry.groupWeight : 100,
        outletName: entry.outletName || '',
        matchPersonaDescription: entry.matchPersonaDescription !== undefined ? entry.matchPersonaDescription : false,
        matchCharacterDescription: entry.matchCharacterDescription !== undefined ? entry.matchCharacterDescription : false,
        matchCharacterPersonality: entry.matchCharacterPersonality !== undefined ? entry.matchCharacterPersonality : false,
        matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt !== undefined ? entry.matchCharacterDepthPrompt : false,
        matchScenario: entry.matchScenario !== undefined ? entry.matchScenario : false,
        matchCreatorNotes: entry.matchCreatorNotes !== undefined ? entry.matchCreatorNotes : false,
        ignoreBudget: entry.ignoreBudget !== undefined ? entry.ignoreBudget : false,
        preventRecursion: entry.preventRecursion !== undefined ? entry.preventRecursion : false,
        vectorized: entry.vectorized !== undefined ? entry.vectorized : false,
        selectiveLogic: entry.selectiveLogic !== undefined ? entry.selectiveLogic : 0,
        automationId: entry.automationId || '',
        displayIndex: entry.displayIndex !== undefined ? entry.displayIndex : 0,
        useProbability: entry.useProbability !== undefined ? entry.useProbability : true,
        addMemo: entry.addMemo !== undefined ? entry.addMemo : true,
        excludeRecursion: entry.excludeRecursion !== undefined ? entry.excludeRecursion : false,
        depth: entry.depth !== undefined ? entry.depth : 4,
        probability: entry.probability !== undefined ? entry.probability : 100,
        group: entry.group || '',
        disable: entry.disable !== undefined ? entry.disable : false,
        constant: entry.constant !== undefined ? entry.constant : false,
        selective: entry.selective !== undefined ? entry.selective : true,
        order: entry.order !== undefined ? entry.order : 100,
        // 兼容字段（来自旧 simple 版本）
        key: Array.isArray(entry.key) ? entry.key : (entry.key ? [String(entry.key)] : []),
        useRegex: entry.useRegex !== undefined ? entry.useRegex : (entry.use_regex || false)
      };

      fixedEntries[newIndex.toString()] = fixedEntry;
      newIndex++;
    }

    standardized.entries = fixedEntries;
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
    delayUntilRecursion: entry.delayUntilRecursion ?? 0
  };
}

/**
 * 创建世界书的默认条目 - 完整版（40+ 字段），符合 SillyTavern 规范。
 *
 * 这是合并后的唯一实现（Task 15 SubTask 15.2）。原 WorldBookManager.tsx 中的本地副本
 * 已删除，统一引用本工具函数。返回的条目包含完整的 SillyTavern 兼容字段集，是旧 simple
 * 版本的超集，因此对所有调用方（WorldBookTemplateSelector / WorldBookGenerateModal /
 * WorldBookCreateModal / WorldBookAddEntryModal 等）向后兼容。
 */
export function createDefaultEntry(uid: number | string, key: string[] = [], comment: string = '', content: string = ''): any {
  return {
    uid: uid,
    id: uid,
    name: comment || `Entry ${uid}`,
    // SillyTavern标准字段：key是主要关键词数组
    key: key,
    keysecondary: [],
    // SillyTavern不使用keys字段，但保留以防兼容性问题
    keys: key,
    secondary_keys: [],
    comment: comment,
    content: content,
    constant: false,
    selective: true,
    selectiveLogic: 0,
    order: 100,
    // position 字段：SillyTavern 使用数字类型 (0=before_char, 1=after_char, 2=before_example, 3=at_depth)
    position: 1,
    disable: false,
    displayIndex: uid,
    addMemo: true,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    probability: 100,
    depth: 4,
    useProbability: true,
    role: null,
    vectorized: false,
    excludeRecursion: false,
    preventRecursion: false,
    // SillyTavern标准：delayUntilRecursion是数字类型
    delayUntilRecursion: 0,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    tags: [],
    ignoreBudget: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    outletName: '',
    triggers: [],
    characterFilter: {
      isExclude: false,
      names: [],
      tags: []
    },
    // SillyTavern使用snake_case字段名
    use_regex: false,
    case_sensitive: false,
    priority: 100,
    insertion_order: 100,
    enabled: true,
    // 扩展字段结构
    extensions: {
      depth: 4,
      weight: 10,
      addMemo: true,
      displayIndex: uid,
      useProbability: true,
      characterFilter: null,
      excludeRecursion: false
    },
    // 兼容字段（来自旧 simple 版本）
    useRegex: false
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
