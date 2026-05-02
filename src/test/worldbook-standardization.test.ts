import { describe, it, expect } from 'vitest';

// 测试数据结构
interface TestWorldBookEntry {
  uid: number;
  id?: number;
  name?: string;
  key: string[];
  keysecondary?: string[];
  keys?: string[];
  secondary_keys?: string[];
  comment: string;
  content: string;
  constant?: boolean;
  selective?: boolean;
  selectiveLogic?: number;
  order?: number;
  position?: number | string;
  disable?: boolean;
  displayIndex?: number;
  addMemo?: boolean;
  group?: string;
  groupOverride?: boolean;
  groupWeight?: number;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  probability?: number;
  depth?: number;
  useProbability?: boolean;
  role?: any;
  vectorized?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: number | boolean;
  scanDepth?: number | null;
  caseSensitive?: boolean | null;
  matchWholeWords?: boolean | null;
  useGroupScoring?: boolean | null;
  automationId?: string;
  tags?: string[];
  ignoreBudget?: boolean;
  matchPersonaDescription?: boolean;
  matchCharacterDescription?: boolean;
  matchCharacterPersonality?: boolean;
  matchCharacterDepthPrompt?: boolean;
  matchScenario?: boolean;
  matchCreatorNotes?: boolean;
  outletName?: string;
  triggers?: any[];
  characterFilter?: {
    isExclude: boolean;
    names: string[];
    tags: string[];
  };
  use_regex?: boolean;
  case_sensitive?: boolean;
  priority?: number;
  insertion_order?: number;
  enabled?: boolean;
  extensions?: {
    depth: number;
    weight: number;
    addMemo: boolean;
    displayIndex: number;
    useProbability: boolean;
    characterFilter: any;
    excludeRecursion: boolean;
  };
}

interface TestWorldBook {
  name: string;
  description: string;
  is_creation?: boolean;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: {
    chub: {
      id: number;
      full_path: string;
      expressions: any;
      alt_expressions: Record<string, any>;
      related_lorebooks: any[];
    };
  };
  entries: Record<string, TestWorldBookEntry>;
}

// 标准化函数（从 WorldBookManager.tsx 复制用于测试）
const standardizeWorldBookContent = (content: any): any => {
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
        position: typeof entry.position === 'number' ? entry.position : 1,
        delayUntilRecursion: typeof entry.delayUntilRecursion === 'boolean' 
          ? (entry.delayUntilRecursion ? 1 : 0) 
          : (entry.delayUntilRecursion || 0),
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
        order: entry.order !== undefined ? entry.order : 100
      };
      
      fixedEntries[newIndex.toString()] = fixedEntry;
      newIndex++;
    }
    
    standardized.entries = fixedEntries;
  }
  
  return standardized;
};

