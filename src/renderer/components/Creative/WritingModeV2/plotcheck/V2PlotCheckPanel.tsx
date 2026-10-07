import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress, Space, Spin, Tag, theme, message } from 'antd';
import {
  AuditOutlined,
  ThunderboltOutlined,
  FileSearchOutlined,
  ReadOutlined,
  HistoryOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type {
  WritingProject,
  PlotCheckReport,
  PlotCheckIssue,
  LogicCheckIssue,
  BatchFixIssueInfo,
  V2AutoFixResult,
} from '../../../../../shared/types/writing-v2.types';
import {
  PLOT_CHECK_DIMENSION_LABELS,
  LOGIC_CONTRADICTION_TYPE_LABELS,
} from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { buildBookCheckMarkdown } from '../../../../../shared/utils/v2TableUtils';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';
import V2PlotIssueList, { type V2NormalizedIssue } from './V2PlotIssueList';
import { V2FixConfirmModal, V2BatchConfirmModal, V2LogicRecordsModal } from './V2PlotCheckModals';

interface V2BookCheckResult {
  chapterIndex: number;
  title: string;
  report?: PlotCheckReport;
  error?: string;
}

function formatShortTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface V2PlotCheckPanelProps {
  project: WritingProject;
  chapterIndex: number;
  /** 当前编辑器正文（实时值，可能含未落盘内容） */
  content: string;
  /** 接受修正后由工作台同步编辑器与落盘 */
  onContentUpdated: (newContent: string) => void;
}

/**
 * V2 剧情检查面板（Phase 2 / P1 质量能力）
 *
 * 复用主进程 PlotCheckerService 通道：
 *   checkChapter（维度评分 + 逻辑异常）/ autoFixIssue（单条修正）/
 *   batchFixIssues（批量修正）/ 逻辑记录（V2LogicRecordsModal）。
 * 修正结果需用户确认后才回写编辑器（onContentUpdated）。
 */
const V2PlotCheckPanel: React.FC<V2PlotCheckPanelProps> = ({
  project,
  chapterIndex,
  content,
  onContentUpdated,
}) => {
  const { token } = theme.useToken();
  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const setSelectedChapterIndex = useV2UIStore((s) => s.setSelectedChapterIndex);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<PlotCheckReport | null>(null);
  const [fixedKeys, setFixedKeys] = useState<Set<string>>(new Set());
  const [fixingKeys, setFixingKeys] = useState<Set<string>>(new Set());
  const [fixConfirm, setFixConfirm] = useState<{ key: string; title: string; result: V2AutoFixResult } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState<{ fixedContent: string; okCount: number; total: number } | null>(null);
  const [logicModalOpen, setLogicModalOpen] = useState(false);

  // 全书批量检查
  const [bookProgress, setBookProgress] = useState<{ current: number; total: number } | null>(null);
  const [bookResults, setBookResults] = useState<V2BookCheckResult[]>([]);
  const bookCancelledRef = useRef(false);
  /** 全书结果"查看"跳转时携带的章节报告（避免被切换章节的重置逻辑清掉） */
  const pendingReportRef = useRef<PlotCheckReport | null>(null);

  // 章节/项目切换时重置报告（全书结果"查看"跳转时恢复携带的报告）
  useEffect(() => {
    if (pendingReportRef.current) {
      setReport(pendingReportRef.current);
      pendingReportRef.current = null;
    } else {
      setReport(null);
    }
    setFixedKeys(new Set());
  }, [project.id, chapterIndex]);

  const chapters = project.outline?.chapters ?? [];
  const chapterHistory = chapters[chapterIndex]?.plotCheckHistory ?? [];

  /** 检查完成后追加历史（存章节实体，随项目落盘；保留最近 20 条） */
  const appendCheckHistory = (chIdx: number, overallScore: number, totalIssues: number) => {
    const outline = project.outline;
    if (!outline) return;
    const ch = outline.chapters[chIdx];
    if (!ch) return;
    const history = [
      ...(ch.plotCheckHistory ?? []),
      { timestamp: Date.now(), overallScore, totalIssues },
    ].slice(-20);
    patchProject(project.id, {
      outline: {
        ...outline,
        chapters: outline.chapters.map((c, i) =>
          i === chIdx ? { ...c, plotCheckHistory: history } : c
        ),
      },
    });
  };

  const hasContent = !!content && content.trim().length > 0;

  /** 维度问题 + 逻辑问题归一化 */
  const normalizedIssues: V2NormalizedIssue[] = useMemo(() => {
    if (!report) return [];
    const items: V2NormalizedIssue[] = [];
    for (const dim of report.dimensions) {
      for (const issue of dim.issues) {
        items.push({
          key: `dim-${dim.dimension}-${issue.title}-${issue.description.slice(0, 32)}`,
          kind: 'dimension',
          categoryLabel: PLOT_CHECK_DIMENSION_LABELS[issue.dimension] || dim.dimension,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          suggestion: issue.suggestion,
          fixable: !!issue.fixable,
        });
      }
    }
    for (const issue of report.logicCheckResult?.issues ?? []) {
      items.push({
        key: `logic-${issue.type}-${issue.description.slice(0, 32)}`,
        kind: 'logic',
        categoryLabel: LOGIC_CONTRADICTION_TYPE_LABELS[issue.type] || issue.type,
        severity: issue.severity,
        title: LOGIC_CONTRADICTION_TYPE_LABELS[issue.type] || '逻辑异常',
        description: issue.description,
        suggestion: issue.suggestion || issue.analysis,
        fixable: !!issue.fixable,
      });
    }
    return items;
  }, [report]);

  /** key → 原始 issue（修正时传给主进程） */
  const rawIssueMap = useMemo(() => {
    const map = new Map<string, { issue: PlotCheckIssue | LogicCheckIssue; kind: 'dimension' | 'logic' }>();
    if (!report) return map;
    for (const dim of report.dimensions) {
      for (const issue of dim.issues) {
        map.set(
          `dim-${dim.dimension}-${issue.title}-${issue.description.slice(0, 32)}`,
          { issue, kind: 'dimension' }
        );
      }
    }
    for (const issue of report.logicCheckResult?.issues ?? []) {
      map.set(`logic-${issue.type}-${issue.description.slice(0, 32)}`, { issue, kind: 'logic' });
    }
    return map;
  }, [report]);

  const handleCheck = async () => {
    const api = getWritingV2API();
    if (!api || !hasContent) return;
    setChecking(true);
    try {
      // chapterIndex 是 0 基数组位置：按位置切片取前文。不能用 c.index < chapterIndex 过滤——
      // 漫画导入项目 index 字段为 1 基，会漏掉紧邻的上一章
      const previousChapters = (project.outline?.chapters ?? [])
        .slice(0, chapterIndex)
        .filter((c) => c.content && c.content.trim())
        .map((c) => ({ index: c.index, title: c.title, content: c.content as string }));
      const result = await api.checkChapter({
        projectId: project.id,
        chapterIndex,
        content,
        previousChapters,
      });
      if (result.success && result.report) {
        setReport(result.report);
        setFixedKeys(new Set());
        appendCheckHistory(chapterIndex, result.report.overallScore, result.report.totalIssues);
        message.success(`检查完成：${result.report.totalIssues} 个问题`);
      } else {
        message.error(result.error || '剧情检查失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '剧情检查失败');
    } finally {
      setChecking(false);
    }
  };

  /** 全书批量检查：串行遍历全部有内容章节（控制 AI 并发），可取消 */
  const handleBookCheck = async () => {
    const api = getWritingV2API();
    if (!api) return;
    // 带原数组位置（checkChapter 的 chapterIndex 语义是 0 基位置，主进程按位置定位本章大纲；
    // 不能传 c.index 字段值——漫画导入项目其为 1 基，会定位到下一章）
    const targets = chapters
      .map((c, pos) => ({ c, pos }))
      .filter(({ c }) => c.content && c.content.trim());
    if (targets.length === 0) {
      message.warning('还没有可检查的章节内容');
      return;
    }
    setBookResults([]);
    setBookProgress({ current: 0, total: targets.length });
    bookCancelledRef.current = false;
    const results: V2BookCheckResult[] = [];
    for (let i = 0; i < targets.length; i++) {
      if (bookCancelledRef.current) break;
      const c = targets[i].c;
      setBookProgress({ current: i + 1, total: targets.length });
      // 跨章节上下文：传前一章（截断控制 token），更深的历史由大纲 + 表格数据承载
      const prev = targets[i - 1]?.c;
      const previousChapters = prev?.content
        ? [
            {
              index: prev.index,
              title: prev.title,
              content: (prev.content || '').slice(0, 4000),
            },
          ]
        : [];
      try {
        const res = await api.checkChapter({
          projectId: project.id,
          chapterIndex: targets[i].pos,
          content: c.content as string,
          previousChapters,
        });
        if (res.success && res.report) {
          results.push({ chapterIndex: c.index, title: c.title, report: res.report });
          appendCheckHistory(c.index, res.report.overallScore, res.report.totalIssues);
        } else {
          results.push({
            chapterIndex: c.index,
            title: c.title,
            error: res.error || '检查失败',
          });
        }
      } catch (err) {
        results.push({
          chapterIndex: c.index,
          title: c.title,
          error: err instanceof Error ? err.message : '检查失败',
        });
      }
      setBookResults([...results]);
    }
    setBookProgress(null);
    if (bookCancelledRef.current) {
      message.info('全书检查已取消');
    }
  };

  const cancelBookCheck = () => {
    bookCancelledRef.current = true;
  };

  /** 全书结果"查看"：携带该章报告跳转到对应章节 */
  const jumpToChapter = (idx: number, r: PlotCheckReport) => {
    pendingReportRef.current = r;
    setSelectedChapterIndex(idx);
  };

  /** 导出全书检查报告（Markdown，渲染层本地下载） */
  const handleExportBookReport = () => {
    if (bookResults.length === 0) return;
    const md = buildBookCheckMarkdown(project.title || '未命名作品', bookResults);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title || '作品'}-全书检查报告.md`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('检查报告已导出');
  };

  const handleFix = async (item: V2NormalizedIssue) => {
    const api = getWritingV2API();
    const raw = rawIssueMap.get(item.key);
    if (!api || !raw) return;
    setFixingKeys((prev) => new Set(prev).add(item.key));
    try {
      const result = await api.autoFixIssue({
        projectId: project.id,
        chapterIndex,
        content,
        issue: raw.issue,
        issueType: raw.kind,
        modelConfig: project.config.modelConfig,
      });
      if (result.success) {
        setFixConfirm({ key: item.key, title: item.title, result });
      } else {
        message.error(result.error || '自动修正失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '自动修正失败');
    } finally {
      setFixingKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
    }
  };

  const handleBatchFix = async () => {
    const api = getWritingV2API();
    if (!api || !report) return;
    const pending = normalizedIssues.filter((i) => i.fixable && !fixedKeys.has(i.key));
    if (pending.length === 0) {
      message.warning('没有可批量修正的问题');
      return;
    }
    setBatchRunning(true);
    try {
      const issues: BatchFixIssueInfo[] = pending.map((item) => {
        const raw = rawIssueMap.get(item.key);
        const r = raw?.issue;
        return {
          dimension: raw?.kind === 'dimension' ? (r as PlotCheckIssue).dimension : undefined,
          type: raw?.kind === 'logic' ? (r as LogicCheckIssue).type : undefined,
          severity: item.severity,
          title: item.title,
          description: item.description,
          analysis: raw?.kind === 'logic' ? (r as LogicCheckIssue).analysis : undefined,
          suggestion: item.suggestion,
          position: r?.position,
          originalText: r?.originalText,
          references: r?.references,
        };
      });
      const result = await api.batchFixIssues({
        projectId: project.id,
        chapterIndex,
        content,
        issues,
        modelConfig: project.config.modelConfig,
      });
      if (result.success) {
        const okCount = result.results.filter((r) => r.success).length;
        setBatchConfirm({ fixedContent: result.fixedContent, okCount, total: issues.length });
      } else {
        message.error(result.error || '批量修正失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量修正失败');
    } finally {
      setBatchRunning(false);
    }
  };

  const acceptFix = () => {
    if (!fixConfirm) return;
    onContentUpdated(fixConfirm.result.fixedContent);
    setFixedKeys((prev) => new Set(prev).add(fixConfirm.key));
    setFixConfirm(null);
    message.success('修正已应用到正文');
  };

  const acceptBatchFix = () => {
    if (!batchConfirm) return;
    onContentUpdated(batchConfirm.fixedContent);
    setFixedKeys(new Set(normalizedIssues.filter((i) => i.fixable).map((i) => i.key)));
    setBatchConfirm(null);
    message.success('批量修正已应用到正文');
  };

  const scoreColor = (score: number): string => {
    if (score >= 90) return token.colorSuccess;
    if (score >= 75) return token.colorPrimary;
    if (score >= 60) return token.colorWarning;
    return token.colorError;
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', height: '100%' }}>
      <Space size={8}>
        <Button
          type="primary"
          size="small"
          icon={<AuditOutlined />}
          loading={checking}
          disabled={!hasContent}
          onClick={handleCheck}
        >
          剧情检查
        </Button>
        {report && (
          <Button size="small" icon={<ThunderboltOutlined />} loading={batchRunning} onClick={handleBatchFix}>
            批量修正
          </Button>
        )}
        <Button size="small" icon={<FileSearchOutlined />} onClick={() => setLogicModalOpen(true)}>
          逻辑记录
        </Button>
        <Button
          size="small"
          icon={<ReadOutlined />}
          loading={!!bookProgress}
          disabled={checking || !!bookProgress}
          onClick={handleBookCheck}
        >
          全书检查
        </Button>
      </Space>
      {!hasContent && (
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
          请先在正文中生成或输入章节内容
        </div>
      )}

      {checking && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip="AI 正在检查剧情一致性、逻辑异常…（约需 30-120 秒）" />
        </div>
      )}

      {/* 全书批量检查进度 */}
      {bookProgress && (
        <div style={{ padding: '4px 2px' }}>
          <Progress
            percent={Math.round((bookProgress.current / bookProgress.total) * 100)}
            size="small"
            format={() => `${bookProgress.current}/${bookProgress.total}`}
          />
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 8 }}>
            正在检查第 {bookProgress.current}/{bookProgress.total} 章（每章约需 30-120 秒，串行执行）
          </div>
          <Button size="small" danger ghost onClick={cancelBookCheck}>
            取消检查
          </Button>
        </div>
      )}

      {/* 全书检查结果汇总 */}
      {bookResults.length > 0 && !bookProgress && (
        <div
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            padding: '8px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <ReadOutlined />
            <span style={{ fontSize: 12, fontWeight: 600 }}>全书检查结果</span>
            {(() => {
              const rs = bookResults.filter((r) => r.report).map((r) => r.report as PlotCheckReport);
              const avg = rs.length
                ? Math.round(rs.reduce((s, r) => s + r.overallScore, 0) / rs.length)
                : null;
              const totalIssues = rs.reduce((s, r) => s + r.totalIssues, 0);
              return (
                <>
                  {avg != null && <Tag color={avg >= 75 ? 'green' : avg >= 60 ? 'orange' : 'red'}>平均 {avg} 分</Tag>}
                  <Tag>{totalIssues} 个问题</Tag>
                  <Tag>{rs.length}/{bookResults.length} 章成功</Tag>
                </>
              );
            })()}
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<DownloadOutlined />} onClick={handleExportBookReport}>
              导出报告
            </Button>
            <Button size="small" type="text" onClick={() => setBookResults([])}>
              清除
            </Button>
          </div>
          {bookResults.map((r) => (
            <div
              key={r.chapterIndex}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                borderBottom: `1px solid ${token.colorFillQuaternary}`,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${r.chapterIndex + 1}. ${r.title}`}
              >
                {r.chapterIndex + 1}. {r.title}
              </span>
              {r.report ? (
                <>
                  <Tag color={r.report.overallScore >= 75 ? 'green' : r.report.overallScore >= 60 ? 'orange' : 'red'}>
                    {r.report.overallScore} 分
                  </Tag>
                  <span style={{ width: 52, textAlign: 'right', color: token.colorTextTertiary }}>
                    {r.report.totalIssues} 问题
                  </span>
                  <Button size="small" type="link" onClick={() => jumpToChapter(r.chapterIndex, r.report as PlotCheckReport)}>
                    查看
                  </Button>
                </>
              ) : (
                <Tag color="default" title={r.error}>
                  失败
                </Tag>
              )}
            </div>
          ))}
        </div>
      )}

      {report && !checking && (
        <>
          {/* 总分 + 维度评分 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '10px 12px',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor(report.overallScore) }}>
                {report.overallScore}
              </div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary }}>综合评分</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {report.dimensions.map((dim) => (
                <div key={dim.dimension} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 96, color: token.colorTextSecondary }}>
                    {PLOT_CHECK_DIMENSION_LABELS[dim.dimension] || dim.dimension}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: token.colorFillQuaternary,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${dim.maxScore > 0 ? (dim.score / dim.maxScore) * 100 : 0}%`,
                        height: '100%',
                        background: dim.passed ? token.colorSuccess : token.colorWarning,
                      }}
                    />
                  </div>
                  <span style={{ width: 52, textAlign: 'right' }}>
                    {dim.score}/{dim.maxScore}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <V2PlotIssueList
            issues={normalizedIssues}
            fixedKeys={fixedKeys}
            fixingKeys={fixingKeys}
            onFix={handleFix}
          />
        </>
      )}

      {/* 当前章节评分趋势（检查历史存于章节实体） */}
      {chapterHistory.length > 0 && (
        <div
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            padding: '8px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <HistoryOutlined />
            <span style={{ fontSize: 12, fontWeight: 600 }}>评分趋势</span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              最近 {Math.min(chapterHistory.length, 5)} 次 / 共 {chapterHistory.length} 次
            </span>
          </div>
          {[...chapterHistory].reverse().slice(0, 5).map((h, idx, arr) => {
            const older = arr[idx + 1];
            const delta = older ? h.overallScore - older.overallScore : null;
            return (
              <div
                key={`${h.timestamp}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  padding: '2px 0',
                }}
              >
                <span style={{ width: 96, color: token.colorTextTertiary }}>
                  {formatShortTime(h.timestamp)}
                </span>
                <Tag
                  color={
                    h.overallScore >= 90
                      ? 'success'
                      : h.overallScore >= 75
                        ? 'processing'
                        : h.overallScore >= 60
                          ? 'warning'
                          : 'error'
                  }
                  style={{ marginInlineEnd: 0 }}
                >
                  {h.overallScore} 分
                </Tag>
                <span style={{ color: token.colorTextTertiary }}>{h.totalIssues} 问题</span>
                {delta != null && delta !== 0 && (
                  <span
                    style={{
                      color: delta > 0 ? token.colorSuccess : token.colorError,
                      fontSize: 11,
                    }}
                  >
                    {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {fixConfirm && (
        <V2FixConfirmModal
          open
          title={fixConfirm.title}
          result={fixConfirm.result}
          onAccept={acceptFix}
          onCancel={() => setFixConfirm(null)}
        />
      )}
      {batchConfirm && (
        <V2BatchConfirmModal
          open
          okCount={batchConfirm.okCount}
          total={batchConfirm.total}
          onAccept={acceptBatchFix}
          onCancel={() => setBatchConfirm(null)}
        />
      )}
      <V2LogicRecordsModal open={logicModalOpen} onClose={() => setLogicModalOpen(false)} />
    </div>
  );
};

export default V2PlotCheckPanel;
