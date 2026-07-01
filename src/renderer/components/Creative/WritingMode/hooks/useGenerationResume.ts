import { useCallback } from 'react';
import { message } from 'antd';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  ChapterChunk,
  ChunkStatus,
} from '../../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../../stores/writingModeStore';
import {
  ChapterGenerationSharedState,
  buildSlidingWindowContext,
  readModelConfigFromStore,
  readProjectGenerationContext,
  persistMergedChapterContent,
} from './useChapterGeneration.shared';

export interface UseGenerationResumeResult {
  /** 从磁盘加载分片 checkpoint 恢复分片状态 */
  loadChunksFromDisk: (chapterIndex: number, totalChunks: number) => Promise<ChapterChunk[]>;
  /** 检测章节是否有未完成的分片，返回应该继续的分片索引 */
  getResumePoint: (chapterIndex: number) => Promise<number | null>;
  /** 从断点继续生成 */
  handleResumeGeneration: (chapterIndex: number, userSuggestion?: string) => Promise<void>;
}

/**
 * 分片断点续传 hook。
 *
 * 负责从磁盘 checkpoint 恢复分片状态、定位续传起点、从指定分片继续流式生成
 * 直至完成，最终合并为完整章节内容。
 *
 * 行为保持：与原 useChapterGeneration 中的 resume 逻辑等价。
 */
