import { create } from 'zustand';
import { AppSetting } from '../settings';
import { AppSetting as AppSettingType } from '../types/setting';
import { useLogStore } from './logStore';

// 直接从 logStore 获取 addLog 方法
type LogCategory = 'system' | 'ai' | 'setting' | 'network' | 'user' | 'other';

const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info', options?: {
  details?: string;
  error?: Error;
  context?: any;
  category?: LogCategory;
}) => {
  try {
    useLogStore.getState().addLog(message, type, options);
  } catch (e) {
    console.log(`[${type.toUpperCase()}] ${message}`);
    if (options?.context) {
      console.log('Context:', options.context);
    }
  }
};

interface SettingState {
  setting: AppSettingType | null;
  loading: boolean;
  error: string | null;
  setSetting: (setting: AppSettingType) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchSetting: () => Promise<void>;
  saveSetting: (setting: AppSettingType) => Promise<void>;
  testConnection: (setting: AppSettingType) => Promise<{ success: boolean; responseTime?: number; model?: string; error?: string; details?: string }>;
  applySetting: (setting: AppSettingType) => Promise<void>;
  restoreDefault: () => Promise<void>;
  exportSetting: () => Promise<string>;
  importSetting: (setting: string) => Promise<void>;
  getSettingHistory: () => Promise<any[]>;
}

