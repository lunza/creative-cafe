import React, { useEffect, useState, useMemo } from 'react';
import { Form, Button, Space, message, Divider } from 'antd';
import { SaveOutlined, ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import { useLogStore } from '../../stores/logStore';
import { AIEngineSetting } from '../../types/setting';
import { VectorConfigPanel, VectorConfigPanelRef } from '../Vector/VectorConfigPanel';
import { usePathSettings } from './hooks/usePathSettings';
import GeneralSettingsPanel from './GeneralSettingsPanel';
import PathSettingsPanel from './PathSettingsPanel';
import AIEngineSettingsPanel from './AIEngineSettingsPanel';
import './Settings.css';

/**
 * 目录路径 → 显示名映射。用于 handleSave 中并发更新多个目录时的日志输出。
 */
const DIRECTORY_LABELS = {
  characterPath: '角色卡',
  worldBookPath: '世界书',
  avatarPath: '用户设定',
  pluginPath: '插件',
} as const;

type DirectoryKey = keyof typeof DIRECTORY_LABELS;

type AddLogFn = (message: string, type?: 'error' | 'warn' | 'info' | 'debug', options?: {
  details?: string;
  error?: Error;
  context?: any;
  category?: 'system' | 'ai' | 'setting' | 'network' | 'user' | 'other';
}) => void;

/**
 * 更新单个目录到对应 IPC（character/worldBook/avatar/plugin）。
 *
 * 行为对齐原 handleSave 中各目录的 try/catch 块：
 * - 全部目录均记录 "更新X目录: <path>" + "X目录更新结果: <json>"
 * - 仅 character/worldBook 在原代码中额外检查 success 并记录最终路径
 *   （avatar/plugin 只记录 result JSON）
 * - 原代码使用 'success' 日志级别，但 LogLevel 仅支持 'error'/'warn'/'info'/'debug'，
 *   导致这些日志被 shouldLog 静默丢弃；此处改为 'info' 以让日志真正生效
 *
 * 该函数自身吞掉异常并写日志，不向外抛出，便于 Promise.allSettled 并发执行。
 */
const updateDirectoryFor = async (
  key: DirectoryKey,
  value: string,
  addLog: AddLogFn
): Promise<void> => {
  if (!value) return;
  const label = DIRECTORY_LABELS[key];
  addLog(`更新${label}目录: ${value}`, 'info');
  try {
    let setDirectoryResult: any;
    if (key === 'characterPath') {
      setDirectoryResult = await window.electronAPI.character.setDirectory(value);
    } else if (key === 'worldBookPath') {
      setDirectoryResult = await window.electronAPI.worldBook.setDirectory(value);
    } else if (key === 'avatarPath') {
      setDirectoryResult = await window.electronAPI.avatar.setDirectory(value);
    } else if (key === 'pluginPath') {
      setDirectoryResult = await window.electronAPI.plugin.setDirectory(value);
    }
    addLog(`${label}目录更新结果: ${JSON.stringify(setDirectoryResult)}`, 'info');

    if (key === 'characterPath' || key === 'worldBookPath') {
      if (setDirectoryResult?.success) {
        const finalPath = key === 'characterPath'
          ? setDirectoryResult.characterDir
          : setDirectoryResult.worldBookDir;
        addLog(`${label}目录更新成功${finalPath ? `，最终路径: ${finalPath}` : ''}`, 'info');
      } else {
        addLog(`${label}目录更新失败`, 'error');
      }
    }
  } catch (setDirectoryError) {
    addLog(`更新${label}目录失败: ${setDirectoryError instanceof Error ? setDirectoryError.message : '未知错误'}`, 'error');
  }
};

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const { setting, fetchSetting, saveSetting, restoreDefault } = useSettingStore();
  const { addLog } = useLogStore();

  const [dashboardBackgroundImage, setDashboardBackgroundImage] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const vectorConfigRef = React.useRef<VectorConfigPanelRef>(null);

  // 路径管理 Hook
  const {
    paths,
    pathValidation,
    setPaths,
    handleSelectDirectory,
    handleResetPath,
    handleValidatePath,
    handlePathInputChange,
    getPathLabel,
  } = usePathSettings(undefined, (field, value) => {
    form.setFieldValue(field, value);
  });

  // 当前激活的引擎（用于 handleSave）
  const activeEngine = useMemo<AIEngineSetting | null>(() => {
    const engines = setting?.aiEngines ?? [];
    return engines.find(e => e.id === setting?.activeEngineId) ?? engines[0] ?? null;
  }, [setting?.aiEngines, setting?.activeEngineId]);

  // 加载设置
  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  // 当设置变化时，更新表单值和路径状态
  useEffect(() => {
    if (setting) {
      // 同步路径状态
      const newPaths = {
        worldBookPath: setting.worldBookPath || '',
        characterPath: setting.characterPath || '',
        avatarPath: setting.avatarPath || '',
        creativePath: setting.creativePath || '',
        memoryPath: setting.memoryPath || '',
        pluginPath: setting.pluginPath || '',
      };
      setPaths(newPaths);
      setDashboardBackgroundImage(setting.dashboardBackgroundImage || '');

      // 找到当前激活的引擎
      const engines = setting.aiEngines || [];
      const engine = engines.find(e => e.id === setting.activeEngineId) || engines[0];

      form.setFieldsValue({
        debugMode: setting.debugMode || false,
        logLevel: setting.logLevel || 'info',
        api_url: engine?.api_url || 'http://127.0.0.1:5000',
        api_key: engine?.api_key || '',
        model_name: engine?.model_name || '',
        api_mode: engine?.api_mode || 'text_completion',
        api_key_transmission: engine?.api_key_transmission || 'body',
        max_tokens: (typeof engine?.max_tokens === 'number' && engine.max_tokens > 0) ? engine.max_tokens : 10240,
        temperature: (typeof engine?.temperature === 'number' && engine.temperature >= 0 && engine.temperature <= 2) ? engine.temperature : 0.7,
        top_p: engine?.top_p,
        top_k: engine?.top_k,
        min_p: engine?.min_p,
        frequency_penalty: engine?.frequency_penalty,
        presence_penalty: engine?.presence_penalty,
        n: engine?.n,
        system_prompt: engine?.system_prompt || '',
        worldBookPath: newPaths.worldBookPath,
        characterPath: newPaths.characterPath,
        avatarPath: newPaths.avatarPath,
        creativePath: newPaths.creativePath,
        memoryPath: newPaths.memoryPath,
        pluginPath: newPaths.pluginPath,
      });
    }
  }, [setting, form, setPaths]);

  // 处理打开配置文件
  const handleOpenConfigFile = async () => {
    try {
      const result = await (window.electronAPI as any).app.openConfigFile();
      if (!result) {
        message.warning('无法打开配置文件，请检查文件是否存在');
      }
    } catch (error) {
      message.error(`打开配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 处理保存设置
  const handleSave = async () => {
    try {
      addLog('开始保存设置', 'info');
      const values = await form.validateFields();
      addLog(`表单验证成功: ${JSON.stringify(values)}`, 'info');

      if (setting && activeEngine) {
        addLog(`当前设置: ${JSON.stringify(setting)}`, 'info');

        // 更新当前激活的引擎配置
        const updatedEngines = (setting.aiEngines || []).map(engine => {
          if (engine.id === activeEngine.id) {
            return {
              ...engine,
              api_url: values.api_url || 'http://127.0.0.1:5000',
              api_key: values.api_key || '',
              model_name: values.model_name || '',
              api_mode: values.api_mode || 'text_completion',
              api_key_transmission: values.api_key_transmission || 'body',
              max_tokens: Number(values.max_tokens) || 10240,
              temperature: Number(values.temperature) ?? 0.7,
              top_p: Number(values.top_p) || undefined,
              top_k: Number(values.top_k) || undefined,
              min_p: Number(values.min_p) || undefined,
              frequency_penalty: Number(values.frequency_penalty) || undefined,
              presence_penalty: Number(values.presence_penalty) || undefined,
              n: Number(values.n) || 1,
              system_prompt: values.system_prompt || '',
            };
          }
          return engine;
        });

        // 合并向量配置
        const vectorConfig = vectorConfigRef.current?.getFormValues() || {};

        const updatedSetting = {
          ...setting,
          aiEngines: updatedEngines,
          worldBookPath: values.worldBookPath,
          characterPath: values.characterPath,
          avatarPath: values.avatarPath,
          creativePath: values.creativePath,
          memoryPath: values.memoryPath,
          pluginPath: values.pluginPath,
          logLevel: values.logLevel || 'info',
          dashboardBackgroundImage: dashboardBackgroundImage,
          debugMode: debugMode,
          vector: vectorConfig,
        };

        addLog(`更新后的设置: ${JSON.stringify(updatedSetting)}`, 'info');

        try {
          addLog('开始保存设置', 'info');
          await saveSetting(updatedSetting as any);
          addLog('设置保存成功', 'info');

          // 并发更新 4 个目录（character / worldBook / avatar / plugin）
          await Promise.allSettled([
            updateDirectoryFor('characterPath', values.characterPath, addLog),
            updateDirectoryFor('worldBookPath', values.worldBookPath, addLog),
            updateDirectoryFor('avatarPath', values.avatarPath, addLog),
            updateDirectoryFor('pluginPath', values.pluginPath, addLog),
          ]);

          if (values.memoryPath) {
            addLog(`记忆目录路径已保存: ${values.memoryPath}`, 'info');
          }
          if (values.creativePath) {
            addLog(`创意目录路径已保存: ${values.creativePath}`, 'info');
          }

          message.success('设置保存成功');
        } catch (saveError) {
          addLog('保存设置异常', 'error', {
            category: 'setting',
            error: saveError instanceof Error ? saveError : undefined,
            context: {
              errorType: saveError instanceof Error ? saveError.name : 'UnknownError',
              errorLocation: 'Settings.tsx:handleSave',
              errorMessage: saveError instanceof Error ? saveError.message : 'Unknown error',
            },
            details: '保存设置时发生异常，请检查设置值是否正确。',
          });
          message.error(`保存设置异常: ${saveError instanceof Error ? saveError.message : '未知错误'}`);
        }
      } else {
        addLog('设置为null', 'error');
        message.error('设置未加载');
      }
    } catch (error: any) {
      if (error?.errorFields && Array.isArray(error.errorFields)) {
        const errorMessages = error.errorFields
          .map((field: any) => `${field.name?.join('.') || '未知字段'}: ${field.errors?.join(', ') || '验证失败'}`)
          .join('; ');
        addLog(`表单验证失败: ${errorMessages}`, 'error');
        message.error(`表单验证失败: ${errorMessages}`);
        return;
      }

      addLog('保存设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:handleSave',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        details: '保存设置时发生错误，请检查设置值是否正确。',
      });
      message.error(`设置保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 处理重置设置
  const handleReset = async () => {
    try {
      await restoreDefault();
      form.resetFields();
      message.info('设置已重置');
    } catch (error) {
      addLog('重置设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'Settings.tsx:handleReset',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        details: '重置设置时发生错误，请检查文件系统权限。',
      });
      message.error('重置设置失败');
    }
  };

  return (
    <div className="settings">
      <div className="settings-content">
        <h2>设置</h2>

        <GeneralSettingsPanel
          form={form}
          dashboardBackgroundImage={dashboardBackgroundImage}
          onBackgroundImageChange={setDashboardBackgroundImage}
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
        />

        <PathSettingsPanel
          form={form}
          paths={paths}
          pathValidation={pathValidation}
          onSelectDirectory={handleSelectDirectory}
          onResetPath={handleResetPath}
          onValidatePath={handleValidatePath}
          onPathInputChange={handlePathInputChange}
          getPathLabel={getPathLabel}
        />

        <AIEngineSettingsPanel form={form} />

        <VectorConfigPanel ref={vectorConfigRef} />

        <Divider />

        <Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            保存设置
          </Button>
          <Button icon={<FileTextOutlined />} onClick={handleOpenConfigFile}>
            打开配置文件
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            重置设置
          </Button>
        </Space>
      </div>
    </div>
  );
};

export default Settings;
