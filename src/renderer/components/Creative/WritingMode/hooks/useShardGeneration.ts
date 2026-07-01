import { useCallback } from 'react';
import { message } from 'antd';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  ShardOutline,
  ShardStatus,
} from '../../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../../stores/writingModeStore';
import {
  ChapterGenerationSharedState,
  useBuildShardRequestCommon,
} from './useChapterGeneration.shared';

export interface UseShardGenerationResult {
  /** 生成分片大纲（非流式） */
  handleGenerateShardOutline: (
    chapterIndex: number,
    shardCount: number,
    userSuggestion?: string
  ) => Promise<void>;
  /** 生成单个分片内容（流式，复用 chunk 事件） */
  handleGenerateShard: (chapterIndex: number, shardIndex: number) => Promise<void>;
  /** 顺序生成所有未完成的分片 */
  handleGenerateAllShards: (chapterIndex: number) => Promise<void>;
  /** 确认分片内容，按唯一标记格式整合到章节内容面板 */
  confirmShardToIntegration: (chapterIndex: number, shardIndex: number) => void;
}

/**
 * 用户可控分片（shard）生成 hook。
 *
 * 负责生成分片大纲、单分片流式内容生成、批量顺序生成、以及将分片内容
 * 整合到章节正文面板。
 *
 * 行为保持：与原 useChapterGeneration 中的 shard 逻辑等价。复用 chunk
 * 流式事件，通过 isShardStreamRef 路由区分。
 */
