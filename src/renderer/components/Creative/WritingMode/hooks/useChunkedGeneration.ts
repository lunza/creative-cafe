import { useCallback } from 'react';
import { message } from 'antd';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  ChapterChunk,
  ChunkStatus,
  GenerationProgress,
} from '../../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../../stores/writingModeStore';
import {
  ChapterGenerationSharedState,
  buildSlidingWindowContext,
  readModelConfigFromStore,
  readProjectGenerationContext,
  persistMergedChapterContent,
} from './useChapterGeneration.shared';

export interface UseChunkedGenerationResult {
  /** 规划章节分片 */
  planChapterChunks: (chapterIndex: number, targetWordCount: number) => ChapterChunk[];
  /** 分片生成章节 */
  handleGenerateChapterChunked: (chapterIndex: number, userSuggestion?: string) => Promise<void>;
  /** 重新生成指定分片 */
  handleRegenerateChunk: (chunkIndex: number) => Promise<void>;
}

/**
 * 分片生成 hook。
 *
 * 负责按模型 max_tokens 限制将章节拆分为多个 chunk，逐个流式生成，并在
 * 完成后合并为完整章节内容。包含分片重生成能力。
 *
 * 行为保持：与原 useChapterGeneration 中的 chunked 逻辑等价。
 */
