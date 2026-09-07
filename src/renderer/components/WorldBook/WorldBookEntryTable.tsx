import React, { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Tag, Card, Pagination, Select, message, Tooltip, Checkbox } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  TranslationOutlined,
  TagOutlined,
  TagsOutlined,
  SaveOutlined,
  SortAscendingOutlined,
  StopOutlined,
  SafetyCertificateOutlined,
  VerticalAlignTopOutlined
} from '@ant-design/icons';
import type { UseWorldBookFormStateReturn } from './hooks/useWorldBookFormState';
import './WorldBookEntryTable.css';

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

  // ==================== 滚动区 / 回到顶部 / 内容展开（spec: redesign-worldbook-detail-ui） ====================

  /** 自定义滚动容器 ref（Modal body 不再滚动，由 .wbet-scroll-area 承担） */
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  /** 是否显示「回到顶部」悬浮按钮 */
  const [showBackTop, setShowBackTop] = useState(false);

  // 监听滚动区滚动，超过一屏距离后显示回到顶部按钮
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () => setShowBackTop(el.scrollTop > 300);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isViewModalOpen]);

  const handleScrollToTop = useCallback(() => {
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /** 内容预览「展开全部/收起」状态（按条目 uid） */
  const [expandedContents, setExpandedContents] = useState<Set<number | string>>(new Set());

  const toggleContentExpand = useCallback((uid: number | string) => {
    setExpandedContents(prev => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }, []);

  /** 内容超过该长度时显示「展开全部/收起」切换（约等于 200px 预览高度） */
  const CONTENT_LONG_THRESHOLD = 400;

  // 名称 / 主题编辑回调
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setWorldBookContent((prev: any) => prev ? { ...prev, name: e.target.value } : null);
  }, [setWorldBookContent]);

  const handleEditTopic = useCallback(() => {
    setEditingDescriptionTemp(worldBookContent?.description || '');
    setIsDescriptionModalOpen(true);
  }, [setEditingDescriptionTemp, setIsDescriptionModalOpen, worldBookContent]);

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
    setExpandedContents(new Set());
    setShowBackTop(false);
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

  // ==================== 标签筛选（按标签多选筛选条目） ====================
  /** "无标签"伪标签值（与真实 tag.id 字符串空间隔离） */
  const UNTAGGED_FILTER = '__untagged__';
  /** 当前选中的筛选项（tag.id 集合或"无标签"伪值）；空数组 = 不筛选显示全部 */
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);

  /**
   * 筛选选项 = 全部本地标签 + "无标签"，均带条目计数。
   * 计数基于全量条目（不随筛选变化），便于用户判断各标签规模。
   */
  const tagFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let untaggedCount = 0;
    Object.values(worldBookContent?.entries || {}).forEach((entry: any, index: number) => {
      const uid = entry.uid !== undefined ? entry.uid : index;
      // 与下方 entryList 一致：String 化比较（entryUid 可能是 number 或 string，tagId 恒为 string）
      const entryTagIds = associations
        .filter((assoc: any) => String(assoc.entryUid) === String(uid))
        .map((assoc: any) => String(assoc.tagId));
      if (entryTagIds.length === 0) {
        untaggedCount++;
      } else {
        entryTagIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
      }
    });
    const options = tags
      .filter((tag: any) => (counts.get(String(tag.id)) || 0) > 0)
      .map((tag: any) => ({ value: String(tag.id), label: `${tag.name}（${counts.get(String(tag.id))}）` }));
    options.push({ value: UNTAGGED_FILTER, label: `无标签（${untaggedCount}）` });
    return options;
  }, [worldBookContent, associations, tags]);

  // entry 列表 + 分组渲染（保持与原实现完全一致的视觉与行为；新增标签筛选）
  const entryList = useMemo(() => {
    if (!worldBookContent || !worldBookContent.entries) return null;

    // 统一 uid（无 uid 条目以全局索引为回退——原实现用页内索引，翻页会漂移导致勾选错乱）
    const allEntries = Object.values(worldBookContent.entries).map((entry: any, index: number) => ({
      ...entry,
      uid: entry.uid !== undefined ? entry.uid : index,
    }));

    // 标签筛选：多选时"任一命中即显示"（OR 语义）。
    // 含"无标签"时同时放行无标签条目与命中标签的条目。
    const filteredEntries = selectedTagFilters.length === 0
      ? allEntries
      : allEntries.filter((entry: any) => {
          const entryTagIds = associations
            .filter((assoc: any) => String(assoc.entryUid) === String(entry.uid))
            .map((assoc: any) => String(assoc.tagId));
          const hasTagHit = entryTagIds.some(id => selectedTagFilters.includes(id));
          const wantsUntagged = selectedTagFilters.includes(UNTAGGED_FILTER);
          return hasTagHit || (wantsUntagged && entryTagIds.length === 0);
        });

    const totalEntries = filteredEntries.length;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const currentPageEntries = filteredEntries.slice(startIndex, endIndex);

    // 为每个条目分配标签
    const entriesWithTags = currentPageEntries.map((entry: any) => {
      const entryTags = associations
        .filter((assoc: any) => String(assoc.entryUid) === String(entry.uid))
        .map((assoc: any) => tags.find((tag: any) => String(tag.id) === String(assoc.tagId)))
        .filter((tag: any): tag is any => tag !== undefined);
      return {
        ...entry,
        tags: entryTags
      };
    });

    // 按标签分组
    const groupedEntries: Record<string, typeof entriesWithTags> = {};
    const processedEntries = new Set<number | string>();

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

    return { sortedTagIds: Object.keys(groupedEntries), groupedEntries, totalEntries, filteredUids: filteredEntries.map((e: any) => e.uid) as (number | string)[] };
  }, [worldBookContent, associations, tags, currentPage, pageSize, selectedTagFilters]);

  // 全选 / 取消全选：作用于"当前筛选可见"的条目（未筛选 = 全部）。
  // 定义在 entryList 之后以引用 filteredUids（依赖数组立即求值，前置声明会触发 TDZ）。
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked && entryList && entryList.filteredUids.length > 0) {
      setSelectedEntries(new Set(entryList.filteredUids));
    } else {
      setSelectedEntries(new Set());
    }
  }, [entryList, setSelectedEntries]);

  /** 可见条目是否全部选中（全选框 checked 判断，随筛选联动） */
  const allVisibleSelected = !!entryList &&
    entryList.filteredUids.length > 0 &&
    entryList.filteredUids.every(uid => selectedEntries.has(uid));

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

  // 全选 checkbox 半选态（基于可见条目，随筛选联动；antd Checkbox 原生 indeterminate prop）
  const selectAllIndeterminate = !!entryList &&
    selectedEntries.size > 0 && !allVisibleSelected &&
    entryList.filteredUids.some(uid => selectedEntries.has(uid));

  // modalFooter：精简为 保存（唯一 primary）+ 关闭 + 状态摘要（spec: redesign-worldbook-detail-ui）
  const modalFooter = useMemo(() => {
    const totalAll = worldBookContent?.entries ? Object.keys(worldBookContent.entries).length : 0;
    const totalFiltered = entryList?.totalEntries ?? totalAll;
    return (
      <div className="wbet-footer">
        <span className="wbet-footer-summary">
          共 <strong>{totalAll}</strong> 条
          {totalFiltered !== totalAll && (<> · 筛选后 <strong>{totalFiltered}</strong> 条</>)}
          {' '}· 已选 <strong>{selectedEntries.size}</strong>
        </span>
        <Button key="close" onClick={handleClose}>
          关闭
        </Button>
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
        >
          保存
        </Button>
      </div>
    );
  }, [worldBookContent, entryList, selectedEntries, handleSave, handleClose]);

  return (
    <Modal
      title="世界书详情"
      open={isViewModalOpen}
      onCancel={handleClose}
      width="90vw"
      destroyOnClose={true}
      styles={{ body: { padding: 0 } }}
      footer={modalFooter}
      style={{
        maxWidth: '1400px',
        backgroundColor: 'var(--bg-container, #1f1f1f)',
        color: 'var(--text-primary, #ffffff)'
      }}
      className={appTheme === 'dark' ? 'dark' : ''}
    >
      {/* 自定义滚动区：承载全部内容与粘性工具栏/分页；body 自身不滚动 */}
      <div className="wbet-scroll-area" ref={scrollAreaRef}>
        {/* ===== 顶部粘性工具栏（滚动时始终可见）===== */}
        <div className="wbet-toolbar">
          {/* 左区：全选 + 已选计数 */}
          <div className="wbet-toolbar-left">
            <label
              className="wbet-select-all"
              onClick={() => handleSelectAll(!allVisibleSelected)}
            >
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={selectAllIndeterminate}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleSelectAll(e.target.checked)}
              />
              全选
            </label>
            <span className="wbet-select-count">已选 <strong>{selectedEntries.size}</strong> 个条目</span>
          </div>

          <div className="wbet-toolbar-divider" />

          {/* 中区：批量操作组 */}
          <div className="wbet-toolbar-group">
            <Tooltip title={`翻译选中的 ${selectedEntries.size} 个条目（注释、关键词与内容）`}>
              <span>
                <Button
                  icon={isTranslatingAll ? <StopOutlined /> : <TranslationOutlined />}
                  danger={isTranslatingAll}
                  onClick={isTranslatingAll ? onCancelAIRequest : onTranslateAll}
                  disabled={!isTranslatingAll && (isPolishingAll || isGeneratingKeywordsAll || isAuditingAll || selectedEntries.size === 0)}
                >
                  {isTranslatingAll ? '中断翻译' : '翻译'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={`润色选中的 ${selectedEntries.size} 个条目的内容`}>
              <span>
                <Button
                  icon={isPolishingAll ? <StopOutlined /> : <EditOutlined />}
                  danger={isPolishingAll}
                  onClick={isPolishingAll ? onCancelAIRequest : onPolishAll}
                  disabled={!isPolishingAll && (isTranslatingAll || isGeneratingKeywordsAll || isAuditingAll || selectedEntries.size === 0)}
                >
                  {isPolishingAll ? '中断润色' : '润色'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={`审核选中的 ${selectedEntries.size} 个条目的内容`}>
              <span>
                <Button
                  icon={isAuditingAll ? <StopOutlined /> : <SafetyCertificateOutlined />}
                  danger={isAuditingAll}
                  onClick={isAuditingAll ? onCancelAIRequest : onAuditAll}
                  disabled={!isAuditingAll && (isTranslatingAll || isPolishingAll || isGeneratingKeywordsAll || selectedEntries.size === 0)}
                >
                  {isAuditingAll ? '中断审核' : '审核'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={`删除选中的 ${selectedEntries.size} 个条目（不可恢复）`}>
              <span>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteSelectedClick}
                  disabled={selectedEntries.size === 0}
                >
                  删除
                </Button>
              </span>
            </Tooltip>
          </div>

          <div className="wbet-toolbar-divider" />

          {/* 右区：管理组 */}
          <div className="wbet-toolbar-group wbet-toolbar-right">
            <Tooltip title="为全部条目 AI 生成关键词">
              <span>
                <Button
                  icon={isGeneratingKeywordsAll ? <StopOutlined /> : <TagOutlined />}
                  danger={isGeneratingKeywordsAll}
                  onClick={isGeneratingKeywordsAll ? onCancelAIRequest : onGenerateKeywordsAll}
                  disabled={!isGeneratingKeywordsAll && (isTranslatingAll || isPolishingAll || isAuditingAll)}
                >
                  {isGeneratingKeywordsAll ? '中断' : 'AI关键词'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="整理 / 排序条目（AI 排序进行中可中断）">
              <span>
                <Button
                  icon={isAISorting ? <StopOutlined /> : <SortAscendingOutlined />}
                  danger={isAISorting}
                  onClick={handleOrganizeClick}
                >
                  {isAISorting ? '中断' : '整理'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="管理世界书标签">
              <span>
                <Button icon={<TagsOutlined />} onClick={onOpenTagManager}>
                  标签
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="添加新条目">
              <span>
                <Button icon={<PlusOutlined />} onClick={onOpenAddEntryModal}>
                  添加
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>

        {/* 名称和主题编辑区域（非粘性） */}
        <div className="wbet-header">
          <Input
            value={worldBookContent?.name || actualViewingItem?.name || ''}
            onChange={handleNameChange}
            placeholder="世界书名称"
          />
          <div className="wbet-header-topic">
            <span className="wbet-header-topic-label">主题：</span>
            <div className="wbet-header-topic-text">
              {worldBookContent?.description || '暂无描述，点击编辑添加'}
            </div>
            <Button
              icon={<EditOutlined />}
              onClick={handleEditTopic}
            >
              编辑主题
            </Button>
          </div>
        </div>

      {worldBookContent && worldBookContent.entries && (
        <div>
          {/* 标签筛选（多选，OR 语义；筛选发生在分页之前，分页计数随之联动） */}
          <div className="wbet-filter-bar">
            <span className="wbet-filter-bar-label">按标签筛选：</span>
            <Select
              mode="multiple"
              allowClear
              placeholder="选择标签筛选条目（可多选，不选显示全部）"
              value={selectedTagFilters}
              onChange={(values) => {
                setSelectedTagFilters(values);
                // 筛选结果变少后当前页可能越界，统一回到第 1 页
                if (currentPage !== 1) {
                  setCurrentPage(1);
                }
              }}
              options={tagFilterOptions}
              style={{ minWidth: 320, flex: 1, maxWidth: 700 }}
              maxTagCount="responsive"
              size="middle"
            />
            {selectedTagFilters.length > 0 && (
              <span className="wbet-filter-count">
                筛选后 {entryList?.totalEntries ?? 0} / {Object.keys(worldBookContent.entries).length} 条
              </span>
            )}
          </div>
          {entryList && entryList.sortedTagIds.map(tagId => {
            const tag = tags.find((t: any) => t.id === tagId);
            const tagName = tag ? tag.name : '无标签';
            const tagColor = tag ? tag.color : 'default';
            const groupEntries = entryList.groupedEntries[tagId];

            return (
              <div key={tagId} className="wbet-group">
                <div className="wbet-group-header">
                  <Tag color={tagColor}>{tagName}</Tag>
                  <span className="wbet-group-count">共 {groupEntries.length} 个条目</span>
                </div>
                {groupEntries.map((entry: any) => {
                  const uid = entry.uid;
                  const isExpanded = expandedEntries.has(uid);
                  const contentExpanded = expandedContents.has(uid);
                  const contentIsLong = (entry.content || '').length > CONTENT_LONG_THRESHOLD;

                  // 定义已显示的属性，排除这些属性后显示剩余的属性
                  const displayedProps = ['uid', 'key', 'keysecondary', 'comment', 'content', 'constant', 'selective', 'order', 'position', 'disable', 'displayIndex', 'addMemo', 'group', 'groupOverride', 'groupWeight', 'sticky', 'cooldown', 'delay', 'probability', 'depth', 'useProbability', 'role', 'excludeRecursion', 'preventRecursion', 'delayUntilRecursion', 'scanDepth', 'caseSensitive', 'matchWholeWords', 'useGroupScoring', 'automationId'];

                  // 计算未显示的属性
                  const additionalProps = Object.entries(entry).filter(([key]) => !displayedProps.includes(key));

                  return (
                    <Card key={uid} className="wbet-card">
                      {/* 卡片头：复选框（点击区含标题）+ 右上角统一操作行 */}
                      <div className="wbet-card-header">
                        <label
                          className="wbet-card-title"
                          onClick={() => handleToggleSelect(uid, !selectedEntries.has(uid))}
                        >
                          <Checkbox
                            checked={selectedEntries.has(uid)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleToggleSelect(uid, e.target.checked)}
                          />
                          <h3>条目 {entry.uid}: {entry.comment || '无注释'}</h3>
                        </label>
                        <div className="wbet-card-actions">
                          <Tooltip title="编辑条目">
                            <Button
                              type="text"
                              icon={<EditOutlined />}
                              onClick={() => onEditEntry(entry, uid)}
                            />
                          </Tooltip>
                          {generatingKeywordsUid === uid ? (
                            <Tooltip title="中断关键词生成">
                              <Button
                                type="text"
                                className="wbet-btn-running"
                                icon={<StopOutlined />}
                                onClick={onCancelAIRequest}
                              />
                            </Tooltip>
                          ) : (
                            <Tooltip title="AI 生成关键词">
                              <Button
                                type="text"
                                icon={<TagOutlined />}
                                onClick={() => onGenerateKeywordsForEntry(uid)}
                              />
                            </Tooltip>
                          )}
                          <Tooltip title="编辑标签">
                            <Button
                              type="text"
                              icon={<TagsOutlined />}
                              onClick={() => onEditEntryTags(uid)}
                            />
                          </Tooltip>
                          <Tooltip title="删除条目">
                            <Button
                              type="text"
                              className="wbet-btn-danger"
                              icon={<DeleteOutlined />}
                              onClick={() => handleDeleteEntryClick(uid)}
                            />
                          </Tooltip>
                        </div>
                      </div>
                      <div className="wbet-card-body">
                        <div className="wbet-card-field">
                          <div className="wbet-card-field-key">
                            <strong>关键词:</strong> <span className="wbet-key-text">{entry.key?.join(', ') || '无'}</span>
                          </div>
                        </div>
                        {entry.keysecondary && entry.keysecondary.length > 0 && (
                          <p className="wbet-card-field-secondary">
                            <strong>次要关键词:</strong> <span className="wbet-key-text">{entry.keysecondary.join(', ')}</span>
                          </p>
                        )}
                        <p style={{ marginBottom: 8 }}>
                          <strong>内容:</strong>
                        </p>
                        <div className={`wbet-content-box${contentExpanded ? ' wbet-content-expanded' : ''}`}>
                          {entry.content || '无'}
                        </div>
                        {contentIsLong && (
                          <Button
                            type="link"
                            size="small"
                            className="wbet-content-toggle"
                            onClick={() => toggleContentExpand(uid)}
                          >
                            {contentExpanded ? '收起 ▲' : '展开全部 ▼'}
                          </Button>
                        )}
                        <div className="wbet-props-row">
                          <Tag color="blue">顺序: {entry.order}</Tag>
                          <Tag color="green">概率: {entry.probability}%</Tag>
                          <Tag color="orange">深度: {entry.depth}</Tag>
                          <Tag color="cyan">位置: {entry.position}</Tag>
                          {entry.constant && <Tag color="red">常量</Tag>}
                          {entry.selective && <Tag color="purple">选择性</Tag>}
                          {entry.disable && <Tag color="gray">禁用</Tag>}
                          {entry.addMemo && <Tag color="geekblue">添加到记忆</Tag>}
                        </div>
                        <div className="wbet-tags-row">
                          <div className="wbet-tags-header">
                            <span style={{ fontWeight: 'bold' }}>标签:</span>
                          </div>
                          <div className="wbet-tags-list">
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
                          <div className="wbet-more-props">
                            <Button
                              type="link"
                              onClick={() => onToggleExpand(uid)}
                              className="wbet-more-props-toggle"
                            >
                              {isExpanded ? '收起 ▲' : '更多 ▼'}
                            </Button>
                            {isExpanded && (
                              <div className="wbet-more-props-panel">
                                <p className="wbet-more-props-title">更多属性:</p>
                                <div className="wbet-more-props-list">
                                  {additionalProps.map(([key, value]) => {
                                    const displayName = getDisplayName(key);
                                    return (
                                      <div key={key} className="wbet-more-prop-item">
                                        <span className="wbet-more-prop-key">{displayName}:</span>
                                        <span className="wbet-more-prop-value">{JSON.stringify(value)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            );
          })}

          {/* 分页控件（total 用筛选后的数量，与列表渲染一致；粘性固定于滚动区底部） */}
          <div className="wbet-pagination-bar">
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={entryList?.totalEntries ?? Object.keys(worldBookContent.entries).length}
              showSizeChanger
              pageSizeOptions={['10', '20', '50', '100']}
              showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`}
              onChange={(page, size) => {
                setCurrentPage(page);
                if (size !== pageSize) {
                  setPageSize(size);
                }
              }}
            />
          </div>
        </div>
      )}
      </div>

      {/* 回到顶部悬浮按钮（absolute 定位于 Modal content 右下方，滚动超过一屏后出现） */}
      <div
        className={`wbet-back-top${showBackTop ? ' wbet-back-top-visible' : ''}`}
        onClick={handleScrollToTop}
        role="button"
        aria-label="回到顶部"
        title="回到顶部"
      >
        <VerticalAlignTopOutlined />
      </div>
    </Modal>
  );
};

export default memo(WorldBookEntryTable);
