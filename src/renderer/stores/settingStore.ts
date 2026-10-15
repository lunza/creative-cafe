import { create } from 'zustand';
import { AppSetting } from '../settings';
import { AppSetting as AppSettingType } from '../types/setting';
import { useLogStore } from './logStore';
// Spec: settings-feature-optimization-report / H-1（日志脱敏：api_key 不落日志）
import { redactSecrets } from '../../shared/utils/redactSecrets';
// Spec: settings-feature-optimization-report / H-5（默认值单一来源）
import { DEFAULT_ENGINE_PARAMS } from '../../shared/settingDefaults';
// Spec: settings-feature-optimization-report / H-3（重置白名单合并：保留接口外键，防 DC-4 数据丢失）
import { mergePreservedKeys, appendSettingSnapshot } from '../components/Settings/settingMapper';
// Spec: settings-feature-optimization-report / N6, M-17（渲染层禁裸调 electronAPI.setting，统一封装）
import { getSettingAPI } from '../services/settingServiceClient';

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
  restoreDefault: () => Promise<void>;
  // Spec: settings-feature-optimization-report / L-7, S-11 前半 ——
  // applySetting / exportSetting / importSetting 三个零消费方死 action 已删除
  // （数据安全兜底由 N1 快照回滚 + H-4 损坏恢复承担，无需再留导出/导入桩）。
  getSettingHistory: () => Promise<any[]>;
  // Spec: settings-feature-optimization-report / H-11（N1 版本回滚）
  rollbackToVersion: (versionId: string) => Promise<void>;
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

      // 使用 IPC 从主进程加载设置（Spec: N6/M-17 统一封装）
      const result = await getSettingAPI()?.load() ?? { success: false, error: 'setting API 不可用' };
      addLog(`设置加载结果: ${redactSecrets(JSON.stringify(result))}`, 'debug');

      if (result.success && result.setting) {
        addLog('设置加载成功', 'info');
        set({ setting: result.setting, loading: false });
        return;
      }

      // 如果没有保存的设置，使用默认设置
      addLog('没有找到保存的设置，使用默认设置', 'info');
      const defaultSetting = AppSetting.defaultSetting as unknown as AppSettingType;

      // 保存默认设置到主进程
      const saveResult = await getSettingAPI()?.save(defaultSetting) ?? { success: false, error: 'setting API 不可用' };
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
      // 【重点标记 - N1 版本快照（H-11）】保存前对「保存前状态」自动留档（滚动 20 条），
      // 使误操作/重置/迁移导致的配置损坏可回滚。content 已剥离 versions 防递归。
      const preSaveSetting = get().setting;
      const versions = appendSettingSnapshot(preSaveSetting?.versions, preSaveSetting);
      const settingToSave: AppSettingType = { ...setting, versions };
      addLog(`设置对象: ${redactSecrets(JSON.stringify(settingToSave))}`, 'debug');

      // 使用 IPC 保存设置到主进程（Spec: N6/M-17 统一封装）
      const result = await getSettingAPI()?.save(settingToSave) ?? { success: false, error: 'setting API 不可用' };
      addLog(`保存设置结果: ${redactSecrets(JSON.stringify(result))}`, 'debug');

      if (result.success) {
        addLog('设置保存成功', 'info');
        set({ setting: settingToSave, loading: false });
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
          max_tokens: 1,
          temperature: activeEngine.temperature ?? DEFAULT_ENGINE_PARAMS.temperature
        },
        timeout: 5000
      };

      if (activeEngine.api_key) {
        const apiKeyTransmission = activeEngine.api_key_transmission || 'header';
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
  restoreDefault: async () => {
    set({ loading: true, error: null });
    try {
      // 【重点标记 - DC-4 数据丢失修复（H-3）】restoreDefault 此前直接 save(defaultSetting)
      // 全量替换，defaultSetting 不含 knowledgeBase / *Path / _version 等接口外键，
      // 重置后这些磁盘数据被静默清除。现经 mergePreservedKeys 白名单合并：
      // 仅复位 defaultSetting 覆盖的配置域，接口外数据原样保留。
      const defaultSetting = AppSetting.defaultSetting as unknown as AppSettingType;
      const merged = mergePreservedKeys(defaultSetting, get().setting);
      const result = await getSettingAPI()?.save(merged) ?? { success: false, error: 'setting API 不可用' };
      if (result.success) {
        set({ setting: merged, loading: false });
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
      // 【重点标记 - FL-9 错误行为统一（L-1）】此前 restoreDefault 失败仅 set error
      // 不 throw，而 saveSetting 失败 rethrow —— 调用方（Settings.doReset 的 catch）
      // 永不触发，磁盘只读等失败场景 UI 仍提示「设置已重置」。现与 saveSetting
      // 对齐：set error 后 rethrow，由调用方 catch 统一呈现失败反馈。
      throw error;
    }
  },
  getSettingHistory: async () => {
    set({ loading: true, error: null });
    try {
      // 【重点标记 - N1 桩实现补齐（H-11）】此前返回伪造的「Current setting」单条记录。
      // 现返回真实快照历史（saveSetting 保存前自动留档的 versions，最新在前）。
      const versions = get().setting?.versions ?? [];
      set({ loading: false });
      return versions;
    } catch (error) {
      addLog('获取设置历史失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:getSettingHistory',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '获取设置历史时发生错误，请检查设置对象是否有效。'
      });
      set({ error: 'Failed to get setting history', loading: false });
      return [];
    }
  },
  rollbackToVersion: async (versionId) => {
    set({ loading: true, error: null });
    try {
      const versions = get().setting?.versions ?? [];
      const target = versions.find(v => v.id === versionId);
      if (!target) {
        throw new Error('未找到对应版本快照');
      }
      // 回滚：以快照 content 覆盖当前设置。经 saveSetting 会先对「回滚前状态」留档，
      // 因此回滚操作本身也可再回滚（形成完整版本链）。content 已剥离 versions，
      // saveSetting 会重新计算并写入新的 versions（含回滚前快照）。
      addLog(`回滚到版本 ${versionId}（${target.note ?? '无备注'}）`, 'info');
      await get().saveSetting(target.content as AppSettingType);
    } catch (error) {
      addLog('回滚版本失败', 'error', {
        category: 'setting',
        error: error instanceof Error ? error : undefined,
        context: {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorLocation: 'settingStore.ts:rollbackToVersion',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        details: '回滚版本时发生错误，请检查版本快照是否有效。'
      });
      set({ error: error instanceof Error ? error.message : 'Failed to rollback version', loading: false });
      throw error;
    }
  }
}));