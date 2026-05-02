import React, { useState, useCallback } from 'react';
import {
  Card, Button, Space, Tag, Progress, Table, Typography, Divider,
  Row, Col, Alert, Tooltip
} from 'antd';
import {
  PlayCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { runEmbeddingTests, runStorageTests, runAllTests, runDocumentTests, runAllWithDocumentTests } from '../../services/vectorTestService';
import type { TestLog, TestReport } from '../../types/vectorTest';
import { formatDuration, formatReportJson, formatReportCsv } from '../../utils/vectorTestUtils';

const { Title, Text, Paragraph } = Typography;

interface TestState {
  status: 'idle' | 'running' | 'completed';
  progress: number;
  currentTest: string;
  logs: TestLog[];
  reports: TestReport[];
}

const getLevelColor = (level: TestLog['level']) => {
  switch (level) {
    case 'info': return 'blue';
    case 'warn': return 'orange';
    case 'error': return 'red';
    case 'success': return 'green';
    default: return 'default';
  }
};

const getStatusTag = (status: string) => {
  switch (status) {
    case 'pass':
      return <Tag color="success" icon={<CheckCircleOutlined />}>通过</Tag>;
    case 'fail':
      return <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>;
    case 'skip':
      return <Tag color="default">跳过</Tag>;
    default:
      return <Tag color="default">{status}</Tag>;
  }
};

const createColumns = (): ColumnsType<any> => [
  {
    title: '#',
    dataIndex: 'index',
    key: 'index',
    width: 50,
    render: (_: any, __: any, idx: number) => idx + 1,
  },
  {
    title: '测试名称',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 100,
    render: (status: string) => getStatusTag(status),
  },
  {
    title: '耗时',
    dataIndex: 'duration',
    key: 'duration',
    width: 80,
    render: (ms: number) => <Text type="secondary">{formatDuration(ms)}</Text>,
  },
  {
    title: '详情',
    dataIndex: 'detail',
    key: 'detail',
    ellipsis: true,
    render: (detail: string) => <Text ellipsis tooltip={detail} style={{ maxWidth: 300 }}>{detail}</Text>,
  },
];

const VectorTestPage: React.FC = () => {
  const [state, setState] = useState<TestState>({
    status: 'idle',
    progress: 0,
    currentTest: '',
    logs: [],
    reports: [],
  });

  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());

  const addLog = useCallback((log: TestLog) => {
    setState(prev => ({ ...prev, logs: [...prev.logs, log] }));
  }, []);

  const handleRunEmbedding = async () => {
    setState(prev => ({
      ...prev,
      status: 'running',
      progress: 0,
      currentTest: '正在准备向量化测试...',
      logs: [],
      reports: [],
    }));

    try {
      const report = await runEmbeddingTests(addLog);
      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
        currentTest: '向量化测试完成',
        reports: [report],
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ timestamp: Date.now(), level: 'error', message: `测试异常: ${msg}` });
      setState(prev => ({ ...prev, status: 'idle', progress: 0, currentTest: '测试失败' }));
    }
  };

  const handleRunStorage = async () => {
    setState(prev => ({
      ...prev,
      status: 'running',
      progress: 0,
      currentTest: '正在准备存储测试...',
      logs: [],
      reports: [],
    }));

    try {
      const report = await runStorageTests(addLog);
      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
        currentTest: '存储测试完成',
        reports: [report],
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ timestamp: Date.now(), level: 'error', message: `测试异常: ${msg}` });
      setState(prev => ({ ...prev, status: 'idle', progress: 0, currentTest: '测试失败' }));
    }
  };

  const handleRunAll = async () => {
    setState(prev => ({
      ...prev,
      status: 'running',
      progress: 0,
      currentTest: '正在准备全部测试...',
      logs: [],
      reports: [],
    }));

    try {
      const reports = await runAllTests(addLog);
      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
        currentTest: '全部测试完成',
        reports,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ timestamp: Date.now(), level: 'error', message: `测试异常: ${msg}` });
      setState(prev => ({ ...prev, status: 'idle', progress: 0, currentTest: '测试失败' }));
    }
  };

  const handleRunDocument = async () => {
    setState(prev => ({
      ...prev,
      status: 'running',
      progress: 0,
      currentTest: '正在准备文档向量化测试...',
      logs: [],
      reports: [],
    }));

    try {
      const report = await runDocumentTests(addLog);
      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
        currentTest: '文档向量化测试完成',
        reports: [report],
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ timestamp: Date.now(), level: 'error', message: `测试异常: ${msg}` });
      setState(prev => ({ ...prev, status: 'idle', progress: 0, currentTest: '测试失败' }));
    }
  };

  const handleRunWithDocument = async () => {
    setState(prev => ({
      ...prev,
      status: 'running',
      progress: 0,
      currentTest: '正在准备包含文档的全部测试...',
      logs: [],
      reports: [],
    }));

    try {
      const reports = await runAllWithDocumentTests(addLog);
      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
        currentTest: '包含文档的全部测试完成',
        reports,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ timestamp: Date.now(), level: 'error', message: `测试异常: ${msg}` });
      setState(prev => ({ ...prev, status: 'idle', progress: 0, currentTest: '测试失败' }));
    }
  };

  const handleExportJson = (report: TestReport) => {
    const blob = new Blob([formatReportJson(report)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector-test-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = (report: TestReport) => {
    const blob = new Blob([formatReportCsv(report)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector-test-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPassed = state.reports.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = state.reports.reduce((sum, r) => sum + r.failed, 0);
  const totalTests = state.reports.reduce((sum, r) => sum + r.total, 0);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2}>向量化与存储能力测试</Title>
        <Text type="secondary">测试向量模型嵌入能力和向量存储系统的各项功能</Text>
      </div>

      {/* 控制区 */}
      <Card title="测试控制" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleRunEmbedding}
            loading={state.status === 'running'}
            disabled={state.status === 'running'}
          >
            向量化测试
          </Button>
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            onClick={handleRunStorage}
            loading={state.status === 'running'}
            disabled={state.status === 'running'}
          >
            存储测试
          </Button>
          <Button
            type="primary"
            icon={<FileTextOutlined />}
            onClick={handleRunDocument}
            loading={state.status === 'running'}
            disabled={state.status === 'running'}
          >
            文档向量化测试
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRunAll}
            loading={state.status === 'running'}
            disabled={state.status === 'running'}
          >
            全部测试
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRunWithDocument}
            loading={state.status === 'running'}
            disabled={state.status === 'running'}
          >
            包含文档的全部测试
          </Button>
          {state.status === 'completed' && (
            <Button
              icon={<ReloadOutlined />}
              onClick={() => setState({ status: 'idle', progress: 0, currentTest: '', logs: [], reports: [] })}
            >
              重置
            </Button>
          )}
        </Space>
        <Divider />
        <Space>
          <Text>状态:</Text>
          <Tag color={state.status === 'running' ? 'processing' : state.status === 'completed' ? 'success' : 'default'} icon={state.status === 'running' ? <SyncOutlined spin /> : undefined}>
            {state.status === 'idle' ? '等待开始' : state.status === 'running' ? state.currentTest : '测试完成'}
          </Tag>
        </Space>
        {state.status === 'running' && (
          <Progress percent={state.progress} status="active" style={{ marginTop: 8 }} />
        )}
      </Card>

      {/* 摘要统计 */}
      {state.status === 'completed' && state.reports.length > 0 && (
        <Card title="测试摘要" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <StatisticCard label="总测试数" value={totalTests} />
            </Col>
            <Col span={6}>
              <StatisticCard label="通过" value={totalPassed} valueStyle={{ color: '#52c41a' }} />
            </Col>
            <Col span={6}>
              <StatisticCard label="失败" value={totalFailed} valueStyle={{ color: '#ff4d4f' }} />
            </Col>
            <Col span={6}>
              <StatisticCard label="总耗时" value={formatDuration(state.reports.reduce((s, r) => s + r.totalDuration, 0))} />
            </Col>
          </Row>
        </Card>
      )}

      {/* 详细结果 */}
      {state.reports.map((report, idx) => {
        const reportKey = `report-${idx}`;
        const reportLabel = idx === 0 && state.reports.length > 1 ? '向量化测试' : idx === 1 ? '存储测试' : '测试结果';
        const isExpanded = expandedReports.has(reportKey);
        return (
          <Card
            key={reportKey}
            title={
              <Space>
                <Text>{reportLabel}</Text>
                <Tag color={report.failed === 0 ? 'success' : 'error'}>
                  {report.passed}/{report.total} 通过
                </Tag>
              </Space>
            }
            style={{ marginBottom: 16 }}
            extra={
              <Space>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportJson(report)}>
                  导出 JSON
                </Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExportCsv(report)}>
                  导出 CSV
                </Button>
              </Space>
            }
          >
            <Table
              columns={createColumns()}
              dataSource={report.results}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ y: 400 }}
            />
          </Card>
        );
      })}

      {/* 日志面板 */}
      {state.logs.length > 0 && (
        <Card title="执行日志" style={{ marginTop: 16 }}>
          <div style={{
            maxHeight: 400,
            overflowY: 'auto',
            background: '#1e1e1e',
            borderRadius: 4,
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 12,
          }}>
            {state.logs.map((log, i) => (
              <div key={i} style={{ marginBottom: 4, lineHeight: '1.6' }}>
                <Tag color={getLevelColor(log.level)} style={{ marginRight: 8, fontSize: 10 }}>
                  {log.level.toUpperCase()}
                </Tag>
                <Text style={{ color: '#d4d4d4' }}>{log.message}</Text>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

const StatisticCard: React.FC<{ label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }> = ({ label, value, valueStyle }) => (
  <div style={{ textAlign: 'center', padding: 8 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    <div style={{ fontSize: 28, fontWeight: 'bold', marginTop: 4, ...valueStyle }}>{value}</div>
  </div>
);

export default VectorTestPage;
