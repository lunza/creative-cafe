import React, { useState, useCallback, useMemo } from 'react';
import { Input, Button, Empty, Tag, Typography, Spin, Modal, Progress, message } from 'antd';
import {
  BookOutlined,
  SafetyOutlined,
  FileTextOutlined,
  ToolOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  EditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import type {
  PlotCheckReport,
  PlotCheckIssue,
  LogicCheckIssue,
} from '../../../../shared/types/writing.types';
import {
  PlotCheckDimension,
  IssueSeverity,
  LogicContradictionType,
  LOGIC_CONTRADICTION_TYPE_LABELS,
  PLOT_CHECK_DIMENSION_LABELS,
  ISSUE_SEVERITY_LABELS,
} from '../../../../shared/types/writing.types';

const { Text } = Typography;

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  [IssueSeverity.HIGH]: 'red',
  [IssueSeverity.MEDIUM]: 'orange',
  [IssueSeverity.LOW]: 'blue',
};

const LOGIC_TYPE_COLORS: Record<LogicContradictionType, string> = {
  [LogicContradictionType.ITEM_STATE]: 'purple',
  [LogicContradictionType.ECONOMIC]: 'gold',
  [LogicContradictionType.CHARACTER_STATE]: 'red',
  [LogicContradictionType.PHYSICAL_LAW]: 'cyan',
  [LogicContradictionType.PLOT_SETTING]: 'orange',
  [LogicContradictionType.MATHEMATICAL]: 'blue',
};

