import React, { useState, useCallback, useRef } from 'react';
import { Tabs, Input, Button, Empty, Tag, Tooltip, Typography, Spin, Badge, Modal, Progress, Upload, message, Descriptions, Popconfirm, Select } from 'antd';
import { BookOutlined, SearchOutlined, ReloadOutlined, GlobalOutlined, IdcardOutlined, UserOutlined, UnorderedListOutlined, UploadOutlined, DeleteOutlined, StopOutlined, FileTextOutlined, SafetyOutlined, TableOutlined, DownloadOutlined, ClearOutlined, SaveOutlined, SyncOutlined, LinkOutlined, RocketOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import type { MaterialItem, MaterialType, PlotCheckReport, PlotCheckIssue, LogicCheckIssue } from '../../../../shared/types/writing.types';
import { PlotCheckDimension, IssueSeverity, LogicContradictionType, LOGIC_CONTRADICTION_TYPE_LABELS, PLOT_CHECK_DIMENSION_LABELS, ISSUE_SEVERITY_LABELS } from '../../../../shared/types/writing.types';
import { useWritingMaterials } from './useWritingMaterials';
import MaterialList from './MaterialList';
import { RightPanelTab } from '../../../stores/writingModeUIStore';
import { useSettingStore } from '../../../stores/settingStore';
import {
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  ToolOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  EditOutlined
} from '@ant-design/icons';

const { Text } = Typography;
const { Option } = Select;

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  [IssueSeverity.HIGH]: 'red',
  [IssueSeverity.MEDIUM]: 'orange',
  [IssueSeverity.LOW]: 'blue'
};

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 600;
const RESIZE_HANDLE_WIDTH = 5;

const LOGIC_TYPE_COLORS: Record<LogicContradictionType, string> = {
  [LogicContradictionType.ITEM_STATE]: 'purple',
  [LogicContradictionType.ECONOMIC]: 'gold',
  [LogicContradictionType.CHARACTER_STATE]: 'red',
  [LogicContradictionType.PHYSICAL_LAW]: 'cyan',
  [LogicContradictionType.PLOT_SETTING]: 'orange',
  [LogicContradictionType.MATHEMATICAL]: 'blue'
};

const DIMENSION_ICONS: Record<PlotCheckDimension, React.ReactNode> = {
  [PlotCheckDimension.OUTLINE_CONSISTENCY]: <InfoCircleOutlined />,
  [PlotCheckDimension.WORLDBOOK_COMPLIANCE]: <ExclamationCircleOutlined />,
  [PlotCheckDimension.CHARACTER_CONSISTENCY]: <CloseCircleOutlined />,
  [PlotCheckDimension.WRITING_STYLE]: <InfoCircleOutlined />,
  [PlotCheckDimension.PLOT_CONTINUITY]: <ExclamationCircleOutlined />
};

const getScoreColor = (score: number): string => {
  if (score >= 90) return '#52c41a';
  if (score >= 70) return '#faad14';
  return '#ff4d4f';
};

const getOverallStatus = (score: number): { text: string; icon: React.ReactNode; color: string } => {
  if (score >= 90) return { text: '优秀', icon: <CheckCircleOutlined />, color: '#52c41a' };
  if (score >= 70) return { text: '良好', icon: <InfoCircleOutlined />, color: '#faad14' };
  if (score >= 50) return { text: '一般', icon: <ExclamationCircleOutlined />, color: '#fa8c16' };
  return { text: '需要改进', icon: <CloseCircleOutlined />, color: '#ff4d4f' };
};

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

interface IssueEntry {
  key: string;
  issue: PlotCheckIssue | LogicCheckIssue;
  issueType: 'dimension' | 'logic';
  dimension?: PlotCheckDimension;
}

