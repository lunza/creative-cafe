import { useState, useRef, useCallback } from 'react';
import { useWorldBookStore } from '../../../stores/worldBookStore';

/**
 * 世界书表单/界面状态管理 Hook（Task 8 拆分产物；Task 15.3 修订）。
 *
 * 将原 WorldBookManager.tsx 中散落的 30+ useState 收敛到一个独立 hook 中集中管理，
 * 避免巨型组件内状态声明交错混乱。状态语义与原实现完全一致，未做合并或 reducer 化，
 * 以保证行为不变；仅做物理拆分与分组返回，便于子组件按需消费。
 *
 * Task 15.3 状态去重：
 *  - tags / associations / worldBookDir 已在 worldBookStore 中持有完整副本
 *    （readTags / writeTags / getDirectory / setDirectory 等均会写入 store）。
 *  - 本 hook 此前又以 useState 维护同名副本，造成两端状态可能不一致。
 *  - 现已删除本地 useState 副本，改为直接订阅 store 字段；
 *    setter 则包装为与原签名兼容的形状（setTags 单参、setAssociations 单参、
 *    setWorldBookDir 单参同步），内部基于 store 最新值合并写入，避免中间态。
 *  - 对外返回对象形状完全不变，下游消费者（WorldBookManager / WorldBookEntryTable
 *    / WorldBookEntryEditor / WorldBookAIGenerateFlow / useWorldBookAIOperations）
 *    无需任何修改。
 *
 * 返回值按用途分组：
 *  - view:        查看世界书详情 Modal 相关状态
 *  - editEntry:   编辑条目 Modal 表单状态
 *  - aiFlags:     AI 操作的 loading / 中断标记
 *  - sort:        排序 / 主题描述相关状态
 *  - create:      新建世界书 Modal 相关状态
 *  - generate:    AI 生成世界书 Modal 相关状态
 *  - addEntry:    添加条目 Modal 相关状态
 *  - polish:      单字段 / 一键润色 Modal 相关状态
 *  - tag:         标签管理相关状态
 *  - pagination:  分页状态
 *  - dir:         世界书目录路径
 *  - isProcessingRef: 控制 AI 请求是否继续的 ref（用于中断）
 */
