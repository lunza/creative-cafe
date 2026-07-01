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
  ChainOfThought,
  ChapterChunk,
  GenerationProgress,
  ChunkStatus,
  ShardOutline,
  ShardStatus,
  ShardDetail,
  ShardIntegrationMarker
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

  // Chunked generation state
  chapterChunks: Map<number, ChapterChunk[]>;
  generationProgress: Map<number, GenerationProgress>;
  isChunking: Map<number, boolean>;

  // Shard generation state（用户可控分片生成工作流）
  shardOutlines: Map<number, ShardOutline[]>;
  shardDetails: Map<number, ShardDetail[]>;
  confirmedShardMarkers: Map<number, Record<number, ShardIntegrationMarker>>;

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

  // Chunked generation actions
  initializeChunks: (chapterIndex: number, chunks: ChapterChunk[]) => void;
  updateChunkStatus: (chapterIndex: number, chunkIndex: number, status: ChunkStatus) => void;
  appendChunkContent: (chapterIndex: number, chunkIndex: number, content: string) => void;
  setGenerationProgress: (chapterIndex: number, progress: GenerationProgress) => void;
  saveChunkCheckpoint: (chapterIndex: number, chunkIndex: number, checkpoint: string) => void;
  mergeChunksToChapter: (chapterIndex: number) => string;
  setIsChunking: (chapterIndex: number, isChunking: boolean) => void;

  // Shard generation actions（用户可控分片生成工作流）
  setShardOutlines: (chapterIndex: number, outlines: ShardOutline[]) => void;
  updateShardContent: (chapterIndex: number, shardIndex: number, content: string) => void;
  appendShardContent: (chapterIndex: number, shardIndex: number, content: string) => void;
  updateShardStatus: (chapterIndex: number, shardIndex: number, status: ShardStatus) => void;
  confirmShardToIntegration: (chapterIndex: number, shardIndex: number, summary: string) => ShardIntegrationMarker;
  getShardDetails: (chapterIndex: number) => ShardDetail[];
  clearShards: (chapterIndex: number) => void;
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

  // Chunked generation state
  chapterChunks: new Map(),
  generationProgress: new Map(),
  isChunking: new Map(),

  // Shard generation state
  shardOutlines: new Map(),
  shardDetails: new Map(),
  confirmedShardMarkers: new Map(),

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

  getVersions: () => get().versions,

  // Chunked generation actions
  initializeChunks: (chapterIndex, chunks) => set((state) => {
    const newChapterChunks = new Map(state.chapterChunks);
    newChapterChunks.set(chapterIndex, chunks);
    return { chapterChunks: newChapterChunks };
  }),

  updateChunkStatus: (chapterIndex, chunkIndex, status) => set((state) => {
    const chunks = state.chapterChunks.get(chapterIndex);
    if (!chunks) return state;
    
    const updatedChunks = [...chunks];
    updatedChunks[chunkIndex] = {
      ...updatedChunks[chunkIndex],
      status,
      updatedAt: Date.now()
    };
    
    const newChapterChunks = new Map(state.chapterChunks);
    newChapterChunks.set(chapterIndex, updatedChunks);
    return { chapterChunks: newChapterChunks };
  }),

  appendChunkContent: (chapterIndex, chunkIndex, content) => set((state) => {
    const chunks = state.chapterChunks.get(chapterIndex);
    if (!chunks) return state;
    
    const updatedChunks = [...chunks];
    const chunk = updatedChunks[chunkIndex];
    updatedChunks[chunkIndex] = {
      ...chunk,
      content: chunk.content + content,
      actualWordCount: (chunk.actualWordCount || 0) + content.length,
      updatedAt: Date.now()
    };
    
    const newChapterChunks = new Map(state.chapterChunks);
    newChapterChunks.set(chapterIndex, updatedChunks);
    return { chapterChunks: newChapterChunks };
  }),

  setGenerationProgress: (chapterIndex, progress) => set((state) => {
    const newProgress = new Map(state.generationProgress);
    newProgress.set(chapterIndex, progress);
    return { generationProgress: newProgress };
  }),

  saveChunkCheckpoint: (chapterIndex, chunkIndex, checkpoint) => set((state) => {
    const chunks = state.chapterChunks.get(chapterIndex);
    if (!chunks) return state;
    
    const updatedChunks = [...chunks];
    updatedChunks[chunkIndex] = {
      ...updatedChunks[chunkIndex],
      checkpoint,
      updatedAt: Date.now()
    };
    
    const newChapterChunks = new Map(state.chapterChunks);
    newChapterChunks.set(chapterIndex, updatedChunks);
    return { chapterChunks: newChapterChunks };
  }),

  mergeChunksToChapter: (chapterIndex) => {
    const chunks = get().chapterChunks.get(chapterIndex);
    if (!chunks) return '';
    
    // 按顺序合并所有已完成分片的内容
    const mergedContent = chunks
      .sort((a, b) => a.index - b.index)
      .map(chunk => chunk.content)
      .join('\n\n');
    
    return mergedContent;
  },

  setIsChunking: (chapterIndex, isChunking) => set((state) => {
    const newIsChunking = new Map(state.isChunking);
    newIsChunking.set(chapterIndex, isChunking);
    return { isChunking: newIsChunking };
  }),

  // Shard generation actions（用户可控分片生成工作流）
  setShardOutlines: (chapterIndex, outlines) => set((state) => {
    const now = Date.now();
    const details: ShardDetail[] = outlines.map((outline) => ({
      ...outline,
      status: ShardStatus.PENDING,
      content: '',
      actualWordCount: 0,
      confirmed: false,
      updatedAt: now
    }));

    const newShardOutlines = new Map(state.shardOutlines);
    newShardOutlines.set(chapterIndex, outlines);

    const newShardDetails = new Map(state.shardDetails);
    newShardDetails.set(chapterIndex, details);

    return {
      shardOutlines: newShardOutlines,
      shardDetails: newShardDetails
    };
  }),

  updateShardContent: (chapterIndex, shardIndex, content) => set((state) => {
    const details = state.shardDetails.get(chapterIndex);
    if (!details || !details[shardIndex]) return state;

    const updatedDetails = [...details];
    updatedDetails[shardIndex] = {
      ...updatedDetails[shardIndex],
      content,
      actualWordCount: content.length,
      updatedAt: Date.now()
    };

    const newShardDetails = new Map(state.shardDetails);
    newShardDetails.set(chapterIndex, updatedDetails);
    return { shardDetails: newShardDetails };
  }),

  appendShardContent: (chapterIndex, shardIndex, content) => set((state) => {
    const details = state.shardDetails.get(chapterIndex);
    if (!details || !details[shardIndex]) return state;

    const shard = details[shardIndex];
    const updatedDetails = [...details];
    updatedDetails[shardIndex] = {
      ...shard,
      content: shard.content + content,
      actualWordCount: (shard.actualWordCount || 0) + content.length,
      updatedAt: Date.now()
    };

    const newShardDetails = new Map(state.shardDetails);
    newShardDetails.set(chapterIndex, updatedDetails);
    return { shardDetails: newShardDetails };
  }),

  updateShardStatus: (chapterIndex, shardIndex, status) => set((state) => {
    const details = state.shardDetails.get(chapterIndex);
    if (!details || !details[shardIndex]) return state;

    const updatedDetails = [...details];
    updatedDetails[shardIndex] = {
      ...updatedDetails[shardIndex],
      status,
      updatedAt: Date.now()
    };

    const newShardDetails = new Map(state.shardDetails);
    newShardDetails.set(chapterIndex, updatedDetails);
    return { shardDetails: newShardDetails };
  }),

  confirmShardToIntegration: (chapterIndex, shardIndex, summary) => {
    const state = get();
    const existingMarkers = state.confirmedShardMarkers.get(chapterIndex);
    const existing = existingMarkers?.[shardIndex];
    // 幂等：若该 shardIndex 已有标记则复用，保证覆盖语义
    if (existing) {
      return existing;
    }

    const marker: ShardIntegrationMarker = { shardIndex, summary };

    set((s) => {
      const details = s.shardDetails.get(chapterIndex);
      let newShardDetails = s.shardDetails;
      if (details && details[shardIndex]) {
        const updatedDetails = [...details];
        updatedDetails[shardIndex] = {
          ...updatedDetails[shardIndex],
          confirmed: true,
          updatedAt: Date.now()
        };
        newShardDetails = new Map(s.shardDetails);
        newShardDetails.set(chapterIndex, updatedDetails);
      }

      const newConfirmedShardMarkers = new Map(s.confirmedShardMarkers);
      const chapterMarkers: Record<number, ShardIntegrationMarker> = {
        ...(s.confirmedShardMarkers.get(chapterIndex) || {})
      };
      chapterMarkers[shardIndex] = marker;
      newConfirmedShardMarkers.set(chapterIndex, chapterMarkers);

      return {
        shardDetails: newShardDetails,
        confirmedShardMarkers: newConfirmedShardMarkers
      };
    });

    return marker;
  },

  getShardDetails: (chapterIndex) => {
    return get().shardDetails.get(chapterIndex) ?? [];
  },

  clearShards: (chapterIndex) => set((state) => {
    const newShardOutlines = new Map(state.shardOutlines);
    newShardOutlines.delete(chapterIndex);

    const newShardDetails = new Map(state.shardDetails);
    newShardDetails.delete(chapterIndex);

    const newConfirmedShardMarkers = new Map(state.confirmedShardMarkers);
    newConfirmedShardMarkers.delete(chapterIndex);

    return {
      shardOutlines: newShardOutlines,
      shardDetails: newShardDetails,
      confirmedShardMarkers: newConfirmedShardMarkers
    };
  })
}));
