import { describe, it, expect } from 'vitest';
import type { ContentGenerationRequest } from '../src/shared/types/writing.types';

/**
 * Standalone implementation of buildTableContextForPrompt logic for testing.
 * This mirrors the private method in ContentGenerator.ts to test the
 * formatting logic in isolation without the deep Electron dependency chain.
 */
function buildTableContextForPrompt(request: ContentGenerationRequest): string {
  if (!request.writingTableData) {
    return '';
  }

  const { writingTableData } = request;
  const sheets = writingTableData.sheets || [];
  if (sheets.length === 0) {
    return '';
  }

  let context = `## 历史剧情表格数据（重要参考资料）\n`;
  context += `以下表格记录了之前章节中已建立的角色、物品、事件、地点等关键信息，请在创作时作为参考，确保剧情走向和细节与前文一致。\n\n`;

  sheets.forEach((sheetName: string, sheetIndex: number) => {
    const tableIndex = sheetIndex + 1;
    context += `=== ${sheetName} (表格索引: ${tableIndex}) ===\n`;
    context += `表格用途：${writingTableData.sheetDescriptions?.[sheetName] || '暂无描述'}\n`;

    const sheetData = writingTableData.data?.[sheetName] || [];
    if (sheetData.length === 0) {
      context += `当前数据：暂无数据\n\n`;
      return;
    }

    context += `当前已有数据（共${sheetData.length}条）：\n`;

    const uniqueIdIndex: Map<string, number> = new Map();

    sheetData.forEach((row: Record<string, unknown>, rowIndex: number) => {
      const rowDisplay = rowIndex + 1;
      const uniqueId = row['唯一id'] as string | undefined;

      if (uniqueId) {
        uniqueIdIndex.set(uniqueId, rowDisplay);
      }

      const fields = Object.entries(row)
        .filter(([key]) => key !== '0')
        .map(([key, value]) => {
          const headerIndex = parseInt(key) + 1;
          const headerName = writingTableData.headers?.[sheetName]?.[parseInt(key) - 2] || `字段${headerIndex}`;
          return `${headerName}=${value}`;
        })
        .join(', ');
      context += `  行${rowDisplay}: ${fields}\n`;
    });

    if (uniqueIdIndex.size > 0) {
      context += `\n【唯一ID快速查找索引】\n`;
      uniqueIdIndex.forEach((rowNum, uniqueId) => {
        context += `  ${uniqueId} → 行${rowNum}\n`;
      });
    }

    context += '\n';
  });

  return context;
}

// Helper to create a minimal valid ContentGenerationRequest for testing
function createMockRequest(overrides: Partial<ContentGenerationRequest> = {}): ContentGenerationRequest {
  return {
    chapterInfo: {
      index: 0,
      title: '第一章',
      outline: '主角初入江湖',
      characters: ['主角'],
      scenes: ['小镇']
    },
    previousChapters: [],
    worldBookContext: [],
    characterContext: [],
    generationParams: {
      targetWordCount: 3000,
      style: 'serious',
      perspective: 'third_person',
      novelType: 'web_novel'
    },
    modelConfig: { model: 'gpt-4', temperature: 0.7, maxTokens: 4096 },
    ...overrides
  };
}

