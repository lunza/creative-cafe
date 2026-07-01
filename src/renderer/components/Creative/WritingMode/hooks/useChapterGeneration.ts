import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  WritingProject,
  RegenerationSuggestion,
  ChunkStatus,
  ShardStatus,
} from '../../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';
import { useSettingStore } from '../../../../stores/settingStore';
import { useWritingModeStore } from '../../../../stores/writingModeStore';
import type { AIEngineSetting } from '../../../../types/setting';
import { ChapterGenerationSharedState } from './useChapterGeneration.shared';
import { useChunkedGeneration } from './useChunkedGeneration';
import { useShardGeneration } from './useShardGeneration';
import { useGenerationResume } from './useGenerationResume';

interface UseChapterGenerationResult {
  selectedChapterIndex: number;
  setSelectedChapterIndex: (index: number) => void;
  generationState: GenerationState;
  streamingContent: string;
  chapterContents: Record<number, string>;
  setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  chapterStatuses: Record<number, ChapterStatus>;
  setChapterStatuses: React.Dispatch<React.SetStateAction<Record<number, ChapterStatus>>>;
  isGenerating: boolean;
  generationProgress: null;
  currentChapterWords: number;
  handleGenerateChapter: (chapterIndex: number, userSuggestion?: string) => Promise<void>;
  handleGenerateChapterChunked: (chapterIndex: number, userSuggestion?: string) => Promise<void>;
  handleResumeGeneration: (chapterIndex: number, userSuggestion?: string) => Promise<void>;
  handleStopGeneration: () => void;
  handleSaveChapter: () => Promise<void>;
  handleClearChapter: () => void;
  handleRegenerateChapter: (regenerationSuggestion?: RegenerationSuggestion) => void;
  handleEditorChange: (content: string) => void;
  updateChapterStatus: (chapterIndex: number, status: ChapterStatus) => void;
  editorContentRef: React.MutableRefObject<string>;
  handleRegenerateChunk: (chunkIndex: number) => void;
  getResumePoint: (chapterIndex: number) => number | null;
  handleGenerateShardOutline: (chapterIndex: number, shardCount: number, userSuggestion?: string) => Promise<void>;
  handleGenerateShard: (chapterIndex: number, shardIndex: number) => Promise<void>;
  handleGenerateAllShards: (chapterIndex: number) => Promise<void>;
  confirmShardToIntegration: (chapterIndex: number, shardIndex: number) => void;
}

/**
 * useChapterGeneration：章节生成编排层。
 *
 * 职责：
 * - 维护共享状态（isGenerating、streamingContent、chapterContents、chapterStatuses 等）
 * - 维护共享 refs（stopRef、currentProjectRef、isShardStreamRef 等）
 * - 注册全局 IPC 流式事件监听（onStream* / onChunk*），路由到 store 或更新本地状态
 * - 实现单章生成（handleGenerateChapter）、停止、保存、清空、重新生成等编排逻辑
 * - 委托分片生成、shard 生成、断点续传给子 hook
 *
 * 对外接口与原实现保持一致，调用方无需修改。
 */
