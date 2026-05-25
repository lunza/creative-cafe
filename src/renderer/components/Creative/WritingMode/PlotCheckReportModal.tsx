import React, { useState } from 'react';
import { Modal, Card, Progress, Tag, Collapse, Space, Typography, Divider, List, Button, message, Checkbox } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  ToolOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  BookOutlined,
  EditOutlined
} from '@ant-design/icons';
import {
  PlotCheckReport,
  PlotCheckDimension,
  PlotCheckIssue,
  IssueSeverity,
  LogicContradictionType,
  LogicCheckIssue,
  LOGIC_CONTRADICTION_TYPE_LABELS,
  PLOT_CHECK_DIMENSION_LABELS,
  ISSUE_SEVERITY_LABELS,
  BatchFixIssueInfo
} from '../../../../shared/types/writing.types';

const { Title, Text, Paragraph } = Typography;

interface PlotCheckReportModalProps {
  visible: boolean;
  report: PlotCheckReport | null;
  onCancel: () => void;
  onIssueClick?: (dimension: PlotCheckDimension, issueIndex: number) => void;
  onAutoFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic') => Promise<{ success: boolean; fixedContent?: string; error?: string }>;
  onQuickFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue) => void;
  onBatchFix?: (selectedIssues: Array<{ key: string; issue: PlotCheckIssue | LogicCheckIssue; issueType: 'dimension' | 'logic' }>) => Promise<{ success: boolean; fixedContent?: string; results?: Array<{ index: number; success: boolean; error?: string }>; error?: string }>;
  chapterContent?: string;
  onContentUpdated?: (fixedContent: string) => void;
  onRecheck?: () => void;
}

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  [IssueSeverity.HIGH]: 'red',
  [IssueSeverity.MEDIUM]: 'orange',
  [IssueSeverity.LOW]: 'blue'
};

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

interface IssueEntry {
  key: string;
  issue: PlotCheckIssue | LogicCheckIssue;
  issueType: 'dimension' | 'logic';
  dimension?: PlotCheckDimension;
}