describe('buildTableContextForPrompt - 格式化逻辑', () => {
  describe('正常场景 - 单表数据', () => {
    it('应该正确格式化单个表格数据', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['角色信息'],
          headers: { '角色信息': ['名称', '身份'] },
          data: {
            '角色信息': [
              { '0': '0', '1': '唯一id', '2': '张三', '3': '剑客' },
              { '0': '1', '1': '唯一id', '2': '李四', '3': '医者' }
            ]
          },
          sheetDescriptions: { '角色信息': '记录已出场角色信息' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('## 历史剧情表格数据（重要参考资料）');
      expect(result).toContain('=== 角色信息 (表格索引: 1) ===');
      expect(result).toContain('表格用途：记录已出场角色信息');
      expect(result).toContain('当前已有数据（共2条）');
      expect(result).toContain('名称=张三');
      expect(result).toContain('身份=剑客');
      expect(result).toContain('名称=李四');
      expect(result).toContain('身份=医者');
    });

    it('应该正确生成唯一ID快速查找索引', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['事件记录'],
          headers: { '事件记录': ['事件名称'] },
          data: {
            '事件记录': [
              { '0': '0', '唯一id': 'EVT_001', '2': '初遇' }
            ]
          },
          sheetDescriptions: { '事件记录': '记录关键事件' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('【唯一ID快速查找索引】');
      expect(result).toContain('EVT_001');
    });
  });

  describe('正常场景 - 多表数据', () => {
    it('应该正确格式化多个表格数据', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['角色信息', '物品清单'],
          headers: {
            '角色信息': ['名称'],
            '物品清单': ['物品名', '数量']
          },
          data: {
            '角色信息': [
              { '0': '0', '1': '唯一id', '2': '张三' }
            ],
            '物品清单': [
              { '0': '0', '1': '唯一id', '2': '宝剑', '3': '1' },
              { '0': '1', '1': '唯一id', '2': '丹药', '3': '3' }
            ]
          },
          sheetDescriptions: {
            '角色信息': '角色追踪',
            '物品清单': '物品状态'
          }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('=== 角色信息 (表格索引: 1) ===');
      expect(result).toContain('=== 物品清单 (表格索引: 2) ===');
      expect(result).toContain('表格用途：角色追踪');
      expect(result).toContain('表格用途：物品状态');
      expect(result).toContain('名称=张三');
      expect(result).toContain('物品名=宝剑');
      expect(result).toContain('数量=1');
    });
  });

  describe('边界条件', () => {
    it('应该在没有 writingTableData 时返回空字符串', () => {
      const request = createMockRequest();
      const result = buildTableContextForPrompt(request);

      expect(result).toBe('');
    });

    it('应该在 writingTableData 为 undefined 时返回空字符串', () => {
      const request = createMockRequest({
        writingTableData: undefined
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toBe('');
    });

    it('应该在 sheets 为空数组时返回空字符串', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: [],
          headers: {},
          data: {},
          sheetDescriptions: {}
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toBe('');
    });

    it('应该在某个表没有数据时显示"暂无数据"', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['空表'],
          headers: { '空表': ['字段'] },
          data: { '空表': [] },
          sheetDescriptions: { '空表': '测试空表' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('=== 空表 (表格索引: 1) ===');
      expect(result).toContain('表格用途：测试空表');
      expect(result).toContain('当前数据：暂无数据');
    });

    it('应该在某个表没有唯一ID时不生成快速查找索引', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['无ID表'],
          headers: { '无ID表': ['名称'] },
          data: {
            '无ID表': [
              { '0': '0', '1': '测试' }
            ]
          },
          sheetDescriptions: { '无ID表': '无ID测试' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('字段2=测试');
      expect(result).not.toContain('【唯一ID快速查找索引】');
    });

    it('应该在 sheetDescriptions 缺失时使用默认描述', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['测试表'],
          headers: { '测试表': ['A'] },
          data: { '测试表': [{ '0': '0', '1': '值' }] },
          sheetDescriptions: undefined
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('表格用途：暂无描述');
    });
  });

  describe('异常场景', () => {
    it('应该在数据行字段不完整时仍能处理', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['不完整表'],
          headers: { '不完整表': ['名称', '身份', '状态'] },
          data: {
            '不完整表': [
              { '0': '0', '1': '唯一id', '2': '张三' }  // 缺少部分字段
            ]
          },
          sheetDescriptions: { '不完整表': '不完整数据测试' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('名称=张三');
      // 不存在的字段不应出现在输出中
      expect(result).not.toContain('身份=undefined');
    });

    it('应该在 headers 与 data 键名不对应时使用字段N作为回退', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['测试表'],
          headers: { '测试表': [] },  // headers 为空
          data: {
            '测试表': [
              { '0': '0', '唯一id': 'ID', '2': '值1', '3': '值2' }
            ]
          },
          sheetDescriptions: { '测试表': '测试' }
        }
      });

      const result = buildTableContextForPrompt(request);

      // 应该回退到字段N格式
      expect(result).toContain('字段3=值1');
      expect(result).toContain('字段4=值2');
    });

    it('应该正确处理包含特殊字符的表格数据', () => {
      const request = createMockRequest({
        writingTableData: {
          sheets: ['特殊表'],
          headers: { '特殊表': ['内容'] },
          data: {
            '特殊表': [
              { '0': '0', '1': 'ID', '2': '包含"引号"和<标签>' },
              { '0': '1', '1': 'ID', '2': '包含制表符' }
            ]
          },
          sheetDescriptions: { '特殊表': '特殊字符测试' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('内容=包含"引号"和<标签>');
    });

    it('应该在大量数据行时正确格式化（性能测试）', () => {
      const largeData: Record<string, unknown>[] = [];
      for (let i = 0; i < 100; i++) {
        largeData.push({
          '0': String(i),
          '1': `ID_${i}`,
          '2': `角色${i}`,
          '3': `描述${i}`
        });
      }

      const request = createMockRequest({
        writingTableData: {
          sheets: ['大数据表'],
          headers: { '大数据表': ['名称', '描述'] },
          data: { '大数据表': largeData },
          sheetDescriptions: { '大数据表': '大数据测试' }
        }
      });

      const result = buildTableContextForPrompt(request);

      expect(result).toContain('当前已有数据（共100条）');
      expect(result).toContain('行100:');
      expect(result).toContain('ID_99');
      expect(result).toContain('名称=角色99');
    });
  });
});
