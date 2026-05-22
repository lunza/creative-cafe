import { useState, useCallback, useEffect, useRef } from 'react';
import { MaterialItem, MaterialType, WritingStyleResource, WritingStyleProgress } from '../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

interface UseWritingMaterialsReturn {
  worldBooks: MaterialItem[];
  characters: MaterialItem[];
  personas: MaterialItem[];
  knowledgeItems: MaterialItem[];
  writingStyles: MaterialItem[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredWorldBooks: MaterialItem[];
  filteredCharacters: MaterialItem[];
  filteredPersonas: MaterialItem[];
  filteredKnowledgeItems: MaterialItem[];
  filteredWritingStyles: MaterialItem[];
  loadAllMaterials: () => Promise<void>;
  toggleMaterial: (type: MaterialType, id: string) => void;
  getSelectedCount: (type: MaterialType) => number;
  refreshMaterials: () => void;
  loadWritingStyles: () => Promise<void>;
  toggleWritingStyle: (id: string) => void;
  writingStyleLearning: {
    taskId: string | null;
    progress: WritingStyleProgress | null;
    isLearning: boolean;
  };
  uploadWritingStyle: (filePath: string, fileName: string, fileSize: number) => Promise<{ success: boolean; taskId?: string; error?: string }>;
  cancelLearning: (taskId: string) => Promise<void>;
}

interface KnowledgeItemData {
  id: string;
  title?: string;
  content?: string;
  category?: string[];
  tags?: string[];
  documentId?: string;
}

export function useWritingMaterials(): UseWritingMaterialsReturn {
  const [worldBooks, setWorldBooks] = useState<MaterialItem[]>([]);
  const [characters, setCharacters] = useState<MaterialItem[]>([]);
  const [personas, setPersonas] = useState<MaterialItem[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<MaterialItem[]>([]);
  const [writingStyles, setWritingStyles] = useState<MaterialItem[]>([]);
  const [writingStyleLearning, setWritingStyleLearning] = useState<{
    taskId: string | null;
    progress: WritingStyleProgress | null;
    isLearning: boolean;
  }>({ taskId: null, progress: null, isLearning: false });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const currentProjectId = useWritingProjectStore((state) => state.currentProjectId);
  const projects = useWritingProjectStore((state) => state.projects);
  const updateProject = useWritingProjectStore((state) => state.updateProject);

  const currentProject = currentProjectId
    ? projects.find((p) => p.id === currentProjectId) || null
    : null;

  const getSelectedIds = useCallback((): { worldBookIds: string[]; characterCardIds: string[]; userPersonaIds: string[]; knowledgeItemIds: string[]; writingStyleIds: string[] } => {
    const config = currentProject?.config?.resources;
    return {
      worldBookIds: config?.worldBookIds || [],
      characterCardIds: config?.characterCardIds || [],
      userPersonaIds: config?.userPersonaIds || [],
      knowledgeItemIds: config?.knowledgeItemIds || [],
      writingStyleIds: config?.writingStyleIds || [],
    };
  }, [currentProject]);

  const loadAllMaterials = useCallback(async () => {
    setLoading(true);
    const selectedIds = getSelectedIds();

    try {
      const wbPromise = window.electronAPI?.worldBook?.list?.()
        ? window.electronAPI.worldBook.list()
        : Promise.resolve([]);

      const charPromise = window.electronAPI?.character?.list?.()
        ? window.electronAPI.character.list()
        : Promise.resolve([]);

      const personaPromise = window.electronAPI?.avatar?.list?.()
        ? window.electronAPI.avatar.list()
        : Promise.resolve([]);

      const kbPromise = window.electronAPI?.knowledge?.list?.()
        ? window.electronAPI.knowledge.list({}, 1, 1000)
        : Promise.resolve({ success: false, items: [] });

      const wsPromise = window.electronAPI?.writing?.style?.list
        ? window.electronAPI.writing.style.list()
        : Promise.resolve({ success: false, styles: [] });

      const [wbResult, charResult, personaResult, kbResult, wsResult] = await Promise.all([
        wbPromise, charPromise, personaPromise, kbPromise, wsPromise,
      ]);

      const wbList = Array.isArray(wbResult) ? wbResult : [];
      const chList = Array.isArray(charResult) ? charResult : [];
      const paList = Array.isArray(personaResult) ? personaResult : [];
      const kbList = (kbResult?.success && Array.isArray(kbResult.items)) ? kbResult.items : [];
      const wsList = (wsResult?.success && Array.isArray(wsResult.styles)) ? wsResult.styles : [];

      const mappedWorldBooks: MaterialItem[] = wbList.map((wb: any) => ({
        id: wb.path,
        name: wb.name.replace(/\.(json|json5)$/i, ''),
        type: 'worldbook' as MaterialType,
        description: '',
        path: wb.path,
        isSelected: selectedIds.worldBookIds.includes(wb.path),
        metadata: wb,
      }));

      const mappedCharacters: MaterialItem[] = chList.map((ch: any) => ({
        id: ch.path,
        name: ch.characterName || ch.name.replace(/\.(png|jpg|jpeg|webp)$/i, ''),
        type: 'character' as MaterialType,
        description: ch.description || '',
        path: ch.path,
        isSelected: selectedIds.characterCardIds.includes(ch.path),
        metadata: ch,
      }));

      const mappedPersonas: MaterialItem[] = paList
        .filter((p: any) => p.path.endsWith('.json') && !p.path.includes('user-profile.json'))
        .map((p: any) => ({
          id: p.path,
          name: p.name || p.path.replace(/\.json$/i, ''),
          type: 'persona' as MaterialType,
          description: p.description || '',
          path: p.path,
          isSelected: selectedIds.userPersonaIds.includes(p.path),
          metadata: p,
        }));

      const mappedKnowledge: MaterialItem[] = kbList.map((item: KnowledgeItemData) => ({
        id: item.id,
        name: item.title || item.id,
        type: 'knowledge' as MaterialType,
        description: item.content?.substring(0, 100) || '',
        path: item.id,
        isSelected: selectedIds.knowledgeItemIds.includes(item.id),
        metadata: item,
      }));

      const mappedWritingStyles: MaterialItem[] = wsList
        .filter((ws: WritingStyleResource) => ws.status === 'COMPLETED')
        .map((ws: WritingStyleResource) => ({
          id: ws.id,
          name: ws.name,
          type: 'writing-style' as MaterialType,
          description: ws.analysis?.fullReport?.substring(0, 100) || '文风分析完成',
          path: ws.id,
          isSelected: selectedIds.writingStyleIds?.includes(ws.id) || false,
          metadata: ws,
        }));

      setWorldBooks(mappedWorldBooks);
      setCharacters(mappedCharacters);
      setPersonas(mappedPersonas);
      setKnowledgeItems(mappedKnowledge);
      setWritingStyles(mappedWritingStyles);
    } catch (error) {
      console.error('[useWritingMaterials] Load materials error:', error);
    } finally {
      setLoading(false);
    }
  }, [getSelectedIds]);

  useEffect(() => {
    loadAllMaterials();
  }, [currentProjectId, loadAllMaterials]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  const filterMaterials = useCallback((items: MaterialItem[], query: string) => {
    if (!query) return items;
    const lowerQuery = query.toLowerCase();
    return items.filter((item) => {
      const nameMatch = item.name.toLowerCase().includes(lowerQuery);
      const descMatch = item.description?.toLowerCase().includes(lowerQuery);
      return nameMatch || descMatch;
    });
  }, []);

  const filteredWorldBooks = filterMaterials(worldBooks, debouncedQuery);
  const filteredCharacters = filterMaterials(characters, debouncedQuery);
  const filteredPersonas = filterMaterials(personas, debouncedQuery);
  const filteredKnowledgeItems = filterMaterials(knowledgeItems, debouncedQuery);
  const filteredWritingStyles = filterMaterials(writingStyles, debouncedQuery);

  const loadWritingStyles = useCallback(async () => {
    try {
      const result = await window.electronAPI.writing.style.list();
      if (result.success) {
        const selectedIds = getSelectedIds();
        const mappedWritingStyles: MaterialItem[] = result.styles
          .filter((ws: WritingStyleResource) => ws.status === 'COMPLETED')
          .map((ws: WritingStyleResource) => ({
            id: ws.id,
            name: ws.name,
            type: 'writing-style' as MaterialType,
            description: ws.analysis?.fullReport?.substring(0, 100) || '文风分析完成',
            path: ws.id,
            isSelected: selectedIds.writingStyleIds?.includes(ws.id) || false,
            metadata: ws,
          }));
        setWritingStyles(mappedWritingStyles);
      }
    } catch (error) {
      console.error('[useWritingMaterials] Failed to load writing styles:', error);
    }
  }, [getSelectedIds]);

  const toggleWritingStyle = useCallback((id: string) => {
    if (!currentProject) return;

    const resources = currentProject.config.resources || {
      worldBookIds: [],
      characterCardIds: [],
    };
    const newResources = { ...resources };
    const ids = [...(resources.writingStyleIds || [])];
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    newResources.writingStyleIds = ids;

    updateProject(currentProject.id, {
      config: {
        ...currentProject.config,
        resources: newResources,
      },
    });

    setWritingStyles(items =>
      items.map((item) =>
        item.id === id ? { ...item, isSelected: !item.isSelected } : item
      )
    );
  }, [currentProject, updateProject]);

  const uploadWritingStyle = useCallback(async (filePath: string, fileName: string, fileSize: number) => {
    if (!window.electronAPI?.writing?.style?.upload) {
      return { success: false, error: '写作风格学习功能不可用' };
    }

    setWritingStyleLearning({ taskId: null, progress: null, isLearning: true });

    const result = await window.electronAPI.writing.style.upload({
      filePath,
      fileName,
      fileSize,
    });

    if (result.success && result.taskId) {
      setWritingStyleLearning(prev => ({ ...prev, taskId: result.taskId! }));
    }

    return result;
  }, []);

  const cancelLearning = useCallback(async (taskId: string) => {
    if (window.electronAPI?.writing?.style?.cancel) {
      await window.electronAPI.writing.style.cancel(taskId);
    }
    setWritingStyleLearning({ taskId: null, progress: null, isLearning: false });
  }, []);

  const toggleMaterial = useCallback((type: MaterialType, id: string) => {
    if (!currentProject) return;

    const resources = currentProject.config.resources || {
      worldBookIds: [],
      characterCardIds: [],
    };
    const newResources = { ...resources };

    switch (type) {
      case 'worldbook': {
        const ids = [...(resources.worldBookIds || [])];
        const idx = ids.indexOf(id);
        if (idx >= 0) ids.splice(idx, 1);
        else ids.push(id);
        newResources.worldBookIds = ids;
        break;
      }
      case 'character': {
        const ids = [...(resources.characterCardIds || [])];
        const idx = ids.indexOf(id);
        if (idx >= 0) ids.splice(idx, 1);
        else ids.push(id);
        newResources.characterCardIds = ids;
        break;
      }
      case 'persona': {
        const ids = [...(resources.userPersonaIds || [])];
        const idx = ids.indexOf(id);
        if (idx >= 0) ids.splice(idx, 1);
        else ids.push(id);
        newResources.userPersonaIds = ids;
        break;
      }
      case 'knowledge': {
        const ids = [...(resources.knowledgeItemIds || [])];
        const idx = ids.indexOf(id);
        if (idx >= 0) ids.splice(idx, 1);
        else ids.push(id);
        newResources.knowledgeItemIds = ids;
        break;
      }
    }

    updateProject(currentProject.id, {
      config: {
        ...currentProject.config,
        resources: newResources,
      },
    });

    const updateSelection = (items: MaterialItem[]) =>
      items.map((item) =>
        item.id === id ? { ...item, isSelected: !item.isSelected } : item
      );

    switch (type) {
      case 'worldbook':
        setWorldBooks(updateSelection);
        break;
      case 'character':
        setCharacters(updateSelection);
        break;
      case 'persona':
        setPersonas(updateSelection);
        break;
      case 'knowledge':
        setKnowledgeItems(updateSelection);
        break;
    }
  }, [currentProject, updateProject]);

  const getSelectedCount = useCallback(
    (type: MaterialType) => {
      switch (type) {
        case 'worldbook':
          return worldBooks.filter((w) => w.isSelected).length;
        case 'character':
          return characters.filter((c) => c.isSelected).length;
        case 'persona':
          return personas.filter((p) => p.isSelected).length;
        case 'knowledge':
          return knowledgeItems.filter((k) => k.isSelected).length;
        case 'writing-style':
          return writingStyles.filter((ws) => ws.isSelected).length;
      }
    },
    [worldBooks, characters, personas, knowledgeItems, writingStyles]
  );

  const refreshMaterials = useCallback(() => {
    loadAllMaterials();
  }, [loadAllMaterials]);

  useEffect(() => {
    if (!window.electronAPI?.writing?.style) return;

    const removeProgressListener = window.electronAPI.writing.style.onProgress((data) => {
      setWritingStyleLearning(prev => ({
        ...prev,
        progress: data.progress,
        isLearning: data.progress.status !== 'COMPLETED' && data.progress.status !== 'FAILED' && data.progress.status !== 'CANCELLED',
      }));
    });

    const removeCompleteListener = window.electronAPI.writing.style.onComplete(async () => {
      setWritingStyleLearning({ taskId: null, progress: null, isLearning: false });
      await loadWritingStyles();
    });

    const removeErrorListener = window.electronAPI.writing.style.onError((data) => {
      setWritingStyleLearning({ taskId: null, progress: null, isLearning: false });
      console.error('[useWritingMaterials] Writing style learning error:', data.error);
    });

    return () => {
      removeProgressListener?.();
      removeCompleteListener?.();
      removeErrorListener?.();
    };
  }, [loadWritingStyles]);

  return {
    worldBooks,
    characters,
    personas,
    knowledgeItems,
    writingStyles,
    filteredWritingStyles,
    loading,
    searchQuery,
    setSearchQuery,
    filteredWorldBooks,
    filteredCharacters,
    filteredPersonas,
    filteredKnowledgeItems,
    loadAllMaterials,
    loadWritingStyles,
    toggleMaterial,
    toggleWritingStyle,
    getSelectedCount,
    refreshMaterials,
    writingStyleLearning,
    uploadWritingStyle,
    cancelLearning,
  };
}
