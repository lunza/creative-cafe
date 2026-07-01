import { useCallback } from 'react';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  WritingProject,
  RegenerationSuggestion,
  ChapterChunk,
  ChunkStatus,
  ShardStatus,
  ChapterInfo,
  ModelConfig,
  WritingResourceConfig,
} from '../../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';
import { useSettingStore } from '../../../../stores/settingStore';
import type { AIEngineSetting } from '../../../../types/setting';

/**
 * 共享状态：由编排层 useChapterGeneration 创建并向下传递给各子 hook。
 *
 * 设计说明：
 * - 状态 setter 与 ref 在编排层统一管理，避免子 hook 各自维护造成不一致。
 * - 子 hook 通过此对象读写共享状态，不再自行 useState/useRef。
 */
export interface ChapterGenerationSharedState {
  outline: GeneratedOutline | null;
  projectId: string;

  // React state setters
  setIsGenerating: (v: boolean) => void;
  setGenerationState: (s: GenerationState) => void;
  setChapterStatuses: React.Dispatch<React.SetStateAction<Record<number, ChapterStatus>>>;
  setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  setCurrentChapterWords: React.Dispatch<React.SetStateAction<number>>;
  setSelectedChapterIndex: (i: number) => void;
  /** 当前选中的章节索引（同步读取，供子 hook 使用） */
  selectedChapterIndex: number;
  /** 当前章节内容快照（同步读取，供子 hook 使用） */
  chapterContents: Record<number, string>;

  // Refs（子 hook 需要读写）
  stopRef: React.MutableRefObject<boolean>;
  currentProjectRef: React.MutableRefObject<WritingProject | null>;
  editorContentRef: React.MutableRefObject<string>;

  // 分片流式事件路由 refs（shard 生成复用 chunk 事件，需要区分）
  isShardStreamRef: React.MutableRefObject<boolean>;
  activeShardChapterRef: React.MutableRefObject<number>;
  activeShardIndexRef: React.MutableRefObject<number>;

  // 重新生成相关 refs（单章生成会读取）
  regenerationSuggestionRef: React.MutableRefObject<RegenerationSuggestion | undefined>;
  regenerationPreviousContentRef: React.MutableRefObject<string>;

  // store actions
  updateProject: ReturnType<typeof useWritingProjectStore.getState>['updateProject'];
  saveProject: ReturnType<typeof useWritingProjectStore.getState>['saveProject'];
}

/**
 * 滑动窗口上下文构建：从已完成的分片中提取上下文。
 *
 * 策略：
 * - 取上一分片的末尾 TAIL_CONTENT_SIZE 字符作为精确衔接上下文
 * - 更早的分片只保留摘要，从近到远累加，超出 CONTEXT_WINDOW_SIZE 则截断
 */
export const buildSlidingWindowContext = (
  chunks: ChapterChunk[],
  currentIndex: number
): string => {
  if (currentIndex === 0 || chunks.length === 0) return '';

  const CONTEXT_WINDOW_SIZE = 4000; // 上下文窗口大小（字符数）
  const TAIL_CONTENT_SIZE = 1500; // 最近分片保留的末尾内容大小

  const parts: string[] = [];
  let usedChars = 0;

  // 获取最近 1 个分片的末尾内容（用于精确衔接）
  const lastChunk = chunks[currentIndex - 1];
  if (lastChunk && lastChunk.content) {
    const tailContent = lastChunk.content.substring(
      Math.max(0, lastChunk.content.length - TAIL_CONTENT_SIZE)
    );
    if (tailContent) {
      parts.unshift(`[前一分片末尾内容]\n${tailContent}`);
      usedChars += tailContent.length;
    }
  }

  // 更早的分片：只保留摘要，从近到远
  for (let i = currentIndex - 2; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk.summary) {
      const summaryText = `[分片 ${chunk.index + 1} 摘要]\n${chunk.summary}`;
      if (usedChars + summaryText.length <= CONTEXT_WINDOW_SIZE) {
        parts.unshift(summaryText);
        usedChars += summaryText.length;
      } else {
        break; // 超出上下文窗口，不再添加更早的摘要
      }
    }
  }

  return parts.join('\n\n');
};

/**
 * 组装分片/shard 请求的公共字段（modelConfig、currentProject、projectResources、chapterInfo、generationParams）。
 *
 * 抽取自原 useChapterGeneration.buildShardRequestCommon，逻辑不变。
 */
