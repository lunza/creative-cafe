import React from 'react';
import { Card, Button, Progress, message, Spin, Menu, Typography, Dropdown, Popconfirm, Empty, Modal, Input, Layout, Table, Tag, Tooltip } from 'antd';
const { Sider, Content } = Layout;
const { Text } = Typography;
import {
  PlayCircleOutlined,
  StopOutlined,
  SaveOutlined,
  ExportOutlined,
  ReloadOutlined,
  DeleteOutlined,
  SearchOutlined,
  FileTextOutlined,
  TableOutlined,
  AppstoreOutlined,
  CloseOutlined,
  RobotOutlined
} from '@ant-design/icons';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  ExportFormat,
  PlotCheckIssue,
  LogicCheckIssue,
  RegenerationSuggestion,
  ChapterOutline,
} from '../../../../shared/types/writing.types';
import StreamingTextEditor, { StreamingTextEditorRef } from './StreamingTextEditor';
import GenerationProgressPanel from './GenerationProgressPanel';
import ShardDetailPanel from './ShardDetailPanel';
import AutoFixResultModal from './AutoFixResultModal';
import QuickFixSuggestionModal from './QuickFixSuggestionModal';
import GenerationSuggestionModal from './GenerationSuggestionModal';
import RegenerationSuggestionModal from './RegenerationSuggestionModal';
import WritingModeRightPanel from './WritingModeRightPanel';
import WritingAgentModal from './WritingAgentModal';
import { useChapterGeneration } from './hooks/useChapterGeneration';
import { useModalStates } from './hooks/useModalStates';
import { usePlotCheck } from './hooks/usePlotCheck';
import { useChapterStructure } from './hooks/useChapterStructure';
import { useWritingModeUIStore, LayoutMode, RightPanelTab } from '../../../stores/writingModeUIStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { useWritingModeStore } from '../../../stores/writingModeStore';

interface ContentWorkspaceProps {
  outline: GeneratedOutline | null;
  projectId: string;
  onBack: () => void;
}

