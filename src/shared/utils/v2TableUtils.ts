/**
 * V2 表格整理纯工具（渲染层 CSV 导出 / 模板合并校验 / 变更摘要，主进程与单测共用）
 */
import type { WritingTableTemplate } from '../constants/writingTableTemplates';
import { PLOT_CHECK_DIMENSION_LABELS } from '../types/writing-v2.types';

/** 模板视图（内置 + 自定义合并后，custom 标记是否用户可编辑/删除） */
export interface V2TableTemplateView extends WritingTableTemplate {
  custom: boolean;
}

/**
 * 合并写作模板列表：内置优先（同名 id 的自定义项被忽略，防止覆盖内置），
 * 每项打上 custom 标记。
 */
export function mergeWritingTemplates(
  builtin: WritingTableTemplate[],
  custom: WritingTableTemplate[]
): V2TableTemplateView[] {
  const builtinIds = new Set(builtin.map((t) => t.id));
  const views: V2TableTemplateView[] = builtin.map((t) => ({ ...t, custom: false }));
  for (const t of custom) {
    if (builtinIds.has(t.id)) continue; // 内置 id 保留给内置模板
    // 自定义内部同 id 去重（后写的覆盖先写的，与存储层语义一致）
    const idx = views.findIndex((v) => v.id === t.id);
    const view: V2TableTemplateView = { ...t, custom: true };
    if (idx >= 0) views[idx] = view;
    else views.push(view);
  }
  return views;
}

/**
 * 校验写作模板结构（保存前调用）。返回错误信息，合法时返回 null。
 */
export function validateWritingTemplate(t: WritingTableTemplate): string | null {
  if (!t.name || !t.name.trim()) return '模板名称不能为空';
  if (!t.description || !t.description.trim()) return '模板描述不能为空';
  if (!t.sheets || t.sheets.length === 0) return '至少需要一个表格';
  const sheetNames = new Set<string>();
  for (const s of t.sheets) {
    if (!s.name || !s.name.trim()) return '存在未命名的表格';
    if (sheetNames.has(s.name)) return `表格名称重复：${s.name}`;
    sheetNames.add(s.name);
    if (!s.description || !s.description.trim()) return `表格"${s.name}"缺少描述`;
    if (!s.headers || s.headers.length === 0) return `表格"${s.name}"至少需要一个列`;
    for (const h of s.headers) {
      if (!h || !h.trim()) return `表格"${s.name}"存在空列名`;
    }
    const headerSet = new Set(s.headers);
    if (headerSet.size !== s.headers.length) return `表格"${s.name}"存在重复列`;
  }
  return null;
}

/** 待确认变更摘要（版本快照 changeRecord 计数） */
export interface V2TableChangeSummary {
  added: number;
  modified: number;
  deleted: number;
}

export function summarizeTableChanges(record: {
  addedRows: unknown[];
  modifiedCells: unknown[];
  deletedRows: unknown[];
}): V2TableChangeSummary {
  return {
    added: record.addedRows?.length ?? 0,
    modified: record.modifiedCells?.length ?? 0,
    deleted: record.deletedRows?.length ?? 0,
  };
}

/** CSV 单元格转义（引号/逗号/换行） */
function escapeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ==================== 全书检查报告 ====================

/** 全书检查结果条目（面板 bookResults 的结构化形状） */
export interface V2BookCheckResultItem {
  chapterIndex: number;
  title: string;
  report?: {
    overallScore: number;
    totalIssues: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
    dimensions: Array<{
      dimension: string;
      score: number;
      maxScore: number;
      issues: Array<{
        dimension: string;
        severity: string;
        title: string;
        description: string;
        suggestion: string;
      }>;
    }>;
  } | null;
  error?: string;
}

const SEVERITY_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/**
 * 构建全书剧情检查报告（Markdown）。
 * 结构：总览表（章节/评分/问题分布）+ 逐章问题明细（维度/严重度/建议）。
 */
export function buildBookCheckMarkdown(
  projectTitle: string,
  results: V2BookCheckResultItem[]
): string {
  const ok = results.filter((r) => r.report);
  const avg = ok.length
    ? Math.round(ok.reduce((s, r) => s + (r.report as NonNullable<V2BookCheckResultItem['report']>).overallScore, 0) / ok.length)
    : null;
  const totalIssues = ok.reduce(
    (s, r) => s + (r.report as NonNullable<V2BookCheckResultItem['report']>).totalIssues,
    0
  );
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const lines: string[] = [];
  lines.push(`# 《${projectTitle}》全书剧情检查报告`, '');
  lines.push(
    `> 生成于 ${stamp} · 检查 ${results.length} 章 · ${
      avg != null ? `平均 ${avg} 分` : '无有效结果'
    } · 共 ${totalIssues} 个问题`,
    ''
  );

  lines.push('## 总览', '');
  lines.push('| 章节 | 评分 | 问题数 | 高 | 中 | 低 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    if (r.report) {
      const rep = r.report;
      lines.push(
        `| ${r.chapterIndex + 1}. ${r.title} | ${rep.overallScore} | ${rep.totalIssues} | ${rep.highSeverityCount} | ${rep.mediumSeverityCount} | ${rep.lowSeverityCount} |`
      );
    } else {
      lines.push(`| ${r.chapterIndex + 1}. ${r.title} | — | — | 检查失败 | | |`);
    }
  }
  lines.push('');

  lines.push('## 章节明细', '');
  for (const r of results) {
    if (!r.report) {
      lines.push(`### ${r.chapterIndex + 1}. ${r.title}`, '');
      lines.push(`> 检查失败：${r.error || '未知错误'}`, '');
      continue;
    }
    const rep = r.report;
    lines.push(`### ${r.chapterIndex + 1}. ${r.title}（${rep.overallScore} 分）`, '');
    let issueCount = 0;
    for (const dim of rep.dimensions) {
      for (const issue of dim.issues) {
        issueCount++;
        const dimLabel = (PLOT_CHECK_DIMENSION_LABELS as Record<string, string>)[issue.dimension] || issue.dimension;
        const sev = SEVERITY_LABELS[issue.severity] || issue.severity;
        lines.push(`**[${sev}] ${dimLabel}：${issue.title}**`);
        if (issue.description) lines.push(`- ${issue.description}`);
        if (issue.suggestion) lines.push(`- 建议：${issue.suggestion}`);
        lines.push('');
      }
    }
    if (issueCount === 0) {
      lines.push('_未发现问题_');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 构建单表 CSV 文本（带 BOM，Excel 中文兼容）。
 * 列 = headers ∪ 数据行实际键（保持 headers 顺序在前）。
 */
export function buildTableCsv(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  const extraKeys = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r)))
  ).filter((k) => !headers.includes(k));
  const allHeaders = [...headers, ...extraKeys];
  const lines = [allHeaders.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(allHeaders.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}
