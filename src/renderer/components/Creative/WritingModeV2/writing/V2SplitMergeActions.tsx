import React, { useState } from 'react';
import { Button, InputNumber, List, Modal, Space, Tag, message, theme } from 'antd';
import { ScissorOutlined, MergeCellsOutlined } from '@ant-design/icons';
import type {
  WritingProject,
  ChapterOutline,
  AISplitSuggestion,
  AIMergeSuggestion,
} from '../../../../../shared/types/writing-v2.types';
import { ChapterStatus } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';

interface V2SplitMergeActionsProps {
  project: WritingProject;
  chapterIndex: number;
}

/** 章节 index 字段与数组位置对齐 */
const reindex = (chapters: ChapterOutline[]): ChapterOutline[] =>
  chapters.map((c, i) => ({ ...c, index: i }));

/**
 * V2 AI 拆/并建议操作（Phase 1 / P0）
 *
 * - AI 拆分：对当前章节调用 aiSuggestSplit，接受后将该章节替换为 N 个新章节；
 *   原正文整体保留在第一个新章节（避免数据丢失），其余分片由流水线重新生成。
 * - AI 合并：对当前章节与下一章调用 aiSuggestMerge，接受后将两章合并为一章，
 *   正文按原顺序拼接保留。
 */
const V2SplitMergeActions: React.FC<V2SplitMergeActionsProps> = ({ project, chapterIndex }) => {
  const { token } = theme.useToken();
  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const bumpChapterStructure = useV2UIStore((s) => s.bumpChapterStructure);

  const [splitCount, setSplitCount] = useState(2);
  const [splitting, setSplitting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [splitSuggestion, setSplitSuggestion] = useState<AISplitSuggestion | null>(null);
  const [mergeSuggestion, setMergeSuggestion] = useState<AIMergeSuggestion | null>(null);
  const [mergeSourceIndices, setMergeSourceIndices] = useState<number[]>([]);

  const chapters: ChapterOutline[] = project.outline?.chapters ?? [];
  const chapter = chapters[chapterIndex];
  const nextChapter = chapters[chapterIndex + 1];

  const handleSplit = async () => {
    if (!chapter) return;
    const api = getWritingV2API();
    if (!api) return;
    if (!chapter.content || !chapter.content.trim()) {
      message.warning('该章节还没有正文，请先生成内容再拆分');
      return;
    }
    setSplitting(true);
    try {
      const result = await api.aiSuggestSplit({
        chapterTitle: chapter.title,
        chapterContent: chapter.content,
        splitCount,
        modelConfig: project.config.modelConfig,
      });
      if (result.success && result.data) {
        setSplitSuggestion(result.data);
      } else {
        message.error(result.error || 'AI 拆分建议生成失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'AI 拆分建议生成失败');
    } finally {
      setSplitting(false);
    }
  };

  const handleMerge = async () => {
    if (!chapter || !nextChapter) return;
    const api = getWritingV2API();
    if (!api) return;
    if (!chapter.content?.trim() && !nextChapter.content?.trim()) {
      message.warning('相邻章节均无正文，无法合并');
      return;
    }
    setMerging(true);
    try {
      const result = await api.aiSuggestMerge({
        chapters: [chapter, nextChapter].map((c) => ({
          index: c.index,
          title: c.title,
          content: c.content || '',
        })),
        modelConfig: project.config.modelConfig,
      });
      if (result.success && result.data) {
        setMergeSourceIndices([chapter.index, nextChapter.index]);
        setMergeSuggestion(result.data);
      } else {
        message.error(result.error || 'AI 合并建议生成失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'AI 合并建议生成失败');
    } finally {
      setMerging(false);
    }
  };

  /** 接受拆分：当前章节 → N 个新章节 */
  const applySplit = (s: AISplitSuggestion) => {
    const outline = project.outline;
    if (!outline || !chapter) return;
    const count = Math.max(1, s.splitCount || s.titles.length || 2);
    const newChapters: ChapterOutline[] = [];
    for (let i = 0; i < count; i++) {
      const isFirst = i === 0;
      newChapters.push({
        index: 0,
        title: s.titles[i] || `第 ${chapterIndex + 1} 部分 ${i + 1}`,
        summary: s.summaries[i] || '',
        keyPlotPoints: s.keyPlotPoints?.[i] ?? [],
        characters: chapter.characters ?? [],
        scenes: chapter.scenes ?? [],
        targetWordCount: s.targetWordCounts?.[i] ?? Math.round(chapter.targetWordCount / count),
        // 原正文整体保留在第一个新章节，避免数据丢失；其余分片由流水线重新生成
        content: isFirst ? chapter.content : '',
        wordCount: isFirst ? chapter.wordCount : 0,
        status: ChapterStatus.PENDING,
        lastModified: Date.now(),
      });
    }
    const next = [
      ...chapters.slice(0, chapterIndex),
      ...newChapters,
      ...chapters.slice(chapterIndex + 1),
    ];
    patchProject(project.id, {
      outline: { ...outline, chapters: reindex(next) },
    });
    bumpChapterStructure();
    setSplitSuggestion(null);
    message.success(`已拆分为 ${count} 个章节，原正文保留在第 1 部分`);
  };

  /** 接受合并：相邻两章 → 一个合并章（正文按原顺序拼接保留） */
  const applyMerge = (s: AIMergeSuggestion) => {
    const outline = project.outline;
    if (!outline || !chapter || !nextChapter) return;
    const mergedContent = [chapter.content, nextChapter.content]
      .map((c) => (c || '').trim())
      .filter(Boolean)
      .join('\n\n');
    const merged: ChapterOutline = {
      index: 0,
      title: s.mergedTitle || `${chapter.title}·${nextChapter.title}`,
      summary: s.mergedSummary || '',
      keyPlotPoints: s.mergedKeyPlotPoints ?? [],
      characters: Array.from(new Set([...(chapter.characters ?? []), ...(nextChapter.characters ?? [])])),
      scenes: Array.from(new Set([...(chapter.scenes ?? []), ...(nextChapter.scenes ?? [])])),
      targetWordCount:
        s.mergedTargetWordCount > 0 ? s.mergedTargetWordCount : chapter.targetWordCount + nextChapter.targetWordCount,
      content: mergedContent,
      wordCount: mergedContent.length,
      status: ChapterStatus.PENDING,
      lastModified: Date.now(),
    };
    const mergeSet = new Set(mergeSourceIndices.length ? mergeSourceIndices : [chapterIndex, chapterIndex + 1]);
    const firstPos = chapterIndex;
    const next: ChapterOutline[] = [];
    for (let i = 0; i < chapters.length; i++) {
      if (mergeSet.has(i)) {
        if (i === firstPos) next.push(merged);
        // 其余被合并章节丢弃（内容已并入 merged）
      } else {
        next.push(chapters[i]);
      }
    }
    patchProject(project.id, {
      outline: { ...outline, chapters: reindex(next) },
    });
    bumpChapterStructure();
    setMergeSuggestion(null);
    message.success('已合并为一个章节，正文已拼接保留');
  };

  return (
    <>
      <Space size={8}>
        <InputNumber
          min={2}
          max={8}
          value={splitCount}
          onChange={(v) => setSplitCount(v ?? 2)}
          style={{ width: 64 }}
          size="small"
        />
        <Button
          size="small"
          icon={<ScissorOutlined />}
          loading={splitting}
          disabled={!chapter}
          onClick={handleSplit}
        >
          AI 拆分
        </Button>
        <Button
          size="small"
          icon={<MergeCellsOutlined />}
          loading={merging}
          disabled={!nextChapter}
          title={nextChapter ? `与下一章「${nextChapter.title}」合并` : '没有可合并的下一章'}
          onClick={handleMerge}
        >
          AI 合并
        </Button>
      </Space>

      {/* 拆分建议确认 */}
      <Modal
        title="AI 拆分建议"
        open={!!splitSuggestion}
        onCancel={() => setSplitSuggestion(null)}
        footer={
          <Space>
            <Button onClick={() => setSplitSuggestion(null)}>取消</Button>
            <Button type="primary" onClick={() => splitSuggestion && applySplit(splitSuggestion)}>
              接受拆分
            </Button>
          </Space>
        }
        width={560}
      >
        {splitSuggestion && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Tag color="cyan">置信度 {Math.round((splitSuggestion.confidence || 0) * 100)}%</Tag>
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                原正文将保留在第 1 部分，其余部分需经分片流水线重新生成
              </span>
            </div>
            <List
              size="small"
              bordered
              dataSource={Array.from({ length: Math.max(splitSuggestion.titles.length, splitSuggestion.splitCount || 0) }, (_, i) => i)}
              renderItem={(i) => (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {i + 1}. {splitSuggestion.titles[i] || `部分 ${i + 1}`}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: token.colorTextTertiary }}>
                        目标 {splitSuggestion.targetWordCounts?.[i] ?? '-'} 字
                      </span>
                    </div>
                    {splitSuggestion.summaries[i] && (
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2 }}>
                        {splitSuggestion.summaries[i]}
                      </div>
                    )}
                  </div>
                </List.Item>
              )}
            />
          </>
        )}
      </Modal>

      {/* 合并建议确认 */}
      <Modal
        title="AI 合并建议"
        open={!!mergeSuggestion}
        onCancel={() => setMergeSuggestion(null)}
        footer={
          <Space>
            <Button onClick={() => setMergeSuggestion(null)}>取消</Button>
            <Button type="primary" onClick={() => mergeSuggestion && applyMerge(mergeSuggestion)}>
              接受合并
            </Button>
          </Space>
        }
        width={560}
      >
        {mergeSuggestion && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Tag color="purple">置信度 {Math.round((mergeSuggestion.confidence || 0) * 100)}%</Tag>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {mergeSuggestion.mergedTitle}
            </div>
            <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
              目标 {mergeSuggestion.mergedTargetWordCount || '-'} 字
            </div>
            {mergeSuggestion.mergedSummary && (
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
                {mergeSuggestion.mergedSummary}
              </div>
            )}
            {(mergeSuggestion.mergedKeyPlotPoints || []).length > 0 && (
              <List
                size="small"
                bordered
                header="关键情节"
                dataSource={mergeSuggestion.mergedKeyPlotPoints}
                renderItem={(p) => <List.Item>{p}</List.Item>}
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

export default V2SplitMergeActions;
