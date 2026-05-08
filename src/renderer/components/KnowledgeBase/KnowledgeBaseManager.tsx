import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Input, Modal, Form, Select, Tag, Space, Popconfirm, message, Card, Tabs, Progress, Alert, Typography, Descriptions, Empty } from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, CloudUploadOutlined, FileTextOutlined, InfoCircleOutlined, EyeOutlined, ExperimentOutlined, FolderOutlined } from '@ant-design/icons';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBaseStore';
import { useVectorStore } from '../../stores/vectorStore';
import { VectorScopeSelector } from '../Vector/VectorScopeSelector';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection } from 'antd/es/table/interface';
import type { KnowledgeItem } from '../../types/knowledgeBase';

const { TextArea } = Input;
const { Option } = Select;
const { Text } = Typography;

const SUPPORTED_FORMATS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md'];

interface TreeKnowledgeItem extends KnowledgeItem {
  key: string;
  isLeaf: boolean;
  children?: TreeKnowledgeItem[];
}

interface ProcessedDocument {
  documentId: string;
  fileName: string;
  fileSize: number;
  chunkCount: number;
  totalChars: number;
  processedAt: number;
  fileType: string;
}

interface VectorSearchResult {
  id: string;
  score: number;
  metadata: {
    text: string;
    source: string;
    title?: string;
    category?: string[];
    tags?: string[];
  };
}

interface VectorTestResult {
  vector: number[];
  dimension: number;
  min: number;
  max: number;
  first20: number[];
}

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

