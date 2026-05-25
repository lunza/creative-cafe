import { describe, it, expect } from 'vitest';
import { promptBuilder } from '../src/main/services/writing/PromptBuilder';

describe('PromptBuilder - tableContext Integration', () => {
  const baseChapterInfo = {
    index: 0,
    title: '第一章 初入江湖',
    outline: '主角踏入江湖，结识第一位同伴',
    characters: ['主角', '同伴'],
    scenes: ['小镇酒馆', '山间小路']
  };

  const baseGenerationParams = {
    targetWordCount: 3000,
    style: 'serious',
    perspective: 'third_person'
  };

  describe('buildContentPrompt - 正常场景', () => {
    it('应该在包含 tableContext 时正确将其插入到提示词中', () => {
      const tableContext = `## 历史剧情表格数据（重要参考资料）\n以下表格记录了之前章节中已建立的角色、物品、事件、地点等关键信息。\n\n=== 角色信息 (表格索引: 1) ===\n表格用途：记录已出场角色\n当前已有数据（共2条）：\n  行1: 名称=张三, 身份=剑客\n  行2: 名称=李四, 身份=医者\n`;

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: '',
          tableContext
        },
        baseGenerationParams
      );

      expect(result).toContain('## 历史剧情表格数据（重要参考资料）');
      expect(result).toContain('=== 角色信息 (表格索引: 1) ===');
      expect(result).toContain('行1: 名称=张三, 身份=剑客');
    });

    it('应该将 tableContext 放在章节概要之前', () => {
      const tableContext = `## 历史剧情表格数据（重要参考资料）\ntable content`;

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '## 所有章节概要\n- 第一章...',
          longTermContext: '',
          continuityConstraints: '',
          tableContext
        },
        baseGenerationParams
      );

      const tableContextIdx = result.indexOf('## 历史剧情表格数据（重要参考资料）');
      const chapterSummariesIdx = result.indexOf('## 所有章节概要');

      expect(tableContextIdx).toBeGreaterThan(-1);
      expect(chapterSummariesIdx).toBeGreaterThan(-1);
      expect(chapterSummariesIdx).toBeGreaterThan(tableContextIdx);
    });

    it('应该在没有 recentChapters 时仍然正确插入 tableContext', () => {
      const tableContext = `## 历史剧情表格数据（重要参考资料）\ntable content`;

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '## 所有章节概要\n概要内容...',
          longTermContext: '',
          continuityConstraints: '',
          tableContext
        },
        baseGenerationParams
      );

      const tableContextIdx = result.indexOf('## 历史剧情表格数据（重要参考资料）');
      const chapterSummariesIdx = result.indexOf('## 所有章节概要');

      expect(tableContextIdx).toBeGreaterThan(-1);
      expect(chapterSummariesIdx).toBeGreaterThan(tableContextIdx);
    });

    it('应该正确处理多工作表数据', () => {
      const multiSheetContext = `## 历史剧情表格数据（重要参考资料）\n\n=== 角色信息 (表格索引: 1) ===\n表格用途：记录角色\n  行1: 名称=张三\n\n=== 物品清单 (表格索引: 2) ===\n表格用途：记录物品\n  行1: 名称=宝剑\n`;

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: '',
          tableContext: multiSheetContext
        },
        baseGenerationParams
      );

      expect(result).toContain('=== 角色信息 (表格索引: 1) ===');
      expect(result).toContain('=== 物品清单 (表格索引: 2) ===');
    });

    it('应该包含唯一ID快速查找索引', () => {
      const tableContextWithId = `## 历史剧情表格数据（重要参考资料）\n\n=== 事件记录 (表格索引: 1) ===\n表格用途：记录事件\n  行1: 事件=大战\n\n【唯一ID快速查找索引】\n  EVT_001 \u2192 行1\n`;

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: '',
          tableContext: tableContextWithId
        },
        baseGenerationParams
      );

      expect(result).toContain('\u3010\u552f\u4e00ID\u5feb\u901f\u67e5\u627e\u7d22\u5f15\u3011');
      expect(result).toContain('EVT_001 \u2192 \u884c1');
    });
  });

  describe('buildContentPrompt - 边界条件', () => {
    it('应该在没有 tableContext 时正常生成提示词（向后兼容）', () => {
      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: ''
        },
        baseGenerationParams
      );

      expect(result).toContain('# 小说内容生成任务');
      expect(result).toContain('## 当前章节');
      expect(result).toContain('## 章节大纲');
      expect(result).not.toContain('历史剧情表格数据');
    });

    it('应该在 tableContext 为空字符串时不包含表格数据部分', () => {
      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: '',
          tableContext: ''
        },
        baseGenerationParams
      );

      expect(result).not.toContain('历史剧情表格数据');
    });

    it('应该在 tableContext 为 undefined 时不报错', () => {
      expect(() => {
        promptBuilder.buildContentPrompt(
          baseChapterInfo,
          {
            resourceContext: '',
            recentChapters: '',
            chapterSummaries: '',
            longTermContext: '',
            continuityConstraints: '',
            tableContext: undefined
          },
          baseGenerationParams
        );
      }).not.toThrow();
    });

    it('应该在 tableContext 非常大时仍能正确处理', () => {
      let largeTableContext = `## 历史剧情表格数据（重要参考资料）\n\n=== 大规模数据 (表格索引: 1) ===\n表格用途：大规模测试\n`;
      for (let i = 1; i <= 200; i++) {
        largeTableContext += `  行${i}: 名称=角色${i}, 状态=活跃, 描述=这是第${i}个角色的详细描述\n`;
      }

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: '',
          tableContext: largeTableContext
        },
        baseGenerationParams
      );

      expect(result).toContain('历史剧情表格数据（重要参考资料）');
      expect(result).toContain('行200: 名称=角色200');
      expect(result.length).toBeGreaterThan(5000);
    });

    it('应该在 tableContext 包含特殊字符时正确转义', () => {
      const specialTableContext = `## 历史剧情表格数据（重要参考资料）\n\n=== 特殊字符测试 (表格索引: 1) ===\n表格用途：测试\n  行1: 内容=包含"引号"和<特殊>字符\n  行2: 内容=包含换行符和\t制表符\n`;

      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '',
          recentChapters: '',
          chapterSummaries: '',
          longTermContext: '',
          continuityConstraints: '',
          tableContext: specialTableContext
        },
        baseGenerationParams
      );

      expect(result).toContain('包含"引号"');
      expect(result).toContain('历史剧情表格数据');
    });
  });

  describe('buildContentPrompt - 完整集成场景', () => {
    it('应该正确整合所有上下文信息（包含tableContext）', () => {
      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '## 角色信息\n### 张三\n描述: 剑客',
          recentChapters: '',
          chapterSummaries: '## 所有章节概要\n- 序章: 主角入山',
          longTermContext: '',
          continuityConstraints: '## 连贯性约束\n保持角色性格一致',
          tableContext: `## 历史剧情表格数据（重要参考资料）\n=== 角色信息 (表格索引: 1) ===\n表格用途：角色追踪\n  行1: 名称=张三, 状态=存活\n`
        },
        { ...baseGenerationParams, constraints: ['禁止出现现代用语'] }
      );

      // 验证所有部分都存在
      expect(result).toContain('## 相关背景资料');
      expect(result).toContain('## 历史剧情表格数据（重要参考资料）');
      expect(result).toContain('## 所有章节概要');
      expect(result).toContain('## 连贯性约束');
      expect(result).toContain('## 生成要求');
      expect(result).toContain('## 输出要求');
      expect(result).toContain('禁止出现现代用语');
    });

    it('应该在无tableContext但有其他上下文时正确工作', () => {
      const result = promptBuilder.buildContentPrompt(
        baseChapterInfo,
        {
          resourceContext: '角色信息',
          recentChapters: '',
          chapterSummaries: '概要',
          longTermContext: '长期设定',
          continuityConstraints: '约束条件'
        },
        baseGenerationParams
      );

      expect(result).toContain('## 相关背景资料');
      expect(result).toContain('## 所有章节概要');
      expect(result).toContain('## 长期设定信息');
      expect(result).toContain('## 连贯性约束');
      expect(result).not.toContain('历史剧情表格数据');
    });
  });
});
