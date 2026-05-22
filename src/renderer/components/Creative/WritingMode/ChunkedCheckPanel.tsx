import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Modal, Button, Radio, Progress, Space, Tag, Collapse, Typography, List, Select, message, Spin, Divider } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import {
  PlotCheckReport,
  PlotCheckDimension,
  IssueSeverity,
  PLOT_CHECK_DIMENSION_LABELS,
  ISSUE_SEVERITY_LABELS
} from '../../../../shared/types/writing.types';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

interface CheckChunk {
  index: number;
  title: string;
  content: string;
  chapterIndex: number;
  status: 'pending' | 'checking' | 'completed' | 'error';
  report: PlotCheckReport | null;
}

interface ChunkedCheckProgress {
  totalChunks: number;
  completedChunks: number;
  currentChunkIndex: number;
  chunks: CheckChunk[];
  isRunning: boolean;
  isPaused: boolean;
  overallScore: number | null;
}

interface SummaryReport {
  overallScore: number | null;
  totalIssues: number;
  highSeverityCount: number;
  chunkResults: { index: number; title: string; score: number | null; issues: number }[];
}

interface ChunkedCheckPanelProps {
  visible: boolean;
  projectId: string;
  outline: any;
  chapterContents: Record<string, string>;
  resources: any;
  novelType?: string;
  writingStyle?: string;
  modelConfig?: any;
  onCancel: () => void;
}

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue'
};

