/**
 * 向量化知识库列表面板 - 对应原 KnowledgeBaseManager 的 "向量化知识库" Tab。
 *
 * 仅展示已完成向量化的文档（世界书、聊天记录、用户上传文档、手动知识等），
 * 数据源为向量注册表（vector.getAvailableScopes），未向量化的文档不会出现。
 *
 * 包含：
 * - 工具栏（新建知识、全部向量化、刷新）
 * - 已向量化文档/知识条目树形表（懒加载子节点、删除整树、查看/编辑/向量化/删除单项）
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
  FileTextOutlined, EyeOutlined, FolderOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBaseStore';
import type { KnowledgeItem } from '../../types/knowledgeBase';
import {
  formatFileSize, formatTime,
  type TreeKnowledgeItem,
} from './shared';

const { TextArea } = Input;
const { Option } = Select;
const { Text } = Typography;

interface KnowledgeItemListProps {
  pageSize: number;
}

// [perf] 知识库列表使用 antd Table，启用 antd v6 内置 virtual prop 实现虚拟滚动
//        （阈值 50 项以上场景），无需自定义 useVirtualizer。行内操作按钮已抽离为
//        React.memo 子组件（DocumentActions / LeafActions），避免列定义重建时所有
//        行重渲染。

interface DocumentActionsProps {
  record: TreeKnowledgeItem;
  vectorizing: boolean;
  onUpdate: (record: TreeKnowledgeItem) => void;
  onDelete: (id: string) => void;
}

/** 根节点（文档/世界书/聊天记录）行操作：更新 + 删除整个文档。 */
const DocumentActions = React.memo<DocumentActionsProps>(({ record, vectorizing, onUpdate, onDelete }) => (
  <Space size="small">
    <Button
      type="link"
      size="small"
      icon={<ReloadOutlined />}
      loading={vectorizing}
      onClick={() => onUpdate(record)}
    >
      更新
    </Button>
    <Popconfirm
      title="确认删除整个文档"
      description="删除后该文档的所有向量数据和知识条目都将被删除，无法恢复"
      onConfirm={() => onDelete(record.id || record.documentId || '')}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
    >
      <Button type="link" size="small" danger icon={<DeleteOutlined />}>
        删除整个文档
      </Button>
    </Popconfirm>
  </Space>
));

interface LeafActionsProps {
  record: TreeKnowledgeItem;
  onView: (record: KnowledgeItem) => void;
  onEdit: (item: KnowledgeItem) => void;
  onVectorize: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 叶子节点（知识条目）行操作：根据是否只读切换「查看」或「编辑/向量化」。 */
const LeafActions = React.memo<LeafActionsProps>(({ record, onView, onEdit, onVectorize, onDelete }) => {
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
          onClick={() => onView(record as KnowledgeItem)}
        >
          查看
        </Button>
        <Popconfirm
          title="确认删除"
          description="确定要删除这个知识条目吗？"
          onConfirm={() => onDelete(record.id)}
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
        onClick={() => onEdit(record as KnowledgeItem)}
      >
        编辑
      </Button>
      <Button
        type="link"
        size="small"
        icon={<CloudUploadOutlined />}
        onClick={() => onVectorize(record.id)}
      >
        向量化
      </Button>
      <Popconfirm
        title="确认删除"
        description="确定要删除这个知识条目吗？"
        onConfirm={() => onDelete(record.id)}
        okText="确定"
        cancelText="取消"
      >
        <Button type="link" size="small" danger icon={<DeleteOutlined />}>
          删除
        </Button>
      </Popconfirm>
    </Space>
  );
});

