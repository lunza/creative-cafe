import { useState, useCallback } from 'react';
import { message } from 'antd';
import { GeneratedOutline, PlotCheckReport } from '../../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../../stores/writingProjectStore';

interface UsePlotCheckResult {
  plotCheckReport: PlotCheckReport | null;
  plotCheckLoading: boolean;
  logicRecords: any[];
  logicRecordsLoading: boolean;
  autoFixResult: any;
  pendingFixIssue: any;
  pendingFixType: 'dimension' | 'logic';
  pendingFixContent: string;
  handlePlotCheck: (
    chapterIndex: number,
    chapterContents: Record<number, string>,
    outline: GeneratedOutline | null,
    projectId: string
  ) => Promise<void>;
  handleAutoFix: (
    chapterIndex: number,
    chapterContent: string,
    issue: any,
    issueType: 'dimension' | 'logic',
    projectId: string,
    outline: GeneratedOutline | null,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    editorContentRef: React.MutableRefObject<string>
  ) => Promise<{ success: boolean; fixedContent?: string; error?: string }>;
  handleContentUpdated: (
    chapterIndex: number,
    fixedContent: string,
    chapterContents: Record<number, string>,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    editorContentRef: React.MutableRefObject<string>
  ) => void;
  handleAcceptFix: () => void;
  handleRejectFix: (
    chapterIndex: number,
    outline: GeneratedOutline | null,
    editorContentRef: React.MutableRefObject<string>,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>
  ) => void;
  handleViewLogicRecords: () => Promise<void>;
}

