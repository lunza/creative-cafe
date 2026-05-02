import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dataPersistence, getDataPersistence } from './DataPersistence';

// Mock window.electronAPI
const mockStorage = new Map<string, any>();
const mockGet = vi.fn(async (key: string) => ({ data: mockStorage.get(key) }));
const mockSet = vi.fn(async ({ key, value }: { key: string; value: any }) => {
  mockStorage.set(key, value);
  return { success: true };
});
const mockDelete = vi.fn(async (key: string) => {
  mockStorage.delete(key);
  return { success: true };
});
const mockHas = vi.fn(async (key: string) => ({ exists: mockStorage.has(key) }));
const mockClear = vi.fn(async () => {
  mockStorage.clear();
  return { success: true };
});
const mockGetAll = vi.fn(async () => {
  const data: Record<string, any> = {};
  mockStorage.forEach((value, key) => {
    data[key] = value;
  });
  return { data };
});
const mockExport = vi.fn(async () => JSON.stringify(Object.fromEntries(mockStorage)));
const mockImport = vi.fn(async (dataString: string) => {
  const data = JSON.parse(dataString);
  Object.keys(data).forEach(key => {
    mockStorage.set(key, data[key]);
  });
  return { success: true };
});
const mockMigrate = vi.fn(async () => ({ success: true }));

const mockElectronAPI = {
  storage: {
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    has: mockHas,
    clear: mockClear,
    getAll: mockGetAll,
    export: mockExport,
    import: mockImport,
    migrate: mockMigrate,
  }
};

// @ts-ignore
window.electronAPI = mockElectronAPI;