const PlotCheckReportModal: React.FC<PlotCheckReportModalProps> = ({
  visible,
  report,
  onCancel,
  onIssueClick,
  onAutoFix,
  onQuickFix,
  onBatchFix,
  chapterContent,
  onContentUpdated,
  onRecheck
}) => {
  const [fixingIssueKey, setFixingIssueKey] = useState<string | null>(null);
  const [fixedIssueKeys, setFixedIssueKeys] = useState<Set<string>>(new Set());
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<Set<string>>(new Set());
  const [batchFixing, setBatchFixing] = useState(false);
  const [batchFixResults, setBatchFixResults] = useState<Array<{ index: number; success: boolean; error?: string }> | null>(null);

  if (!report) return null;

  const status = getOverallStatus(report.overallScore);

  const isIssueFixed = (key: string) => fixedIssueKeys.has(key);
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
    if (!onBatchFix || !chapterContent || selectedIssueKeys.size === 0) return;

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
    }
  };

  const handleAutoFix = async (issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic', issueKey: string) => {
    if (!onAutoFix || !chapterContent) {
      message.warning('自动修正功能暂不可用');
      return;
    }

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
    }
  };

  const handleQuickFix = (issue: PlotCheckIssue | LogicCheckIssue, issueKey: string) => {
    if (!onQuickFix || !chapterContent) {
      message.warning('快速修正功能暂不可用');
      return;
    }

    if (!issue.quickFixSuggestion) {
      message.warning('该问题暂无快速修正建议');
      return;
    }

    onQuickFix(chapterContent, issue);
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
    <Modal
      title="剧情检查报告"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={800}
      destroyOnHidden
    >
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <span style={{ color: status.color }}>{status.icon} {status.text}</span>
        </Title>
        <div style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 48, fontWeight: 'bold', color: status.color }}>{report.overallScore}</Text>
          <Text type="secondary" style={{ fontSize: 14, marginLeft: 4 }}>分</Text>
        </div>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Tag icon={<CloseCircleOutlined />} color="red">高危问题 {report.highSeverityCount}</Tag>
          <Tag icon={<ExclamationCircleOutlined />} color="orange">中等问题 {report.mediumSeverityCount}</Tag>
          <Tag icon={<InfoCircleOutlined />} color="blue">建议改进 {report.lowSeverityCount}</Tag>
          <Tag color="default">共 {report.totalIssues} 个问题</Tag>
        </div>

        {hasSelectableIssues && onBatchFix && chapterContent && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#1a1a2e', borderRadius: 6 }}>
            <Space>
              <Checkbox
                checked={isAllSelected}
                indeterminate={isPartiallySelected}
                onChange={(e) => handleSelectAll(e.target.checked)}
              >
                <Text style={{ fontSize: 12 }}>全选</Text>
              </Checkbox>
              <Text type="secondary" style={{ fontSize: 12 }}>
                已选 {selectedIssueKeys.size}/{selectableIssues.length} 个问题
              </Text>
            </Space>
            <Button
              type="primary"
              size="small"
              icon={batchFixing ? <LoadingOutlined /> : <ThunderboltOutlined />}
              onClick={handleBatchFix}
              loading={batchFixing}
              disabled={!hasSelectedIssues || batchFixing}
            >
              {batchFixing ? '批量修正中...' : `一键修复选中问题(${selectedIssueKeys.size})`}
            </Button>
          </div>
        )}

        {batchFixResults && (
          <Card size="small" style={{ background: '#1a1a2e', borderColor: '#333' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Text strong style={{ fontSize: 12 }}>批量修正结果</Text>
              {batchFixResults.map((r, i) => {
                const entry = allIssues[r.index];
                const title = entry ? (entry.issue as PlotCheckIssue).title || (entry.issue as LogicCheckIssue).description : `问题 ${r.index + 1}`;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    {r.success ? (
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    ) : (
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                    )}
                    <Text style={{ color: r.success ? '#52c41a' : '#ff4d4f', flex: 1 }}>{title}</Text>
                    {!r.success && r.error && <Text type="secondary" style={{ fontSize: 11 }}>{r.error}</Text>}
                  </div>
                );
              })}
            </Space>
          </Card>
        )}

        <Divider style={{ margin: '8px 0' }} />

        {report.dimensions.map((dim) => {
          const scoreColor = getScoreColor(dim.score);
          return (
            <Card
              key={dim.dimension}
              size="small"
              style={{
                borderColor: dim.passed ? '#d9d9d9' : scoreColor,
                borderWidth: dim.passed ? 1 : 1.5
              }}
            >
              <Space align="center" style={{ width: '100%' }} size="middle">
                <span style={{ fontSize: 18 }}>{DIMENSION_ICONS[dim.dimension]}</span>
                <div style={{ flex: 1 }}>
                  <Text strong>{PLOT_CHECK_DIMENSION_LABELS[dim.dimension]}</Text>
                  <div style={{ marginTop: 4 }}>
                    <Progress
                      percent={dim.score}
                      size="small"
                      strokeColor={scoreColor}
                      format={(percent) => `${percent}分`}
                    />
                  </div>
                </div>
                <Tag color={dim.passed ? 'success' : 'warning'}>
                  {dim.passed ? '通过' : '需关注'}
                </Tag>
              </Space>

              {dim.issues.length > 0 && (
                <Collapse
                  style={{ marginTop: 12 }}
                  items={dim.issues.map((issue, idx) => {
                    const issueKey = `dimension-${dim.dimension}-${idx}`;
                    const fixed = isIssueFixed(issueKey);
                    const fixing = isIssueFixing(issueKey);
                    const selected = isIssueSelected(issueKey);

                    return {
                      key: idx,
                      label: (
                        <Space style={{ width: '100%' }}>
                          {onBatchFix && !fixed && (
                            <Checkbox
                              checked={selected}
                              onChange={(e) => handleSelectIssue(issueKey, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <Tag color={SEVERITY_COLORS[issue.severity]} size="small">
                            {ISSUE_SEVERITY_LABELS[issue.severity]}
                          </Tag>
                          <Text strong style={{ textDecoration: fixed ? 'line-through' : undefined, flex: 1 }}>{issue.title}</Text>
                          {fixed && <Tag color="success" size="small">已修正</Tag>}
                        </Space>
                      ),
                      children: (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Paragraph style={{ marginBottom: 4 }}>{issue.description}</Paragraph>
                          <Paragraph style={{ marginBottom: 4, color: '#52c41a' }}>
                            <Text strong>💡 建议：</Text>{issue.suggestion}
                          </Paragraph>
                          {renderOriginalText((issue as PlotCheckIssue).originalText)}
                          {renderReferences((issue as PlotCheckIssue).references)}
                          {issue.position && onIssueClick && (
                            <a
                              onClick={() => onIssueClick(dim.dimension, idx)}
                              style={{ fontSize: 12 }}
                            >
                               定位到问题位置
                            </a>
                          )}
                          {onQuickFix && chapterContent && !fixed && issue.quickFixSuggestion && (
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickFix(issue, issueKey);
                              }}
                              style={{ marginTop: 8, marginRight: 8 }}
                            >
                              快速修正
                            </Button>
                          )}
                          {onAutoFix && chapterContent && !fixed && (
                            <Button
                              type="primary"
                              size="small"
                              icon={fixing ? <LoadingOutlined /> : <ToolOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAutoFix(issue, 'dimension', issueKey);
                              }}
                              loading={fixing}
                              disabled={fixing}
                              style={{ marginTop: 8 }}
                            >
                              {fixing ? '修正中...' : '自动修正'}
                            </Button>
                          )}
                          {fixed && (
                            <Text type="success" style={{ fontSize: 12, marginTop: 8 }}>
                              <CheckCircleOutlined /> 该问题已自动修正
                            </Text>
                          )}
                        </Space>
                      )
                    };
                  })}
                />
              )}
            </Card>
          );
        })}

        {report.logicCheckResult && report.logicCheckResult.totalIssues > 0 && (
          <>
            <Divider>
              <Title level={5} style={{ margin: 0 }}>逻辑异常检测</Title>
            </Divider>
            <Card size="small" style={{ borderColor: report.logicCheckResult.highSeverityCount > 0 ? '#ff4d4f' : '#faad14', borderWidth: 1.5 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Tag icon={<CloseCircleOutlined />} color="red">高危 {report.logicCheckResult.highSeverityCount}</Tag>
                  <Tag icon={<ExclamationCircleOutlined />} color="orange">中等 {report.logicCheckResult.mediumSeverityCount}</Tag>
                  <Tag icon={<InfoCircleOutlined />} color="blue">建议 {report.logicCheckResult.lowSeverityCount}</Tag>
                </div>
                <List
                  size="small"
                  dataSource={report.logicCheckResult.issues}
                  renderItem={(issue, idx) => {
                    const issueKey = `logic-${idx}`;
                    const fixed = isIssueFixed(issueKey);
                    const fixing = isIssueFixing(issueKey);
                    const selected = isIssueSelected(issueKey);

                    return (
                      <List.Item style={{ alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                          {onBatchFix && !fixed && (
                            <Checkbox
                              checked={selected}
                              onChange={(e) => handleSelectIssue(issueKey, e.target.checked)}
                              style={{ marginTop: 4 }}
                            />
                          )}
                          <List.Item.Meta
                            avatar={<Tag color={LOGIC_TYPE_COLORS[issue.type]}>{LOGIC_CONTRADICTION_TYPE_LABELS[issue.type]}</Tag>}
                            title={
                              <Space>
                                <Text strong style={{ textDecoration: fixed ? 'line-through' : undefined }}>{issue.description}</Text>
                                <Tag color={SEVERITY_COLORS[issue.severity]} size="small">
                                  {ISSUE_SEVERITY_LABELS[issue.severity]}
                                </Tag>
                                {fixed && <Tag color="success" size="small">已修正</Tag>}
                              </Space>
                            }
                            description={
                              <Space direction="vertical" size="small">
                                <Text type="secondary">{issue.analysis}</Text>
                                {issue.suggestion && <Text style={{ color: '#52c41a' }}>💡 {issue.suggestion}</Text>}
                                {renderOriginalText((issue as LogicCheckIssue).originalText)}
                                {renderReferences((issue as LogicCheckIssue).references)}
                                {onQuickFix && chapterContent && !fixed && issue.quickFixSuggestion && (
                                  <Button
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => handleQuickFix(issue, issueKey)}
                                    style={{ marginTop: 4, marginRight: 8 }}
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
                                    disabled={fixing}
                                    style={{ marginTop: 4 }}
                                  >
                                    {fixing ? '修正中...' : '自动修正'}
                                  </Button>
                                )}
                                {fixed && (
                                  <Text type="success" style={{ fontSize: 12, marginTop: 4 }}>
                                    <CheckCircleOutlined /> 该问题已自动修正
                                  </Text>
                                )}
                              </Space>
                            }
                          />
                        </div>
                      </List.Item>
                    );
                  }}
                />
              </Space>
            </Card>
          </>
        )}
      </Space>
    </Modal>
  );
};

export default PlotCheckReportModal;
