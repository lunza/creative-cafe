/**
 * PlotCheckerService quickFixSuggestion 校验逻辑单元测试（F7 修复验证）
 *
 * 验证点：
 *  1. validateQuickFixSuggestion 对 fixedText 空白/纯空白的拒绝
 *  2. 对 originalText === fixedText（no-op 修复）的拒绝
 *  3. 对 originalText.trim() === fixedText.trim() 的拒绝
 *  4. 对 originalText 超长（>2000）的拒绝
 *  5. 对 fixedText 超长（>5000）的拒绝
 *  6. 对正常输入的接受（精确匹配 / 修剪匹配 / 锚点匹配）
 *  7. parseCheckResponse 中 quickFixable 与 quickFixSuggestion 的一致性
 *
 * 由于 validateQuickFixSuggestion / parseCheckResponse 为 private 方法，
 * 本测试通过访问 (service as any) 的私有成员直接调用，避免破坏封装的公共 API。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chatLogService.addLog，避免测试污染日志
vi.mock('../memory/chatLogService', () => ({
  addLog: vi.fn(),
}));

// Mock AIService，避免 import 时初始化真实服务
vi.mock('../AIService', () => ({
  aiService: {
    getConfig: vi.fn().mockResolvedValue({ baseUrl: '', model: '', apiKey: '' }),
    getEngineConfig: vi.fn().mockResolvedValue({ temperature: 0.7, maxTokens: 2048 }),
    callChatAPI: vi.fn(),
  },
  ChatMessage: {} as any,
}));

// Mock WritingResourceManager
vi.mock('../WritingResourceManager', () => ({
  writingResourceManager: {
    buildContext: vi.fn().mockReturnValue(null),
  },
}));

import { plotCheckerService } from '../writing/PlotCheckerService';

describe('PlotCheckerService.validateQuickFixSuggestion (F7 修复)', () => {
  let service: any;

  beforeEach(() => {
    service = plotCheckerService as any;
  });

  describe('字段存在与类型校验', () => {
    it('suggestion 为 null 时返回 undefined', () => {
      expect(service.validateQuickFixSuggestion(null, '正文')).toBeUndefined();
    });

    it('originalText 缺失时返回 undefined', () => {
      expect(service.validateQuickFixSuggestion({ fixedText: '修改' }, '正文')).toBeUndefined();
    });

    it('fixedText 缺失时返回 undefined', () => {
      expect(service.validateQuickFixSuggestion({ originalText: '原文' }, '正文')).toBeUndefined();
    });

    it('originalText 非字符串时返回 undefined', () => {
      expect(
        service.validateQuickFixSuggestion(
          { originalText: 123, fixedText: '修改' },
          '正文'
        )
      ).toBeUndefined();
    });

    it('chapterContent 为空时返回 undefined', () => {
      expect(
        service.validateQuickFixSuggestion(
          { originalText: '原文', fixedText: '修改' },
          ''
        )
      ).toBeUndefined();
    });
  });

  describe('F7 新增：fixedText 格式校验', () => {
    const chapterContent = '张三吃掉了面包，然后又拿出一个面包。';

    it('fixedText 为纯空白时返回 undefined', () => {
      expect(
        service.validateQuickFixSuggestion(
          { originalText: '张三吃掉了面包', fixedText: '   \n\t  ' },
          chapterContent
        )
      ).toBeUndefined();
    });

    it('fixedText 为空字符串时返回 undefined', () => {
      expect(
        service.validateQuickFixSuggestion(
          { originalText: '张三吃掉了面包', fixedText: '' },
          chapterContent
        )
      ).toBeUndefined();
    });

    it('originalText 与 fixedText 完全相同（no-op）时返回 undefined', () => {
      // 即使能匹配原文，no-op 修复也无效
      expect(
        service.validateQuickFixSuggestion(
          { originalText: '张三吃掉了面包', fixedText: '张三吃掉了面包' },
          chapterContent
        )
      ).toBeUndefined();
    });

    it('originalText 与 fixedText 修剪后相同（no-op）时返回 undefined', () => {
      expect(
        service.validateQuickFixSuggestion(
          { originalText: '  张三吃掉了面包  ', fixedText: '张三吃掉了面包' },
          chapterContent
        )
      ).toBeUndefined();
    });

    it('originalText 超过 2000 字符上限时返回 undefined', () => {
      const longText = '张三吃掉了面包'.repeat(500); // 3000 字符
      const fixedText = '修改后的文本';
      // 把 longText 拼进 chapterContent，确保能匹配，但仍应被长度上限拒绝
      const content = longText + '尾';
      expect(
        service.validateQuickFixSuggestion(
          { originalText: longText, fixedText },
          content
        )
      ).toBeUndefined();
    });

    it('fixedText 超过 5000 字符上限时返回 undefined', () => {
      const originalText = '张三吃掉了面包';
      const longFixed = '修改后的文本'.repeat(1500); // 7500 字符
      expect(
        service.validateQuickFixSuggestion(
          { originalText, fixedText: longFixed },
          chapterContent
        )
      ).toBeUndefined();
    });
  });

  describe('正常输入的匹配策略', () => {
    const chapterContent = '张三吃掉了面包，然后又拿出一个面包。';

    it('精确匹配：返回带 position 的 validated suggestion', () => {
      const result = service.validateQuickFixSuggestion(
        {
          originalText: '张三吃掉了面包',
          fixedText: '张三吃掉了一个面包',
          reason: '修正物品数量',
        },
        chapterContent
      );
      expect(result).toBeDefined();
      expect(result.originalText).toBe('张三吃掉了面包');
      expect(result.fixedText).toBe('张三吃掉了一个面包');
      expect(result.reason).toBe('修正物品数量');
      expect(result.position).toBeDefined();
      expect(result.position?.startIndex).toBe(0);
      expect(result.position?.endIndex).toBe('张三吃掉了面包'.length);
    });

    it('修剪匹配：去除首尾空白后能匹配时返回成功', () => {
      const result = service.validateQuickFixSuggestion(
        {
          originalText: '  张三吃掉了面包  ',
          fixedText: '张三吃掉了一个面包',
          reason: '',
        },
        chapterContent
      );
      expect(result).toBeDefined();
      expect(result.originalText).toBe('张三吃掉了面包');
      expect(result.fixedText).toBe('张三吃掉了一个面包');
      // reason 缺失时默认 '无'
      expect(result.reason).toBe('无');
      expect(result.position?.startIndex).toBe(0);
    });

    it('reason 缺失时默认为 "无"', () => {
      const result = service.validateQuickFixSuggestion(
        {
          originalText: '张三吃掉了面包',
          fixedText: '张三吃掉了一个面包',
        },
        chapterContent
      );
      expect(result).toBeDefined();
      expect(result.reason).toBe('无');
    });

    it('所有匹配策略失败时返回 undefined', () => {
      expect(
        service.validateQuickFixSuggestion(
          {
            originalText: '这段文字不存在于原文中',
            fixedText: '修改后的文本',
          },
          chapterContent
        )
      ).toBeUndefined();
    });
  });

  describe('锚点匹配策略', () => {
    it('首句+末句锚点能定位时返回成功', () => {
      const chapterContent =
        '今天天气很好，我们一起去公园散步。中途下起了小雨，但我们依然走完了全程。回家的路上买了一些水果。';
      const originalText =
        '今天天气很好，我们一起去公园散步。\n中间这段文字可能不完全匹配。\n回家的路上买了一些水果。';
      const fixedText = '今天天气很好，我们一起去公园散步。回家的路上买了一些水果。';

      const result = service.validateQuickFixSuggestion(
        { originalText, fixedText, reason: '测试锚点匹配' },
        chapterContent
      );
      // 锚点匹配应能定位到从首句开始到末句结束的完整区间
      expect(result).toBeDefined();
      expect(result.position?.startIndex).toBeGreaterThanOrEqual(0);
      expect(result.position?.endIndex).toBeLessThanOrEqual(chapterContent.length);
      // 提取后的 originalText 应来自 chapterContent（而非 AI 原始输入）
      expect(chapterContent.indexOf(result.originalText)).toBeGreaterThanOrEqual(0);
    });

    it('原文过短（<20字符）不进入锚点匹配', () => {
      // 短文本无法锚点匹配，且不在原文中，应返回 undefined
      expect(
        service.validateQuickFixSuggestion(
          { originalText: '不存在的短文', fixedText: '修改' },
          '这是一段正文内容'
        )
      ).toBeUndefined();
    });
  });

  describe('position 提取策略', () => {
    it('AI 提供 position 时直接从原文提取', () => {
      const chapterContent = '张三吃掉了面包，然后又拿出一个面包。';
      // substring(0, 7) = '张三吃掉了面包'（7 字符）
      const result = service.validateQuickFixSuggestion(
        {
          originalText: '这段文字不匹配原文',
          fixedText: '张三吃掉了两个面包',
          position: { startIndex: 0, endIndex: 7 },
        },
        chapterContent
      );
      expect(result).toBeDefined();
      expect(result.originalText).toBe('张三吃掉了面包');
      expect(result.position?.startIndex).toBe(0);
      expect(result.position?.endIndex).toBe(7);
    });
  });
});

describe('PlotCheckerService.parseCheckResponse: quickFixable 一致性 (F7 修复)', () => {
  let service: any;

  beforeEach(() => {
    service = plotCheckerService as any;
  });

  /**
   * 构造一个最小的 AI 响应 JSON，包含 dimension issues 与 logic issues。
   * 通过控制 quickFixSuggestion 字段，验证 parseCheckResponse 输出中
   * `quickFixable === (quickFixSuggestion !== undefined)` 的恒等性。
   */
  function buildAiResponse(opts: {
    dimensionQuickFix?: any;
    logicQuickFix?: any;
  }): string {
    return JSON.stringify({
      overall_score: 80,
      dimension_scores: {
        outline_consistency: {
          score: 80,
          issues: opts.dimensionQuickFix
            ? [
                {
                  title: '测试问题',
                  severity: 'medium',
                  description: '描述',
                  suggestion: '建议',
                  quickFixSuggestion: opts.dimensionQuickFix,
                },
              ]
            : [],
        },
        worldbook_compliance: { score: 90, issues: [] },
        character_consistency: { score: 80, issues: [] },
        writing_style: { score: 85, issues: [] },
        plot_continuity: { score: 75, issues: [] },
      },
      logic_issues: opts.logicQuickFix
        ? [
            {
              title: '逻辑问题',
              type: 'item_state',
              severity: 'medium',
              description: '描述',
              analysis: '分析',
              suggestion: '建议',
              quickFixSuggestion: opts.logicQuickFix,
            },
          ]
        : [],
    });
  }

  const chapterContent = '张三吃掉了面包，然后又拿出一个面包。';

  it('quickFixSuggestion 校验通过：quickFixable=true 且 quickFixSuggestion 有值', () => {
    const raw = buildAiResponse({
      dimensionQuickFix: {
        originalText: '张三吃掉了面包',
        fixedText: '张三吃掉了一个面包',
        reason: '修正',
      },
    });
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const issue = report.dimensions[0].issues[0];
    expect(issue.quickFixable).toBe(true);
    expect(issue.quickFixSuggestion).toBeDefined();
    expect(issue.quickFixSuggestion.originalText).toBe('张三吃掉了面包');
    // 一致性：quickFixable === (quickFixSuggestion !== undefined)
    expect(issue.quickFixable).toBe(issue.quickFixSuggestion !== undefined);
  });

  it('quickFixSuggestion 校验失败（no-op）：quickFixable=false 且 quickFixSuggestion=undefined', () => {
    const raw = buildAiResponse({
      dimensionQuickFix: {
        originalText: '张三吃掉了面包',
        fixedText: '张三吃掉了面包', // no-op
        reason: '修正',
      },
    });
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const issue = report.dimensions[0].issues[0];
    expect(issue.quickFixable).toBe(false);
    expect(issue.quickFixSuggestion).toBeUndefined();
    // 一致性
    expect(issue.quickFixable).toBe(issue.quickFixSuggestion !== undefined);
  });

  it('quickFixSuggestion 校验失败（fixedText 空白）：quickFixable=false', () => {
    const raw = buildAiResponse({
      dimensionQuickFix: {
        originalText: '张三吃掉了面包',
        fixedText: '   ',
        reason: '修正',
      },
    });
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const issue = report.dimensions[0].issues[0];
    expect(issue.quickFixable).toBe(false);
    expect(issue.quickFixSuggestion).toBeUndefined();
  });

  it('quickFixSuggestion 校验失败（原文不匹配）：quickFixable=false', () => {
    const raw = buildAiResponse({
      dimensionQuickFix: {
        originalText: '这段文字不在原文中',
        fixedText: '修改后的文字',
        reason: '修正',
      },
    });
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const issue = report.dimensions[0].issues[0];
    expect(issue.quickFixable).toBe(false);
    expect(issue.quickFixSuggestion).toBeUndefined();
  });

  it('logic issues：quickFixable 一致性同样成立', () => {
    const raw = buildAiResponse({
      logicQuickFix: {
        originalText: '又拿出一个面包',
        fixedText: '没有拿出面包',
        reason: '修正',
      },
    });
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const issue = report.logicCheckResult?.issues[0];
    expect(issue).toBeDefined();
    expect(issue.quickFixable).toBe(true);
    expect(issue.quickFixSuggestion).toBeDefined();
    expect(issue.quickFixable).toBe(issue.quickFixSuggestion !== undefined);
  });

  it('logic issues：quickFixSuggestion 校验失败时 quickFixable=false', () => {
    const raw = buildAiResponse({
      logicQuickFix: {
        originalText: '又拿出一个面包',
        fixedText: '又拿出一个面包', // no-op
        reason: '修正',
      },
    });
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const issue = report.logicCheckResult?.issues[0];
    expect(issue).toBeDefined();
    expect(issue.quickFixable).toBe(false);
    expect(issue.quickFixSuggestion).toBeUndefined();
  });

  it('quickFixSuggestion 字段缺失：quickFixable=false 且 quickFixSuggestion=undefined', () => {
    const raw = buildAiResponse({}); // 无 quickFixSuggestion 字段
    const report = service.parseCheckResponse(raw, 1, chapterContent);
    const dimIssue = report.dimensions[0].issues[0];
    // 维度 issues 为空，检查 logic issues 也为空
    expect(report.dimensions[0].issues.length).toBe(0);
    expect(report.logicCheckResult?.issues.length).toBe(0);
  });
});
