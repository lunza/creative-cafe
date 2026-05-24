import { useState, useCallback } from 'react';
import { message } from 'antd';
import {
  GeneratedOutline,
  ChapterStatus,
  AISplitSuggestion,
  AIMergeSuggestion,
  AIGenerationHistory,
} from '../../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';

interface UseChapterStructureResult {
  chapterSearch: string;
  setChapterSearch: (search: string) => void;
  aiSplitSuggestion: AISplitSuggestion | null;
  aiMergeSuggestion: AIMergeSuggestion | null;
  handleOpenSplitModal: (selectedChapterIndex: number, outline: GeneratedOutline | null) => void;
  handleSplitConfirm: (
    mode: 'content' | 'ai',
    selectedChapterIndex: number,
    splitCount: number,
    chapterContents: Record<number, string>,
    outline: GeneratedOutline | null,
    suggestion?: AISplitSuggestion
  ) => void;
  handleOpenMergeModal: (outline: GeneratedOutline | null) => void;
  handleMergeConfirm: (
    mode: 'simple' | 'ai',
    selectedIndices: number[],
    chapterContents: Record<number, string>,
    outline: GeneratedOutline | null,
    suggestion?: AIMergeSuggestion
  ) => void;
  handleRestoreHistory: (history: AIGenerationHistory) => void;
  handleBackToConfig: (onBack: () => void) => void;
}

