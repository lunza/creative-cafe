import type { TestLog } from '../types/vectorTest';

export const generateTestLogs = (): TestLog[] => {
  return [];
};

export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
};

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatReportJson = (report: Record<string, any>): string => {
  return JSON.stringify(report, null, 2);
};

export const formatReportCsv = (report: Record<string, any>): string => {
  const rows = [['name', 'status', 'duration', 'detail']];
  for (const r of report.results || []) {
    rows.push([r.name, r.status, `${r.duration}ms`, `"${(r.detail || '').replace(/"/g, '""')}"`]);
  }
  return rows.map(row => row.join(',')).join('\n');
};
