import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildFinalSystemPrompt,
  buildSystemPrompt,
  formatVectorContextItems,
} from '../PromptBuilder';
import type { ContextVectorItem } from '../PromptBuilder';

describe('PromptBuilder - Memory Table Data Integration', () => {
  const mockCharacterInfo = {
    characterCardName: 'Test Character',
    personality: 'friendly',
    characterCardContent: '',
    scenario: '',
    mes_example: '',
    system_prompt: '',
    creator_notes: '',
  };

  const mockVectorContext: ContextVectorItem[] = [
    { source: 'doc1.txt', score: 0.95, content: 'Test context 1' },
  ];

  const mockMemoryTableData = `# 记忆表格数据

## 表格: sheet1

| 角色 | 行为 | 情感 |
| --- | --- | --- |
| Alice | 打招呼 | 友好 |
| Bob | 回应 | 热情 |
`;

  describe('buildFinalSystemPrompt - 正常场景', () => {
    it('应该在 system prompt 末尾追加记忆表格数据', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        mockVectorContext,
        mockMemoryTableData
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('# 记忆表格数据');
      expect(result).toContain('## 表格: sheet1');
      expect(result).toContain('| 角色 | 行为 | 情感 |');
      expect(result).toContain('| Alice | 打招呼 | 友好 |');
      expect(result).toContain('--- 请结合以上记忆表格数据进行回应 ---');
    });

    it('应该在向量上下文之后追加记忆表格数据', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        mockVectorContext,
        mockMemoryTableData
      );

      const vectorIdx = result.indexOf('--- 相关背景知识 ---');
      const tableIdx = result.indexOf('--- 记忆表格数据 ---');

      expect(vectorIdx).toBeGreaterThan(-1);
      expect(tableIdx).toBeGreaterThan(-1);
      expect(tableIdx).toBeGreaterThan(vectorIdx);
    });

    it('应该在向量上下文和记忆表格数据之间保持正确的分隔', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        mockVectorContext,
        mockMemoryTableData
      );

      // 确保两个部分之间有正确的分隔符
      expect(result).toContain('--- 请结合以上背景知识进行回应 ---');
      expect(result).toContain('--- 记忆表格数据 ---');

      const respondIdx = result.indexOf('--- 请结合以上背景知识进行回应 ---');
      const tableIdx = result.indexOf('--- 记忆表格数据 ---');

      expect(tableIdx).toBeGreaterThan(respondIdx);
    });

    it('应该在没有向量上下文时仍能正确追加记忆表格数据', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        mockMemoryTableData
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('# 记忆表格数据');
      expect(result).toContain('--- 请结合以上记忆表格数据进行回应 ---');
      expect(result).not.toContain('--- 相关背景知识 ---');
    });
  });

  describe('buildFinalSystemPrompt - 边界条件', () => {
    it('应该正确处理空字符串 memoryTableData', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        mockVectorContext,
        ''
      );

      expect(result).not.toContain('--- 记忆表格数据 ---');
      expect(result).toContain('--- 相关背景知识 ---');
    });

    it('应该正确处理仅包含空格的 memoryTableData', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        mockVectorContext,
        '   \n  \t  '
      );

      expect(result).not.toContain('--- 记忆表格数据 ---');
    });

    it('应该正确处理 undefined memoryTableData', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        mockVectorContext,
        undefined
      );

      expect(result).not.toContain('--- 记忆表格数据 ---');
    });

    it('应该正确处理非常大的表格数据（超过 50 行）', () => {
      let largeTableData = '# 记忆表格数据\n\n## 表格: large_sheet\n\n| ID | 名称 | 值 |\n| --- | --- | --- |\n';
      for (let i = 1; i <= 100; i++) {
        largeTableData += `| ${i} | Item ${i} | Value ${i} |\n`;
      }

      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        largeTableData
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('| 100 | Item 100 | Value 100 |');
      expect(result).toContain('--- 请结合以上记忆表格数据进行回应 ---');
    });

    it('应该正确处理包含特殊字符的表格数据', () => {
      const specialTableData = `# 记忆表格数据

## 表格: special

| 内容 | 值 |
| --- | --- |
| 包含 "引号" | test |
| 包含 <html> 标签 | <b>bold</b> |
| 包含换行\n符 | line |
`;

      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        specialTableData
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('包含 "引号"');
      expect(result).toContain('--- 请结合以上记忆表格数据进行回应 ---');
    });

    it('应该正确处理多工作表数据', () => {
      const multiSheetData = `# 记忆表格数据

## 表格: 角色信息

| 角色 | 职业 |
| --- | --- |
| Alice | 战士 |

## 表格: 物品清单

| 物品 | 数量 |
| --- | --- |
| 剑 | 1 |
| 盾 | 1 |
`;

      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        multiSheetData
      );

      expect(result).toContain('## 表格: 角色信息');
      expect(result).toContain('## 表格: 物品清单');
      expect(result).toContain('| Alice | 战士 |');
      expect(result).toContain('| 剑 | 1 |');
      expect(result).toContain('| 盾 | 1 |');
    });
  });

  describe('buildFinalSystemPrompt - 异常情况', () => {
    it('应该在 memoryTableData 为 null 时不报错', () => {
      expect(() => {
        buildFinalSystemPrompt(
          'You are an AI assistant.',
          mockVectorContext,
          null as any
        );
      }).not.toThrow();
    });

    it('应该在表格数据格式不完整时仍能处理', () => {
      const incompleteData = '# 记忆表格数据\n\n## 表格: incomplete\n\n';

      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        incompleteData
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('## 表格: incomplete');
    });

    it('应该在表格数据包含空行时正确处理', () => {
      const dataWithEmptyLines = `# 记忆表格数据


## 表格: empty_lines

| A | B |
| --- | --- |

| 1 | 2 |


`;

      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        dataWithEmptyLines
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('## 表格: empty_lines');
    });

    it('应该保证追加后的 prompt 格式正确（开头和结尾无多余空白）', () => {
      const result = buildFinalSystemPrompt(
        'You are an AI assistant.',
        [],
        mockMemoryTableData
      );

      expect(result.startsWith('You are an AI assistant.')).toBe(true);
      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('--- 请结合以上记忆表格数据进行回应 ---');
    });
  });

  describe('buildSystemPrompt - 完整流程集成测试', () => {
    it('应该正确构建包含记忆表格数据的完整 system prompt', () => {
      const result = buildSystemPrompt(
        mockCharacterInfo,
        undefined,
        'dialogue',
        mockVectorContext,
        mockMemoryTableData
      );

      expect(result).toContain('角色扮演对话');
      expect(result).toContain('--- 相关背景知识 ---');
      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('## 表格: sheet1');
    });

    it('应该在 continuation 模式下正确构建提示词', () => {
      const result = buildSystemPrompt(
        mockCharacterInfo,
        undefined,
        'continuation',
        [],
        mockMemoryTableData
      );

      expect(result).toContain('--- 记忆表格数据 ---');
      expect(result).toContain('## 表格: sheet1');
    });
  });

  describe('formatVectorContextItems - 格式化测试', () => {
    it('应该正确格式化向量上下文项目', () => {
      const items: ContextVectorItem[] = [
        { source: 'doc1.txt', score: 0.9, content: 'Content 1' },
        { source: 'doc2.txt', score: 0.8, content: 'Content 2' },
      ];

      const result = formatVectorContextItems(items);

      expect(result).toContain('[相关上下文 1]');
      expect(result).toContain('[相关上下文 2]');
      expect(result).toContain('来源: doc1.txt');
      expect(result).toContain('来源: doc2.txt');
      expect(result).toContain('相关性: 90.0%');
      expect(result).toContain('相关性: 80.0%');
    });

    it('应该在空数组时返回空字符串', () => {
      const result = formatVectorContextItems([]);
      expect(result).toBe('');
    });
  });
});