const PlotCheckPanelContent: React.FC<{
  report: PlotCheckReport | null;
  loading: boolean;
  chapterContent?: string;
  onAutoFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic') => Promise<{ success: boolean; fixedContent?: string; error?: string }>;
  onQuickFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', onComplete?: () => void) => void;
  onBatchFix?: (selectedIssues: Array<{ key: string; issue: PlotCheckIssue | LogicCheckIssue; issueType: 'dimension' | 'logic' }>) => Promise<{ success: boolean; fixedContent?: string; results?: Array<{ index: number; success: boolean; error?: string }>; error?: string }>;
  onContentUpdated?: (fixedContent: string) => void;
  onRecheck?: () => void;
}> = ({ report, loading, chapterContent, onAutoFix, onQuickFix, onBatchFix, onContentUpdated, onRecheck }) => {
  const { token } = theme.useToken();
  const [fixingIssueKey, setFixingIssueKey] = useState<string | null>(null);
  const [globalFixing, setGlobalFixing] = useState<boolean>(false);
  const [fixedIssueKeys, setFixedIssueKeys] = useState<Set<string>>(new Set());
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<Set<string>>(new Set());
  const [batchFixing, setBatchFixing] = useState(false);
  const [batchFixResults, setBatchFixResults] = useState<Array<{ index: number; success: boolean; error?: string }> | null>(null);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin size="large" tip="剧情检查中..." />
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ padding: '16px 0' }}>
        <Empty description="暂无剧情检查报告，点击「剧情检查」按钮开始检查" />
        {onRecheck && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button type="primary" icon={<SafetyOutlined />} onClick={onRecheck}>
              开始剧情检查
            </Button>
          </div>
        )}
      </div>
    );
  }

  const status = getOverallStatus(report.overallScore);

  const isIssueFixed = (key: string) => {
    if (fixedIssueKeys.has(key)) {
      return true;
    }
    const issueEntry = allIssues.find(entry => entry.key === key);
    if (issueEntry && issueEntry.issue.corrected) {
      return true;
    }
    return false;
  };
  const isIssueFixing = (key: string) => fixingIssueKey === key;
  const isIssueSelected = (key: string) => selectedIssueKeys.has(key);

  const allIssues: IssueEntry[] = [];

  report.dimensions.forEach((dim) => {
    dim.issues.forEach((issue, idx) => {
      const key = `dimension-${dim.dimension}-${idx}`;
      allIssues.push({ key, issue, issueType: 'dimension', dimension: dim.dimension });
    });
  });

  if (report.logicCheckResult) {
    report.logicCheckResult.issues.forEach((issue, idx) => {
      const key = `logic-${idx}`;
      allIssues.push({ key, issue, issueType: 'logic' });
    });
  }

  const selectableIssues = allIssues.filter(e => !isIssueFixed(e.key));

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIssueKeys(new Set(selectableIssues.map(e => e.key)));
    } else {
      setSelectedIssueKeys(new Set());
    }
  };

  const handleSelectIssue = (key: string, checked: boolean) => {
    setSelectedIssueKeys(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const isAllSelected = selectableIssues.length > 0 && selectableIssues.every(e => selectedIssueKeys.has(e.key));
  const isPartiallySelected = selectableIssues.length > 0 && selectedIssueKeys.size > 0 && !isAllSelected;

  const handleBatchFix = async () => {
    if (!onBatchFix || !chapterContent || selectedIssueKeys.size === 0 || globalFixing) return;

    setGlobalFixing(true);
    setBatchFixing(true);
    setBatchFixResults(null);
    try {
      const selectedEntries = allIssues.filter(e => selectedIssueKeys.has(e.key));
      const selectedData = selectedEntries.map(e => ({
        key: e.key,
        issue: e.issue,
        issueType: e.issueType
      }));

      const result = await onBatchFix(selectedData);

      if (result.success && result.fixedContent) {
        const newFixedKeys = new Set(fixedIssueKeys);
        selectedEntries.forEach(e => newFixedKeys.add(e.key));
        setFixedIssueKeys(newFixedKeys);
        onContentUpdated?.(result.fixedContent);

        if (result.results) {
          setBatchFixResults(result.results);
          const successCount = result.results.filter(r => r.success).length;
          const failCount = result.results.filter(r => !r.success).length;
          if (failCount === 0) {
            message.success(`批量修正成功！已修复 ${successCount} 个问题`);
          } else {
            message.warning(`批量修正完成：${successCount} 个成功，${failCount} 个失败`);
          }
        } else {
          message.success(`批量修正成功！已修复 ${selectedEntries.length} 个问题`);
        }
      } else {
        message.error(result.error || '批量修正失败，请稍后重试');
      }
    } catch (error) {
      message.error('批量修正失败，请稍后重试');
    } finally {
      setBatchFixing(false);
      setGlobalFixing(false);
    }
  };

  const handleAutoFix = async (issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', issueKey: string) => {
    if (!onAutoFix || !chapterContent) {
      message.warning('自动修正功能暂不可用');
      return;
    }

    setGlobalFixing(true);
    setFixingIssueKey(issueKey);
    try {
      const result = await onAutoFix(chapterContent, issue, issueType);
      
      if (result.success && result.fixedContent) {
        setFixedIssueKeys(prev => new Set([...prev, issueKey]));
        onContentUpdated?.(result.fixedContent);
        message.success('问题已自动修正，编辑器内容已更新');
      } else {
        message.error(result.error || '修正失败，请稍后重试');
      }
    } catch (error) {
      message.error('修正失败，请稍后重试');
    } finally {
      setFixingIssueKey(null);
      setGlobalFixing(false);
    }
  };

  const handleQuickFix = (issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', issueKey: string) => {
    if (!onQuickFix || !chapterContent) {
      message.warning('快速修正功能暂不可用');
      return;
    }

    if (!issue.quickFixSuggestion) {
      message.warning('该问题暂无快速修正建议');
      return;
    }

    setGlobalFixing(true);
    onQuickFix(chapterContent, issue, issueType, () => {
      setGlobalFixing(false);
    });
  };

  const renderOriginalText = (originalText?: { snippet: string; start: number; end: number }[]) => {
    if (!originalText || originalText.length === 0) return null;
    return (
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          <FileTextOutlined /> 相关原文：
        </Text>
        {originalText.map((ot, i) => (
          <div
            key={i}
            style={{
              marginTop: 4,
              padding: '6px 10px',
              background: '#1a1a2e',
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'monospace',
              color: '#c8d6e5',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {ot.snippet}
          </div>
        ))}
      </div>
    );
  };

  const renderReferences = (references?: { type: string; name: string; summary: string }[]) => {
    if (!references || references.length === 0) return null;
    return (
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          <BookOutlined /> 参考资料：
        </Text>
        <div style={{ marginTop: 4 }}>
          {references.map((ref, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
              <Tag color="default" style={{ fontSize: 10, margin: 0 }}>{ref.type}</Tag>
              <Text strong style={{ fontSize: 12 }}>{ref.name}</Text>
              {ref.summary && <Text type="secondary" style={{ fontSize: 11 }}>{ref.summary}</Text>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const hasSelectableIssues = selectableIssues.length > 0;
  const hasSelectedIssues = selectedIssueKeys.size > 0;

  return (
    <div style={{ padding: '12px 0', height: '100%', overflow: 'auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ color: status.color }}>{status.icon}</span>
          <Text strong style={{ color: status.color, fontSize: 16 }}>{status.text}</Text>
        </div>
        <div style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 32, fontWeight: 'bold', color: status.color }}>{report.overallScore}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>分</Text>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 12 }}>
        <Tag icon={<CloseCircleOutlined />} color="red">高危 {report.highSeverityCount}</Tag>
        <Tag icon={<ExclamationCircleOutlined />} color="orange">中等 {report.mediumSeverityCount}</Tag>
        <Tag icon={<InfoCircleOutlined />} color="blue">建议 {report.lowSeverityCount}</Tag>
        <Tag color="default">共 {report.totalIssues} 个问题</Tag>
      </div>

      {hasSelectableIssues && onBatchFix && chapterContent && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: token.colorFillQuaternary, borderRadius: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Button
              size="small"
              type="text"
              onClick={() => handleSelectAll(!isAllSelected)}
            >
              {isAllSelected ? '取消全选' : '全选'}
            </Button>
            <Text type="secondary" style={{ fontSize: 11 }}>
              已选 {selectedIssueKeys.size}/{selectableIssues.length}
            </Text>
          </div>
          <Button
            type="primary"
            size="small"
            icon={batchFixing ? <LoadingOutlined /> : <ThunderboltOutlined />}
            onClick={handleBatchFix}
            loading={batchFixing}
            disabled={!hasSelectedIssues || batchFixing || globalFixing}
          >
            {batchFixing ? '修正中...' : `一键修复(${selectedIssueKeys.size})`}
          </Button>
        </div>
      )}

      {batchFixResults && (
        <div style={{ marginBottom: 12, padding: 8, background: token.colorFillQuaternary, borderRadius: 6 }}>
          <Text strong style={{ fontSize: 11 }}>批量修正结果</Text>
          {batchFixResults.map((r, i) => {
            const entry = allIssues[r.index];
            const title = entry ? (entry.issue as PlotCheckIssue).title || (entry.issue as LogicCheckIssue).description : `问题 ${r.index + 1}`;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginTop: 4 }}>
                {r.success ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )}
                <Text style={{ color: r.success ? '#52c41a' : '#ff4d4f', flex: 1 }}>{title}</Text>
                {!r.success && r.error && <Text type="secondary" style={{ fontSize: 10 }}>{r.error}</Text>}
              </div>
            );
          })}
        </div>
      )}

      {report.dimensions.map((dim) => {
        const scoreColor = getScoreColor(dim.score);
        return (
          <div
            key={dim.dimension}
            style={{
              marginBottom: 10,
              padding: 10,
              border: `1px solid ${dim.passed ? token.colorBorder : scoreColor}`,
              borderRadius: 6,
              background: token.colorFillQuaternary
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>{DIMENSION_ICONS[dim.dimension]}</span>
              <Text strong style={{ fontSize: 12 }}>{PLOT_CHECK_DIMENSION_LABELS[dim.dimension]}</Text>
              <Progress
                percent={dim.score}
                size="small"
                strokeColor={scoreColor}
                format={(percent) => `${percent}`}
                style={{ width: 60 }}
              />
              <Tag color={dim.passed ? 'success' : 'warning'} style={{ fontSize: 10 }}>
                {dim.passed ? '通过' : '需关注'}
              </Tag>
            </div>

            {dim.issues.length > 0 && (
              <div>
                {dim.issues.map((issue, idx) => {
                  const issueKey = `dimension-${dim.dimension}-${idx}`;
                  const fixed = isIssueFixed(issueKey);
                  const fixing = isIssueFixing(issueKey);
                  const selected = isIssueSelected(issueKey);

                  return (
                    <div
                      key={idx}
                      style={{
                        marginTop: 6,
                        padding: 8,
                        background: token.colorBgContainer,
                        borderRadius: 4,
                        border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        {onBatchFix && !fixed && (
                          <Button
                            size="small"
                            type="text"
                            style={{ padding: '0 4px', minWidth: 'auto' }}
                            onClick={() => handleSelectIssue(issueKey, !selected)}
                          >
                            {selected ? '☑' : '☐'}
                          </Button>
                        )}
                        <Tag color={SEVERITY_COLORS[issue.severity]} style={{ fontSize: 10 }}>
                          {ISSUE_SEVERITY_LABELS[issue.severity]}
                        </Tag>
                        <Text strong style={{ fontSize: 12, textDecoration: fixed ? 'line-through' : undefined, flex: 1 }}>{issue.title}</Text>
                        {fixed && <Tag color="success" style={{ fontSize: 10 }}>已修正</Tag>}
                      </div>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>{issue.description}</Text>
                      <Text style={{ fontSize: 11, color: '#52c41a', display: 'block' }}>💡 {issue.suggestion}</Text>
                      {renderOriginalText((issue as PlotCheckIssue).originalText)}
                      {renderReferences((issue as PlotCheckIssue).references)}
                      {fixed && issue.correctedText && (
                        <div style={{ marginTop: 8, padding: '8px', background: token.colorSuccessBg, border: `1px solid ${token.colorSuccessBorder}`, borderRadius: 4 }}>
                          <Text strong style={{ color: token.colorSuccess, fontSize: 11 }}>修正后:</Text>
                          <div style={{ marginTop: 4, fontSize: 11, color: token.colorText }}>{issue.correctedText}</div>
                        </div>
                      )}
                      {onQuickFix && chapterContent && issue.quickFixSuggestion && !fixed && (
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => handleQuickFix(issue, 'dimension', issueKey)}
                          disabled={globalFixing}
                          style={{ marginTop: 6, marginRight: 6 }}
                        >
                          快速修正
                        </Button>
                      )}
                      {onAutoFix && chapterContent && !fixed && (
                        <Button
                          type="primary"
                          size="small"
                          icon={fixing ? <LoadingOutlined /> : <ToolOutlined />}
                          onClick={() => handleAutoFix(issue, 'dimension', issueKey)}
                          loading={fixing}
                          disabled={fixing || globalFixing}
                          style={{ marginTop: 6 }}
                        >
                          {fixing ? '修正中...' : '自动修正'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {report.logicCheckResult && report.logicCheckResult.totalIssues > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            border: `1px solid ${report.logicCheckResult.highSeverityCount > 0 ? '#ff4d4f' : '#faad14'}`,
            borderRadius: 6,
            background: token.colorFillQuaternary
          }}
        >
          <Text strong style={{ fontSize: 12 }}>逻辑异常检测</Text>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, marginBottom: 8 }}>
            <Tag icon={<CloseCircleOutlined />} color="red">高危 {report.logicCheckResult.highSeverityCount}</Tag>
            <Tag icon={<ExclamationCircleOutlined />} color="orange">中等 {report.logicCheckResult.mediumSeverityCount}</Tag>
            <Tag icon={<InfoCircleOutlined />} color="blue">建议 {report.logicCheckResult.lowSeverityCount}</Tag>
          </div>
          {report.logicCheckResult.issues.map((issue, idx) => {
            const issueKey = `logic-${idx}`;
            const fixed = isIssueFixed(issueKey);
            const fixing = isIssueFixing(issueKey);
            const selected = isIssueSelected(issueKey);

            return (
              <div
                key={idx}
                style={{
                  marginTop: 6,
                  padding: 8,
                  background: token.colorBgContainer,
                  borderRadius: 4,
                  border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {onBatchFix && !fixed && (
                    <Button
                      size="small"
                      type="text"
                      style={{ padding: '0 4px', minWidth: 'auto' }}
                      onClick={() => handleSelectIssue(issueKey, !selected)}
                    >
                      {selected ? '☑' : '☐'}
                    </Button>
                  )}
                  <Tag color={LOGIC_TYPE_COLORS[issue.type]} style={{ fontSize: 10 }}>{LOGIC_CONTRADICTION_TYPE_LABELS[issue.type]}</Tag>
                  <Text strong style={{ fontSize: 12, textDecoration: fixed ? 'line-through' : undefined, flex: 1 }}>{issue.description}</Text>
                  <Tag color={SEVERITY_COLORS[issue.severity]} style={{ fontSize: 10 }}>{ISSUE_SEVERITY_LABELS[issue.severity]}</Tag>
                  {fixed && <Tag color="success" style={{ fontSize: 10 }}>已修正</Tag>}
                </div>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>{issue.analysis}</Text>
                {issue.suggestion && <Text style={{ fontSize: 11, color: '#52c41a', display: 'block', marginBottom: 4 }}>💡 {issue.suggestion}</Text>}
                {renderOriginalText((issue as LogicCheckIssue).originalText)}
                {renderReferences((issue as LogicCheckIssue).references)}
                {fixed && issue.correctedText && (
                  <div style={{ marginTop: 8, padding: '8px', background: token.colorSuccessBg, border: `1px solid ${token.colorSuccessBorder}`, borderRadius: 4 }}>
                    <Text strong style={{ color: token.colorSuccess, fontSize: 11 }}>修正后:</Text>
                    <div style={{ marginTop: 4, fontSize: 11, color: token.colorText }}>{issue.correctedText}</div>
                  </div>
                )}
                {onQuickFix && chapterContent && issue.quickFixSuggestion && !fixed && (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleQuickFix(issue, 'logic', issueKey)}
                    disabled={globalFixing}
                    style={{ marginTop: 6, marginRight: 6 }}
                  >
                    快速修正
                  </Button>
                )}
                {onAutoFix && chapterContent && !fixed && (
                  <Button
                    type="primary"
                    size="small"
                    icon={fixing ? <LoadingOutlined /> : <ToolOutlined />}
                    onClick={() => handleAutoFix(issue, 'logic', issueKey)}
                    loading={fixing}
                    disabled={fixing || globalFixing}
                    style={{ marginTop: 6 }}
                  >
                    {fixing ? '修正中...' : '自动修正'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const TableOrganizePanelContent: React.FC<{
  projectId?: string;
  chapterId?: number;
  chapterTitle?: string;
  chapterContent?: string;
  onComplete?: () => void;
  onOrganizeStatusChange?: (isOrganizing: boolean) => void;
}> = ({ projectId, chapterId, chapterTitle, onComplete, onOrganizeStatusChange }) => {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [sheets, setSheets] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [allSheetData, setAllSheetData] = useState<Record<string, Record<string, any>[]>>({});
  const [allSheetHeaders, setAllSheetHeaders] = useState<Record<string, string[]>>({});
  const [tableData, setTableData] = useState<Record<string, any>[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // 模板绑定相关状态
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description?: string; sheets: Array<{ name: string; headers: string[]; description?: string }>; isCopy?: boolean }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [bindingLoading, setBindingLoading] = useState(false);

  // 整理相关状态
  const [organizing, setOrganizing] = useState(false);
  const [organizeProgress, setOrganizeProgress] = useState<number>(0);
  const [organizeStatus, setOrganizeStatus] = useState<string>('');
  const [currentOrganizeInfo, setCurrentOrganizeInfo] = useState<{ processedCount: number; totalChapters: number } | null>(null);

  // 保存/同步状态
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string>('');

  // 表格配置状态
  const [tableConfig, setTableConfig] = useState<{
    enabled: boolean;
    autoOrganize: boolean;
    organizeMode: string;
    associatedTemplateId: string | null;
    associatedTemplateName: string;
  } | null>(null);

  const DEFAULT_TEMPLATE_ID = 'st-memory-enhancement-default';

  const setting = useSettingStore((state) => state.setting);
  const aiEngines = setting?.aiEngines || [];
  const activeEngine = aiEngines.find((e: any) => e.is_active) || aiEngines[0];

  const tableDataRef = useRef(tableData);
  const allSheetDataRef = useRef(allSheetData);
  const allSheetHeadersRef = useRef(allSheetHeaders);
  const currentSheetRef = useRef(currentSheet);
  const editingCellRef = useRef(editingCell);
  const editValueRef = useRef(editValue);
  const tableConfigRef = useRef(tableConfig);

  React.useEffect(() => { tableDataRef.current = tableData; }, [tableData]);
  React.useEffect(() => { allSheetDataRef.current = allSheetData; }, [allSheetData]);
  React.useEffect(() => { allSheetHeadersRef.current = allSheetHeaders; }, [allSheetHeaders]);
  React.useEffect(() => { currentSheetRef.current = currentSheet; }, [currentSheet]);
  React.useEffect(() => { editingCellRef.current = editingCell; }, [editingCell]);
  React.useEffect(() => { editValueRef.current = editValue; }, [editValue]);
  React.useEffect(() => { tableConfigRef.current = tableConfig; }, [tableConfig]);

  const loadTableConfig = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await window.electronAPI.writing.table.getTableConfig(projectId);
      const configResponse = response?.config || response;
      if (configResponse && (configResponse.enabled || configResponse.associatedTemplateId)) {
        setTableConfig(configResponse);
      } else {
        setTableConfig(null);
      }
    } catch (err) {
      console.error('Failed to load table config:', err);
      setTableConfig(null);
    }
  }, [projectId]);

  const loadTableData = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    try {
      const response = await window.electronAPI.writing.table.getTableData(projectId);

      if (response.success && response.data && response.data.sheets && response.data.sheets.length > 0) {
        const data = response.data;
        setSheets(data.sheets);
        const sheetData = data.data || {};
        const sheetHeaders = data.headers || {};
        setAllSheetData(sheetData);
        setAllSheetHeaders(sheetHeaders);

        const firstSheet = data.sheets[0];
        setCurrentSheet(firstSheet);
        setTableData(sheetData[firstSheet] || []);
      }
      // 表格文件不存在是正常状态，不设置error，让用户看到绑定模板按钮
    } catch (err) {
      // 表格文件不存在时不报错，正常显示空状态
      console.log('[TableOrganize] 表格文件不存在或加载失败，显示绑定模板入口');
    } finally {
      setLoading(false);
    }

    await loadTableConfig();
  }, [projectId, loadTableConfig]);

  React.useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  const handleSheetChange = useCallback((sheetName: string) => {
    setCurrentSheet(sheetName);
    setTableData(allSheetData[sheetName] || []);
  }, [allSheetData]);

  // 导出CSV
  const handleExport = useCallback(() => {
    if (!currentSheet || !allSheetHeaders[currentSheet]) return;

    const headers = allSheetHeaders[currentSheet];
    const data = allSheetData[currentSheet] || [];

    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(h => {
        const val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
        return val.includes(',') ? `"${val}"` : val;
      }).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `writing_${projectId}_${currentSheet}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [currentSheet, allSheetData, allSheetHeaders, projectId]);

  const startEdit = useCallback((record: Record<string, any>, colKey: string) => {
    setEditingCell({ rowKey: record.key, colKey });
    setEditValue(record[colKey] || '');
  }, []);

  const saveEdit = useCallback(async () => {
    const cell = editingCellRef.current;
    const sheet = currentSheetRef.current;
    const value = editValueRef.current;
    const headers = allSheetHeadersRef.current[sheet] || [];
    const data = tableDataRef.current;
    const allData = allSheetDataRef.current;
    const projId = projectId;

    if (!cell || !sheet) return;

    const { rowKey, colKey } = cell;
    const rowIndex = parseInt(rowKey, 10);
    const colIndex = headers.findIndex((_, idx) => idx.toString() === colKey);

    if (colIndex < 0 || rowIndex < 0 || rowIndex >= data.length) return;

    const newData = [...data];
    const updatedRow = { ...newData[rowIndex] };
    updatedRow[colIndex.toString()] = value;
    newData[rowIndex] = updatedRow;
    setTableData(newData);

    const updatedSheetData = { ...allData };
    updatedSheetData[sheet] = newData;
    setAllSheetData(updatedSheetData);

    setEditingCell(null);
    setEditValue('');

    try {
      setSyncing(true);
      const result = await window.electronAPI.writing.table.updateRowInTable(
        projId!,
        sheet,
        rowIndex,
        updatedRow
      );
      if (result.success) {
        setLastSynced(new Date().toLocaleTimeString());
        message.success('已同步');
      } else {
        message.error('同步失败');
      }
    } catch (error) {
      message.error(`同步失败: ${error}`);
    } finally {
      setSyncing(false);
    }
  }, [projectId]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const columns = React.useMemo(() => {
    if (!currentSheet || !allSheetHeaders[currentSheet]) return [];

    return allSheetHeaders[currentSheet].map((header, index) => ({
      title: header,
      dataIndex: index.toString(),
      key: header,
      ellipsis: true,
      onCell: (record: Record<string, any>) => ({
        onClick: () => startEdit(record, index.toString()),
        style: { cursor: 'pointer', userSelect: 'none' },
      }),
      render: (text: string, record: Record<string, any>) => {
        if (editingCell && editingCell.rowKey === record.key && editingCell.colKey === index.toString()) {
          return (
            <Input
              size="small"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={saveEdit}
              onBlur={saveEdit}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        return text || '-';
      },
      width: Math.max(100, header.length * 20),
    }));
  }, [currentSheet, allSheetHeaders, editingCell, editValue, startEdit, saveEdit]);

  const dataSource = React.useMemo(() => {
    return tableData.map((row, rowIndex) => {
      const item: Record<string, any> = { key: rowIndex.toString() };
      const headers = allSheetHeaders[currentSheet] || [];
      headers.forEach((header, index) => {
        const val = row[header];
        if (val !== undefined && val !== null) {
          item[index.toString()] = String(val);
        } else if (row[index.toString()] !== undefined) {
          item[index.toString()] = String(row[index.toString()]);
        } else {
          item[index.toString()] = '';
        }
      });
      return item;
    });
  }, [tableData, currentSheet, allSheetHeaders]);

  // 保存修改
  const handleSave = useCallback(async () => {
    if (!currentSheet || !projectId) return;

    setSaving(true);
    try {
      const headers = allSheetHeaders[currentSheet] || [];
      const storageData = tableData.map(row => {
        const storageRow: Record<string, any> = {};
        headers.forEach((_, index) => {
          storageRow[index.toString()] = row[index.toString()] || '';
        });
        return storageRow;
      });

      await window.electronAPI.writing.table.saveTableData(projectId, currentSheet, storageData);
      message.success(`表格"${currentSheet}"已保存`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败: ${errorMsg}`);
    } finally {
      setSaving(false);
    }
  }, [currentSheet, projectId, allSheetHeaders, tableData]);

  // 清空当前表格
  const handleClearCurrentSheet = useCallback(async () => {
    if (!currentSheet || !projectId) return;

    try {
      await window.electronAPI.writing.table.saveTableData(projectId, currentSheet, []);
      message.success(`表格"${currentSheet}"已清空`);
      loadTableData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [currentSheet, projectId, loadTableData]);

  // 清空所有表格
  const handleClearAll = useCallback(async () => {
    if (!projectId) return;

    try {
      await window.electronAPI.writing.table.clearTableData(projectId);
      message.success('所有表格数据已清空');
      loadTableData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [projectId, loadTableData]);

  // 同步到存储
  const handleManualSync = async () => {
    if (!currentSheet || !projectId) return;

    setSyncing(true);
    try {
      const currentData = allSheetData[currentSheet] || [];
      let successCount = 0;
      for (let i = 0; i < currentData.length; i++) {
        const result = await window.electronAPI.writing.table.updateRowInTable(
          projectId,
          currentSheet,
          i,
          currentData[i]
        );
        if (result.success) successCount++;
      }
      setLastSynced(new Date().toLocaleTimeString());
      message.success(`已同步 ${successCount} 行数据`);
    } catch (error) {
      message.error(`同步失败: ${error}`);
    } finally {
      setSyncing(false);
    }
  };

  // 模板绑定相关函数
  const handleOpenTemplateModal = useCallback(async () => {
    try {
      const response = await window.electronAPI.writing.table.getAllTemplates();
      if (response.success && response.templates) {
        const originalTemplates = response.templates.filter((t: any) => !t.isCopy);
        const sortedTemplates = [...originalTemplates].sort((a: any, b: any) => {
          if (a.id === DEFAULT_TEMPLATE_ID) return -1;
          if (b.id === DEFAULT_TEMPLATE_ID) return 1;
          return a.name.localeCompare(b.name);
        });
        setTemplates(sortedTemplates);
        if (tableConfig?.associatedTemplateId) {
          setSelectedTemplateId(tableConfig.associatedTemplateId);
        } else {
          const defaultTemplate = sortedTemplates.find((t: any) => t.id === DEFAULT_TEMPLATE_ID);
          setSelectedTemplateId(defaultTemplate?.id || '');
        }
        setTemplateModalVisible(true);
      } else {
        message.error('获取模板列表失败');
      }
    } catch (error) {
      message.error(`获取模板失败: ${error}`);
    }
  }, [tableConfig]);

  const handleBindTemplate = useCallback(async () => {
    if (!selectedTemplateId) {
      message.warning('请选择要绑定的模板');
      return;
    }

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
    if (!selectedTemplate) {
      message.error('模板不存在');
      return;
    }

    const sheetsData = selectedTemplate.sheets;
    const sheetsValid = sheetsData && Array.isArray(sheetsData) && sheetsData.length > 0;

    if (!sheetsValid) {
      message.error('模板数据不完整');
      return;
    }

    setBindingLoading(true);
    try {
      const result = await window.electronAPI.writing.table.associateTableTemplate(
        projectId!,
        selectedTemplateId,
        selectedTemplate.name,
        sheetsData
      );
      if (result.success) {
        message.success(`已绑定模板: ${selectedTemplate.name}`);
        setTemplateModalVisible(false);
        setSelectedTemplateId('');
        const newConfig = {
          enabled: true,
          autoOrganize: false,
          organizeMode: 'sync' as const,
          associatedTemplateId: selectedTemplateId,
          associatedTemplateName: selectedTemplate.name
        };
        setTableConfig(newConfig);
        loadTableData();
      } else {
        message.error(`绑定模板失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`绑定模板失败: ${error}`);
    } finally {
      setBindingLoading(false);
    }
  }, [projectId, selectedTemplateId, templates, loadTableData]);

  // 开始整理
  const handleStartOrganize = useCallback(async () => {
    if (organizing) {
      message.warning('整理任务正在进行中');
      return;
    }

    if (chapterId === undefined) {
      message.warning('请先选择一个章节');
      return;
    }

    // 先重新加载配置，确保获取最新状态
    const response = await window.electronAPI.writing.table.getTableConfig(projectId!);
    const currentConfig = response?.config || response;

    if (!currentConfig?.associatedTemplateId) {
      message.error('请先绑定表格模板');
      handleOpenTemplateModal();
      return;
    }

    setTableConfig(currentConfig);

    onOrganizeStatusChange?.(true);
    setOrganizing(true);
    setOrganizeProgress(0);
    setOrganizeStatus(`开始整理章节: ${chapterTitle || `第 ${chapterId} 章`}`);
    setCurrentOrganizeInfo(null);

    // 注册进度事件监听器
    let lastLoadTime = 0;
    const LOAD_THROTTLE_MS = 50;

    const progressListener = (_event: any, _projectId: string, progressData: { current: number; total: number; message: string; percent: number; timestamp: number }) => {
      try {
        setOrganizeProgress(progressData.percent || 0);
        setOrganizeStatus(progressData.message || '处理中...');
        const now = Date.now();
        if (now - lastLoadTime >= LOAD_THROTTLE_MS) {
          lastLoadTime = now;
          loadTableData();
        }
      } catch (listenerError) {
        console.error('[TableOrganize] 进度监听器错误:', listenerError);
      }
    };

    try {
      window.electronAPI.ipcRenderer.on('writing:table:organizeProgress', progressListener);
    } catch (registerError) {
      console.warn('[TableOrganize] 注册进度监听器失败:', registerError);
    }

    try {
      // 获取当前活跃的 AI 引擎配置
      const settingResponse = await window.electronAPI.setting.load();
      if (!settingResponse.success) {
        throw new Error('无法获取系统设置');
      }

      const currentSetting = settingResponse.setting;
      const activeEngineId = currentSetting?.activeEngineId;
      const engines = currentSetting?.aiEngines || [];
      const currentActiveEngine = engines.find((e: any) => e.id === activeEngineId) || engines[0];

      if (!currentActiveEngine) {
        throw new Error('未配置 AI 引擎，请在设置中配置');
      }

      const temperature = (typeof currentActiveEngine.temperature === 'number' && currentActiveEngine.temperature >= 0 && currentActiveEngine.temperature <= 2)
        ? currentActiveEngine.temperature
        : 0.7;

      const maxTokens = (typeof currentActiveEngine.max_tokens === 'number' && currentActiveEngine.max_tokens > 0)
        ? currentActiveEngine.max_tokens
        : 10240;

      const modelConfig = {
        temperature,
        maxTokens
      };

      const result = await window.electronAPI.writing.table.organizeTable(projectId!, modelConfig, chapterId);

      if (result.success) {
        setOrganizeProgress(100);
        setOrganizeStatus('整理完成');
        message.success(`表格整理完成: ${result.errorCount > 0 ? `有 ${result.errorCount} 个错误` : '成功'}`);
        loadTableData();
      } else {
        setOrganizeStatus('整理失败');
        message.error(`整理失败: ${result.errors?.join(', ') || '未知错误'}`);
      }
    } catch (error) {
      setOrganizeStatus('整理出错');
      message.error(`整理出错: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        window.electronAPI.ipcRenderer.removeListener('writing:table:organizeProgress', progressListener);
      } catch (unregisterError) {
        console.warn('[TableOrganize] 移除进度监听器失败:', unregisterError);
      }
      onOrganizeStatusChange?.(false);
      setOrganizing(false);
    }
  }, [projectId, organizing, loadTableData, handleOpenTemplateModal, chapterId, chapterTitle, onOrganizeStatusChange, activeEngine]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin size="large" tip="加载表格数据..." />
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div style={{ padding: '16px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 操作按钮区域 */}
        <div style={{ padding: '0 0 8px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button
            icon={tableConfig?.associatedTemplateId ? <CheckCircleOutlined /> : <LinkOutlined />}
            onClick={handleOpenTemplateModal}
            type={tableConfig?.associatedTemplateId ? 'link' : 'default'}
            size="small"
          >
            {tableConfig?.associatedTemplateId
              ? `已绑定: ${tableConfig.associatedTemplateName}`
              : '绑定模板'}
          </Button>
          <Button
            icon={<RocketOutlined />}
            onClick={handleStartOrganize}
            loading={organizing}
            disabled={organizing}
            size="small"
            type="primary"
          >
            {organizing ? '整理中...' : '开始整理'}
          </Button>
        </div>

        {/* 整理进度显示 */}
        {organizing && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>整理进度:</Text>
            <Progress percent={organizeProgress} status="active" size="small" />
            <Text type="secondary">{organizeStatus}</Text>
            {currentOrganizeInfo && (
              <Text type="secondary">
                {' '}({currentOrganizeInfo.processedCount}/{currentOrganizeInfo.totalChapters})
              </Text>
            )}
          </div>
        )}

        <Empty description="暂无表格数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Text type="secondary">请先绑定表格模板并开始整理</Text>
        </div>

        {/* 模板绑定 Modal */}
        <Modal
          title="绑定表格模板"
          open={templateModalVisible}
          onCancel={() => {
            setTemplateModalVisible(false);
            setSelectedTemplateId('');
          }}
          onOk={handleBindTemplate}
          confirmLoading={bindingLoading}
        >
          {tableConfig?.associatedTemplateId && (
            <div style={{ marginBottom: 16 }}>
              <Text>当前模板:</Text>{' '}
              <Tag color="green">{tableConfig.associatedTemplateName}</Tag>
            </div>
          )}

          <p>请选择要绑定的表格模板：</p>
          <Select
            style={{ width: '100%' }}
            placeholder="选择模板"
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
          >
            {templates.length === 0 ? (
              <Option value="" disabled>
                暂无可用模板
              </Option>
            ) : (
              templates.map(template => (
                <Option key={template.id} value={template.id}>
                  {template.id === DEFAULT_TEMPLATE_ID && '⭐ '}
                  {template.name}
                  {template.id === DEFAULT_TEMPLATE_ID && ' 默认模板'}
                  {template.sheets && template.sheets.length > 0 && ` (${template.sheets.length} 个页签)`}
                </Option>
              ))
            )}
          </Select>
          {selectedTemplateId && (
            <p style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              {templates.find(t => t.id === selectedTemplateId)?.description || '暂无描述'}
            </p>
          )}
          <p style={{ marginTop: 16, color: '#888', fontSize: 12 }}>
            绑定模板将创建对应的表格结构，已有的表格数据将被覆盖。
          </p>
        </Modal>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 整理进度显示 */}
      {organizing && (
        <div style={{ marginBottom: 16, padding: '0 12px' }}>
          <Text strong>整理进度:</Text>
          <Progress percent={organizeProgress} status="active" size="small" />
          <Text type="secondary">{organizeStatus}</Text>
          {currentOrganizeInfo && (
            <Text type="secondary">
              {' '}({currentOrganizeInfo.processedCount}/{currentOrganizeInfo.totalChapters})
            </Text>
          )}
        </div>
      )}

      {/* 操作按钮区域 */}
      <div style={{ padding: '0 12px 8px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button
          icon={tableConfig?.associatedTemplateId ? <CheckCircleOutlined /> : <LinkOutlined />}
          onClick={handleOpenTemplateModal}
          type={tableConfig?.associatedTemplateId ? 'link' : 'default'}
          size="small"
        >
          {tableConfig?.associatedTemplateId
            ? `已绑定: ${tableConfig.associatedTemplateName}`
            : '绑定模板'}
        </Button>
        <Button
          icon={<RocketOutlined />}
          onClick={handleStartOrganize}
          loading={organizing}
          disabled={organizing}
          size="small"
          type="primary"
        >
          {organizing ? '整理中...' : '开始整理'}
        </Button>
        <Button
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!currentSheet || tableData.length === 0}
          size="small"
        >
          保存修改
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={handleExport}
          disabled={!currentSheet || tableData.length === 0}
          size="small"
        >
          导出 CSV
        </Button>
        {lastSynced && <Text type="secondary" style={{ fontSize: 11 }}>上次同步: {lastSynced}</Text>}
        <Button
          icon={<SyncOutlined spin={syncing} />}
          onClick={handleManualSync}
          loading={syncing}
          disabled={!currentSheet || tableData.length === 0}
          size="small"
        >
          同步到存储
        </Button>
        <Popconfirm
          title={`确定清空表格"${currentSheet}"的所有数据？`}
          description="此操作不可撤销，确认后表格数据将被清空。"
          onConfirm={handleClearCurrentSheet}
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={!currentSheet || tableData.length === 0}
        >
          <Button
            icon={<ClearOutlined />}
            disabled={!currentSheet || tableData.length === 0}
            size="small"
          >
            清空当前表格
          </Button>
        </Popconfirm>
        <Popconfirm
          title="确定清空所有表格的数据？"
          description="此操作不可撤销，确认后所有表格数据将被清空。"
          onConfirm={handleClearAll}
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={sheets.length === 0}
        >
          <Button
            icon={<ClearOutlined />}
            danger
            disabled={sheets.length === 0}
            size="small"
          >
            清空所有表格
          </Button>
        </Popconfirm>
        {onComplete && (
          <Button size="small" type="primary" onClick={() => { onComplete(); }}>标记完成</Button>
        )}
      </div>

      <Tabs
        activeKey={currentSheet}
        onChange={handleSheetChange}
        size="small"
        items={sheets.map(sheetName => ({
          key: sheetName,
          label: `${sheetName} (${(allSheetData[sheetName] || []).length} 行)`,
        }))}
        style={{ marginBottom: 8, padding: '0 12px' }}
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{
                    padding: '6px 8px',
                    border: `1px solid ${token.colorBorder}`,
                    background: token.colorFillQuaternary,
                    textAlign: 'left',
                    fontWeight: 600
                  }}
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataSource.slice(0, pageSize).map((row) => (
              <tr key={row.key}>
                {columns.map(col => (
                  <td
                    key={`${row.key}-${col.key}`}
                    style={{
                      padding: '6px 8px',
                      border: `1px solid ${token.colorBorder}`,
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                    onClick={() => startEdit(row, col.dataIndex)}
                  >
                    {editingCell?.rowKey === row.key && editingCell?.colKey === col.dataIndex ? (
                      <Input
                        size="small"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onPressEnter={saveEdit}
                        onBlur={saveEdit}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      row[col.dataIndex] || '-'
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {dataSource.length > pageSize && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Text type="secondary">显示前 {pageSize} 行，共 {dataSource.length} 行</Text>
          </div>
        )}
      </div>

      {/* 模板绑定 Modal */}
      <Modal
        title="绑定表格模板"
        open={templateModalVisible}
        onCancel={() => {
          setTemplateModalVisible(false);
          setSelectedTemplateId('');
        }}
        onOk={handleBindTemplate}
        confirmLoading={bindingLoading}
      >
        {tableConfig?.associatedTemplateId && (
          <div style={{ marginBottom: 16 }}>
            <Text>当前模板:</Text>{' '}
            <Tag color="green">{tableConfig.associatedTemplateName}</Tag>
          </div>
        )}

        <p>请选择要绑定的表格模板：</p>
        <Select
          style={{ width: '100%' }}
          placeholder="选择模板"
          value={selectedTemplateId}
          onChange={setSelectedTemplateId}
        >
          {templates.length === 0 ? (
            <Option value="" disabled>
              暂无可用模板
            </Option>
          ) : (
            templates.map(template => (
              <Option key={template.id} value={template.id}>
                {template.id === DEFAULT_TEMPLATE_ID && '⭐ '}
                {template.name}
                {template.id === DEFAULT_TEMPLATE_ID && ' 默认模板'}
                {template.sheets && template.sheets.length > 0 && ` (${template.sheets.length} 个页签)`}
              </Option>
            ))
          )}
        </Select>
        {selectedTemplateId && (
          <p style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
            {templates.find(t => t.id === selectedTemplateId)?.description || '暂无描述'}
          </p>
        )}
        <p style={{ marginTop: 16, color: '#888', fontSize: 12 }}>
          绑定模板将创建对应的表格结构，已有的表格数据将被覆盖。
        </p>
      </Modal>
    </div>
  );
};


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
  editorContentRef,
  tableProjectId,
  tableChapterId,
  tableChapterTitle,
  onTableOrganizeComplete,
  onTableOrganizeStatusChange
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

  // Resize handle state
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = width;
  }, [width]);

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, resizeStartWidthRef.current + delta));
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

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
                uploadWritingStyle(file.path || (file as any).path, file.name, file.size).then(result => {
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
        <TableOrganizePanelContent
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
