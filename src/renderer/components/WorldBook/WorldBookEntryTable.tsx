import React, { memo, useMemo, useCallback } from 'react';
import { Modal, Input, Button, Space, Tag, Card, Pagination, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  TranslationOutlined,
  TagOutlined,
  SaveOutlined,
  SortAscendingOutlined,
  StopOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import type { UseWorldBookFormStateReturn } from './hooks/useWorldBookFormState';

/**
 * 世界书条目列表 + 排序 + 批量操作（Task 8 拆分产物 SubTask 8.4）。
 *
 * 从原 WorldBookManager.tsx 中迁出的"世界书详情"查看 Modal：
 *  - 顶部名称 / 主题编辑区
 *  - 全选 checkbox + 分组渲染的条目卡片（关键词 / 内容 / 标签 / 更多属性）
 *  - 分页 Pagination
 *  - 底部 modalFooter：保存 / 添加条目 / 批量删除 / AI 生成关键词 /
 *    一键翻译 / 一键润色 / 整理条目 / 标签管理 / 关闭
 *
 * 不引入 react-window 虚拟化（Task 22 的工作）。组件仅承担 UI 渲染，
 * 所有业务逻辑（删除 / 编辑 / 翻译 / 润色 / 排序 / 生成关键词）通过 props 注入。
 */
export interface WorldBookEntryTableProps {
  formState: UseWorldBookFormStateReturn;
  /** 当前查看的世界书（{ name, path, ... }） */
  viewingItem: any;
  /** 当前主题（dark/light），用于 className 切换 */
  appTheme: string;
  /** 写日志 */
  addLog: (msg: string, level?: string) => void;
  /** 单条目删除 */
  onDeleteEntry: (uid: number | string) => void | Promise<void>;
  /** 批量删除选中条目 */
  onDeleteSelectedEntries: () => void | Promise<void>;
  /** 编辑条目 */
  onEditEntry: (entry: any, uid: number | string) => void;
  /** 展开/收起条目更多属性 */
  onToggleExpand: (uid: number | string) => void;
  /** AI 单条目生成关键词 */
  onGenerateKeywordsForEntry: (uid: number | string) => void | Promise<void>;
  /** AI 批量生成关键词（一键） */
  onGenerateKeywordsAll: () => void | Promise<void>;
  /** 一键翻译选中条目 */
  onTranslateAll: () => void | Promise<void>;
  /** 一键润色选中条目 */
  onPolishAll: () => void;
  /** 一键审核选中条目 */
  onAuditAll: () => void;
  /** 中断 AI 请求 */
  onCancelAIRequest: () => void;
  /** 关闭 Modal 时额外清理（formState 中的状态本组件已处理） */
  onClose?: () => void;
  /** 打开添加条目 Modal */
  onOpenAddEntryModal: () => void;
  /** 打开整理条目 Modal（点击"整理条目"按钮；AI 排序进行中时调用 onCancelAIRequest 中断） */
  onOpenSortModal: () => void;
  /** 打开标签管理 Modal */
  onOpenTagManager: () => void;
  /** 编辑条目标签 */
  onEditEntryTags: (uid: number | string) => void;
}

const WorldBookEntryTable: React.FC<WorldBookEntryTableProps> = ({
  formState,
  viewingItem,
  appTheme,
  addLog,
  onDeleteEntry,
  onDeleteSelectedEntries,
  onEditEntry,
  onToggleExpand,
  onGenerateKeywordsForEntry,
  onGenerateKeywordsAll,
  onTranslateAll,
  onPolishAll,
  onAuditAll,
  onCancelAIRequest,
  onClose,
  onOpenAddEntryModal,
  onOpenSortModal,
  onOpenTagManager,
  onEditEntryTags,
}) => {
  const {
    isViewModalOpen,
    setIsViewModalOpen,
    viewingItem: fsViewingItem,
    setViewingItem,
    worldBookContent,
    setWorldBookContent,
    expandedEntries,
    selectedEntries,
    setSelectedEntries,
    tags,
    associations,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    isTranslatingAll,
    isPolishingAll,
    isAuditingAll,
    isAISorting,
    isGeneratingKeywordsAll,
    generatingKeywordsUid,
    setIsDescriptionModalOpen,
    setEditingDescriptionTemp,
  } = formState;

  // 实际使用的 viewingItem：优先使用 prop，回退到 formState 中的（兼容性）
  const actualViewingItem = viewingItem ?? fsViewingItem;

  // 名称 / 主题编辑回调
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setWorldBookContent((prev: any) => prev ? { ...prev, name: e.target.value } : null);
  }, [setWorldBookContent]);

  const handleEditTopic = useCallback(() => {
    setEditingDescriptionTemp(worldBookContent?.description || '');
    setIsDescriptionModalOpen(true);
  }, [setEditingDescriptionTemp, setIsDescriptionModalOpen, worldBookContent]);

  // 全选 / 取消全选
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked && worldBookContent?.entries) {
      const allUids = new Set<string | number>();
      Object.keys(worldBookContent.entries).forEach(key => {
        const entry = worldBookContent.entries[key];
        allUids.add(entry.uid || key);
      });
      setSelectedEntries(allUids);
    } else {
      setSelectedEntries(new Set());
    }
  }, [worldBookContent, setSelectedEntries]);

  // 单条目 checkbox 切换
  const handleToggleSelect = useCallback((uid: number | string, checked: boolean) => {
    const newSelected = new Set(selectedEntries);
    if (checked) {
      newSelected.add(uid);
    } else {
      newSelected.delete(uid);
    }
    setSelectedEntries(newSelected);
  }, [selectedEntries, setSelectedEntries]);

  // 关闭 Modal
  const handleClose = useCallback(() => {
    setIsViewModalOpen(false);
    setViewingItem(null);
    setWorldBookContent(null);
    setSelectedEntries(new Set());
    onClose?.();
  }, [setIsViewModalOpen, setViewingItem, setWorldBookContent, setSelectedEntries, onClose]);

  // 保存按钮
  const handleSave = useCallback(async () => {
    if (worldBookContent && actualViewingItem) {
      try {
        await window.electronAPI.worldBook.write(actualViewingItem.path, worldBookContent);
        addLog(`[WorldBook] 世界书保存成功: ${worldBookContent.name || actualViewingItem.name}`, 'info');
        message.success('保存成功');
      } catch (error) {
        addLog(`[WorldBook] 世界书保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        message.error('保存失败');
      }
    }
  }, [worldBookContent, actualViewingItem, addLog]);

  // 批量删除按钮
  const handleDeleteSelectedClick = useCallback(() => {
    if (selectedEntries.size > 0) {
      Modal.confirm({
        title: `确定要删除选中的 ${selectedEntries.size} 个条目吗？`,
        onOk: () => onDeleteSelectedEntries(),
        okText: '确定',
        cancelText: '取消'
      });
    } else {
      message.warning('请先选择要删除的条目');
    }
  }, [selectedEntries, onDeleteSelectedEntries]);

  // 单条目删除
  const handleDeleteEntryClick = useCallback((uid: number | string) => {
    Modal.confirm({
      title: '确定要删除这个条目吗？',
      onOk: () => onDeleteEntry(uid),
      okText: '确定',
      cancelText: '取消'
    });
  }, [onDeleteEntry]);

  // 整理条目按钮
  const handleOrganizeClick = useCallback(() => {
    if (isAISorting) {
      onCancelAIRequest();
    } else {
      onOpenSortModal();
    }
  }, [isAISorting, onCancelAIRequest, onOpenSortModal]);

  // modalFooter
  const modalFooter = useMemo(() => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'flex-end' }}>
      <Space>
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
        >
          保存
        </Button>
        <Button
          key="addEntry"
          type="primary"
          icon={<PlusOutlined />}
          onClick={onOpenAddEntryModal}
        >
          添加条目
        </Button>
        <Button
          key="deleteSelected"
          type="primary"
          danger
          icon={<DeleteOutlined />}
          onClick={handleDeleteSelectedClick}
          disabled={selectedEntries.size === 0}
          style={{ marginRight: 8 }}
        >
          批量删除
        </Button>
      </Space>
      <Space>
        <Button
          key="generateKeywordsAll"
          type="primary"
          icon={isGeneratingKeywordsAll ? <StopOutlined /> : <TagOutlined />}
          danger={isGeneratingKeywordsAll}
          onClick={isGeneratingKeywordsAll ? onCancelAIRequest : onGenerateKeywordsAll}
          disabled={!isGeneratingKeywordsAll && (isTranslatingAll || isPolishingAll || isAuditingAll)}
          style={{ marginRight: 8 }}
        >
          {isGeneratingKeywordsAll ? '中断生成' : 'AI生成关键词'}
        </Button>
        <Button
          key="translateAll"
          type="primary"
          icon={isTranslatingAll ? <StopOutlined /> : <TranslationOutlined />}
          danger={isTranslatingAll}
          onClick={isTranslatingAll ? onCancelAIRequest : onTranslateAll}
          disabled={!isTranslatingAll && (isPolishingAll || isGeneratingKeywordsAll || isAuditingAll || selectedEntries.size === 0)}
          style={{ marginRight: 8 }}
        >
          {isTranslatingAll ? '中断翻译' : `一键翻译选中条目 (${selectedEntries.size})`}
        </Button>
        <Button
          key="polishAll"
          type="primary"
          icon={isPolishingAll ? <StopOutlined /> : <EditOutlined />}
          danger={isPolishingAll}
          onClick={isPolishingAll ? onCancelAIRequest : onPolishAll}
          disabled={!isPolishingAll && (isTranslatingAll || isGeneratingKeywordsAll || isAuditingAll || selectedEntries.size === 0)}
          style={{ marginRight: 8 }}
        >
          {isPolishingAll ? '中断润色' : `一键润色选中条目 (${selectedEntries.size})`}
        </Button>
        <Button
          key="auditAll"
          type="primary"
          icon={isAuditingAll ? <StopOutlined /> : <SafetyCertificateOutlined />}
          danger={isAuditingAll}
          onClick={isAuditingAll ? onCancelAIRequest : onAuditAll}
          disabled={!isAuditingAll && (isTranslatingAll || isPolishingAll || isGeneratingKeywordsAll || selectedEntries.size === 0)}
          style={{ marginRight: 8 }}
        >
          {isAuditingAll ? '中断审核' : `一键审核选中条目 (${selectedEntries.size})`}
        </Button>
      </Space>
      <Space>
        <Button
          key="organizeEntries"
          type="primary"
          icon={isAISorting ? <StopOutlined /> : <SortAscendingOutlined />}
          danger={isAISorting}
          onClick={handleOrganizeClick}
          style={{ marginRight: 8 }}
        >
          {isAISorting ? '中断排序' : '整理条目'}
        </Button>
        <Button
          key="tagManager"
          type="primary"
          icon={<TagOutlined />}
          onClick={onOpenTagManager}
          style={{ marginRight: 8 }}
        >
          标签管理
        </Button>
      </Space>
      <Button key="close" onClick={handleClose}>
        关闭
      </Button>
    </div>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [
    worldBookContent, actualViewingItem, selectedEntries,
    isTranslatingAll, isPolishingAll, isAISorting, isGeneratingKeywordsAll, isAuditingAll,
    addLog, handleSave, handleDeleteSelectedClick, handleOrganizeClick,
    handleClose, onOpenAddEntryModal, onOpenTagManager, onCancelAIRequest,
    onGenerateKeywordsAll, onTranslateAll, onPolishAll, onAuditAll,
  ]);

  // entry 列表 + 分组渲染（保持与原实现完全一致的视觉与行为）
  const entryList = useMemo(() => {
    if (!worldBookContent || !worldBookContent.entries) return null;

    const entries = Object.values(worldBookContent.entries);
    const totalEntries = entries.length;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const currentPageEntries = entries.slice(startIndex, endIndex);

    // 为每个条目分配标签
    const entriesWithTags = currentPageEntries.map((entry: any, index: number) => {
      const uid = entry.uid !== undefined ? entry.uid : (startIndex + index);
      const entryTags = associations
        .filter((assoc: any) => assoc.entryUid === uid)
        .map((assoc: any) => tags.find((tag: any) => tag.id === assoc.tagId))
        .filter((tag: any): tag is any => tag !== undefined);
      return {
        ...entry,
        uid,
        tags: entryTags
      };
    });

    // 按标签分组
    const groupedEntries: Record<string, typeof entriesWithTags> = {};
    const processedEntries = new Set<number>();

    entriesWithTags.forEach(entry => {
      const uid = entry.uid;
      if (processedEntries.has(uid)) {
        return;
      }
      if (entry.tags && entry.tags.length > 0) {
        const firstTag = entry.tags[0];
        if (!groupedEntries[firstTag.id]) {
          groupedEntries[firstTag.id] = [];
        }
        groupedEntries[firstTag.id].push(entry);
      } else {
        if (!groupedEntries['无标签']) {
          groupedEntries['无标签'] = [];
        }
        groupedEntries['无标签'].push(entry);
      }
      processedEntries.add(uid);
    });

    return { sortedTagIds: Object.keys(groupedEntries), groupedEntries, totalEntries };
  }, [worldBookContent, associations, tags, currentPage, pageSize]);

  // 属性名映射（用于"更多属性"展开区域）
  const propertyNames: Record<string, string> = useMemo(() => ({
    'uid': 'ID',
    'key': '主要关键词',
    'keysecondary': '次要关键词',
    'comment': '注释',
    'content': '内容',
    'constant': '常量',
    'selective': '选择性',
    'order': '顺序',
    'position': '位置',
    'disable': '禁用',
    'displayIndex': '显示索引',
    'addMemo': '添加到记忆',
    'group': '组',
    'groupOverride': '组覆盖',
    'groupWeight': '组权重',
    'sticky': '粘性',
    'cooldown': '冷却',
    'delay': '延迟',
    'probability': '概率',
    'depth': '深度',
    'useProbability': '使用概率',
    'role': '角色',
    'excludeRecursion': '不可递归',
    'preventRecursion': '防止递归',
    'delayUntilRecursion': '延迟到递归',
    'scanDepth': '扫描深度',
    'caseSensitive': '区分大小写',
    'matchWholeWords': '完整单词',
    'useGroupScoring': '使用组评分',
    'automationId': '自动化ID'
  }), []);

  const getDisplayName = useCallback((propKey: string): string => {
    if (propertyNames[propKey]) {
      return propertyNames[propKey];
    }
    return propKey
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }, [propertyNames]);

  // 全选 checkbox indeterminate 状态由 ref 在渲染期间设置
  const selectAllCheckboxRef = useCallback((el: HTMLInputElement | null) => {
    if (el && worldBookContent?.entries) {
      const totalEntries = Object.keys(worldBookContent.entries).length;
      el.indeterminate = selectedEntries.size > 0 && selectedEntries.size < totalEntries;
    }
  }, [worldBookContent, selectedEntries]);

  return (
    <Modal
      title="世界书详情"
      open={isViewModalOpen}
      onCancel={handleClose}
      width="90vw"
      destroyOnClose={true}
      styles={{ body: { padding: '16px 24px', maxHeight: '75vh', overflowY: 'auto' } }}
      footer={modalFooter}
      style={{
        maxWidth: '1400px',
        backgroundColor: 'var(--bg-container, #1f1f1f)',
        color: 'var(--text-primary, #ffffff)'
      }}
      className={appTheme === 'dark' ? 'dark' : ''}
    >
      {/* 名称和主题编辑区域 */}
      <div style={{ marginBottom: 16 }}>
        <Input
          value={worldBookContent?.name || actualViewingItem?.name || ''}
          onChange={handleNameChange}
          style={{ marginBottom: 8, width: '100%' }}
          placeholder="世界书名称"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500, minWidth: 50 }}>主题：</span>
          <div style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-elevated, #2a2a2a)', border: '1px solid var(--border-base, #333)', borderRadius: 4, minHeight: 40 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary, #8c8c8c)' }}>
              {worldBookContent?.description || '暂无描述，点击编辑添加'}
            </span>
          </div>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={handleEditTopic}
          >
            编辑主题
          </Button>
        </div>
      </div>

      {worldBookContent && worldBookContent.entries && (
        <div style={{ backgroundColor: 'var(--bg-container, #1f1f1f)', color: 'var(--text-primary, #ffffff)' }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={Object.keys(worldBookContent.entries).length > 0 && selectedEntries.size === Object.keys(worldBookContent.entries).length}
              ref={selectAllCheckboxRef}
              onChange={(e) => handleSelectAll(e.target.checked)}
              style={{ transform: 'scale(1.2)' }}
            />
            <span style={{ fontWeight: 'bold' }}>全选</span>
            <span style={{ color: 'var(--text-primary, #ffffff)' }}>已选择 {selectedEntries.size} 个条目</span>
          </div>
          {entryList && entryList.sortedTagIds.map(tagId => {
            const tag = tags.find((t: any) => t.id === tagId);
            const tagName = tag ? tag.name : '无标签';
            const tagColor = tag ? tag.color : 'default';
            const groupEntries = entryList.groupedEntries[tagId];

            return (
              <div key={tagId} style={{ marginBottom: 24 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: '2px solid var(--border-base, #333)'
                }}>
                  <Tag color={tagColor} style={{ fontSize: 16, padding: '4px 12px', marginRight: 8 }}>{tagName}</Tag>
                  <span style={{ color: 'var(--text-secondary, #8c8c8c)', fontSize: 14 }}>共 {groupEntries.length} 个条目</span>
                </div>
                {groupEntries.map((entry: any) => {
                  const uid = entry.uid;
                  const isExpanded = expandedEntries.has(uid);

                  // 定义已显示的属性，排除这些属性后显示剩余的属性
                  const displayedProps = ['uid', 'key', 'keysecondary', 'comment', 'content', 'constant', 'selective', 'order', 'position', 'disable', 'displayIndex', 'addMemo', 'group', 'groupOverride', 'groupWeight', 'sticky', 'cooldown', 'delay', 'probability', 'depth', 'useProbability', 'role', 'excludeRecursion', 'preventRecursion', 'delayUntilRecursion', 'scanDepth', 'caseSensitive', 'matchWholeWords', 'useGroupScoring', 'automationId'];

                  // 计算未显示的属性
                  const additionalProps = Object.entries(entry).filter(([key]) => !displayedProps.includes(key));

                  return (
                    <Card key={uid} style={{ marginBottom: 16, border: '1px solid var(--border-base, #333)', backgroundColor: 'var(--bg-elevated, #2a2a2a)', color: 'var(--text-primary, #ffffff)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={selectedEntries.has(uid)}
                            onChange={(e) => handleToggleSelect(uid, e.target.checked)}
                            style={{ transform: 'scale(1.2)' }}
                          />
                          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 'bold' }}>条目 {entry.uid}: {entry.comment || '无注释'}</h3>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-primary, #ffffff)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <strong>关键词:</strong> <span style={{ color: 'var(--primary-color, #1890ff)' }}>{entry.key?.join(', ') || '无'}</span>
                          </div>
                          {generatingKeywordsUid === uid ? (
                            <Button
                              type="link"
                              size="small"
                              danger
                              icon={<StopOutlined />}
                              onClick={onCancelAIRequest}
                            >
                              中断
                            </Button>
                          ) : (
                            <Button
                              type="link"
                              size="small"
                              icon={<TagOutlined />}
                              onClick={() => onGenerateKeywordsForEntry(uid)}
                            >
                              AI生成关键词
                            </Button>
                          )}
                        </div>
                        {entry.keysecondary && entry.keysecondary.length > 0 && (
                          <p style={{ marginBottom: 8 }}>
                            <strong>次要关键词:</strong> <span style={{ color: 'var(--primary-color, #1890ff)' }}>{entry.keysecondary.join(', ')}</span>
                          </p>
                        )}
                        <p style={{ marginBottom: 8 }}>
                          <strong>内容:</strong>
                        </p>
                        <div style={{
                          padding: 12,
                          backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                          color: 'var(--text-primary, #ffffff)',
                          borderRadius: 4,
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                          maxHeight: '200px',
                          overflowY: 'auto'
                        }}>
                          {entry.content || '无'}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                          <Tag color="blue">顺序: {entry.order}</Tag>
                          <Tag color="green">概率: {entry.probability}%</Tag>
                          <Tag color="orange">深度: {entry.depth}</Tag>
                          <Tag color="cyan">位置: {entry.position}</Tag>
                          {entry.constant && <Tag color="red">常量</Tag>}
                          {entry.selective && <Tag color="purple">选择性</Tag>}
                          {entry.disable && <Tag color="gray">禁用</Tag>}
                          {entry.addMemo && <Tag color="geekblue">添加到记忆</Tag>}
                        </div>
                        <div style={{ marginTop: 8, marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontWeight: 'bold' }}>标签:</span>
                            <Button
                              type="link"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => onEditEntryTags(uid)}
                            >
                              编辑标签
                            </Button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {entry.tags && entry.tags.length > 0 ? (
                              entry.tags.map((tag: any) => (
                                <Tag key={tag.id} color={tag.color}>{tag.name}</Tag>
                              ))
                            ) : (
                              <Tag color="default">无标签</Tag>
                            )}
                          </div>
                        </div>
                        {additionalProps.length > 0 && (
                          <div style={{ marginTop: 12, borderTop: '1px solid var(--border-base, #333)', paddingTop: 12 }}>
                            <Button
                              type="link"
                              onClick={() => onToggleExpand(uid)}
                              style={{ padding: 0, height: 'auto' }}
                            >
                              {isExpanded ? '收起 ▲' : '更多 ▼'}
                            </Button>
                            {isExpanded && (
                              <div style={{
                                marginTop: 12,
                                padding: 16,
                                backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                                color: 'var(--text-primary, #ffffff)',
                                borderRadius: 4,
                                border: '1px solid var(--border-base, #333)'
                              }}>
                                <p style={{ marginBottom: 12, fontWeight: 'bold', color: 'var(--text-primary, #ffffff)', fontSize: 14 }}>更多属性:</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {additionalProps.map(([key, value]) => {
                                    const displayName = getDisplayName(key);
                                    return (
                                      <div key={key} style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        padding: '8px 12px',
                                        backgroundColor: 'var(--bg-elevated, #2a2a2a)',
                                        color: 'var(--text-primary, #ffffff)',
                                        borderRadius: 4,
                                        border: '1px solid var(--border-base, #333)'
                                      }}>
                                        <span style={{
                                          fontWeight: 'bold',
                                          color: 'var(--primary-color, #1890ff)',
                                          minWidth: 120,
                                          marginRight: 12,
                                          flexShrink: 0
                                        }}>{displayName}:</span>
                                        <span style={{
                                          color: 'var(--text-secondary, #8c8c8c)',
                                          wordBreak: 'break-all',
                                          fontFamily: 'monospace',
                                          fontSize: 13
                                        }}>{JSON.stringify(value)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ marginTop: 12, textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <Button
                            type="primary"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleDeleteEntryClick(uid)}
                            size="small"
                          >
                            删除条目
                          </Button>
                          <Button
                            type="primary"
                            icon={<EditOutlined />}
                            onClick={() => onEditEntry(entry, uid)}
                            size="small"
                          >
                            编辑条目
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            );
          })}

          {/* 分页控件 */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-base, #333)' }}>
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={Object.keys(worldBookContent.entries).length}
              showSizeChanger
              pageSizeOptions={['10', '20', '50', '100']}
              showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`}
              onChange={(page, size) => {
                setCurrentPage(page);
                if (size !== pageSize) {
                  setPageSize(size);
                }
              }}
              style={{ color: 'var(--text-primary, #ffffff)' }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default memo(WorldBookEntryTable);
