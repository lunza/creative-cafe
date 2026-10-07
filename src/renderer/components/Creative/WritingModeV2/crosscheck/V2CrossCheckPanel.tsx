/**
 * V2 跨章审查面板（Spec: add-cross-chapter-coherence-review）
 *
 * 章节分组选择（起始章 + 章数）+ 细粒度三参数（距离/阈值/AI严格度，按项目持久化）
 * + 审查（本地扫描恒执行 + AI 语义审查可开关，流式可视化 + 中止 cancelled 契约）
 * + 三类问题分组展示（V2CrossCheckIssueCard）+ 一键修复建议（V2CrossCheckFixModal + 写回）。
 *
 * 章节定位契约：所有章节号均为 0 基数组位置（project.outline.chapters 下标）。
 * 写回 autoSaveChapter 传 chapters[pos].index 字段值（repo 按 index 字段定位，见 CODE_WIKI）。
 *
 * 拆分：设置区 → V2CrossCheckSettings；问题卡片 → V2CrossCheckIssueCard；修复弹窗 → V2CrossCheckFixModal
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, message, Tag, theme, Typography } from 'antd';
import type { WritingProject } from '../../../../../shared/types/writing-v2.types';
import {
  CROSS_CHECK_DEFAULTS,
  CROSS_CHECK_ISSUE_TYPE_LABELS,
  type CrossCheckIssue,
  type CrossCheckIssueType,
  type CrossCheckParams,
  type CrossCheckReport,
} from '../../../../../shared/types/cross-chapter-review.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';
import { readCustomPrompt } from '../shared/CustomPromptPopover';
import V2CrossCheckSettings, { type CrossCheckPersistedParams } from './V2CrossCheckSettings';
import V2CrossCheckIssueCard from './V2CrossCheckIssueCard';
import V2CrossCheckFixModal, { type V2CrossCheckFixState } from './V2CrossCheckFixModal';

const promptKey = (projectId: string) => `v2-crosscheck-prompt:${projectId}`;
const paramsKey = (projectId: string) => `v2-crosscheck-params:${projectId}`;

const DEFAULT_PERSISTED: CrossCheckPersistedParams = {
  distance: CROSS_CHECK_DEFAULTS.distance,
  similarityThreshold: CROSS_CHECK_DEFAULTS.similarityThreshold,
  aiStrictness: CROSS_CHECK_DEFAULTS.aiStrictness,
  enableAiReview: true,
};

function loadPersisted(projectId: string): CrossCheckPersistedParams {
  try {
    const raw = localStorage.getItem(paramsKey(projectId));
    if (raw) return { ...DEFAULT_PERSISTED, ...(JSON.parse(raw) as Partial<CrossCheckPersistedParams>) };
  } catch {
    /* 解析失败回退默认 */
  }
  return { ...DEFAULT_PERSISTED };
}

type Status = 'idle' | 'running' | 'done' | 'error';

/** 流式区只保留尾部片段，避免长文本重渲染压力 */
const STREAM_TAIL = 3000;
const tail = (s: string) => (s.length > STREAM_TAIL ? `…${s.slice(-STREAM_TAIL)}` : s);

interface V2CrossCheckPanelProps {
  project: WritingProject;
  chapterIndex: number;
  onContentUpdated: (content: string) => void;
}

