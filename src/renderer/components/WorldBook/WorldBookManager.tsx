import React, { useEffect, useMemo, useCallback } from 'react';
import { Card, Table, Button, Space, Modal, Form, message, Popconfirm, Select, Tag } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  UploadOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import TagManager from './TagManager';
import { StoragePathDisplay } from '../Common/StoragePathDisplay';
// Task 8 拆分产物：排序 Modal 集合（条目整理 + 手动拖拽 + 编辑主题描述）
import WorldBookSortModal from './WorldBookSortModal';
// Task 8 拆分产物：润色 Modal 集合（单字段 + 一键润色）
import WorldBookPolishModal from './WorldBookPolishModal';
// Task 8 拆分产物：子组件
import WorldBookEntryTable from './WorldBookEntryTable';
import WorldBookEntryEditor from './WorldBookEntryEditor';
import WorldBookAIGenerateFlow from './WorldBookAIGenerateFlow';
// Task 8 拆分产物：表单状态 + AI 操作 hooks
import { useWorldBookFormState } from './hooks/useWorldBookFormState';
import { useWorldBookAIOperations } from './hooks/useWorldBookAIOperations';
import {
  standardizeWorldBookContent,
} from '../../utils/worldBookUtils';
import { useWorldBookStore } from '../../stores/worldBookStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import type { ColumnsType } from 'antd/es/table';
import '../../styles/list-common.css';
import './WorldBookManager.css';

