import { useState, useCallback } from 'react';
import { message } from 'antd';
import { GeneratedOutline, ChapterVersion } from '../../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';

interface UseVersionManagementResult {
  showVersionHistory: boolean;
  setShowVersionHistory: (visible: boolean) => void;
  versionHistory: ChapterVersion[];
  comparingVersion: ChapterVersion | null;
  exportChapters: number[];
  setExportChapters: (chapters: number[]) => void;
  handleSaveVersion: (selectedChapterIndex: number, streamingContent: string, chapterContents: Record<number, string>) => Promise<void>;
  handleRestoreVersion: (versionId: string, selectedChapterIndex: number, outline: GeneratedOutline | null) => Promise<void>;
  handleShowVersionHistory: (selectedChapterIndex: number, outline: GeneratedOutline | null) => void;
  handleExport: (projectId: string, format: any) => Promise<void>;
  handleExportWithSelection: (projectId: string, format: any) => Promise<void>;
}

export function useVersionManagement(
  projectId: string,
  outline: GeneratedOutline | null
): UseVersionManagementResult {
  const updateProject = useWritingProjectStore((state) => state.updateProject);
  const saveProject = useWritingProjectStore((state) => state.saveProject);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistory, setVersionHistory] = useState<ChapterVersion[]>([]);
  const [comparingVersion, setComparingVersion] = useState<ChapterVersion | null>(null);
  const [exportChapters, setExportChapters] = useState<number[]>([]);

  const handleSaveVersion = useCallback(async (
    selectedChapterIndex: number,
    streamingContent: string,
    chapterContents: Record<number, string>
  ) => {
    const currentChapter = outline?.chapters[selectedChapterIndex];
    if (!currentChapter) return;
    const content = streamingContent || chapterContents[currentChapter.index] || '';
    if (!content) {
      message.warning('当前章节内容为空');
      return;
    }
    if (window.electronAPI?.writing) {
      const result = await window.electronAPI.writing.saveVersion({ projectId, chapterIndex: currentChapter.index, content });
      if (result.success) {
        message.success('版本已保存');
      }
    }
  }, [outline, projectId]);

  const handleRestoreVersion = useCallback(async (
    versionId: string,
    selectedChapterIndex: number,
    outline: GeneratedOutline | null
  ) => {
    if (window.electronAPI?.writing) {
      const currentChapter = outline?.chapters[selectedChapterIndex];
      if (!currentChapter) return;
      const result = await window.electronAPI.writing.restoreVersion({ projectId, chapterIndex: currentChapter.index, versionId });
      if (result.success) {
        message.success('版本已恢复');
        const project = useWritingProjectStore.getState().getCurrentProject();
        if (project) {
          const chapter = project.chapters.find(c => c.index === currentChapter.index);
          if (chapter) {
          }
        }
        setShowVersionHistory(false);
      }
    }
  }, [projectId, outline]);

  const handleShowVersionHistory = useCallback((
    selectedChapterIndex: number,
    outline: GeneratedOutline | null
  ) => {
    const project = useWritingProjectStore.getState().getCurrentProject();
    if (project) {
      const chapter = outline?.chapters[selectedChapterIndex];
      const projectChapter = project.chapters.find(c => c.index === chapter?.index);
      if (projectChapter && projectChapter.versions && projectChapter.versions.length > 0) {
        setVersionHistory([...projectChapter.versions].reverse());
        setShowVersionHistory(true);
      } else {
        message.info('暂无版本历史');
      }
    }
  }, [outline]);

  const handleExport = useCallback(async (format: any) => {
    if (window.electronAPI?.writing) {
      try {
        const result = await window.electronAPI.writing.exportProject(projectId, format);
        if (result.success) {
          message.success(`导出成功`);
        }
      } catch (error: any) {
        message.error(error.message || '导出失败');
      }
    }
  }, [projectId]);

  const handleExportWithSelection = useCallback(async (format: any) => {
    if (exportChapters.length === 0) {
      await handleExport(format);
      return;
    }
    
    const project = getCurrentProject();
    if (!project) return;
    
    const filteredChapters = project.chapters.filter(ch => exportChapters.includes(ch.index));
    
    if (window.electronAPI?.writing) {
      try {
        const result = await window.electronAPI.writing.exportProjectWithChapters(
          projectId, 
          format, 
          filteredChapters.map(ch => ch.index)
        );
        if (result.success) {
          message.success('导出成功');
        }
      } catch (error: any) {
        message.error(error.message || '导出失败');
      }
    }
  }, [exportChapters, getCurrentProject, handleExport, projectId]);

  return {
    showVersionHistory,
    setShowVersionHistory,
    versionHistory,
    comparingVersion,
    exportChapters,
    setExportChapters,
    handleSaveVersion,
    handleRestoreVersion,
    handleShowVersionHistory,
    handleExport,
    handleExportWithSelection,
  };
}
