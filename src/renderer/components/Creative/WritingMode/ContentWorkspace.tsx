import React, { useState } from 'react';
import { Card, Button, Progress, message, Spin, Menu, Typography, Dropdown, Popconfirm, Empty, Modal, Input, Divider, Layout, List, Table } from 'antd';
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
  SettingOutlined,
  PartitionOutlined,
  MergeCellsOutlined,
  SearchOutlined,
  FileTextOutlined,
  TableOutlined
} from '@ant-design/icons';
import {
  GeneratedOutline,
  GenerationState,
  ChapterStatus,
  ExportFormat,
  ChapterVersion,
  PlotCheckReport,
  AISplitSuggestion,
  AIMergeSuggestion,
  AIGenerationHistory,
} from '../../../../shared/types/writing.types';
import MarkdownEditor from '../../Common/MarkdownEditor';
import WritingProgressDashboard from './WritingProgressDashboard';
import ChapterSplitModal from './ChapterSplitModal';
import ChapterMergeModal from './ChapterMergeModal';
import AIGenerationHistoryModal from './AIGenerationHistoryModal';
import PlotCheckReportModal from './PlotCheckReportModal';
import AutoFixResultModal from './AutoFixResultModal';
import QuickFixSuggestionModal from './QuickFixSuggestionModal';
import WritingTablePreviewModal from './WritingTablePreviewModal';
import { useChapterGeneration } from './hooks/useChapterGeneration';
import { useVersionManagement } from './hooks/useVersionManagement';
import { useModalStates } from './hooks/useModalStates';
import { usePlotCheck } from './hooks/usePlotCheck';
import { useChapterStructure } from './hooks/useChapterStructure';

interface ContentWorkspaceProps {
  outline: GeneratedOutline | null;
  projectId: string;
  onBack: () => void;
}