export const useBuildShardRequestCommon = (outline: GeneratedOutline | null) => {
  return useCallback(
    (chapterIndex: number) => {
      if (!outline) return null;
      const chapter = outline.chapters.find(ch => ch.index === chapterIndex);
      if (!chapter) return null;

      const currentSetting = useSettingStore.getState().setting;
      const engines: AIEngineSetting[] = currentSetting?.aiEngines || [];
      const engine = engines?.find((e) => e.id === currentSetting?.activeEngineId) || engines?.[0];

      if (!engine) {
        throw new Error('未配置 AI 引擎，请先在设置中配置 AI 服务');
      }
      if (!engine.model_name) {
        throw new Error('未配置 AI 模型名称');
      }

      const modelConfig: ModelConfig = {
        model: engine.model_name,
        temperature: Number(engine.temperature ?? 0.7),
        maxTokens: Number(engine.max_tokens ?? 32768),
      };

      const currentProject = useWritingProjectStore.getState().getCurrentProject();
      if (!currentProject) {
        throw new Error('未找到当前项目');
      }

      const novelType = currentProject.config?.parameters?.novelType || 'web_novel';
      const writingStyle = currentProject.config?.parameters?.writingStyle || 'serious';
      const perspective = currentProject.config?.parameters?.narrativePerspective || 'third_person';
      const projectResources: WritingResourceConfig = currentProject.config?.resources || {};

      const chapterInfo: ChapterInfo = {
        index: chapter.index,
        title: chapter.title,
        outline: chapter.summary,
        characters: chapter.characters || [],
        scenes: chapter.scenes || [],
      };

      const generationParams = {
        targetWordCount: chapter.targetWordCount,
        style: writingStyle,
        perspective: perspective,
        novelType,
      };

      const resources: WritingResourceConfig = {
        worldBookIds: projectResources.worldBookIds || [],
        characterCardIds: projectResources.characterCardIds || [],
        userPersonaIds: projectResources.userPersonaIds || [],
        knowledgeItemIds: projectResources.knowledgeItemIds || [],
        writingStyleIds: projectResources.writingStyleIds || [],
      };

      const generationGuidance = chapter.generationGuidance?.trim() || undefined;

      return { chapter, modelConfig, chapterInfo, generationParams, resources, generationGuidance };
    },
    [outline]
  );
};

/**
 * 从 store 同步读取当前 AI 引擎的 modelConfig。
 * 抽取为公共工具，避免在 chunked/resume/shard hook 中重复实现。
 */
export const readModelConfigFromStore = (): { model: string; temperature: number; maxTokens: number } => {
  const currentSetting = useSettingStore.getState().setting;
  const engines: AIEngineSetting[] = currentSetting?.aiEngines || [];
  const engine = engines?.find((e) => e.id === currentSetting?.activeEngineId) || engines?.[0];

  if (!engine) {
    throw new Error('未配置 AI 引擎');
  }

  return {
    model: engine.model_name,
    temperature: Number(engine.temperature ?? 0.7),
    maxTokens: Number(engine.max_tokens ?? 32768),
  };
};

/**
 * 从 store 同步读取当前项目的常用生成参数（novelType、writingStyle、perspective、resources）。
 */
export const readProjectGenerationContext = () => {
  const currentProject = useWritingProjectStore.getState().getCurrentProject();
  if (!currentProject) {
    throw new Error('未找到当前项目');
  }

  const novelType = currentProject.config?.parameters?.novelType || 'web_novel';
  const writingStyle = currentProject.config?.parameters?.writingStyle || 'serious';
  const perspective = currentProject.config?.parameters?.narrativePerspective || 'third_person';
  const projectResources = currentProject.config?.resources || {};

  const resources: WritingResourceConfig = {
    worldBookIds: projectResources.worldBookIds || [],
    characterCardIds: projectResources.characterCardIds || [],
    userPersonaIds: projectResources.userPersonaIds || [],
    knowledgeItemIds: projectResources.knowledgeItemIds || [],
    writingStyleIds: projectResources.writingStyleIds || [],
  };

  return { currentProject, novelType, writingStyle, perspective, resources };
};

/**
 * 合并分片后保存到项目 store + 自动保存到磁盘的公共流程。
 */
export const persistMergedChapterContent = async (
  shared: ChapterGenerationSharedState,
  chapterIndex: number,
  mergedContent: string,
  options: { setStatus?: ChapterStatus } = {}
) => {
  shared.setChapterContents(prev => ({ ...prev, [chapterIndex]: mergedContent }));
  if (options.setStatus) {
    shared.setChapterStatuses(prev => ({ ...prev, [chapterIndex]: options.setStatus as ChapterStatus }));
  }

  const currentProject = shared.currentProjectRef.current;
  if (currentProject && currentProject.outline) {
    shared.updateProject(currentProject.id, {
      outline: {
        ...currentProject.outline,
        chapters: currentProject.outline.chapters.map(ch =>
          ch.index === chapterIndex
            ? {
                ...ch,
                content: mergedContent,
                status: options.setStatus ?? ch.status,
                wordCount: mergedContent.length,
                lastModified: Date.now(),
              }
            : ch
        ),
      },
    });
    shared.saveProject();
  }

  // 自动保存到磁盘
  setTimeout(async () => {
    try {
      if (window.electronAPI?.writing?.autoSaveChapter) {
        await window.electronAPI.writing.autoSaveChapter({
          projectId: shared.projectId,
          chapterIndex,
          content: mergedContent,
        });
      }
    } catch (error) {
      console.error('[ChapterGeneration] 自动保存失败:', error);
    }
  }, 500);
};

// Re-export status enums used by sub hooks
export { ChapterStatus, ChunkStatus, ShardStatus, GenerationState };
