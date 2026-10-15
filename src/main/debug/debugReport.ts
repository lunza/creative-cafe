/**
 * 四阶段功能 debug 机制 —— 报告生成（纯 fs/path，无服务依赖）
 *
 * 独立于 debugHarness 拆分的原因：报告初始化运行在 vitest globalSetup（主进程），
 * 主进程的模块运行器对 `import { ipcMain } from 'electron'` 的 CJS 互操作会崩溃
 * （electron 包在纯 node 下导出可执行文件路径字符串）。故报告模块只依赖 fs/path，
 * globalSetup 可直接导入；debugHarness 重新导出供测试文件使用。
 *
 * 章节重建策略：每个测试文件的 afterAll 写自己的章节文件（debug-sections/<phaseKey>.md），
 * 再按文件名顺序重建完整报告。vitest 不保证测试文件执行顺序，追加写单文件会乱序/丢失，
 * 该设计使报告完整性与执行顺序无关。
 */
import fs from 'fs';
import path from 'path';

/** debug 报告文件路径（项目根 .trae/documents/phase-debug-report.md） */
const REPORT_PATH = path.resolve(process.cwd(), '.trae', 'documents', 'phase-debug-report.md');
/** 各阶段章节文件目录（每次运行前清空） */
const SECTIONS_DIR = path.resolve(process.cwd(), '.trae', 'documents', 'debug-sections');

/** 报告中的检查项结果（与 debugHarness.DebugCheckResult 结构一致） */
export interface ReportCheckResult {
  phase: string;
  id: string;
  name: string;
  status: 'pass' | 'fail';
  durationMs: number;
  detail: string;
  error?: string;
}

/**
 * 初始化 debug 报告（globalSetup 主进程调用一次）：清空章节目录 + 写入报告头。
 */
export function initDebugReport(engineSummary: string): void {
  fs.rmSync(SECTIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SECTIONS_DIR, { recursive: true });
  const header = `# 四阶段功能 Debug 报告\n\n- 生成时间: ${new Date().toLocaleString('zh-CN')}\n- AI 引擎: ${engineSummary}\n- 运行方式: \`npm run test:debug\`（真实 AI 调用，非 mock）\n\n---\n\n`;
  fs.writeFileSync(path.join(SECTIONS_DIR, '_header.md'), header, 'utf-8');
  fs.writeFileSync(REPORT_PATH, header, 'utf-8');
  console.log(`[debug-harness] 报告已初始化: ${REPORT_PATH}`);
}

/**
 * 写入一个阶段的 debug 报告章节，并按固定顺序重建完整报告。
 * 每个测试文件的 afterAll 调用一次；最后一个完成的文件写出最终完整报告。
 *
 * @param phaseKey 章节排序键（如 'phase1'，决定报告中章节顺序）
 */
export function appendDebugReport(phaseKey: string, title: string, results: ReportCheckResult[]): void {
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.length - passCount;
  const lines: string[] = [];
  lines.push(`## ${title}\n`);
  lines.push(`通过 ${passCount}/${results.length}（失败 ${failCount}）\n`);
  lines.push('| 编号 | 检查项 | 结果 | 耗时 | 细节 / 错误 |');
  lines.push('|------|--------|------|------|-------------|');
  for (const r of results) {
    const status = r.status === 'pass' ? '✅ 通过' : '❌ 失败';
    const detail = (r.status === 'pass' ? r.detail : r.error || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${r.id} | ${r.name} | ${status} | ${r.durationMs}ms | ${detail} |`);
  }
  lines.push('');

  // 1) 写本阶段章节文件
  fs.writeFileSync(path.join(SECTIONS_DIR, `${phaseKey}.md`), lines.join('\n'), 'utf-8');

  // 2) 按文件名顺序重建完整报告（_header 在前，phase1 < phase2 < ...）
  let report = '';
  try {
    const headerFile = path.join(SECTIONS_DIR, '_header.md');
    if (fs.existsSync(headerFile)) report += fs.readFileSync(headerFile, 'utf-8');
    const sectionFiles = fs
      .readdirSync(SECTIONS_DIR)
      .filter(f => f.endsWith('.md') && f !== '_header.md')
      .sort();
    for (const f of sectionFiles) {
      report += fs.readFileSync(path.join(SECTIONS_DIR, f), 'utf-8') + '\n';
    }
  } catch {
    report = lines.join('\n'); // 兜底：至少保留本阶段章节
  }
  fs.writeFileSync(REPORT_PATH, report, 'utf-8');
}