const ContentWorkspace: React.FC<ContentWorkspaceProps> = ({ outline, projectId, onBack }) => {
  const modalStates = useModalStates();
  const chapterGeneration = useChapterGeneration(outline, projectId);
  const versionManagement = useVersionManagement(projectId, outline);
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
    (s) => {},
    (s) => {}
  );

  const [splitTitles, setSplitTitles] = useState<string[]>([]);
  const [isOrganizing, setIsOrganizing] = useState(false);

  if (!outline || !outline.chapters) {
    return <div style={{ padding: 24 }}>未找到大纲信息</div>;
  }

  const completedChapters = Object.values(chapterGeneration.chapterStatuses).filter(s => s === ChapterStatus.COMPLETED).length;
  const totalChapters = outline.chapters.length;
  const overallProgress = Math.round((completedChapters / totalChapters) * 100);

  const currentChapter = outline.chapters[chapterGeneration.selectedChapterIndex];
  const currentWordCount = (chapterGeneration.streamingContent || chapterGeneration.chapterContents[currentChapter?.index] || '').length;
  if (!currentChapter) {
    return <div style={{ padding: 24 }}>未找到章节信息</div>;
  }

  const targetWordCount = currentChapter?.targetWordCount || 2000;
  const wordCountPercentage = Math.min((currentWordCount / targetWordCount) * 100, 100);
  const wordCountColor = wordCountPercentage >= 90 ? '#52c41a' : wordCountPercentage >= 50 ? '#faad14' : '#f5222d';

  const handleOpenSplitModal = () => {
    chapterStructure.handleOpenSplitModal(chapterGeneration.selectedChapterIndex, outline);
  };

  const handleSplitConfirm = (mode: 'content' | 'ai', suggestion?: AISplitSuggestion) => {
    chapterStructure.handleSplitConfirm(
      mode,
      chapterGeneration.selectedChapterIndex,
      modalStates.splitCount,
      chapterGeneration.chapterContents,
      outline,
      suggestion
    );
  };

  const handleOpenMergeModal = () => {
    chapterStructure.handleOpenMergeModal(outline);
  };

  const handleMergeConfirm = (mode: 'simple' | 'ai', selectedIndices: number[], suggestion?: AIMergeSuggestion) => {
    chapterStructure.handleMergeConfirm(
      mode,
      selectedIndices,
      chapterGeneration.chapterContents,
      outline,
      suggestion
    );
  };

  const handlePlotCheck = () => {
    plotCheck.handlePlotCheck(
      currentChapter.index,
      chapterGeneration.chapterContents,
      outline,
      projectId
    );
  };

  const handleSaveVersion = () => {
    versionManagement.handleSaveVersion(
      chapterGeneration.selectedChapterIndex,
      chapterGeneration.streamingContent,
      chapterGeneration.chapterContents
    );
  };

  const handleShowVersionHistory = () => {
    versionManagement.handleShowVersionHistory(
      chapterGeneration.selectedChapterIndex,
      outline
    );
  };

  const handleRestoreVersion = (versionId: string) => {
    versionManagement.handleRestoreVersion(
      versionId,
      chapterGeneration.selectedChapterIndex,
      outline
    );
  };

  const handleRestoreHistory = (history: AIGenerationHistory) => {
    chapterStructure.handleRestoreHistory(history);
  };

  const handleBackToConfig = () => {
    chapterStructure.handleBackToConfig(onBack);
  };

  const handleBatchFix = async (selectedIssues: Array<{ key: string; issue: any; issueType: 'dimension' | 'logic' }>) => {
    return plotCheck.handleBatchFix(
      currentChapter.index,
      chapterGeneration.chapterContents[currentChapter?.index] || '',
      selectedIssues,
      projectId,
      outline,
      () => {},
      chapterGeneration.editorContentRef
    );
  };

  const handleQuickFix = (chapterContent: string, issue: any) => {
    plotCheck.handleQuickFix(chapterContent, issue);
  };

  const handleAcceptQuickFix = () => {
    plotCheck.handleAcceptQuickFix(
      currentChapter.index,
      outline,
      chapterGeneration.editorContentRef,
      () => {},
      () => plotCheck.handlePlotCheck(currentChapter.index, chapterGeneration.chapterContents, outline, projectId)
    );
  };

  const handleRejectQuickFix = () => {
    plotCheck.handleRejectQuickFix();
  };

  const handleContentUpdated = (fixedContent: string) => {
    plotCheck.handleContentUpdated(
      currentChapter.index,
      fixedContent,
      chapterGeneration.chapterContents,
      () => {},
      chapterGeneration.editorContentRef
    );
  };

  const handleAcceptFix = () => {
    plotCheck.handleAcceptFix();
  };

  const handleRejectFix = () => {
    plotCheck.handleRejectFix(
      currentChapter.index,
      outline,
      chapterGeneration.editorContentRef,
      () => {}
    );
  };

  const handleViewLogicRecords = () => {
    plotCheck.handleViewLogicRecords();
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                        icon={<ThunderboltOutlined />}
                        onClick={chapterGeneration.handleContinuousGeneration}
                        disabled={completedChapters >= totalChapters}
                      >
                        连续生成
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={chapterGeneration.handleRegenerateChapter}
                        disabled={!chapterGeneration.chapterContents[currentChapter?.index] && !chapterGeneration.streamingContent}
                      >
                        重新生成
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
                      <Button
                        icon={<PartitionOutlined />}
                        onClick={handleOpenSplitModal}
                        disabled={chapterGeneration.isGenerating}
                      >
                        分解
                      </Button>
                      <Button
                        icon={<MergeCellsOutlined />}
                        onClick={handleOpenMergeModal}
                        disabled={outline.chapters.length < 2}
                      >
                        合并
                      </Button>
                      <Button
                        icon={<HistoryOutlined />}
                        onClick={() => modalStates.setShowHistoryModal(true)}
                      >
                        AI历史
                      </Button>
                      <Dropdown menu={{
                        items: [
                          { key: 'txt', label: 'TXT', onClick: () => versionManagement.handleExport(ExportFormat.TXT) },
                          { key: 'md', label: 'Markdown', onClick: () => versionManagement.handleExport(ExportFormat.MARKDOWN) },
                          { key: 'json', label: 'JSON', onClick: () => versionManagement.handleExport(ExportFormat.JSON) },
                        ]
                      }}>
                        <Button icon={<ExportOutlined />}>导出</Button>
                      </Dropdown>
                    </>
                  ) : (
                    <>
                      {chapterGeneration.isPaused ? (
                        <Button type="primary" icon={<PlayCircleOutlined />} onClick={chapterGeneration.handleResumeGeneration}>
                          继续
                        </Button>
                      ) : (
                        <Button icon={<PauseCircleOutlined />} onClick={chapterGeneration.handlePauseGeneration}>
                          暂停
                        </Button>
                      )}
                      <Popconfirm title="确定要停止生成吗？已生成的内容将被保留。" onConfirm={chapterGeneration.handleStopGeneration}>
                        <Button danger icon={<StopOutlined />}>停止</Button>
                      </Popconfirm>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button icon={<SaveOutlined />} onClick={chapterGeneration.handleSaveChapter}>保存</Button>
                  <Dropdown menu={{
                    items: [
                      { key: 'saveVersion', label: '保存版本', icon: <HistoryOutlined />, onClick: handleSaveVersion },
                      { key: 'versionHistory', label: '版本历史', icon: <HistoryOutlined />, onClick: handleShowVersionHistory },
                    ]
                  }}>
                    <Button icon={<MoreOutlined />}>版本</Button>
                  </Dropdown>
                  <Button 
                    icon={<TableOutlined />} 
                    onClick={() => modalStates.setShowTablePreviewModal(true)}
                  >
                    表格整理
                  </Button>
                  <Button 
                    icon={<SearchOutlined />} 
                    onClick={handlePlotCheck} 
                    loading={plotCheck.plotCheckLoading}
                  >
                    剧情检查
                  </Button>
                  <Button 
                    icon={<FileTextOutlined />} 
                    onClick={handleViewLogicRecords}
                  >
                    逻辑记录
                  </Button>
                  <Button icon={<SettingOutlined />} onClick={handleBackToConfig}>调整参数</Button>
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
                <MarkdownEditor
                  key={currentChapter.index}
                  value={chapterGeneration.chapterContents[currentChapter.index] || ''}
                  onChange={chapterGeneration.handleEditorChange}
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
        open={versionManagement.showVersionHistory}
        onCancel={() => versionManagement.setShowVersionHistory(false)}
        footer={null}
        width={500}
      >
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {versionManagement.versionHistory.map(v => (
            <div key={v.id} style={{ padding: '8px 12px', marginBottom: 8, background: '#f9f9f9', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div>{v.note}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>{new Date(v.timestamp).toLocaleString()} · {v.content.length} 字</Text>
              </div>
              <Button size="small" onClick={() => handleRestoreVersion(v.id)}>恢复</Button>
            </div>
          ))}
          {versionManagement.versionHistory.length === 0 && <Empty description="暂无版本" size="small" />}
        </div>
      </Modal>

      <ChapterSplitModal
        visible={modalStates.showSplitModal}
        chapter={currentChapter}
        chapterContent={chapterGeneration.chapterContents[currentChapter?.index] || ''}
        outline={outline}
        splitCount={modalStates.splitCount}
        onSplitCountChange={modalStates.setSplitCount}
        onCancel={() => modalStates.setShowSplitModal(false)}
        onConfirm={handleSplitConfirm}
        projectId={projectId}
      />

      <ChapterMergeModal
        visible={modalStates.showMergeModal}
        chapters={outline.chapters}
        chapterContents={chapterGeneration.chapterContents}
        outline={outline}
        onCancel={() => modalStates.setShowMergeModal(false)}
        onConfirm={handleMergeConfirm}
        projectId={projectId}
      />

      <AIGenerationHistoryModal
        visible={modalStates.showHistoryModal}
        projectId={projectId}
        onCancel={() => modalStates.setShowHistoryModal(false)}
        onRestore={handleRestoreHistory}
      />

      <PlotCheckReportModal
        visible={modalStates.showPlotCheckModal}
        report={plotCheck.plotCheckReport}
        onCancel={() => modalStates.setShowPlotCheckModal(false)}
        onAutoFix={(chapterContent, issue, issueType) => plotCheck.handleAutoFix(
          currentChapter.index,
          chapterContent,
          issue,
          issueType,
          projectId,
          outline,
          () => {},
          chapterGeneration.editorContentRef
        )}
        onQuickFix={handleQuickFix}
        chapterContent={chapterGeneration.chapterContents[currentChapter?.index] || ''}
        onContentUpdated={handleContentUpdated}
        onRecheck={() => plotCheck.handlePlotCheck(currentChapter.index, chapterGeneration.chapterContents, outline, projectId)}
      />

      <QuickFixSuggestionModal
        visible={!!plotCheck.pendingQuickFixSuggestion}
        suggestion={plotCheck.pendingQuickFixSuggestion}
        issueTitle={plotCheck.pendingQuickFixIssue?.title || plotCheck.pendingQuickFixIssue?.description || ''}
        issueType={plotCheck.pendingQuickFixType === 'logic' ? '逻辑异常' : plotCheck.pendingQuickFixIssue?.dimension ? '维度问题' : '问题'}
        onAccept={handleAcceptQuickFix}
        onReject={handleRejectQuickFix}
        onCancel={handleRejectQuickFix}
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

      <WritingTablePreviewModal
        visible={modalStates.showTablePreviewModal}
        projectId={projectId}
        onClose={() => modalStates.setShowTablePreviewModal(false)}
        chapterId={currentChapter.index}
        chapterTitle={currentChapter.title}
        chapterContent={chapterGeneration.chapterContents[currentChapter.index] || ''}
        onOrganizeStatusChange={setIsOrganizing}
      />
    </Layout>
  );
};

export default ContentWorkspace;