const DIMENSION_ICONS: Record<PlotCheckDimension, React.ReactNode> = {
  [PlotCheckDimension.OUTLINE_CONSISTENCY]: <InfoCircleOutlined />,
  [PlotCheckDimension.WORLDBOOK_COMPLIANCE]: <ExclamationCircleOutlined />,
  [PlotCheckDimension.CHARACTER_CONSISTENCY]: <CloseCircleOutlined />,
  [PlotCheckDimension.WRITING_STYLE]: <InfoCircleOutlined />,
  [PlotCheckDimension.PLOT_CONTINUITY]: <ExclamationCircleOutlined />,
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

interface IssueEntry {
  key: string;
  issue: PlotCheckIssue | LogicCheckIssue;
  issueType: 'dimension' | 'logic';
  dimension?: PlotCheckDimension;
}

export interface PlotCheckPanelContentProps {
  report: PlotCheckReport | null;
  loading: boolean;
  chapterContent?: string;
  onAutoFix?: (
    chapterContent: string,
    issue: PlotCheckIssue | LogicCheckIssue,
    issueType: 'dimension' | 'logic'
  ) => Promise<{ success: boolean; fixedContent?: string; error?: string }>;
  onQuickFix?: (
    chapterContent: string,
    issue: PlotCheckIssue | LogicCheckIssue,
    issueType: 'dimension' | 'logic',
    onComplete?: () => void
  ) => void;
  onBatchFix?: (
    selectedIssues: Array<{ key: string; issue: PlotCheckIssue | LogicCheckIssue; issueType: 'dimension' | 'logic' }>
  ) => Promise<{ success: boolean; fixedContent?: string; results?: Array<{ index: number; success: boolean; error?: string }>; error?: string }>;
  onContentUpdated?: (fixedContent: string) => void;
  onRecheck?: () => void;
}

/**
 * 剧情检查面板内容组件
 *
 * 抽自原 WritingModeRightPanel.tsx 内联组件，负责展示剧情检查报告，
 * 支持单条自动修正 / 快速修正 / 批量一键修复。
 *
 * 行为保持与拆分前一致，仅做组织上的解耦：
 * - 通过 props 接收报告与回调
 * - 修正相关的 UI state（fixingIssueKey/globalFixing/fixedIssueKeys/selectedIssueKeys/batchFixing/batchFixResults）保持在本组件内部
 */
const PlotCheckPanelContent: React.FC<PlotCheckPanelContentProps> = ({
  report,
  loading,
  chapterContent,
  onAutoFix,
  onQuickFix,
  onBatchFix,
  onContentUpdated,
  onRecheck,
}) => {
  const { token } = theme.useToken();
  const [fixingIssueKey, setFixingIssueKey] = useState<string | null>(null);
  const [globalFixing, setGlobalFixing] = useState<boolean>(false);
  const [fixedIssueKeys, setFixedIssueKeys] = useState<Set<string>>(new Set());
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<Set<string>>(new Set());
  const [batchFixing, setBatchFixing] = useState(false);
  const [batchFixResults, setBatchFixResults] = useState<Array<{ index: number; success: boolean; error?: string }> | null>(null);

  // 派生的全部问题列表（依赖 report）
  const allIssues = useMemo<IssueEntry[]>(() => {
    const list: IssueEntry[] = [];
    if (!report) return list;
    report.dimensions.forEach((dim) => {
      dim.issues.forEach((issue, idx) => {
        const key = `dimension-${dim.dimension}-${idx}`;
        list.push({ key, issue, issueType: 'dimension', dimension: dim.dimension });
      });
    });
    if (report.logicCheckResult) {
      report.logicCheckResult.issues.forEach((issue, idx) => {
        const key = `logic-${idx}`;
        list.push({ key, issue, issueType: 'logic' });
      });
    }
    return list;
  }, [report]);

  const isIssueFixed = useCallback(
    (key: string) => {
      if (fixedIssueKeys.has(key)) {
        return true;
      }
      const issueEntry = allIssues.find((entry) => entry.key === key);
      if (issueEntry && issueEntry.issue.corrected) {
        return true;
      }
      return false;
    },
    [fixedIssueKeys, allIssues]
  );
  const isIssueFixing = useCallback((key: string) => fixingIssueKey === key, [fixingIssueKey]);
  const isIssueSelected = useCallback((key: string) => selectedIssueKeys.has(key), [selectedIssueKeys]);

  const selectableIssues = useMemo(() => allIssues.filter((e) => !isIssueFixed(e.key)), [allIssues, isIssueFixed]);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIssueKeys(new Set(selectableIssues.map((e) => e.key)));
      } else {
        setSelectedIssueKeys(new Set());
      }
    },
    [selectableIssues]
  );

  const handleSelectIssue = useCallback((key: string, checked: boolean) => {
    setSelectedIssueKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const isAllSelected = selectableIssues.length > 0 && selectableIssues.every((e) => selectedIssueKeys.has(e.key));
  const isPartiallySelected = selectableIssues.length > 0 && selectedIssueKeys.size > 0 && !isAllSelected;

  const handleBatchFix = useCallback(async () => {
    if (!onBatchFix || !chapterContent || selectedIssueKeys.size === 0 || globalFixing) return;

    setGlobalFixing(true);
    setBatchFixing(true);
    setBatchFixResults(null);
    try {
      const selectedEntries = allIssues.filter((e) => selectedIssueKeys.has(e.key));
      const selectedData = selectedEntries.map((e) => ({
        key: e.key,
        issue: e.issue,
        issueType: e.issueType,
      }));

      const result = await onBatchFix(selectedData);

      if (result.success && result.fixedContent) {
        const newFixedKeys = new Set(fixedIssueKeys);
        selectedEntries.forEach((e) => newFixedKeys.add(e.key));
        setFixedIssueKeys(newFixedKeys);
        onContentUpdated?.(result.fixedContent);

        if (result.results) {
          setBatchFixResults(result.results);
          const successCount = result.results.filter((r) => r.success).length;
          const failCount = result.results.filter((r) => !r.success).length;
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
  }, [onBatchFix, chapterContent, selectedIssueKeys, globalFixing, allIssues, fixedIssueKeys, onContentUpdated]);

  const handleAutoFix = useCallback(
    async (issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', issueKey: string) => {
      if (!onAutoFix || !chapterContent) {
        message.warning('自动修正功能暂不可用');
        return;
      }

      setGlobalFixing(true);
      setFixingIssueKey(issueKey);
      try {
        const result = await onAutoFix(chapterContent, issue, issueType);

        if (result.success && result.fixedContent) {
          setFixedIssueKeys((prev) => new Set([...prev, issueKey]));
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
    },
    [onAutoFix, chapterContent, onContentUpdated]
  );

  const handleQuickFix = useCallback(
    (issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', issueKey: string) => {
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
    },
    [onQuickFix, chapterContent]
  );

  const renderOriginalText = useCallback((originalText?: { snippet: string; start: number; end: number }[]) => {
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
              wordBreak: 'break-all',
            }}
          >
            {ot.snippet}
          </div>
        ))}
      </div>
    );
  }, []);

  const renderReferences = useCallback((references?: { type: string; name: string; summary: string }[]) => {
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
  }, []);

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
              background: token.colorFillQuaternary,
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
                        border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
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
            background: token.colorFillQuaternary,
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
                  border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
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

export default React.memo(PlotCheckPanelContent);
