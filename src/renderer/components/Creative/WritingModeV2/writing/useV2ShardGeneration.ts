/**
 * V2 分片生成流水线 hook（Phase 1 / P0）
 *
 * 单一流水线（架构规则 2）：
 *   PLANNING: generateShardOutline → 分片大纲（可编辑/确认）
 *   STREAMING: generateShard → 流式事件（onShardStream*，chunkIndex = shardIndex）
 *   INTEGRATING: mergeToChapter → 合并已确认分片到章节正文并落盘
 */
import { useCallback, useEffect, useRef } from 'react';
import type {
  WritingProject,
  ChapterOutline,
} from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2GenerationStore } from '../stores/useV2GenerationStore';

interface UseV2ShardGenerationParams {
  project: WritingProject;
  /** 可能为 undefined（项目无章节时工作台渲染空态），回调内做空值守卫 */
  chapter?: ChapterOutline;
}

/**
 * 章节范围识别守卫（2026-10-08 修复"AI生成本章写出全书"的入口防线）：
 * 当前章节没有大纲时，生成 prompt 的「章节大纲」为空，模型失去剧情边界会自由发挥
 * （漫画项目实测：生成第一章却写出第一至第五章全部内容）。此时禁止发起生成。
 * 纯函数，可单测。
 */
export function chapterOutlineMissing(
  chapter: { summary?: string } | undefined | null
): string | null {
  if (!chapter) return '当前章节不存在';
  if (!chapter.summary || !chapter.summary.trim()) {
    return '当前章节没有大纲，无法限定生成范围（会写出整书剧情），请先在大纲中填写本章剧情再生成';
  }
  return null;
}

