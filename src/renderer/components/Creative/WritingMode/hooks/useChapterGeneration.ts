import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import {
  GeneratedOutline,
  GenerationState,
  GenerationMode,
  ChapterStatus,
  WritingProject,
  ProjectStatus,
} from '../../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';
import { useSettingStore } from '../../../../stores/settingStore';

const MAX_PREVIOUS_CHAPTER_CONTENT_LENGTH = 5000;

interface GenerationProgress {
  currentChapter: number;
  totalChapters: number;
  mode: GenerationMode;
}

interface UseChapterGenerationResult {
  selectedChapterIndex: number;
  setSelectedChapterIndex: (index: number) => void;
  generationState: GenerationState;
  streamingContent: string;
  chapterContents: Record<number, string>;
  setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  chapterStatuses: Record<number, ChapterStatus>;
  isGenerating: boolean;
  isPaused: boolean;
  generationProgress: GenerationProgress | null;
  currentChapterWords: number;
  handleGenerateChapter: (chapterIndex: number) => Promise<void>;
  handleContinuousGeneration: () => void;
  handlePauseGeneration: () => void;
  handleResumeGeneration: () => void;
  handleStopGeneration: () => void;
  handleSaveChapter: () => Promise<void>;
  handleClearChapter: () => void;
  handleRegenerateChapter: () => void;
  handleEditorChange: (content: string) => void;
  editorContentRef: React.MutableRefObject<string>;
}