export function useChapterGeneration(
  outline: GeneratedOutline | null,
  projectId: string
): UseChapterGenerationResult {
  const updateProject = useWritingProjectStore((state) => state.updateProject);
  const saveProject = useWritingProjectStore((state) => state.saveProject);
  const currentProjectId = useWritingProjectStore((state) => state.currentProjectId);
  const projects = useWritingProjectStore((state) => state.projects);
  const setting = useSettingStore((state) => state.setting);

  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [generationState, setGenerationState] = useState<GenerationState>(GenerationState.IDLE);
  const [streamingContent, setStreamingContent] = useState('');
  const [chapterContents, setChapterContents] = useState<Record<number, string>>({});
  const [chapterStatuses, setChapterStatuses] = useState<Record<number, ChapterStatus>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentChapterWords, setCurrentChapterWords] = useState(0);

  const currentProjectRef = useRef<WritingProject | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);
  const editorContentRef = useRef<string>('');
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleSaveChapterRef = useRef<(() => Promise<void>) | null>(null);
  const activeGenerationRequests = useRef<Set<string>>(new Set()); // Track active generation requests for synchronous dedup
  const outlineRef = useRef(outline); // Store latest outline for event listeners
  const regenerationSuggestionRef = useRef<RegenerationSuggestion | undefined>(undefined);
  const regenerationPreviousContentRef = useRef<string>('');

  // 分片流式事件路由：区分分片内容生成与旧 chunk 流程
  const isShardStreamRef = useRef(false);
  const activeShardChapterRef = useRef<number>(-1);
  const activeShardIndexRef = useRef<number>(-1);

  // 构建共享状态对象，向下传递给各子 hook
  const shared: ChapterGenerationSharedState = {
    outline,
    projectId,
    setIsGenerating,
    setGenerationState,
    setChapterStatuses,
    setChapterContents,
    setStreamingContent,
    setCurrentChapterWords,
    setSelectedChapterIndex,
    selectedChapterIndex,
    chapterContents,
    stopRef,
    currentProjectRef,
    editorContentRef,
    isShardStreamRef,
    activeShardChapterRef,
    activeShardIndexRef,
    regenerationSuggestionRef,
    regenerationPreviousContentRef,
    updateProject,
    saveProject,
  };

  // 委托子 hook
  const chunked = useChunkedGeneration(shared, outline);
  const shard = useShardGeneration(shared, outline);
  const resume = useGenerationResume(shared, outline);

  useEffect(() => {
    outlineRef.current = outline;
  }, [outline]);

  // 从 store 数据恢复章节内容和状态
  useEffect(() => {
    if (!outline || !outline.chapters) {
      return;
    }

    // 直接从 store 数据中查找当前项目，确保获取到最新加载的章节内容
    // 依赖 projects 数组，当 loadProjects 完成异步加载后会自动触发重新初始化
    const project = projects.find(p => p.id === currentProjectId) || null;

    const statuses: Record<number, ChapterStatus> = {};
    const contents: Record<number, string> = {};

    for (const ch of outline.chapters) {
      const projectChapter = project?.outline?.chapters?.find(c => c.index === ch.index);
      // 恢复章节内容：从 outline 中的 ch.content 恢复（从磁盘加载的数据）
      // ch.content 来自 WritingStorageService.loadProject，由 project.json 中的 chapters 数组提供
      const chapterContent = ch.content || projectChapter?.content || '';
      statuses[ch.index] = chapterContent ? ChapterStatus.COMPLETED : ChapterStatus.PENDING;
      contents[ch.index] = chapterContent;
    }
    setChapterStatuses(statuses);
    setChapterContents(contents);
    if (outline.chapters.length === 0) {
      return;
    }
    if (selectedChapterIndex >= outline.chapters.length) {
      setSelectedChapterIndex(0);
    }
  }, [outline, currentProjectId, projects, selectedChapterIndex]);

  useEffect(() => {
    // 当 projects 数据更新时，同步更新 currentProjectRef
    const project = projects.find(p => p.id === currentProjectId) || null;
    currentProjectRef.current = project;
  }, [currentProjectId, projects]);

  const handleEditorChange = useCallback((content: string) => {
    editorContentRef.current = content;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(() => {
      const project = currentProjectRef.current;
      if (project && project.outline && outline) {
        const currentChapter = outline.chapters[selectedChapterIndex];
        if (currentChapter) {
          updateProject(project.id, {
            outline: {
              ...project.outline,
              chapters: project.outline.chapters.map(ch =>
                ch.index === currentChapter.index
                  ? { ...ch, content, lastModified: Date.now() }
                  : ch
              ),
            },
          });
        }
      }
    }, 1000);
  }, [selectedChapterIndex, outline, updateProject]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  // Cleanup stale generation tasks on mount - prevents orphaned requests after page refresh
  useEffect(() => {
    if (projectId && window.electronAPI?.writing?.cancelGeneration) {
      window.electronAPI.writing.cancelGeneration(projectId).catch(() => {});
    }
  }, []); // Run once on mount

  // 注册全局 IPC 流式事件监听
  useEffect(() => {
    if (!window.electronAPI?.writing) return;

    const offChunk = window.electronAPI.writing.onStreamChunk((data) => {
      if (stopRef.current) return;

      setStreamingContent(prev => prev + data.chunk);
      setCurrentChapterWords(prev => prev + data.chunk.length);
    });

    const offComplete = window.electronAPI.writing.onStreamComplete((data) => {
      setStreamingContent('');
      setCurrentChapterWords(0);
      setChapterContents(prev => ({ ...prev, [data.chapterIndex]: data.content }));
      setChapterStatuses(prev => ({ ...prev, [data.chapterIndex]: ChapterStatus.GENERATED }));
      setGenerationState(GenerationState.COMPLETED);
      setIsGenerating(false);
      const chapterNum = outlineRef.current?.chapters.findIndex(ch => ch.index === data.chapterIndex);
      message.success(`第 ${(chapterNum >= 0 ? chapterNum : data.chapterIndex) + 1} 章生成完成`);

      const currentProject = currentProjectRef.current;
      if (currentProject && currentProject.outline) {
        updateProject(currentProject.id, {
          outline: {
            ...currentProject.outline,
            chapters: currentProject.outline.chapters.map(ch =>
              ch.index === data.chapterIndex
                ? { ...ch, content: data.content, status: ChapterStatus.GENERATED, wordCount: data.content.length, lastModified: Date.now() }
                : ch
            ),
          },
        });
        saveProject();
      }

      // 章节生成完毕后，延迟自动保存以确保 Markdown 组件渲染完成且状态更新完毕
      setTimeout(async () => {
        try {
          if (window.electronAPI?.writing?.autoSaveChapter) {
            await window.electronAPI.writing.autoSaveChapter({
              projectId,
              chapterIndex: data.chapterIndex,
              content: data.content
            });
          }
        } catch (error) {
          console.error('[ChapterGeneration] Failed to auto-save after generation:', error);
        }
      }, 500);
    });

    const offError = window.electronAPI.writing.onStreamError((data) => {
      if (stopRef.current) {
        setGenerationState(GenerationState.STOPPED);
        setIsGenerating(false);
        return;
      }
      // Clear streaming content and word count on error to ensure clean UI
      setStreamingContent('');
      setCurrentChapterWords(0);
      setGenerationState(GenerationState.ERROR);
      setIsGenerating(false);
      setChapterStatuses(prev => ({
        ...prev,
        [data.chapterIndex]: prev[data.chapterIndex] === ChapterStatus.GENERATING ? ChapterStatus.FAILED : prev[data.chapterIndex]
      }));
      // Show user-friendly error message based on error type
      const errorType = data.error?.errorType || 'unknown';
      const friendlyMessages: Record<string, string> = {
        timeout: '生成超时，请检查网络连接或减少章节字数后重试',
        network: '网络连接异常，请检查网络后重试',
        service: 'AI 服务暂时不可用，请稍后重试',
        unknown: '生成失败，请稍后重试'
      };
      message.error(friendlyMessages[errorType] || friendlyMessages.unknown);
    });

    // 分片生成事件监听
    const offChunkStart = window.electronAPI.writing.onChunkStart?.((data) => {
      // 分片流式事件路由：若是分片内容生成则走分片逻辑，不污染旧 chunk 流程
      if (isShardStreamRef.current && data.chunkIndex === activeShardIndexRef.current) {
        useWritingModeStore.getState().updateShardStatus(data.chapterIndex, data.chunkIndex, ShardStatus.GENERATING);
        return;
      }
      // 更新分片状态为 GENERATING
      useWritingModeStore.getState().updateChunkStatus(data.chapterIndex, data.chunkIndex, ChunkStatus.GENERATING);
    });

    const offChunkProgress = window.electronAPI.writing.onChunkProgress?.((data) => {
      // 分片流式事件路由
      if (isShardStreamRef.current && data.chunkIndex === activeShardIndexRef.current) {
        useWritingModeStore.getState().appendShardContent(data.chapterIndex, data.chunkIndex, data.chunk);
        setStreamingContent(prev => prev + data.chunk);
        return;
      }
      // 追加分片内容到 store
      useWritingModeStore.getState().appendChunkContent(data.chapterIndex, data.chunkIndex, data.chunk);
      // 更新流式内容（用于编辑器实时显示）
      setStreamingContent(prev => prev + data.chunk);
      setCurrentChapterWords(prev => prev + data.chunk.length);
    });

    const offChunkComplete = window.electronAPI.writing.onChunkComplete?.(async (data) => {
      // 分片流式事件路由
      if (isShardStreamRef.current && data.chunkIndex === activeShardIndexRef.current) {
        useWritingModeStore.getState().updateShardContent(data.chapterIndex, data.chunkIndex, data.content);
        useWritingModeStore.getState().updateShardStatus(data.chapterIndex, data.chunkIndex, ShardStatus.COMPLETED);
        setStreamingContent('');
        return;
      }
      // 更新分片状态为 COMPLETED
      useWritingModeStore.getState().updateChunkStatus(data.chapterIndex, data.chunkIndex, ChunkStatus.COMPLETED);

      // 生成分片摘要（异步，不阻塞主流程）
      let summary = '';
      if (data.content && data.content.length > 0) {
        try {
          // 调用后端生成分片摘要
          if (window.electronAPI?.writing?.generateChunkSummary) {
            summary = await window.electronAPI.writing.generateChunkSummary({
              projectId,
              chapterIndex: data.chapterIndex,
              chunkIndex: data.chunkIndex,
              content: data.content
            });
          }
        } catch (error) {
          console.error('[ChapterGeneration] 生成分片摘要失败:', error);
          // 降级：使用内容前 200 字作为简单摘要
          summary = data.content.substring(0, 200).replace(/\n/g, ' ') + '...';
        }
      }

      // 更新分片内容
      const chunks = useWritingModeStore.getState().chapterChunks.get(data.chapterIndex);
      if (chunks && chunks[data.chunkIndex]) {
        const updatedChunks = [...chunks];
        updatedChunks[data.chunkIndex] = {
          ...updatedChunks[data.chunkIndex],
          content: data.content,
          summary: summary,
          actualWordCount: data.content.length,
          status: ChunkStatus.COMPLETED,
          updatedAt: Date.now()
        };
        useWritingModeStore.getState().initializeChunks(data.chapterIndex, updatedChunks);
      }
      // 更新进度
      const completedChunks = chunks?.filter(c => c.status === ChunkStatus.COMPLETED).length || 0;
      const totalChunks = chunks?.length || 0;
      // 修复：包含当前刚完成的分片字数
      const completedWords = chunks?.reduce((sum, c, idx) => idx <= data.chunkIndex ? sum + (c.actualWordCount || 0) : sum, 0) || 0;
      useWritingModeStore.getState().setGenerationProgress(data.chapterIndex, {
        totalWords: chunks?.reduce((sum, c) => sum + c.targetWordCount, 0) || 0,
        completedWords,
        currentChunkIndex: data.chunkIndex,
        totalChunks,
        completedChunks: completedChunks + 1,
        estimatedTimeRemaining: 0
      });
    });

    const offChunkError = window.electronAPI.writing.onChunkError?.((data) => {
      // 分片流式事件路由
      if (isShardStreamRef.current) {
        useWritingModeStore.getState().updateShardStatus(data.chapterIndex, data.chunkIndex, ShardStatus.FAILED);
        message.error(`分片 ${data.chunkIndex + 1} 生成失败: ${data.error?.message || '未知错误'}`);
        return;
      }
      console.error('[ChapterGeneration] 分片错误:', data.chunkIndex, data.error);
      useWritingModeStore.getState().updateChunkStatus(data.chapterIndex, data.chunkIndex, ChunkStatus.FAILED);
      message.error(`分片 ${data.chunkIndex + 1} 生成失败: ${data.error?.message || '未知错误'}`);
    });

    return () => {
      offChunk();
      offComplete();
      offError();
      offChunkStart?.();
      offChunkProgress?.();
      offChunkComplete?.();
      offChunkError?.();
      // Abort local controller and send IPC cancel to clean up backend
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (projectId && window.electronAPI?.writing?.cancelGeneration) {
        window.electronAPI.writing.cancelGeneration(projectId).catch(() => {});
      }
    };
  }, []); // Register listeners once - use refs for state access

  // ========== 单章生成 ==========

  const handleGenerateChapter = useCallback(async (chapterIndex: number, userSuggestion?: string) => {
    if (!outline) return;

    // Create a request key to prevent duplicate requests for the same chapter
    const requestKey = `${projectId}_${chapterIndex}`;

    // Use the ref for synchronous deduplication (avoids race conditions with React state)
    if (activeGenerationRequests.current.has(requestKey)) {
      return;
    }

    // Add this request to the active set
    activeGenerationRequests.current.add(requestKey);

    const chapter = outline.chapters.find(ch => ch.index === chapterIndex);
    if (!chapter) {
      activeGenerationRequests.current.delete(requestKey);
      return;
    }

    // Check if already generating (using React state for UI purposes)
    if (isGenerating) {
      activeGenerationRequests.current.delete(requestKey);
      return;
    }

    stopRef.current = false;
    setIsGenerating(true);
    setGenerationState(GenerationState.GENERATING);
    setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.GENERATING }));
    setStreamingContent('');
    setCurrentChapterWords(0);
    setSelectedChapterIndex(chapterIndex);

    try {
      abortControllerRef.current = new AbortController();

      const currentSetting = useSettingStore.getState().setting;

      // 获取 AI 引擎配置
      const engines: AIEngineSetting[] = currentSetting?.aiEngines || [];

      const engine = engines.find((e) => e.id === currentSetting?.activeEngineId) || engines[0];

      if (!engine) {
        throw new Error('未配置 AI 引擎，请先在设置中配置 AI 服务');
      }

      if (!engine.model_name) {
        throw new Error('未配置 AI 模型名称');
      }
      if (engine.temperature === undefined || engine.temperature === null) {
        engine.temperature = 0.7;
      }

      // Handle max_tokens: check for undefined, null, NaN, and 0
      let maxTokens = engine.max_tokens;
      if (maxTokens === undefined || maxTokens === null || Number.isNaN(maxTokens) || maxTokens === 0) {
        maxTokens = 32768; // Default to 32768 tokens
      }
      engine.max_tokens = maxTokens;

      const modelConfig = {
        model: engine.model_name,
        temperature: Number(engine.temperature),
        maxTokens: Number(engine.max_tokens),
      };

      const currentProject = useWritingProjectStore.getState().getCurrentProject();
      if (!currentProject) {
        throw new Error('未找到当前项目');
      }

      if (!window.electronAPI?.writing?.generateChapter) {
        throw new Error('IPC 通信模块未就绪，请重启应用');
      }

      const novelType = currentProject.config?.parameters?.novelType || 'web_novel';
      const writingStyle = currentProject.config?.parameters?.writingStyle || 'serious';
      const perspective = currentProject.config?.parameters?.narrativePerspective || 'third_person';
      const projectResources = currentProject.config?.resources || {};

      const request = {
        projectId,
        chapterIndex,
        chapterInfo: {
          index: chapter.index,
          title: chapter.title,
          outline: chapter.summary,
          characters: chapter.characters || [],
          scenes: chapter.scenes || []
        },
        previousChapters: [],
        worldBookContext: [],
        characterContext: [],
        generationParams: {
          targetWordCount: chapter.targetWordCount,
          style: writingStyle,
          perspective: perspective,
          novelType,
          constraints: []
        },
        modelConfig,
        resources: {
          worldBookIds: projectResources.worldBookIds || [],
          characterCardIds: projectResources.characterCardIds || [],
          userPersonaIds: projectResources.userPersonaIds || [],
          knowledgeItemIds: projectResources.knowledgeItemIds || [],
          writingStyleIds: projectResources.writingStyleIds || []
        },
        userSuggestion: userSuggestion?.trim() || undefined,
        regenerationSuggestion: regenerationSuggestionRef.current,
        previousChapterContent: regenerationPreviousContentRef.current || undefined,
        generationGuidance: chapter.generationGuidance?.trim() || undefined
      };

      // Clear regeneration refs after building request
      regenerationSuggestionRef.current = undefined;
      regenerationPreviousContentRef.current = '';

      await window.electronAPI.writing.generateChapter(request);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        setGenerationState(GenerationState.STOPPED);
        message.info('已停止生成');
      } else {
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(errMsg || '生成失败');
        setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.FAILED }));
        setGenerationState(GenerationState.ERROR);
      }
      setIsGenerating(false);
    } finally {
      // Clean up: remove requestKey, stop sync timer
      activeGenerationRequests.current.delete(requestKey);
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      // Don't override isGenerating/generationState here - they're set in catch or onStreamComplete
    }
  }, [outline, chapterContents, projectId, setting, isGenerating]);

  const handleStopGeneration = useCallback(() => {
    stopRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsGenerating(false);
    setGenerationState(GenerationState.STOPPED);
    message.info('已停止生成');
  }, []);

  const handleSaveChapter = useCallback(async () => {
    const currentChapter = outline?.chapters[selectedChapterIndex];
    if (!currentChapter) {
      message.warning('未找到当前章节');
      return;
    }
    const content = editorContentRef.current || streamingContent || chapterContents[currentChapter.index] || '';

    if (window.electronAPI?.writing) {
      await window.electronAPI.writing.autoSaveChapter({ projectId, chapterIndex: currentChapter.index, content });
      setChapterContents(prev => ({ ...prev, [currentChapter.index]: content }));
      const project = currentProjectRef.current;
      if (project && project.outline) {
        updateProject(project.id, {
          outline: {
            ...project.outline,
            chapters: project.outline.chapters.map(ch =>
              ch.index === currentChapter.index
                ? { ...ch, content, status: ChapterStatus.COMPLETED, wordCount: content.length, lastModified: Date.now() }
                : ch
            ),
          },
        });
        saveProject();
      }
      message.success('已保存');
    }
  }, [streamingContent, chapterContents, selectedChapterIndex, projectId, outline, updateProject, saveProject]);

  const handleClearChapter = useCallback(() => {
    const ch = outline?.chapters[selectedChapterIndex];
    if (!ch) return;
    setChapterContents(prev => ({ ...prev, [ch.index]: '' }));
    setChapterStatuses(prev => ({ ...prev, [ch.index]: ChapterStatus.PENDING }));
    setCurrentChapterWords(0);
    setStreamingContent('');
    editorContentRef.current = '';

    const project = currentProjectRef.current;
    if (project && project.outline) {
      updateProject(project.id, {
        outline: {
          ...project.outline,
          chapters: project.outline.chapters.map(c =>
            c.index === ch.index
              ? { ...c, content: '', status: ChapterStatus.PENDING, wordCount: 0, lastModified: Date.now() }
              : c
          ),
        },
      });
      saveProject();
    }
    message.success('章节内容已清空');
  }, [selectedChapterIndex, outline, updateProject, saveProject]);

  const handleRegenerateChapter = useCallback((regenerationSuggestion?: RegenerationSuggestion) => {
    const currentChapter = outline?.chapters[selectedChapterIndex];
    if (!currentChapter) return;

    // Get previous chapter content for reference in regeneration suggestion
    const previousContent = chapterContents[currentChapter.index] || '';

    // For regeneration, we need to pass the suggestion through a different mechanism
    // Since handleGenerateChapter only accepts userSuggestion (simple string),
    // we'll store regeneration suggestion in a ref and use it in handleGenerateChapter
    regenerationSuggestionRef.current = regenerationSuggestion;
    regenerationPreviousContentRef.current = previousContent;

    handleGenerateChapter(currentChapter.index);
  }, [selectedChapterIndex, outline, chapterContents, handleGenerateChapter]);

  const updateChapterStatus = useCallback((chapterIndex: number, status: ChapterStatus) => {
    setChapterStatuses(prev => ({ ...prev, [chapterIndex]: status }));
  }, []);

  handleSaveChapterRef.current = handleSaveChapter;

  return {
    selectedChapterIndex,
    setSelectedChapterIndex,
    generationState,
    streamingContent,
    chapterContents,
    setChapterContents,
    chapterStatuses,
    setChapterStatuses,
    isGenerating,
    generationProgress: null,
    currentChapterWords,
    handleGenerateChapter,
    handleGenerateChapterChunked: chunked.handleGenerateChapterChunked,
    handleResumeGeneration: resume.handleResumeGeneration,
    handleStopGeneration,
    handleSaveChapter,
    handleClearChapter,
    handleRegenerateChapter,
    handleEditorChange,
    updateChapterStatus,
    editorContentRef,
    handleRegenerateChunk: chunked.handleRegenerateChunk,
    getResumePoint: resume.getResumePoint as (chapterIndex: number) => number | null,
    handleGenerateShardOutline: shard.handleGenerateShardOutline,
    handleGenerateShard: shard.handleGenerateShard,
    handleGenerateAllShards: shard.handleGenerateAllShards,
    confirmShardToIntegration: shard.confirmShardToIntegration,
  };
}