describe('DataPersistence 组件测试', () => {
  beforeEach(() => {
    // 清空 mock 和存储
    mockStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('1. 通用方法测试', () => {
    it('1.1 应该能够存储和获取字符串数据', async () => {
      const key = 'testString';
      const value = 'Hello World';

      await dataPersistence.set(key, value);
      const result = await dataPersistence.get(key);

      expect(result).toBe(value);
      expect(mockSet).toHaveBeenCalledWith({ key, value });
      expect(mockGet).toHaveBeenCalledWith(key);
    });

    it('1.2 应该能够存储和获取对象数据', async () => {
      const key = 'testObject';
      const value = { name: 'Test', version: 1.0 };

      await dataPersistence.set(key, value);
      const result = await dataPersistence.get(key);

      expect(result).toEqual(value);
    });

    it('1.3 应该能够存储和获取数字数据', async () => {
      const key = 'testNumber';
      const value = 42;

      await dataPersistence.set(key, value);
      const result = await dataPersistence.get(key);

      expect(result).toBe(value);
    });

    it('1.4 应该能够存储和获取布尔数据', async () => {
      const key = 'testBoolean';
      const value = true;

      await dataPersistence.set(key, value);
      const result = await dataPersistence.get(key);

      expect(result).toBe(value);
    });

    it('1.5 应该能够存储和获取数组数据', async () => {
      const key = 'testArray';
      const value = [1, 2, 3, 'test'];

      await dataPersistence.set(key, value);
      const result = await dataPersistence.get(key);

      expect(result).toEqual(value);
    });

    it('1.6 当获取不存在的键时，应该返回 undefined', async () => {
      const key = 'nonexistentKey';

      const result = await dataPersistence.get(key);

      expect(result).toBeUndefined();
    });

    it('1.7 应该能够更新数据', async () => {
      const key = 'updateTest';
      const initialValue = { count: 1 };
      const newValue = { count: 2 };

      await dataPersistence.set(key, initialValue);
      await dataPersistence.update(key, (value) => newValue);
      const result = await dataPersistence.get(key);

      expect(result).toEqual(newValue);
    });

    it('1.8 应该能够检查键是否存在', async () => {
      const key = 'existsTest';
      const value = 'test';

      expect(await dataPersistence.has(key)).toBe(false);
      
      await dataPersistence.set(key, value);
      expect(await dataPersistence.has(key)).toBe(true);
    });

    it('1.9 应该能够删除数据', async () => {
      const key = 'deleteTest';
      const value = 'to be deleted';

      await dataPersistence.set(key, value);
      expect(await dataPersistence.has(key)).toBe(true);

      await dataPersistence.delete(key);
      expect(await dataPersistence.has(key)).toBe(false);
    });

    it('1.10 应该能够清空所有数据', async () => {
      await dataPersistence.set('key1', 'value1');
      await dataPersistence.set('key2', 'value2');

      const before = await dataPersistence.getAll();
      expect(Object.keys(before).length).toBeGreaterThan(0);

      await dataPersistence.clear();
      const after = await dataPersistence.getAll();
      expect(Object.keys(after).length).toBe(0);
    });

    it('1.11 应该能够获取所有数据', async () => {
      await dataPersistence.set('key1', 'value1');
      await dataPersistence.set('key2', { test: true });

      const allData = await dataPersistence.getAll();

      expect(allData).toHaveProperty('key1', 'value1');
      expect(allData).toHaveProperty('key2');
      expect(allData.key2).toEqual({ test: true });
    });

    it('1.12 应该能够导出和导入数据', async () => {
      const originalData = { setting1: 'value1', setting2: 123 };
      await dataPersistence.set('settings', originalData);

      const exportedData = await dataPersistence.export();
      expect(typeof exportedData).toBe('string');

      await dataPersistence.clear();
      await dataPersistence.import(exportedData);
      const importedSettings = await dataPersistence.get('settings');

      expect(importedSettings).toEqual(originalData);
    });
  });

  describe('2. 分类方法测试', () => {
    it('2.1 应该能够存储和获取设置', async () => {
      const settings = { theme: 'dark', language: 'zh-CN' };

      await dataPersistence.setSettings(settings);
      const result = await dataPersistence.getSettings();

      expect(result).toEqual(settings);
    });

    it('2.2 应该能够存储和获取世界书', async () => {
      const worldbookId = 'worldbook_001';
      const worldbookData = { name: '测试世界', description: '这是一个测试世界书' };

      await dataPersistence.setWorldBook(worldbookId, worldbookData);
      const result = await dataPersistence.getWorldBook(worldbookId);

      expect(result).toEqual(worldbookData);
    });

    it('2.3 应该能够存储和获取角色卡', async () => {
      const characterId = 'character_001';
      const characterData = { name: '测试角色', personality: '友好' };

      await dataPersistence.setCharacter(characterId, characterData);
      const result = await dataPersistence.getCharacter(characterId);

      expect(result).toEqual(characterData);
    });

    it('2.4 应该能够存储和获取创意内容', async () => {
      const creativeId = 'creative_001';
      const creativeData = { title: '测试创意', content: '这是一个创意内容' };

      await dataPersistence.setCreative(creativeId, creativeData);
      const result = await dataPersistence.getCreative(creativeId);

      expect(result).toEqual(creativeData);
    });

    it('2.5 应该能够存储和获取聊天记录', async () => {
      const chatId = 'chat_001';
      const chatData = { messages: [], lastUpdated: new Date().toISOString() };

      await dataPersistence.setChat(chatId, chatData);
      const result = await dataPersistence.getChat(chatId);

      expect(result).toEqual(chatData);
    });

    it('2.6 应该能够存储和获取模板', async () => {
      const templateId = 'template_001';
      const templateData = { name: '测试模板', content: '这是一个模板' };

      await dataPersistence.setTemplate(templateId, templateData);
      const result = await dataPersistence.getTemplate(templateId);

      expect(result).toEqual(templateData);
    });
  });

  describe('3. 批量操作测试', () => {
    beforeEach(async () => {
      await dataPersistence.setWorldBook('wb1', { name: 'WB1' });
      await dataPersistence.setWorldBook('wb2', { name: 'WB2' });
      await dataPersistence.setCharacter('char1', { name: 'Char1' });
      await dataPersistence.setCharacter('char2', { name: 'Char2' });
    });

    it('3.1 应该能够获取所有世界书', async () => {
      const worldbooks = await dataPersistence.getWorldBooks();

      expect(worldbooks).toHaveProperty('wb1');
      expect(worldbooks).toHaveProperty('wb2');
    });

    it('3.2 应该能够获取所有角色卡', async () => {
      const characters = await dataPersistence.getCharacters();

      expect(characters).toHaveProperty('char1');
      expect(characters).toHaveProperty('char2');
    });

    it('3.3 应该能够获取所有创意内容', async () => {
      await dataPersistence.setCreative('cr1', { title: 'Creative1' });
      await dataPersistence.setCreative('cr2', { title: 'Creative2' });

      const creatives = await dataPersistence.getCreatives();

      expect(creatives).toHaveProperty('cr1');
      expect(creatives).toHaveProperty('cr2');
    });

    it('3.4 应该能够获取所有聊天记录', async () => {
      await dataPersistence.setChat('chat1', { messages: [] });
      await dataPersistence.setChat('chat2', { messages: [] });

      const chats = await dataPersistence.getChats();

      expect(chats).toHaveProperty('chat1');
      expect(chats).toHaveProperty('chat2');
    });

    it('3.5 应该能够获取所有模板', async () => {
      await dataPersistence.setTemplate('temp1', { name: 'Template1' });
      await dataPersistence.setTemplate('temp2', { name: 'Template2' });

      const templates = await dataPersistence.getTemplates();

      expect(templates).toHaveProperty('temp1');
      expect(templates).toHaveProperty('temp2');
    });
  });

  describe('4. 版本控制测试', () => {
    it('4.1 应该能够获取默认版本', async () => {
      const version = await dataPersistence.getVersion();
      expect(version).toBe('1.0.0');
    });

    it('4.2 应该能够设置和获取版本', async () => {
      const newVersion = '2.0.0';

      await dataPersistence.setVersion(newVersion);
      const version = await dataPersistence.getVersion();

      expect(version).toBe(newVersion);
    });
  });

  describe('5. 数据持久性和一致性测试', () => {
    it('5.1 多个实例应该共享相同的存储', async () => {
      const instance1 = dataPersistence;
      const instance2 = getDataPersistence();

      const key = 'sharedKey';
      const value = 'sharedValue';

      await instance1.set(key, value);
      const fromInstance2 = await instance2.get(key);

      expect(fromInstance2).toBe(value);
    });

    it('5.2 写入后立即读取应该返回正确值', async () => {
      const key = 'immediateRead';
      const value = { immediate: true };

      await dataPersistence.set(key, value);
      const result = await dataPersistence.get(key);

      expect(result).toEqual(value);
    });

    it('5.3 多次写入应该保留最后一次的值', async () => {
      const key = 'multipleWrites';

      await dataPersistence.set(key, 'value1');
      await dataPersistence.set(key, 'value2');
      await dataPersistence.set(key, 'finalValue');

      const result = await dataPersistence.get(key);
      expect(result).toBe('finalValue');
    });

    it('5.4 复杂对象应该正确序列化和反序列化', async () => {
      const key = 'complexObject';
      const complexData = {
        nested: { a: 1, b: ['x', 'y', 'z'] },
        array: [{ id: 1 }, { id: 2 }],
        date: new Date('2024-01-01').toISOString(),
        nullValue: null,
      };

      await dataPersistence.set(key, complexData);
      const result = await dataPersistence.get(key);

      expect(result).toEqual(complexData);
    });

    it('5.5 大量数据操作应该保持一致性', async () => {
      // 写入100条数据
      for (let i = 0; i < 100; i++) {
        await dataPersistence.set(`key_${i}`, { value: i });
      }

      // 验证所有数据
      for (let i = 0; i < 100; i++) {
        const data = await dataPersistence.get(`key_${i}`);
        expect(data).toEqual({ value: i });
      }
    });
  });

  describe('6. 边界条件和错误处理测试', () => {
    it('6.1 应该能够处理空字符串', async () => {
      await dataPersistence.set('emptyString', '');
      const result = await dataPersistence.get('emptyString');
      expect(result).toBe('');
    });

    it('6.2 应该能够处理 null 值', async () => {
      await dataPersistence.set('nullValue', null);
      const result = await dataPersistence.get('nullValue');
      expect(result).toBeNull();
    });

    it('6.3 应该能够处理 undefined 值', async () => {
      await dataPersistence.set('undefinedValue', undefined);
      const result = await dataPersistence.get('undefinedValue');
      expect(result).toBeUndefined();
    });

    it('6.4 更新不存在的键应该仍然可以工作', async () => {
      const key = 'nonExistentUpdate';

      await dataPersistence.update(key, (value) => {
        expect(value).toBeUndefined();
        return 'newValue';
      });

      const result = await dataPersistence.get(key);
      expect(result).toBe('newValue');
    });

    it('6.5 长键名应该可以正常工作', async () => {
      const longKey = 'a'.repeat(200);
      const value = 'long key test';

      await dataPersistence.set(longKey, value);
      const result = await dataPersistence.get(longKey);

      expect(result).toBe(value);
    });

    it('6.6 包含特殊字符的键应该可以正常工作', async () => {
      const specialKey = 'key_with_!@#$%^&*()_+chars';
      const value = 'special key test';

      await dataPersistence.set(specialKey, value);
      const result = await dataPersistence.get(specialKey);

      expect(result).toBe(value);
    });

    it('6.7 大数据量应该可以正常处理', async () => {
      const largeData: Record<string, any> = {};
      for (let i = 0; i < 1000; i++) {
        largeData[`field_${i}`] = `value_${i}`;
      }

      await dataPersistence.set('largeData', largeData);
      const result = await dataPersistence.get('largeData');

      expect(result).toEqual(largeData);
    });
  });
});