export const KnowledgeBaseManager: React.FC = () => {
  const {
    items,
    loading,
    selectedId,
    searchResults,
    isSearching,
    currentPage,
    totalPages,
    totalItems,
    uploadProgress,
    isUploading,
    fetchItems,
    createItem,
    updateItem,
    deleteItem,
    deleteBatchItems,
    searchItems,
    vectorizeItem,
    vectorizeAll,
    selectItem,
    uploadDocument,
    selectDocumentFile,
    setUploadProgress
  } = useKnowledgeBaseStore();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [form] = Form.useForm();

  const [uploadCategory, setUploadCategory] = useState<string[]>(['文档知识']);
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [processedDocuments, setProcessedDocuments] = useState<ProcessedDocument[]>([]);
  const [processingFile, setProcessingFile] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedDocKeys, setSelectedDocKeys] = useState<React.Key[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [currentPageLocal, setCurrentPageLocal] = useState(1);
  const [docDetailVisible, setDocDetailVisible] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ProcessedDocument | null>(null);
  const [docChunks, setDocChunks] = useState<Array<{ index: number; text: string }>>([]);
  const [chunksVisible, setChunksVisible] = useState(false);
  const [chunksLoading, setChunksLoading] = useState(false);

  // 向量搜索状态
  const [vectorSearchQuery, setVectorSearchQuery] = useState('');
  const [vectorSearchResults, setVectorSearchResults] = useState<VectorSearchResult[]>([]);
  const [vectorSearchLoading, setVectorSearchLoading] = useState(false);
  const [vectorSearchTopK, setVectorSearchTopK] = useState(5);
  const [vectorSearchError, setVectorSearchError] = useState('');

  const { selectedScopes, searchWithScopes } = useVectorStore();

  // 向量化测试状态
  const [vectorTestText, setVectorTestText] = useState('');
  const [vectorTestResult, setVectorTestResult] = useState<VectorTestResult | null>(null);
  const [vectorTestLoading, setVectorTestLoading] = useState(false);
  const [vectorTestError, setVectorTestError] = useState('');

  useEffect(() => {
    fetchItems();
    loadProcessedDocuments();
  }, [fetchItems]);

  const loadProcessedDocuments = async () => {
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
  };

  const handleCreate = () => {
    setEditingItem(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleViewItem = async (record: KnowledgeItem) => {
    if (record.metadata?.isWorldBook || record.source === 'worldbook') {
      try {
        const result = await window.electronAPI.vector.getById(record.id);
        if (result.success && result.item) {
          setViewingItem(result.item as KnowledgeItem);
        } else {
          setViewingItem(record);
          message.warning('未能加载完整元数据，仅显示基本信息');
        }
      } catch {
        setViewingItem(record);
      }
    } else {
      setViewingItem(record);
    }
  };

  const handleEdit = (item: KnowledgeItem) => {
    setEditingItem(item);
    form.setFieldsValue(item);
    setIsModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const success = await deleteItem(id);
    if (success) {
      message.success('删除成功');
    } else {
      message.error('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的条目');
      return;
    }
    const count = await deleteBatchItems(selectedRowKeys as string[]);
    setSelectedRowKeys([]);
    if (count > 0) {
      message.success(`批量删除完成：成功 ${count} 条`);
    } else {
      message.error('批量删除失败');
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

  const handleVectorize = async (id: string) => {
    const success = await vectorizeItem(id);
    if (success) {
      message.success('向量化成功');
    } else {
      message.error('向量化失败');
    }
  };

  const handleVectorizeAll = async () => {
    const count = await vectorizeAll();
    message.success(`已向量化 ${count} 个条目`);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    await searchItems(searchQuery, { topK: 10, minScore: 0.7 });
  };

  const handleSubmit = async (values: any) => {
    if (editingItem) {
      const success = await updateItem(editingItem.id, values);
      if (success) {
        message.success('更新成功');
      }
    } else {
      const now = Date.now();
      const newItem: KnowledgeItem = {
        ...values,
        id: '',
        source: values.source || 'manual',
        metadata: {
          createdAt: now,
          updatedAt: now,
          createdBy: 'user'
        }
      };
      const id = await createItem(newItem);
      if (id) {
        message.success('创建成功');
      }
    }
    setIsModalVisible(false);
  };

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

  // 向量搜索处理
  const handleVectorSearch = async () => {
    if (!vectorSearchQuery.trim()) {
      message.warning('请输入查询文本');
      return;
    }
    setVectorSearchLoading(true);
    setVectorSearchResults([]);
    setVectorSearchError('');
    try {
      // 统一使用向量搜索，后端会自动聚合所有数据源
      const queryVector = await window.electronAPI.embedding.generate(vectorSearchQuery);
      if (!queryVector.success || !queryVector.vector) {
        setVectorSearchError(queryVector.error || '向量化失败');
        message.error(queryVector.error || '向量化失败');
        return;
      }
      
      // 使用 searchWithScopes 进行搜索（当没有选中 scope 时，后端会自动聚合所有源）
      const results = await searchWithScopes(queryVector.vector, vectorSearchTopK);
      
      if (results && results.length > 0) {
        const formattedResults = results.map(r => ({
          id: r.id,
          score: r.similarity || r.score,
          metadata: {
            text: r.metadata?.text || r.content || '',
            source: r.metadata?.source || 'vector',
            title: r.metadata?.title,
            category: r.metadata?.category,
            tags: r.metadata?.tags
          }
        }));

        message.success(`找到 ${formattedResults.length} 条相关结果`);
        setVectorSearchResults(formattedResults);
      } else {
        message.warning('未找到相关结果，请尝试其他查询词');
        setVectorSearchResults([]);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setVectorSearchError(msg);
      message.error(`搜索异常: ${msg}`);
    } finally {
      setVectorSearchLoading(false);
    }
  };

  // 向量化测试处理
  const handleVectorTest = async () => {
    if (!vectorTestText.trim()) {
      message.warning('请输入测试文本');
      return;
    }
    setVectorTestLoading(true);
    setVectorTestResult(null);
    setVectorTestError('');
    try {
      const embedResult = await window.electronAPI.embedding.generate(vectorTestText);
      if (embedResult.success && embedResult.vector) {
        const vector = embedResult.vector;
        const result: VectorTestResult = {
          vector,
          dimension: vector.length,
          min: Math.min(...vector),
          max: Math.max(...vector),
          first20: vector.slice(0, 20)
        };
        setVectorTestResult(result);
        message.success('向量化成功');
      } else {
        setVectorTestError(embedResult.error || '向量化失败');
        message.error(embedResult.error || '向量化失败');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setVectorTestError(msg);
      message.error(`向量化异常: ${msg}`);
    } finally {
      setVectorTestLoading(false);
    }
  };

  // 树形知识库状态
  const [treeData, setTreeData] = useState<TreeKnowledgeItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  const [documentMap, setDocumentMap] = useState<Map<string, ProcessedDocument>>(new Map());

  // 加载树形数据
  const loadTreeData = useCallback(async () => {
    setTreeLoading(true);
    try {
      // 获取所有文档
      const docs = await window.electronAPI.document.list();
      const docMap = new Map<string, ProcessedDocument>();
      
      for (const doc of docs) {
        const formatted: ProcessedDocument = {
          documentId: doc.documentId,
          fileName: doc.metadata?.fileName || doc.documentId,
          fileSize: doc.metadata?.fileSize || 0,
          chunkCount: doc.chunkCount || 0,
          totalChars: doc.metadata?.totalChars || 0,
          processedAt: doc.metadata?.processedAt || doc.storedAt || 0,
          fileType: doc.metadata?.fileType || 'unknown',
        };
        docMap.set(doc.documentId, formatted);
      }
      
      setDocumentMap(docMap);
      
      // 构建树形数据 - 从文档加载
      const treeNodes: TreeKnowledgeItem[] = [];
      
      for (const [docId, docInfo] of docMap) {
        const treeNode: TreeKnowledgeItem = {
          key: `doc_${docId}`,
          id: docId,
          title: docInfo.fileName,
          content: '',
          source: docInfo.fileType,
          category: [],
          tags: [],
          relatedCharacterIds: [],
          relatedWorldBookPaths: [],
          metadata: {
            fileSize: docInfo.fileSize,
            chunkCount: docInfo.chunkCount,
            totalChars: docInfo.totalChars,
            processedAt: docInfo.processedAt,
            isWorldBook: docInfo.fileType?.toLowerCase().includes('worldbook') || false,
          },
          isLeaf: false,
          documentId: docId,
          children: [],
        };
        treeNodes.push(treeNode);
      }
      
      // 从向量注册表加载世界书和角色卡聊天记录条目
      try {
        const scopesResult = await window.electronAPI.vector.getAvailableScopes();
        if (scopesResult.success && scopesResult.scopes) {
          // 加载世界书条目
          const worldbookScopes = scopesResult.scopes.filter(s => s.sourceType === 'worldbook');
          
          for (const scope of worldbookScopes) {
            // 检查是否已存在（避免重复）
            const existingIndex = treeNodes.findIndex(n => n.documentId === scope.sourceId || n.title === scope.sourceName);
            if (existingIndex === -1) {
              const worldbookNode: TreeKnowledgeItem = {
                key: `wb_${scope.id}`,
                id: scope.id,
                title: scope.sourceName,
                content: '',
                source: 'worldbook',
                category: [],
                tags: ['worldbook'],
                relatedCharacterIds: [],
                relatedWorldBookPaths: [scope.sourceId],
                metadata: {
                  fileSize: 0,
                  chunkCount: scope.vectorCount,
                  totalChars: 0,
                  processedAt: Date.now(),
                  isWorldBook: true,
                  scopeId: scope.id,
                },
                isLeaf: false,
                documentId: scope.sourceId,
                children: [],
              };
              treeNodes.push(worldbookNode);
            }
          }

          // 加载角色卡聊天记录条目
          const chatScopes = scopesResult.scopes.filter(s => s.sourceType === 'character_chat');
          
          for (const scope of chatScopes) {
            // 检查是否已存在（避免重复）
            const existingIndex = treeNodes.findIndex(n => n.documentId === scope.sourceId || n.title === scope.sourceName);
            if (existingIndex === -1) {
              const chatNode: TreeKnowledgeItem = {
                key: `chat_${scope.id}`,
                id: scope.id,
                title: scope.sourceName,
                content: '',
                source: 'character_chat',
                category: [],
                tags: ['character_chat'],
                relatedCharacterIds: [],
                relatedWorldBookPaths: [],
                metadata: {
                  fileSize: 0,
                  chunkCount: scope.vectorCount,
                  totalChars: 0,
                  processedAt: Date.now(),
                  isWorldBook: false,
                  isCharacterChat: true,
                  scopeId: scope.id,
                },
                isLeaf: false,
                documentId: scope.sourceId,
                children: [],
              };
              treeNodes.push(chatNode);
            }
          }
        }
      } catch (error) {
        console.warn('[KnowledgeBaseManager] Failed to load scopes from registry:', error);
      }
      
      setTreeData(treeNodes);
    } catch (error) {
      console.error('加载树形数据失败:', error);
      setTreeData([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // 展开文档时加载子节点
  const loadDocumentChildren = async (docId: string, isWorldbook = false, isCharacterChat = false): Promise<TreeKnowledgeItem[]> => {
    try {
      if (isWorldbook) {
        const scopesResult = await window.electronAPI.vector.getAvailableScopes();
        if (scopesResult.success && scopesResult.scopes) {
          const scope = scopesResult.scopes.find(s => s.id === docId || s.sourceId === docId);
          if (scope && scope.metadata?.entryVectorIds) {
            return scope.metadata.entryVectorIds.map((vectorId: string) => ({
              key: `item_${vectorId}`,
              id: vectorId,
              title: vectorId,
              content: '',
              source: 'worldbook',
              category: [],
              tags: ['worldbook'],
              relatedCharacterIds: [],
              relatedWorldBookPaths: [],
              metadata: {
                isWorldBook: true,
                entryVectorId: vectorId,
              },
              isLeaf: true,
            }));
          }
        }
        return [];
      } else if (isCharacterChat) {
        const scopesResult = await window.electronAPI.vector.getAvailableScopes();
        if (scopesResult.success && scopesResult.scopes) {
          const scope = scopesResult.scopes.find(s => s.id === docId || s.sourceId === docId);
          if (scope) {
            // Use getById to retrieve each vector by its ID from messageVectorIds
            const messageVectorIds = scope.metadata?.messageVectorIds || [];
            if (messageVectorIds.length > 0) {
              const vectorItems = await Promise.all(
                messageVectorIds.map(async (vectorId: string) => {
                  try {
                    const result = await window.electronAPI.vector.getById(vectorId);
                    if (result.success && result.item) {
                      const item = result.item as any;
                      return {
                        key: `item_${vectorId}`,
                        id: vectorId,
                        title: item.metadata?.messageRole === 'user' ? `用户` : '助手',
                        content: item.metadata?.text || '',
                        source: 'character_chat',
                        category: [],
                        tags: ['character_chat'],
                        relatedCharacterIds: [],
                        relatedWorldBookPaths: [],
                        metadata: {
                          isCharacterChat: true,
                          messageRole: item.metadata?.messageRole,
                          messageContent: item.metadata?.text,
                          sourceType: 'character_chat',
                          chunkIndex: item.metadata?.chunkIndex,
                          characterId: item.metadata?.characterId,
                        },
                        isLeaf: true,
                      };
                    }
                    return null;
                  } catch {
                    return null;
                  }
                })
              );
              return vectorItems.filter(Boolean) as TreeKnowledgeItem[];
            }
          }
        }
        return [];
      } else {
        const result = await window.electronAPI.knowledge.list({ documentId: docId }, 1, 1000);
        if (result.success && result.items) {
          return result.items.map(item => ({
            ...item,
            key: `item_${item.id}`,
            isLeaf: true,
            metadata: {
              ...item.metadata,
              isWorldBook: item.source === 'worldbook' || false,
            },
          }));
        }
        return [];
      }
    } catch {
      return [];
    }
  };

  // 处理树形表格展开
  const handleExpand = async (expanded: boolean, record: TreeKnowledgeItem) => {
    if (expanded && !record.isLeaf && (!record.children || record.children.length === 0)) {
      // 懒加载子节点
      const isWorldbook = record.metadata?.isWorldBook === true;
      const isCharacterChat = record.metadata?.isCharacterChat === true;
      const children = await loadDocumentChildren(record.id || record.documentId || '', isWorldbook, isCharacterChat);
      setTreeData(prev =>
        prev.map(node =>
          node.id === record.id || node.documentId === record.documentId
            ? { ...node, children }
            : node
        )
      );
    }
  };

  // 删除整个文档（包括所有子条目）
  const handleDeleteDocumentTree = async (docId: string) => {
    try {
      await window.electronAPI.document.delete(docId);
      message.success('文档及所有知识条目已删除');
      loadTreeData();
    } catch {
      message.error('删除失败');
    }
  };

  // 删除单个知识条目
  const handleDeleteItem = async (id: string) => {
    const success = await deleteItem(id);
    if (success) {
      message.success('删除成功');
      // 刷新当前展开的文档
      const expandedArray = Array.from(expandedDocIds);
      for (const docId of expandedArray) {
        const children = await loadDocumentChildren(docId);
        setTreeData(prev =>
          prev.map(node =>
            (node.id === docId || node.documentId === docId)
              ? { ...node, children }
              : node
          )
        );
      }
    } else {
      message.error('删除失败');
    }
  };

  useEffect(() => {
    loadTreeData();
  }, [loadTreeData]);

  // 树形表格列定义
  const treeColumns: ColumnsType<TreeKnowledgeItem> = [
    {
      title: '名称',
      dataIndex: 'title',
      key: 'title',
      width: 300,
      ellipsis: true,
      render: (text, record) => (
        <Space>
          {record.isLeaf ? <FileTextOutlined /> : <FolderOutlined style={{ color: '#1890ff' }} />}
          <span style={{ fontWeight: record.isLeaf ? 'normal' : 500 }}>{text}</span>
          {!record.isLeaf && (
            <Tag color="blue" style={{ marginLeft: 4 }}>
              {record.metadata?.chunkCount || 0} 条
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source, record) => {
        if (!record.isLeaf) {
          return (
            <Tag color={record.metadata?.isWorldBook ? 'cyan' : 'purple'}>
              {record.metadata?.isWorldBook ? '世界书' : (record.metadata?.fileType?.toUpperCase() || '文档')}
            </Tag>
          );
        }

        let label = '知识条目';
        let color = 'default';
        if (record.metadata?.isWorldBook || record.source === 'worldbook') {
          label = '世界书';
          color = 'cyan';
        } else if (record.metadata?.documentId) {
          label = '文件上传';
          color = 'purple';
        }
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: '分类/标签',
      key: 'categories',
      width: 200,
      render: (_, record) => (
        <Space wrap>
          {record.isLeaf ? (
            <>
              {record.category?.map(cat => (
                <Tag key={cat} color="blue">{cat}</Tag>
              ))}
              {record.tags?.map(tag => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </>
          ) : (
            <>
              {record.category?.map(cat => (
                <Tag key={cat} color="blue">{cat}</Tag>
              ))}
              {record.tags?.map(tag => (
                <Tag key={tag}>{tag}</Tag>
              ))}
              <Tag color="default">
                {record.metadata?.chunkCount || 0} 条
              </Tag>
              {record.metadata?.totalChars > 0 && (
                <>
                  <Text type="secondary">·</Text>
                  <Text type="secondary">{record.metadata.totalChars.toLocaleString()} 字符</Text>
                </>
              )}
              {record.metadata?.fileSize > 0 && (
                <>
                  <Text type="secondary">·</Text>
                  <Text type="secondary">{formatFileSize(record.metadata.fileSize)}</Text>
                </>
              )}
            </>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => {
        if (!record.isLeaf) {
          return (
            <Popconfirm
              title="确认删除整个文档"
              description="删除后该文档的所有向量数据和知识条目都将被删除，无法恢复"
              onConfirm={() => handleDeleteDocumentTree(record.id || record.documentId || '')}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除整个文档
              </Button>
            </Popconfirm>
          );
        }

        const isWorldBookItem = record.metadata?.isWorldBook === true || record.source === 'worldbook';
        const isDocumentItem = !!record.metadata?.documentId;
        const isReadOnly = isWorldBookItem || isDocumentItem;

        if (isReadOnly) {
          return (
            <Space size="small">
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
              onClick={() => handleViewItem(record as KnowledgeItem)}
            >
              查看
              </Button>
              <Popconfirm
                title="确认删除"
                description="确定要删除这个知识条目吗？"
                onConfirm={() => handleDeleteItem(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          );
        }

        return (
          <Space size="small">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record as KnowledgeItem)}
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              icon={<CloudUploadOutlined />}
              onClick={() => handleVectorize(record.id)}
            >
              向量化
            </Button>
            <Popconfirm
              title="确认删除"
              description="确定要删除这个知识条目吗？"
              onConfirm={() => handleDeleteItem(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const documentColumns: ColumnsType<ProcessedDocument> = [
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
  ];

  const tabItems = [
    {
      key: 'list',
      label: '知识列表',
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新建知识
              </Button>
              <Button icon={<CloudUploadOutlined />} onClick={handleVectorizeAll}>
                全部向量化
              </Button>
              <Button icon={<FolderOutlined />} onClick={loadTreeData} loading={treeLoading}>
                刷新
              </Button>
            </Space>
          </div>
          <Alert
            message="提示"
            description="点击文档行可展开查看该文档下的所有知识条目，点击「删除整个文档」将删除该文档及其所有数据"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            closable
          />
          <Table
            columns={treeColumns}
            dataSource={treeData}
            loading={treeLoading}
            size="small"
            scroll={{ y: 500 }}
            rowKey="key"
            expandable={{
              onExpand: handleExpand,
              defaultExpandAllRows: false,
              expandIconColumnIndex: 0,
            }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 个文档`,
              pageSizeOptions: ['10', '20', '50'],
            }}
          />
        </>
      )
    },
    {
      key: 'upload',
      label: (
        <span><FileTextOutlined /> 文档上传</span>
      ),
      children: (
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
              <Table
                columns={documentColumns}
                dataSource={processedDocuments}
                rowKey="documentId"
                pagination={{
                  pageSize: 10,
                  showSizeChanger: true,
                  showQuickJumper: true,
                  showTotal: (total) => `共 ${total} 条`,
                  pageSizeOptions: ['10', '20', '50'],
                }}
                size="small"
                rowSelection={{
                  selectedRowKeys: selectedDocKeys,
                  onChange: (keys) => setSelectedDocKeys(keys),
                }}
              />
            ) : (
              <Alert message="暂无已处理的文档" type="info" showIcon />
            )}
          </Card>
        </>
      )
    },
    {
      key: 'search',
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
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <VectorScopeSelector />
              
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>查询文本</label>
                  <TextArea
                    rows={3}
                    placeholder="输入您要查询的内容，系统将找到最相似的文本分块..."
                    value={vectorSearchQuery}
                    onChange={(e) => setVectorSearchQuery(e.target.value)}
                  />
                </div>
                <div style={{ width: 200 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>返回数量</label>
                  <Select
                    style={{ width: '100%' }}
                    value={vectorSearchTopK}
                    onChange={(val) => setVectorSearchTopK(val as number)}
                  >
                    <Option value={5}>Top 5</Option>
                    <Option value={10}>Top 10</Option>
                    <Option value={20}>Top 20</Option>
                  </Select>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={handleVectorSearch}
                    loading={vectorSearchLoading}
                    size="large"
                  >
                    执行查询
                  </Button>
                </div>
              </div>
            </Space>
          </Card>

          {vectorSearchResults.length > 0 && (
            <Card
              title={
                <Space>
                  <span>查询结果</span>
                  <Tag color="success">{vectorSearchResults.length} 条匹配</Tag>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Table
                columns={[
                  { title: '相似度', dataIndex: 'score', key: 'score', width: 100, render: (s: number) => `${(s * 100).toFixed(1)}%` },
                  { title: '来源', dataIndex: ['metadata', 'source'], key: 'source', width: 100 },
                  { title: '内容', dataIndex: ['metadata', 'text'], key: 'content', ellipsis: true },
                ]}
                dataSource={vectorSearchResults}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ y: 300 }}
              />
            </Card>
          )}

          {!vectorSearchLoading && vectorSearchResults.length === 0 && vectorSearchQuery.trim() && !vectorSearchError && (
            <Empty
              description="未找到匹配的文本分块，请尝试其他查询文本"
              style={{ marginBottom: 16 }}
            />
          )}

          <Card title="测试 2: 向量化测试">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>测试文本</label>
                <TextArea
                  rows={3}
                  placeholder="输入任意文本，查看其向量表示..."
                  value={vectorTestText}
                  onChange={(e) => setVectorTestText(e.target.value)}
                />
              </div>
              <Button
                type="primary"
                icon={<ExperimentOutlined />}
                onClick={handleVectorTest}
                loading={vectorTestLoading}
              >
                生成向量
              </Button>

              {vectorTestResult && (
                <Card title="向量信息" size="small">
                  <Descriptions bordered column={2} size="small">
                    <Descriptions.Item label="向量维度">{vectorTestResult.dimension}</Descriptions.Item>
                    <Descriptions.Item label="向量类型">Float32</Descriptions.Item>
                    <Descriptions.Item label="向量范围">
                      [{vectorTestResult.min.toFixed(6)}, {vectorTestResult.max.toFixed(6)}]
                    </Descriptions.Item>
                    <Descriptions.Item label="前 20 个分量" span={2}>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, maxHeight: 100, overflow: 'auto' }}>
                        [{vectorTestResult.first20.map(v => v.toFixed(6)).join(', ')}...]
                      </div>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              )}
            </Space>
          </Card>
        </>
      )
    }
  ];

  return (
    <Card title="知识库管理" size="small">
      <Tabs items={tabItems} />

      <Modal
        title={editingItem ? '编辑知识' : '新建知识'}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="知识条目标题" />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={8} placeholder="知识条目内容" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select mode="tags" placeholder="选择或输入分类">
              <Option value="角色信息">角色信息</Option>
              <Option value="关系">关系</Option>
              <Option value="事件">事件</Option>
              <Option value="地点">地点</Option>
              <Option value="物品">物品</Option>
              <Option value="设定">设定</Option>
            </Select>
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="选择或输入标签" />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Select>
              <Option value="manual">手动录入</Option>
              <Option value="memory_extract">记忆提取</Option>
              <Option value="import">导入</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {editingItem ? '更新' : '创建'}
              </Button>
              <Button onClick={() => setIsModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="查看知识条目"
        open={!!viewingItem}
        onCancel={() => setViewingItem(null)}
        footer={null}
        width={800}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        {viewingItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="条目名称">
              {viewingItem.metadata?.entryName || viewingItem.title || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="条目内容">
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', lineHeight: '1.6' }}>
                {viewingItem.metadata?.entryContent || viewingItem.metadata?.text || viewingItem.content || '-'}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="条目备注">
              {viewingItem.metadata?.entryComment || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="关键字">
              {viewingItem.metadata?.entryKey && viewingItem.metadata.entryKey.length > 0
                ? viewingItem.metadata.entryKey.join('、')
                : viewingItem.metadata?.entryKeys && viewingItem.metadata.entryKeys.length > 0
                  ? viewingItem.metadata.entryKeys.join('、')
                  : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="来源类型">
              {viewingItem.metadata?.sourceType || viewingItem.source || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="来源ID">
              {viewingItem.metadata?.sourceId || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="世界书路径">
              {viewingItem.metadata?.worldBookPath || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="世界书名称">
              {viewingItem.metadata?.worldBookName || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="块索引">
              {viewingItem.metadata?.chunkIndex ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="条目UID">
              {viewingItem.metadata?.entryUid || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="显示顺序">
              {viewingItem.metadata?.entryOrder ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="触发概率">
              {viewingItem.metadata?.entryProbability != null ? `${viewingItem.metadata.entryProbability}%` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="搜索深度">
              {viewingItem.metadata?.entryDepth ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="位置">
              {viewingItem.metadata?.entryPosition ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="显示索引">
              {viewingItem.metadata?.entryDisplayIndex ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="分组">
              {viewingItem.metadata?.entryGroup || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="条目属性">
              <Space direction="vertical" size={2}>
                {viewingItem.metadata?.isEntry && <Tag color="blue">核心条目</Tag>}
                {viewingItem.metadata?.entryConstant && <Tag color="orange">恒定</Tag>}
                {viewingItem.metadata?.entrySelective && <Tag color="green">选择性</Tag>}
                {viewingItem.metadata?.entryUseProbability && <Tag color="purple">使用概率</Tag>}
                {viewingItem.metadata?.entryAddMemo && <Tag color="cyan">添加备注</Tag>}
                {!viewingItem.metadata?.isEntry && !viewingItem.metadata?.entryConstant && 
                 !viewingItem.metadata?.entrySelective && !viewingItem.metadata?.entryUseProbability && 
                 !viewingItem.metadata?.entryAddMemo && <Text type="secondary">无</Text>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {viewingItem.metadata?.createdAt ? formatTime(viewingItem.metadata.createdAt) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {viewingItem.metadata?.updatedAt ? formatTime(viewingItem.metadata.updatedAt) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="向量ID">{viewingItem.id}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

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
            <div style={{ marginTop: 16, color: '#8c8c8c' }}>加载分块数据中...</div>
          </div>
        ) : docChunks.length > 0 ? (
          <Table
            columns={[
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
            ]}
            dataSource={docChunks}
            rowKey="index"
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          />
        ) : (
          <Alert message="暂无分块数据" description="请从文档列表点击「分片」按钮查看分块详情" type="info" showIcon />
        )}
      </Modal>
    </Card>
  );
};