/**
 * 全流程创作流水线纯工具（参数校验 + E2E 结果断言，主进程/渲染层/单测共用）
 */
import type { PipelineE2EAssertion, PipelineInitParams } from '../types/writing-v2.types';

export interface PipelineValidationResult {
  ok: boolean;
  errors: string[];
}

/** 资源候选（用于 id 存在性校验） */
export interface PipelineCandidateIds {
  characterIds: string[];
  worldBookIds: string[];
}

/**
 * 校验流水线初始化参数（纯函数）。
 * 规则：chapterCount 1-50、targetWordCount 1000-200000、
 * 角色卡 ≥1 且互不重复且 id 存在、世界书 ≥1 且 id 存在、创意描述非空。
 */
export function validatePipelineInit(
  params: PipelineInitParams,
  candidates?: PipelineCandidateIds
): PipelineValidationResult {
  const errors: string[] = [];

  if (!params || typeof params !== 'object') {
    return { ok: false, errors: ['参数缺失'] };
  }
  if (!params.creativeDescription || !params.creativeDescription.trim()) {
    errors.push('创意描述不能为空');
  }
  if (!Number.isInteger(params.chapterCount) || params.chapterCount < 1 || params.chapterCount > 50) {
    errors.push('章节数必须是 1-50 的整数');
  }
  if (!Number.isFinite(params.targetWordCount) || params.targetWordCount < 1000 || params.targetWordCount > 200000) {
    errors.push('目标字数必须在 1000-200000 之间');
  }
  if (!params.modelConfig || !params.modelConfig.model) {
    errors.push('缺少有效的模型配置');
  }

  const charIds = params.characterCardIds ?? [];
  if (charIds.length < 1) {
    errors.push('至少需要绑定 1 个角色卡');
  } else if (new Set(charIds).size !== charIds.length) {
    errors.push('角色卡 id 存在重复');
  } else if (candidates) {
    const missing = charIds.filter((id) => !candidates.characterIds.includes(id));
    if (missing.length > 0) {
      errors.push(`角色卡 id 不存在于候选列表（${missing.length} 个）`);
    }
  }

  const wbIds = params.worldBookIds ?? [];
  if (wbIds.length < 1) {
    errors.push('至少需要绑定 1 本世界书');
  } else if (candidates) {
    const missing = wbIds.filter((id) => !candidates.worldBookIds.includes(id));
    if (missing.length > 0) {
      errors.push(`世界书 id 不存在于候选列表（${missing.length} 个）`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------- E2E 断言 ----------

export interface E2EChapterInput {
  index: number;
  title: string;
  content: string;
  targetWordCount: number;
}

export interface E2EAssertInput {
  /** 实际章节（含正文） */
  chapters: E2EChapterInput[];
  expected: {
    chapterCount: number;
    targetWordCount: number;
    /** 所选角色卡名称（须全部出现在大纲或全文中） */
    characterNames: string[];
    /** 所选世界书核心词条（至少 1 个出现在大纲或全文中） */
    worldbookKeywords: string[];
    /** 大纲文本（用于注入判定） */
    outlineText: string;
    /** 导出文件是否存在且非空 */
    exportedFileExists: boolean;
  };
}

/**
 * E2E 结果断言（纯函数）：
 *  - 章节数 === 期望
 *  - 每章字数 ≥ 章目标 × 50%
 *  - 总字数 ≥ 目标 × 80%
 *  - 每个角色卡名称出现在大纲或全文中
 *  - 世界书至少 1 个核心词条出现在大纲或全文中
 *  - 导出文件存在且非空
 */
export function assertE2EResult(input: E2EAssertInput): PipelineE2EAssertion[] {
  const results: PipelineE2EAssertion[] = [];
  const { chapters, expected } = input;
  const fullText = chapters.map((c) => c.content).join('\n');
  const haystack = `${expected.outlineText}\n${fullText}`;
  const totalWords = fullText.length;

  // 1. 章节数
  results.push({
    name: 'chapterCount',
    passed: chapters.length === expected.chapterCount,
    detail: `实际 ${chapters.length} 章 / 期望 ${expected.chapterCount} 章`,
  });

  // 2. 每章字数 ≥ 章目标 × 50%
  const perChapter = chapters.map((c) => {
    const min = Math.round((c.targetWordCount || 0) * 0.5);
    const passed = c.content.length >= min;
    results.push({
      name: `chapter[${c.index}].wordCount`,
      passed,
      detail: `第 ${c.index + 1} 章「${c.title}」${c.content.length} 字 / 下限 ${min} 字（目标 ${c.targetWordCount}）`,
    });
    return passed;
  });
  results.push({
    name: 'allChapters.wordCount',
    passed: perChapter.length > 0 && perChapter.every(Boolean),
    detail: `全部章节字数达标率 ${perChapter.filter(Boolean).length}/${perChapter.length}`,
  });

  // 3. 总字数 ≥ 目标 × 80%
  const totalMin = Math.round(expected.targetWordCount * 0.8);
  results.push({
    name: 'totalWordCount',
    passed: totalWords >= totalMin,
    detail: `总字数 ${totalWords} / 下限 ${totalMin}（目标 ${expected.targetWordCount} × 80%）`,
  });

  // 4. 角色卡名称注入
  for (const name of expected.characterNames) {
    const passed = name.length > 0 && haystack.includes(name);
    results.push({
      name: `characterInjected:${name}`,
      passed,
      detail: passed
        ? `角色「${name}」已注入`
        : `角色「${name}」未出现在大纲或全文中`,
    });
  }

  // 5. 世界书词条注入（至少 1 个）
  const hitKeyword = expected.worldbookKeywords.find((k) => k && haystack.includes(k));
  results.push({
    name: 'worldbookInjected',
    passed: hitKeyword != null,
    detail: hitKeyword != null
      ? `世界书词条「${hitKeyword}」已注入`
      : `世界书词条均未命中（候选 ${expected.worldbookKeywords.length} 个）`,
  });

  // 6. 导出文件
  results.push({
    name: 'exportedFile',
    passed: expected.exportedFileExists,
    detail: expected.exportedFileExists ? '成书文件存在且非空' : '成书文件缺失或为空',
  });

  return results;
}

/** 断言明细 → verdict */
export function verdictOf(assertions: PipelineE2EAssertion[]): 'PASS' | 'FAIL' {
  // 汇总性断言（allChapters.wordCount）与逐项断言重复计数，verdict 以单项为准：
  // 只要存在非汇总项失败即 FAIL
  const meaningful = assertions.filter((a) => a.name !== 'allChapters.wordCount');
  return meaningful.every((a) => a.passed) ? 'PASS' : 'FAIL';
}

/** 分片数启发式：每片约 2500 字，1-5 片 */
export function suggestedShardCount(targetWordCount: number): number {
  const n = Math.ceil(Math.max(targetWordCount, 0) / 2500);
  return Math.min(Math.max(n, 1), 5);
}
