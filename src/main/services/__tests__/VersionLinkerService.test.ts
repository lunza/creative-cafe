/**
 * VersionLinkerService 单元测试
 *
 * 验证目标（Task 5.1）：
 * 1. generateVersionLinkId 生成有效 ID
 * 2. createLinkedVersion 创建成功（mock fs 操作）
 * 3. enforceVersionLimit 在版本数超过 10 时删除最旧版本
 * 4. getLinkedVersion 读取已创建的版本
 *
 * 测试策略：
 * - 使用 vi.hoisted 创建 mock 文件系统（Map<string, string> 存储文件内容）
 * - vi.mock fs/promises 使所有文件操作走 mock（含 default 导出，
 *   因为 VersionLinkerService 使用 `import fs from 'fs/promises'` 默认导入）
 * - vi.mock appPath 返回固定路径，避免 Electron 依赖
 * - 每次测试前重置 mock 状态
 *
 * ⚠️ 说明（SubTask 5.3-5.5）：
 * 以下场景需要运行完整的 Electron 应用和 AI 引擎，无法在单元测试环境中执行，
 * 需按手动测试步骤验证（见文件末尾注释）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============ Mock fs/promises（ESM 模块必须用 vi.mock）============
const mockFs = vi.hoisted(() => {
  const store = new Map<string, string>();

  const makeError = (path: string): Error & { code: string } => {
    const err = new Error(`ENOENT: no such file or directory, access '${path}'`) as Error & { code: string };
    err.code = 'ENOENT';
    return err;
  };

  return {
    access: vi.fn(async (path: string) => {
      if (!store.has(path)) throw makeError(path);
    }),
    readFile: vi.fn(async (path: string) => {
      const content = store.get(path);
      if (content === undefined) throw makeError(path);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
    }),
    mkdir: vi.fn(async () => {}),
    unlink: vi.fn(async (path: string) => {
      store.delete(path);
    }),
    readdir: vi.fn(async () => []),
    // 测试辅助：重置文件系统
    __reset: () => store.clear(),
    // 测试辅助：获取已存储的文件内容
    __getFile: (path: string): string | undefined => store.get(path),
    // 测试辅助：检查文件是否存在
    __hasFile: (path: string): boolean => store.has(path),
  };
});

vi.mock('fs/promises', () => ({
  ...mockFs,
  default: mockFs,
}));

// ============ Mock appPath ============
vi.mock('../../utils/appPath', () => ({
  getUserDataPath: vi.fn(() => '/fake/userdata'),
}));

// ============ Mock 完成，导入被测试模块 ============
import { versionLinkerService } from '../VersionLinkerService';
import path from 'path';

const CHARACTER_NAME = 'TestCharacter';
const CHARACTER_DIR = path.join('/fake/userdata', 'data', 'memories', 'chats', 'TestCharacter');

describe('VersionLinkerService', () => {
  beforeEach(() => {
    mockFs.__reset();
    vi.clearAllMocks();
  });

  // ========== 1. generateVersionLinkId ==========
  describe('generateVersionLinkId', () => {
    it('should generate a valid version link ID with correct format', () => {
      const id = versionLinkerService.generateVersionLinkId();

      // 格式: vYYYYMMDD_HHmmss_xxxxxx (6位随机)
      expect(id).toMatch(/^v\d{8}_\d{6}_[a-z0-9]{6}$/);
    });

    it('should generate unique IDs on successive calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(versionLinkerService.generateVersionLinkId());
      }
      expect(ids.size).toBe(100);
    });
  });

  // ========== 2. createLinkedVersion ==========
  describe('createLinkedVersion', () => {
    it('should create a linked version with messages and table data', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const tableData = {
        Sheet1: [{ name: 'Alice', age: 30 }],
      };
      const metadata = { sessionId: 'test-session' };

      const record = await versionLinkerService.createLinkedVersion(CHARACTER_NAME, {
        messages,
        tableData,
        metadata,
        triggerType: 'auto',
        source: 'user',
        description: 'Test linked version',
      });

      // 验证返回的 VersionLinkRecord
      expect(record.versionLinkId).toMatch(/^v\d{8}_\d{6}_[a-z0-9]{6}$/);
      expect(record.triggerType).toBe('auto');
      expect(record.chatVersion.exists).toBe(true);
      expect(record.chatVersion.messageCount).toBe(1);
      expect(record.tableSnapshot.exists).toBe(true);
      expect(record.tableSnapshot.sheetCount).toBe(1);
      expect(record.tableSnapshot.totalRows).toBe(1);

      // 验证聊天版本文件已写入
      const chatFilePath = record.chatVersion.filePath;
      const chatContent = mockFs.__getFile(chatFilePath);
      expect(chatContent).toBeDefined();
      const chatData = JSON.parse(chatContent!);
      expect(chatData.messages).toHaveLength(1);
      expect(chatData.messages[0].content).toBe('Hello');

      // 验证表格快照文件已写入
      const tableFilePath = record.tableSnapshot.filePath;
      expect(mockFs.__hasFile(tableFilePath)).toBe(true);
      const tableContent = mockFs.__getFile(tableFilePath);
      const tableDataParsed = JSON.parse(tableContent!);
      expect(tableDataParsed.sheets).toEqual(['Sheet1']);
      expect(tableDataParsed.data.Sheet1).toHaveLength(1);
      expect(tableDataParsed.data.Sheet1[0].name).toBe('Alice');

      // 验证版本索引已写入
      const indexPath = path.join(CHARACTER_DIR, 'version-index.json');
      const indexContent = mockFs.__getFile(indexPath);
      expect(indexContent).toBeDefined();
      const index = JSON.parse(indexContent!);
      expect(index.characterCardName).toBe(CHARACTER_NAME);
      expect(index.versions).toHaveLength(1);
      expect(index.versions[0].versionLinkId).toBe(record.versionLinkId);
    });

    it('should reuse existingChatVersionFilePath when provided', async () => {
      // 预置一个聊天版本文件
      const versionLinkId = 'pre_existing';
      const existingChatFilePath = path.join(CHARACTER_DIR, 'versions', 'chat', `${versionLinkId}.json`);
      const existingChatData = {
        versionLinkId,
        version: { timestamp: 1000 },
        messages: [{ role: 'user', content: 'Existing message' }],
      };
      await mockFs.writeFile(existingChatFilePath, JSON.stringify(existingChatData));

      const record = await versionLinkerService.createLinkedVersion(CHARACTER_NAME, {
        existingChatVersionFilePath: existingChatFilePath,
        tableData: { Sheet1: [{ name: 'Bob' }] },
        triggerType: 'manual',
      });

      // 版本ID应复用预置文件的文件名（不含扩展名）
      expect(record.versionLinkId).toBe('pre_existing');
      // 聊天版本文件路径应指向预置文件
      expect(record.chatVersion.filePath).toBe(existingChatFilePath);
      expect(record.chatVersion.messageCount).toBe(1);

      // 表格快照文件以 versionLinkId 命名
      const tableFilePath = path.join(CHARACTER_DIR, 'versions', 'table', `${versionLinkId}.json`);
      expect(record.tableSnapshot.filePath).toBe(tableFilePath);
      expect(mockFs.__hasFile(tableFilePath)).toBe(true);
    });

    it('should create a linked version without messages or table data (empty)', async () => {
      const record = await versionLinkerService.createLinkedVersion(CHARACTER_NAME, {
        triggerType: 'manual',
      });

      expect(record.versionLinkId).toMatch(/^v\d{8}_\d{6}_[a-z0-9]{6}$/);
      expect(record.chatVersion.messageCount).toBe(0);
      expect(record.tableSnapshot.sheetCount).toBe(0);
      expect(record.tableSnapshot.totalRows).toBe(0);
    });
  });

  // ========== 3. enforceVersionLimit ==========
  describe('enforceVersionLimit', () => {
    it('should remove oldest versions when exceeding MAX_LINKED_VERSIONS (10)', async () => {
      // 创建 11 个版本（超过上限 10）
      const records: Array<{ versionLinkId: string; chatPath: string; tablePath: string }> = [];

      for (let i = 1; i <= 11; i++) {
        const record = await versionLinkerService.createLinkedVersion(CHARACTER_NAME, {
          messages: [{ role: 'user', content: `Message ${i}` }],
          tableData: { Sheet1: [{ index: i }] },
          triggerType: 'auto',
          source: 'user',
          description: `Version ${i}`,
        });
        records.push({
          versionLinkId: record.versionLinkId,
          chatPath: record.chatVersion.filePath,
          tablePath: record.tableSnapshot.filePath,
        });
      }

      // 验证版本索引中只有 10 个版本
      const indexPath = path.join(CHARACTER_DIR, 'version-index.json');
      const indexContent = mockFs.__getFile(indexPath);
      expect(indexContent).toBeDefined();
      const index = JSON.parse(indexContent!);
      expect(index.versions.length).toBe(10);

      // 验证最旧的版本文件已被删除
      const oldestRecord = records[0];
      expect(mockFs.__hasFile(oldestRecord.chatPath)).toBe(false);
      expect(mockFs.__hasFile(oldestRecord.tablePath)).toBe(false);

      // 验证最新的版本文件仍然存在
      const newestRecord = records[records.length - 1];
      expect(mockFs.__hasFile(newestRecord.chatPath)).toBe(true);
      expect(mockFs.__hasFile(newestRecord.tablePath)).toBe(true);
    });

    it('should not remove any versions when count equals the limit', async () => {
      // 创建 10 个版本（刚好等于上限）
      const recordPaths: string[] = [];

      for (let i = 1; i <= 10; i++) {
        const record = await versionLinkerService.createLinkedVersion(CHARACTER_NAME, {
          messages: [{ role: 'user', content: `Message ${i}` }],
          tableData: { Sheet1: [{ index: i }] },
          triggerType: 'auto',
        });
        recordPaths.push(record.chatVersion.filePath);
      }

      // 验证所有文件都存在
      for (const filePath of recordPaths) {
        expect(mockFs.__hasFile(filePath)).toBe(true);
      }

      // 验证版本索引中有 10 个版本
      const indexPath = path.join(CHARACTER_DIR, 'version-index.json');
      const indexContent = mockFs.__getFile(indexPath);
      const index = JSON.parse(indexContent!);
      expect(index.versions.length).toBe(10);
    });
  });

  // ========== 4. getLinkedVersion ==========
  describe('getLinkedVersion', () => {
    it('should return chat version, table snapshot and link record for an existing version', async () => {
      const messages = [{ role: 'user', content: 'Test message' }];
      const tableData = { Sheet1: [{ name: 'Charlie', age: 25 }] };

      const created = await versionLinkerService.createLinkedVersion(CHARACTER_NAME, {
        messages,
        tableData,
        triggerType: 'manual',
      });

      const result = await versionLinkerService.getLinkedVersion(CHARACTER_NAME, created.versionLinkId);

      // 验证聊天版本
      expect(result.chatVersion).not.toBeNull();
      expect(result.chatVersion.messages).toHaveLength(1);
      expect(result.chatVersion.messages[0].content).toBe('Test message');

      // 验证表格快照
      expect(result.tableSnapshot).not.toBeNull();
      expect(result.tableSnapshot.sheets).toEqual(['Sheet1']);
      expect(result.tableSnapshot.data.Sheet1[0].name).toBe('Charlie');

      // 验证链接记录
      expect(result.linkRecord).not.toBeNull();
      expect(result.linkRecord!.versionLinkId).toBe(created.versionLinkId);
      expect(result.linkRecord!.triggerType).toBe('manual');
    });

    it('should return null values for a non-existent version', async () => {
      const result = await versionLinkerService.getLinkedVersion(CHARACTER_NAME, 'non_existent_id');

      expect(result.chatVersion).toBeNull();
      expect(result.tableSnapshot).toBeNull();
      expect(result.linkRecord).toBeNull();
    });

    it('should return partial data when only chat version exists', async () => {
      // 手动创建聊天版本文件，但不创建表格快照
      const versionLinkId = 'partial_test_001';
      const chatFilePath = path.join(CHARACTER_DIR, 'versions', 'chat', `${versionLinkId}.json`);
      await mockFs.writeFile(chatFilePath, JSON.stringify({
        versionLinkId,
        timestamp: Date.now(),
        messages: [{ role: 'user', content: 'Partial test' }],
      }));

      // 手动写入版本索引
      const indexPath = path.join(CHARACTER_DIR, 'version-index.json');
      const index = {
        characterCardName: CHARACTER_NAME,
        lastUpdated: Date.now(),
        versions: [{
          versionLinkId,
          timestamp: Date.now(),
          triggerType: 'manual' as const,
          chatVersion: { exists: true, filePath: chatFilePath, messageCount: 1 },
          tableSnapshot: { exists: false, filePath: '', sheetCount: 0, totalRows: 0 },
          consistencyStatus: 'mismatched' as const,
        }],
      };
      await mockFs.writeFile(indexPath, JSON.stringify(index));

      const result = await versionLinkerService.getLinkedVersion(CHARACTER_NAME, versionLinkId);

      expect(result.chatVersion).not.toBeNull();
      expect(result.chatVersion.messages[0].content).toBe('Partial test');
      expect(result.tableSnapshot).toBeNull();
      expect(result.linkRecord).not.toBeNull();
      expect(result.linkRecord!.tableSnapshot.exists).toBe(false);
    });
  });
});

// ============================================================================
// 手动测试步骤（SubTask 5.4）：从此版本重新生成（版本回退 + AI 重新生成）
// 说明：此流程依赖完整的 Electron 应用与 AI 引擎，无法在单元测试环境中执行。
// ============================================================================
// 手动测试步骤 SubTask 5.4:
// 1. 启动应用，进入角色对话页面
// 2. 发送几条消息，确保表格数据存在
// 3. 在助手消息的版本历史中选择一个旧版本，点击"从此版本重新生成"
// 4. 验证：表格数据已回退到该版本对应的快照状态
// 5. 验证：AI 基于新消息和回退后的表格数据生成回复

// ============================================================================
// 手动测试步骤（SubTask 5.5）：版本上限控制（enforceVersionLimit）
// 说明：此流程依赖完整的 Electron 应用，无法在单元测试环境中执行。
// ============================================================================
// 手动测试步骤 SubTask 5.5:
// 1. 启动应用，发送 12 条以上消息（每次保存都会创建联动版本）
// 2. 检查版本索引文件（version-index.json），版本数不超过 10
// 3. 验证最旧的版本文件已被删除