interface WorldBook {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

/**
 * 世界书管理编排层（Task 8 拆分产物 SubTask 8.7）。
 *
 * 本组件已从原 5789 行瘦身至 < 500 行，仅保留：
 *  - 顶层状态编排（通过 useWorldBookFormState / useWorldBookAIOperations hooks）
 *  - 非 AI 的 UI handler（删除 / 查看 / 导入 / 向量化 / 标签读写 /
 *    手动排序 / 编辑条目表单提交等）
 *  - 主世界书列表 Table 渲染
 *  - 标签管理 Modal + 条目标签编辑 Modal（与 TagManager 子组件协同）
 *  - 子组件编排：WorldBookEntryTable / WorldBookEntryEditor /
 *    WorldBookAIGenerateFlow / WorldBookSortModal / WorldBookPolishModal
 *
 * 全部 AI 长函数（translate/polish/generate/handleGenerateNewEntries/
 * handleAISortEntries 等）已迁入 useWorldBookAIOperations hook；
 * 全部 30+ useState 已迁入 useWorldBookFormState hook。本组件不再持有
 * 任何 AI 函数或重复的 useState。
 */
const WorldBookManager: React.FC = () => {
  const { worldBooks, loading, fetchWorldBooks, clearCurrentWorldBook } = useWorldBookStore();
  const { theme: appTheme } = useUIStore();
  const { setting, fetchSetting } = useSettingStore();
  const { addLog } = useLogStore();

  // ===== Hook 接入：表单状态 + AI 操作 =====
  const formState = useWorldBookFormState();
  const [createForm] = Form.useForm();
  const [addEntryForm] = Form.useForm();

  // 适配 addLog 签名：useLogStore 的 addLog 接受 (message, type?, options?)，
  // 但子组件 / aiOps hook 期望 (msg, level?) => void。
  const adaptAddLog = useCallback((msg: string, level?: string) => {
    addLog(msg, level as any);
  }, [addLog]);

  const loadTags = useCallback(async (worldBookPath: string) => {
    try {
      const tagData = await window.electronAPI.worldBook.readTags(worldBookPath);
      if (tagData) {
        formState.setTags(tagData.tags || []);
        formState.setAssociations(tagData.associations || []);
      } else {
        formState.setTags([]);
        formState.setAssociations([]);
      }
    } catch (error) {
      addLog(`[WorldBook] 加载标签数据失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      formState.setTags([]);
      formState.setAssociations([]);
    }
  }, [addLog, formState]);

  const aiOps = useWorldBookAIOperations({
    formState,
    setting,
    addLog: adaptAddLog,
    fetchWorldBooks,
    createForm,
    addEntryForm,
    loadTags,
  });

  // 从 formState 解构编排层需要直接读取/写入的状态
  // 注：仅解构本编排层实际使用的状态变量；其余状态由子组件通过 formState 直接访问。
  const {
    setIsViewModalOpen,
    viewingItem, setViewingItem,
    worldBookContent, setWorldBookContent,
    expandedEntries,
    selectedEntries, setSelectedEntries,
    setIsEditEntryModalOpen,
    setEditingEntry,
    setEditingEntryUid,
    setFormValues,
    isDragSortModalOpen, setIsDragSortModalOpen,
    isTagManagerOpen, setIsTagManagerOpen,
    isEditEntryTagsModalOpen, setIsEditEntryTagsModalOpen,
    currentEditEntryUid, setCurrentEditEntryUid,
    tags, associations,
    isSortModalOpen, setIsSortModalOpen,
    selectedSortMethod, setSelectedSortMethod,
    isDescriptionModalOpen, setIsDescriptionModalOpen,
    editingDescriptionTemp, setEditingDescriptionTemp,
    worldBookDir, setWorldBookDir,
    setIsCreateModalOpen,
    setIsGenerateModalOpen,
    setIsAddEntryModalOpen,
    isProcessingRef,
    isPolishModalOpen, setIsPolishModalOpen,
    polishRequirements, setPolishRequirements,
    setCurrentPolishField,
    setCurrentPolishText,
    isPolishAllModalOpen, setIsPolishAllModalOpen,
    polishAllRequirements, setPolishAllRequirements,
    polishingField,
    isPolishingAll,
    setCurrentPage,
    pageSize, setPageSize,
  } = formState;

  // ===== 中断 AI 请求 =====
  // 注：preload.ts 已暴露 ai.cancel，但 electron.d.ts 类型声明未声明该方法，
  // 故此处仅通过 isProcessingRef 中断本地循环；实际 IPC 取消由各 AI 函数自行处理。
  const handleCancelAIRequest = useCallback(() => {
    isProcessingRef.current = false;
    message.info('已中断AI请求');
    addLog('[WorldBook] 用户主动中断AI请求', 'warn');
  }, [isProcessingRef, addLog]);

  // ===== 顶层 useEffect =====
  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  useEffect(() => {
    const getWorldBookDir = async () => {
      try {
        const dir = await window.electronAPI.worldBook.getDirectory();
        setWorldBookDir(dir);
      } catch (error) {
        addLog(`获取世界书目录失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    };
    getWorldBookDir();
  }, [addLog, setWorldBookDir]);

  useEffect(() => {
    fetchWorldBooks();
    return () => {
      clearCurrentWorldBook();
    };
  }, [fetchWorldBooks, clearCurrentWorldBook]);

  // ===== 顶层 UI handler =====
  const handleOpenFolder = useCallback(async () => {
    try {
      const folderPath = setting?.worldBookPath || '__USER_DATA__/data/worldbooks';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      await window.electronAPI.file.openFolder(resolvedPath);
    } catch (error) {
      message.error('打开文件夹失败');
    }
  }, [setting]);

  const handleCopyPath = useCallback(async () => {
    try {
      const folderPath = setting?.worldBookPath || '__USER_DATA__/data/worldbooks';
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      const resolvedPath = folderPath.replace('__USER_DATA__', userDataPath);
      await navigator.clipboard.writeText(resolvedPath);
      message.success('路径已复制到剪贴板');
    } catch (error) {
      message.error('复制路径失败');
    }
  }, [setting]);

  const handleDelete = useCallback(async (path: string) => {
    addLog(`[WorldBook] 删除世界书: ${path}`);
    try {
      await window.electronAPI.worldBook.delete(path);
      addLog(`[WorldBook] 删除成功: ${path}`, 'info');
      message.success('删除成功');
      fetchWorldBooks();
    } catch (error) {
      addLog(`[WorldBook] 删除失败: ${path}`, 'error');
      message.error('删除失败');
    }
  }, [addLog, fetchWorldBooks]);

  const handleVectorizeToWorldBook = useCallback(async (worldBook: WorldBook) => {
    addLog(`[WorldBook] 开始向量化世界书: ${worldBook.name}`);
    message.loading({ content: '正在处理世界书向量化...', key: 'vectorize', duration: 0 });

    try {
      const result = await window.electronAPI.worldBook.vectorize(worldBook.path);

      addLog(`[WorldBook] 向量化结果: ${result.success ? '成功' : '失败'}, 向量化条目: ${result.entriesVectorized || 0}, 失败条目: ${result.entriesFailed || 0}`, 'info');

      if (result.success) {
        addLog(`[WorldBook] 世界书向量化成功: ${worldBook.name}, 向量化条目: ${result.entriesVectorized}, 失败条目: ${result.entriesFailed}`, 'info');
        message.success({
          content: `世界书向量化成功：${result.entriesVectorized} 个条目已处理`,
          key: 'vectorize',
          duration: 3,
        });
      } else {
        addLog(`[WorldBook] 世界书向量化失败: ${worldBook.name}, 错误: ${result.error}`, 'error');
        message.error({
          content: `向量化失败：${result.error || '未知错误'}`,
          key: 'vectorize',
          duration: 3,
        });
      }
    } catch (error) {
      addLog(`[WorldBook] 世界书向量化异常: ${worldBook.name}, 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error({
        content: `向量化异常：${error instanceof Error ? error.message : '未知错误'}`,
        key: 'vectorize',
        duration: 3,
      });
    }
  }, [addLog]);

  const handleView = useCallback(async (record: WorldBook) => {
    addLog(`[WorldBook] 查看世界书: ${record.name}, 路径: ${record.path}`);
    try {
      const content = await window.electronAPI.worldBook.read(record.path);
      // 标准化世界书内容（使用 worldBookUtils.ts 中的统一实现）
      const standardizedContent = standardizeWorldBookContent(content);
      addLog(`[WorldBook] 读取世界书成功: ${record.name}, 条目数: ${standardizedContent?.entries ? Object.keys(standardizedContent.entries).length : 0}`, 'info');
      setWorldBookContent(standardizedContent);
      setViewingItem(record);
      formState.setExpandedEntries(new Set());
      setCurrentPage(1); // 重置页码到第一页
      setIsViewModalOpen(true);
      // 加载标签数据
      await loadTags(record.path);
    } catch (error) {
      addLog(`[WorldBook] 读取世界书失败: ${record.path}`, 'error');
      message.error('读取世界书失败');
    }
  }, [addLog, setWorldBookContent, setViewingItem, formState, setCurrentPage, setIsViewModalOpen, loadTags]);

  // 导入世界书
  const handleImportWorldBook = useCallback(async () => {
    addLog('[WorldBook] 开始导入世界书');
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async (e: Event) => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];

        if (!file) {
          message.error('请选择文件');
          return;
        }

        addLog(`[WorldBook] 选择文件: ${file.name}`);

        if (!file.name.endsWith('.json')) {
          message.error('请选择JSON格式的文件');
          return;
        }

        try {
          const content = await file.text();

          let worldBookData;
          try {
            worldBookData = JSON.parse(content);
          } catch (parseError) {
            addLog('[WorldBook] JSON解析失败', 'error');
            message.error('文件格式错误：无效的JSON文件');
            return;
          }

          if (!worldBookData || typeof worldBookData !== 'object') {
            message.error('文件格式错误：无效的世界书格式');
            return;
          }

          const worldBookDirPath = await window.electronAPI.worldBook.getDirectory();
          const targetPath = `${worldBookDirPath}/${file.name}`;

          addLog(`[WorldBook] 目标路径: ${targetPath}`);

          const existingWorldBooks = await window.electronAPI.worldBook.list();
          const existingFile = existingWorldBooks.find((wb: any) => wb.path === targetPath);

          if (existingFile) {
            addLog(`[WorldBook] 文件已存在，准备覆盖: ${file.name}`);
            Modal.confirm({
              title: '文件已存在',
              content: `世界书 "${file.name}" 已存在，是否覆盖？`,
              okText: '覆盖',
              cancelText: '取消',
              onOk: async () => {
                try {
                  const result = await window.electronAPI.worldBook.write(targetPath, worldBookData);
                  if (result.success) {
                    addLog(`[WorldBook] 覆盖导入成功: ${file.name}`, 'info');
                    message.success('导入成功');
                    fetchWorldBooks();
                  } else {
                    addLog(`[WorldBook] 覆盖导入失败: ${file.name}`, 'error');
                    message.error(`导入失败: ${result.error}`);
                  }
                } catch (writeError) {
                  addLog(`[WorldBook] 覆盖导入异常: ${file.name}`, 'error');
                  message.error('导入失败：写入文件时出错');
                }
              }
            });
          } else {
            addLog(`[WorldBook] 新文件导入: ${file.name}`);
            const result = await window.electronAPI.worldBook.write(targetPath, worldBookData);
            if (result.success) {
              addLog(`[WorldBook] 导入成功: ${file.name}`, 'info');
              message.success('导入成功');
              fetchWorldBooks();
            } else {
              addLog(`[WorldBook] 导入失败: ${file.name}`, 'error');
              message.error(`导入失败: ${result.error}`);
            }
          }
        } catch (error) {
          addLog('[WorldBook] 导入过程异常', 'error');
          message.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      };

      input.click();
    } catch (error) {
      addLog('[WorldBook] 导入初始化异常', 'error');
      message.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [addLog, fetchWorldBooks]);

  // ===== 编辑条目 Modal handler =====
  const handleEditEntry = useCallback((entry: any, uid: number | string) => {
    addLog(`[WorldBook] 打开条目编辑: UID=${uid}, Comment=${entry.comment || '无'}`);
    setEditingEntry(entry);
    setEditingEntryUid(uid);

    const formattedValues = {
      comment: entry.comment || '',
      key: Array.isArray(entry.key) ? entry.key : (entry.key ? [String(entry.key)] : []),
      keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : (entry.keysecondary ? [String(entry.keysecondary)] : []),
      content: entry.content || '',
      // SillyTavern 标准字段
      order: entry.order !== undefined ? entry.order : 0,
      probability: entry.probability !== undefined ? entry.probability : 100,
      depth: entry.depth !== undefined ? entry.depth : 0,
      position: entry.position || 'after_char',
      group: entry.group || '',
      disable: entry.disable || false,
      constant: entry.constant || false,
      selective: entry.selective || false,
      useRegex: entry.useRegex !== undefined ? entry.useRegex : (entry.use_regex || false),
      vectorized: entry.vectorized || false,
      caseSensitive: entry.caseSensitive !== undefined ? entry.caseSensitive : (entry.case_sensitive || false),
      // Creative-Cafe 独有字段
      automationId: entry.automationId || '',
      scanDepth: entry.scanDepth || 0,
      displayIndex: entry.displayIndex || 0,
      matchWholeWords: entry.matchWholeWords || false,
      useGroupScoring: entry.useGroupScoring || false,
      excludeRecursion: entry.excludeRecursion || false,
      preventRecursion: entry.preventRecursion || false,
      delayUntilRecursion: entry.delayUntilRecursion ? 1 : 0
    };

    setFormValues(formattedValues);
    setIsEditEntryModalOpen(true);
  }, [addLog, setEditingEntry, setEditingEntryUid, setFormValues, setIsEditEntryModalOpen]);

  // 注：原 handleEditEntryModalOk / handleEditEntryModalCancel 已迁入
  // WorldBookEntryEditor.tsx（编辑器组件内部维护 Modal 的 onOk/onCancel 逻辑），
  // 故本编排层不再需要这两个函数。

  // ===== 删除条目 handler =====
  const handleDeleteEntry = useCallback(async (uid: number | string) => {
    if (worldBookContent && worldBookContent.entries && viewingItem) {
      const newEntries = { ...worldBookContent.entries };
      Object.keys(newEntries).forEach(key => {
        if (newEntries[key].uid === uid || key === String(uid)) {
          delete newEntries[key];
        }
      });

      const updatedContent = {
        ...worldBookContent,
        entries: newEntries
      };

      setWorldBookContent(updatedContent);

      const newSelected = new Set(selectedEntries);
      newSelected.delete(uid);
      setSelectedEntries(newSelected);

      // 同步删除相关的标签信息
      try {
        const tagData = await window.electronAPI.worldBook.readTags(viewingItem.path);
        if (tagData && tagData.associations) {
          const updatedAssociations = tagData.associations.filter((assoc: any) => assoc.entryUid !== uid);
          const updatedTagData = {
            ...tagData,
            associations: updatedAssociations
          };
          await window.electronAPI.worldBook.writeTags(viewingItem.path, updatedTagData);
        }
      } catch (error) {
        addLog(`[WorldBook] 删除标签关联失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }

      message.success('条目删除成功');
    }
  }, [worldBookContent, viewingItem, setWorldBookContent, selectedEntries, setSelectedEntries, addLog]);

  const handleDeleteSelectedEntries = useCallback(async () => {
    if (worldBookContent && worldBookContent.entries && viewingItem) {
      const newEntries = { ...worldBookContent.entries };
      let deletedCount = 0;
      const deletedUids = new Set<string | number>();

      Object.keys(newEntries).forEach(key => {
        const entry = newEntries[key];
        if (selectedEntries.has(entry.uid) || selectedEntries.has(key)) {
          deletedUids.add(entry.uid || key);
          delete newEntries[key];
          deletedCount++;
        }
      });

      const updatedContent = {
        ...worldBookContent,
        entries: newEntries
      };

      setWorldBookContent(updatedContent);
      setSelectedEntries(new Set());

      // 立即保存到文件
      const worldBookData = {
        name: worldBookContent?.name || viewingItem?.name || '',
        description: worldBookContent?.description || '',
        entries: newEntries
      };

      const saveResult = await window.electronAPI.worldBook.write(viewingItem.path, worldBookData);

      if (!saveResult.success) {
        addLog(`[WorldBook] 保存删除后的世界书失败: ${saveResult.error}`, 'error');
        message.error('保存失败');
        return;
      }

      // 同步删除相关的标签信息
      try {
        const tagData = await window.electronAPI.worldBook.readTags(viewingItem.path);
        if (tagData && tagData.associations) {
          const updatedAssociations = tagData.associations.filter((assoc: any) => !deletedUids.has(assoc.entryUid));
          const updatedTagData = {
            ...tagData,
            associations: updatedAssociations
          };
          await window.electronAPI.worldBook.writeTags(viewingItem.path, updatedTagData);
        }
      } catch (error) {
        addLog(`[WorldBook] 删除标签关联失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }

      addLog(`[WorldBook] 成功删除 ${deletedCount} 个条目并保存到文件`, 'info');
      message.success(`成功删除 ${deletedCount} 个条目`);
    }
  }, [worldBookContent, viewingItem, selectedEntries, setWorldBookContent, setSelectedEntries, addLog]);

  // ===== 排序 handler =====
  const handleSortEntriesByTitle = useCallback(() => {
    if (worldBookContent && worldBookContent.entries) {
      const entriesArray = Object.entries(worldBookContent.entries).map(([key, entry]: any) => ({
        key,
        entry
      }));

      entriesArray.sort((a, b) => {
        const commentA = a.entry.comment || '';
        const commentB = b.entry.comment || '';
        return commentA.localeCompare(commentB);
      });

      const newEntries: any = {};
      entriesArray.forEach((item, index) => {
        newEntries[index] = {
          ...item.entry,
          uid: index
        };
      });

      const updatedContent = {
        ...worldBookContent,
        entries: newEntries
      };

      setWorldBookContent(updatedContent);
      message.success('条目已按标题排序');
    }
  }, [worldBookContent, setWorldBookContent]);

  const handleMoveEntry = useCallback((index: number, direction: number) => {
    if (worldBookContent && worldBookContent.entries) {
      const entriesArray = Object.entries(worldBookContent.entries).map(([key, entry]: any) => ({
        key,
        entry
      }));

      entriesArray.sort((a, b) => (a.entry.order || 0) - (b.entry.order || 0));

      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= entriesArray.length) {
        return;
      }

      [entriesArray[index], entriesArray[newIndex]] = [entriesArray[newIndex], entriesArray[index]];

      const newEntries: any = {};
      entriesArray.forEach((item, idx) => {
        newEntries[item.key] = {
          ...item.entry,
          order: idx
        };
      });

      const updatedContent = {
        ...worldBookContent,
        entries: newEntries
      };

      setWorldBookContent(updatedContent);
    }
  }, [worldBookContent, setWorldBookContent]);

  const handleSaveManualSort = useCallback(() => {
    if (worldBookContent && worldBookContent.entries) {
      const entriesArray = Object.entries(worldBookContent.entries).map(([key, entry]: any) => ({
        key,
        entry
      }));

      entriesArray.sort((a, b) => (a.entry.order || 0) - (b.entry.order || 0));

      const newEntries: any = {};
      entriesArray.forEach((item, index) => {
        newEntries[index] = {
          ...item.entry,
          uid: index,
          order: index
        };
      });

      const updatedContent = {
        ...worldBookContent,
        entries: newEntries
      };

      setWorldBookContent(updatedContent);
      setIsDragSortModalOpen(false);
      message.success('排序保存成功');
    }
  }, [worldBookContent, setWorldBookContent, setIsDragSortModalOpen]);

  const handleToggleExpand = useCallback((uid: number | string) => {
    const newExpandedEntries = new Set(expandedEntries);
    if (newExpandedEntries.has(uid)) {
      newExpandedEntries.delete(uid);
    } else {
      newExpandedEntries.add(uid);
    }
    formState.setExpandedEntries(newExpandedEntries);
  }, [expandedEntries, formState]);

  // 编辑条目标签
  const handleEditEntryTags = useCallback((uid: number | string) => {
    setIsEditEntryTagsModalOpen(true);
    setCurrentEditEntryUid(uid);
  }, [setIsEditEntryTagsModalOpen, setCurrentEditEntryUid]);

  // 打开添加条目 Modal
  const handleOpenAddEntryModal = useCallback(() => {
    setIsAddEntryModalOpen(true);
  }, [setIsAddEntryModalOpen]);

  // 打开整理条目 Modal
  const handleOpenSortModal = useCallback(() => {
    setSelectedSortMethod('title');
    setIsSortModalOpen(true);
  }, [setSelectedSortMethod, setIsSortModalOpen]);

  // 打开标签管理 Modal
  const handleOpenTagManager = useCallback(() => {
    setIsTagManagerOpen(true);
  }, [setIsTagManagerOpen]);

  // ===== 主世界书列表 Table 列定义 =====
  const columns: ColumnsType<WorldBook> = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (text, record) => (
        <a href="#" onClick={(e) => {
          e.preventDefault();
          handleView(record);
        }} style={{ color: '#1890ff' }}>
          {text}
        </a>
      )
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => `${(size / 1024).toFixed(2)} KB`,
      sorter: (a, b) => a.size - b.size
    },
    {
      title: '修改时间',
      dataIndex: 'modified',
      key: 'modified',
      render: (date: Date) => new Date(date).toLocaleString(),
      sorter: (a, b) => new Date(a.modified).getTime() - new Date(b.modified).getTime()
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right' as const,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<CloudUploadOutlined />}
            title="将世界书内容向量化并集成到知识库"
            onClick={() => handleVectorizeToWorldBook(record)}
          >
            向量化
          </Button>
          <Popconfirm
            title="确定要删除这个世界书吗？"
            onConfirm={() => handleDelete(record.path)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ], [handleView, handleVectorizeToWorldBook, handleDelete]);

  return (
    <div className={`worldbook-manager ${appTheme === 'dark' ? 'dark' : ''}`}>
      <div className="worldbook-header list-header">
        <h2>世界书管理</h2>
        <StoragePathDisplay
          label="世界书存储路径"
          path={worldBookDir}
          onOpenFolder={handleOpenFolder}
          onCopyPath={handleCopyPath}
        />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchWorldBooks}>
            刷新
          </Button>
          <Button icon={<UploadOutlined />} onClick={handleImportWorldBook}>
            导入世界书
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateModalOpen(true)}>
            新建世界书
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => setIsGenerateModalOpen(true)}>
            AI生成世界书
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={worldBooks}
          rowKey="path"
          loading={loading}
          virtual
          pagination={{
            pageSize,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (_page, size) => { setPageSize(size); },
          }}
          scroll={{ y: 500 }}
        />
      </Card>

      {/* 世界书详情 Modal：条目列表 + 排序 + 批量操作（SubTask 8.4） */}
      <WorldBookEntryTable
        formState={formState}
        viewingItem={viewingItem}
        appTheme={appTheme}
        addLog={adaptAddLog}
        onDeleteEntry={handleDeleteEntry}
        onDeleteSelectedEntries={handleDeleteSelectedEntries}
        onEditEntry={handleEditEntry}
        onToggleExpand={handleToggleExpand}
        onGenerateKeywordsForEntry={aiOps.handleGenerateKeywordsForEntry}
        onGenerateKeywordsAll={aiOps.handleGenerateKeywordsAll}
        onTranslateAll={aiOps.handleTranslateAll}
        onPolishAll={aiOps.handlePolishAll}
        onCancelAIRequest={handleCancelAIRequest}
        onOpenAddEntryModal={handleOpenAddEntryModal}
        onOpenSortModal={handleOpenSortModal}
        onOpenTagManager={handleOpenTagManager}
        onEditEntryTags={handleEditEntryTags}
      />

      {/* 编辑条目 Modal（SubTask 8.2）：onOk/onCancel 由编辑器内部维护 */}
      <WorldBookEntryEditor
        formState={formState}
        onTranslate={aiOps.handleTranslate}
        onPolish={aiOps.handlePolish}
        onCancelAIRequest={handleCancelAIRequest}
        addLog={adaptAddLog}
      />

      {/* AI 生成全流程：新建 + 添加条目 + AI 生成（SubTask 8.3） */}
      <WorldBookAIGenerateFlow
        formState={formState}
        createForm={createForm}
        addEntryForm={addEntryForm}
        onCreateWorldBook={aiOps.handleCreateWorldBook}
        onTemplateGenerateEntries={aiOps.handleTemplateGenerateEntries}
        onExpandKeywords={aiOps.handleExpandKeywords}
        onGenerateDescription={aiOps.handleGenerateDescription}
        onGenerateNewEntries={aiOps.handleGenerateNewEntries}
        onSaveAddedEntries={aiOps.handleSaveAddedEntries}
        onCreateFromAI={aiOps.handleCreateFromAI}
        onGenerateFromCharacters={aiOps.handleGenerateFromCharacters}
      />

      {/* 排序 Modal 集合（条目整理 + 手动拖拽 + 编辑主题描述） */}
      <WorldBookSortModal
        isSortModalOpen={isSortModalOpen}
        setIsSortModalOpen={setIsSortModalOpen}
        selectedSortMethod={selectedSortMethod}
        setSelectedSortMethod={setSelectedSortMethod}
        onSortByTitle={handleSortEntriesByTitle}
        onAISort={aiOps.handleAISortEntries}
        isDragSortModalOpen={isDragSortModalOpen}
        setIsDragSortModalOpen={setIsDragSortModalOpen}
        worldBookContent={worldBookContent}
        onMoveEntry={handleMoveEntry}
        onSaveManualSort={handleSaveManualSort}
        isDescriptionModalOpen={isDescriptionModalOpen}
        setIsDescriptionModalOpen={setIsDescriptionModalOpen}
        editingDescriptionTemp={editingDescriptionTemp}
        setEditingDescriptionTemp={setEditingDescriptionTemp}
        setWorldBookContent={setWorldBookContent}
        appTheme={appTheme}
        addLog={addLog}
      />

      {/* 润色 Modal 集合（单字段 + 一键润色） */}
      <WorldBookPolishModal
        isPolishModalOpen={isPolishModalOpen}
        setIsPolishModalOpen={setIsPolishModalOpen}
        polishingField={polishingField}
        polishRequirements={polishRequirements}
        setPolishRequirements={setPolishRequirements}
        setCurrentPolishField={setCurrentPolishField}
        setCurrentPolishText={setCurrentPolishText}
        performPolish={aiOps.performPolish}
        isPolishAllModalOpen={isPolishAllModalOpen}
        setIsPolishAllModalOpen={setIsPolishAllModalOpen}
        isPolishingAll={isPolishingAll}
        polishAllRequirements={polishAllRequirements}
        setPolishAllRequirements={setPolishAllRequirements}
        performPolishAll={aiOps.performPolishAll}
        onCancelAIRequest={handleCancelAIRequest}
      />

      {/* 标签管理 Modal */}
      <Modal
        title="标签管理"
        open={isTagManagerOpen}
        onCancel={() => setIsTagManagerOpen(false)}
        width={800}
        getContainer={() => document.body}
        zIndex={3000}
        maskStyle={{ zIndex: 3000 }}
        footer={[
          <Button key="close" onClick={() => setIsTagManagerOpen(false)}>
            关闭
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)',
          zIndex: 2000
        }}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          {viewingItem && worldBookContent && (
            <TagManager
              worldBookPath={viewingItem.path}
              worldBookEntries={worldBookContent.entries}
              onTagsChanged={() => loadTags(viewingItem.path)}
            />
          )}
        </div>
      </Modal>

      {/* 条目标签编辑 Modal */}
      <Modal
        title="编辑条目标签"
        open={isEditEntryTagsModalOpen}
        onCancel={() => setIsEditEntryTagsModalOpen(false)}
        width={600}
        getContainer={() => document.body}
        zIndex={3000}
        maskStyle={{ zIndex: 3000 }}
        footer={[
          <Button key="close" onClick={() => setIsEditEntryTagsModalOpen(false)}>
            关闭
          </Button>
        ]}
        style={{
          backgroundColor: 'var(--bg-container, #1f1f1f)',
          color: 'var(--text-primary, #ffffff)',
          zIndex: 2000
        }}
      >
        <div style={{ color: 'var(--text-primary, #ffffff)' }}>
          {currentEditEntryUid !== null && worldBookContent && (
            <div>
              {(() => {
                const entry: any = Object.values(worldBookContent.entries).find(
                  (e: any) => e.uid === currentEditEntryUid || String(e.uid) === String(currentEditEntryUid)
                );

                if (!entry) {
                  return <div>条目未找到</div>;
                }

                const entryTags = associations
                  .filter((assoc: any) => assoc.entryUid === currentEditEntryUid)
                  .map((assoc: any) => tags.find((tag: any) => tag.id === assoc.tagId))
                  .filter((tag: any): tag is any => tag !== undefined);

                return (
                  <div>
                    <div style={{ marginBottom: 16 }}>
                      <h3 style={{ marginBottom: 8 }}>条目: {entry.comment || '无注释'}</h3>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ marginBottom: 8, fontWeight: 'bold' }}>当前标签:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                        {entryTags.length > 0 ? (
                          entryTags.map(tag => (
                            <Tag
                              key={tag.id}
                              color={tag.color}
                              closable
                              onClose={async () => {
                                try {
                                  const tagData = await window.electronAPI.worldBook.readTags(viewingItem!.path);
                                  if (tagData && tagData.associations) {
                                    const updatedAssociations = tagData.associations.filter(
                                      (assoc: any) => !(assoc.entryUid === currentEditEntryUid && assoc.tagId === tag.id)
                                    );
                                    const updatedTagData = {
                                      ...tagData,
                                      associations: updatedAssociations
                                    };
                                    await window.electronAPI.worldBook.writeTags(viewingItem!.path, updatedTagData);
                                    await loadTags(viewingItem!.path);
                                    message.success('标签移除成功');
                                  }
                                } catch (error) {
                                  message.error('标签移除失败');
                                }
                              }}
                            >
                              {tag.name}
                            </Tag>
                          ))
                        ) : (
                          <Tag color="default">无标签</Tag>
                        )}
                      </div>
                    </div>

                    <div>
                      <div style={{ marginBottom: 8, fontWeight: 'bold' }}>添加标签:</div>
                      <Select
                        mode="multiple"
                        placeholder="选择要添加的标签..."
                        style={{ width: '100%' }}
                        value={[]}
                        onChange={async (selectedTagIds) => {
                          if (selectedTagIds.length > 0) {
                            try {
                              const tagData = await window.electronAPI.worldBook.readTags(viewingItem!.path);
                              if (tagData) {
                                const newAssociations = [...(tagData.associations || [])];

                                selectedTagIds.forEach((tagId: any) => {
                                  const existing = newAssociations.find(
                                    (assoc: any) => assoc.entryUid === currentEditEntryUid && assoc.tagId === tagId
                                  );
                                  if (!existing) {
                                    newAssociations.push({
                                      tagId,
                                      entryUid: currentEditEntryUid
                                    });
                                  }
                                });

                                const updatedTagData = {
                                  ...tagData,
                                  associations: newAssociations
                                };
                                await window.electronAPI.worldBook.writeTags(viewingItem!.path, updatedTagData);
                                await loadTags(viewingItem!.path);
                                message.success('标签添加成功');
                              }
                            } catch (error) {
                              message.error('标签添加失败');
                            }
                          }
                        }}
                        options={tags.map((tag: any) => ({
                          value: tag.id,
                          label: (
                            <span>
                              <Tag color={tag.color} style={{ marginRight: 4 }}>{tag.name}</Tag>
                            </span>
                          )
                        }))}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default WorldBookManager;