const ChunkedCheckPanel: React.FC<ChunkedCheckPanelProps> = ({
  visible,
  projectId,
  outline,
  chapterContents,
  resources,
  novelType,
  writingStyle,
  modelConfig,
  onCancel
}) => {
  const [splitMode, setSplitMode] = useState<'chapter' | 'wordcount'>('chapter');
  const [wordsPerChunk, setWordsPerChunk] = useState(3000);
  const [progress, setProgress] = useState<ChunkedCheckProgress | null>(null);
  const [summary, setSummary] = useState<SummaryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setProgress(null);
      setSummary(null);
      setChecking(false);
      clearTimer();
    }
    return clearTimer;
  }, [visible, clearTimer]);

  const startPollingProgress = useCallback(() => {
    clearTimer();
    progressTimerRef.current = setInterval(async () => {
      try {
        const result = await window.electronAPI.writing.getChunkedCheckProgress();
        if (result.success && result.progress) {
          setProgress(result.progress);
          if (!result.progress.isRunning && !result.progress.isPaused) {
            // Check completed or stopped
            clearTimer();
            setChecking(false);
            // Fetch summary
            const summaryResult = await window.electronAPI.writing.getChunkedCheckSummary();
            if (summaryResult.success) {
              setSummary(summaryResult.summary);
            }
          }
        }
      } catch (error) {
        // ignore
      }
    }, 1000);
  }, [clearTimer]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.writing.startChunkedCheck({
        projectId,
        outline,
        chapterContents,
        resources,
        novelType,
        writingStyle,
        modelConfig
      });

      if (result.success) {
        setProgress(result.progress);
        setChecking(true);
        startPollingProgress();
      } else {
        message.error(result.error || '分片检查启动失败');
      }
    } catch (error) {
      message.error('分片检查启动失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      await window.electronAPI.writing.pauseChunkedCheck();
    } catch (error) {
      message.error('暂停失败');
    }
  };

  const handleResume = async () => {
    try {
      await window.electronAPI.writing.resumeChunkedCheck();
    } catch (error) {
      message.error('继续失败');
    }
  };

  const handleStop = async () => {
    clearTimer();
    try {
      await window.electronAPI.writing.stopChunkedCheck();
      setChecking(false);
      setProgress(prev => prev ? { ...prev, isRunning: false, isPaused: false } : null);
    } catch (error) {
      message.error('停止失败');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'checking': return <SyncOutlined spin style={{ color: '#1890ff' }} />;
      case 'error': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default: return null;
    }
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'completed': return <Tag color="success">已完成</Tag>;
      case 'checking': return <Tag color="processing">检查中</Tag>;
      case 'error': return <Tag color="error">失败</Tag>;
      default: return <Tag>待检查</Tag>;
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 90) return '#52c41a';
    if (score >= 70) return '#faad14';
    return '#ff4d4f';
  };

  return (
    <Modal
      title="分片检查"
      open={visible}
      onCancel={onCancel}
      width={900}
      footer={null}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {/* 分片模式选择 */}
        {!checking && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>分片模式：</Text>
            <Radio.Group
              value={splitMode}
              onChange={(e) => setSplitMode(e.target.value)}
              size="small"
              style={{ marginLeft: 8 }}
            >
              <Radio value="chapter">按章节分片</Radio>
              <Radio value="wordcount">按字数分片</Radio>
            </Radio.Group>
            {splitMode === 'wordcount' && (
              <div style={{ marginTop: 8 }}>
                <Text>每片字数：</Text>
                <Select
                  value={wordsPerChunk}
                  onChange={setWordsPerChunk}
                  size="small"
                  style={{ width: 120, marginLeft: 8 }}
                  options={[
                    { label: '2000字', value: 2000 },
                    { label: '3000字', value: 3000 },
                    { label: '5000字', value: 5000 },
                    { label: '8000字', value: 8000 }
                  ]}
                />
              </div>
            )}
          </div>
        )}

        {/* 控制按钮 */}
        <div style={{ marginBottom: 16 }}>
          <Space>
            {!checking && (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                disabled={loading}
              >
                开始检查
              </Button>
            )}
            {checking && (
              <>
                {progress?.isPaused ? (
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleResume}>
                    继续
                  </Button>
                ) : (
                  <Button icon={<PauseCircleOutlined />} onClick={handlePause}>
                    暂停
                  </Button>
                )}
                <Button danger icon={<StopOutlined />} onClick={handleStop}>
                  停止
                </Button>
              </>
            )}
            {summary && !checking && (
              <Button icon={<ReloadOutlined />} onClick={handleStart}>
                重新检查
              </Button>
            )}
          </Space>
        </div>

        {/* 进度条 */}
        {progress && (
          <div style={{ marginBottom: 16 }}>
            <Progress
              percent={Math.round((progress.completedChunks / progress.totalChunks) * 100)}
              status={progress.isRunning ? 'active' : progress.isPaused ? 'exception' : 'success'}
              format={() => `${progress.completedChunks}/${progress.totalChunks}`}
            />
            {progress.overallScore !== null && (
              <Text strong style={{ color: getScoreColor(progress.overallScore) }}>
                综合评分: {progress.overallScore} 分
              </Text>
            )}
          </div>
        )}

        {/* 汇总报告 */}
        {summary && !checking && (
          <div style={{ marginBottom: 16 }}>
            <Title level={5}>汇总报告</Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Tag icon={<ExclamationCircleOutlined />} color="red">高危问题 {summary.highSeverityCount}</Tag>
                <Tag>共 {summary.totalIssues} 个问题</Tag>
              </div>
              <List
                size="small"
                dataSource={summary.chunkResults}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          {getStatusIcon(progress?.chunks[item.index]?.status || 'pending')}
                          <Text strong>{item.title}</Text>
                          {item.score !== null && (
                            <Tag color={getScoreColor(item.score)}>{item.score}分</Tag>
                          )}
                          {item.issues > 0 && (
                            <Tag color="warning">{item.issues}个问题</Tag>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Space>
          </div>
        )}

        {/* 分片列表 */}
        {progress && (
          <div>
            <Divider>分片详情</Divider>
            <Collapse
              accordion
              items={progress.chunks.map(chunk => ({
                key: chunk.index,
                label: (
                  <Space>
                    {getStatusIcon(chunk.status)}
                    <Text>{chunk.title}</Text>
                    {getStatusTag(chunk.status)}
                    {chunk.report && (
                      <Tag color={getScoreColor(chunk.report.overallScore)}>
                        {chunk.report.overallScore}分
                      </Tag>
                    )}
                  </Space>
                ),
                children: chunk.report ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Tag color="red">高危 {chunk.report.highSeverityCount}</Tag>
                      <Tag color="orange">中等 {chunk.report.mediumSeverityCount}</Tag>
                      <Tag color="blue">建议 {chunk.report.lowSeverityCount}</Tag>
                    </div>
                    {chunk.report.logicCheckResult?.issues.map((issue, idx) => (
                      <div key={idx} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <Space>
                          <Tag color={SEVERITY_COLORS[issue.severity]} size="small">
                            {ISSUE_SEVERITY_LABELS[issue.severity]}
                          </Tag>
                          <Text strong>{issue.description}</Text>
                        </Space>
                        <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
                          {issue.analysis}
                        </Paragraph>
                        {issue.suggestion && (
                          <Text style={{ color: '#52c41a', fontSize: 12 }}>
                            💡 {issue.suggestion}
                          </Text>
                        )}
                      </div>
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">暂无检查结果</Text>
                )
              }))}
            />
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default ChunkedCheckPanel;
