import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Layout, Tag, theme, Tooltip, Modal, message } from 'antd';
import {
  MergeCellsOutlined,
  ExportOutlined,
  AppstoreOutlined,
  AuditOutlined,
  TableOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StopOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import type { WritingProject, ChapterOutline } from '../../../../../shared/types/writing-v2.types';
import { ChapterStatus, ShardStatus } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';
import { useV2GenerationStore } from '../stores/useV2GenerationStore';
import V2ShardPipelinePanel from './V2ShardPipelinePanel';
import { useV2ShardGeneration } from './useV2ShardGeneration';
import V2SplitMergeActions from './V2SplitMergeActions';
import V2PlotCheckPanel from '../plotcheck/V2PlotCheckPanel';
import V2CrossCheckPanel from '../crosscheck/V2CrossCheckPanel';
import V2TablePanel from '../table/V2TablePanel';
import V2VersionHistoryModal from './V2VersionHistoryModal';
import CustomPromptPopover, { readCustomPrompt } from '../shared/CustomPromptPopover';

const { Content } = Layout;

const CONTENT_SAVE_DELAY = 2000;

/** 自定义提示词 localStorage key（按功能入口隔离，见 CustomPromptPopover 约定） */
const GEN_CUSTOM_PROMPT_KEY = 'v2chapter_auto_gen_custom_prompt';
const DEAI_CUSTOM_PROMPT_KEY = 'v2chapter_deai_check_custom_prompt';

/**
 * V2 章节工作台（Phase 1 / P0）
 * 左：章节列表；中：正文编辑（防抖自动保存）；右：分片生成流水线。
 */
const V2ChapterWorkbench: React.FC<{ project: WritingProject }> = ({ project }) => {
  const { token } = theme.useToken();
  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const selectedChapterIndex = useV2UIStore((s) => s.selectedChapterIndex);
  const setSelectedChapterIndex = useV2UIStore((s) => s.setSelectedChapterIndex);
  const setShowExportDialog = useV2UIStore((s) => s.setShowExportDialog);
  const chapterStructureVersion = useV2UIStore((s) => s.chapterStructureVersion);

  const chapters: ChapterOutline[] = project.outline?.chapters ?? [];
  const selectedIndex =
    selectedChapterIndex != null && chapters[selectedChapterIndex] ? selectedChapterIndex : 0;
  const chapter = chapters[selectedIndex];

  // 编辑器本地文本（防抖落盘）
  const [text, setText] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef('');
  textRef.current = text;
  // 一键生成实时预览标记（预览期间编辑区内容来自流式事件，不触发自动保存）
  const livePreviewRef = useRef(false);
  // 一键生成进行中（声明前置：实时预览 effect 依赖它）
  const [autoRunning, setAutoRunning] = useState(false);

  // 切换章节 / 章节结构变化（AI 拆并）时载入正文
  useEffect(() => {
    setText(chapter?.content || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, selectedIndex, chapterStructureVersion]);

  const persistContent = useCallback(
    async (content: string) => {
      const api = getWritingV2API();
      if (!api) return;
      if (!content) return;
      await api.autoSaveChapter({ projectId: project.id, chapterIndex: selectedIndex, content });
      // 同步渲染层投影（单一真相源 = 项目实体）
      const outline = project.outline;
      if (outline) {
        patchProject(project.id, {
          outline: {
            ...outline,
            chapters: outline.chapters.map((c, i) =>
              i === selectedIndex
                ? { ...c, content, wordCount: content.length, status: ChapterStatus.COMPLETED, lastModified: Date.now() }
                : c
            ),
          },
        });
      }
    },
    [project, selectedIndex, patchProject]
  );

  const handleTextChange = (value: string) => {
    setText(value);
    if (livePreviewRef.current) return; // 实时预览期间不落盘（合并时统一落定）
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistContent(textRef.current);
    }, CONTENT_SAVE_DELAY);
  };

  // 一键生成实时预览：把正在生成的分片内容（思考流/正文）映射到中间编辑区，
  // 用户可边生成边看边评价（思考模型先输出思考流，正文随后；合并后以最终内容为准）
  const liveShardContent = useV2GenerationStore((s) =>
    s.phase === 'STREAMING' && s.streamingShardIndex !== null
      ? (s.shardDetails[s.streamingShardIndex]?.content ||
        s.shardDetails[s.streamingShardIndex]?.reasoning ||
        '')
      : null
  );
  useEffect(() => {
    const isPreview = autoRunning && liveShardContent !== null;
    livePreviewRef.current = isPreview;
    if (!isPreview) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setText(liveShardContent);
  }, [liveShardContent, autoRunning]);

  // 卸载/切换前把未落盘内容冲刷一次
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const t = textRef.current;
        if (t) persistContent(t);
      }
    };
  }, [persistContent]);

  const { planShards, generateShard, mergeToChapter, cancel } = useV2ShardGeneration({
    project,
    chapter,
  });

  /** 面板"合并"按钮回调：合并落盘后同步编辑器与投影 */
  const doMerge = async (): Promise<boolean> => {
    const merged = await mergeToChapter();
    if (!merged) return false;
    setText(merged);
    persistContent(merged);
    return true;
  };

  // 一键生成本章：规划分片大纲 → 逐片生成 → 自动合并到正文
  // （面向不想手动走右侧流水线三步流程的用户，尤其是漫画导入后首次写作）
  const handleAutoGenerate = async () => {
    if (autoRunning) return;
    if (text.trim()) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: 'AI 生成本章',
          content: '本章已有正文，生成完成后合并将覆盖现有正文。继续？',
          okText: '继续生成',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    setAutoRunning(true);
    const count = Math.min(10, Math.max(1, Math.round((chapter.targetWordCount || 3000) / 1000)));
    const key = 'autoGenChapter';
    // 自定义提示词同时注入分片大纲与分片内容两条生成链（最高优先级）
    const customPrompt = readCustomPrompt(GEN_CUSTOM_PROMPT_KEY) || undefined;
    try {
      message.loading({ content: `第 ${selectedIndex + 1} 章：生成 ${count} 个分片大纲…`, key, duration: 0 });
      const planned = await planShards(count, customPrompt);
      if (!planned) {
        message.error({ content: '分片大纲生成失败，请查看右侧「生成流水线」', key });
        return;
      }
      for (let i = 0; i < count; i++) {
        message.loading({ content: `第 ${selectedIndex + 1} 章：分片 ${i + 1}/${count} 生成中…`, key, duration: 0 });
        await generateShard(i, customPrompt);
      }
      const completed = useV2GenerationStore
        .getState()
        .shardDetails.filter((d) => d.status === ShardStatus.COMPLETED).length;
      if (completed === 0) {
        message.error({ content: '分片全部生成失败，请查看右侧「生成流水线」', key });
        return;
      }
      message.loading({ content: '正在合并分片到章节正文…', key, duration: 0 });
      const merged = await mergeToChapter();
      if (merged) {
        setText(merged);
        persistContent(merged);
        message.success({
          content: `第 ${selectedIndex + 1} 章生成完成（${completed}/${count} 分片，${merged.length} 字）`,
          key,
        });
      } else {
        message.warning({ content: '生成完成但无可合并的分片内容', key });
      }
    } finally {
      setAutoRunning(false);
    }
  };

  /** 剧情检查修正回写：同步编辑器 + 立即落盘 */
  const handleContentUpdated = useCallback(
    (newContent: string) => {
      setText(newContent);
      persistContent(newContent);
    },
    [persistContent]
  );

  // AI 味审核：用 humanizer 规则审读当前章节正文，弹窗实时流式展示审核过程（思考流/正文），完成后展示结果，可一键采用修订文本
  const [deAiChecking, setDeAiChecking] = useState(false);
  const [deAiResult, setDeAiResult] = useState<{
    passed: boolean;
    comment: string;
    issues: string[];
    revisedContent: string;
  } | null>(null);
  // 审核过程流式文本（思考流在前，正文 JSON 随后）
  const [deAiStreamText, setDeAiStreamText] = useState('');
  const [deAiContentStarted, setDeAiContentStarted] = useState(false);
  // 用户主动停止标记：弹窗保留已流式内容，标题显示"已停止"
  const [deAiStopped, setDeAiStopped] = useState(false);
  const deAiStreamBoxRef = useRef<HTMLDivElement | null>(null);

  // 流式文本变化时自动滚到底部
  useEffect(() => {
    if (!deAiChecking) return;
    const box = deAiStreamBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [deAiStreamText, deAiChecking]);

  const handleCheckDeAi = async () => {
    const content = text.trim();
    if (!content) {
      message.info('章节正文为空，无法审核');
      return;
    }
    const api = getWritingV2API();
    if (!api) return;
    setDeAiResult(null);
    setDeAiStreamText('');
    setDeAiContentStarted(false);
    setDeAiStopped(false);
    setDeAiChecking(true);
    const unsubscribe = api.onDeAiStream((e) => {
      if (e.reasoning) setDeAiStreamText((t) => t + e.reasoning);
      if (e.chunk) {
        setDeAiContentStarted(true);
        setDeAiStreamText((t) => t + e.chunk);
      }
    });
    try {
      const result = await api.checkChapterDeAi({
        chapterTitle: chapter?.title || `第${selectedIndex + 1}章`,
        content,
        modelConfig: project.config.modelConfig,
        // 自定义审核要求（可选，最高优先级）
        customPrompt: readCustomPrompt(DEAI_CUSTOM_PROMPT_KEY) || undefined,
      });
      if (result.success) {
        setDeAiResult({
          passed: result.passed === true,
          comment: result.comment || '',
          issues: result.issues || [],
          revisedContent: result.revisedContent || content,
        });
      } else if (result.cancelled) {
        // 用户主动停止：弹窗保留已流式内容，提示"已停止"而非报错
        setDeAiStopped(true);
      } else {
        message.error(result.error || 'AI 味审核失败，请重试');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'AI 味审核失败，请重试');
    } finally {
      unsubscribe();
      setDeAiChecking(false);
    }
  };

  /** 中止进行中的 AI 味审核（主进程返回 cancelled 标记，弹窗保留已流式内容） */
  const handleStopDeAi = () => {
    const api = getWritingV2API();
    if (!api) return;
    void api.cancelDeAiCheck();
  };

  /** 采用审核修订文本：同步编辑器 + 立即落盘 */
  const handleAdoptDeAiRevised = () => {
    if (!deAiResult) return;
    setText(deAiResult.revisedContent);
    persistContent(deAiResult.revisedContent);
    setDeAiResult(null);
    message.success('已采用 AI 味审核的修订文本');
  };

  // 右栏多 Tab（分片流水线 / 剧情检查 / 表格整理）+ 可拖拽宽度
  const [rightTab, setRightTab] = useState<'pipeline' | 'plotcheck' | 'crosscheck' | 'table'>('pipeline');
  const [rightWidth, setRightWidth] = useState(440);
  const [showVersions, setShowVersions] = useState(false);

  /** 版本恢复：取消未落盘防抖（避免旧文本回写覆盖恢复结果）+ 同步编辑器（主进程已落盘） */
  const handleContentRestored = useCallback((restored: string) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setText(restored);
  }, []);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rightWidth;
      const onMove = (ev: MouseEvent) => {
        // 向左拖动加宽，向右拖动收窄
        setRightWidth(Math.min(760, Math.max(360, startWidth + (startX - ev.clientX))));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
    },
    [rightWidth]
  );

  // 空态早退（必须在所有 hooks 之后，避免 hooks 顺序不稳定）
  if (!project.outline || chapters.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Empty description="该项目还没有大纲，请先生成大纲" />
      </div>
    );
  }

  const completedCount = chapters.filter(
    (c) => c.status === ChapterStatus.COMPLETED || (c.content && c.content.trim().length > 0)
  ).length;

  return (
    <Layout style={{ height: '100%' }}>
      {/* 左：章节列表 */}
      <Layout.Sider width={220} style={{ overflow: 'auto', borderRight: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer }}>
        <div style={{ padding: 12, fontSize: 12, color: token.colorTextTertiary }}>
          章节（{completedCount}/{chapters.length} 已完成）
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {chapters.map((c, i) => {
            const hasContent = !!c.content && c.content.trim().length > 0;
            const active = i === selectedIndex;
            return (
              <div
                key={i}
                onClick={() => setSelectedChapterIndex(i)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: `1px solid ${token.colorFillQuaternary}`,
                  background: active ? token.colorPrimaryBg : 'transparent',
                  borderLeft: active ? `3px solid ${token.colorPrimary}` : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: hasContent ? token.colorSuccess : token.colorTextTertiary,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: active ? 600 : 400,
                    }}
                    title={c.title}
                  >
                    {c.title}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                  {c.wordCount || 0} 字 / 目标 {c.targetWordCount || '-'}
                </div>
              </div>
            );
          })}
        </div>
      </Layout.Sider>

      <Layout style={{ display: 'flex' }}>
        {/* 中：正文编辑 */}
        <Content style={{ padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <h3 style={{ margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chapter.title}
            </h3>
            {/* 一键生成本章：规划分片 → 逐片生成 → 自动合并（细粒度操作仍走右侧「生成流水线」） */}
            <Button
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              loading={autoRunning}
              onClick={handleAutoGenerate}
            >
              AI 生成本章
            </Button>
            <CustomPromptPopover
              storageKey={GEN_CUSTOM_PROMPT_KEY}
              title="AI 生成本章 - 自定义提示词"
              placeholder="输入写作要求（如：多写对话、节奏紧凑、突出莫妮卡的情绪变化等），将作为最高优先级约束同时附加到分片大纲与正文生成（可选）"
              disabled={autoRunning}
            />
            <Button
              size="small"
              icon={<AuditOutlined />}
              loading={deAiChecking}
              disabled={autoRunning || !text.trim()}
              onClick={handleCheckDeAi}
            >
              检查 AI 味
            </Button>
            <CustomPromptPopover
              storageKey={DEAI_CUSTOM_PROMPT_KEY}
              title="检查 AI 味 - 自定义提示词"
              disabled={deAiChecking || autoRunning}
            />
            {chapter.summary && (
              <Tooltip title={chapter.summary}>
                <Tag style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  摘要
                </Tag>
              </Tooltip>
            )}
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>自动保存已开启</span>
            <Button size="small" icon={<HistoryOutlined />} onClick={() => setShowVersions(true)}>
              历史版本
              {(chapter?.versions?.length ?? 0) > 0 ? ` (${chapter.versions!.length})` : ''}
            </Button>
          </div>
          <textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            readOnly={autoRunning}
            placeholder={autoRunning ? 'AI 生成中（思考与正文实时显示于此，生成完成自动合并）…' : '在此编写章节正文（编辑后自动保存）'}
            spellCheck={false}
            style={{
              flex: 1,
              resize: 'none',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
              padding: 16,
              fontSize: 15,
              lineHeight: 1.9,
              fontFamily: 'inherit',
              background: token.colorBgContainer,
              color: token.colorText,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <V2SplitMergeActions project={project} chapterIndex={selectedIndex} />
            <span style={{ flex: 1 }} />
            <Button icon={<ExportOutlined />} onClick={() => setShowExportDialog(true)}>
              导出作品
            </Button>
          </div>
        </Content>

        {/* 右栏分隔条（拖拽调整宽度） */}
        <div
          onMouseDown={startResize}
          style={{
            width: 4,
            flexShrink: 0,
            cursor: 'col-resize',
            background: token.colorBorderSecondary,
            opacity: 0.4,
          }}
          title="拖拽调整右栏宽度"
        />

        {/* 右：多 Tab 面板（分片流水线 / 剧情检查 / 表格整理） */}
        <Layout.Sider width={rightWidth} style={{ display: 'flex', flexDirection: 'column', background: token.colorBgContainer }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${token.colorBorderSecondary}`, flexShrink: 0 }}>
            {(
              [
                { key: 'pipeline', icon: <AppstoreOutlined />, label: '生成流水线' },
                { key: 'plotcheck', icon: <AuditOutlined />, label: '剧情检查' },
                { key: 'crosscheck', icon: <NodeIndexOutlined />, label: '跨章审查' },
                { key: 'table', icon: <TableOutlined />, label: '表格整理' },
              ] as const
            ).map((t) => (
              <div
                key={t.key}
                onClick={() => setRightTab(t.key)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  fontSize: 12,
                  cursor: 'pointer',
                  color: rightTab === t.key ? token.colorPrimary : token.colorTextSecondary,
                  borderBottom:
                    rightTab === t.key ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                  fontWeight: rightTab === t.key ? 600 : 400,
                }}
              >
                {t.icon} {t.label}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {rightTab === 'pipeline' && (
              <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                <V2ShardPipelinePanel
                  planShards={planShards}
                  generateShard={generateShard}
                  mergeToChapter={doMerge}
                />
                <Button
                  block
                  danger
                  ghost
                  icon={<MergeCellsOutlined />}
                  style={{ marginTop: 8 }}
                  onClick={cancel}
                >
                  取消当前生成
                </Button>
              </div>
            )}
            {rightTab === 'plotcheck' && (
              <V2PlotCheckPanel
                project={project}
                chapterIndex={selectedIndex}
                content={text}
                onContentUpdated={handleContentUpdated}
              />
            )}
            {rightTab === 'crosscheck' && (
              <V2CrossCheckPanel
                project={project}
                chapterIndex={selectedIndex}
                onContentUpdated={handleContentUpdated}
              />
            )}
            {rightTab === 'table' && (
              <V2TablePanel project={project} chapterIndex={selectedIndex} />
            )}
          </div>
        </Layout.Sider>
      </Layout>

      {/* AI 味审核：审核中实时流式展示思考流/正文 JSON，完成后切换为结果视图（状态 + 说明 + 问题清单 + 修订文本） */}
      <Modal
        title={
          <span>
            检查 AI 味
            {deAiChecking && (
              <Tag color={deAiContentStarted ? 'processing' : 'gold'} style={{ marginLeft: 12 }}>
                {deAiContentStarted ? '正在生成审核结果' : 'AI 思考中'}
              </Tag>
            )}
            {deAiStopped && <Tag color="default" style={{ marginLeft: 12 }}>已停止</Tag>}
          </span>
        }
        open={deAiChecking || deAiStopped || !!deAiResult}
        onCancel={() => {
          if (!deAiChecking) {
            setDeAiResult(null);
            setDeAiStopped(false);
          }
        }}
        closable={!deAiChecking}
        maskClosable={false}
        footer={
          deAiResult
            ? [
                <Button key="close" onClick={() => setDeAiResult(null)}>
                  关闭
                </Button>,
                <Button key="reaudit" loading={deAiChecking} onClick={handleCheckDeAi}>
                  重新审核
                </Button>,
                <Button key="apply" type="primary" onClick={handleAdoptDeAiRevised}>
                  采用审核文本
                </Button>,
              ]
            : [
                <span key="pending" style={{ fontSize: 12, color: token.colorTextTertiary }}>
                  {deAiStopped
                    ? '已停止，以下为已流式输出的内容（可关闭或重新审核）'
                    : deAiContentStarted
                      ? '审核结果生成中，实时内容如下…'
                      : 'AI 正在思考（思考流实时展示，思考完成后开始生成审核结果）…'}
                </span>,
                deAiStopped ? (
                  <Button key="stop-close" onClick={() => setDeAiStopped(false)}>
                    关闭
                  </Button>
                ) : (
                  <Button key="stop" danger icon={<StopOutlined />} onClick={handleStopDeAi}>
                    停止审核
                  </Button>
                ),
              ]
        }
        width={860}
        getContainer={() => document.body}
        zIndex={5000}
        maskStyle={{ zIndex: 5000 }}
        style={{ zIndex: 5000 }}
      >
        {deAiChecking || deAiStopped ? (
          <div
            ref={deAiStreamBoxRef}
            style={{
              height: 400,
              overflow: 'auto',
              padding: 12,
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'inherit',
              color: deAiContentStarted ? token.colorText : '#b3791a',
              background: token.colorFillQuaternary,
              borderRadius: 8,
            }}
          >
            {deAiStreamText || '等待 AI 输出…'}
          </div>
        ) : deAiResult ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <span style={{ marginRight: 8 }}>审核状态：</span>
              {deAiResult.passed ? (
                <Tag icon={<CheckCircleOutlined />} color="success">通过</Tag>
              ) : (
                <Tag icon={<CloseCircleOutlined />} color="error">不通过</Tag>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>审核说明：</label>
              <Input.TextArea
                value={deAiResult.comment}
                rows={3}
                readOnly
                style={{ backgroundColor: token.colorFillQuaternary }}
              />
            </div>
            {deAiResult.issues.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  问题清单（{deAiResult.issues.length}）：
                </label>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                  {deAiResult.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                审核并去 AI 味后的文本：
              </label>
              <Input.TextArea
                value={deAiResult.revisedContent}
                rows={10}
                readOnly
                style={{ backgroundColor: token.colorFillQuaternary }}
              />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 章节版本快照（手动保存 / 自动存档 / 恢复） */}
      <V2VersionHistoryModal
        project={project}
        chapterIndex={selectedIndex}
        currentContent={text}
        open={showVersions}
        onClose={() => setShowVersions(false)}
        onContentRestored={handleContentRestored}
      />
    </Layout>
  );
};

export default V2ChapterWorkbench;
