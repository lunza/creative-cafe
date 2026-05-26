import { useState, useCallback } from 'react';
import { message } from 'antd';
import { GeneratedOutline, PlotCheckReport, PlotCheckDimension, LogicContradictionType, BatchFixIssueInfo, PLOT_CHECK_DIMENSION_LABELS, LOGIC_CONTRADICTION_TYPE_LABELS } from '../../../../../shared/types/writing.types';
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
  handleClearLogicRecords: () => Promise<void>;
  handleBatchFix: (
    chapterIndex: number,
    chapterContent: string,
    selectedIssues: Array<{ key: string; issue: any; issueType: 'dimension' | 'logic' }>,
    projectId: string,
    outline: GeneratedOutline | null,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    editorContentRef: React.MutableRefObject<string>
  ) => Promise<{ success: boolean; fixedContent?: string; results?: Array<{ index: number; success: boolean; error?: string }>; error?: string }>;
  handleQuickFix: (
    chapterContent: string,
    issue: any
  ) => void;
  pendingQuickFixSuggestion: any;
  pendingQuickFixIssue: any;
  pendingQuickFixContent: string;
  handleAcceptQuickFix: (
    chapterIndex: number,
    outline: GeneratedOutline | null,
    editorContentRef: React.MutableRefObject<string>,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    onRecheck?: () => void
  ) => void;
  handleRejectQuickFix: () => void;
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
  const [pendingQuickFixSuggestion, setPendingQuickFixSuggestion] = useState<any>(null);
  const [pendingQuickFixIssue, setPendingQuickFixIssue] = useState<any>(null);
  const [pendingQuickFixType, setPendingQuickFixType] = useState<'dimension' | 'logic'>('dimension');
  const [pendingQuickFixContent, setPendingQuickFixContent] = useState('');

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
        issueType,
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
    // Update the report to mark the issue as corrected
    setPlotCheckReport(prev => {
      if (!prev || !pendingFixIssue) return prev;
      
      const updatedReport = { ...prev };
      updatedReport.dimensions = updatedReport.dimensions.map(dim => ({
        ...dim,
        issues: dim.issues.map(issue => {
          if (issue === pendingFixIssue) {
            return {
              ...issue,
              corrected: true,
              correctedText: pendingFixIssue.quickFixSuggestion?.fixedText || pendingFixIssue.suggestion || '已修正'
            };
          }
          return issue;
        })
      }));

      if (updatedReport.logicCheckResult) {
        updatedReport.logicCheckResult = {
          ...updatedReport.logicCheckResult,
          issues: updatedReport.logicCheckResult.issues.map(issue => {
            if (issue === pendingFixIssue) {
              return {
                ...issue,
                corrected: true,
                correctedText: pendingFixIssue.quickFixSuggestion?.fixedText || pendingFixIssue.suggestion || '已修正'
              };
            }
            return issue;
          })
        };
      }

      return updatedReport;
    });
    
    setShowFixResultModal(false);
    message.success('修正已应用到编辑器');
  }, [pendingFixIssue]);

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

  const handleQuickFix = useCallback((
    chapterContent: string,
    issue: any
  ) => {
    if (!issue.quickFixSuggestion) {
      message.warning('该问题暂无快速修正建议');
      return;
    }

    setPendingQuickFixSuggestion(issue.quickFixSuggestion);
    setPendingQuickFixIssue(issue);
    setPendingQuickFixContent(chapterContent);
  }, []);

  const handleAcceptQuickFix = useCallback((
    chapterIndex: number,
    outline: GeneratedOutline | null,
    editorContentRef: React.MutableRefObject<string>,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    onRecheck?: () => void
  ) => {
    const currentChapter = outline?.chapters.find(ch => ch.index === chapterIndex);
    if (pendingQuickFixSuggestion && currentChapter && pendingQuickFixContent) {
      const newContent = pendingQuickFixContent.replace(
        pendingQuickFixSuggestion.originalText,
        pendingQuickFixSuggestion.fixedText
      );

      setChapterContents(prev => ({ ...prev, [chapterIndex]: newContent }));
      editorContentRef.current = newContent;

      const project = getCurrentProject();
      if (project) {
        updateProject(project.id, {
          chapters: project.chapters.map(ch =>
            ch.index === currentChapter.index
              ? { ...ch, content: newContent, lastModified: Date.now() }
              : ch
          ),
        });
        saveProject();
      }

      // Update the report to mark the issue as corrected
      setPlotCheckReport(prev => {
        if (!prev) return prev;
        
        const updatedReport = { ...prev };
        updatedReport.dimensions = updatedReport.dimensions.map(dim => ({
          ...dim,
          issues: dim.issues.map(issue => {
            if (pendingQuickFixIssue && issue === pendingQuickFixIssue) {
              return {
                ...issue,
                corrected: true,
                correctedText: pendingQuickFixSuggestion.fixedText
              };
            }
            return issue;
          })
        }));

        if (updatedReport.logicCheckResult) {
          updatedReport.logicCheckResult = {
            ...updatedReport.logicCheckResult,
            issues: updatedReport.logicCheckResult.issues.map(issue => {
              if (pendingQuickFixIssue && issue === pendingQuickFixIssue) {
                return {
                  ...issue,
                  corrected: true,
                  correctedText: pendingQuickFixSuggestion.fixedText
                };
              }
              return issue;
            })
          };
        }

        return updatedReport;
      });

      message.success('快速修正已应用');

      if (onRecheck) {
        onRecheck();
      }
    }

    setPendingQuickFixSuggestion(null);
    setPendingQuickFixIssue(null);
    setPendingQuickFixContent('');
  }, [pendingQuickFixSuggestion, pendingQuickFixContent, pendingQuickFixIssue, getCurrentProject, updateProject, saveProject]);

  const handleRejectQuickFix = useCallback(() => {
    setPendingQuickFixSuggestion(null);
    setPendingQuickFixIssue(null);
    setPendingQuickFixContent('');
    message.info('已拒绝快速修正');
  }, []);

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

  const handleClearLogicRecords = useCallback(async () => {
    try {
      const result = await window.electronAPI.writing.clearLogicCheckRecords();
      if (result.success) {
        message.success('已清空逻辑矛盾记录');
        setLogicRecords([]);
      } else {
        message.error(result.error || '清空逻辑记录失败');
      }
    } catch (error) {
      message.error('清空逻辑记录失败');
    }
  }, []);

  const handleBatchFix = useCallback(async (
    chapterIndex: number,
    chapterContent: string,
    selectedIssues: Array<{ key: string; issue: any; issueType: 'dimension' | 'logic' }>,
    projectId: string,
    outline: GeneratedOutline | null,
    setChapterContents: React.Dispatch<React.SetStateAction<Record<number, string>>>,
    editorContentRef: React.MutableRefObject<string>
  ): Promise<{ success: boolean; fixedContent?: string; results?: Array<{ index: number; success: boolean; error?: string }>; error?: string }> => {
    const currentChapter = outline?.chapters.find(ch => ch.index === chapterIndex);
    if (!currentChapter) {
      return { success: false, error: '未找到当前章节' };
    }

    const issues: BatchFixIssueInfo[] = selectedIssues.map(({ issue, issueType }) => {
      const info: BatchFixIssueInfo = {
        severity: issue.severity || 'low',
        description: issue.description || '',
        suggestion: issue.suggestion || '',
        position: issue.position || undefined,
        originalText: issue.originalText || undefined,
        references: issue.references || undefined,
      };

      if (issueType === 'dimension') {
        info.dimension = issue.dimension as PlotCheckDimension;
        info.title = issue.title || '';
      } else {
        info.type = issue.type as LogicContradictionType;
        info.analysis = issue.analysis || '';
      }

      return info;
    });

    try {
      const result = await window.electronAPI.writing.batchFixIssues({
        projectId,
        chapterIndex: currentChapter.index,
        content: chapterContent,
        issues,
      });

      if (result.success && result.fixedContent) {
        setAutoFixResult(result);
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

        return { success: true, fixedContent: result.fixedContent, results: result.results };
      } else {
        message.error(result.error || '批量修正失败');
        return { success: false, error: result.error };
      }
    } catch (error) {
      message.error('批量修正请求失败');
      return { success: false, error: '请求失败' };
    }
  }, [getCurrentProject, updateProject, saveProject]);

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
    handleBatchFix,
    handleContentUpdated,
    handleAcceptFix,
    handleRejectFix,
    handleViewLogicRecords,
    handleClearLogicRecords,
    pendingQuickFixSuggestion,
    pendingQuickFixIssue,
    pendingQuickFixContent,
    handleQuickFix,
    handleAcceptQuickFix,
    handleRejectQuickFix,
  };
}
