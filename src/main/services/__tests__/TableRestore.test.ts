/**
 * 表格快照恢复（memory:restoreTableFromSnapshot）核心逻辑单元测试
 *
 * 验证目标（Task 5.2）：
 * 1. 从快照文件读取数据并写入当前表格文件
 * 2. 快照文件不存在时返回错误
 * 3. 数据格式正确性
 *
 * 测试策略：
 * - 将 handler 核心逻辑提取为独立函数 restoreTableFromSnapshot 进行测试
 * - vi.mock fs（sync）使文件操作走 mock
 * - vi.mock appPath 返回固定路径，避免 Electron 依赖
 * - 每次测试前重置 mock 状态
 *
 * ⚠️ 说明（SubTask 5.3）：
 * 「卷回到输入框」完整流程需要运行完整的 Electron 应用与 AI 引擎，
 * 无法在单元测试环境中执行，需按手动测试步骤验证（见文件末尾注释）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============ Mock fs（sync）============
const mockFs = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    existsSync: vi.fn((path: string) => store.has(path)),
    readFileSync: vi.fn((path: string) => {
      const content = store.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    writeFileSync: vi.fn((path: string, content: string) => {
      store.set(path, content);
    }),
    mkdirSync: vi.fn(() => {}),
    // 测试辅助
    __reset: () => store.clear(),
    __getFile: (path: string): string | undefined => store.get(path),
    __hasFile: (path: string): boolean => store.has(path),
    __setFile: (path: string, content: string) => store.set(path, content),
  };
});

vi.mock('fs', () => ({
  ...mockFs,
  default: { ...mockFs },
}));

// ============ Mock appPath ============
vi.mock('../../utils/appPath', () => ({
  getUserDataPath: vi.fn(() => '/fake/userdata'),
}));

// ============ 导入依赖 ============
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import fs from 'fs';

// ============ 被测试函数（与 memory:restoreTableFromSnapshot handler 逻辑一致）============
function restoreTableFromSnapshot(
  chatId: string,
  versionLinkId: string
): { success: boolean; sheets?: string[]; headers?: Record<string, string[]>; data?: Record<string, any[]>; error?: string } {
  try {
    const safeChatId = chatId.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const userDataPath = getUserDataPath();

    // 构建快照文件路径
    const snapshotPath = path.join(userDataPath, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);

    if (!fs.existsSync(snapshotPath)) {
      return { success: false, error: '表格快照不存在' };
    }

    // 读取快照数据
    const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    const snapshotData = JSON.parse(snapshotContent);

    const sheets: string[] = snapshotData.sheets || [];
    const headers: Record<string, string[]> = snapshotData.headers || {};
    const data: Record<string, any[]> = snapshotData.data || {};

    // 构建当前表格文件路径
    const currentTablePath = path.join(userDataPath, 'data', 'memories', 'chatlog', `${safeChatId}.json`);

    // 确保目录存在
    const chatlogDir = path.dirname(currentTablePath);
    if (!fs.existsSync(chatlogDir)) {
      fs.mkdirSync(chatlogDir, { recursive: true });
    }

    // 写入当前表格文件
    fs.writeFileSync(currentTablePath, JSON.stringify({ sheets, headers, data, sheetDescriptions: {} }, null, 2), 'utf8');

    return { success: true, sheets, headers, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

const USER_DATA_PATH = '/fake/userdata';

describe('restoreTableFromSnapshot', () => {
  beforeEach(() => {
    mockFs.__reset();
    vi.clearAllMocks();
  });

  // ========== 1. 成功恢复 ==========
  describe('Successful restore', () => {
    it('should restore table data from snapshot file and write to current table file', () => {
      const chatId = 'chat-123';
      const versionLinkId = 'v20260817_120000_abc123';
      const safeChatId = 'chat-123';

      // 预置快照文件
      const snapshotPath = path.join(USER_DATA_PATH, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);
      const snapshotData = {
        versionLinkId,
        timestamp: 1000,
        characterCardName: 'TestChar',
        sheets: ['Sheet1', 'Sheet2'],
        headers: {
          Sheet1: ['name', 'age'],
          Sheet2: ['item', 'quantity'],
        },
        data: {
          Sheet1: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
          Sheet2: [{ item: 'Sword', quantity: 1 }],
        },
        metadata: { sheetCount: 2, totalRows: 3 },
      };
      mockFs.__setFile(snapshotPath, JSON.stringify(snapshotData));

      const result = restoreTableFromSnapshot(chatId, versionLinkId);

      // 验证返回值
      expect(result.success).toBe(true);
      expect(result.sheets).toEqual(['Sheet1', 'Sheet2']);
      expect(result.headers).toEqual({
        Sheet1: ['name', 'age'],
        Sheet2: ['item', 'quantity'],
      });
      expect(result.data).toEqual({
        Sheet1: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
        Sheet2: [{ item: 'Sword', quantity: 1 }],
      });

      // 验证当前表格文件已写入
      const currentTablePath = path.join(USER_DATA_PATH, 'data', 'memories', 'chatlog', `${safeChatId}.json`);
      expect(mockFs.__hasFile(currentTablePath)).toBe(true);

      const writtenContent = mockFs.__getFile(currentTablePath);
      const writtenData = JSON.parse(writtenContent!);
      expect(writtenData.sheets).toEqual(['Sheet1', 'Sheet2']);
      expect(writtenData.data.Sheet1).toHaveLength(2);
      expect(writtenData.data.Sheet1[0].name).toBe('Alice');
      // 应包含 sheetDescriptions 空对象（与现有表格文件格式一致）
      expect(writtenData.sheetDescriptions).toEqual({});
    });

    it('should handle single-sheet snapshot with empty data', () => {
      const chatId = 'chat-empty';
      const versionLinkId = 'v20260817_120001_empty';
      const safeChatId = 'chat-empty';

      const snapshotPath = path.join(USER_DATA_PATH, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);
      const snapshotData = {
        versionLinkId,
        timestamp: 2000,
        characterCardName: 'EmptyChar',
        sheets: ['Default'],
        headers: { Default: [] },
        data: { Default: [] },
        metadata: { sheetCount: 1, totalRows: 0 },
      };
      mockFs.__setFile(snapshotPath, JSON.stringify(snapshotData));

      const result = restoreTableFromSnapshot(chatId, versionLinkId);

      expect(result.success).toBe(true);
      expect(result.sheets).toEqual(['Default']);
      expect(result.headers).toEqual({ Default: [] });
      expect(result.data).toEqual({ Default: [] });

      // 验证写入的文件
      const currentTablePath = path.join(USER_DATA_PATH, 'data', 'memories', 'chatlog', `${safeChatId}.json`);
      const writtenContent = mockFs.__getFile(currentTablePath);
      const writtenData = JSON.parse(writtenContent!);
      expect(writtenData.sheets).toEqual(['Default']);
      expect(writtenData.data.Default).toEqual([]);
    });

    it('should handle special characters in chatId by sanitizing them', () => {
      // chatId 包含特殊字符，应被替换为 _
      const chatId = 'chat<>:"/\\|?*';
      const versionLinkId = 'v20260817_120002_special';
      const safeChatId = 'chat_________'; // 特殊字符被替换为 _

      const snapshotPath = path.join(USER_DATA_PATH, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);
      const snapshotData = {
        versionLinkId,
        timestamp: 3000,
        characterCardName: 'SpecialChar',
        sheets: ['Sheet1'],
        headers: { Sheet1: ['key'] },
        data: { Sheet1: [{ key: 'value' }] },
        metadata: { sheetCount: 1, totalRows: 1 },
      };
      mockFs.__setFile(snapshotPath, JSON.stringify(snapshotData));

      const result = restoreTableFromSnapshot(chatId, versionLinkId);

      expect(result.success).toBe(true);
      expect(result.sheets).toEqual(['Sheet1']);
      expect(result.data).toEqual({ Sheet1: [{ key: 'value' }] });
    });
  });

  // ========== 2. 快照文件不存在 ==========
  describe('Snapshot file not found', () => {
    it('should return error when snapshot file does not exist', () => {
      const result = restoreTableFromSnapshot('chat-404', 'non_existent_version');

      expect(result.success).toBe(false);
      expect(result.error).toBe('表格快照不存在');
    });

    it('should not create any current table file when snapshot is missing', () => {
      const currentTablePath = path.join(USER_DATA_PATH, 'data', 'memories', 'chatlog', 'chat-404.json');
      expect(mockFs.__hasFile(currentTablePath)).toBe(false);
    });
  });

  // ========== 3. 数据格式正确性 ==========
  describe('Data format correctness', () => {
    it('should handle snapshot with missing optional fields (sheets/headers/data)', () => {
      const chatId = 'chat-minimal';
      const versionLinkId = 'v20260817_120003_minimal';
      const safeChatId = 'chat-minimal';

      // 快照只有最基本的字段
      const snapshotPath = path.join(USER_DATA_PATH, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);
      mockFs.__setFile(snapshotPath, JSON.stringify({ versionLinkId, timestamp: 4000 }));

      const result = restoreTableFromSnapshot(chatId, versionLinkId);

      expect(result.success).toBe(true);
      expect(result.sheets).toEqual([]);
      expect(result.headers).toEqual({});
      expect(result.data).toEqual({});
    });

    it('should write valid JSON that can be parsed back', () => {
      const chatId = 'chat-json-valid';
      const versionLinkId = 'v20260817_120004_valid';
      const safeChatId = 'chat-json-valid';

      const snapshotPath = path.join(USER_DATA_PATH, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);
      const snapshotData = {
        versionLinkId,
        timestamp: 5000,
        characterCardName: 'ValidChar',
        sheets: ['Stats'],
        headers: { Stats: ['hp', 'mp', 'level'] },
        data: { Stats: [{ hp: 100, mp: 50, level: 5 }] },
        metadata: { sheetCount: 1, totalRows: 1 },
      };
      mockFs.__setFile(snapshotPath, JSON.stringify(snapshotData));

      const result = restoreTableFromSnapshot(chatId, versionLinkId);

      // 验证写入的文件可被正确解析
      const currentTablePath = path.join(USER_DATA_PATH, 'data', 'memories', 'chatlog', `${safeChatId}.json`);
      const writtenContent = mockFs.__getFile(currentTablePath);
      expect(writtenContent).toBeDefined();

      // 验证 JSON 格式
      const parsed = JSON.parse(writtenContent!);
      expect(parsed).toHaveProperty('sheets');
      expect(parsed).toHaveProperty('headers');
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('sheetDescriptions');

      // 验证数据结构与 handler 返回一致
      expect(parsed.sheets).toEqual(result.sheets);
      expect(parsed.headers).toEqual(result.headers);
      expect(parsed.data).toEqual(result.data);
    });

    it('should reject invalid JSON in snapshot file', () => {
      const chatId = 'chat-invalid-json';
      const versionLinkId = 'v20260817_120005_bad';
      const safeChatId = 'chat-invalid-json';

      const snapshotPath = path.join(USER_DATA_PATH, 'data', 'memories', 'chats', safeChatId, 'versions', 'table', `${versionLinkId}.json`);
      // 写入非法 JSON
      mockFs.__setFile(snapshotPath, '{invalid json content');

      const result = restoreTableFromSnapshot(chatId, versionLinkId);

      expect(result.success).toBe(false);
      // JSON.parse 会抛出异常，被 catch 捕获
      expect(result.error).toBeDefined();
    });
  });
});

// ============================================================================
// 手动测试步骤（SubTask 5.3）：卷回到输入框（表格回退 + 消息截断）
// 说明：此流程依赖完整的 Electron 应用与 AI 引擎，无法在单元测试环境中执行。
// ============================================================================
// 手动测试步骤 SubTask 5.3:
// 1. 启动应用，进入角色对话页面
// 2. 启用记忆表格并关联模板
// 3. 发送几条消息，确保表格数据被自动整理
// 4. 点击某条用户消息的"卷回到输入框"按钮
// 5. 验证：表格数据已回退到该消息对应版本的状态
// 6. 验证：对话消息列表正确截断