const ContentWorkspace: React.FC<ContentWorkspaceProps> = ({ outline, projectId }) => {
  const modalStates = useModalStates();

  const chapterGeneration = useChapterGeneration(outline, projectId);
  const plotCheck = usePlotCheck(
    projectId,
    modalStates.setShowFixResultModal,
    modalStates.setShowPlotCheckModal,
    modalStates.setShowLogicRecordsModal
  );
  const chapterStructure = useChapterStructure(
    projectId,
    modalStates.setShowSplitModal,
    modalStates.setShowMergeModal,
    modalStates.setShowHistoryModal,
    modalStates.setSplitCount,
    (_s) => {},
    (_s) => {}
  );
  
  const rightPanelVisible = useWritingModeUIStore((state) => state.rightPanelVisible);
  const rightPanelTab = useWritingModeUIStore((state) => state.rightPanelTab);
  const setRightPanelTab = useWritingModeUIStore((state) => state.setRightPanelTab);
  const toggleRightPanel = useWritingModeUIStore((state) => state.toggleRightPanel);
  const layoutMode = useWritingModeUIStore((state) => state.layoutMode);
  const rightPanelWidth = useWritingModeUIStore((state) => state.rightPanelWidth);
  const setRightPanelWidth = useWritingModeUIStore((state) => state.setRightPanelWidth);

  // 编辑器引用，用于在生成过程中控制编辑器
  const editorRef = React.useRef<StreamingTextEditorRef>(null);

  // 从 writingModeStore 获取分片状态
  const chapterChunks = useWritingModeStore((state) => state.chapterChunks);
  const generationProgressMap = useWritingModeStore((state) => state.generationProgress);

  // 用户可控分片生成：从 store 获取分片大纲与详情
  const shardOutlinesMap = useWritingModeStore((state) => state.shardOutlines);
  const shardDetailsMap = useWritingModeStore((state) => state.shardDetails);
  const updateShardContent = useWritingModeStore((state) => state.updateShardContent);

  // 获取当前章节的分片和进度信息
  const currentChapterChunks = chapterChunks.get(chapterGeneration.selectedChapterIndex) || [];
  const currentGenerationProgress = generationProgressMap.get(chapterGeneration.selectedChapterIndex) || null;

  // 进度面板可见性（生成时显示，完成后可折叠）
  const [progressPanelVisible, setProgressPanelVisible] = React.useState(true);
  React.useEffect(() => {
    if (chapterGeneration.isGenerating) {
      setProgressPanelVisible(true);
    }
  }, [chapterGeneration.isGenerating]);

  const [isOrganizing, setIsOrganizing] = React.useState(false);
  const [showGenerationModal, setShowGenerationModal] = React.useState(false);
  const [showRegenerationModal, setShowRegenerationModal] = React.useState(false);
  const [showAgentModal, setShowAgentModal] = React.useState(false);

  const handleTableOrganizeStatusChange = React.useCallback((organizing: boolean) => {
    setIsOrganizing(organizing);
  }, []);

  if (!outline || !outline.chapters) {
    return <div style={{ padding: 24 }}>未找到大纲信息</div>;
  }

  const completedChapters = Object.values(chapterGeneration.chapterStatuses).filter(s =>
    s === ChapterStatus.COMPLETED || s === ChapterStatus.ORGANIZED
  ).length;
  const totalChapters = outline.chapters.length;
  const overallProgress = Math.round((completedChapters / totalChapters) * 100);

  const currentChapter = outline.chapters[chapterGeneration.selectedChapterIndex];
  const currentWordCount = (chapterGeneration.streamingContent || chapterGeneration.chapterContents[currentChapter?.index] || '').length;
  if (!currentChapter) {
    return <div style={{ padding: 24 }}>未找到章节信息</div>;
  }

  // 当前章节的分片大纲与详情
  const currentShardOutlines = shardOutlinesMap.get(currentChapter.index) || [];
  const currentShardDetails = shardDetailsMap.get(currentChapter.index) || [];

  const targetWordCount = currentChapter?.targetWordCount || 2000;
  const wordCountPercentage = Math.min((currentWordCount / targetWordCount) * 100, 100);

  const handlePlotCheck = () => {
    plotCheck.handlePlotCheck(
      currentChapter.index,
      chapterGeneration.chapterContents,
      outline,
      projectId,
      chapterGeneration.updateChapterStatus
    );
    if (!rightPanelVisible) {
      toggleRightPanel();
    }
    setRightPanelTab(RightPanelTab.PLOT_CHECK);
  };

  const handleOpenTableOrganize = () => {
    if (!rightPanelVisible) {
      toggleRightPanel();
    }
    setRightPanelTab(RightPanelTab.TABLE_ORGANIZE);
  };



  const handleBatchFix = async (selectedIssues: Array<{ key: string; issue: PlotCheckIssue | LogicCheckIssue; issueType: 'dimension' | 'logic' }>) => {
    return plotCheck.handleBatchFix(
      currentChapter.index,
      chapterGeneration.chapterContents[currentChapter?.index] || '',
      selectedIssues,
      projectId,
      outline,
      chapterGeneration.setChapterContents,
      chapterGeneration.editorContentRef,
      chapterGeneration.updateChapterStatus
    );
  };

  const handleAutoFix = async (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic') => {
    return plotCheck.handleAutoFix(
      currentChapter.index,
      chapterContent,
      issue,
      issueType,
      projectId,
      outline,
      chapterGeneration.setChapterContents,
      chapterGeneration.editorContentRef,
      chapterGeneration.updateChapterStatus
    );
  };

  const handleQuickFix = (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', onComplete?: () => void) => {
    plotCheck.handleQuickFix(chapterContent, issue, issueType);
    if (onComplete) {
      onComplete();
    }
  };

  const handleAcceptQuickFix = (onComplete?: () => void) => {
    plotCheck.handleAcceptQuickFix(
      currentChapter.index,
      outline,
      chapterGeneration.editorContentRef,
      chapterGeneration.setChapterContents,
      undefined,
      onComplete,
      chapterGeneration.updateChapterStatus
    );
  };

  const handleRejectQuickFix = (onComplete?: () => void) => {
    plotCheck.handleRejectQuickFix(onComplete);
  };

  const handleContentUpdated = (fixedContent: string) => {
    plotCheck.handleContentUpdated(
      currentChapter.index,
      fixedContent,
      chapterGeneration.chapterContents,
      chapterGeneration.setChapterContents,
      chapterGeneration.editorContentRef
    );
  };

  const handleAcceptFix = () => {
    plotCheck.handleAcceptFix(chapterGeneration.updateChapterStatus, currentChapter.index);
  };

  const handleRejectFix = () => {
    plotCheck.handleRejectFix(
      currentChapter.index,
      outline,
      chapterGeneration.editorContentRef,
      chapterGeneration.setChapterContents
    );
  };

  const handleViewLogicRecords = () => {
    plotCheck.handleViewLogicRecords();
  };

  const handleTableOrganizeComplete = () => {
    chapterGeneration.updateChapterStatus(currentChapter.index, ChapterStatus.ORGANIZED);
    message.success('表格整理已标记完成');
  };


  const handleExport = async (format: ExportFormat) => {
    if (window.electronAPI?.writing) {
      try {
        const result = await window.electronAPI.writing.exportProject(projectId, format);
        if (result.success) {
          message.success('导出成功');
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(errMsg || '导出失败');
      }
    }
  };

  // 获取当前章节的持久化创作指导
  const getCurrentChapterGuidance = (): string | undefined => {
    const chapter = outline.chapters[chapterGeneration.selectedChapterIndex];
    return chapter?.generationGuidance;
  };

  // 保存章节创作指导到项目
  const saveChapterGuidance = async (guidance: string | undefined) => {
    const chapter = outline.chapters[chapterGeneration.selectedChapterIndex];
    if (!chapter) return;

    const currentProject = useWritingProjectStore.getState().getCurrentProject();
    if (!currentProject || !currentProject.outline) return;

    const updatedChapters = currentProject.outline.chapters.map((ch: ChapterOutline) =>
      ch.index === chapter.index
        ? { ...ch, generationGuidance: guidance || undefined }
        : ch
    );

    const updatedOutline = { ...currentProject.outline, chapters: updatedChapters };
    await useWritingProjectStore.getState().updateProject(projectId, { outline: updatedOutline });
  };

  // 生成建议面板处理函数
  const handleOpenGenerationModal = () => {
    setShowGenerationModal(true);
  };

  const handleGenerationSubmit = async (suggestion: string, shardCount: number) => {
    const trimmed = suggestion.trim();
    // Save the suggestion as persistent guidance
    await saveChapterGuidance(trimmed || undefined);

    setShowGenerationModal(false);

    if (shardCount === 1) {
      // 不分片：一次性生成完整章节
      chapterGeneration.handleGenerateChapter(currentChapter.index, trimmed || undefined);
    } else {
      // 分片模式：先生成分片大纲
      chapterGeneration.handleGenerateShardOutline(
        currentChapter.index,
        shardCount,
        trimmed || undefined
      );
    }

    if (!trimmed && getCurrentChapterGuidance()) {
      message.info('已清空章节创作指导');
    } else if (trimmed) {
      message.success('创作指导已保存');
    }
  };

  const handleGenerationCancel = () => {
    setShowGenerationModal(false);
  };

  const handleClearGuidance = async () => {
    await saveChapterGuidance(undefined);
    message.info('已清空章节创作指导');
  };

  // 重新生成建议面板处理函数
  const handleOpenRegenerationModal = () => {
    setShowRegenerationModal(true);
  };

  const handleRegenerationSubmit = (suggestion: RegenerationSuggestion) => {
    setShowRegenerationModal(false);
    chapterGeneration.handleRegenerateChapter(suggestion);
  };

  const handleRegenerationCancel = () => {
    setShowRegenerationModal(false);
  };

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
          {chapterGeneration.generationProgress && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                连续生成中: 第 {chapterGeneration.generationProgress.currentChapter + 1}/{chapterGeneration.generationProgress.totalChapters} 章
              </Text>
            </div>
          )}
        </div>
        <Input.Search
          placeholder="搜索章节"
          value={chapterStructure.chapterSearch}
          onChange={(e) => chapterStructure.setChapterSearch(e.target.value)}
          style={{ margin: '0 16px 8px 16px', width: 'calc(100% - 32px)' }}
        />
        <Menu
          mode="inline"
          selectedKeys={[String(chapterGeneration.selectedChapterIndex)]}
          onClick={({ key }) => chapterGeneration.setSelectedChapterIndex(parseInt(key))}
          items={outline.chapters
            .map((ch, arrayIdx) => {
              if (chapterStructure.chapterSearch &&
                !ch.title.toLowerCase().includes(chapterStructure.chapterSearch.toLowerCase()) &&
                !(ch.summary || '').toLowerCase().includes(chapterStructure.chapterSearch.toLowerCase())) {
                return null;
              }
              return {
                key: String(arrayIdx),
                label: (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ flex: 1 }}>{ch.title}</span>
                    <span style={{ fontSize: 10, marginLeft: 8 }}>
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.COMPLETED && <span style={{ color: '#52c41a' }}>✓</span>}
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.GENERATING && <Spin size="small" />}
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.FAILED && <span style={{ color: '#ff4d4f' }}>✗</span>}
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.GENERATED && <Tag color="blue" style={{ margin: 0, padding: '0 4px', lineHeight: '16px', height: 16, fontSize: 9 }}>已生成</Tag>}
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.CHECKED && <Tag color="orange" style={{ margin: 0, padding: '0 4px', lineHeight: '16px', height: 16, fontSize: 9 }}>已检查</Tag>}
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.FIXED && <Tag color="purple" style={{ margin: 0, padding: '0 4px', lineHeight: '16px', height: 16, fontSize: 9 }}>已修正</Tag>}
                      {chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.ORGANIZED && <Tag color="cyan" style={{ margin: 0, padding: '0 4px', lineHeight: '16px', height: 16, fontSize: 9 }}>已整理</Tag>}
                    </span>
                  </div>
                ),
                disabled: chapterGeneration.chapterStatuses[ch.index] === ChapterStatus.GENERATING || isOrganizing
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Word count display */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                  <Text style={{ fontSize: 12 }}>
                    字数: {currentWordCount.toLocaleString()}/{targetWordCount.toLocaleString()}
                  </Text>
                  <Progress
                    percent={Math.min(Math.round(wordCountPercentage), 100)}
                    size="small"
                    style={{ width: 120 }}
                    strokeColor={
                      wordCountPercentage >= 100 ? '#52c41a' :
                      wordCountPercentage >= 90 ? '#faad14' :
                      '#f5222d'
                    }
                    format={(percent) => `${percent}%`}
                  />
                </div>
                {/* Primary actions row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {!chapterGeneration.isGenerating ? (
                    <>
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        onClick={handleOpenGenerationModal}
                        disabled={!currentChapter || chapterGeneration.chapterStatuses[chapterGeneration.selectedChapterIndex] === ChapterStatus.GENERATING}
                      >
                        生成
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={handleOpenRegenerationModal}
                        disabled={!chapterGeneration.chapterContents[currentChapter?.index] && !chapterGeneration.streamingContent}
                      >
                        重新生成
                      </Button>
                      <Button
                        icon={<SaveOutlined />}
                        onClick={chapterGeneration.handleSaveChapter}
                      >
                        保存
                      </Button>
                      <Popconfirm
                        title="确定要清空此章节吗？"
                        description="清空后该章节内容将被删除，可重新生成。"
                        onConfirm={chapterGeneration.handleClearChapter}
                        okText="确定清空"
                        cancelText="取消"
                      >
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                        >
                          清空
                        </Button>
                      </Popconfirm>
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
                      <Popconfirm title="确定要停止生成吗？已生成的内容将被保留。" onConfirm={chapterGeneration.handleStopGeneration}>
                        <Button danger icon={<StopOutlined />}>停止生成</Button>
                      </Popconfirm>
                    </>
                  )}
                </div>
                {/* Secondary actions row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Button
                    icon={<SearchOutlined />}
                    onClick={handlePlotCheck}
                    loading={plotCheck.plotCheckLoading}
                  >
                    剧情检查
                  </Button>
                  <Button
                    icon={<TableOutlined />}
                    onClick={handleOpenTableOrganize}
                  >
                    表格整理
                  </Button>
                  <Button
                    icon={<FileTextOutlined />}
                    onClick={handleViewLogicRecords}
                  >
                    逻辑记录
                  </Button>
                  <Tooltip title="智能体自动写作：读大纲→写章→自审→修复→更新表→下一章">
                    <Button
                      type="primary"
                      ghost
                      icon={<RobotOutlined />}
                      onClick={() => setShowAgentModal(true)}
                    >
                      智能体写作
                    </Button>
                  </Tooltip>
                  {layoutMode === LayoutMode.WIDE && (
                    <Tooltip title={rightPanelVisible ? '关闭辅助面板' : '打开辅助面板'}>
                      <Button
                        type="text"
                        icon={rightPanelVisible ? <CloseOutlined /> : <AppstoreOutlined />}
                        onClick={toggleRightPanel}
                        size="small"
                      >
                        {rightPanelVisible ? '关闭面板' : '辅助面板'}
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
            }
          >
            {/* 分片生成进度面板：在生成时显示，完成后可折叠 */}
            <GenerationProgressPanel
              visible={progressPanelVisible && currentShardOutlines.length === 0 && (chapterGeneration.isGenerating || currentGenerationProgress !== null)}
              progress={currentGenerationProgress}
              chunks={currentChapterChunks}
              isGenerating={chapterGeneration.isGenerating}
              onRegenerateChunk={(chunkIndex) => {
                // 重新生成指定分片
                chapterGeneration.handleRegenerateChunk?.(chunkIndex);
              }}
              onScrollToChunk={() => {
                // 滚动编辑器到对应分片位置
                editorRef.current?.scrollToBottom();
              }}
              className="chapter-progress-panel"
            />
            {/* 进度面板显示/隐藏切换 */}
            {currentGenerationProgress && !chapterGeneration.isGenerating && (
              <div style={{ marginBottom: 8, textAlign: 'right' }}>
                <Button
                  type="text"
                  size="small"
                  onClick={() => setProgressPanelVisible(!progressPanelVisible)}
                >
                  {progressPanelVisible ? '隐藏进度' : '显示进度'}
                </Button>
              </div>
            )}
            {/* 用户可控分片详情面板：仅当当前章节存在分片大纲时显示 */}
            {currentShardOutlines.length > 0 && (
              <ShardDetailPanel
                chapterIndex={currentChapter.index}
                shardOutlines={currentShardOutlines}
                shardDetails={currentShardDetails}
                onGenerateShard={(shardIndex) => chapterGeneration.handleGenerateShard(currentChapter.index, shardIndex)}
                onGenerateAll={() => chapterGeneration.handleGenerateAllShards(currentChapter.index)}
                onShardContentChange={(shardIndex, content) => updateShardContent(currentChapter.index, shardIndex, content)}
                onConfirmShard={(shardIndex) => chapterGeneration.confirmShardToIntegration(currentChapter.index, shardIndex)}
              />
            )}
            {/* 编辑器区域：使用 StreamingTextEditor 替代 MarkdownEditor */}
            <StreamingTextEditor
              ref={editorRef}
              key={currentChapter.index}
              value={
                chapterGeneration.isGenerating && chapterGeneration.generationState === GenerationState.GENERATING
                  ? chapterGeneration.streamingContent
                  : (chapterGeneration.chapterContents[currentChapter.index] || '')
              }
              onChange={chapterGeneration.handleEditorChange}
              readOnly={
                chapterGeneration.isGenerating && chapterGeneration.generationState === GenerationState.GENERATING
              }
              placeholder="在此输入或生成章节内容..."
              enableMarkdown={true}
              className={
                chapterGeneration.isGenerating && chapterGeneration.generationState === GenerationState.GENERATING
                  ? 'generating'
                  : ''
              }
            />
          </Card>
        </Content>
      </Layout>

      {layoutMode === LayoutMode.WIDE && rightPanelVisible && (
        <WritingModeRightPanel
          width={rightPanelWidth}
          onResize={setRightPanelWidth}
          onClose={() => toggleRightPanel()}
          activeTab={rightPanelTab}
          onTabChange={setRightPanelTab}
          plotCheckReport={plotCheck.plotCheckReport}
          plotCheckLoading={plotCheck.plotCheckLoading}
          onPlotCheckAutoFix={handleAutoFix}
          onPlotCheckQuickFix={handleQuickFix}
          onPlotCheckBatchFix={handleBatchFix}
          chapterContent={chapterGeneration.chapterContents[currentChapter?.index] || ''}
          onContentUpdated={handleContentUpdated}
          onRecheck={() => plotCheck.handlePlotCheck(currentChapter.index, chapterGeneration.chapterContents, outline, projectId, chapterGeneration.updateChapterStatus)}
          editorContentRef={chapterGeneration.editorContentRef}
          tableProjectId={projectId}
          tableChapterId={currentChapter.index}
          tableChapterTitle={currentChapter.title}
          onTableOrganizeComplete={handleTableOrganizeComplete}
          onTableOrganizeStatusChange={handleTableOrganizeStatusChange}
        />
      )}
      


      <QuickFixSuggestionModal
        visible={!!plotCheck.pendingQuickFixSuggestion}
        suggestion={plotCheck.pendingQuickFixSuggestion}
        issueTitle={plotCheck.pendingQuickFixIssue?.title || plotCheck.pendingQuickFixIssue?.description || ''}
        issueType={plotCheck.pendingQuickFixType === 'logic' ? '逻辑异常' : plotCheck.pendingQuickFixIssue?.dimension ? '维度问题' : '问题'}
        onAccept={(onComplete) => handleAcceptQuickFix(onComplete)}
        onReject={(onComplete) => handleRejectQuickFix(onComplete)}
        onCancel={(onComplete) => handleRejectQuickFix(onComplete)}
      />

      <Modal
        title="逻辑矛盾记录"
        open={modalStates.showLogicRecordsModal}
        onCancel={() => modalStates.setShowLogicRecordsModal(false)}
        width={900}
        footer={null}
      >
        <Spin spinning={plotCheck.logicRecordsLoading}>
          {plotCheck.logicRecords.length === 0 ? (
            <Empty description="暂无逻辑矛盾记录" />
          ) : (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Popconfirm
                  title="确认清空"
                  description="确定要清空所有逻辑矛盾记录吗？此操作不可恢复。"
                  onConfirm={plotCheck.handleClearLogicRecords}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button danger icon={<DeleteOutlined />}>
                    清空记录
                  </Button>
                </Popconfirm>
              </div>
              <Table
                dataSource={plotCheck.logicRecords}
                pagination={{ pageSize: 10 }}
                size="small"
                rowKey="1"
                columns={[
                  { title: '异常类型', dataIndex: '2', key: 'type', width: 120 },
                  { title: '情节描述', dataIndex: '3', key: 'description', ellipsis: true },
                  { title: '矛盾点', dataIndex: '4', key: 'analysis', ellipsis: true },
                  { title: '章节', dataIndex: '5', key: 'chapter', width: 100 },
                  { title: '严重程度', dataIndex: '6', key: 'severity', width: 80 },
                  { title: '检测时间', dataIndex: '8', key: 'time', width: 150 }
                ]}
              />
            </>
          )}
        </Spin>
      </Modal>

      <AutoFixResultModal
        visible={modalStates.showFixResultModal}
        result={plotCheck.autoFixResult}
        issueTitle={plotCheck.pendingFixIssue?.title || ''}
        issueType={plotCheck.pendingFixType === 'logic' ? '逻辑异常' : plotCheck.pendingFixIssue?.dimension ? '维度问题' : '问题'}
        onAccept={handleAcceptFix}
        onReject={handleRejectFix}
        onCancel={() => modalStates.setShowFixResultModal(false)}
      />

      <GenerationSuggestionModal
        visible={showGenerationModal}
        onSubmit={handleGenerationSubmit}
        onCancel={handleGenerationCancel}
        savedGuidance={getCurrentChapterGuidance()}
        onClearGuidance={handleClearGuidance}
      />

      <RegenerationSuggestionModal
        visible={showRegenerationModal}
        onSubmit={handleRegenerationSubmit}
        onCancel={handleRegenerationCancel}
        previousContent={chapterGeneration.chapterContents[currentChapter?.index] || ''}
        savedGuidance={getCurrentChapterGuidance()}
      />

      {/* Task 15.2: 智能体写作编排模态框 */}
      <WritingAgentModal
        visible={showAgentModal}
        onClose={() => setShowAgentModal(false)}
        projectId={projectId}
        outline={outline}
        onCompleted={() => {
          // 编排完成后刷新章节列表
          useWritingProjectStore.getState().loadProjects();
        }}
      />
    </Layout>
  );
};

export default ContentWorkspace;
