import { AIEngineSetting } from '../types/setting';

/**
 * 构建完整的API URL（仅支持 chat_completion 模式）
 * @param apiUrl 基础API URL
 * @returns 完整的API URL
 */
export const buildApiUrl = (apiUrl: string): string => {
  if (apiUrl.endsWith('/v1/chat/completions')) {
    return apiUrl;
  }
  const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
  return baseUrl + 'v1/chat/completions';
};

/**
 * 从AI引擎设置构建完整的API URL
 * @param engine AI引擎设置
 * @returns 完整的API URL
 */
export const buildEngineApiUrl = (engine: AIEngineSetting): string => {
  return buildApiUrl(engine.api_url);
};
