import { useState, useCallback, useMemo } from 'react';
import { Form, message } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import { useLogStore } from '../../../stores/logStore';
import { AIEngineSetting, AIEngineCapabilities } from '../../../types/setting';
import { AppSetting } from '../../../settings';

export interface TestResult {
  success: boolean;
  responseTime?: number;
  model?: string;
  error?: string;
  details?: string;
  /**
   * 探测到的模型能力（Spec: optimize-chat-ai-intelligence / Task 4 将填充）。
   * Task 5.4 在测试结果展示区渲染对应徽章；缺省时不显示。
   */
  capabilities?: AIEngineCapabilities;
}

export interface UseAIEngineSettingsResult {
  // 状态
  activeEngine: AIEngineSetting | null;
  engines: AIEngineSetting[];
  showEngineModal: boolean;
  editingEngine: AIEngineSetting | Partial<AIEngineSetting> | null;
  testResult: TestResult | null;
  engineTestResult: TestResult | null;
  engineModelOptions: { label: string; value: string }[];
  engineModelLoading: boolean;

  // 复制引擎相关
  showRenameModal: boolean;
  copyingEngine: AIEngineSetting | null;
  newEngineName: string;
  nameError: string;
  copiedEngineId: string | null;

  // 表单实例
  engineForm: ReturnType<typeof Form.useForm>[0];

  // 引擎列表操作
  handleAddEngine: () => void;
  handleEditEngine: (engine: AIEngineSetting) => void;
  handleSaveEngine: () => Promise<void>;
  handleDeleteEngine: (engineId: string) => void;
  handleSetDefaultEngine: (engineId: string) => void;
  handleEngineChange: (engineId: string) => void;
  handleCloseEngineModal: () => void;
  handleOpenEngineManager: () => void;

  // 复制引擎
  handleCopyEngine: (engine: AIEngineSetting) => void;
  handleConfirmCopy: () => Promise<void>;
  handleCancelCopy: () => void;
  handleEngineNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // 测试连通性
  handleTestConnection: (formValues: any) => Promise<void>;
  handleTestEngineConnection: () => Promise<void>;

  // 获取模型列表
  handleFetchEngineModels: (formInstance: { getFieldsValue: () => any }) => Promise<void>;
}

/**
 * AI 引擎管理 Hook
 *
 * 从 Settings.tsx 提取，负责：
 * - 引擎列表的增删改查
 * - 引擎复制（含重命名校验）
 * - 引擎连通性测试（主表单和引擎编辑表单两套）
 * - 获取模型列表
 */