describe('WorldBook Standardization Tests', () => {
  describe('Root Level Fields', () => {
    it('should add missing is_creation field', () => {
      const input = { name: 'Test', entries: {} };
      const result = standardizeWorldBookContent(input);
      expect(result.is_creation).toBe(false);
    });

    it('should add missing scan_depth field', () => {
      const input = { name: 'Test', entries: {} };
      const result = standardizeWorldBookContent(input);
      expect(result.scan_depth).toBe(50);
    });

    it('should add missing token_budget field', () => {
      const input = { name: 'Test', entries: {} };
      const result = standardizeWorldBookContent(input);
      expect(result.token_budget).toBe(1082);
    });

    it('should add missing recursive_scanning field', () => {
      const input = { name: 'Test', entries: {} };
      const result = standardizeWorldBookContent(input);
      expect(result.recursive_scanning).toBe(true);
    });

    it('should add missing extensions field', () => {
      const input = { name: 'Test', entries: {} };
      const result = standardizeWorldBookContent(input);
      expect(result.extensions).toBeDefined();
      expect(result.extensions.chub).toBeDefined();
      expect(result.extensions.chub.id).toBe(0);
      expect(result.extensions.chub.full_path).toBe('');
    });

    it('should preserve existing root level fields', () => {
      const input = {
        name: 'Test',
        description: 'Test description',
        is_creation: true,
        scan_depth: 100,
        entries: {}
      };
      const result = standardizeWorldBookContent(input);
      expect(result.name).toBe('Test');
      expect(result.description).toBe('Test description');
      expect(result.is_creation).toBe(true);
      expect(result.scan_depth).toBe(100);
    });
  });

  describe('Entry Index Standardization', () => {
    it('should reindex entries from 1 continuously', () => {
      const input = {
        name: 'Test',
        entries: {
          '0': { uid: 1, key: ['test'], comment: 'Test entry', content: 'Content' },
          '3': { uid: 2, key: ['test2'], comment: 'Test entry 2', content: 'Content 2' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(Object.keys(result.entries)).toEqual(['1', '2']);
      expect(result.entries['1'].uid).toBe(1);
      expect(result.entries['2'].uid).toBe(2);
    });

    it('should handle non-sequential indices', () => {
      const input = {
        name: 'Test',
        entries: {
          '5': { uid: 10, key: ['test'], comment: 'Test entry', content: 'Content' },
          '10': { uid: 20, key: ['test2'], comment: 'Test entry 2', content: 'Content 2' },
          '15': { uid: 30, key: ['test3'], comment: 'Test entry 3', content: 'Content 3' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(Object.keys(result.entries)).toEqual(['1', '2', '3']);
      expect(result.entries['1'].uid).toBe(1);
      expect(result.entries['2'].uid).toBe(2);
      expect(result.entries['3'].uid).toBe(3);
    });
  });

  describe('Entry Field Standardization', () => {
    it('should add missing id field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test entry', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].id).toBe(1);
    });

    it('should add missing priority field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test entry', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].priority).toBe(100);
    });

    it('should add missing insertion_order field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test entry', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].insertion_order).toBe(100);
    });

    it('should add missing enabled field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test entry', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].enabled).toBe(true);
    });

    it('should add missing name field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test entry', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].name).toBe('Test entry');
    });

    it('should use comment as name if name is missing', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Custom name', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].name).toBe('Custom name');
    });
  });

  describe('Data Type Standardization', () => {
    it('should convert position from string to number', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content', position: 'after_char' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].position).toBe(1);
      expect(typeof result.entries['1'].position).toBe('number');
    });

    it('should preserve position as number', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content', position: 2 }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].position).toBe(2);
    });

    it('should convert delayUntilRecursion from boolean to number', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content', delayUntilRecursion: true }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].delayUntilRecursion).toBe(1);
      expect(typeof result.entries['1'].delayUntilRecursion).toBe('number');
    });

    it('should convert false delayUntilRecursion to 0', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content', delayUntilRecursion: false }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].delayUntilRecursion).toBe(0);
    });
  });

  describe('Array Field Standardization', () => {
    it('should ensure keysecondary is array', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(Array.isArray(result.entries['1'].keysecondary)).toBe(true);
      expect(result.entries['1'].keysecondary).toEqual([]);
    });

    it('should preserve existing keysecondary array', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], keysecondary: ['tag1', 'tag2'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].keysecondary).toEqual(['tag1', 'tag2']);
    });

    it('should ensure secondary_keys is array', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(Array.isArray(result.entries['1'].secondary_keys)).toBe(true);
    });

    it('should ensure tags is array', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(Array.isArray(result.entries['1'].tags)).toBe(true);
    });

    it('should ensure triggers is array', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(Array.isArray(result.entries['1'].triggers)).toBe(true);
    });
  });

  describe('Extensions Field Standardization', () => {
    it('should add missing extensions field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].extensions).toBeDefined();
      expect(result.entries['1'].extensions.depth).toBe(4);
      expect(result.entries['1'].extensions.weight).toBe(10);
      expect(result.entries['1'].extensions.addMemo).toBe(true);
    });

    it('should preserve existing extensions field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { 
            uid: 1, 
            key: ['test'], 
            comment: 'Test', 
            content: 'Content',
            extensions: {
              depth: 5,
              weight: 20,
              addMemo: false,
              displayIndex: 1,
              useProbability: false,
              characterFilter: null,
              excludeRecursion: true
            }
          }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].extensions.depth).toBe(5);
      expect(result.entries['1'].extensions.weight).toBe(20);
      expect(result.entries['1'].extensions.addMemo).toBe(false);
    });
  });

  describe('CharacterFilter Field Standardization', () => {
    it('should add missing characterFilter field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].characterFilter).toBeDefined();
      expect(result.entries['1'].characterFilter.isExclude).toBe(false);
      expect(result.entries['1'].characterFilter.names).toEqual([]);
      expect(result.entries['1'].characterFilter.tags).toEqual([]);
    });

    it('should preserve existing characterFilter field', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': { 
            uid: 1, 
            key: ['test'], 
            comment: 'Test', 
            content: 'Content',
            characterFilter: {
              isExclude: true,
              names: ['name1'],
              tags: ['tag1']
            }
          }
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1'].characterFilter.isExclude).toBe(true);
      expect(result.entries['1'].characterFilter.names).toEqual(['name1']);
      expect(result.entries['1'].characterFilter.tags).toEqual(['tag1']);
    });
  });

  describe('Complete WorldBook Standardization', () => {
    it('should standardize a complete worldbook with all missing fields', () => {
      const input: TestWorldBook = {
        name: 'Test WorldBook',
        description: 'Test description',
        entries: {
          '0': {
            uid: 1,
            key: ['朱迪', '兔警官'],
            comment: '编号：B101，正义感极强的兔子。',
            content: '朱迪是来自《疯狂动物城》的兔警官。',
            constant: false,
            selective: true,
            order: 100,
            position: 'after_char',
            disable: false,
            delayUntilRecursion: false
          },
          '3': {
            uid: 2,
            key: ['真', 'Zhen'],
            comment: '编号：B104，古灵精怪的街头狐狸。',
            content: '真，来自《功夫熊猫4》的街头小狐狸。',
            constant: false,
            selective: true,
            order: 100,
            position: 'after_char',
            disable: false,
            delayUntilRecursion: false
          }
        }
      };

      const result = standardizeWorldBookContent(input);

      // Verify root level fields
      expect(result.is_creation).toBe(false);
      expect(result.scan_depth).toBe(50);
      expect(result.token_budget).toBe(1082);
      expect(result.recursive_scanning).toBe(true);
      expect(result.extensions).toBeDefined();

      // Verify entry indices
      expect(Object.keys(result.entries)).toEqual(['1', '2']);

      // Verify entry 1
      const entry1 = result.entries['1'];
      expect(entry1.uid).toBe(1);
      expect(entry1.id).toBe(1);
      expect(entry1.name).toBe('编号：B101，正义感极强的兔子。');
      expect(entry1.priority).toBe(100);
      expect(entry1.insertion_order).toBe(100);
      expect(entry1.enabled).toBe(true);
      expect(entry1.position).toBe(1);
      expect(typeof entry1.position).toBe('number');
      expect(entry1.delayUntilRecursion).toBe(0);
      expect(typeof entry1.delayUntilRecursion).toBe('number');
      expect(entry1.extensions).toBeDefined();
      expect(entry1.characterFilter).toBeDefined();
      expect(Array.isArray(entry1.keysecondary)).toBe(true);
      expect(Array.isArray(entry1.secondary_keys)).toBe(true);
      expect(Array.isArray(entry1.tags)).toBe(true);
      expect(Array.isArray(entry1.triggers)).toBe(true);

      // Verify entry 2
      const entry2 = result.entries['2'];
      expect(entry2.uid).toBe(2);
      expect(entry2.id).toBe(2);
      expect(entry2.name).toBe('编号：B104，古灵精怪的街头狐狸。');
      expect(entry2.priority).toBe(100);
      expect(entry2.insertion_order).toBe(100);
      expect(entry2.enabled).toBe(true);
      expect(entry2.position).toBe(1);
      expect(typeof entry2.position).toBe('number');
      expect(entry2.delayUntilRecursion).toBe(0);
      expect(typeof entry2.delayUntilRecursion).toBe('number');
      expect(entry2.extensions).toBeDefined();
      expect(entry2.characterFilter).toBeDefined();
      expect(Array.isArray(entry2.keysecondary)).toBe(true);
      expect(Array.isArray(entry2.secondary_keys)).toBe(true);
      expect(Array.isArray(entry2.tags)).toBe(true);
      expect(Array.isArray(entry2.triggers)).toBe(true);
    });

    it('should preserve existing values while adding missing fields', () => {
      const input: TestWorldBook = {
        name: 'Test WorldBook',
        description: 'Test description',
        is_creation: true,
        scan_depth: 100,
        entries: {
          '1': {
            uid: 1,
            key: ['test'],
            comment: 'Test entry',
            content: 'Test content',
            priority: 50,
            enabled: false,
            position: 2
          }
        }
      };

      const result = standardizeWorldBookContent(input);

      expect(result.is_creation).toBe(true);
      expect(result.scan_depth).toBe(100);
      expect(result.entries['1'].priority).toBe(50);
      expect(result.entries['1'].enabled).toBe(false);
      expect(result.entries['1'].position).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null content', () => {
      const result = standardizeWorldBookContent(null);
      expect(result).toBeNull();
    });

    it('should handle undefined content', () => {
      const result = standardizeWorldBookContent(undefined);
      expect(result).toBeUndefined();
    });

    it('should handle empty entries object', () => {
      const input = { name: 'Test', entries: {} };
      const result = standardizeWorldBookContent(input);
      expect(result.entries).toEqual({});
    });

    it('should handle entries with empty values', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': {}
        }
      };
      const result = standardizeWorldBookContent(input);
      expect(result.entries['1']).toBeDefined();
      expect(result.entries['1'].uid).toBe(1);
      expect(result.entries['1'].id).toBe(1);
      expect(result.entries['1'].key).toBeUndefined(); // Should not add key if not present
    });
  });

  describe('JSON Serialization Compatibility', () => {
    it('should produce valid JSON after standardization', () => {
      const input = {
        name: 'Test',
        entries: {
          '0': { uid: 1, key: ['test'], comment: 'Test', content: 'Content' },
          '3': { uid: 2, key: ['test2'], comment: 'Test 2', content: 'Content 2' }
        }
      };

      const result = standardizeWorldBookContent(input);
      
      // Should not throw
      expect(() => JSON.stringify(result)).not.toThrow();
      
      // Should be parseable
      const jsonStr = JSON.stringify(result);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.name).toBe('Test');
      expect(Object.keys(parsed.entries)).toEqual(['1', '2']);
    });

    it('should handle special characters in content', () => {
      const input = {
        name: 'Test',
        entries: {
          '1': {
            uid: 1,
            key: ['朱迪', '兔警官'],
            comment: '编号：B101，正义感极强的兔子。',
            content: '| 属性 | 内容描述 |\n| :--- | :--- |\n| **姓名** | 朱迪 |\n| **种族/来源** | 《疯狂动物城》 / 兔 |',
            constant: false,
            selective: true
          }
        }
      };

      const result = standardizeWorldBookContent(input);
      
      // Should not throw
      expect(() => JSON.stringify(result)).not.toThrow();
      
      // Content should be preserved
      expect(result.entries['1'].content).toContain('朱迪');
      expect(result.entries['1'].content).toContain('疯狂动物城');
    });
  });
});
