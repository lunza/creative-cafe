import React, { useState, useCallback } from 'react';
import { Tabs, Input, Button, Empty, Tag, Tooltip, Typography, Spin, Badge, Modal, Progress, Upload, message, Descriptions, Popconfirm } from 'antd';
import { BookOutlined, SearchOutlined, ReloadOutlined, GlobalOutlined, IdcardOutlined, UserOutlined, UnorderedListOutlined, UploadOutlined, DeleteOutlined, StopOutlined, FileTextOutlined, SafetyOutlined, TableOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import type { MaterialItem, MaterialType, PlotCheckReport, PlotCheckIssue, LogicCheckIssue } from '../../../../shared/types/writing.types';
import { useWritingMaterials } from './useWritingMaterials';
import { usePanelResize } from './usePanelResize';
import MaterialList from './MaterialList';
import { RightPanelTab } from '../../../stores/writingModeUIStore';
import PlotCheckPanelContent from './PlotCheckPanelContent';
import TableOrganizeMainPanel from './TableOrganizeMainPanel';

const { Text } = Typography;

const RESIZE_HANDLE_WIDTH = 5;

interface WritingModeRightPanelProps {
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  plotCheckReport?: PlotCheckReport | null;
  plotCheckLoading?: boolean;
  onPlotCheckAutoFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic') => Promise<{ success: boolean; fixedContent?: string; error?: string }>;
  onPlotCheckQuickFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', onComplete?: () => void) => void;
  onPlotCheckBatchFix?: (selectedIssues: Array<{ key: string; issue: PlotCheckIssue | LogicCheckIssue; issueType: 'dimension' | 'logic' }>) => Promise<{ success: boolean; fixedContent?: string; results?: Array<{ index: number; success: boolean; error?: string }>; error?: string }>;
  chapterContent?: string;
  onContentUpdated?: (fixedContent: string) => void;
  onRecheck?: () => void;
  editorContentRef?: React.MutableRefObject<string>;
  tableProjectId?: string;
  tableChapterId?: number;
  tableChapterTitle?: string;
  onTableOrganizeComplete?: () => void;
  onTableOrganizeStatusChange?: (isOrganizing: boolean) => void;
}

/**
 * 写作模式右侧辅助面板（编排层）
 *
 * 拆分后本组件仅负责：
 * 1. 顶部 Resize handle 与关闭按钮
 * 2. Tabs 编排：素材库 / 剧情检查 / 表格整理
 * 3. 写作风格预览 Modal
 *
 * 各 Tab 的内容已下沉到独立组件：
 * - 素材库：本文件内联（保留原 MaterialList 用法）
 * - 剧情检查：PlotCheckPanelContent
 * - 表格整理：TableOrganizeMainPanel（内部进一步拆分为 5 个子组件 + 1 个 hook）
 *
 * 外部接口（默认导出与 props）保持与拆分前一致，父组件 ContentWorkspace 无需修改。
 */
const WritingModeRightPanel: React.FC<WritingModeRightPanelProps> = ({
  width,
  onResize,
  onClose,
  activeTab,
  onTabChange,
  plotCheckReport,
  plotCheckLoading,
  onPlotCheckAutoFix,
  onPlotCheckQuickFix,
  onPlotCheckBatchFix,
  chapterContent,
  onContentUpdated,
  onRecheck,
  tableProjectId,
  tableChapterId,
  tableChapterTitle,
  onTableOrganizeComplete,
  onTableOrganizeStatusChange,
}) => {
  const { token } = theme.useToken();
  const {
    loading,
    searchQuery,
    setSearchQuery,
    filteredWorldBooks,
    filteredCharacters,
    filteredPersonas,
    filteredKnowledgeItems,
    filteredWritingStyles,
    toggleMaterial,
    toggleWritingStyle,
    getSelectedCount,
    refreshMaterials,
    writingStyleLearning,
    uploadWritingStyle,
    cancelLearning,
  } = useWritingMaterials();

  const [activeMaterialTab, setActiveMaterialTab] = useState<string>('worldbook');
  const [selectedSummaryVisible, setSelectedSummaryVisible] = useState(false);
  const [selectedStyleForPreview, setSelectedStyleForPreview] = useState<MaterialItem | null>(null);

  // D2 拆分：resize 逻辑下沉到 usePanelResize hook，本组件仅消费 isResizing / handleResizeMouseDown
  const { isResizing, handleResizeMouseDown } = usePanelResize(width, onResize);

  const handleRefresh = useCallback(() => {
    refreshMaterials();
  }, [refreshMaterials]);

  const handleToggleMaterial = useCallback(
    (type: MaterialType, id: string) => {
      toggleMaterial(type, id);
    },
    [toggleMaterial]
  );

  const selectedWorldBookCount = getSelectedCount('worldbook');
  const selectedCharacterCount = getSelectedCount('character');
  const selectedPersonaCount = getSelectedCount('persona');
  const selectedKnowledgeCount = getSelectedCount('knowledge');
  const selectedWritingStyleCount = getSelectedCount('writing-style');
  const totalSelected = selectedWorldBookCount + selectedCharacterCount + selectedPersonaCount + selectedKnowledgeCount + selectedWritingStyleCount;

  const materialSubTabs = [
    {
      key: 'worldbook',
      label: (
        <Badge count={selectedWorldBookCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <GlobalOutlined />
            世界书
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredWorldBooks}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="worldbook"
          emptyText={searchQuery ? '未匹配的世界书' : '暂无世界书'}
        />
      ),
    },
    {
      key: 'character',
      label: (
        <Badge count={selectedCharacterCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <IdcardOutlined />
            角色卡
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredCharacters}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="character"
          emptyText={searchQuery ? '未匹配的角色卡' : '暂无角色卡'}
        />
      ),
    },
    {
      key: 'persona',
      label: (
        <Badge count={selectedPersonaCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <UserOutlined />
            用户人设
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredPersonas}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="persona"
          emptyText={searchQuery ? '未匹配的用户人设' : '暂无用户人设'}
        />
      ),
    },
    {
      key: 'knowledge',
      label: (
        <Badge count={selectedKnowledgeCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <BookOutlined />
            知识库
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredKnowledgeItems}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="knowledge"
          emptyText={searchQuery ? '未匹配的知识库条目' : '暂无知识库条目'}
        />
      ),
    },
    {
      key: 'writing-style',
      label: (
        <Badge count={selectedWritingStyleCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <FileTextOutlined />
            写作风格
          </span>
        </Badge>
      ),
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <Upload
              accept=".txt"
              showUploadList={false}
              beforeUpload={(file) => {
                if (!file.name.endsWith('.txt')) {
                  message.error('仅支持 .txt 格式文件');
                  return false;
                }
                if (file.size > 50 * 1024 * 1024) {
                  message.error('文件大小不能超过 50MB');
                  return false;
                }
                uploadWritingStyle(file.path ?? '', file.name, file.size).then(result => {
                  if (result.success) {
                    message.success('开始文风学习，请在后台等待完成');
                  } else {
                    message.error(result.error || '上传失败');
                  }
                });
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} size="small">
                上传txt文件
              </Button>
            </Upload>
          </div>

          {writingStyleLearning.isLearning && (
            <div style={{
              marginBottom: 12,
              padding: '8px 12px',
              background: token.colorFillQuaternary,
              borderRadius: 6
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  学习中: {writingStyleLearning.progress?.message || '处理中...'}
                </Text>
                <Popconfirm
                  title="确认取消"
                  description="确定要取消文风学习吗？"
                  onConfirm={() => writingStyleLearning.taskId && cancelLearning(writingStyleLearning.taskId)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button icon={<StopOutlined />} size="small" danger>
                    取消
                  </Button>
                </Popconfirm>
              </div>
              <Progress
                percent={
                  writingStyleLearning.progress?.totalChunks
                    ? Math.round((writingStyleLearning.progress.currentChunk / writingStyleLearning.progress.totalChunks) * 100)
                    : 0
                }
                size="small"
                status={
                  writingStyleLearning.progress?.status === 'FAILED' ? 'exception' :
                  writingStyleLearning.progress?.status === 'CANCELLED' ? 'exception' :
                  'active'
                }
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {writingStyleLearning.progress?.phase === 'FILE_READING' && '正在读取文件...'}
                {writingStyleLearning.progress?.phase === 'TEXT_SPLITTING' && '正在分割文本...'}
                {writingStyleLearning.progress?.phase === 'BATCH_ANALYSIS' &&
                  `正在分析第 ${writingStyleLearning.progress.currentChunk}/${writingStyleLearning.progress.totalChunks} 块`}
                {writingStyleLearning.progress?.phase === 'RESULT_INTEGRATION' && '正在生成分析报告...'}
                {writingStyleLearning.progress?.phase === 'COMPLETED' && '学习完成'}
              </Text>
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
            {filteredWritingStyles.length === 0 ? (
              <Empty
                description={searchQuery ? '未匹配的写作风格' : '暂无已学习的写作风格，请上传txt文件开始学习'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              filteredWritingStyles.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    marginBottom: 4,
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: item.isSelected ? token.colorPrimaryBg : 'transparent',
                    border: `1px solid ${item.isSelected ? token.colorPrimary : token.colorBorder}`,
                  }}
                  onClick={() => toggleWritingStyle(item.id)}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <Text strong style={{ fontSize: 13 }}>{item.name}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                      {item.description}
                    </Text>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                    <Button
                      size="small"
                      icon={<BookOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedStyleForPreview(item);
                      }}
                    />
                    <Popconfirm
                      title="确认删除"
                      description="确定要删除该写作风格吗？此操作不可恢复。"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        window.electronAPI?.writing?.style?.delete(item.id);
                        refreshMaterials();
                      }}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        danger
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ),
    },
  ];

  const tabItems = [
    {
      key: RightPanelTab.MATERIALS,
      label: (
        <Badge count={totalSelected} showZero size="small" offset={[-4, 0]}>
          <span>
            <BookOutlined />
            素材库
          </span>
        </Badge>
      ),
      children: (
        <div style={{ padding: '12px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Input
              placeholder="搜索素材名称或描述..."
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              size="small"
              style={{ flex: 1 }}
            />
            <Tooltip title="刷新素材列表">
              <Button
                icon={<ReloadOutlined />}
                size="small"
                onClick={handleRefresh}
                loading={loading}
              />
            </Tooltip>
          </div>

          {totalSelected > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: token.colorFillQuaternary,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedSummaryVisible(!selectedSummaryVisible)}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <UnorderedListOutlined style={{ marginRight: 4 }} />
                  已选素材 ({totalSelected})
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {selectedSummaryVisible ? '收起' : '展开'}
                </Text>
              </div>

              {selectedSummaryVisible && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedWorldBookCount > 0 && (
                    <Tag color="blue" closable onClose={() => {
                      filteredWorldBooks.filter(w => w.isSelected).forEach(w => toggleMaterial('worldbook', w.id));
                    }}>
                      世界书 {selectedWorldBookCount}
                    </Tag>
                  )}
                  {selectedCharacterCount > 0 && (
                    <Tag color="green" closable onClose={() => {
                      filteredCharacters.filter(c => c.isSelected).forEach(c => toggleMaterial('character', c.id));
                    }}>
                      角色卡 {selectedCharacterCount}
                    </Tag>
                  )}
                  {selectedPersonaCount > 0 && (
                    <Tag color="purple" closable onClose={() => {
                      filteredPersonas.filter(p => p.isSelected).forEach(p => toggleMaterial('persona', p.id));
                    }}>
                      用户人设 {selectedPersonaCount}
                    </Tag>
                  )}
                  {selectedKnowledgeCount > 0 && (
                    <Tag color="orange" closable onClose={() => {
                      filteredKnowledgeItems.filter(k => k.isSelected).forEach(k => toggleMaterial('knowledge', k.id));
                    }}>
                      知识库 {selectedKnowledgeCount}
                    </Tag>
                  )}
                </div>
              )}
            </div>
          )}

          <Spin spinning={loading} size="small">
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Tabs
                activeKey={activeMaterialTab}
                onChange={setActiveMaterialTab}
                size="small"
                items={materialSubTabs}
                style={{ height: '100%' }}
              />
            </div>
          </Spin>
        </div>
      ),
    },
    {
      key: RightPanelTab.PLOT_CHECK,
      label: (
        <span>
          <SafetyOutlined />
          剧情检查
        </span>
      ),
      children: (
        <PlotCheckPanelContent
          report={plotCheckReport || null}
          loading={plotCheckLoading || false}
          chapterContent={chapterContent}
          onAutoFix={onPlotCheckAutoFix}
          onQuickFix={onPlotCheckQuickFix}
          onBatchFix={onPlotCheckBatchFix}
          onContentUpdated={onContentUpdated}
          onRecheck={onRecheck}
        />
      ),
    },
    {
      key: RightPanelTab.TABLE_ORGANIZE,
      label: (
        <span>
          <TableOutlined />
          表格整理
        </span>
      ),
      children: (
        <TableOrganizeMainPanel
          projectId={tableProjectId}
          chapterId={tableChapterId}
          chapterTitle={tableChapterTitle}
          chapterContent={chapterContent}
          onComplete={onTableOrganizeComplete}
          onOrganizeStatusChange={onTableOrganizeStatusChange}
        />
      ),
    },
  ];

  return (
    <div
      style={{
        width,
        height: '100%',
        borderLeft: `1px solid ${token.colorBorder}`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: token.colorBgContainer,
        position: 'relative',
      }}
    >
      {/* Drag resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: RESIZE_HANDLE_WIDTH,
          cursor: 'ew-resize',
          zIndex: 10,
          background: isResizing ? token.colorPrimary : 'transparent',
          opacity: isResizing ? 0.5 : 0,
          transition: 'opacity 0.2s, background 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) {
            e.currentTarget.style.opacity = '0.3';
            e.currentTarget.style.background = token.colorPrimaryBorder;
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing) {
            e.currentTarget.style.opacity = '0';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      />
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorder}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0 }}>辅助面板</h3>
        <Button onClick={onClose} size="small">
          关闭
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 16px' }}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => onTabChange(key as RightPanelTab)}
          items={tabItems}
          style={{ height: '100%' }}
        />
      </div>

      <Modal
        title={`写作风格分析: ${selectedStyleForPreview?.name || ''}`}
        open={!!selectedStyleForPreview}
        onCancel={() => setSelectedStyleForPreview(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedStyleForPreview(null)}>
            关闭
          </Button>,
        ]}
        width={700}
      >
        {selectedStyleForPreview?.metadata?.analysis && (
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="风格概述">
                {JSON.stringify(selectedStyleForPreview.metadata.analysis.styleOverview, null, 2)}
              </Descriptions.Item>
              <Descriptions.Item label="核心写作技巧">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {selectedStyleForPreview.metadata.analysis.coreTechniques?.map((t: string, i: number) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Descriptions.Item>
              <Descriptions.Item label="语言特色">
                {JSON.stringify(selectedStyleForPreview.metadata.analysis.languageFeatures, null, 2)}
              </Descriptions.Item>
              <Descriptions.Item label="叙事结构">
                {JSON.stringify(selectedStyleForPreview.metadata.analysis.narrativeStructure, null, 2)}
              </Descriptions.Item>
              <Descriptions.Item label="可模仿要素">
                {JSON.stringify(selectedStyleForPreview.metadata.analysis.imitableElements, null, 2)}
              </Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Text strong>完整分析报告:</Text>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: token.colorFillQuaternary,
                padding: 12,
                borderRadius: 6,
                marginTop: 8,
                maxHeight: 300,
                overflow: 'auto',
                fontSize: 12
              }}>
                {selectedStyleForPreview.metadata.analysis.fullReport}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WritingModeRightPanel;