export function useChunkedGeneration(
  shared: ChapterGenerationSharedState,
  outline: GeneratedOutline | null
): UseChunkedGenerationResult {
  const { projectId } = shared;

  /**
   * 规划章节分片：根据目标字数和模型输出限制，将章节拆分为多个分片。
   * 使用后端 ChapterChunkService 的策略计算，确保与模型能力匹配。
   */
  const planChapterChunks = useCallback(
    (chapterIndex: number, targetWordCount: number): ChapterChunk[] => {
      const modelConfig = readModelConfigFromStore();
      const modelLimit = modelConfig.maxTokens || 32768;

      // 使用后端策略计算：模型限制的 90% 作为有效限制，70% 作为分片大小
      const effectiveLimit = Math.floor(modelLimit * 0.9);
      const chunkSize = Math.floor(effectiveLimit * 0.7);
      const chunkCount = Math.max(1, Math.ceil(targetWordCount / chunkSize));

      const chunks: ChapterChunk[] = [];
      for (let i = 0; i < chunkCount; i++) {
        chunks.push({
          id: `chunk-${chapterIndex}-${i}-${Date.now()}`,
          index: i,
          status: ChunkStatus.PENDING,
          targetWordCount:
            i === chunkCount - 1
              ? targetWordCount - (chunkCount - 1) * chunkSize // 最后一个分片处理剩余字数
              : chunkSize,
          actualWordCount: 0,
          content: '',
          summary: '',
          checkpoint: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      return chunks;
    },
    []
  );

  /**
   * 分片生成章节：将章节拆分为多个分片，逐个生成
   */
  const handleGenerateChapterChunked = useCallback(
    async (chapterIndex: number, userSuggestion?: string) => {
      if (!outline) return;

      const chapter = outline.chapters.find(ch => ch.index === chapterIndex);
      if (!chapter) return;

      const targetWordCount = chapter.targetWordCount || 2000;

      // 1. 规划分片
      const chunks = planChapterChunks(chapterIndex, targetWordCount);

      // 2. 初始化 writingModeStore 中的分片状态
      useWritingModeStore.getState().initializeChunks(chapterIndex, chunks);
      useWritingModeStore.getState().setIsChunking(chapterIndex, true);

      // 3. 初始化生成进度
      const progress: GenerationProgress = {
        totalWords: targetWordCount,
        completedWords: 0,
        currentChunkIndex: 0,
        totalChunks: chunks.length,
        completedChunks: 0,
        estimatedTimeRemaining: 0,
      };
      useWritingModeStore.getState().setGenerationProgress(chapterIndex, progress);

      // 4. 设置生成状态
      shared.stopRef.current = false;
      shared.setIsGenerating(true);
      shared.setGenerationState(GenerationState.GENERATING);
      shared.setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.GENERATING }));
      shared.setStreamingContent('');
      shared.setCurrentChapterWords(0);
      shared.setSelectedChapterIndex(chapterIndex);

      // 5. 逐个生成分片
      const startTime = Date.now();
      for (let i = 0; i < chunks.length; i++) {
        if (shared.stopRef.current) {
          // 保存 checkpoint 到磁盘（持久化）
          const currentChunkContent =
            useWritingModeStore.getState().chapterChunks.get(chapterIndex)?.[i]?.content || '';
          if (currentChunkContent && window.electronAPI?.writing?.saveChunkCheckpoint) {
            try {
              await window.electronAPI.writing.saveChunkCheckpoint({
                projectId,
                chapterIndex,
                chunkIndex: i,
                content: currentChunkContent,
              });
            } catch (error) {
              console.error('[ChapterGeneration] 持久化 checkpoint 失败:', error);
            }
          }
          // 同时更新 store 内存状态
          useWritingModeStore.getState().saveChunkCheckpoint(chapterIndex, i, currentChunkContent);
          break;
        }

        // 更新当前分片状态为 GENERATING
        useWritingModeStore.getState().updateChunkStatus(chapterIndex, i, ChunkStatus.GENERATING);

        try {
          // 构建分片生成请求
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

          // 调用分片生成 IPC
          if (!window.electronAPI?.writing?.generateChapterChunk) {
            throw new Error('分片生成 IPC 未就绪');
          }

          await window.electronAPI.writing.generateChapterChunk(request);

          // 等待分片生成完成（通过事件监听更新状态）
          await new Promise<void>(resolve => {
            const checkComplete = () => {
              const currentChunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex);
              if (currentChunks && currentChunks[i]?.status === ChunkStatus.COMPLETED) {
                resolve();
              } else if (currentChunks && currentChunks[i]?.status === ChunkStatus.FAILED) {
                resolve(); // 失败也继续
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
            totalWords: targetWordCount,
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

      // 6. 生成完成：合并分片
      if (!shared.stopRef.current) {
        const mergedContent = useWritingModeStore.getState().mergeChunksToChapter(chapterIndex);
        if (mergedContent) {
          await persistMergedChapterContent(shared, chapterIndex, mergedContent, {
            setStatus: ChapterStatus.GENERATED,
          });
          message.success(`第 ${chapterIndex + 1} 章生成完成（分片模式）`);
        }
      }

      // 7. 清理状态
      shared.setIsGenerating(false);
      shared.setGenerationState(
        shared.stopRef.current ? GenerationState.STOPPED : GenerationState.COMPLETED
      );
      useWritingModeStore.getState().setIsChunking(chapterIndex, false);
    },
    [outline, projectId, planChapterChunks, shared]
  );

  // 重新生成指定分片
  const handleRegenerateChunk = useCallback(
    async (chunkIndex: number) => {
      const chapterIndex = shared.selectedChapterIndex;
      const chunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex);
      if (!chunks || !chunks[chunkIndex]) {
        message.error('分片不存在');
        return;
      }

      // 重新生成单个分片
      const chapter = outline?.chapters.find(ch => ch.index === chapterIndex);
      if (!chapter) return;

      try {
        const modelConfig = readModelConfigFromStore();
        const { novelType, writingStyle, perspective, resources } = readProjectGenerationContext();

        // 使用滑动窗口上下文管理
        const previousChunksContent = buildSlidingWindowContext(chunks, chunkIndex);

        const request = {
          projectId,
          chapterIndex,
          chunkIndex,
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
            targetWordCount: chunks[chunkIndex].targetWordCount,
            style: writingStyle,
            perspective: perspective,
            novelType,
            constraints: [],
          },
          modelConfig,
          resources,
          previousChunkContent: previousChunksContent || undefined,
          generationGuidance: chapter.generationGuidance?.trim() || undefined,
        };

        // 重置分片状态
        useWritingModeStore.getState().updateChunkStatus(chapterIndex, chunkIndex, ChunkStatus.GENERATING);

        // 调用分片生成 IPC
        if (!window.electronAPI?.writing?.generateChapterChunk) {
          throw new Error('分片生成 IPC 未就绪');
        }

        await window.electronAPI.writing.generateChapterChunk(request);

        // 等待分片生成完成
        await new Promise<void>(resolve => {
          const checkComplete = () => {
            const currentChunks = useWritingModeStore.getState().chapterChunks.get(chapterIndex);
            if (currentChunks && currentChunks[chunkIndex]?.status === ChunkStatus.COMPLETED) {
              resolve();
            } else if (currentChunks && currentChunks[chunkIndex]?.status === ChunkStatus.FAILED) {
              resolve();
            } else {
              setTimeout(checkComplete, 500);
            }
          };
          checkComplete();
        });

        // 重新合并分片
        const mergedContent = useWritingModeStore.getState().mergeChunksToChapter(chapterIndex);
        if (mergedContent) {
          shared.setChapterContents(prev => ({ ...prev, [chapterIndex]: mergedContent }));

          // 保存到项目（不修改 status）
          const currentProject = shared.currentProjectRef.current;
          if (currentProject && currentProject.outline) {
            shared.updateProject(currentProject.id, {
              outline: {
                ...currentProject.outline,
                chapters: currentProject.outline.chapters.map(ch =>
                  ch.index === chapterIndex
                    ? { ...ch, content: mergedContent, lastModified: Date.now() }
                    : ch
                ),
              },
            });
            shared.saveProject();
          }

          // 自动保存
          setTimeout(async () => {
            try {
              if (window.electronAPI?.writing?.autoSaveChapter) {
                await window.electronAPI.writing.autoSaveChapter({
                  projectId,
                  chapterIndex,
                  content: mergedContent,
                });
              }
            } catch (error) {
              console.error('[ChapterGeneration] 自动保存失败:', error);
            }
          }, 500);

          message.success(`分片 ${chunkIndex + 1} 重新生成完成`);
        }
      } catch (error: unknown) {
        console.error(`[ChapterGeneration] 分片 ${chunkIndex} 重新生成失败:`, error);
        useWritingModeStore.getState().updateChunkStatus(chapterIndex, chunkIndex, ChunkStatus.FAILED);
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(`分片 ${chunkIndex + 1} 重新生成失败: ${errMsg}`);
      }
    },
    [outline, projectId, shared]
  );

  return {
    planChapterChunks,
    handleGenerateChapterChunked,
    handleRegenerateChunk,
  };
}