export function useWorldBookFormState() {
  // ===== 查看世界书详情 Modal =====
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<any>(null);
  const [worldBookContent, setWorldBookContent] = useState<any>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<number | string>>(new Set());
  const [selectedEntries, setSelectedEntries] = useState<Set<number | string>>(new Set());

  // ===== 编辑条目 Modal =====
  const [isEditEntryModalOpen, setIsEditEntryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editingEntryUid, setEditingEntryUid] = useState<number | string | null>(null);
  // 使用状态变量直接管理表单值
  const [formValues, setFormValues] = useState({
    comment: '',
    key: [] as string[],
    keysecondary: [] as string[],
    content: '',
    // SillyTavern 标准字段
    order: 0,
    probability: 100,
    depth: 0,
    position: 'after_char' as string,
    group: '',
    disable: false,
    constant: false,
    selective: false,
    useRegex: false,
    caseSensitive: false,
    // Creative-Cafe 独有字段
    automationId: '',
    scanDepth: 0,
    displayIndex: 0,
    matchWholeWords: false,
    useGroupScoring: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0
  });

  // ===== AI 操作 loading / 中断标记 =====
  // 跟踪正在翻译的字段
  const [translatingField, setTranslatingField] = useState<string | null>(null);
  // 跟踪是否正在一键翻译所有条目
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  // 跟踪正在润色的字段
  const [polishingField, setPolishingField] = useState<string | null>(null);
  // 跟踪是否正在一键润色所有条目
  const [isPolishingAll, setIsPolishingAll] = useState(false);
  // 跟踪是否正在AI排序条目
  const [isAISorting, setIsAISorting] = useState(false);
  // 跟踪是否正在AI生成关键词
  const [isGeneratingKeywordsAll, setIsGeneratingKeywordsAll] = useState(false);
  // 跟踪正在生成关键词的条目UID
  const [generatingKeywordsUid, setGeneratingKeywordsUid] = useState<string | number | null>(null);
  // 生成条目 loading
  const [isGeneratingEntries, setIsGeneratingEntries] = useState(false);
  const [isAddingEntry, setIsAddingEntry] = useState(false);
  const [isGeneratingFromChars, setIsGeneratingFromChars] = useState(false);

  // ===== 排序 / 主题描述相关 =====
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);
  const [isDragSortModalOpen, setIsDragSortModalOpen] = useState(false);
  const [selectedSortMethod, setSelectedSortMethod] = useState<string>('title');
  const [isDescriptionModalOpen, setIsDescriptionModalOpen] = useState(false);
  const [editingDescriptionTemp, setEditingDescriptionTemp] = useState('');

  // ===== 新建世界书 Modal =====
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [generatedEntries, setGeneratedEntries] = useState<any[]>([]);
  const [generatedWorldBookName, setGeneratedWorldBookName] = useState<string>('');
  const [generatedWorldBookDescription, setGeneratedWorldBookDescription] = useState<string>('');

  // ===== AI 生成世界书 Modal =====
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);

  // ===== 添加条目 Modal =====
  const [isAddEntryModalOpen, setIsAddEntryModalOpen] = useState(false);
  const [addedEntries, setAddedEntries] = useState<any[]>([]);

  // ===== 润色 Modal =====
  const [polishRequirements, setPolishRequirements] = useState<string>('');
  const [isPolishModalOpen, setIsPolishModalOpen] = useState<boolean>(false);
  const [currentPolishField, setCurrentPolishField] = useState<string | null>(null);
  const [currentPolishText, setCurrentPolishText] = useState<string>('');
  const [polishAllRequirements, setPolishAllRequirements] = useState<string>('');
  const [isPolishAllModalOpen, setIsPolishAllModalOpen] = useState<boolean>(false);

  // ===== 标签管理 =====
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isEditEntryTagsModalOpen, setIsEditEntryTagsModalOpen] = useState(false);
  const [currentEditEntryUid, setCurrentEditEntryUid] = useState<string | number | null>(null);
  // Task 15.3: tags / associations 直接订阅 worldBookStore（store 中已由 readTags /
  // writeTags 维护），消除本地 useState 副本。
  const tags = useWorldBookStore((s) => s.tags);
  const associations = useWorldBookStore((s) => s.associations);

  // ===== 分页 =====
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ===== 世界书目录路径 =====
  // Task 15.3: worldBookDir 直接订阅 worldBookStore（store 中已由 getDirectory /
  // setDirectory / setWorldBookDir 维护），消除本地 useState 副本。
  const worldBookDir = useWorldBookStore((s) => s.worldBookDir);

  // ===== Task 15.3: 兼容性 setter 包装 =====
  // 原本地 setter 签名为 setTags(tags) / setAssociations(assocs) / setWorldBookDir(dir)
  // （单参、同步）。store 的 setTags 为双参合并签名（tags + associations），且 worldBookDir
  // 在 store 中的 setter 为 setWorldBookDir（同步，不调 IPC）。
  // 这里包装为单参同步 setter，基于 store 最新值合并写入，保持外部调用点（WorldBookManager
  // 的 loadTags / useEffect）零修改。
  const storeSetTags = useWorldBookStore((s) => s.setTags);
  const storeSetWorldBookDir = useWorldBookStore((s) => s.setWorldBookDir);
  const setTags = useCallback(
    (newTags: any[]) => {
      // 读取 store 最新 associations，避免闭包陈旧值
      const currentAssociations = useWorldBookStore.getState().associations;
      storeSetTags(newTags, currentAssociations);
    },
    [storeSetTags],
  );
  const setAssociations = useCallback(
    (newAssociations: any[]) => {
      // 读取 store 最新 tags，避免闭包陈旧值
      const currentTags = useWorldBookStore.getState().tags;
      storeSetTags(currentTags, newAssociations);
    },
    [storeSetTags],
  );
  const setWorldBookDir = useCallback(
    (dir: string) => {
      storeSetWorldBookDir(dir);
    },
    [storeSetWorldBookDir],
  );

  // ===== AI 请求中断 ref =====
  // Ref to track if AI operation should be cancelled
  const isProcessingRef = useRef<boolean>(false);

  return {
    // 查看详情
    isViewModalOpen, setIsViewModalOpen,
    viewingItem, setViewingItem,
    worldBookContent, setWorldBookContent,
    expandedEntries, setExpandedEntries,
    selectedEntries, setSelectedEntries,

    // 编辑条目
    isEditEntryModalOpen, setIsEditEntryModalOpen,
    editingEntry, setEditingEntry,
    editingEntryUid, setEditingEntryUid,
    formValues, setFormValues,

    // AI loading
    translatingField, setTranslatingField,
    isTranslatingAll, setIsTranslatingAll,
    polishingField, setPolishingField,
    isPolishingAll, setIsPolishingAll,
    isAISorting, setIsAISorting,
    isGeneratingKeywordsAll, setIsGeneratingKeywordsAll,
    generatingKeywordsUid, setGeneratingKeywordsUid,
    isGeneratingEntries, setIsGeneratingEntries,
    isAddingEntry, setIsAddingEntry,
    isGeneratingFromChars, setIsGeneratingFromChars,

    // 排序 / 主题描述
    isSortModalOpen, setIsSortModalOpen,
    isDragSortModalOpen, setIsDragSortModalOpen,
    selectedSortMethod, setSelectedSortMethod,
    isDescriptionModalOpen, setIsDescriptionModalOpen,
    editingDescriptionTemp, setEditingDescriptionTemp,

    // 新建世界书
    isCreateModalOpen, setIsCreateModalOpen,
    generatedEntries, setGeneratedEntries,
    generatedWorldBookName, setGeneratedWorldBookName,
    generatedWorldBookDescription, setGeneratedWorldBookDescription,

    // AI 生成世界书
    isGenerateModalOpen, setIsGenerateModalOpen,

    // 添加条目
    isAddEntryModalOpen, setIsAddEntryModalOpen,
    addedEntries, setAddedEntries,

    // 润色
    polishRequirements, setPolishRequirements,
    isPolishModalOpen, setIsPolishModalOpen,
    currentPolishField, setCurrentPolishField,
    currentPolishText, setCurrentPolishText,
    polishAllRequirements, setPolishAllRequirements,
    isPolishAllModalOpen, setIsPolishAllModalOpen,

    // 标签
    isTagManagerOpen, setIsTagManagerOpen,
    isEditEntryTagsModalOpen, setIsEditEntryTagsModalOpen,
    currentEditEntryUid, setCurrentEditEntryUid,
    tags, setTags,
    associations, setAssociations,

    // 分页
    currentPage, setCurrentPage,
    pageSize, setPageSize,

    // 目录
    worldBookDir, setWorldBookDir,

    // AI 中断 ref
    isProcessingRef,
  };
}

export type UseWorldBookFormStateReturn = ReturnType<typeof useWorldBookFormState>;
