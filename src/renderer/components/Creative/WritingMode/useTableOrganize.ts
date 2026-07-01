import { useCallback, useState, useRef } from 'react';
import { message } from 'antd';
import type { TableVersionControlHandle } from './TableVersionControl';

interface ProgressData {
  current: number;
  total: number;
  message: string;
  percent: number;
  timestamp: number;
  currentChunk?: number;
  totalChunks?: number;
}

export interface UseTableOrganizeParams {
  projectId?: string;
  chapterId?: number;
  chapterTitle?: string;
  /** 整理要求的最新值（通过 ref 读取，避免依赖重建） */
  organizeRequirementsRef: React.MutableRefObject<string>;
  /** 保存整理要求到服务端 */
  saveOrganizeRequirements: (requirements: string) => Promise<void>;
  /** 重新加载表格数据 */
  loadTableData: () => Promise<void>;
  /** 打开模板绑定 Modal */
  openTemplateModal: () => void;
  /** 整理状态变化的回调（向父组件传递） */
  onOrganizeStatusChange?: (isOrganizing: boolean) => void;
  /** 版本控制组件的 ref（整理成功后刷新待确认版本状态） */
  versionControlRef: React.MutableRefObject<TableVersionControlHandle | null>;
}

export interface UseTableOrganizeReturn {
  organizing: boolean;
  organizeProgress: number;
  organizeStatus: string;
  currentOrganizeInfo: { processedCount: number; totalChapters: number } | null;
  currentChunk: number;
  totalChunks: number;
  singleSheetOrganizing: boolean;
  executeOrganize: (skipOrganized: boolean) => Promise<void>;
  handleStartOrganize: () => Promise<void>;
  handleOrganizeAll: () => void;
  handleOrganizeSkipOrganized: () => void;
  handleOrganizeCancel: () => void;
  handleStartSingleSheetOrganize: (selectedSingleSheet: string) => Promise<void>;
  /** 由父组件在用户在状态弹窗中选择后调用 */
  setChapterStatusModalVisible: (visible: boolean) => void;
  /** 弹窗可见性与已整理章节数 */
  chapterStatusModalVisible: boolean;
  organizedChapterCount: number;
}

/**
 * 表格整理相关逻辑（自定义 Hook）
 *
 * 抽自原 TableOrganizePanelContent 的整理相关 state 与 handler：
 * - 全章整理 executeOrganize（含进度监听、AI 引擎配置加载、IPC 调用）
 * - 单表整理 handleStartSingleSheetOrganize
 * - 章节状态检查弹窗的回调
 *
 * 通过 hook 形式暴露，使 TableOrganizeMainPanel 组件主体行数显著减少，
 * 同时保持原行为不变。
 */
