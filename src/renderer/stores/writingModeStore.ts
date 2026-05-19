import { create } from 'zustand';
import {
  WritingModeView,
  WritingConfig,
  GeneratedOutline,
  WritingError,
  GenerationMode,
  GenerationState
} from '../../shared/types/writing.types';

interface WritingModeState {
  currentView: WritingModeView;
  config: WritingConfig | null;
  outline: GeneratedOutline | null;
  outlineRaw: string | null;
  outlineMode: 'ai' | 'manual';
  isOutlineGenerating: boolean;
  currentChapterIndex: number;
  isContentGenerating: boolean;
  generationMode: GenerationMode;
  generatedContent: Map<number, string>;
  generationState: GenerationState;
  isPaused: boolean;
  error: WritingError | null;
  streamingContent: string;

  setCurrentView: (view: WritingModeView) => void;
  setConfig: (config: WritingConfig) => void;
  setOutline: (outline: GeneratedOutline) => void;
  setOutlineRaw: (raw: string | null) => void;
  setOutlineMode: (mode: 'ai' | 'manual') => void;
  setOutlineGenerating: (generating: boolean) => void;
  setCurrentChapterIndex: (index: number) => void;
  setIsContentGenerating: (generating: boolean) => void;
  setGenerationMode: (mode: GenerationMode) => void;
  updateGeneratedContent: (chapterIndex: number, content: string) => void;
  setGenerationState: (state: GenerationState) => void;
  setPaused: (paused: boolean) => void;
  setError: (error: WritingError | null) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  reset: () => void;
  resetForNewProject: () => void;
}

export const useWritingModeStore = create<WritingModeState>((set) => ({
  currentView: WritingModeView.PROJECT_LIST,
  config: null,
  outline: null,
  outlineRaw: null,
  outlineMode: 'ai',
  isOutlineGenerating: false,
  currentChapterIndex: 0,
  isContentGenerating: false,
  generationMode: GenerationMode.SINGLE,
  generatedContent: new Map(),
  generationState: GenerationState.IDLE,
  isPaused: false,
  error: null,
  streamingContent: '',

  setCurrentView: (view) => set({ currentView: view }),

  setConfig: (config) => set({ config }),

  setOutline: (outline) => set({ outline }),

  setOutlineRaw: (outlineRaw) => set({ outlineRaw }),

  setOutlineMode: (outlineMode) => set({ outlineMode }),

  setOutlineGenerating: (isOutlineGenerating) => set({ isOutlineGenerating }),

  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),

  setIsContentGenerating: (isContentGenerating) => set({ isContentGenerating }),

  setGenerationMode: (generationMode) => set({ generationMode }),

  updateGeneratedContent: (chapterIndex, content) => {
    set((state) => {
      const newMap = new Map(state.generatedContent);
      newMap.set(chapterIndex, content);
      return { generatedContent: newMap };
    });
  },

  setGenerationState: (generationState) => set({ generationState }),

  setPaused: (isPaused) => set({ isPaused }),

  setError: (error) => set({ error }),

  setStreamingContent: (streamingContent) => set({ streamingContent }),

  appendStreamingContent: (chunk) => set((state) => ({
    streamingContent: state.streamingContent + chunk
  })),

  reset: () => set({
    currentView: WritingModeView.PROJECT_LIST,
    config: null,
    outline: null,
    outlineMode: 'ai',
    isOutlineGenerating: false,
    currentChapterIndex: 0,
    isContentGenerating: false,
    generationMode: GenerationMode.SINGLE,
    generatedContent: new Map(),
    generationState: GenerationState.IDLE,
    isPaused: false,
    error: null,
    streamingContent: ''
  }),

  resetForNewProject: () => set({
    config: null,
    outline: null,
    outlineMode: 'ai',
    isOutlineGenerating: false,
    currentChapterIndex: 0,
    isContentGenerating: false,
    generationMode: GenerationMode.SINGLE,
    generatedContent: new Map(),
    generationState: GenerationState.IDLE,
    isPaused: false,
    error: null,
    streamingContent: ''
  })
}));