export function useGenerationResume(
  shared: ChapterGenerationSharedState,
  outline: GeneratedOutline | null
): UseGenerationResumeResult {
  const { projectId } = shared;

  // 从磁盘加载分片 checkpoint 恢复分片状态
  const loadChunksFromDisk = useCallback(
    async (chapterIndex: number, totalChunks: number): Promise<ChapterChunk[]> => {
      const chunks: ChapterChunk[] = [];

      for (let i = 0; i < totalChunks; i++) {
        try {
          const content = await window.electronAPI?.writing?.getChunkCheckpoint?.(projectId, chapterIndex, i);

          if (content) {
            // 从磁盘恢复的分片标记为已完成
            chunks.push({
              id: `chunk-${chapterIndex}-${i}-restored`,
              index: i,
              status: ChunkStatus.COMPLETED,
              targetWordCount: content.length, // 使用实际内容长度作为目标
              actualWordCount: content.length,
              content,
              summary: '', // 摘要需要重新生成
              checkpoint: content.substring(Math.max(0, content.length - 200)),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          } else {
            // 磁盘上没有该分片，标记为待生成
            chunks.push({
              id: `chunk-${chapterIndex}-${i}-pending`,
              index: i,
              status: ChunkStatus.PENDING,
              targetWordCount: 0, // 稍后由 planChapterChunks 计算
              actualWordCount: 0,
              content: '',
              summary: '',
              checkpoint: '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        } catch (error) {
          console.error(`[ChapterGeneration] 加载分片 ${i} checkpoint 失败:`, error);
          chunks.push({
            id: `chunk-${chapterIndex}-${i}-error`,
            index: i,
            status: ChunkStatus.PENDING,
            targetWordCount: 0,
            actualWordCount: 0,
            content: '',
            summary: '',
            checkpoint: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }

      return chunks;
    },
    [projectId]
  );

  // 检测章节是否有未完成的分片，返回应该继续的分片索引
  const getResumePoint = useCallback(
    async (chapterIndex: number): Promise<number | null> => {
      let chunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex);

      // 如果 store 中没有分片数据，尝试从磁盘加载
      if (!chunks || chunks.length === 0) {
        // 先尝试探测磁盘上有多少个分片（通过尝试加载前 20 个）
        const probeChunks = await loadChunksFromDisk(chapterIndex, 20);
        const restoredChunks = probeChunks.filter(c => c.status === ChunkStatus.COMPLETED);

        if (restoredChunks.length > 0) {
          // 将恢复的分片存入 store
          useWritingModeStore.getState().initializeChunks(chapterIndex, probeChunks);
          chunks = probeChunks;
        } else {
          return null;
        }
      }

      if (!chunks || chunks.length === 0) return null;

      // 查找第一个未完成或未完全完成的分片
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.status === ChunkStatus.PENDING || chunk.status === ChunkStatus.FAILED) {
          return i;
        }
        if (chunk.status === ChunkStatus.GENERATING) {
          // 如果之前正在生成但中断了，从该分片重新开始
          return i;
        }
        if (chunk.status === ChunkStatus.COMPLETED && chunk.actualWordCount < chunk.targetWordCount * 0.9) {
          // 如果完成但字数不足目标的 90%，认为需要重新生成
          return i;
        }
      }

      // 所有分片都已完成
      return null;
    },
    [loadChunksFromDisk]
  );

  // 从断点继续生成
  const handleResumeGeneration = useCallback(
    async (chapterIndex: number, userSuggestion?: string) => {
      const resumePoint = await getResumePoint(chapterIndex);
      if (resumePoint === null) {
        message.info('所有章节已生成完成');
        return;
      }

      const chapter = outline?.chapters.find(ch => ch.index === chapterIndex);
      if (!chapter) return;

      const chunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex);
      if (!chunks) return;

      message.info(`从分片 ${resumePoint + 1} 继续生成`);

      // 设置生成状态
      shared.stopRef.current = false;
      shared.setIsGenerating(true);
      shared.setGenerationState(GenerationState.GENERATING);
      shared.setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.GENERATING }));
      shared.setStreamingContent('');
      shared.setCurrentChapterWords(0);
      shared.setSelectedChapterIndex(chapterIndex);
      useWritingModeStore.getState().setIsChunking(chapterIndex, true);

      // 从断点继续生成
      const startTime = Date.now();
      for (let i = resumePoint; i < chunks.length; i++) {
        if (shared.stopRef.current) {
          const currentChunkContent =
            useWritingModeStore.getState().chapterChunks.get(chapterIndex)?.[i]?.content || '';
          useWritingModeStore.getState().saveChunkCheckpoint(chapterIndex, i, currentChunkContent);
          break;
        }

        // 更新当前分片状态为 GENERATING
        useWritingModeStore.getState().updateChunkStatus(chapterIndex, i, ChunkStatus.GENERATING);

        try {
          const modelConfig = readModelConfigFromStore();
          const { novelType, writingStyle, perspective, resources } = readProjectGenerationContext();

          // 使用滑动窗口上下文管理：从 store 获取当前最新的分片状态
          const currentChunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex) || chunks;
          const previousChunksContent = buildSlidingWindowContext(currentChunks, i);

          const request = {
            projectId,
            chapterIndex,
            chunkIndex: i,
            totalChunks: chunks.length,
            chapterInfo: {
              index: chapter.index,
              title: chapter.title,
              outline: chapter.summary,
              characters: chapter.characters || [],
              scenes: chapter.scenes || [],
            },
            previousChapters: [],
            worldBookContext: [],
            characterContext: [],
            generationParams: {
              targetWordCount: chunks[i].targetWordCount,
              style: writingStyle,
              perspective: perspective,
              novelType,
              constraints: [],
            },
            modelConfig,
            resources,
            userSuggestion: userSuggestion?.trim() || undefined,
            previousChunkContent: previousChunksContent || undefined,
            generationGuidance: chapter.generationGuidance?.trim() || undefined,
          };

          if (!window.electronAPI?.writing?.generateChapterChunk) {
            throw new Error('分片生成 IPC 未就绪');
          }

          await window.electronAPI.writing.generateChapterChunk(request);

          // 等待分片生成完成
          await new Promise<void>(resolve => {
            const checkComplete = () => {
              const currentChunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex);
              if (currentChunks && currentChunks[i]?.status === ChunkStatus.COMPLETED) {
                resolve();
              } else if (currentChunks && currentChunks[i]?.status === ChunkStatus.FAILED) {
                resolve();
              } else {
                setTimeout(checkComplete, 500);
              }
            };
            checkComplete();
          });

          // 更新进度
          const completedChunks =
            useWritingModeStore
              .getState()
              .chapterChunks.get(chapterIndex)
              ?.filter(c => c.status === ChunkStatus.COMPLETED).length || 0;
          const completedWords =
            useWritingModeStore
              .getState()
              .chapterChunks.get(chapterIndex)
              ?.reduce((sum, c) => sum + c.actualWordCount, 0) || 0;
          const elapsed = Date.now() - startTime;
          const estimatedTimeRemaining =
            completedChunks > 0 ? (elapsed / completedChunks) * (chunks.length - completedChunks) / 1000 : 0;

          useWritingModeStore.getState().setGenerationProgress(chapterIndex, {
            totalWords: chapter.targetWordCount || 2000,
            completedWords,
            currentChunkIndex: i,
            totalChunks: chunks.length,
            completedChunks,
            estimatedTimeRemaining,
          });
        } catch (error: unknown) {
          console.error(`[ChapterGeneration] 分片 ${i} 生成失败:`, error);
          useWritingModeStore.getState().updateChunkStatus(chapterIndex, i, ChunkStatus.FAILED);
          const errMsg = error instanceof Error ? error.message : String(error);
          message.error(`分片 ${i + 1} 生成失败: ${errMsg}`);
          break;
        }
      }

      // 生成完成：合并分片
      if (!shared.stopRef.current) {
        const mergedContent = useWritingModeStore.getState().mergeChunksToChapter(chapterIndex);
        if (mergedContent) {
          await persistMergedChapterContent(shared, chapterIndex, mergedContent, {
            setStatus: ChapterStatus.GENERATED,
          });
          message.success(`第 ${chapterIndex + 1} 章生成完成（断点续传）`);
        }
      }

      shared.setIsGenerating(false);
      shared.setGenerationState(
        shared.stopRef.current ? GenerationState.STOPPED : GenerationState.COMPLETED
      );
      useWritingModeStore.getState().setIsChunking(chapterIndex, false);
    },
    [outline, projectId, getResumePoint, shared]
  );

  return {
    loadChunksFromDisk,
    getResumePoint,
    handleResumeGeneration,
  };
}