export function usePlotCheck(
  projectId: string,
  setShowFixResultModal: (visible: boolean) => void,
  setShowPlotCheckModal: (visible: boolean) => void,
  setShowLogicRecordsModal: (visible: boolean) => void
): UsePlotCheckResult {
  const updateProject = useWritingProjectStore((state) => state.updateProject);
  const saveProject = useWritingProjectStore((state) => state.saveProject);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);

  const [plotCheckReport, setPlotCheckReport] = useState<PlotCheckReport | null>(null);
  const [plotCheckLoading, setPlotCheckLoading] = useState(false);
  const [logicRecords, setLogicRecords] = useState<any[]>([]);
  const [logicRecordsLoading, setLogicRecordsLoading] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState<any>(null);
  const [pendingFixIssue, setPendingFixIssue] = useState<any>(null);
  const [pendingFixType, setPendingFixType] = useState<'dimension' | 'logic'>('dimension');
  const [pendingFixContent, setPendingFixContent] = useState('');

  const handlePlotCheck = useCallback(async (
    chapterIndex: number,
    chapterContents: Record<number, string>,
    outline: GeneratedOutline | null,
    projectId: string
  ) => {
    const currentChapter = outline?.chapters.find(ch => ch.index === chapterIndex);
    if (!currentChapter) return;
    
    const content = chapterContents[currentChapter.index] || '';
    if (!content.trim()) {
      message.warning('章节内容为空，无法检查');
      return;
    }

    setPlotCheckLoading(true);
    try {
      const previousChapters = outline.chapters
        .filter(ch => ch.index < currentChapter.index)
        .map(ch => ({
          index: ch.index,
          title: ch.title,
          content: chapterContents[ch.index] || ''
        }));

      const result = await window.electronAPI.writing.checkChapter({
        projectId,
        chapterIndex: currentChapter.index,
        content,
        previousChapters: previousChapters.length > 0 ? previousChapters : undefined
      });

      if (result.success && result.report) {
        setPlotCheckReport(result.report);
        setShowPlotCheckModal(true);
      } else {
        message.error(result.error || '剧情检查失败');
      }
    } catch (error) {
      message.error('剧情检查失败');
    } finally {
      setPlotCheckLoading(false);
    }
  }, []);

  const handleAutoFix = useCallback(async (
    chapterIndex: number,
    chapterContent: string,
    issue: any,
    issueType: 'dimension' | 'logic',
    projectId: string,
    outline: GeneratedOutline | null,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    editorContentRef: React.MutableRefObject<string>
  ): Promise<{ success: boolean; fixedContent?: string; error?: string }> => {
    const currentChapter = outline?.chapters.find(ch => ch.index === chapterIndex);
    if (!currentChapter) {
      return { success: false, error: '未找到当前章节' };
    }

    try {
      const result = await window.electronAPI.writing.autoFixIssue({
        projectId,
        chapterIndex: currentChapter.index,
        content: chapterContent,
        issue,
      });

      if (result.success) {
        setAutoFixResult(result);
        setPendingFixIssue(issue);
        setPendingFixType(issueType);
        setPendingFixContent(chapterContent);
        setShowFixResultModal(true);
        
        setChapterContents(prev => ({ ...prev, [currentChapter.index]: result.fixedContent }));
        editorContentRef.current = result.fixedContent;
        
        const project = getCurrentProject();
        if (project) {
          updateProject(project.id, {
            chapters: project.chapters.map(ch =>
              ch.index === currentChapter.index
                ? { ...ch, content: result.fixedContent, lastModified: Date.now() }
                : ch
            ),
          });
          saveProject();
        }
        
        return { success: true, fixedContent: result.fixedContent };
      } else {
        message.error(result.error || '自动修正失败');
        return { success: false, error: result.error };
      }
    } catch (error) {
      message.error('自动修正请求失败');
      return { success: false, error: '请求失败' };
    }
  }, [getCurrentProject, updateProject, saveProject]);

  const handleContentUpdated = useCallback((
    chapterIndex: number,
    fixedContent: string,
    chapterContents: Record<number, string>,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    editorContentRef: React.MutableRefObject<string>
  ) => {
    const currentChapter = chapterContents[chapterIndex] !== undefined ? { index: chapterIndex } : null;
    if (!currentChapter) return;

    setChapterContents(prev => ({ ...prev, [chapterIndex]: fixedContent }));
    editorContentRef.current = fixedContent;

    const project = getCurrentProject();
    if (project) {
      updateProject(project.id, {
        chapters: project.chapters.map(ch =>
          ch.index === chapterIndex
            ? { ...ch, content: fixedContent, lastModified: Date.now() }
            : ch
        ),
        metadata: {
          ...project.metadata,
          totalWordCount: project.chapters.reduce((sum, ch) =>
            sum + (ch.index === chapterIndex ? fixedContent.length : ch.wordCount), 0
          ),
        }
      });
    }
  }, [getCurrentProject, updateProject]);

  const handleAcceptFix = useCallback(() => {
    setShowFixResultModal(false);
    message.success('修正已应用到编辑器');
  }, []);

  const handleRejectFix = useCallback((
    chapterIndex: number,
    outline: GeneratedOutline | null,
    editorContentRef: React.MutableRefObject<string>,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>
  ) => {
    const currentChapter = outline?.chapters.find(ch => ch.index === chapterIndex);
    if (pendingFixContent && currentChapter) {
      setChapterContents(prev => ({ ...prev, [chapterIndex]: pendingFixContent }));
      editorContentRef.current = pendingFixContent;
      
      const project = getCurrentProject();
      if (project) {
        updateProject(project.id, {
          chapters: project.chapters.map(ch =>
            ch.index === currentChapter.index
              ? { ...ch, content: pendingFixContent, lastModified: Date.now() }
              : ch
          ),
        });
        saveProject();
      }
    }
    setShowFixResultModal(false);
    message.info('已拒绝修正，内容已恢复');
  }, [pendingFixContent, getCurrentProject, updateProject, saveProject]);

  const handleViewLogicRecords = useCallback(async () => {
    setShowLogicRecordsModal(true);
    setLogicRecordsLoading(true);
    try {
      const result = await window.electronAPI.writing.getLogicCheckRecords();
      if (result.success) {
        setLogicRecords(result.records || []);
      } else {
        message.error(result.error || '获取逻辑记录失败');
      }
    } catch (error) {
      message.error('获取逻辑记录失败');
    } finally {
      setLogicRecordsLoading(false);
    }
  }, []);

  return {
    plotCheckReport,
    plotCheckLoading,
    logicRecords,
    logicRecordsLoading,
    autoFixResult,
    pendingFixIssue,
    pendingFixType,
    pendingFixContent,
    handlePlotCheck,
    handleAutoFix,
    handleContentUpdated,
    handleAcceptFix,
    handleRejectFix,
    handleViewLogicRecords,
  };
}