export function useAIEngineSettings(): UseAIEngineSettingsResult {
  const { setting, saveSetting, testConnection } = useSettingStore();
  const { addLog } = useLogStore();
  const [engineForm] = Form.useForm();

  const [showEngineModal, setShowEngineModal] = useState(false);
  const [editingEngine, setEditingEngine] = useState<AIEngineSetting | Partial<AIEngineSetting> | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [engineTestResult, setEngineTestResult] = useState<TestResult | null>(null);
  const [engineModelOptions, setEngineModelOptions] = useState<{ label: string; value: string }[]>([]);
  const [engineModelLoading, setEngineModelLoading] = useState(false);

  // 复制引擎相关状态
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [copyingEngine, setCopyingEngine] = useState<AIEngineSetting | null>(null);
  const [newEngineName, setNewEngineName] = useState('');
  const [nameError, setNameError] = useState('');
  const [copiedEngineId, setCopiedEngineId] = useState<string | null>(null);

  const engines = useMemo(() => setting?.aiEngines ?? [], [setting?.aiEngines]);

  const activeEngine = useMemo(() => {
    const list = setting?.aiEngines ?? [];
    return list.find(e => e.id === setting?.activeEngineId) ?? list[0] ?? null;
  }, [setting?.aiEngines, setting?.activeEngineId]);

  // ========== 引擎列表操作 ==========

  const handleAddEngine = useCallback(() => {
    addLog('准备添加新引擎', 'info');
    const emptyEngine: Partial<AIEngineSetting> = {
      name: '新引擎',
      api_url: 'http://127.0.0.1:5000',
      api_key: '',
      model_name: 'qwen3.5-27b-heretic-v3',
      api_mode: 'text_completion',
      api_key_transmission: 'body',
      max_tokens: 10240,
      temperature: 0.7,
      top_p: 0.95,
      top_k: 0,
      min_p: 0.1,
      frequency_penalty: 0,
      presence_penalty: 0,
      n: 1,
      system_prompt: '',
    };
    setEditingEngine(emptyEngine);
    engineForm.resetFields();
    engineForm.setFieldsValue(emptyEngine);
    setShowEngineModal(true);
  }, [addLog, engineForm]);

  const handleEditEngine = useCallback((engine: AIEngineSetting) => {
    setEditingEngine(engine);
    engineForm.setFieldsValue(engine);
    setShowEngineModal(true);
  }, [engineForm]);

  const handleSaveEngine = useCallback(async () => {
    try {
      addLog('开始保存引擎配置', 'info');
      const values = await engineForm.validateFields();
      addLog(`表单验证成功: ${JSON.stringify(values)}`, 'debug');

      if (!setting) {
        addLog('设置为 null，无法保存', 'error');
        message.error('设置未加载，请刷新页面后重试');
        return;
      }

      let updatedEngines = [...(setting.aiEngines || [])];
      const isEditing = editingEngine && (editingEngine as AIEngineSetting).id;

      if (isEditing) {
        const editingId = (editingEngine as AIEngineSetting).id;
        addLog(`更新现有引擎: ${editingId}`, 'info');
        updatedEngines = updatedEngines.map(engine => {
          if (engine.id === editingId) {
            return {
              ...engine,
              ...values,
              max_tokens: Number(values.max_tokens) || 10240,
              temperature: Number(values.temperature) ?? 0.7,
              top_p: Number(values.top_p) || undefined,
              top_k: Number(values.top_k) || undefined,
              min_p: Number(values.min_p) || undefined,
              frequency_penalty: Number(values.frequency_penalty) || undefined,
              presence_penalty: Number(values.presence_penalty) || undefined,
              n: Number(values.n) || 1,
              // Save capabilities from test result if available (Spec: Task 4.4);
              // otherwise preserve existing engine.capabilities from spread above
              ...(engineTestResult?.capabilities ? { capabilities: engineTestResult.capabilities } : {}),
            };
          }
          return engine;
        });
      } else {
        addLog('添加新引擎', 'info');
        const defaultEngine = AppSetting.defaultSetting.aiEngines[0];
        const newEngine: AIEngineSetting = {
          ...defaultEngine,
          id: `engine_${Date.now()}`,
          name: values.name || '新引擎',
          api_url: values.api_url || 'http://127.0.0.1:5000',
          api_key: values.api_key || '',
          model_name: values.model_name || 'qwen3.5-27b-heretic-v3',
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
          // Save capabilities from test result if available (Spec: Task 4.4)
          ...(engineTestResult?.capabilities ? { capabilities: engineTestResult.capabilities } : {}),
        } as unknown as AIEngineSetting;
        updatedEngines.push(newEngine);
      }

      const updatedSetting = {
        ...setting,
        aiEngines: updatedEngines,
      };

      addLog(`保存设置前检查: ${JSON.stringify(updatedSetting).length} bytes`, 'debug');
      await saveSetting(updatedSetting);
      addLog('设置保存成功', 'info');

      setShowEngineModal(false);
      setEditingEngine(null);
      engineForm.resetFields();

      message.success(isEditing ? '引擎更新成功' : '引擎添加成功');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      addLog('保存引擎失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'useAIEngineSettings:handleSaveEngine',
          errorMessage,
        },
        details: '保存引擎配置时发生错误，请检查引擎配置是否正确。',
      });
      message.error(`保存引擎失败: ${errorMessage}`);
    }
  }, [setting, editingEngine, engineForm, saveSetting, addLog, engineTestResult]);

  const handleDeleteEngine = useCallback((engineId: string) => {
    if (!setting) return;
    const currentEngines = setting.aiEngines || [];
    if (currentEngines.length <= 1) {
      message.error('至少需要保留一个引擎设置');
      return;
    }

    const updatedEngines = currentEngines.filter(engine => engine.id !== engineId);
    let activeEngineId = setting.activeEngineId;
    let defaultEngineId = setting.defaultEngineId;

    if (activeEngineId === engineId) {
      activeEngineId = updatedEngines[0].id;
    }
    if (defaultEngineId === engineId) {
      defaultEngineId = updatedEngines[0].id;
    }

    saveSetting({
      ...setting,
      aiEngines: updatedEngines,
      activeEngineId,
      defaultEngineId,
    });
    message.success('引擎删除成功');
  }, [setting, saveSetting]);

  const handleSetDefaultEngine = useCallback((engineId: string) => {
    if (!setting) return;
    saveSetting({
      ...setting,
      defaultEngineId: engineId,
    });
    message.success('默认引擎设置成功');
  }, [setting, saveSetting]);

  const handleEngineChange = useCallback((engineId: string) => {
    if (!setting) return;
    saveSetting({
      ...setting,
      activeEngineId: engineId,
    });
  }, [setting, saveSetting]);

  const handleCloseEngineModal = useCallback(() => {
    setShowEngineModal(false);
    setEngineTestResult(null);
  }, []);

  const handleOpenEngineManager = useCallback(() => {
    setEditingEngine(null);
    setShowEngineModal(true);
  }, []);

  // ========== 复制引擎 ==========

  const handleCopyEngine = useCallback((engine: AIEngineSetting) => {
    addLog(`开始复制引擎: ${engine.name}`, 'info');
    setCopyingEngine(engine);
    const defaultName = `${engine.name} (副本)`;
    setNewEngineName(defaultName);
    setNameError('');
    setShowRenameModal(true);
  }, [addLog]);

  const validateEngineName = useCallback((name: string): boolean => {
    if (!name || name.trim() === '') {
      setNameError('引擎名称不能为空');
      return false;
    }
    const existingEngines = setting?.aiEngines || [];
    const nameExists = existingEngines.some(
      engine => engine.name === name.trim() && engine.id !== copyingEngine?.id
    );
    if (nameExists) {
      setNameError('引擎名称已存在，请使用其他名称');
      return false;
    }
    setNameError('');
    return true;
  }, [setting?.aiEngines, copyingEngine]);

  const handleConfirmCopy = useCallback(async () => {
    if (!validateEngineName(newEngineName)) return;
    if (!copyingEngine || !setting) {
      message.error('无法复制引擎');
      return;
    }

    try {
      addLog(`确认复制引擎: ${copyingEngine.name} -> ${newEngineName}`, 'info');
      const newEngine: AIEngineSetting = {
        ...copyingEngine,
        id: `engine_${Date.now()}`,
        name: newEngineName.trim(),
      };
      const updatedEngines = [...(setting.aiEngines || []), newEngine];
      await saveSetting({
        ...setting,
        aiEngines: updatedEngines,
      });

      setCopiedEngineId(newEngine.id);
      setShowRenameModal(false);
      setCopyingEngine(null);
      setNewEngineName('');
      setNameError('');
      message.success('引擎复制成功');
      addLog(`引擎复制成功: ${newEngineName}`, 'info');

      setTimeout(() => setCopiedEngineId(null), 3000);
    } catch (error) {
      addLog(`引擎复制失败: ${error}`, 'error');
      message.error('引擎复制失败');
    }
  }, [validateEngineName, newEngineName, copyingEngine, setting, saveSetting, addLog]);

  const handleCancelCopy = useCallback(() => {
    setShowRenameModal(false);
    setCopyingEngine(null);
    setNewEngineName('');
    setNameError('');
  }, []);

  const handleEngineNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewEngineName(value);
    if (nameError) {
      validateEngineName(value);
    }
  }, [nameError, validateEngineName]);

  // ========== 测试连通性 ==========

  const handleTestConnection = useCallback(async (formValues: any) => {
    try {
      setTestResult(null);
      addLog('开始测试 AI 引擎连通性', 'info');
      addLog(`API 密钥传输方式: ${formValues.api_key_transmission || 'body'}`, 'info');

      const testSetting = {
        ...setting,
        aiEngines: [{
          id: 'test_engine',
          name: '测试引擎',
          api_url: formValues.api_url,
          api_key: formValues.api_key,
          model_name: formValues.model_name,
          api_mode: formValues.api_mode,
          api_key_transmission: formValues.api_key_transmission,
        }],
        activeEngineId: 'test_engine',
      };

      addLog('测试配置详细信息', 'debug', {
        context: {
          api_url: formValues.api_url,
          model_name: formValues.model_name,
          api_mode: formValues.api_mode,
          api_key_transmission: formValues.api_key_transmission,
          api_key_length: formValues.api_key ? formValues.api_key.length : 0,
        },
      });

      const loadingMessage = message.loading('正在测试连通性...', 0);
      addLog('开始调用 testConnection 函数', 'debug');
      const result = await testConnection(testSetting as any);

      // After text test succeeds, probe capabilities (Spec: Task 4)
      // Capability probing is additive — failure does not affect the overall test result
      let capabilities: AIEngineCapabilities | undefined;
      if (result.success) {
        try {
          const probeResult = await window.electronAPI.ai.probeCapabilities({
            apiUrl: formValues.api_url,
            apiKey: formValues.api_key,
            apiKeyTransmission: formValues.api_key_transmission,
            modelName: formValues.model_name,
          });
          if (probeResult?.success && probeResult.capabilities) {
            capabilities = probeResult.capabilities;
          }
        } catch (e) {
          console.warn('[useAIEngineSettings] Capability probing failed:', e);
        }
      }

      setTestResult({ ...result, capabilities });
      addLog('testConnection 函数调用完成', 'debug', {
        context: { success: result.success, details: result.details },
      });
      loadingMessage();

      if (result.success) {
        addLog('AI 引擎连通性测试成功', 'info');
        message.success(`连接测试成功：${result.details || '成功'}`);

        // 【重点标记 - 模型能力自动持久化】测试连通性并探测到模型能力后，
        // 立即将能力写入当前活跃引擎的配置中并持久化到本地配置文件。
        // 这样用户无需手动保存即可在 Header 等位置看到能力标识更新，
        // 后续如果用户不修改引擎则默认此引擎拥有这些能力。
        if (capabilities && setting?.activeEngineId && setting?.aiEngines) {
          try {
            const updatedEngines = setting.aiEngines.map(engine => {
              if (engine.id === setting.activeEngineId) {
                return {
                  ...engine,
                  capabilities: {
                    ...engine.capabilities,
                    ...capabilities,
                  },
                };
              }
              return engine;
            });
            await saveSetting({
              ...setting,
              aiEngines: updatedEngines,
            });
            addLog('模型能力已自动持久化到引擎配置', 'info', {
              context: { engineId: setting.activeEngineId, capabilities },
            });
          } catch (saveError) {
            // 持久化失败不影响测试结果展示，仅记录日志
            console.warn('[useAIEngineSettings] 自动持久化模型能力失败:', saveError);
            addLog('模型能力自动持久化失败（不影响测试结果）', 'warn');
          }
        }
      } else {
        addLog('AI 引擎连通性测试失败', 'error');
        message.error('连接测试失败');
      }
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        details: `异常: ${error instanceof Error ? error.message : '未知错误'}`,
      });
      addLog('测试连通性失败', 'error', {
        category: 'ai',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'useAIEngineSettings:handleTestConnection',
          error_message: error instanceof Error ? error.message : String(error),
          error_stack: error instanceof Error ? error.stack : undefined,
        },
        details: '测试AI引擎连通性时发生错误，请检查API地址和API密钥是否正确。',
      });
      message.error('测试连通性失败');
    }
  }, [setting, testConnection, addLog]);

  const handleTestEngineConnection = useCallback(async () => {
    try {
      const values = await engineForm.validateFields();
      setEngineTestResult(null);
      addLog('开始测试引擎连通性', 'info');
      addLog(`API 密钥传输方式: ${values.api_key_transmission || 'body'}`, 'info');

      const testSetting = {
        ...setting,
        aiEngines: [{
          id: 'test_engine',
          name: '测试引擎',
          api_url: values.api_url,
          api_key: values.api_key,
          model_name: values.model_name,
          api_mode: values.api_mode,
          api_key_transmission: values.api_key_transmission,
        }],
        activeEngineId: 'test_engine',
      };

      const loadingMessage = message.loading('正在测试连通性...', 0);
      const result = await testConnection(testSetting as any);

      // After text test succeeds, probe capabilities (Spec: Task 4)
      // Capability probing is additive — failure does not affect the overall test result
      let capabilities: AIEngineCapabilities | undefined;
      if (result.success) {
        try {
          const probeResult = await window.electronAPI.ai.probeCapabilities({
            apiUrl: values.api_url,
            apiKey: values.api_key,
            apiKeyTransmission: values.api_key_transmission,
            modelName: values.model_name,
          });
          if (probeResult?.success && probeResult.capabilities) {
            capabilities = probeResult.capabilities;
          }
        } catch (e) {
          console.warn('[useAIEngineSettings] Capability probing failed:', e);
        }
      }

      setEngineTestResult({ ...result, capabilities });
      loadingMessage();

      if (result.success) {
        addLog('引擎连通性测试成功', 'info');
        message.success(`连接测试成功：${result.details || '成功'}`);
        // 注意：测试连通性仅用于验证配置是否可用，不应修改已存储的引擎列表。
        // 用户可通过"保存修改"按钮将编辑中的引擎配置持久化。
      } else {
        addLog('引擎连通性测试失败', 'error');
        message.error('连接测试失败');
      }
    } catch (error) {
      setEngineTestResult({
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        details: `异常: ${error instanceof Error ? error.message : '未知错误'}`,
      });
      addLog('测试引擎连通性失败', 'error', {
        category: 'ai',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'useAIEngineSettings:handleTestEngineConnection',
          error_message: error instanceof Error ? error.message : String(error),
          error_stack: error instanceof Error ? error.stack : undefined,
        },
        details: '测试引擎连通性时发生错误，请检查API地址和API密钥是否正确。',
      });
      message.error('测试连通性失败');
    }
  }, [engineForm, setting, testConnection, addLog]);

  // ========== 获取模型列表 ==========

  const handleFetchEngineModels = useCallback(async (formInstance: { getFieldsValue: () => any }) => {
    const values = formInstance.getFieldsValue();
    if (!values.api_url) {
      message.warning('请先填写 API 地址');
      return;
    }
    setEngineModelLoading(true);
    try {
      const result = await window.electronAPI.ai.listModels({
        apiUrl: values.api_url,
        apiKey: values.api_key,
        apiKeyTransmission: values.api_key_transmission,
      });
      if (result.success && result.models.length > 0) {
        setEngineModelOptions(result.models.map((m: string) => ({ label: m, value: m })));
        message.success(`成功获取 ${result.models.length} 个模型`);
      } else {
        message.warning(result.error || '未获取到模型列表');
      }
    } catch {
      message.error('获取模型列表失败');
    } finally {
      setEngineModelLoading(false);
    }
  }, []);

  return {
    activeEngine,
    engines,
    showEngineModal,
    editingEngine,
    testResult,
    engineTestResult,
    engineModelOptions,
    engineModelLoading,
    showRenameModal,
    copyingEngine,
    newEngineName,
    nameError,
    copiedEngineId,
    engineForm,
    handleAddEngine,
    handleEditEngine,
    handleSaveEngine,
    handleDeleteEngine,
    handleSetDefaultEngine,
    handleEngineChange,
    handleCloseEngineModal,
    handleOpenEngineManager,
    handleCopyEngine,
    handleConfirmCopy,
    handleCancelCopy,
    handleEngineNameChange,
    handleTestConnection,
    handleTestEngineConnection,
    handleFetchEngineModels,
  };
}