export function useChapterStructure(
  projectId: string,
  setShowSplitModal: (visible: boolean) => void,
  setShowMergeModal: (visible: boolean) => void,
  setShowHistoryModal: (visible: boolean) => void,
  setSplitCount: (count: number) => void,
  setAiSplitSuggestion: (suggestion: AISplitSuggestion | null) => void,
  setAiMergeSuggestion: (suggestion: AIMergeSuggestion | null) => void
): UseChapterStructureResult {
  const updateProject = useWritingProjectStore((state) => state.updateProject);
  const saveProject = useWritingProjectStore((state) => state.saveProject);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);

  const [chapterSearch, setChapterSearch] = useState('');
  const [aiSplitSuggestion, setAiSplitSuggestionState] = useState<AISplitSuggestion | null>(null);
  const [aiMergeSuggestion, setAiMergeSuggestionState] = useState<AIMergeSuggestion | null>(null);

  const handleOpenSplitModal = useCallback((selectedChapterIndex: number, outline: GeneratedOutline | null) => {
    if (!outline) return;
    const currentChapter = outline.chapters[selectedChapterIndex];
    if (!currentChapter) return;
    setShowSplitModal(true);
    setSplitCount(2);
    setAiSplitSuggestionState(null);
  }, []);

  const handleSplitConfirm = useCallback((
    mode: 'content' | 'ai',
    selectedChapterIndex: number,
    splitCount: number,
    chapterContents: Record<number, string>,
    outline: GeneratedOutline | null,
    suggestion?: AISplitSuggestion
  ) => {
    if (!outline) return;
    const currentChapter = outline.chapters[selectedChapterIndex];
    if (!currentChapter) return;
    const currentContent = chapterContents[currentChapter.index] || '';

    const newChapters: typeof outline.chapters = [];
    const baseIndex = currentChapter.index;

    const splitContents: Record<number, string> = {};
    const splitStatuses: Record<number, ChapterStatus> = {};

    const actualSplitCount = suggestion ? suggestion.splitCount : splitCount;

    for (let i = 0; i < actualSplitCount; i++) {
      let content = '';
      if (mode === 'content' && currentContent) {
        const chunkSize = Math.ceil(currentContent.length / actualSplitCount);
        content = currentContent.substring(i * chunkSize, (i + 1) * chunkSize);
      }

      const title = suggestion?.titles[i] || `${currentChapter.title}（${i + 1}/${actualSplitCount}）`;
      const chapterIndex = parseFloat((baseIndex + (i + 1) * 0.1).toFixed(10));

      splitContents[chapterIndex] = content;
      splitStatuses[chapterIndex] = ChapterStatus.PENDING;

      newChapters.push({
        index: chapterIndex,
        title,
        summary: suggestion?.summaries[i] || (mode === 'content' ? `${currentChapter.summary || ''}（第 ${i + 1} 部分）` : currentChapter.summary),
        targetWordCount: suggestion?.targetWordCounts[i] || (currentChapter.targetWordCount ? Math.ceil(currentChapter.targetWordCount / actualSplitCount) : 10000),
        chapterType: currentChapter.chapterType,
        importance: currentChapter.importance,
        keyPlotPoints: suggestion?.keyPlotPoints[i] || currentChapter.keyPlotPoints,
      });
    }

    splitContents[currentChapter.index] = '';
    splitStatuses[currentChapter.index] = ChapterStatus.PENDING;

    const updatedChapters = [
      ...outline.chapters.slice(0, selectedChapterIndex),
      ...newChapters,
      ...outline.chapters.slice(selectedChapterIndex + 1)
    ];

    const newOutline: GeneratedOutline = { ...outline, chapters: updatedChapters };

    const project = getCurrentProject();
    if (project) {
      const newProjectChapters = project.chapters.slice();
      newProjectChapters.splice(selectedChapterIndex, 1, ...newChapters.map(ch => ({
        index: ch.index,
        title: ch.title,
        content: splitContents[ch.index] || '',
        status: ChapterStatus.PENDING,
        wordCount: (splitContents[ch.index] || '').length,
        lastModified: Date.now(),
        versions: []
      })));

      updateProject(project.id, { chapters: newProjectChapters, outline: newOutline });
      saveProject();
    }

    setShowSplitModal(false);
    message.success(`已将章节拆分为 ${actualSplitCount} 个子章节`);
  }, [getCurrentProject, updateProject, saveProject]);

  const handleOpenMergeModal = useCallback((outline: GeneratedOutline | null) => {
    if (!outline || outline.chapters.length < 2) return;
    setShowMergeModal(true);
    setAiMergeSuggestionState(null);
  }, []);

  const handleMergeConfirm = useCallback((
    mode: 'simple' | 'ai',
    selectedIndices: number[],
    chapterContents: Record<number, string>,
    outline: GeneratedOutline | null,
    suggestion?: AIMergeSuggestion
  ) => {
    if (!outline || selectedIndices.length < 2) return;

    const sortedIndices = selectedIndices.sort((a, b) => a - b);
    const chaptersToMerge = outline.chapters.filter(ch => sortedIndices.includes(ch.index));
    if (chaptersToMerge.length < 2) return;

    const firstChapterIndex = chaptersToMerge[0].index;
    const insertIndex = outline.chapters.findIndex(ch => ch.index === firstChapterIndex);

    let mergedContent = '';
    if (mode === 'simple') {
      mergedContent = chaptersToMerge.map(ch => chapterContents[ch.index] || '').join('\n\n---\n\n');
    } else {
      mergedContent = chapterContents[chaptersToMerge[0].index] || '';
    }

    const mergedChapter: typeof outline.chapters[0] = {
      index: firstChapterIndex,
      title: suggestion?.mergedTitle || `合并章节（${chaptersToMerge.length}章）`,
      summary: suggestion?.mergedSummary || chaptersToMerge.map(ch => ch.summary).join(' '),
      targetWordCount: suggestion?.mergedTargetWordCount || chaptersToMerge.reduce((sum, ch) => sum + (ch.targetWordCount || 2000), 0),
      chapterType: chaptersToMerge[0].chapterType,
      importance: chaptersToMerge[0].importance,
      keyPlotPoints: suggestion?.mergedKeyPlotPoints || chaptersToMerge.flatMap(ch => ch.keyPlotPoints || []),
    };

    const remainingChapters = outline.chapters.filter(ch => !sortedIndices.includes(ch.index));

    const updatedChapters = [
      ...outline.chapters.slice(0, insertIndex),
      mergedChapter,
      ...remainingChapters
    ];

    const newOutline: GeneratedOutline = { ...outline, chapters: updatedChapters };

    const mergedContents: Record<number, string> = { [firstChapterIndex]: mergedContent };
    const mergedStatuses: Record<number, ChapterStatus> = { [firstChapterIndex]: ChapterStatus.PENDING };

    const project = getCurrentProject();
    if (project) {
      const newProjectChapters = project.chapters.slice();
      newProjectChapters.splice(insertIndex, sortedIndices.length, {
        index: firstChapterIndex,
        title: mergedChapter.title,
        content: mergedContent,
        status: ChapterStatus.PENDING,
        wordCount: mergedContent.length,
        lastModified: Date.now(),
        versions: []
      });

      updateProject(project.id, { chapters: newProjectChapters, outline: newOutline });
      saveProject();
    }

    setShowMergeModal(false);
    message.success(`已合并 ${sortedIndices.length} 个章节`);
  }, [getCurrentProject, updateProject, saveProject]);

  const handleRestoreHistory = useCallback((history: AIGenerationHistory) => {
    if (history.type === 'split') {
      const suggestion = history.suggestion as AISplitSuggestion;
      setAiSplitSuggestionState(suggestion);
      setSplitCount(suggestion.splitCount);
      setShowSplitModal(true);
    } else {
      const suggestion = history.suggestion as AIMergeSuggestion;
      setAiMergeSuggestionState(suggestion);
      setShowMergeModal(true);
    }
    message.success('已回溯到历史方案');
  }, []);

  const handleBackToConfig = useCallback((onBack: () => void) => {
    const { Modal } = require('antd');
    Modal.confirm({
      title: '返回修改配置',
      content: '返回修改配置将保留当前所有内容，是否继续？',
      okText: '继续',
      cancelText: '取消',
      onOk: () => {
        onBack();
      }
    });
  }, []);

  return {
    chapterSearch,
    setChapterSearch,
    aiSplitSuggestion,
    aiMergeSuggestion,
    handleOpenSplitModal,
    handleSplitConfirm,
    handleOpenMergeModal,
    handleMergeConfirm,
    handleRestoreHistory,
    handleBackToConfig,
  };
}
