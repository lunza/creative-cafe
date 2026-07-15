import { useState, useCallback } from 'react';
import { message } from 'antd';
import { useLogStore } from '../../../stores/logStore';

export interface PathState {
  worldBookPath: string;
  characterPath: string;
  avatarPath: string;
  creativePath: string;
  memoryPath: string;
  pluginPath: string;
}

export type PathField = keyof PathState;

export interface PathValidation {
  valid: boolean;
  message?: string;
}

const DEFAULT_PATHS: Record<PathField, string> = {
  worldBookPath: '__USER_DATA__/data/worldbooks',
  characterPath: '__USER_DATA__/data/characters',
  avatarPath: '__USER_DATA__/data/avatars',
  creativePath: '__USER_DATA__/data/creatives',
  memoryPath: '__USER_DATA__/data/memories',
  pluginPath: '__USER_DATA__/data/plugins',
};

const PATH_LABELS: Record<PathField, string> = {
  worldBookPath: '世界书存储',
  characterPath: '角色卡存储',
  avatarPath: '用户人设存储',
  creativePath: '创意存储',
  memoryPath: '记忆存储',
  pluginPath: '插件存储',
};

export interface UsePathSettingsResult {
  paths: PathState;
  pathValidation: Record<string, PathValidation>;
  setPaths: React.Dispatch<React.SetStateAction<PathState>>;
  setPathValidation: React.Dispatch<React.SetStateAction<Record<string, PathValidation>>>;
  handleSelectDirectory: (field: PathField) => Promise<void>;
  handleResetPath: (field: PathField) => void;
  handleValidatePath: (field: PathField) => Promise<void>;
  handlePathInputChange: (field: PathField, value: string) => void;
  getPathLabel: (field: PathField) => string;
  getDefaultPath: (field: PathField) => string;
}

/**
 * 路径管理 Hook
 *
 * 从 Settings.tsx 提取，负责：
 * - 维护 6 个目录路径的状态
 * - 目录选择（调用 IPC 打开文件夹选择器）
 * - 目录重置（恢复默认路径）
 * - 目录验证（调用 IPC 校验路径有效性）
 * - 手动输入路径时的同步
 */
export function usePathSettings(
  initialPaths?: Partial<PathState>,
  onPathChange?: (field: PathField, value: string) => void
): UsePathSettingsResult {
  const { addLog } = useLogStore();
  const [paths, setPaths] = useState<PathState>({
    worldBookPath: '',
    characterPath: '',
    avatarPath: '',
    creativePath: '',
    memoryPath: '',
    pluginPath: '',
    ...initialPaths,
  });
  const [pathValidation, setPathValidation] = useState<Record<string, PathValidation>>({});

  const handleSelectDirectory = useCallback(async (field: PathField) => {
    try {
      const result = await window.electronAPI.file.selectDirectory();
      if (result) {
        setPaths(prev => ({ ...prev, [field]: result }));
        onPathChange?.(field, result);
      }
    } catch (error) {
      addLog('选择目录失败', 'error', {
        category: 'user',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'usePathSettings:handleSelectDirectory',
          field,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        details: '选择目录时发生错误，请检查文件系统权限。',
      });
      message.error('选择目录失败');
    }
  }, [addLog, onPathChange]);

  const handleResetPath = useCallback((field: PathField) => {
    const defaultPath = DEFAULT_PATHS[field];
    setPaths(prev => ({ ...prev, [field]: defaultPath }));
    onPathChange?.(field, defaultPath);
    message.info(`已重置${PATH_LABELS[field]}为默认路径`);
  }, [onPathChange]);

  const handleValidatePath = useCallback(async (field: PathField) => {
    const targetPath = paths[field];
    if (!targetPath) {
      setPathValidation(prev => ({ ...prev, [field]: { valid: false, message: '路径为空' } }));
      return;
    }
    try {
      addLog(`开始验证路径 (${field}): ${targetPath}`, 'info');
      const userDataPath = await window.electronAPI.app.getUserDataPath();
      addLog(`用户数据目录: ${userDataPath}`, 'info');
      const resolvedPath = targetPath.replace('__USER_DATA__', userDataPath);
      addLog(`解析后路径: ${resolvedPath}`, 'info');
      const result = await window.electronAPI.file.validatePath(resolvedPath);
      addLog(`路径验证结果: ${JSON.stringify(result)}`, 'info');
      setPathValidation(prev => ({
        ...prev,
        [field]: {
          valid: result.valid,
          message: result.exists
            ? (result.valid ? '路径有效' : result.error || '路径无效')
            : '路径不存在，保存后自动创建',
        },
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      addLog(`路径验证失败 (${field}): ${errorMsg}`, 'error');
      setPathValidation(prev => ({ ...prev, [field]: { valid: false, message: `验证失败: ${errorMsg}` } }));
    }
  }, [paths, addLog]);

  const handlePathInputChange = useCallback((field: PathField, value: string) => {
    setPaths(prev => ({ ...prev, [field]: value }));
    onPathChange?.(field, value);
    // 清除该字段的验证状态
    setPathValidation(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, [onPathChange]);

  const getPathLabel = useCallback((field: PathField) => PATH_LABELS[field], []);
  const getDefaultPath = useCallback((field: PathField) => DEFAULT_PATHS[field], []);

  return {
    paths,
    pathValidation,
    setPaths,
    setPathValidation,
    handleSelectDirectory,
    handleResetPath,
    handleValidatePath,
    handlePathInputChange,
    getPathLabel,
    getDefaultPath,
  };
}
