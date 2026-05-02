import React, { useState, useCallback, useEffect } from 'react';
import {
  Card, Button, Space, Tag, Progress, Table, Typography, Divider,
  Row, Col, Upload, message, Popconfirm, Modal, Descriptions, Empty
} from 'antd';
import {
  UploadOutlined,
  FileTextOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import type { ColumnsType } from 'antd/es/table';
import { processDocument, listDocuments, deleteDocument as deleteDoc } from '../../services/documentVectorService';
import type { DocumentInfo, DocumentProcessingResult, ProcessingProgress } from '../../types/documentVector';

const { Title, Text } = Typography;

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

const DocumentVectorPage: React.FC = () => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingFile, setProcessingFile] = useState<string>('');
  const [progress, setProgress] = useState<ProcessingProgress>({ step: '', progress: 0, message: '' });
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentInfo | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs.sort((a, b) => b.storedAt - a.storedAt));
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
        if (selectedDoc?.documentId === docId) {
          setSelectedDoc(null);
          setDetailVisible(false);
        }
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
      width: 120,
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

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2}>文档向量化</Title>
        <Text type="secondary">上传文档自动提取文本并向量化存储，支持语义搜索</Text>
      </div>

      {/* 上传区 */}
      <Card title="上传文档" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button
            type="primary"
            icon={<CloudServerOutlined />}
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

      {/* 文档列表 */}
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

      {/* 详情弹窗 */}
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

export default DocumentVectorPage;