export function useV2ShardGeneration({ project, chapter }: UseV2ShardGenerationParams) {
  const store = useV2GenerationStore;

  const unsubscribersRef = useRef<Array<() => void>>([]);

  // 订阅分片流式事件（挂载一次；按当前会话章节/分片过滤）
  useEffect(() => {
    const api = getWritingV2API();
    if (!api) return;
    const subs: Array<() => void> = [
      api.onShardStreamStart((e) => {
        const s = store.getState();
        if (e.projectId !== project.id || e.chapterIndex !== s.activeChapterIndex) return;
        s.beginStreamingShard(e.chunkIndex);
      }),
      // 流式增量：实时拼接到分片内容，让用户在生成过程中就能看到并评价文本
      api.onShardStreamProgress((e) => {
        const s = store.getState();
        if (e.projectId !== project.id || e.chapterIndex !== s.activeChapterIndex) return;
        if (e.chunk) s.appendShardChunk(e.chunkIndex, e.chunk);
      }),
      // 思考流：思考模型正文前的 reasoning_content 实时透出，避免长时间"只转圈无输出"
      api.onShardStreamReasoning((e) => {
        const s = store.getState();
        if (e.projectId !== project.id || e.chapterIndex !== s.activeChapterIndex) return;
        if (e.chunk) s.appendShardReasoning(e.chunkIndex, e.chunk);
      }),
      api.onShardStreamComplete((e) => {
        const s = store.getState();
        if (e.projectId !== project.id || e.chapterIndex !== s.activeChapterIndex) return;
        s.completeShard(e.chunkIndex, e.content);
      }),
      api.onShardStreamError((e) => {
        const s = store.getState();
        if (e.projectId !== project.id || e.chapterIndex !== s.activeChapterIndex) return;
        s.failShard(e.chunkIndex, e.error?.message || '分片生成失败');
      }),
    ];
    unsubscribersRef.current = subs;
    return () => {
      subs.forEach((unsub) => unsub());
      unsubscribersRef.current = [];
    };
  }, [project.id]);

  /** 生成分片大纲（进入 PLANNING）；customPrompt 为用户自定义提示词（可选，最高优先级） */
  const planShards = useCallback(
    async (shardCount: number, customPrompt?: string) => {
      const api = getWritingV2API();
      if (!api || !chapter) return false;
      // 章节范围识别守卫：无大纲 → 无边界 → 禁止生成（防 AI 自由发挥出整书剧情）
      const outlineError = chapterOutlineMissing(chapter);
      if (outlineError) {
        store.getState().failShard(0, outlineError);
        return false;
      }
      const s = store.getState();
      s.beginPlanning(chapter.index);
      try {
        const result = await api.generateShardOutline({
          projectId: project.id,
          chapterIndex: chapter.index,
          shardCount,
          chapterInfo: {
            index: chapter.index,
            title: chapter.title,
            outline: chapter.summary,
            characters: chapter.characters || [],
            scenes: chapter.scenes || [],
          },
          resources: project.config.resources,
          generationParams: {
            targetWordCount: chapter.targetWordCount,
            style: project.config.parameters.writingStyle || '',
            perspective: project.config.parameters.narrativePerspective,
            novelType: project.config.parameters.novelType,
          },
          modelConfig: project.config.modelConfig,
          ...(customPrompt ? { customPrompt } : {}),
        });
        // IPC 通道实际返回 { success, data }（与 V1 共用 handler，V1 读 data）；
        // 类型里的 shards 是服务层字段名，这里兼容两种形状，否则成功也永远走失败分支
        const shards = result.data ?? result.shards;
        if (result.success && shards?.length) {
          store.getState().setShards(shards);
          return true;
        }
        store.getState().failShard(0, result.error || '分片大纲生成失败');
        return false;
      } catch (err) {
        store.getState().failShard(0, err instanceof Error ? err.message : '分片大纲生成失败');
        return false;
      }
    },
    [project, chapter]
  );

  /** 生成/重新生成指定分片内容（STREAMING）；customPrompt 为用户自定义提示词（可选，最高优先级） */
  const generateShard = useCallback(
    async (shardIndex: number, customPrompt?: string) => {
      const api = getWritingV2API();
      if (!api || !chapter) return;
      const s = store.getState();
      if (!s.shardOutlines[shardIndex]) return;
      s.beginStreamingShard(shardIndex);
      // 前置分片内容拼接（作为上下文）
      const previous = s.shardDetails
        .filter((d, i) => i < shardIndex && d.content)
        .map((d) => d.content)
        .join('\n\n');
      try {
        const result = await api.generateShardContent({
          projectId: project.id,
          chapterIndex: chapter.index,
          shardIndex,
          totalShards: s.shardOutlines.length,
          shardOutline: s.shardOutlines[shardIndex],
          previousShardContents: previous,
          chapterInfo: {
            index: chapter.index,
            title: chapter.title,
            outline: chapter.summary,
            characters: chapter.characters || [],
            scenes: chapter.scenes || [],
          },
          resources: project.config.resources,
          generationParams: {
            targetWordCount: s.shardOutlines[shardIndex].targetWordCount,
            style: project.config.parameters.writingStyle || '',
            perspective: project.config.parameters.narrativePerspective,
            novelType: project.config.parameters.novelType,
          },
          modelConfig: project.config.modelConfig,
          ...(customPrompt ? { customPrompt } : {}),
        });
        if (!result.success) {
          store.getState().failShard(shardIndex, result.error || '分片内容生成失败');
        }
      } catch (err) {
        store.getState().failShard(shardIndex, err instanceof Error ? err.message : '分片内容生成失败');
      }
    },
    [project, chapter]
  );

  /** 将有内容的分片合并进章节正文并落盘，返回合并后的全文（无内容时返回 null） */
  const mergeToChapter = useCallback(async (): Promise<string | null> => {
    const api = getWritingV2API();
    if (!api || !chapter) return null;
    const s = store.getState();
    const parts = s.shardDetails
      .filter((d) => d.content && d.content.trim())
      .map((d) => d.content.trim());
    if (parts.length === 0) return null;
    const merged = parts.join('\n\n');
    store.getState().setPhase('INTEGRATING');
    await api.autoSaveChapter({
      projectId: project.id,
      chapterIndex: chapter.index,
      content: merged,
    });
    store.getState().markIntegrated();
    return merged;
  }, [project, chapter]);

  /** 取消当前项目的所有生成 */
  const cancel = useCallback(async () => {
    const api = getWritingV2API();
    if (!api) return;
    await api.cancelGeneration(project.id);
    store.getState().resetChapter();
  }, [project.id]);

  return { planShards, generateShard, mergeToChapter, cancel };
}
