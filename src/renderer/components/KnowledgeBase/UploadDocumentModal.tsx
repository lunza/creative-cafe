/**
 * 文档上传面板 - 对应原 KnowledgeBaseManager 的 "文档上传" Tab。
 *
 * 包含：
 * - 上传按钮 + 处理进度展示
 * - 已处理文档列表（含批量删除/详情查看/分块预览 Modal）
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Button, Card, Space, Tag, Progress, Table, Popconfirm, Alert,
  Descriptions, Modal, Typography, message,
} from 'antd';
import {
  CloudUploadOutlined, FileTextOutlined, InfoCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBaseStore';
import { SUPPORTED_FORMATS, formatFileSize, formatTime, getFileTypeIcon, type ProcessedDocument } from './shared';

const { Text } = Typography;

interface UploadDocumentModalProps {
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

const UploadDocumentModal: React.FC<UploadDocumentModalProps> = ({ pageSize, onPageSizeChange }) => {
  const uploadProgress = useKnowledgeBaseStore(s => s.uploadProgress);
  const isUploading = useKnowledgeBaseStore(s => s.isUploading);
  const fetchItems = useKnowledgeBaseStore(s => s.fetchItems);
  const uploadDocument = useKnowledgeBaseStore(s => s.uploadDocument);
  const selectDocumentFile = useKnowledgeBaseStore(s => s.selectDocumentFile);

  const [uploadCategory] = useState<string[]>(['文档知识']);
  const [uploadTags] = useState<string[]>([]);
  const [processingFile, setProcessingFile] = useState('');
  const [processedDocuments, setProcessedDocuments] = useState<ProcessedDocument[]>([]);
  const [selectedDocKeys, setSelectedDocKeys] = useState<React.Key[]>([]);

  // 文档详情 / 分块 Modal 状态
  const [docDetailVisible, setDocDetailVisible] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ProcessedDocument | null>(null);
  const [docChunks, setDocChunks] = useState<Array<{ index: number; text: string }>>([]);
  const [chunksVisible, setChunksVisible] = useState(false);
  const [chunksLoading, setChunksLoading] = useState(false);

  const loadProcessedDocuments = useCallback(async () => {
    try {
      const docs = await window.electronAPI.document.list();
      const formattedDocs: ProcessedDocument[] = docs.map((doc: any) => ({
        documentId: doc.documentId,
        fileName: doc.metadata.fileName,
        fileSize: doc.metadata.fileSize,
        chunkCount: doc.chunkCount,
        totalChars: doc.metadata.totalChars,
        processedAt: doc.metadata.processedAt || doc.storedAt,
        fileType: doc.metadata.fileType,
      }));
      setProcessedDocuments(formattedDocs);
    } catch {
      setProcessedDocuments([]);
    }
  }, []);

  useEffect(() => {
    loadProcessedDocuments();
  }, [loadProcessedDocuments]);

  const handleUploadDocument = async () => {
    const filePath = await selectDocumentFile();
    if (!filePath) return;

    const fileName = filePath.split(/[\\/]/).pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || !SUPPORTED_FORMATS.includes(`.${ext}`)) {
      message.error(`不支持的文件格式: .${ext}`);
      return;
    }

    setProcessingFile(fileName);

    try {
      const result = await uploadDocument(filePath, {
        category: uploadCategory,
        tags: uploadTags.length > 0 ? uploadTags : [fileName.split('.')[0]],
        source: 'document_upload',
      });

      if (result.success) {
        if (result.isDuplicate) {
          message.warning('文档已存在，已跳过');
        } else {
          message.success(`文档处理成功：${result.chunkCount} 个分块，${result.knowledgeItemsCreated} 条知识条目`);
          loadProcessedDocuments();
          fetchItems();
        }
      } else {
        message.error(`处理失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`处理异常: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setProcessingFile('');
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await window.electronAPI.document.delete(docId);
      message.success('文档已删除');
      loadProcessedDocuments();
      fetchItems();
    } catch {
      message.error('删除失败');
    }
  };

  const handleBatchDeleteDocuments = async () => {
    if (selectedDocKeys.length === 0) {
      message.warning('请先选择要删除的文档');
      return;
    }
    try {
      let count = 0;
      for (const docId of selectedDocKeys as string[]) {
        const result = await window.electronAPI.document.delete(docId);
        if (result) count++;
      }
      setSelectedDocKeys([]);
      loadProcessedDocuments();
      fetchItems();
      if (count > 0) {
        message.success(`批量删除完成：成功 ${count} 个`);
      } else {
        message.error('批量删除失败');
      }
    } catch {
      message.error('批量删除异常');
    }
  };

  const handleViewDocDetail = (doc: ProcessedDocument) => {
    setSelectedDoc(doc);
    setDocDetailVisible(true);
  };

  const handleViewDocChunks = async (doc: ProcessedDocument) => {
    setChunksLoading(true);
    setDocChunks([]);
    setChunksVisible(true);
    try {
      const chunksData = await window.electronAPI.document.getChunks(doc.documentId);
      setDocChunks(chunksData);
    } catch {
      message.error('加载分块失败');
    } finally {
      setChunksLoading(false);
    }
  };

  // 已处理文档列表的列定义（useMemo 包裹避免每次渲染重建）
  const documentColumns: ColumnsType<ProcessedDocument> = useMemo(
    () => [
      {
        title: '',
        dataIndex: 'fileType',
        key: 'icon',
        width: 40,
        render: (type) => <span style={{ fontSize: 20 }}>{getFileTypeIcon(type)}</span>,
      },
      {
        title: '文件名',
        dataIndex: 'fileName',
        key: 'fileName',
        render: (fileName, record) => (
          <Space direction="vertical" size={0}>
            <Text strong>{fileName}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{record.fileType.toUpperCase()}</Text>
          </Space>
        ),
      },
      {
        title: '大小',
        dataIndex: 'fileSize',
        key: 'fileSize',
        width: 100,
        render: (size) => formatFileSize(size),
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
        dataIndex: 'totalChars',
        key: 'totalChars',
        width: 100,
        render: (chars) => chars?.toLocaleString() || '-',
      },
      {
        title: '处理时间',
        dataIndex: 'processedAt',
        key: 'processedAt',
        width: 160,
        render: (ts) => <Text type="secondary">{formatTime(ts)}</Text>,
      },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        render: (_, record) => (
          <Space size="small">
            <Button
              type="link"
              size="small"
              icon={<InfoCircleOutlined />}
              onClick={() => handleViewDocDetail(record)}
            >
              详情
            </Button>
            <Button
              type="link"
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => handleViewDocChunks(record)}
            >
              分片
            </Button>
            <Popconfirm
              title="确认删除"
              description="删除此文档及其所有向量数据和知识条目？"
              onConfirm={() => handleDeleteDocument(record.documentId)}
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
    ],
    []
  );

  // 分块预览 Modal 的列定义
  const chunkColumns = useMemo(
    () => [
      {
        title: '分块 #',
        dataIndex: 'index',
        key: 'index',
        width: 80,
        render: (idx: number) => <Tag color="blue">{idx}</Tag>,
      },
      {
        title: '文本内容',
        dataIndex: 'text',
        key: 'text',
        render: (text: string) => (
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
        render: (text: string) => <Text type="secondary">{text.length} 字符</Text>,
      },
    ],
    []
  );

  return (
    <>
      <Card title="上传文档" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            size="large"
            onClick={handleUploadDocument}
            loading={isUploading}
            disabled={isUploading}
            style={{ width: '100%', height: 60, fontSize: 16 }}
          >
            {isUploading ? `正在处理: ${processingFile}` : '选择文档文件'}
          </Button>
          <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
            支持 PDF、Word(.docx)、Excel(.xlsx)、TXT、Markdown 格式，最大 50MB
          </Text>
        </Space>
        {isUploading && uploadProgress && (
          <div style={{ marginTop: 16 }}>
            <Space>
              <Text>处理中: {uploadProgress.fileName}</Text>
              <Tag color="processing">{uploadProgress.step}</Tag>
            </Space>
            <Progress percent={uploadProgress.progress} status="active" style={{ marginTop: 8 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{uploadProgress.message}</Text>
          </div>
        )}
      </Card>

      <Card
        title={
          <Space>
            <FileTextOutlined />
            <span>已处理文档</span>
            <Tag color="blue">{processedDocuments.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            {selectedDocKeys.length > 0 && (
              <Popconfirm
                title={`确认批量删除 ${selectedDocKeys.length} 个文档`}
                description="删除后所有相关的向量数据和知识条目也将被删除"
                onConfirm={handleBatchDeleteDocuments}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger size="small" icon={<DeleteOutlined />}>
                  批量删除 ({selectedDocKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Button type="link" onClick={() => { loadProcessedDocuments(); fetchItems(); }} size="small">
              刷新
            </Button>
          </Space>
        }
      >
        {processedDocuments.length > 0 ? (
          <div className="table-container">
            <Table
              columns={documentColumns}
              dataSource={processedDocuments}
              rowKey="documentId"
              bordered
              pagination={{
                pageSize,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 条`,
                pageSizeOptions: ['10', '20', '50'],
                className: 'table-pagination-wrapper',
                onChange: (_page, size) => { onPageSizeChange(size); },
              }}
              size="small"
              rowSelection={{
                selectedRowKeys: selectedDocKeys,
                onChange: (keys) => setSelectedDocKeys(keys),
              }}
            />
          </div>
        ) : (
          <Alert message="暂无已处理的文档" type="info" showIcon />
        )}
      </Card>

      <Modal
        title="文档详情"
        open={docDetailVisible}
        onCancel={() => setDocDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedDoc && (
          <Descriptions column={2} bordered>
            <Descriptions.Item label="文件名">{selectedDoc.fileName}</Descriptions.Item>
            <Descriptions.Item label="类型">{selectedDoc.fileType.toUpperCase()}</Descriptions.Item>
            <Descriptions.Item label="大小">{formatFileSize(selectedDoc.fileSize)}</Descriptions.Item>
            <Descriptions.Item label="分块数">{selectedDoc.chunkCount}</Descriptions.Item>
            <Descriptions.Item label="字符数">{selectedDoc.totalChars.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="处理时间">{formatTime(selectedDoc.processedAt)}</Descriptions.Item>
            <Descriptions.Item label="文档 ID" span={2}>{selectedDoc.documentId}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={
          <Space>
            <FileTextOutlined />
            <span>文档分块详情</span>
            {docChunks.length > 0 && <Tag color="blue">{docChunks.length} 个分块</Tag>}
          </Space>
        }
        open={chunksVisible}
        onCancel={() => setChunksVisible(false)}
        footer={null}
        width={800}
        bodyStyle={{ maxHeight: '60vh', overflow: 'auto' }}
      >
        {chunksLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Progress type="circle" percent={0} status="active" />
            <div style={{ marginTop: 16, color: 'var(--text-secondary)' }}>加载分块数据中...</div>
          </div>
        ) : docChunks.length > 0 ? (
          <div className="table-container">
            <Table
              columns={chunkColumns}
              dataSource={docChunks}
              rowKey="index"
              bordered
              size="small"
              pagination={{
                pageSize,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                className: 'table-pagination-wrapper',
                onChange: (_page, size) => { onPageSizeChange(size); },
              }}
            />
          </div>
        ) : (
          <Alert message="暂无分块数据" description="请从文档列表点击「分片」按钮查看分块详情" type="info" showIcon />
        )}
      </Modal>
    </>
  );
};

export default UploadDocumentModal;