const V2CrossCheckPanel: React.FC<V2CrossCheckPanelProps> = ({
  project,
  chapterIndex,
  onContentUpdated,
}) => {
  const { token } = theme.useToken();
  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const setSelectedChapterIndex = useV2UIStore((s) => s.setSelectedChapterIndex);

  const chapters = useMemo(() => project.outline?.chapters ?? [], [project.outline]);
  const maxStart = Math.max(0, chapters.length - 2);

  const [startPos, setStartPos] = useState(() => Math.min(Math.max(0, chapterIndex), maxStart));
  const [count, setCount] = useState(() =>
    Math.min(
      CROSS_CHECK_DEFAULTS.count,
      Math.max(2, chapters.length - Math.min(Math.max(0, chapterIndex), maxStart))
    )
  );
  const [persisted, setPersisted] = useState<CrossCheckPersistedParams>(() => loadPersisted(project.id));
  const [status, setStatus] = useState<Status>('idle');
  const [stageMsg, setStageMsg] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [streamContent, setStreamContent] = useState('');
  const [report, setReport] = useState<CrossCheckReport | null>(null);
  const [error, setError] = useState('');
  const [fixedIds, setFixedIds] = useState<string[]>([]);
  const [fixState, setFixState] = useState<V2CrossCheckFixState | null>(null);
  const streamBoxRef = useRef<HTMLDivElement | null>(null);

  // 参数持久化（按项目）
  useEffect(() => {
    try {
      localStorage.setItem(paramsKey(project.id), JSON.stringify(persisted));
    } catch {
      /* localStorage 不可用时仅会话内生效 */
    }
  }, [persisted, project.id]);

  // 流式进度订阅（按项目过滤）
  useEffect(() => {
    const api = getWritingV2API();
    if (!api) return;
    const off = api.onCrossCheckStream((event) => {
      if (event.projectId !== project.id) return;
      if (event.message) setStageMsg(event.message);
      if (event.reasoning) setStreamReasoning((s) => s + event.reasoning);
      if (event.chunk) setStreamContent((s) => s + event.chunk);
    });
    return off;
  }, [project.id]);

  // 流式区自动滚底
  useEffect(() => {
    const el = streamBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamReasoning, streamContent, stageMsg]);

  const running = status === 'running';

  const handleReview = useCallback(async () => {
    const api = getWritingV2API();
    if (!api) {
      message.error('writingV2 API 不可用');
      return;
    }
    const range = chapters.slice(startPos, startPos + count);
    const withContent = range.filter((c) => typeof c.content === 'string' && c.content.trim());
    if (withContent.length < 2) {
      message.warning(`所选范围内有正文的章节仅 ${withContent.length} 章，至少需要 2 章`);
      return;
    }
    if (withContent.length < range.length) {
      message.info(`范围内有 ${range.length - withContent.length} 个空章节将被跳过`);
    }

    setStatus('running');
    setStageMsg('正在启动审查…');
    setStreamReasoning('');
    setStreamContent('');
    setReport(null);
    setError('');
    setFixedIds([]);

    const params: CrossCheckParams = {
      startPos,
      count,
      distance: persisted.distance,
      similarityThreshold: persisted.similarityThreshold,
      aiStrictness: persisted.aiStrictness,
      enableAiReview: persisted.enableAiReview,
      customPrompt: readCustomPrompt(promptKey(project.id)) || undefined,
    };

    const startAt = Date.now();
    try {
      const res = await api.crossCheckReview({ projectId: project.id, params });
      if (res.success && res.report) {
        setReport(res.report);
        setStatus('done');
        const secs = ((Date.now() - startAt) / 1000).toFixed(1);
        const n = res.report.issues.length;
        if (res.report.cancelled) {
          message.info(`已停止：当前 ${n} 条问题`);
        } else if (n === 0) {
          message.success(`审查完成（${secs}s）：未发现问题`);
        } else {
          message.success(`审查完成（${secs}s）：${n} 条问题`);
        }
      } else {
        setStatus('error');
        setError(res.error || '审查失败');
        message.error(res.error || '审查失败');
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
      message.error('审查失败');
    }
  }, [chapters, project.id, startPos, count, persisted]);

  const handleStop = useCallback(async () => {
    const api = getWritingV2API();
    if (!api) return;
    setStageMsg('正在停止…');
    await api.crossCheckCancel();
  }, []);

  const handleSuggestFix = useCallback(
    async (issue: CrossCheckIssue) => {
      const api = getWritingV2API();
      if (!api || !report) {
        message.error('暂无审查结果，请先执行审查');
        return;
      }
      setFixState({ issue, loading: true, applying: false, suggestion: null, error: '' });
      try {
        const res = await api.crossCheckSuggestFix({
          projectId: project.id,
          issue,
          checkedPositions: report.checkedPositions,
          customPrompt: readCustomPrompt(promptKey(project.id)) || undefined,
        });
        setFixState((s) =>
          s && s.issue.id === issue.id
            ? {
                ...s,
                loading: false,
                suggestion: res.success ? res.suggestion ?? null : null,
                error: res.success ? '' : res.error || '修复建议生成失败',
              }
            : s
        );
      } catch (e) {
        setFixState((s) =>
          s && s.issue.id === issue.id
            ? { ...s, loading: false, error: e instanceof Error ? e.message : String(e) }
            : s
        );
      }
    },
    [project.id, report]
  );

  const handleApplyFix = useCallback(async () => {
    if (!fixState?.suggestion) return;
    const s = fixState.suggestion;
    const target = chapters[s.chapterIndex];
    if (!target) {
      message.error('目标章节不存在');
      return;
    }
    const oldContent = target.content ?? '';
    const idx = oldContent.indexOf(s.originalText);
    if (idx < 0) {
      message.error('原文定位失败（章节内容可能已变化），请重新生成建议');
      return;
    }
    const newContent =
      oldContent.substring(0, idx) + s.replacementText + oldContent.substring(idx + s.originalText.length);

    // 1) 更新项目实体（单一真相源，store 防抖落盘）
    const outline = project.outline;
    if (outline) {
      patchProject(project.id, {
        outline: {
          ...outline,
          chapters: outline.chapters.map((c, i) =>
            i === s.chapterIndex ? { ...c, content: newContent, wordCount: newContent.length } : c
          ),
        },
      });
    }
    // 2) autoSaveChapter 落盘章节文件 + 版本记录（repo 按 index 字段值定位，传字段值而非位置）
    const api = getWritingV2API();
    if (api) {
      await api.autoSaveChapter({ projectId: project.id, chapterIndex: target.index, content: newContent });
    }
    // 3) 目标章为当前打开章时同步编辑器
    if (s.chapterIndex === chapterIndex) {
      onContentUpdated(newContent);
    }
    setFixedIds((prev) => (prev.includes(fixState.issue.id) ? prev : [...prev, fixState.issue.id]));
    setFixState(null);
    message.success(`已应用修复并写回第${s.chapterIndex + 1}章`);
  }, [fixState, chapters, project, chapterIndex, patchProject, onContentUpdated]);

  const handleJump = useCallback(
    (pos: number) => {
      setSelectedChapterIndex(pos);
    },
    [setSelectedChapterIndex]
  );

  // 问题按类型分组（顺序：情节矛盾 > 重复剧情 > 文本重复）
  const grouped = useMemo(() => {
    const order: CrossCheckIssueType[] = ['plot_contradiction', 'plot_repetition', 'text_repetition'];
    const map = new Map<CrossCheckIssueType, CrossCheckIssue[]>();
    for (const t of order) map.set(t, []);
    for (const issue of report?.issues ?? []) {
      map.get(issue.type)?.push(issue);
    }
    return order.map((t) => ({ type: t, issues: map.get(t) ?? [] })).filter((g) => g.issues.length > 0);
  }, [report]);

  const startOptions = chapters
    .map((c, pos) => ({
      value: pos,
      label: `第${pos + 1}章${c.title ? ` ${c.title}` : ''}${c.content?.trim() ? '' : '（无正文）'}`,
    }))
    .filter((o) => o.value <= maxStart);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: 12, gap: 10 }}>
      <V2CrossCheckSettings
        chapterOptions={startOptions}
        startPos={startPos}
        count={count}
        persisted={persisted}
        running={running}
        promptStorageKey={promptKey(project.id)}
        onStartPositionChange={setStartPos}
        onCountChange={setCount}
        onPersistedChange={setPersisted}
        onReview={handleReview}
        onStop={handleStop}
      />

      {/* 审查过程（流式可视化） */}
      {running && (
        <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 8 }}>
          <Tag color={streamContent ? 'processing' : 'gold'}>
            {streamContent ? 'AI 审查进行中' : '审查进行中'}
          </Tag>
          {stageMsg && (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              {stageMsg}
            </Typography.Text>
          )}
          <div
            ref={streamBoxRef}
            style={{
              marginTop: 6,
              maxHeight: 180,
              overflow: 'auto',
              fontSize: 11,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: token.colorFillQuaternary,
              borderRadius: 6,
              padding: 8,
            }}
          >
            {streamReasoning && (
              <span style={{ color: '#d48806' }}>
                [思考流]
                {tail(streamReasoning)}
                {'\n'}
              </span>
            )}
            {streamContent && <span>{tail(streamContent)}</span>}
            {!streamReasoning && !streamContent && (
              <span style={{ color: token.colorTextTertiary }}>等待 AI 响应…</span>
            )}
          </div>
        </div>
      )}

      {/* 常驻结果摘要卡片 */}
      {report && !running && (
        <div
          style={{
            border: `1px solid ${report.cancelled ? token.colorWarningBorder : token.colorSuccessBorder}`,
            background: report.cancelled ? token.colorWarningBg : token.colorSuccessBg,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
          }}
        >
          {report.cancelled
            ? `已停止：${report.issues.length} 条问题（本地 ${report.stats.localCount} / AI ${report.stats.aiCount}）`
            : `审查完成：${report.issues.length} 条问题（本地 ${report.stats.localCount} / AI ${report.stats.aiCount}），耗时 ${Math.round(report.stats.durationMs / 1000)}s，覆盖 ${report.stats.chapters} 章`}
          {report.aiError && (
            <div style={{ color: token.colorWarningText, marginTop: 2 }}>
              AI 阶段失败（本地结果保留）：{report.aiError}
            </div>
          )}
        </div>
      )}

      {status === 'error' && <Alert type="error" showIcon message="审查失败" description={error} />}

      {/* 结果分组 */}
      {report && !running && report.issues.length === 0 && (
        <div
          style={{
            border: `1px solid ${token.colorSuccessBorder}`,
            background: token.colorSuccessBg,
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          未发现问题，跨章节连贯性良好
        </div>
      )}
      {grouped.map((g) => (
        <div key={g.type}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {CROSS_CHECK_ISSUE_TYPE_LABELS[g.type]}
            </Typography.Text>
            <Tag>{g.issues.length}</Tag>
          </div>
          {g.issues.map((issue) => (
            <V2CrossCheckIssueCard
              key={issue.id}
              issue={issue}
              fixed={fixedIds.includes(issue.id)}
              onJump={handleJump}
              onSuggestFix={handleSuggestFix}
              suggestLoading={fixState !== null && fixState.loading && fixState.issue.id === issue.id}
            />
          ))}
        </div>
      ))}

      <V2CrossCheckFixModal fixState={fixState} onApply={handleApplyFix} onClose={() => setFixState(null)} />
    </div>
  );
};

export default V2CrossCheckPanel;
