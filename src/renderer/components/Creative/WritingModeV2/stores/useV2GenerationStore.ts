/**
 * V2 生成会话 store（瞬态状态）
 *
 * Spec: refactor-writing-mode-v2 / 架构规则 2（单一生成流水线）：
 * V2 只有 shard 分片流水线，状态机：
 *   IDLE → PLANNING(分片大纲) → STREAMING(分片内容) → INTEGRATING(合并) → DONE/ERROR
 *
 * 本 store 只保存"生成会话"瞬态（不持久化）；章节内容持久化走
 * useV2ProjectStore.patchProject + autoSaveChapter。
 */
import { create } from 'zustand';
import type { ShardOutline, ShardDetail } from '../../../../../shared/types/writing-v2.types';
import { ShardStatus } from '../../../../../shared/types/writing-v2.types';

export type V2PipelinePhase =
  | 'IDLE'
  | 'PLANNING'
  | 'STREAMING'
  | 'INTEGRATING'
  | 'DONE'
  | 'ERROR';

interface V2GenerationState {
  phase: V2PipelinePhase;
  error: string | null;
  /** 当前生成目标章节（null = 未开始） */
  activeChapterIndex: number | null;
  /** 分片大纲（PLANNING 产物，用户可编辑后进入 STREAMING） */
  shardOutlines: ShardOutline[];
  /** 分片详情（含状态/内容/确认标记） */
  shardDetails: ShardDetail[];
  /** 正在流式接收的分片索引（progress 事件实时拼接预览，complete 事件全量落定） */
  streamingShardIndex: number | null;

  setPhase: (phase: V2PipelinePhase, error?: string | null) => void;
  clearError: () => void;
  /** 进入 PLANNING 并绑定目标章节 */
  beginPlanning: (chapterIndex: number) => void;
  /** 分片大纲就绪（同时初始化全部分片为 PENDING） */
  setShards: (outlines: ShardOutline[]) => void;
  /** 用户编辑分片大纲字段（标题/简介/目标字数） */
  updateShardOutline: (index: number, patch: Partial<Pick<ShardOutline, 'title' | 'summary' | 'targetWordCount'>>) => void;
  /** 开始流式接收指定分片（同时清空旧内容，重新生成从空白开始） */
  beginStreamingShard: (index: number) => void;
  /** 流式增量追加到分片内容（progress 事件实时预览，complete 事件全量覆盖落定） */
  appendShardChunk: (index: number, chunk: string) => void;
  /** 思考流增量追加（reasoning 事件，思考模型正文前的思考过程实时展示） */
  appendShardReasoning: (index: number, chunk: string) => void;
  /** 分片流式完成，落定内容并标记 COMPLETED */
  completeShard: (index: number, fullContent: string) => void;
  /** 分片生成失败 */
  failShard: (index: number, message: string) => void;
  /** 用户直接编辑分片内容（手动覆盖/润色） */
  setShardContent: (index: number, content: string) => void;
  /** 确认/取消确认分片 */
  setShardConfirmed: (index: number, confirmed: boolean) => void;
  /** 合并完成 */
  markIntegrated: () => void;
  /** 章节切换或退出时清空会话 */
  resetChapter: () => void;
}

export const useV2GenerationStore = create<V2GenerationState>((set) => ({
  phase: 'IDLE',
  error: null,
  activeChapterIndex: null,
  shardOutlines: [],
  shardDetails: [],
  streamingShardIndex: null,

  setPhase: (phase, error = null) => set({ phase, error }),
  clearError: () => set({ error: null }),

  beginPlanning: (chapterIndex) =>
    set({
      phase: 'PLANNING',
      error: null,
      activeChapterIndex: chapterIndex,
      shardOutlines: [],
      shardDetails: [],
      streamingShardIndex: null,
    }),

  setShards: (outlines) => {
    const now = Date.now();
    const details: ShardDetail[] = outlines.map((o) => ({
      ...o,
      status: ShardStatus.PENDING,
      content: '',
      actualWordCount: 0,
      confirmed: false,
      updatedAt: now,
    }));
    set({ shardOutlines: outlines, shardDetails: details });
  },

  updateShardOutline: (index, patch) =>
    set((state) => {
      const outlines = state.shardOutlines.map((o, i) => (i === index ? { ...o, ...patch } : o));
      const details = state.shardDetails.map((d, i) =>
        i === index ? { ...d, ...patch, updatedAt: Date.now() } : d
      );
      return { shardOutlines: outlines, shardDetails: details };
    }),

  beginStreamingShard: (index) =>
    set((state) => ({
      phase: 'STREAMING',
      error: null,
      streamingShardIndex: index,
      shardDetails: state.shardDetails.map((d, i) =>
        i === index
          ? { ...d, status: ShardStatus.GENERATING, content: '', reasoning: '', actualWordCount: 0, updatedAt: Date.now() }
          : d
      ),
    })),

  appendShardChunk: (index, chunk) =>
    set((state) => ({
      shardDetails: state.shardDetails.map((d, i) =>
        i === index
          ? { ...d, content: d.content + chunk, actualWordCount: (d.content + chunk).length, updatedAt: Date.now() }
          : d
      ),
    })),

  appendShardReasoning: (index, chunk) =>
    set((state) => ({
      shardDetails: state.shardDetails.map((d, i) =>
        i === index ? { ...d, reasoning: (d.reasoning || '') + chunk, updatedAt: Date.now() } : d
      ),
    })),

  completeShard: (index, fullContent) =>
    set((state) => ({
      streamingShardIndex: null,
      shardDetails: state.shardDetails.map((d, i) =>
        i === index
          ? {
              ...d,
              status: ShardStatus.COMPLETED,
              content: fullContent,
              reasoning: '',
              actualWordCount: fullContent.length,
              updatedAt: Date.now(),
            }
          : d
      ),
    })),

  failShard: (index, message) =>
    set((state) => ({
      phase: 'ERROR',
      error: message,
      streamingShardIndex: null,
      shardDetails: state.shardDetails.map((d, i) =>
        i === index ? { ...d, status: ShardStatus.FAILED, updatedAt: Date.now() } : d
      ),
    })),

  setShardContent: (index, content) =>
    set((state) => ({
      shardDetails: state.shardDetails.map((d, i) =>
        i === index
          ? { ...d, content, actualWordCount: content.length, updatedAt: Date.now() }
          : d
      ),
    })),

  setShardConfirmed: (index, confirmed) =>
    set((state) => ({
      shardDetails: state.shardDetails.map((d, i) =>
        i === index ? { ...d, confirmed, updatedAt: Date.now() } : d
      ),
    })),

  markIntegrated: () => set({ phase: 'DONE' }),

  resetChapter: () =>
    set({
      phase: 'IDLE',
      error: null,
      activeChapterIndex: null,
      shardOutlines: [],
      shardDetails: [],
      streamingShardIndex: null,
    }),
}));
