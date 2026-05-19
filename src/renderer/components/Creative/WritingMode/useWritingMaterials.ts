import { useState, useCallback, useEffect, useRef } from 'react';
import { MaterialItem, MaterialType } from '../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

interface UseWritingMaterialsReturn {
  worldBooks: MaterialItem[];
  characters: MaterialItem[];
  personas: MaterialItem[];
  knowledgeItems: MaterialItem[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredWorldBooks: MaterialItem[];
  filteredCharacters: MaterialItem[];
  filteredPersonas: MaterialItem[];
  filteredKnowledgeItems: MaterialItem[];
  loadAllMaterials: () => Promise<void>;
  toggleMaterial: (type: MaterialType, id: string) => void;
  getSelectedCount: (type: MaterialType) => number;
  refreshMaterials: () => void;
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

  const getSelectedIds = useCallback((): { worldBookIds: string[]; characterCardIds: string[]; userPersonaIds: string[]; knowledgeItemIds: string[] } => {
    const config = currentProject?.config?.resources;
    return {
      worldBookIds: config?.worldBookIds || [],
      characterCardIds: config?.characterCardIds || [],
      userPersonaIds: config?.userPersonaIds || [],
      knowledgeItemIds: config?.knowledgeItemIds || [],
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

      const [wbResult, charResult, personaResult, kbResult] = await Promise.all([
        wbPromise, charPromise, personaPromise, kbPromise,
      ]);

      const wbList = Array.isArray(wbResult) ? wbResult : [];
      const chList = Array.isArray(charResult) ? charResult : [];
      const paList = Array.isArray(personaResult) ? personaResult : [];
      const kbList = (kbResult?.success && Array.isArray(kbResult.items)) ? kbResult.items : [];

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

      setWorldBooks(mappedWorldBooks);
      setCharacters(mappedCharacters);
      setPersonas(mappedPersonas);
      setKnowledgeItems(mappedKnowledge);
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
      }
    },
    [worldBooks, characters, personas, knowledgeItems]
  );

  const refreshMaterials = useCallback(() => {
    loadAllMaterials();
  }, [loadAllMaterials]);

  return {
    worldBooks,
    characters,
    personas,
    knowledgeItems,
    loading,
    searchQuery,
    setSearchQuery,
    filteredWorldBooks,
    filteredCharacters,
    filteredPersonas,
    filteredKnowledgeItems,
    loadAllMaterials,
    toggleMaterial,
    getSelectedCount,
    refreshMaterials,
  };
}
