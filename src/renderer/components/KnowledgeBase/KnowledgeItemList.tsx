/**
 * 知识列表面板 - 对应原 KnowledgeBaseManager 的 "知识列表" Tab。
 *
 * 同时整合了原任务描述中的「文档树面板」语义：本组件即文档树 + 知识条目树形表，
 * 二者在原 KnowledgeBaseManager 中本就合并在一个 Tab 中展示。
 *
 * 包含：
 * - 工具栏（新建知识、全部向量化、刷新）
 * - 文档/知识条目树形表（懒加载子节点、删除整树、查看/编辑/向量化/删除单项）
 * - 新建/编辑知识条目 Modal（Form）
 * - 查看知识条目详情 Modal（Descriptions）
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, Button, Input, Modal, Form, Select, Tag, Space,
  Popconfirm, message, Alert, Descriptions, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, CloudUploadOutlined,
  FileTextOutlined, EyeOutlined, FolderOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBaseStore';
import type { KnowledgeItem } from '../../types/knowledgeBase';
import {
  formatFileSize, formatTime,
  type TreeKnowledgeItem, type ProcessedDocument,
} from './shared';

const { TextArea } = Input;
const { Option } = Select;
const { Text } = Typography;

interface KnowledgeItemListProps {
  pageSize: number;
}

const KnowledgeItemList: React.FC<KnowledgeItemListProps> = ({ pageSize }) => {
  const {
    loading,
    createItem,
    updateItem,
    deleteItem,
    vectorizeItem,
    vectorizeAll,
    fetchItems,
  } = useKnowledgeBaseStore();

  // 创建/编辑/查看 Modal 状态
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [form] = Form.useForm();

  // 树形知识库状态
  const [treeData, setTreeData] = useState<TreeKnowledgeItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  // 记录已展开的文档 ID（用于单项删除后刷新对应树节点）
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());

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
        console.warn('[KnowledgeItemList] Failed to load scopes from registry:', error);
      }

      setTreeData(treeNodes);
    } catch (error) {
      console.error('加载树形数据失败:', error);
      setTreeData([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // 初次挂载：拉取知识条目 + 树形数据
  useEffect(() => {
    fetchItems();
    loadTreeData();
  }, [fetchItems, loadTreeData]);

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
      // 记录已展开的文档（用于单项删除后刷新）
      setExpandedDocIds(prev => {
        const next = new Set(prev);
        next.add(record.id || record.documentId || '');
        return next;
      });
    } else if (!expanded) {
      setExpandedDocIds(prev => {
        const next = new Set(prev);
        next.delete(record.id || record.documentId || '');
        return next;
      });
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

  // 树形表格列定义（useMemo 包裹避免每次渲染重建）
  const treeColumns: ColumnsType<TreeKnowledgeItem> = useMemo(
    () => [
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
    ],
    // 依赖 expandedDocIds 以便删除单项后能正确刷新当前展开节点
    [expandedDocIds]
  );

  return (
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
      <div className="table-container">
        <Table
          columns={treeColumns}
          dataSource={treeData}
          loading={treeLoading}
          size="small"
          bordered
          scroll={{ y: 500 }}
          rowKey="key"
          expandable={{
            onExpand: handleExpand,
            defaultExpandAllRows: false,
            expandIconColumnIndex: 0,
          }}
          pagination={{
            pageSize,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 个文档`,
            pageSizeOptions: ['10', '20', '50'],
            className: 'table-pagination-wrapper',
          }}
        />
      </div>

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
    </>
  );
};

export default KnowledgeItemList;