export function useShardGeneration(
  shared: ChapterGenerationSharedState,
  outline: GeneratedOutline | null
): UseShardGenerationResult {
  const { projectId } = shared;
  const buildShardRequestCommon = useBuildShardRequestCommon(outline);

  /**
   * 生成分片大纲（非流式）
   */
  const handleGenerateShardOutline = useCallback(
    async (chapterIndex: number, shardCount: number, userSuggestion?: string): Promise<void> => {
      // 设置生成中状态：使主界面按钮组切换为"停止生成"，禁用"生成"按钮防止重复点击
      shared.stopRef.current = false;
      shared.setIsGenerating(true);
      shared.setGenerationState(GenerationState.GENERATING);
      shared.setSelectedChapterIndex(chapterIndex);
      shared.setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.GENERATING }));

      try {
        const common = buildShardRequestCommon(chapterIndex);
        if (!common) return;

        const { modelConfig, chapterInfo, generationParams, resources, generationGuidance } = common;

        if (!window.electronAPI?.writing?.generateShardOutline) {
          throw new Error('分片大纲生成 IPC 未就绪');
        }

        const request = {
          projectId,
          chapterIndex,
          shardCount,
          chapterInfo,
          resources,
          generationParams,
          modelConfig,
          userSuggestion: userSuggestion?.trim() || undefined,
          generationGuidance,
        };

        const result = await window.electronAPI.writing.generateShardOutline(request);

        // 用户已点击停止，放弃结果
        if (shared.stopRef.current) {
          message.info('已停止分片大纲生成');
          return;
        }

        if (result.success && result.data) {
          useWritingModeStore.getState().setShardOutlines(chapterIndex, result.data as ShardOutline[]);
          message.success(`已生成 ${result.data.length} 个分片大纲`);
        } else {
          message.error(result.error || '分片大纲生成失败');
        }
      } catch (error: unknown) {
        if (shared.stopRef.current) return; // stopped, silent
        console.error('[ChapterGeneration] 分片大纲生成失败:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(errMsg || '分片大纲生成失败');
      } finally {
        // 恢复状态：大纲生成不产生章节正文，章节状态恢复为 PENDING
        shared.setIsGenerating(false);
        shared.setGenerationState(shared.stopRef.current ? GenerationState.STOPPED : GenerationState.IDLE);
        shared.setChapterStatuses(prev => ({
          ...prev,
          [chapterIndex]:
            prev[chapterIndex] === ChapterStatus.GENERATING ? ChapterStatus.PENDING : prev[chapterIndex],
        }));
      }
    },
    [projectId, buildShardRequestCommon, shared]
  );

  /**
   * 生成单个分片内容（流式，复用 chunk 事件）
   * previousShardContents 为本章节所有已完成前置分片完整内容全量拼接（非滑动窗口）
   */
  const handleGenerateShard = useCallback(
    async (chapterIndex: number, shardIndex: number): Promise<void> => {
      try {
        const common = buildShardRequestCommon(chapterIndex);
        if (!common) return;

        const { modelConfig, chapterInfo, generationParams, resources, generationGuidance } = common;

        const shardOutlines = useWritingModeStore.getState().shardOutlines.get(chapterIndex);
        if (!shardOutlines || !shardOutlines[shardIndex]) {
          message.error('分片大纲不存在，请先生成分片大纲');
          return;
        }
        const shardOutline = shardOutlines[shardIndex];

        // 全量拼接所有已完成前置分片内容（非滑动窗口）
        const shardDetails = useWritingModeStore.getState().shardDetails.get(chapterIndex) || [];
        const previousShardContents = shardDetails
          .filter(d => d.index < shardIndex && d.status === ShardStatus.COMPLETED && d.content)
          .map(d => d.content)
          .join('\n\n');

        if (!window.electronAPI?.writing?.generateShardContent) {
          throw new Error('分片内容生成 IPC 未就绪');
        }

        // 设置事件路由标志
        shared.isShardStreamRef.current = true;
        shared.activeShardChapterRef.current = chapterIndex;
        shared.activeShardIndexRef.current = shardIndex;

        // 清空流式内容并设置生成状态
        shared.setStreamingContent('');
        shared.setSelectedChapterIndex(chapterIndex);

        useWritingModeStore.getState().updateShardStatus(chapterIndex, shardIndex, ShardStatus.GENERATING);

        const request = {
          projectId,
          chapterIndex,
          shardIndex,
          totalShards: shardOutlines.length,
          shardOutline,
          previousShardContents,
          chapterInfo,
          resources,
          generationParams,
          modelConfig,
          generationGuidance,
        };

        await window.electronAPI.writing.generateShardContent(request);

        // 轮询等待分片生成完成（参考现有 checkComplete 模式）
        await new Promise<void>(resolve => {
          const checkComplete = () => {
            const details = useWritingModeStore.getState().shardDetails.get(chapterIndex);
            if (details && details[shardIndex]?.status === ShardStatus.COMPLETED) {
              resolve();
            } else if (details && details[shardIndex]?.status === ShardStatus.FAILED) {
              resolve();
            } else {
              setTimeout(checkComplete, 500);
            }
          };
          checkComplete();
        });

        shared.isShardStreamRef.current = false;

        const details = useWritingModeStore.getState().shardDetails.get(chapterIndex);
        if (details && details[shardIndex]?.status === ShardStatus.COMPLETED) {
          message.success(`分片 ${shardIndex + 1} 生成完成`);
        }
      } catch (error: unknown) {
        shared.isShardStreamRef.current = false;
        console.error(`[ChapterGeneration] 分片 ${shardIndex} 生成失败:`, error);
        useWritingModeStore.getState().updateShardStatus(chapterIndex, shardIndex, ShardStatus.FAILED);
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(`分片 ${shardIndex + 1} 生成失败: ${errMsg}`);
      }
    },
    [projectId, buildShardRequestCommon, shared]
  );

  /**
   * 顺序生成所有未完成的分片
   */
  const handleGenerateAllShards = useCallback(
    async (chapterIndex: number): Promise<void> => {
      const shardOutlines = useWritingModeStore.getState().shardOutlines.get(chapterIndex);
      if (!shardOutlines || shardOutlines.length === 0) {
        message.warning('请先生成分片大纲');
        return;
      }

      for (let i = 0; i < shardOutlines.length; i++) {
        const details = useWritingModeStore.getState().shardDetails.get(chapterIndex);
        if (details && details[i]?.status === ShardStatus.COMPLETED) {
          continue;
        }
        await handleGenerateShard(chapterIndex, i);

        // 生成失败则中断连续生成
        const updatedDetails = useWritingModeStore.getState().shardDetails.get(chapterIndex);
        if (updatedDetails && updatedDetails[i]?.status !== ShardStatus.COMPLETED) {
          break;
        }
      }
    },
    [handleGenerateShard]
  );

  /**
   * 确认分片内容，按唯一标记格式整合到章节内容面板
   * 已有该分片标记块则正则替换覆盖，否则追加到末尾
   */
  const confirmShardToIntegration = useCallback(
    (chapterIndex: number, shardIndex: number): void => {
      const details = useWritingModeStore.getState().shardDetails.get(chapterIndex);
      if (!details || !details[shardIndex]) {
        message.warning('分片内容不存在');
        return;
      }
      const shard = details[shardIndex];
      if (!shard.content) {
        message.warning('分片内容为空，请先生成');
        return;
      }

      // 调用 store 的 confirmShardToIntegration 得到 marker
      const marker = useWritingModeStore
        .getState()
        .confirmShardToIntegration(chapterIndex, shardIndex, shard.summary);

      // 构造唯一标记格式分片块
      const shardBlock = `<!-- SHARD:${shardIndex} -->\n## 分片 ${shardIndex + 1}：${marker.summary}\n\n${shard.content}\n\n<!-- /SHARD:${shardIndex} -->`;

      // 读取当前章节内容，正则覆盖或追加
      const currentContent = shared.chapterContents[chapterIndex] || '';
      const regex = new RegExp(`<!-- SHARD:${shardIndex} -->[\\s\\S]*?<!-- /SHARD:${shardIndex} -->`, 'g');
      let newContent: string;
      if (regex.test(currentContent)) {
        newContent = currentContent.replace(regex, shardBlock);
      } else {
        newContent = currentContent ? `${currentContent}\n\n${shardBlock}` : shardBlock;
      }

      // 更新章节内容面板
      shared.setChapterContents(prev => ({ ...prev, [chapterIndex]: newContent }));
      shared.editorContentRef.current = newContent;

      // 保存到项目（参考 handleEditorChange 的保存机制）
      const project = shared.currentProjectRef.current;
      if (project && project.outline && outline) {
        const currentChapter = outline.chapters.find(ch => ch.index === chapterIndex);
        if (currentChapter) {
          shared.updateProject(project.id, {
            outline: {
              ...project.outline,
              chapters: project.outline.chapters.map(ch =>
                ch.index === chapterIndex
                  ? { ...ch, content: newContent, lastModified: Date.now() }
                  : ch
              ),
            },
          });
          shared.saveProject();
        }
      }

      message.success(`分片 ${shardIndex + 1} 已确认整合到章节内容`);
    },
    [outline, shared]
  );

  return {
    handleGenerateShardOutline,
    handleGenerateShard,
    handleGenerateAllShards,
    confirmShardToIntegration,
  };
}
