import { create } from 'zustand';
import {
  WritingModeView,
  WritingConfig,
  GeneratedOutline,
  OutlineVersion,
  WritingError,
  GenerationMode,
  GenerationState,
  OutlineEditMode,
  OutlineEditSection,
  ChainOfThought
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

  // Chain of Thought
  chainOfThought: ChainOfThought | null;

  // Enhanced outline editing state
  activeEditSection: OutlineEditSection;
  editMode: OutlineEditMode;
  isEditing: boolean;

  // Version management
  versions: OutlineVersion[];
  currentVersionId: string;

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
  setChainOfThought: (cot: ChainOfThought | null) => void;
  reset: () => void;
  resetForNewProject: () => void;

  // Enhanced outline actions
  setActiveEditSection: (section: OutlineEditSection) => void;
  setEditMode: (mode: OutlineEditMode) => void;
  setIsEditing: (editing: boolean) => void;
  addVersion: (outline: GeneratedOutline, source: OutlineVersion['source'], note?: string) => void;
  restoreVersion: (versionId: string) => void;
  setCurrentVersion: (versionId: string) => void;
  getVersions: () => OutlineVersion[];
}

export const useWritingModeStore = create<WritingModeState>((set, get) => ({
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
  chainOfThought: null,

  // Enhanced outline editing state
  activeEditSection: OutlineEditSection.STORYLINE,
  editMode: OutlineEditMode.AI_GENERATED,
  isEditing: false,

  // Version management
  versions: [],
  currentVersionId: '',

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

  setChainOfThought: (cot) => set({ chainOfThought: cot }),

  reset: () => set({
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
    chainOfThought: null,
    activeEditSection: OutlineEditSection.STORYLINE,
    editMode: OutlineEditMode.AI_GENERATED,
    isEditing: false,
    versions: [],
    currentVersionId: ''
  }),

  resetForNewProject: () => set({
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
    chainOfThought: null,
    activeEditSection: OutlineEditSection.STORYLINE,
    editMode: OutlineEditMode.AI_GENERATED,
    isEditing: false,
    versions: [],
    currentVersionId: ''
  }),

  // Enhanced outline actions
  setActiveEditSection: (section) => set({ activeEditSection: section }),

  setEditMode: (mode) => set({ editMode: mode }),

  setIsEditing: (isEditing) => set({ isEditing }),

  addVersion: (outline, source, note) => {
    const timestamp = Date.now();
    const id = `v-${timestamp}-${Math.random().toString(36).substring(2, 9)}`;
    
    set((state) => {
      const updatedVersions = state.versions.map(v => ({ ...v, isCurrent: false }));
      const newVersion: OutlineVersion = {
        id,
        outline,
        timestamp,
        note,
        source,
        isCurrent: true
      };
      return {
        versions: [...updatedVersions, newVersion],
        currentVersionId: id
      };
    });
  },

  restoreVersion: (versionId) => {
    set((state) => {
      const version = state.versions.find(v => v.id === versionId);
      if (!version) return state;
      
      const updatedVersions = state.versions.map(v => ({ ...v, isCurrent: v.id === versionId }));
      return {
        outline: version.outline,
        versions: updatedVersions,
        currentVersionId: versionId
      };
    });
  },

  setCurrentVersion: (versionId) => set({ currentVersionId: versionId }),

  getVersions: () => get().versions
}));
