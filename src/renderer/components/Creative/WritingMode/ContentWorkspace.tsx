import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Progress, message, Spin, Menu, Typography, Dropdown, Popconfirm, Empty, Modal, Input, Divider, Layout } from 'antd';
const { Sider, Content } = Layout;
const { Text } = Typography;
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  SaveOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  MoreOutlined,
  HistoryOutlined,
  CopyOutlined,
  DeleteOutlined,
  SettingOutlined
} from '@ant-design/icons';
import {
  GeneratedOutline,
  GenerationState,
  GenerationMode,
  ChapterStatus,
  ExportFormat,
  WritingProject,
  ProjectStatus,
  ChapterVersion
} from '../../../../shared/types/writing.types';
import MarkdownEditor from '../../Common/MarkdownEditor';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import WritingProgressDashboard from './WritingProgressDashboard';

const MAX_PREVIOUS_CHAPTER_CONTENT_LENGTH = 5000;

interface ContentWorkspaceProps {
  outline: GeneratedOutline | null;
  projectId: string;
  onBack: () => void;
}

interface GenerationProgress {
  currentChapter: number;
  totalChapters: number;
  mode: GenerationMode;
}

const ContentWorkspace: React.FC<ContentWorkspaceProps> = ({ outline, projectId, onBack }) => {
  const currentProjectRef = useRef<WritingProject | null>(null);
  const updateProject = useWritingProjectStore((state) => state.updateProject);
  const saveProject = useWritingProjectStore((state) => state.saveProject);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);

  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [generationState, setGenerationState] = useState<GenerationState>(GenerationState.IDLE);
  const [streamingContent, setStreamingContent] = useState('');
  const [chapterContents, setChapterContents] = useState<Record<number, string>>({});
  const [chapterStatuses, setChapterStatuses] = useState<Record<number, ChapterStatus>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [currentChapterWords, setCurrentChapterWords] = useState(0);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistory, setVersionHistory] = useState<ChapterVersion[]>([]);
  const [comparingVersion, setComparingVersion] = useState<ChapterVersion | null>(null);
  const [exportChapters, setExportChapters] = useState<number[]>([]);
  const [chapterSearch, setChapterSearch] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const isPausedRef = useRef(false);
  const editorContentRef = useRef<string>('');
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!outline) return;
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
  }, [outline]);

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
        const currentChapter = outline.chapters.find(ch => ch.index === selectedChapterIndex);
        if (currentChapter) {
          updateProject(project.id, {
            chapters: project.chapters.map(ch =>
              ch.index === selectedChapterIndex
                ? { ...ch, content, lastModified: Date.now() }
                : ch
            ),
            metadata: {
              ...project.metadata,
              totalWordCount: project.chapters.reduce((sum, ch) =>
                sum + (ch.index === selectedChapterIndex ? content.length : ch.wordCount), 0
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

  const handleSaveChapterRef = useRef<(() => Promise<void>) | null>(null);
  const handleContinuousGenerationRef = useRef<(() => void) | null>(null);

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
      message.success(`第 ${data.chapterIndex + 1} 章生成完成`);

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

    abortControllerRef.current = new AbortController();

    const currentProject = currentProjectRef.current;
    const modelConfig = currentProject?.config?.modelConfig || {
      model: 'gpt-4o',
      temperature: 0.8,
      maxTokens: 8000
    };

    const previousChapters = outline.chapters
      .filter(ch => ch.index < chapterIndex && chapterContents[ch.index])
      .map(ch => ({
        index: ch.index,
        title: ch.title,
        summary: ch.summary || ch.title,
        fullContent: (chapterContents[ch.index] || '').substring(0, MAX_PREVIOUS_CHAPTER_CONTENT_LENGTH)
      }));

    const novelType = currentProject?.config?.parameters?.novelType || 'web_novel';
    const writingStyle = currentProject?.config?.parameters?.writingStyle || 'serious';
    const perspective = currentProject?.config?.parameters?.narrativePerspective || 'third_person';

    const request = {
      projectId,
      chapterIndex,
      chapterInfo: {
        index: chapter.index,
        title: chapter.title,
        outline: chapter.summary,
        characters: chapter.characters,
        scenes: chapter.scenes
      },
      previousChapters,
      worldBookContext: [],
      characterContext: [],
      generationParams: {
        targetWordCount: chapter.targetWordCount,
        style: writingStyle,
        perspective: perspective,
        novelType,
        constraints: []
      },
      modelConfig
    };

    try {
      await window.electronAPI?.writing?.generateChapter(request);
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
  }, [outline, isGenerating, chapterContents, projectId]);

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
    const content = editorContentRef.current || streamingContent || chapterContents[selectedChapterIndex] || '';
    if (!content) {
      message.warning('当前章节内容为空');
      return;
    }

    if (window.electronAPI?.writing) {
      await window.electronAPI.writing.autoSaveChapter({ projectId, chapterIndex: selectedChapterIndex, content });
      setChapterContents(prev => ({ ...prev, [selectedChapterIndex]: content }));
      const project = getCurrentProject();
      if (project) {
        updateProject(project.id, {
          chapters: project.chapters.map(ch =>
            ch.index === selectedChapterIndex
              ? { ...ch, content, status: ChapterStatus.COMPLETED, wordCount: content.length, lastModified: Date.now() }
              : ch
          ),
          metadata: {
            ...project.metadata,
            totalWordCount: project.chapters.reduce((sum, ch) =>
              sum + (ch.index === selectedChapterIndex ? content.length : ch.wordCount), 0
            ),
            completedChapters: project.chapters.filter(ch => ch.index === selectedChapterIndex || ch.status === ChapterStatus.COMPLETED).length
          }
        });
        saveProject();
      }
      message.success('已保存');
    }
  }, [streamingContent, chapterContents, selectedChapterIndex, projectId, getCurrentProject, updateProject, saveProject]);

  const handleSaveVersion = useCallback(async () => {
    const content = streamingContent || chapterContents[selectedChapterIndex] || '';
    if (!content) {
      message.warning('当前章节内容为空');
      return;
    }
    if (window.electronAPI?.writing) {
      const result = await window.electronAPI.writing.saveVersion({ projectId, chapterIndex: selectedChapterIndex, content });
      if (result.success) {
        message.success('版本已保存');
      }
    }
  }, [streamingContent, chapterContents, selectedChapterIndex, projectId]);

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (window.electronAPI?.writing) {
      const result = await window.electronAPI.writing.restoreVersion({ projectId, chapterIndex: selectedChapterIndex, versionId });
      if (result.success) {
        message.success('版本已恢复');
        const project = useWritingProjectStore.getState().getCurrentProject();
        if (project) {
          const chapter = project.chapters.find(c => c.index === selectedChapterIndex);
          if (chapter) {
            setChapterContents(prev => ({ ...prev, [selectedChapterIndex]: chapter.content }));
          }
        }
        setShowVersionHistory(false);
      }
    }
  }, [selectedChapterIndex, projectId]);

  const handleShowVersionHistory = useCallback(() => {
    const project = useWritingProjectStore.getState().getCurrentProject();
    if (project) {
      const chapter = project.chapters.find(c => c.index === selectedChapterIndex);
      if (chapter && chapter.versions && chapter.versions.length > 0) {
        setVersionHistory([...chapter.versions].reverse());
        setShowVersionHistory(true);
      } else {
        message.info('暂无版本历史');
      }
    }
  }, [selectedChapterIndex]);

  const handleExport = useCallback(async (format: ExportFormat) => {
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

  const handleExportWithSelection = useCallback(async (format: ExportFormat) => {
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

  const handleRegenerateChapter = useCallback(() => {
    handleGenerateChapter(selectedChapterIndex);
  }, [selectedChapterIndex, handleGenerateChapter]);

  const handleBackToConfig = useCallback(() => {
    Modal.confirm({
      title: '返回修改配置',
      content: '返回修改配置将保留当前所有内容，是否继续？',
      okText: '继续',
      cancelText: '取消',
      onOk: () => {
        onBack();
      }
    });
  }, [onBack]);

  if (!outline) {
    return <div style={{ padding: 24 }}>未找到大纲信息</div>;
  }

  const completedChapters = Object.values(chapterStatuses).filter(s => s === ChapterStatus.COMPLETED).length;
  const totalChapters = outline.chapters.length;
  const overallProgress = Math.round((completedChapters / totalChapters) * 100);

  const currentChapter = outline.chapters[selectedChapterIndex];
  const currentWordCount = (streamingContent || chapterContents[selectedChapterIndex] || '').length;
  if (!currentChapter) {
    return <div style={{ padding: 24 }}>未找到章节信息</div>;
  }

  const targetWordCount = currentChapter?.targetWordCount || 2000;
  const wordCountPercentage = Math.min((currentWordCount / targetWordCount) * 100, 100);
  const wordCountColor = wordCountPercentage >= 90 ? '#52c41a' : wordCountPercentage >= 50 ? '#faad14' : '#f5222d';

  const filteredChapters = outline.chapters.filter(ch =>
    !chapterSearch ||
    ch.title.toLowerCase().includes(chapterSearch.toLowerCase()) ||
    (ch.summary || '').toLowerCase().includes(chapterSearch.toLowerCase())
  );

  return (
    <Layout style={{ height: '100%' }}>
      <style>{`
        @keyframes writing-cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes writing-cursor-blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0.3; }
          }
        }
      `}</style>
      <Sider width={250} theme="light" style={{ borderRight: '1px solid #e8e8e8' }}>
        <div style={{ padding: '12px 16px' }}>
          <Text strong>章节导航</Text>
          <Progress
            percent={overallProgress}
            format={() => `${completedChapters}/${totalChapters}章`}
            size="small"
            style={{ marginTop: 8 }}
          />
          {generationProgress && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                连续生成中: 第 {generationProgress.currentChapter + 1}/{generationProgress.totalChapters} 章
              </Text>
            </div>
          )}
        </div>
        <Input.Search
          placeholder="搜索章节"
          value={chapterSearch}
          onChange={(e) => setChapterSearch(e.target.value)}
          style={{ margin: '0 16px 8px 16px', width: 'calc(100% - 32px)' }}
        />
        <Menu
          mode="inline"
          selectedKeys={[String(selectedChapterIndex)]}
          onClick={({ key }) => setSelectedChapterIndex(parseInt(key))}
          items={filteredChapters.map(ch => ({
            key: String(ch.index),
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span style={{ flex: 1 }}>{ch.title}</span>
                <span style={{ fontSize: 10, marginLeft: 8 }}>
                  {chapterStatuses[ch.index] === ChapterStatus.COMPLETED && <span style={{ color: '#52c41a' }}>✓</span>}
                  {chapterStatuses[ch.index] === ChapterStatus.GENERATING && <Spin size="small" />}
                  {chapterStatuses[ch.index] === ChapterStatus.FAILED && <span style={{ color: '#ff4d4f' }}>✗</span>}
                </span>
              </div>
            ),
            disabled: chapterStatuses[ch.index] === ChapterStatus.GENERATING
          }))}
          style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto' }}
        />
      </Sider>
      <Layout>
        <Content style={{ padding: 16, overflow: 'auto' }}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{currentChapter?.title || '章节'}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>{currentWordCount} 字</Text>
              </div>
            }
            extra={
              <div style={{ display: 'flex', gap: 8 }}>
                {!isGenerating ? (
                  <>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleGenerateChapter(selectedChapterIndex)}
                      disabled={!currentChapter || chapterStatuses[selectedChapterIndex] === ChapterStatus.GENERATING}
                    >
                      生成
                    </Button>
                    <Button
                      icon={<ThunderboltOutlined />}
                      onClick={handleContinuousGeneration}
                      disabled={completedChapters >= totalChapters}
                    >
                      连续生成
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={handleRegenerateChapter}
                      disabled={!chapterContents[selectedChapterIndex] && !streamingContent}
                    >
                      重新生成
                    </Button>
                    <Dropdown menu={{
                      items: [
                        { key: 'txt', label: 'TXT', onClick: () => handleExport(ExportFormat.TXT) },
                        { key: 'md', label: 'Markdown', onClick: () => handleExport(ExportFormat.MARKDOWN) },
                        { key: 'json', label: 'JSON', onClick: () => handleExport(ExportFormat.JSON) },
                      ]
                    }}>
                      <Button icon={<ExportOutlined />}>导出</Button>
                    </Dropdown>
                  </>
                ) : (
                  <>
                    {isPaused ? (
                      <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleResumeGeneration}>
                        继续
                      </Button>
                    ) : (
                      <Button icon={<PauseCircleOutlined />} onClick={handlePauseGeneration}>
                        暂停
                      </Button>
                    )}
                    <Popconfirm title="确定要停止生成吗？已生成的内容将被保留。" onConfirm={handleStopGeneration}>
                      <Button danger icon={<StopOutlined />}>停止</Button>
                    </Popconfirm>
                  </>
                )}
                <Button icon={<SaveOutlined />} onClick={handleSaveChapter}>保存</Button>
                <Dropdown menu={{
                  items: [
                    { key: 'saveVersion', label: '保存版本', icon: <HistoryOutlined />, onClick: handleSaveVersion },
                    { key: 'versionHistory', label: '版本历史', icon: <HistoryOutlined />, onClick: handleShowVersionHistory },
                  ]
                }}>
                  <Button icon={<MoreOutlined />}>版本</Button>
                </Dropdown>
                <Button icon={<SettingOutlined />} onClick={handleBackToConfig}>调整参数</Button>
              </div>
            }
          >
            {isGenerating && generationState === GenerationState.GENERATING ? (
              <div style={{ minHeight: 400 }}>
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary">正在生成中... 已生成 {currentChapterWords} 字</Text>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontFamily: 'monospace', fontSize: 14 }}>
                  {streamingContent}
                  <span style={{
                    display: 'inline-block',
                    width: 2,
                    height: 16,
                    background: '#1890ff',
                    animation: 'writing-cursor-blink 1s steps(1) infinite'
                  }} />
                </div>
              </div>
            ) : (
              <>
                <MarkdownEditor
                  key={selectedChapterIndex}
                  value={chapterContents[selectedChapterIndex] || ''}
                  onChange={handleEditorChange}
                  readOnly={false}
                />
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>字数: {currentWordCount.toLocaleString()} / {targetWordCount.toLocaleString()}</span>
                  <Progress percent={Math.round(wordCountPercentage)} size="small" style={{ width: 120 }} strokeColor={wordCountColor} />
                </div>
              </>
            )}
          </Card>
        </Content>
      </Layout>
      
      <Modal
        title="版本历史"
        open={showVersionHistory}
        onCancel={() => setShowVersionHistory(false)}
        footer={null}
        width={500}
      >
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {versionHistory.map(v => (
            <div key={v.id} style={{ padding: '8px 12px', marginBottom: 8, background: '#f9f9f9', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div>{v.note}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>{new Date(v.timestamp).toLocaleString()} · {v.content.length} 字</Text>
              </div>
              <Button size="small" onClick={() => handleRestoreVersion(v.id)}>恢复</Button>
            </div>
          ))}
          {versionHistory.length === 0 && <Empty description="暂无版本" size="small" />}
        </div>
      </Modal>
    </Layout>
  );
};

export default ContentWorkspace;