export const useSettingStore = create<SettingState>((set, get) => ({
  setting: null,
  loading: false,
  error: null,
  setSetting: (setting) => set({ setting }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  fetchSetting: async () => {
    set({ loading: true, error: null });
    try {
      addLog('开始从主进程加载设置', 'info');

      // 使用 IPC 从主进程加载设置
      const result = await window.electronAPI.setting.load();
      addLog(`设置加载结果: ${JSON.stringify(result)}`, 'debug');

      if (result.success && result.setting) {
        addLog('设置加载成功', 'info');
        set({ setting: result.setting, loading: false });
        return;
      }

      // 如果没有保存的设置，使用默认设置
      addLog('没有找到保存的设置，使用默认设置', 'info');
      const defaultSetting = AppSetting.defaultSetting as unknown as AppSettingType;

      // 保存默认设置到主进程
      const saveResult = await window.electronAPI.setting.save(defaultSetting);
      addLog(`保存默认设置结果: ${saveResult.success}`, 'debug');

      set({ setting: defaultSetting, loading: false });
    } catch (error) {
      addLog('加载设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:74:fetchSetting',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '加载设置时发生错误，请检查文件系统权限和设置文件是否存在。'
      });
      set({ error: 'Failed to fetch setting', loading: false });
    }
  },
  saveSetting: async (setting) => {
    set({ loading: true, error: null });
    try {
      addLog('开始保存设置到主进程', 'info');
      addLog(`设置对象: ${JSON.stringify(setting)}`, 'debug');

      // 使用 IPC 保存设置到主进程
      const result = await window.electronAPI.setting.save(setting);
      addLog(`保存设置结果: ${JSON.stringify(result)}`, 'debug');

      if (result.success) {
        addLog('设置保存成功', 'info');
        set({ setting, loading: false });
      } else {
        const errorMsg = result.error || '保存设置失败';
        addLog('保存设置失败', 'error', {
          category: 'setting',
          context: {
            errorType: 'ConfigurationError',
            errorLocation: 'settingStore.ts:93:saveSetting',
            errorMessage: errorMsg,
            settingKey: 'aiEngines'
          },
          details: '保存设置时发生错误，请检查设置值是否正确，确保文件系统权限正常。'
        });
        set({ error: errorMsg, loading: false });
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog('保存设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:117:saveSetting',
          errorMessage: errorMsg
        },
        details: '保存设置时发生错误，请检查设置值是否正确，确保文件系统权限正常。'
      });
      set({ error: errorMsg, loading: false });
      throw error;
    }
  },
  testConnection: async (setting) => {
    set({ loading: true, error: null });
    const startTime = new Date();
    let testRequest: { url: string; method: string; headers: Record<string, string>; body: any; timeout?: number } | undefined;
    
    try {
      const startTimeStr = startTime.toISOString();
      const requestId = `ai_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      let activeEngine = null;
      if (setting.aiEngines && setting.activeEngineId) {
        activeEngine = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      } else if (setting.aiEngines && setting.aiEngines.length > 0) {
        activeEngine = setting.aiEngines[0];
      }

      if (!activeEngine || !activeEngine.api_url) {
        addLog('测试失败：请先设置AI引擎API地址', 'error', {
          category: 'ai',
          context: {
            errorType: 'ConfigurationError',
            errorLocation: 'settingStore.ts:119:testConnection',
            errorMessage: '请先设置AI引擎API地址'
          },
          details: '测试连通性失败，请先在设置中配置AI引擎的API地址。'
        });
        set({ error: '请先设置AI引擎API地址', loading: false });
        return { success: false, error: '请先设置AI引擎API地址' };
      }

      if (!activeEngine.model_name) {
        addLog('测试失败：请先设置AI模型名称', 'error', {
          category: 'ai',
          context: {
            errorType: 'ConfigurationError',
            errorLocation: 'settingStore.ts:160:testConnection',
            errorMessage: '请先设置AI模型名称'
          },
          details: '测试连通性失败，请先在设置中配置AI引擎的模型名称。'
        });
        set({ error: '请先设置AI模型名称', loading: false });
        return { success: false, error: '请先设置AI模型名称' };
      }

      addLog('测试连通性 - 激活引擎信息', 'debug', {
        category: 'ai',
        context: {
          request_id: requestId,
          timestamp: startTimeStr,
          engine_name: activeEngine.name,
          engine_id: activeEngine.id,
          api_url: activeEngine.api_url,
          model_name: activeEngine.model_name,
          api_mode: activeEngine.api_mode,
          api_key_transmission: activeEngine.api_key_transmission,
          api_key_length: activeEngine.api_key ? activeEngine.api_key.length : 0
        }
      });

      let testUrl;
      const apiUrl = activeEngine.api_url;

      if (apiUrl.endsWith('/v1/chat/completions')) {
        testUrl = apiUrl;
      } else {
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        testUrl = baseUrl + 'v1/chat/completions';
      }

      testRequest = {
        url: testUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          model: activeEngine.model_name,
          messages: [
            {
              role: 'system',
              content: '你是一个测试助手'
            },
            {
              role: 'user',
              content: '测试连接'
            }
          ],
          max_tokens: activeEngine.max_tokens ?? 1,
          temperature: activeEngine.temperature ?? 0.7
        },
        timeout: 5000
      };

      if (activeEngine.api_key) {
        const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = activeEngine.api_key.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            testRequest.headers['Authorization'] = trimmedApiKey;
          } else {
            testRequest.headers['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          testRequest.body.api_key = activeEngine.api_key;
        }
      }

      addLog('测试连通性 - 发送请求', 'info', {
        category: 'ai',
        context: {
          request_id: requestId,
          timestamp: startTimeStr,
          url: testRequest.url,
          method: testRequest.method,
          headers: {
            'Content-Type': testRequest.headers['Content-Type'],
            'Authorization': testRequest.headers['Authorization'] ? 'Bearer [REDACTED]' : undefined
          },
          body: {
            model: testRequest.body.model,
            messages: testRequest.body.messages,
            prompt: testRequest.body.prompt,
            max_tokens: testRequest.body.max_tokens,
            temperature: testRequest.body.temperature,
            api_key: testRequest.body.api_key ? '[REDACTED]' : undefined
          },
          timeout: testRequest.timeout
        }
      });

      addLog('测试连通性 - 开始发送请求', 'info', {
        category: 'ai',
        context: {
          request_id: requestId,
          timestamp: startTimeStr,
          url: testRequest.url,
          request_start_time: startTimeStr
        }
      });

      const result = await window.electronAPI.ai.request(testRequest);

      const endTime = new Date();
      const endTimeStr = endTime.toISOString();
      const responseTime = endTime.getTime() - startTime.getTime();

      addLog('测试连通性 - 请求完成', 'info', {
        category: 'ai',
        context: {
          request_id: requestId,
          start_time: startTimeStr,
          end_time: endTimeStr,
          response_time_ms: responseTime,
          success: result.success,
          error: result.error,
          data: result.data ? JSON.stringify(result.data) : '无数据返回',
          details: result.details
        }
      });

      set({ loading: false });

      if (result.success) {
        addLog('测试连通性 - 连接成功', 'info', {
          category: 'ai',
          context: {
            request_id: requestId,
            response_time_ms: responseTime,
            end_time: endTimeStr
          }
        });
        return { 
          success: true, 
          responseTime, 
          model: activeEngine.model_name,
          details: `耗时 ${responseTime}ms, 模型: ${activeEngine.model_name || '未设置'}, API模式: chat_completion`
        };
      } else {
        addLog('测试连通性 - 连接失败', 'error', {
          category: 'ai',
          context: {
            errorType: 'NetworkError',
            errorLocation: 'settingStore.ts:286:testConnection',
            request_id: requestId,
            response_time_ms: responseTime,
            error: result.error,
            details: result.details,
            end_time: endTimeStr,
            url: testRequest?.url,
            method: testRequest?.method
          },
          details: `测试连通性失败: ${result.error}。请检查API地址、API密钥是否正确，以及网络连接是否正常。`
        });
        return { 
          success: false, 
          responseTime, 
          model: activeEngine.model_name,
          error: result.error,
          details: `耗时 ${responseTime}ms, 错误: ${result.error || '未知错误'}`
        };
      }
    } catch (error) {
      const endTime = new Date();
      const endTimeStr = endTime.toISOString();
      const responseTime = endTime.getTime() - startTime.getTime();

      addLog('测试连通性 - 异常', 'error', {
        category: 'ai',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:334:testConnection',
          end_time: endTimeStr,
          error_message: error instanceof Error ? error.message : String(error),
          error_stack: error instanceof Error ? error.stack : undefined,
          url: testRequest?.url,
          method: testRequest?.method
        },
        details: '测试连通性时发生异常，请检查网络连接和API配置是否正确。'
      });
      set({ error: 'Connection test failed', loading: false });
      return { 
        success: false, 
        responseTime, 
        error: error instanceof Error ? error.message : '未知错误',
        details: `耗时 ${responseTime}ms, 异常: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  },
  applySetting: async (setting) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.setting.save(setting);
      if (result.success) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        set({ setting, loading: false });
      } else {
        throw new Error('保存设置失败');
      }
    } catch (error) {
      addLog('应用设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:358:applySetting',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '应用设置时发生错误，请检查设置值是否正确。'
      });
      set({ error: 'Failed to apply setting', loading: false });
    }
  },
  restoreDefault: async () => {
    set({ loading: true, error: null });
    try {
      const defaultSetting = AppSetting.defaultSetting as unknown as AppSettingType;
      const result = await window.electronAPI.setting.save(defaultSetting);
      if (result.success) {
        set({ setting: defaultSetting, loading: false });
      } else {
        throw new Error('保存默认设置失败');
      }
    } catch (error) {
      addLog('恢复默认设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:383:restoreDefault',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '恢复默认设置时发生错误，请检查文件系统权限。'
      });
      set({ error: 'Failed to restore default setting', loading: false });
    }
  },
  exportSetting: async () => {
    set({ loading: true, error: null });
    try {
      const setting = get().setting;
      set({ loading: false });
      return JSON.stringify(setting, null, 2);
    } catch (error) {
      addLog('导出设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:405:exportSetting',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '导出设置时发生错误，请检查设置对象是否有效。'
      });
      set({ error: 'Failed to export setting', loading: false });
      return '';
    }
  },
  importSetting: async (settingString) => {
    set({ loading: true, error: null });
    try {
      const setting = JSON.parse(settingString);
      set({ setting, loading: false });
    } catch (error) {
      addLog('导入设置失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:427:importSetting',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '导入设置时发生错误，请检查设置字符串是否为有效的JSON格式。'
      });
      set({ error: 'Failed to import setting', loading: false });
    }
  },
  getSettingHistory: async () => {
    set({ loading: true, error: null });
    try {
      const history = [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          setting: get().setting,
          description: 'Current setting'
        }
      ];
      set({ loading: false });
      return history;
    } catch (error) {
      addLog('获取设置历史失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:447:getSettingHistory',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '获取设置历史时发生错误，请检查设置对象是否有效。'
      });
      set({ error: 'Failed to get setting history', loading: false });
      return [];
    }
  }
}));