export function useChapterGeneration(
  outline: GeneratedOutline | null,
  projectId: string
): UseChapterGenerationResult {
  console.log('[ChapterGeneration] Hook called', {
    hasOutline: !!outline,
    chapterCount: outline?.chapters?.length,
    projectId
  });

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
  const [isPaused, setIsPaused] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [currentChapterWords, setCurrentChapterWords] = useState(0);

  const currentProjectRef = useRef<WritingProject | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const isPausedRef = useRef(false);
  const editorContentRef = useRef<string>('');
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleSaveChapterRef = useRef<(() => Promise<void>) | null>(null);
  const handleContinuousGenerationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    console.log('[ChapterGeneration] useEffect triggered:', {
      hasOutline: !!outline,
      chapterCount: outline?.chapters?.length,
      currentProjectId,
      projectsCount: projects.length,
      outlineChapter0ContentLength: outline?.chapters?.[0]?.content?.length || 0,
      outlineChapter0ContentPreview: outline?.chapters?.[0]?.content?.substring(0, 50) || 'empty',
      outlineRef: outline ? 'exists' : 'null'
    });
    
    if (!outline || !outline.chapters) {
      console.warn('[ChapterGeneration] Early return: outline or outline.chapters is missing');
      return;
    }
    
    // 直接从 store 数据中查找当前项目，确保获取到最新加载的章节内容
    // 依赖 projects 数组，当 loadProjects 完成异步加载后会自动触发重新初始化
    const project = projects.find(p => p.id === currentProjectId) || null;
    console.log('[ChapterGeneration] Current project data:', {
      projectId: currentProjectId,
      hasProject: !!project,
      projectChapterCount: project?.outline?.chapters?.length,
      projectChapter0ContentLength: project?.outline?.chapters?.[0]?.content?.length || 0,
      projectChapter0ContentPreview: project?.outline?.chapters?.[0]?.content?.substring(0, 50) || 'empty',
      projectChapterContentExample: project?.outline?.chapters?.[0]?.content?.substring(0, 50) || 'empty'
    });
    
    const statuses: Record<number, ChapterStatus> = {};
    const contents: Record<number, string> = {};
    
    for (const ch of outline.chapters) {
      const projectChapter = project?.outline?.chapters?.find(c => c.index === ch.index);
      // 恢复章节内容：从 outline 中的 ch.content 恢复（从磁盘加载的数据）
      // ch.content 来自 WritingStorageService.loadProject，由 project.json 中的 chapters 数组提供
      const chapterContent = ch.content || projectChapter?.content || '';
      if (ch.index === 0) {
        console.log('[ChapterGeneration] Chapter 0 content check:', {
          outlineChapterContentLength: ch.content?.length || 0,
          outlineChapterContentPreview: ch.content?.substring(0, 50) || 'empty',
          projectChapterContentLength: projectChapter?.content?.length || 0,
          projectChapterContentPreview: projectChapter?.content?.substring(0, 50) || 'empty',
          finalContentLength: chapterContent.length
        });
      }
      statuses[ch.index] = chapterContent ? ChapterStatus.COMPLETED : ChapterStatus.PENDING;
      contents[ch.index] = chapterContent;
    }
    console.log('[ChapterGeneration] Restored contents:', {
      chapterCount: outline.chapters.length,
      restoredContentCount: Object.values(contents).filter(c => c.length > 0).length,
      contentsPreview: Object.fromEntries(
        Object.entries(contents).map(([k, v]) => [k, v.substring(0, 50) || 'empty'])
      )
    });
    setChapterStatuses(statuses);
    setChapterContents(contents);
    if (outline.chapters.length === 0) {
      return;
    }
    if (selectedChapterIndex >= outline.chapters.length) {
      setSelectedChapterIndex(0);
    }
  }, [outline, currentProjectId, projects]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveChapterRef.current?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleContinuousGenerationRef.current?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      setChapterStatuses(prev => ({ ...prev, [data.chapterIndex]: ChapterStatus.COMPLETED }));
      setGenerationState(GenerationState.COMPLETED);
      setIsGenerating(false);
      setIsPaused(false);
      isPausedRef.current = false;
      const chapterNum = outline?.chapters.findIndex(ch => ch.index === data.chapterIndex);
      message.success(`第 ${(chapterNum >= 0 ? chapterNum : data.chapterIndex) + 1} 章生成完成`);

      const currentProject = currentProjectRef.current;
      if (currentProject && currentProject.outline) {
        updateProject(currentProject.id, {
          outline: {
            ...currentProject.outline,
            chapters: currentProject.outline.chapters.map(ch =>
              ch.index === data.chapterIndex
                ? { ...ch, content: data.content, status: ChapterStatus.COMPLETED, wordCount: data.content.length, lastModified: Date.now() }
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
            console.log('[ChapterGeneration] Auto-save after generation complete: chapter', data.chapterIndex);
          }
        } catch (error) {
          console.error('[ChapterGeneration] Failed to auto-save after generation:', error);
        }
      }, 500);

      if (generationProgress && generationProgress.mode === GenerationMode.CONTINUOUS) {
        const nextIndex = data.chapterIndex + 1;
        if (nextIndex < (outline?.chapters.length || 0)) {
          if (isPausedRef.current) {
            setGenerationProgress(null);
            message.info('连续生成已暂停');
            return;
          }
          setGenerationProgress(prev => prev ? { ...prev, currentChapter: nextIndex } : null);
          setTimeout(() => handleGenerateChapter(nextIndex), 1000);
        } else {
          setGenerationProgress(null);
          message.success('所有章节生成完成！');
          const proj = currentProjectRef.current;
          if (proj) {
            updateProject(proj.id, { status: ProjectStatus.COMPLETED });
            saveProject();
          }
        }
      }
    });

    const offError = window.electronAPI.writing.onStreamError((data) => {
      if (stopRef.current) {
        setGenerationState(GenerationState.STOPPED);
        setIsGenerating(false);
        return;
      }
      setGenerationState(GenerationState.ERROR);
      setIsGenerating(false);
      setIsPaused(false);
      isPausedRef.current = false;
      setChapterStatuses(prev => ({
        ...prev,
        [data.chapterIndex]: prev[data.chapterIndex] === ChapterStatus.GENERATING ? ChapterStatus.FAILED : prev[data.chapterIndex]
      }));
      message.error(data.error?.message || '生成出错');
    });

    return () => {
      offChunk();
      offComplete();
      offError();
    };
  }, [outline]);

  const handleGenerateChapter = useCallback(async (chapterIndex: number) => {
    if (!outline || isGenerating) return;

    const chapter = outline.chapters.find(ch => ch.index === chapterIndex);
    if (!chapter) return;

    stopRef.current = false;
    pauseRef.current = false;
    isPausedRef.current = false;
    setIsGenerating(true);
    setGenerationState(GenerationState.GENERATING);
    setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.GENERATING }));
    setStreamingContent('');
    setCurrentChapterWords(0);
    setSelectedChapterIndex(chapterIndex);

    try {
      abortControllerRef.current = new AbortController();

      const currentSetting = useSettingStore.getState().setting;
      const engines = currentSetting?.aiEngines || currentSetting?.ai_engines || [];
      const engine = engines.find((e: any) => e.id === currentSetting?.activeEngineId) || engines[0];

      if (!engine) {
        throw new Error('未配置 AI 引擎，请先在设置中配置 AI 服务');
      }

      if (!engine.model_name) {
        throw new Error('未配置 AI 模型名称');
      }
      if (engine.temperature === undefined || engine.temperature === null) {
        engine.temperature = 0.7;
      }
      if (engine.max_tokens === undefined || engine.max_tokens === null) {
        engine.max_tokens = 10240;
      }

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
        }
      };

      await window.electronAPI.writing.generateChapter(request);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setGenerationState(GenerationState.STOPPED);
        message.info('已停止生成');
      } else {
        message.error(error.message || '生成失败');
      }
      setChapterStatuses(prev => ({ ...prev, [chapterIndex]: ChapterStatus.FAILED }));
      setIsGenerating(false);
      setGenerationState(GenerationState.ERROR);
    }
  }, [outline, isGenerating, chapterContents, projectId, setting]);

  const handleContinuousGeneration = useCallback(() => {
    if (!outline || isGenerating) return;

    const nextChapter = outline.chapters.find(ch =>
      chapterStatuses[ch.index] !== ChapterStatus.COMPLETED
    );

    if (!nextChapter) {
      message.info('所有章节已完成');
      return;
    }

    setGenerationProgress({
      currentChapter: nextChapter.index,
      totalChapters: outline.chapters.length,
      mode: GenerationMode.CONTINUOUS
    });

    handleGenerateChapter(nextChapter.index);
  }, [outline, isGenerating, chapterStatuses, handleGenerateChapter]);

  handleContinuousGenerationRef.current = handleContinuousGeneration;

  const handlePauseGeneration = useCallback(() => {
    pauseRef.current = true;
    isPausedRef.current = true;
    setIsPaused(true);
    setGenerationState(GenerationState.PAUSED);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    message.info('已暂停生成');
  }, []);

  const handleResumeGeneration = useCallback(() => {
    pauseRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setGenerationState(GenerationState.GENERATING);
    message.info('已恢复生成');
  }, []);

  const handleStopGeneration = useCallback(() => {
    stopRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsGenerating(false);
    setIsPaused(false);
    setGenerationState(GenerationState.STOPPED);
    setGenerationProgress(null);
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

  const handleRegenerateChapter = useCallback(() => {
    const currentChapter = outline?.chapters[selectedChapterIndex];
    if (!currentChapter) return;
    handleGenerateChapter(currentChapter.index);
  }, [selectedChapterIndex, outline, handleGenerateChapter]);

  handleSaveChapterRef.current = handleSaveChapter;

  return {
    selectedChapterIndex,
    setSelectedChapterIndex,
    generationState,
    streamingContent,
    chapterContents,
    setChapterContents,
    chapterStatuses,
    isGenerating,
    isPaused,
    generationProgress,
    currentChapterWords,
    handleGenerateChapter,
    handleContinuousGeneration,
    handlePauseGeneration,
    handleResumeGeneration,
    handleStopGeneration,
    handleSaveChapter,
    handleClearChapter,
    handleRegenerateChapter,
    handleEditorChange,
    editorContentRef,
  };
}