export const useTableOrganize = ({
  projectId,
  chapterId,
  chapterTitle,
  organizeRequirementsRef,
  saveOrganizeRequirements,
  loadTableData,
  openTemplateModal,
  onOrganizeStatusChange,
  versionControlRef,
}: UseTableOrganizeParams): UseTableOrganizeReturn => {
  const [organizing, setOrganizing] = useState(false);
  const [organizeProgress, setOrganizeProgress] = useState<number>(0);
  const [organizeStatus, setOrganizeStatus] = useState<string>('');
  const [currentOrganizeInfo, setCurrentOrganizeInfo] = useState<{ processedCount: number; totalChapters: number } | null>(null);
  const [currentChunk, setCurrentChunk] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [singleSheetOrganizing, setSingleSheetOrganizing] = useState(false);

  // 章节整理状态检查弹窗
  const [chapterStatusModalVisible, setChapterStatusModalVisible] = useState(false);
  const [organizedChapterCount, setOrganizedChapterCount] = useState(0);

  // 整理流程内部使用的"是否正在整理"状态（同时反映 organizing 与 singleSheetOrganizing）
  const organizingRef = useRef(false);

  // 进度监听器的统一构造
  const createProgressListener = useCallback((lastLoadTimeRef: { current: number }) => {
    return (
      _event: any,
      _projectId: string,
      progressData: ProgressData
    ) => {
      try {
        setOrganizeProgress(progressData.percent || 0);
        setOrganizeStatus(progressData.message || '处理中...');
        if (progressData.currentChunk !== undefined) setCurrentChunk(progressData.currentChunk);
        if (progressData.totalChunks !== undefined) setTotalChunks(progressData.totalChunks);
        const now = Date.now();
        if (now - lastLoadTimeRef.current >= 50) {
          lastLoadTimeRef.current = now;
          loadTableData();
        }
      } catch (listenerError) {
        console.error('[TableOrganize] 进度监听器错误:', listenerError);
      }
    };
  }, [loadTableData]);

  // 加载当前活跃 AI 引擎配置（与原行为一致）
  const loadActiveAIEngineConfig = useCallback(async () => {
    const settingResponse = await window.electronAPI.setting.load();
    if (!settingResponse.success) {
      throw new Error('无法获取系统设置');
    }
    const currentSetting = settingResponse.setting;
    const activeEngineId = currentSetting?.activeEngineId;
    const engines = currentSetting?.aiEngines || [];
    const currentActiveEngine = engines.find((e: any) => e.id === activeEngineId) || engines[0];
    if (!currentActiveEngine) {
      throw new Error('未配置 AI 引擎，请在设置中配置');
    }

    const temperature =
      typeof currentActiveEngine.temperature === 'number' &&
      currentActiveEngine.temperature >= 0 &&
      currentActiveEngine.temperature <= 2
        ? currentActiveEngine.temperature
        : 0.7;
    const maxTokens =
      typeof currentActiveEngine.max_tokens === 'number' && currentActiveEngine.max_tokens > 0
        ? currentActiveEngine.max_tokens
        : 10240;

    return { temperature, maxTokens };
  }, []);

  // 执行整理的核心逻辑（提取为独立函数，供状态检查后调用）
  const executeOrganize = useCallback(
    async (skipOrganized: boolean) => {
      if (chapterId === undefined) return;
      if (!projectId) return;

      // 先重新加载配置，确保获取最新状态
      const response = await window.electronAPI.writing.table.getTableConfig(projectId);
      const currentConfig = response?.config || response;

      if (!currentConfig?.associatedTemplateId) {
        message.error('请先绑定表格模板');
        openTemplateModal();
        return;
      }

      // 保存当前的整理要求
      if (organizeRequirementsRef.current?.trim()) {
        saveOrganizeRequirements(organizeRequirementsRef.current.trim());
      }

      // 使用已保存的要求作为后备（当输入框为空时）
      const effectiveRequirements =
        organizeRequirementsRef.current?.trim() || currentConfig?.organizeRequirements || '';

      if (onOrganizeStatusChange) {
        onOrganizeStatusChange(true);
      }
      organizingRef.current = true;
      setOrganizing(true);
      setOrganizeProgress(0);
      setCurrentChunk(0);
      setTotalChunks(0);
      setOrganizeStatus(`开始整理章节: ${chapterTitle || `第 ${chapterId} 章`}`);
      setCurrentOrganizeInfo(null);

      const lastLoadTimeRef = { current: 0 };
      const progressListener = createProgressListener(lastLoadTimeRef);

      try {
        window.electronAPI.ipcRenderer.on('writing:table:organizeProgress', progressListener);
      } catch (registerError) {
        console.warn('[TableOrganize] 注册进度监听器失败:', registerError);
      }

      try {
        const modelConfig = await loadActiveAIEngineConfig();

        const result = await window.electronAPI.writing.table.organizeTable(
          projectId,
          modelConfig,
          chapterId,
          effectiveRequirements || undefined,
          skipOrganized
        );

        if (result.success) {
          setOrganizeProgress(100);
          setOrganizeStatus('整理完成');
          message.success('表格整理完成，请查看结果并确认是否覆盖原始数据');
          loadTableData();
          versionControlRef.current?.checkPendingVersion();
        } else {
          setOrganizeStatus('整理失败');
          message.error(`整理失败: ${result.errors?.join(', ') || '未知错误'}`);
        }
      } catch (error) {
        setOrganizeStatus('整理出错');
        message.error(`整理出错: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        try {
          window.electronAPI.ipcRenderer.removeListener('writing:table:organizeProgress', progressListener);
        } catch (unregisterError) {
          console.warn('[TableOrganize] 移除进度监听器失败:', unregisterError);
        }
        if (onOrganizeStatusChange) {
          onOrganizeStatusChange(false);
        }
        organizingRef.current = false;
        setOrganizing(false);
      }
    },
    [projectId, loadTableData, openTemplateModal, chapterId, chapterTitle, onOrganizeStatusChange, saveOrganizeRequirements, organizeRequirementsRef, versionControlRef, createProgressListener, loadActiveAIEngineConfig]
  );

  // 开始整理（含章节状态检查）
  const handleStartOrganize = useCallback(async () => {
    if (organizingRef.current || singleSheetOrganizing) {
      message.warning('整理任务正在进行中');
      return;
    }

    if (chapterId === undefined) {
      message.warning('请先选择一个章节');
      return;
    }

    // 检查章节整理状态
    try {
      const statusResponse = await window.electronAPI.writing.table.getChapterOrganizeStatus(projectId!);
      if (statusResponse.success && statusResponse.status) {
        const organizedChapters = statusResponse.status.filter((ch: any) => ch.status === 'organized');
        if (organizedChapters.length > 0) {
          setOrganizedChapterCount(organizedChapters.length);
          setChapterStatusModalVisible(true);
          return; // 等待用户选择后再执行
        }
      }
    } catch (error) {
      console.warn('[TableOrganize] 获取章节状态失败:', error);
      // 状态检查失败不影响正常流程，继续整理
    }

    executeOrganize(false);
  }, [singleSheetOrganizing, chapterId, projectId, executeOrganize]);

  const handleOrganizeAll = useCallback(() => {
    setChapterStatusModalVisible(false);
    executeOrganize(false);
  }, [executeOrganize]);

  const handleOrganizeSkipOrganized = useCallback(() => {
    setChapterStatusModalVisible(false);
    executeOrganize(true);
  }, [executeOrganize]);

  const handleOrganizeCancel = useCallback(() => {
    setChapterStatusModalVisible(false);
  }, []);

  // 整理单个表格
  const handleStartSingleSheetOrganize = useCallback(
    async (selectedSingleSheet: string) => {
      if (!selectedSingleSheet) {
        message.warning('请选择要整理的表格');
        return;
      }

      if (organizingRef.current || singleSheetOrganizing) {
        message.warning('整理任务正在进行中');
        return;
      }

      // 先重新加载配置
      const response = await window.electronAPI.writing.table.getTableConfig(projectId!);
      const currentConfig = response?.config || response;

      if (!currentConfig?.associatedTemplateId) {
        message.error('请先绑定表格模板');
        return;
      }

      // 保存当前的整理要求
      if (organizeRequirementsRef.current?.trim()) {
        saveOrganizeRequirements(organizeRequirementsRef.current.trim());
      }

      const effectiveRequirements =
        organizeRequirementsRef.current?.trim() || currentConfig?.organizeRequirements || '';

      if (onOrganizeStatusChange) {
        onOrganizeStatusChange(true);
      }
      organizingRef.current = true;
      setSingleSheetOrganizing(true);
      setOrganizeProgress(0);
      setOrganizeStatus(`开始整理表格: ${selectedSingleSheet}`);
      setCurrentOrganizeInfo(null);

      const lastLoadTimeRef = { current: 0 };
      const progressListener = createProgressListener(lastLoadTimeRef);

      try {
        window.electronAPI.ipcRenderer.on('writing:table:organizeProgress', progressListener);
      } catch (registerError) {
        console.warn('[TableOrganize] 注册进度监听器失败:', registerError);
      }

      try {
        const modelConfig = await loadActiveAIEngineConfig();

        const result = await window.electronAPI.writing.table.organizeSingleSheet(
          projectId!,
          selectedSingleSheet,
          modelConfig,
          chapterId,
          effectiveRequirements || undefined
        );

        if (result.success) {
          setOrganizeProgress(100);
          setOrganizeStatus('整理完成');
          message.success(
            `表格"${selectedSingleSheet}"整理完成: ${result.errorCount > 0 ? `有 ${result.errorCount} 个错误` : '成功'}`
          );
          loadTableData();
        } else {
          setOrganizeStatus('整理失败');
          message.error(`整理失败: ${result.errors?.join(', ') || '未知错误'}`);
        }
      } catch (error) {
        setOrganizeStatus('整理出错');
        message.error(`整理出错: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        try {
          window.electronAPI.ipcRenderer.removeListener('writing:table:organizeProgress', progressListener);
        } catch (unregisterError) {
          console.warn('[TableOrganize] 移除进度监听器失败:', unregisterError);
        }
        if (onOrganizeStatusChange) {
          onOrganizeStatusChange(false);
        }
        organizingRef.current = false;
        setSingleSheetOrganizing(false);
      }
    },
    [projectId, singleSheetOrganizing, loadTableData, chapterId, onOrganizeStatusChange, saveOrganizeRequirements, organizeRequirementsRef, createProgressListener, loadActiveAIEngineConfig]
  );

  return {
    organizing,
    organizeProgress,
    organizeStatus,
    currentOrganizeInfo,
    currentChunk,
    totalChunks,
    singleSheetOrganizing,
    executeOrganize,
    handleStartOrganize,
    handleOrganizeAll,
    handleOrganizeSkipOrganized,
    handleOrganizeCancel,
    handleStartSingleSheetOrganize,
    setChapterStatusModalVisible,
    chapterStatusModalVisible,
    organizedChapterCount,
  };
};

export default useTableOrganize;
