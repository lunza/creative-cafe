import React from 'react';
import { theme as antTheme } from 'antd';
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
  CloseOutlined
} from '@ant-design/icons';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  ExportFormat,
  PlotCheckIssue,
  LogicCheckIssue,
} from '../../../../shared/types/writing.types';
import MarkdownEditor from '../../Common/MarkdownEditor';
import AutoFixResultModal from './AutoFixResultModal';
import QuickFixSuggestionModal from './QuickFixSuggestionModal';
import WritingModeRightPanel from './WritingModeRightPanel';
import { useChapterGeneration } from './hooks/useChapterGeneration';
import { useModalStates } from './hooks/useModalStates';
import { usePlotCheck } from './hooks/usePlotCheck';
import { useChapterStructure } from './hooks/useChapterStructure';
import { useWritingModeUIStore, LayoutMode, RightPanelTab } from '../../../stores/writingModeUIStore';
import { useUIStore } from '../../../stores/uiStore';

interface ContentWorkspaceProps {
  outline: GeneratedOutline | null;
  projectId: string;
  onBack: () => void;
}

const ContentWorkspace: React.FC<ContentWorkspaceProps> = ({ outline, projectId }) => {
  console.log('[ContentWorkspace] Component mounted/updated', {
    hasOutline: !!outline,
    outlineChapterCount: outline?.chapters?.length,
    outlineChapter0ContentLength: outline?.chapters?.[0]?.content?.length || 0,
    outlineChapter0ContentPreview: outline?.chapters?.[0]?.content?.substring(0, 50) || 'empty',
    projectId
  });

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
  
  // 打印章节内容恢复情况
  console.log('[ContentWorkspace] chapterContents state:', {
    chapterCount: outline?.chapters?.length || 0,
    restoredChapterCount: Object.keys(chapterGeneration.chapterContents).length,
    firstChapterContentLength: chapterGeneration.chapterContents[0]?.length || 0,
    firstChapterContentPreview: chapterGeneration.chapterContents[0]?.substring(0, 50) || 'empty',
    allKeys: Object.keys(chapterGeneration.chapterContents),
    statusesKeys: Object.keys(chapterGeneration.chapterStatuses)
  });

  const rightPanelVisible = useWritingModeUIStore((state) => state.rightPanelVisible);
  const rightPanelTab = useWritingModeUIStore((state) => state.rightPanelTab);
  const setRightPanelTab = useWritingModeUIStore((state) => state.setRightPanelTab);
  const toggleRightPanel = useWritingModeUIStore((state) => state.toggleRightPanel);
  const layoutMode = useWritingModeUIStore((state) => state.layoutMode);
  const rightPanelWidth = useWritingModeUIStore((state) => state.rightPanelWidth);
  const setRightPanelWidth = useWritingModeUIStore((state) => state.setRightPanelWidth);
  const editorTheme = useUIStore((state) => state.theme);

  const [isOrganizing, setIsOrganizing] = React.useState(false);

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
      } catch (error: any) {
        message.error(error.message || '导出失败');
      }
    }
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
            .filter(Boolean) as any[]}
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
                        onClick={() => chapterGeneration.handleGenerateChapter(currentChapter.index)}
                        disabled={!currentChapter || chapterGeneration.chapterStatuses[chapterGeneration.selectedChapterIndex] === ChapterStatus.GENERATING}
                      >
                        生成
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={chapterGeneration.handleRegenerateChapter}
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
            {chapterGeneration.isGenerating && chapterGeneration.generationState === GenerationState.GENERATING ? (
              <div style={{ minHeight: 400 }}>
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary">正在生成中... 已生成 {chapterGeneration.currentChapterWords} 字</Text>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontFamily: 'monospace', fontSize: 14 }}>
                  {chapterGeneration.streamingContent}
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
                {console.log('[ContentWorkspace] Rendering MarkdownEditor', {
                  chapterIndex: currentChapter.index,
                  chapterContents: chapterGeneration.chapterContents,
                  valueLength: chapterGeneration.chapterContents[currentChapter.index]?.length || 0,
                  hasContent: !!chapterGeneration.chapterContents[currentChapter.index]
                })}
                <MarkdownEditor
                  key={currentChapter.index}
                  theme={editorTheme}
                  value={chapterGeneration.chapterContents[currentChapter.index] || ''}
                  onChange={chapterGeneration.handleEditorChange}
                  readOnly={false}
                />
              </>
            )}
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
    </Layout>
  );
};

export default ContentWorkspace;
