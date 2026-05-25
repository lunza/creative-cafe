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
  const updateProject = useWritingProjectStore((state) => state.updateProject);
  const saveProject = useWritingProjectStore((state) => state.saveProject);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);
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
    if (!outline || !outline.chapters) return;
    const statuses: Record<number, ChapterStatus> = {};
    const contents: Record<number, string> = {};
    const project = getCurrentProject();
    for (const ch of outline.chapters) {
      const projectChapter = project?.chapters?.find(c => c.index === ch.index);
      const chapterContent = projectChapter?.content || '';
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
  }, [outline?.chapters?.length]);

  useEffect(() => {
    currentProjectRef.current = getCurrentProject();
  }, [getCurrentProject]);

  const handleEditorChange = useCallback((content: string) => {
    editorContentRef.current = content;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(() => {
      const project = getCurrentProject();
      if (project && outline) {
        const currentChapter = outline.chapters[selectedChapterIndex];
        if (currentChapter) {
          updateProject(project.id, {
            chapters: project.chapters.map(ch =>
              ch.index === currentChapter.index
                ? { ...ch, content, lastModified: Date.now() }
                : ch
            ),
            metadata: {
              ...project.metadata,
              totalWordCount: project.chapters.reduce((sum, ch) =>
                sum + (ch.index === currentChapter.index ? content.length : ch.wordCount), 0
              ),
            }
          });
        }
      }
    }, 1000);
  }, [selectedChapterIndex, outline, getCurrentProject, updateProject]);

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
      if (currentProject) {
        updateProject(currentProject.id, {
          chapters: currentProject.chapters.map(ch =>
            ch.index === data.chapterIndex
              ? { ...ch, content: data.content, status: ChapterStatus.COMPLETED, wordCount: data.content.length, lastModified: Date.now() }
              : ch
          ),
          metadata: {
            ...currentProject.metadata,
            totalWordCount: currentProject.chapters.reduce((sum, ch) => sum + (ch.index === data.chapterIndex ? data.content.length : ch.wordCount), 0),
            completedChapters: currentProject.chapters.filter(ch => ch.index === data.chapterIndex || ch.status === ChapterStatus.COMPLETED).length
          }
        });
        saveProject();
      }

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
      const project = getCurrentProject();
      if (project) {
        updateProject(project.id, {
          chapters: project.chapters.map(ch =>
            ch.index === currentChapter.index
              ? { ...ch, content, status: ChapterStatus.COMPLETED, wordCount: content.length, lastModified: Date.now() }
              : ch
          ),
          metadata: {
            ...project.metadata,
            totalWordCount: project.chapters.reduce((sum, ch) =>
              sum + (ch.index === currentChapter.index ? content.length : ch.wordCount), 0
            ),
            completedChapters: project.chapters.filter(ch => ch.index === currentChapter.index || ch.status === ChapterStatus.COMPLETED).length
          }
        });
        saveProject();
      }
      message.success('已保存');
    }
  }, [streamingContent, chapterContents, selectedChapterIndex, projectId, outline, getCurrentProject, updateProject, saveProject]);

  const handleClearChapter = useCallback(() => {
    const ch = outline?.chapters[selectedChapterIndex];
    if (!ch) return;
    setChapterContents(prev => ({ ...prev, [ch.index]: '' }));
    setChapterStatuses(prev => ({ ...prev, [ch.index]: ChapterStatus.PENDING }));
    setCurrentChapterWords(0);
    setStreamingContent('');

    const project = getCurrentProject();
    if (project) {
      updateProject(project.id, {
        chapters: project.chapters.map(c =>
          c.index === ch.index
            ? { ...c, content: '', status: ChapterStatus.PENDING, wordCount: 0, lastModified: Date.now() }
            : c
        ),
        metadata: {
          ...project.metadata,
          totalWordCount: project.chapters.reduce((sum, c) =>
            sum + (c.index === ch.index ? 0 : c.wordCount), 0
          ),
          completedChapters: project.chapters.filter(c => c.index !== ch.index && c.status === ChapterStatus.COMPLETED).length
        }
      });
      saveProject();
    }
    message.success('章节内容已清空');
  }, [selectedChapterIndex, outline, getCurrentProject, updateProject, saveProject]);

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