const KnowledgeItemList: React.FC<KnowledgeItemListProps> = ({ pageSize }) => {
  const {
    loading,
    createItem,
    updateItem,
    deleteItem,
    vectorizeItem,
    fetchItems,
  } = useKnowledgeBaseStore();
  // TODO(perf): 整体订阅，待拆分为 selector（6 字段，>5 暂缓）

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
  // 根节点多选状态（用于"全部向量化"按钮兼容选中操作）
  const [selectedRootKeys, setSelectedRootKeys] = useState<React.Key[]>([]);
  // 正在向量化的根节点 key 集合（用于按钮 loading 状态）
  const [vectorizingKeys, setVectorizingKeys] = useState<Set<string>>(new Set());
  // "全部向量化"按钮 loading 状态
  const [vectorizingAll, setVectorizingAll] = useState(false);
  // "全部删除"按钮 loading 状态
  const [deletingSelected, setDeletingSelected] = useState(false);

  // 加载树形数据 —— 以向量注册表（getAvailableScopes）为唯一数据源，仅展示已完成向量化的文档
  const loadTreeData = useCallback(async () => {
    setTreeLoading(true);
    try {
      const treeNodes: TreeKnowledgeItem[] = [];

      // 从向量注册表加载所有已向量化的 scope（世界书 / 角色卡聊天记录 / 知识库文档 / 手动知识）
      try {
        const scopesResult = await window.electronAPI.vector.getAvailableScopes();
        if (scopesResult.success && scopesResult.scopes) {
          for (const scope of scopesResult.scopes) {
            const sourceType: string = scope.sourceType;
            const scopeMeta = scope.metadata || {};
            const isWorldBook = sourceType === 'worldbook' || scopeMeta.isWorldBook === true;
            const isCharacterChat = sourceType === 'character_chat';

            if (isWorldBook) {
              // 世界书节点
              treeNodes.push({
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
                  processedAt: scopeMeta.processedAt || Date.now(),
                  isWorldBook: true,
                  scopeId: scope.id,
                  fileType: scopeMeta.fileType,
                },
                isLeaf: false,
                documentId: scope.sourceId,
                children: [],
              });
            } else if (isCharacterChat) {
              // 角色卡聊天记录节点
              treeNodes.push({
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
                  processedAt: scopeMeta.processedAt || Date.now(),
                  isWorldBook: false,
                  isCharacterChat: true,
                  scopeId: scope.id,
                },
                isLeaf: false,
                documentId: scope.sourceId,
                children: [],
              });
            } else {
              // 知识库文档 / 手动知识节点（sourceType: knowledge / manual_knowledge）
              const docId = scope.sourceId;
              treeNodes.push({
                key: `doc_${docId}`,
                id: docId,
                title: scope.sourceName || scopeMeta.fileName || docId,
                content: '',
                source: scopeMeta.fileType || sourceType,
                category: [],
                tags: [],
                relatedCharacterIds: [],
                relatedWorldBookPaths: [],
                metadata: {
                  fileSize: scopeMeta.fileSize || 0,
                  chunkCount: scope.vectorCount,
                  totalChars: scopeMeta.totalChars || 0,
                  processedAt: scopeMeta.processedAt || Date.now(),
                  isWorldBook: false,
                  isCharacterChat: false,
                  scopeId: scope.id,
                  fileType: scopeMeta.fileType,
                  sourceType,
                },
                isLeaf: false,
                documentId: docId,
                children: [],
              });
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
  const loadDocumentChildren = useCallback(async (
    docId: string,
    isWorldbook = false,
    isCharacterChat = false,
    sourceType?: string,
  ): Promise<TreeKnowledgeItem[]> => {
    try {
      if (isWorldbook) {
        const scopesResult = await window.electronAPI.vector.getAvailableScopes();
        if (scopesResult.success && scopesResult.scopes) {
          const scope = scopesResult.scopes.find(s => s.id === docId || s.sourceId === docId);
          if (scope && scope.metadata?.entryVectorIds) {
            // 逐条获取向量元数据以展示条目名称（entryName）
            const vectorItems = await Promise.all(
              scope.metadata.entryVectorIds.map(async (vectorId: string) => {
                try {
                  const result = await window.electronAPI.vector.getById(vectorId);
                  if (result.success && result.item) {
                    const item = result.item as any;
                    return {
                      key: `item_${vectorId}`,
                      id: vectorId,
                      title: item.metadata?.entryName || vectorId,
                      content: item.metadata?.text || '',
                      source: 'worldbook',
                      category: [],
                      tags: ['worldbook'],
                      relatedCharacterIds: [],
                      relatedWorldBookPaths: [],
                      metadata: {
                        isWorldBook: true,
                        entryVectorId: vectorId,
                        entryName: item.metadata?.entryName,
                        entryContent: item.metadata?.text,
                        entryComment: item.metadata?.entryComment,
                        entryKey: item.metadata?.entryKey,
                        entryKeys: item.metadata?.entryKeys,
                        entryUid: item.metadata?.entryUid,
                        entryOrder: item.metadata?.entryOrder,
                        sourceType: item.metadata?.sourceType,
                        worldBookPath: item.metadata?.worldBookPath,
                        worldBookName: item.metadata?.worldBookName,
                        chunkIndex: item.metadata?.chunkIndex,
                        isDescriptionChunk: item.metadata?.isDescriptionChunk,
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
        // 知识库文档 / 手动知识
        // manual_knowledge：sourceId 即知识条目 id，直接获取单条作为子节点
        if (sourceType === 'manual_knowledge') {
          try {
            const itemResult = await window.electronAPI.knowledge.get(docId);
            if (itemResult) {
              const item = itemResult as any;
              return [{
                ...item,
                key: `item_${item.id}`,
                isLeaf: true,
                metadata: {
                  ...item.metadata,
                  isWorldBook: false,
                },
              }];
            }
          } catch {
            return [];
          }
          return [];
        }
        // knowledge（文档上传）：通过 documentId 查询所有知识条目
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
  }, []);

  // 处理树形表格展开
  const handleExpand = useCallback(async (expanded: boolean, record: TreeKnowledgeItem) => {
    if (expanded && !record.isLeaf && (!record.children || record.children.length === 0)) {
      // 懒加载子节点
      const isWorldbook = record.metadata?.isWorldBook === true;
      const isCharacterChat = record.metadata?.isCharacterChat === true;
      const sourceType = record.metadata?.sourceType as string | undefined;
      const children = await loadDocumentChildren(record.id || record.documentId || '', isWorldbook, isCharacterChat, sourceType);
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
  }, [loadDocumentChildren]);

  // 删除整个文档（包括所有子条目）
  const handleDeleteDocumentTree = useCallback(async (docId: string) => {
    try {
      await window.electronAPI.document.delete(docId);
      message.success('文档及所有知识条目已删除');
      loadTreeData();
    } catch {
      message.error('删除失败');
    }
  }, [loadTreeData]);

  // 批量删除选中的根节点（含其所有向量数据与知识条目）
  const handleDeleteSelected = useCallback(async () => {
    if (selectedRootKeys.length === 0) return;
    setDeletingSelected(true);
    try {
      let successCount = 0;
      let failCount = 0;
      for (const key of selectedRootKeys) {
        const node = treeData.find(n => n.key === key);
        if (!node) continue;
        const docId = node.id || node.documentId || '';
        try {
          await window.electronAPI.document.delete(docId);
          successCount++;
        } catch {
          failCount++;
        }
      }
      if (failCount === 0) {
        message.success(`已删除 ${successCount} 个文档`);
      } else {
        message.warning(`已删除 ${successCount} 个文档，${failCount} 个删除失败`);
      }
      setSelectedRootKeys([]);
      loadTreeData();
    } catch (error) {
      console.error('[KnowledgeItemList] 批量删除失败:', error);
      message.error('批量删除失败');
    } finally {
      setDeletingSelected(false);
    }
  }, [selectedRootKeys, treeData, loadTreeData]);

  // 删除单个知识条目
  const handleDeleteItem = useCallback(async (id: string) => {
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
  }, [deleteItem, expandedDocIds, loadDocumentChildren]);

  const handleCreate = useCallback(() => {
    setEditingItem(null);
    form.resetFields();
    setIsModalVisible(true);
  }, [form]);

  const handleViewItem = useCallback(async (record: KnowledgeItem) => {
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
  }, []);

  const handleEdit = useCallback((item: KnowledgeItem) => {
    setEditingItem(item);
    form.setFieldsValue(item);
    setIsModalVisible(true);
  }, [form]);

  const handleVectorize = useCallback(async (id: string) => {
    const success = await vectorizeItem(id);
    if (success) {
      message.success('向量化成功');
    } else {
      message.error('向量化失败');
    }
  }, [vectorizeItem]);

  // 更新整个根节点：获取文档/世界书/聊天记录等的最新数据并重新向量化
  // silent=true 时不弹 message，返回处理的条目数（供"全部更新"批量调用汇总）
  const handleUpdateDocument = useCallback(async (record: TreeKnowledgeItem, silent = false): Promise<number> => {
    const nodeKey = record.key;
    setVectorizingKeys(prev => new Set(prev).add(nodeKey));
    try {
      const docId = record.id || record.documentId || '';
      const isWorldbook = record.metadata?.isWorldBook === true;
      const isCharacterChat = record.metadata?.isCharacterChat === true;
      const sourceType = record.metadata?.sourceType as string | undefined;
      let updatedCount = 0;

      if (isWorldbook) {
        // 世界书：通过 worldBook.list() 找到文件路径，调用 worldBook.vectorize 重新读取并向量化
        // 注意：世界书节点的 id 是 scope.id（注册表 ID），documentId 才是世界书名称（scope.sourceId）
        // worldBook.list() 返回的 name 是文件名（带 .json 后缀），需要去掉扩展名匹配
        const worldBookName = record.documentId || record.title || docId;
        try {
          const worldBooks = await window.electronAPI.worldBook.list();
          const target = worldBooks.find((wb: any) => {
            const wbNameWithoutExt = wb.name.replace(/\.(json|json5)$/i, '');
            return wbNameWithoutExt === worldBookName
              || wb.name === worldBookName
              || wb.path === worldBookName
              || wbNameWithoutExt === record.title;
          });
          if (target) {
            const result = await window.electronAPI.worldBook.vectorize(target.path);
            if (result.success) {
              updatedCount = result.entriesVectorized || 0;
            } else if (!silent) {
              message.error(`更新失败: ${result.error || '未知错误'}`);
            }
          } else if (!silent) {
            message.warning(`未找到世界书: ${worldBookName}`);
          }
        } catch (e) {
          console.error('[KnowledgeItemList] 更新世界书失败:', e);
          if (!silent) message.error('更新世界书失败');
        }
      } else if (isCharacterChat) {
        // 角色卡聊天记录：调用 memory.vectorizeCharacterChat 重新读取聊天记录并向量化
        try {
          const result = await window.electronAPI.memory.vectorizeCharacterChat(docId);
          if (result.success) {
            updatedCount = result.messagesVectorized || 0;
          } else if (!silent) {
            message.error(`更新失败: ${result.error || '未知错误'}`);
          }
        } catch (e) {
          console.error('[KnowledgeItemList] 更新聊天记录失败:', e);
          if (!silent) message.error('更新聊天记录失败');
        }
      } else if (sourceType === 'manual_knowledge') {
        // 手动知识：重新获取知识条目内容并向量化
        const success = await vectorizeItem(docId);
        updatedCount = success ? 1 : 0;
      } else {
        // 文档类型（knowledge）：通过 documentId 查出所有知识条目后逐条重新向量化
        const result = await window.electronAPI.knowledge.list({ documentId: docId }, 1, 1000);
        if (result.success && result.items) {
          for (const item of result.items) {
            const success = await vectorizeItem(item.id);
            if (success) updatedCount++;
          }
        }
      }

      if (!silent) {
        if (updatedCount > 0) {
          message.success(`已更新 ${updatedCount} 个条目`);
        } else {
          message.warning('未找到可更新的条目');
        }
      }
      // 更新后刷新树形数据（向量计数可能变化）
      loadTreeData();
      return updatedCount;
    } catch (error) {
      console.error('[KnowledgeItemList] 更新文档失败:', error);
      if (!silent) {
        message.error('更新失败');
      }
      return 0;
    } finally {
      setVectorizingKeys(prev => {
        const next = new Set(prev);
        next.delete(nodeKey);
        return next;
      });
    }
  }, [vectorizeItem, loadTreeData]);

  const handleUpdateAll = useCallback(async () => {
    setVectorizingAll(true);
    try {
      if (selectedRootKeys.length > 0) {
        // 有选中根节点时，仅更新选中的根节点
        let totalCount = 0;
        for (const key of selectedRootKeys) {
          const node = treeData.find(n => n.key === key);
          if (node) {
            const count = await handleUpdateDocument(node, true);
            totalCount += count;
          }
        }
        message.success(`已更新 ${totalCount} 个条目`);
      } else {
        // 无选中时，更新全部根节点
        let totalCount = 0;
        for (const node of treeData) {
          const count = await handleUpdateDocument(node, true);
          totalCount += count;
        }
        message.success(`已更新 ${totalCount} 个条目`);
      }
    } finally {
      setVectorizingAll(false);
    }
  }, [selectedRootKeys, treeData, handleUpdateDocument]);

  const handleSubmit = useCallback(async (values: any) => {
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
  }, [editingItem, updateItem, createItem]);

  // 树形表格列定义（useMemo 包裹避免每次渲染重建）
  const treeColumns: ColumnsType<TreeKnowledgeItem> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'title',
        key: 'title',
        width: 300,
        ellipsis: true,
        render: (text, record) => {
          // 叶子节点优先展示条目名称（entryName），与"查看知识条目"弹窗中的条目名称保持一致
          const displayName = record.isLeaf
            ? (record.metadata?.entryName || text)
            : text;
          return (
            <Space>
              {record.isLeaf ? <FileTextOutlined /> : <FolderOutlined style={{ color: '#1890ff' }} />}
              <span style={{ fontWeight: record.isLeaf ? 'normal' : 500 }}>{displayName}</span>
              {!record.isLeaf && (
                <Tag color="blue" style={{ marginLeft: 4 }}>
                  {record.metadata?.chunkCount || 0} 条
                </Tag>
              )}
            </Space>
          );
        },
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
        width: 260,
        render: (_, record) => {
          if (!record.isLeaf) {
            return (
              <DocumentActions
                record={record}
                vectorizing={vectorizingKeys.has(record.key)}
                onUpdate={handleUpdateDocument}
                onDelete={handleDeleteDocumentTree}
              />
            );
          }

          return (
            <LeafActions
              record={record}
              onView={handleViewItem}
              onEdit={handleEdit}
              onVectorize={handleVectorize}
              onDelete={handleDeleteItem}
            />
          );
        },
      },
    ],
    // 依赖 expandedDocIds 以便删除单项后能正确刷新当前展开节点；
    // 依赖 vectorizingKeys 以便根节点向量化按钮的 loading 状态实时更新；
    // 其余 handler 均已 useCallback 包裹（引用稳定），列入 deps 以满足 exhaustive-deps
    [
      expandedDocIds, vectorizingKeys,
      handleUpdateDocument, handleDeleteDocumentTree,
      handleViewItem, handleEdit, handleVectorize, handleDeleteItem,
    ]
  );

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建知识
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleUpdateAll}
            loading={vectorizingAll}
          >
            {selectedRootKeys.length > 0 ? `更新选中(${selectedRootKeys.length})` : '全部更新'}
          </Button>
          {selectedRootKeys.length > 0 && (
            <Popconfirm
              title="确认批量删除"
              description={`将删除选中的 ${selectedRootKeys.length} 个文档及其所有向量数据，无法恢复`}
              onConfirm={handleDeleteSelected}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />} loading={deletingSelected}>
                全部删除({selectedRootKeys.length})
              </Button>
            </Popconfirm>
          )}
          {selectedRootKeys.length > 0 && (
            <Button type="link" onClick={() => setSelectedRootKeys([])}>
              取消选择
            </Button>
          )}
          <Button icon={<FolderOutlined />} onClick={loadTreeData} loading={treeLoading}>
            刷新
          </Button>
        </Space>
      </div>
      <Alert
        message="提示"
        description="本列表仅展示已完成向量化的文档（世界书、聊天记录、用户上传文档等）。点击行可展开查看该文档下的所有知识条目，点击「删除整个文档」将删除该文档及其所有向量数据"
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
          // [perf] 启用 antd v6 Table 内置虚拟滚动（virtual prop），避免大量已向量化
          //        文档时全量渲染行。需配合 scroll.y（数值）与列宽固定，列宽合计 860px。
          virtual
          scroll={{ x: 860, y: 500 }}
          rowKey="key"
          rowSelection={{
            selectedRowKeys: selectedRootKeys,
            onChange: (selectedRowKeys: React.Key[]) => setSelectedRootKeys(selectedRowKeys),
            // 仅根节点可勾选，叶子节点禁用复选框
            getCheckboxProps: (record: TreeKnowledgeItem) => ({
              disabled: record.isLeaf,
            }),
          }}
          expandable={{
            onExpand: handleExpand,
            defaultExpandAllRows: false,
          }}
          pagination={{
            pageSize,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 个已向量化文档`,
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
