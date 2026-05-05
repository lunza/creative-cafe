import React, { useState, useCallback, useEffect } from 'react';
import {
  Card, Button, Space, Tag, Progress, Table, Typography, Divider,
  Row, Col, Upload, message, Popconfirm, Modal, Descriptions, Empty, Tabs, Input, Select, Alert, Tooltip
} from 'antd';
import {
  UploadOutlined,
  FileTextOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  SearchOutlined,
  ExperimentOutlined,
  BarChartOutlined
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import type { ColumnsType } from 'antd/es/table';
import { processDocument, listDocuments, deleteDocument as deleteDoc, getDocumentChunks, searchDocumentVectors, getVectorStats, generateEmbedding } from '../../services/documentVectorService';
import type { DocumentInfo, DocumentProcessingResult, ProcessingProgress } from '../../types/documentVector';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const SUPPORTED_FORMATS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md'];

const getFileTypeIcon = (type: string) => {
  switch (type) {
    case 'pdf': return '📄';
    case 'docx': case 'doc': return '📝';
    case 'xlsx': case 'xls': return '📊';
    case 'txt': return '📃';
    case 'md': return '🔖';
    default: return '📎';
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleString('zh-CN');
};

const getScoreColor = (score: number) => {
  if (score >= 0.8) return '#52c41a';
  if (score >= 0.6) return '#faad14';
  if (score >= 0.4) return '#fa8c16';
  return '#ff4d4f';
};

const DocumentVectorPage: React.FC = () => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingFile, setProcessingFile] = useState<string>('');
  const [progress, setProgress] = useState<ProcessingProgress>({ step: '', progress: 0, message: '' });
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentInfo | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const [activeTab, setActiveTab] = useState('upload');

  const [stats, setStats] = useState<{ totalVectors: number; documentCount: number; documents: Array<{ docId: string; fileName: string; vectorCount: number }> }>({ totalVectors: 0, documentCount: 0, documents: [] });

  const [chunks, setChunks] = useState<Array<{ index: number; text: string }>>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchDocId, setSearchDocId] = useState<string>('');
  const [searchTopK, setSearchTopK] = useState(5);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; score: number; metadata: Record<string, any> }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string>('');

  const [testText, setTestText] = useState('');
  const [testVector, setTestVector] = useState<number[] | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string>('');
  const [testDimension, setTestDimension] = useState(0);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs.sort((a, b) => b.storedAt - a.storedAt));
      const vStats = await getVectorStats();
      setStats(vStats);
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleSelectAndProcess = async () => {
    const filePath = await window.electronAPI.document.selectFile();
    if (!filePath) return;

    const fileName = filePath.split(/[\\/]/).pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (!ext || !SUPPORTED_FORMATS.includes(`.${ext}`)) {
      message.error(`不支持的文件格式: .${ext}`);
      return;
    }

    setProcessing(true);
    setProcessingFile(fileName);
    setProgress({ step: 'upload', progress: 0, message: '正在处理文件...' });

    try {
      const result: DocumentProcessingResult = await processDocument(filePath);

      if (result.success) {
        message.success(`文档处理成功: ${result.metadata.fileName} (${result.chunkCount} 个分块)`);
        loadDocuments();
      } else {
        message.error(`文档处理失败: ${result.error}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(`处理异常: ${msg}`);
    } finally {
      setProcessing(false);
      setProcessingFile('');
      setProgress({ step: '', progress: 0, message: '' });
      setFileList([]);
    }
  };

  const handleUpload: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    const uploadFile = file as File;
    const ext = uploadFile.name.split('.').pop()?.toLowerCase();

    if (!ext || !SUPPORTED_FORMATS.includes(`.${ext}`)) {
      message.error(`不支持的文件格式: .${ext}`);
      onError?.(new Error('Unsupported format'));
      return;
    }

    setProcessing(true);
    setProcessingFile(uploadFile.name);
    setProgress({ step: 'upload', progress: 0, message: '正在处理文件...' });

    try {
      const tempPath = (file as any).path || '';
      const result: DocumentProcessingResult = await processDocument(tempPath);

      if (result.success) {
        message.success(`文档处理成功: ${result.metadata.fileName} (${result.chunkCount} 个分块)`);
        loadDocuments();
        onSuccess?.(result);
      } else {
        message.error(`文档处理失败: ${result.error}`);
        onError?.(new Error(result.error));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(`处理异常: ${msg}`);
      onError?.(error as Error);
    } finally {
      setProcessing(false);
      setProcessingFile('');
      setProgress({ step: '', progress: 0, message: '' });
      setFileList([]);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      const success = await deleteDoc(docId);
      if (success) {
        message.success('文档已删除');
        loadDocuments();
        // 关键修复：删除文档后刷新查询范围列表
        await getAvailableScopes();
        if (selectedDoc?.documentId === docId) {
          setSelectedDoc(null);
          setDetailVisible(false);
        }
        if (searchDocId === docId) setSearchDocId('');
      } else {
        message.error('删除失败');
      }
    } catch (error) {
      message.error(`删除异常: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleViewDetail = async (doc: DocumentInfo) => {
    setSelectedDoc(doc);
    setDetailVisible(true);
  };

  const handleViewChunks = async (doc: DocumentInfo) => {
    setActiveTab('viewer');
    setChunksLoading(true);
    setChunks([]);
    try {
      const chunksData = await getDocumentChunks(doc.documentId);
      setChunks(chunksData);
    } catch (error) {
      message.error('加载分块失败');
    } finally {
      setChunksLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      message.warning('请输入查询文本');
      return;
    }
    setSearchLoading(true);
    setSearchResults([]);
    setSearchError('');
    try {
      console.log('[VectorTest] Starting search with query:', searchQuery, 'topK:', searchTopK, 'docId:', searchDocId || 'all');
      const result = await searchDocumentVectors(searchQuery, searchTopK, searchDocId || undefined);
      console.log('[VectorTest] Search result:', result);
      if (result.success && result.results) {
        // 过滤低相似度结果，只保留相似度 >= 70% 的结果
        const MIN_SIMILARITY_THRESHOLD = 0.7;
        const filteredResults = result.results.filter(r => r.score >= MIN_SIMILARITY_THRESHOLD);
        
        setSearchResults(filteredResults);
        if (filteredResults.length === 0) {
          message.warning(`未找到相似度足够的结果（最低阈值: ${Math.round(MIN_SIMILARITY_THRESHOLD * 100)}%）`);
        } else {
          message.success(`找到 ${filteredResults.length} 条高相关结果`);
        }
      } else {
        setSearchError(result.error || '查询失败');
        message.error(result.error || '查询失败');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[VectorTest] Search error:', error);
      setSearchError(msg);
      message.error(`查询异常: ${msg}`);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleTestEmbedding = async () => {
    if (!testText.trim()) {
      message.warning('请输入测试文本');
      return;
    }
    setTestLoading(true);
    setTestVector(null);
    setTestError('');
    setTestDimension(0);
    try {
      const result = await generateEmbedding(testText);
      if (result.success && result.vector) {
        setTestVector(result.vector);
        setTestDimension(result.dimension || result.vector.length);
      } else {
        setTestError(result.error || '向量化失败');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setTestError(msg);
    } finally {
      setTestLoading(false);
    }
  };

  const uploadProps: UploadProps = {
    fileList,
    onChange: ({ fileList: newFileList }) => setFileList(newFileList),
    customRequest: handleUpload,
    accept: SUPPORTED_FORMATS.join(','),
    maxCount: 1,
    disabled: processing,
    showUploadList: false,
  };

  const columns: ColumnsType<DocumentInfo> = [
    {
      title: '',
      dataIndex: 'metadata',
      key: 'icon',
      width: 40,
      render: (meta) => <span style={{ fontSize: 20 }}>{getFileTypeIcon(meta.fileType)}</span>,
    },
    {
      title: '文件名',
      dataIndex: 'metadata',
      key: 'fileName',
      render: (meta) => (
        <Space direction="vertical" size={0}>
          <Text strong>{meta.fileName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{meta.fileType.toUpperCase()}</Text>
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'metadata',
      key: 'fileSize',
      width: 100,
      render: (meta) => formatFileSize(meta.fileSize),
    },
    {
      title: '分块数',
      dataIndex: 'chunkCount',
      key: 'chunkCount',
      width: 80,
      render: (count) => <Tag color="blue">{count}</Tag>,
    },
    {
      title: '字符数',
      dataIndex: 'metadata',
      key: 'totalChars',
      width: 100,
      render: (meta) => meta.totalChars.toLocaleString(),
    },
    {
      title: '处理时间',
      dataIndex: 'storedAt',
      key: 'storedAt',
      width: 160,
      render: (ts) => <Text type="secondary">{formatTime(ts)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => handleViewChunks(record)}
          >
            分块
          </Button>
          <Popconfirm
            title="确认删除"
            description="删除此文档及其所有向量数据？"
            onConfirm={() => handleDelete(record.documentId)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const chunkColumns: ColumnsType<{ index: number; text: string }> = [
    {
      title: '分块 #',
      dataIndex: 'index',
      key: 'index',
      width: 80,
      render: (idx) => <Tag color="blue">{idx}</Tag>,
    },
    {
      title: '文本内容',
      dataIndex: 'text',
      key: 'text',
      render: (text) => (
        <div style={{
          maxHeight: 120,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          fontSize: 13,
          lineHeight: '1.5',
        }}>
          {text}
        </div>
      ),
    },
    {
      title: '长度',
      dataIndex: 'text',
      key: 'length',
      width: 80,
      render: (text) => <Text type="secondary">{text.length} 字符</Text>,
    },
  ];

  const searchResultColumns: ColumnsType<{ id: string; score: number; metadata: Record<string, any> }> = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_, __, idx) => <Tag color={idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : 'default'}>{idx + 1}</Tag>,
    },
    {
      title: '相似度',
      dataIndex: 'score',
      key: 'score',
      width: 100,
      render: (score) => (
        <div>
          <Progress
            percent={Math.round(score * 100)}
            size="small"
            strokeColor={getScoreColor(score)}
            format={() => (score * 100).toFixed(1) + '%'}
          />
        </div>
      ),
    },
    {
      title: '来源文档',
      dataIndex: 'metadata',
      key: 'fileName',
      width: 120,
      render: (meta) => <Text strong style={{ fontSize: 12 }}>{meta.fileName || '-'}</Text>,
    },
    {
      title: '分块索引',
      dataIndex: 'metadata',
      key: 'chunkIndex',
      width: 80,
      render: (meta) => <Tag>#{meta.chunkIndex}</Tag>,
    },
    {
      title: '匹配文本',
      dataIndex: 'metadata',
      key: 'text',
      render: (meta) => (
        <div style={{
          maxHeight: 100,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          fontSize: 13,
          lineHeight: '1.5',
        }}>
          {meta.text || meta.chunkText || '-'}
        </div>
      ),
    },
  ];

  const tabsItems = [
    {
      key: 'upload',
      label: (
        <span><CloudServerOutlined /> 文档上传</span>
      ),
      children: (
        <>
          <Card title="上传文档" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                type="primary"
                icon={<UploadOutlined />}
                size="large"
                onClick={handleSelectAndProcess}
                loading={processing}
                disabled={processing}
                style={{ width: '100%', height: 60, fontSize: 16 }}
              >
                {processing ? `正在处理: ${processingFile}` : '选择文档文件'}
              </Button>
              <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
                支持 PDF、Word(.docx)、Excel(.xlsx)、TXT、Markdown 格式，最大 50MB
              </Text>
            </Space>
            {processing && (
              <div style={{ marginTop: 16 }}>
                <Space>
                  <Text>处理中: {processingFile}</Text>
                  <Tag color="processing">{progress.step}</Tag>
                </Space>
                <Progress percent={progress.progress} status="active" style={{ marginTop: 8 }} />
                <Text type="secondary" style={{ fontSize: 12 }}>{progress.message}</Text>
              </div>
            )}
          </Card>

          <Card
            title={
              <Space>
                <FileTextOutlined />
                <span>已处理文档</span>
                <Tag color="blue">{documents.length}</Tag>
              </Space>
            }
            extra={
              <Button type="link" onClick={loadDocuments} size="small">
                刷新
              </Button>
            }
          >
            {documents.length > 0 ? (
              <Table
                columns={columns}
                dataSource={documents}
                rowKey="documentId"
                pagination={{ pageSize: 10 }}
                size="small"
              />
            ) : (
              <Empty description="暂无已处理的文档" />
            )}
          </Card>
        </>
      ),
    },
    {
      key: 'viewer',
      label: (
        <span><BarChartOutlined /> 向量查看</span>
      ),
      children: (
        <>
          <Card title="向量存储统计" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={8}>
                <StatisticCard label="总向量数" value={stats.totalVectors} />
              </Col>
              <Col span={8}>
                <StatisticCard label="文档数量" value={stats.documentCount} />
              </Col>
              <Col span={8}>
                <StatisticCard label="平均向量/文档" value={stats.documentCount > 0 ? Math.round(stats.totalVectors / stats.documentCount) : 0} />
              </Col>
            </Row>
          </Card>

          {chunks.length > 0 && (
            <Card
              title={
                <Space>
                  <FileTextOutlined />
                  <span>文档分块详情</span>
                  <Tag color="blue">{chunks.length} 个分块</Tag>
                </Space>
              }
              extra={
                <Button type="link" size="small" onClick={() => setChunks([])}>
                  清除
                </Button>
              }
            >
              <Table
                columns={chunkColumns}
                dataSource={chunks}
                rowKey="index"
                loading={chunksLoading}
                pagination={{ pageSize: 10 }}
                size="small"
                scroll={{ y: 400 }}
              />
            </Card>
          )}

          {chunks.length === 0 && !chunksLoading && (
            <Empty description="请从文档列表点击「分块」按钮查看分块详情" />
          )}

          {chunksLoading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Progress type="circle" percent={0} status="active" />
              <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>加载分块数据...</Text>
            </div>
          )}
        </>
      ),
    },
    {
      key: 'test',
      label: (
        <span><ExperimentOutlined /> 向量测试</span>
      ),
      children: (
        <>
          <Alert
            message="使用说明"
            description={
              <div>
                <p style={{ margin: '0 0 8px' }}><strong>1. 相似性查询：</strong>输入查询文本，系统将其向量化后与所有存储的向量进行余弦相似度匹配，返回最相似的文本分块。</p>
                <p style={{ margin: '0 0 8px' }}><strong>2. 向量化测试：</strong>输入任意文本，查看其生成的向量数据和维度信息。</p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Card title="测试 1: 相似性语义查询" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Text strong>查询文本</Text>
                  <TextArea
                    rows={3}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="输入您要查询的内容，系统将找到最相似的文本分块..."
                    style={{ marginTop: 8 }}
                  />
                </Col>
                <Col span={12}>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Text strong>搜索范围</Text>
                      <Select
                        style={{ width: '100%', marginTop: 8 }}
                        value={searchDocId}
                        onChange={setSearchDocId}
                        allowClear
                        placeholder="全部文档"
                      >
                        {documents.map(doc => (
                          <Select.Option key={doc.documentId} value={doc.documentId}>
                            {doc.metadata.fileName}
                          </Select.Option>
                        ))}
                      </Select>
                    </Col>
                    <Col span={12}>
                      <Text strong>返回数量</Text>
                      <Select
                        style={{ width: '100%', marginTop: 8 }}
                        value={searchTopK}
                        onChange={setSearchTopK}
                      >
                        <Select.Option value={1}>Top 1</Select.Option>
                        <Select.Option value={3}>Top 3</Select.Option>
                        <Select.Option value={5}>Top 5</Select.Option>
                        <Select.Option value={10}>Top 10</Select.Option>
                        <Select.Option value={20}>Top 20</Select.Option>
                      </Select>
                    </Col>
                  </Row>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    size="large"
                    onClick={handleSearch}
                    loading={searchLoading}
                    disabled={searchLoading}
                    style={{ marginTop: 16 }}
                  >
                    执行查询
                  </Button>
                </Col>
              </Row>

              {searchError && (
                <Alert
                  message="查询失败"
                  description={searchError}
                  type="error"
                  showIcon
                  style={{ marginTop: 16 }}
                />
              )}

              {searchResults.length > 0 && (
                <Card
                  title={
                    <Space>
                      <span>查询结果</span>
                      <Tag color="success">{searchResults.length} 条匹配</Tag>
                    </Space>
                  }
                  style={{ marginTop: 16 }}
                >
                  <Table
                    columns={searchResultColumns}
                    dataSource={searchResults}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    scroll={{ y: 400 }}
                  />
                </Card>
              )}

              {!searchLoading && searchResults.length === 0 && searchQuery.trim() && !searchError && (
                <Empty
                  description="未找到匹配的文本分块，请尝试其他查询文本"
                  style={{ marginTop: 16 }}
                />
              )}
            </Space>
          </Card>

          <Card title="测试 2: 向量化测试">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>测试文本</Text>
              <TextArea
                rows={3}
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="输入任意文本，查看其向量表示..."
              />
              <Button
                type="primary"
                icon={<ExperimentOutlined />}
                onClick={handleTestEmbedding}
                loading={testLoading}
                disabled={testLoading}
              >
                生成向量
              </Button>

              {testError && (
                <Alert
                  message="向量化失败"
                  description={testError}
                  type="error"
                  showIcon
                />
              )}

              {testVector && testDimension > 0 && (
                <Card title="向量信息" style={{ marginTop: 16 }}>
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="向量维度">{testDimension}</Descriptions.Item>
                    <Descriptions.Item label="向量类型">Float32</Descriptions.Item>
                    <Descriptions.Item label="向量范围" span={2}>
                      {(() => {
                        const min = Math.min(...testVector);
                        const max = Math.max(...testVector);
                        return `[${min.toFixed(6)}, ${max.toFixed(6)}]`;
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="前 20 个分量" span={2}>
                      <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        [{testVector.slice(0, 20).map(v => v.toFixed(4)).join(', ')}...]
                      </Text>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              )}
            </Space>
          </Card>
        </>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2}>文档向量化</Title>
        <Text type="secondary">上传文档自动提取文本并向量化存储，支持语义搜索和向量测试</Text>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabsItems} size="large" />

      <Modal
        title="文档详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedDoc && (
          <Descriptions column={2} bordered>
            <Descriptions.Item label="文件名">{selectedDoc.metadata.fileName}</Descriptions.Item>
            <Descriptions.Item label="类型">{selectedDoc.metadata.fileType.toUpperCase()}</Descriptions.Item>
            <Descriptions.Item label="大小">{formatFileSize(selectedDoc.metadata.fileSize)}</Descriptions.Item>
            <Descriptions.Item label="分块数">{selectedDoc.chunkCount}</Descriptions.Item>
            <Descriptions.Item label="字符数">{selectedDoc.metadata.totalChars.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="处理时间">{formatTime(selectedDoc.metadata.processedAt)}</Descriptions.Item>
            <Descriptions.Item label="文档 ID" span={2}>{selectedDoc.documentId}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

const StatisticCard: React.FC<{ label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }> = ({ label, value, valueStyle }) => (
  <div style={{ textAlign: 'center', padding: 8 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    <div style={{ fontSize: 28, fontWeight: 'bold', marginTop: 4, ...valueStyle }}>{value}</div>
  </div>
);

export default DocumentVectorPage;