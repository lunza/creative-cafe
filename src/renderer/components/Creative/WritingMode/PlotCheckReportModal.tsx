import React, { useState } from 'react';
import { Modal, Card, Progress, Tag, Collapse, Space, Typography, Divider, List, Button, message } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  ToolOutlined,
  LoadingOutlined
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
  ISSUE_SEVERITY_LABELS
} from '../../../../shared/types/writing.types';

const { Title, Text, Paragraph } = Typography;

interface PlotCheckReportModalProps {
  visible: boolean;
  report: PlotCheckReport | null;
  onCancel: () => void;
  onIssueClick?: (dimension: PlotCheckDimension, issueIndex: number) => void;
  onAutoFix?: (chapterContent: string, issue: PlotCheckIssue | LogicCheckIssue, issueType: 'dimension' | 'logic') => Promise<{ success: boolean; fixedContent?: string; error?: string }>;
  chapterContent?: string;
  onContentUpdated?: (fixedContent: string) => void;
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

const PlotCheckReportModal: React.FC<PlotCheckReportModalProps> = ({
  visible,
  report,
  onCancel,
  onIssueClick,
  onAutoFix,
  chapterContent,
  onContentUpdated
}) => {
  const [fixingIssueKey, setFixingIssueKey] = useState<string | null>(null);
  const [fixedIssueKeys, setFixedIssueKeys] = useState<Set<string>>(new Set());

  if (!report) return null;

  const status = getOverallStatus(report.overallScore);

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

  const isIssueFixed = (key: string) => fixedIssueKeys.has(key);
  const isIssueFixing = (key: string) => fixingIssueKey === key;

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

                    return {
                      key: idx,
                      label: (
                        <Space>
                          <Tag color={SEVERITY_COLORS[issue.severity]} size="small">
                            {ISSUE_SEVERITY_LABELS[issue.severity]}
                          </Tag>
                          <Text strong style={{ textDecoration: fixed ? 'line-through' : undefined }}>{issue.title}</Text>
                          {fixed && <Tag color="success" size="small">已修正</Tag>}
                        </Space>
                      ),
                      children: (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Paragraph style={{ marginBottom: 4 }}>{issue.description}</Paragraph>
                          <Paragraph style={{ marginBottom: 4, color: '#52c41a' }}>
                            <Text strong>💡 建议：</Text>{issue.suggestion}
                          </Paragraph>
                          {issue.position && onIssueClick && (
                            <a
                              onClick={() => onIssueClick(dim.dimension, idx)}
                              style={{ fontSize: 12 }}
                            >
                               定位到问题位置
                            </a>
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

                    return (
                      <List.Item>
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
