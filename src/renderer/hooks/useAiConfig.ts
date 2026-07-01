/**
 * useAiConfig - 统一读取当前激活 AI 引擎配置的 renderer 侧 hook。
 *
 * 背景：
 * - 原 ChatManager.tsx 中存在两处独立的 AI 配置读取逻辑：
 *   1. handleOpenTableOrganize 直接读 setting?.api_key / setting?.api_url /
 *      setting?.model_name / setting?.api_mode —— 这些字段在 AppSetting 类型上
 *      根本不存在（属于历史遗留的 legacy 字段），导致 TS 报错且运行时永远拿到
 *      fallback 默认值。
 *   2. startProgressiveProcessing 正确地从 setting.aiEngines 中按 activeEngineId
 *      查找激活引擎并读取其 api_key 等字段。
 *
 * 本 hook 抽取并统一为第二种（正确）的读取方式，供 ChatManager 及未来其他
 * renderer 组件复用。行为对齐 startProgressiveProcessing 中的引擎查找逻辑：
 *   - 优先按 setting.activeEngineId 查找
 *   - 找不到时回退到 aiEngines[0]
 *   - 仍然找不到时返回 null
 *
 * 注意：本 hook 是 renderer 侧的轻量封装，与 main 侧的 AIConfigProvider
 * （Task 13 抽取）并行存在但语义对齐 —— 后者用于 main 进程的 writing 服务，
 * 前者用于 renderer 进程的 UI 调用（如表格整理）。
 */
import { useMemo } from 'react';
import { useSettingStore } from '../stores/settingStore';
import type { AIEngineSetting } from '../types/setting';

export interface AiConfig {
  apiKey: string;
  apiUrl: string;
  modelName: string;
  apiMode: string;
  /** 配置来源引擎（便于日志显示引擎名等），无引擎时为 null */
  engine: AIEngineSetting | null;
}

export interface UseAiConfigReturn {
  /** 当前激活引擎对象（找不到时为 null） */
  activeEngine: AIEngineSetting | null;
  /**
   * 构建 AI 调用所需的配置对象。
   * 与原 ChatManager 行为一致：当引擎未配置 model_name 时抛出
   * '未配置 AI 模型名称'，便于调用方在 try/catch 中处理。
   */
  getAiConfig: () => AiConfig;
  /** 引擎是否已配置 api_url（用于 UI 判断是否可调用） */
  isEngineConfigured: boolean;
}

export function useAiConfig(): UseAiConfigReturn {
  const { setting } = useSettingStore();

  const activeEngine = useMemo<AIEngineSetting | null>(() => {
    if (!setting?.aiEngines || setting.aiEngines.length === 0) {
      return null;
    }
    if (setting.activeEngineId) {
      const found = setting.aiEngines.find(engine => engine.id === setting.activeEngineId);
      if (found) return found;
    }
    // 回退到第一个引擎（与原 startProgressiveProcessing 一致）
    return setting.aiEngines[0];
  }, [setting]);

  const getAiConfig = (): AiConfig => {
    if (!activeEngine) {
      // 与原 ChatManager 的 IIFE throw 行为一致
      throw new Error('未配置 AI 模型名称');
    }

    const modelName = activeEngine.model_name;
    if (!modelName) {
      throw new Error('未配置 AI 模型名称');
    }

    return {
      apiKey: activeEngine.api_key || '',
      apiUrl: activeEngine.api_url || 'http://127.0.0.1:5000',
      modelName,
      apiMode: activeEngine.api_mode || 'text_completion',
      engine: activeEngine,
    };
  };

  const isEngineConfigured = !!activeEngine?.api_url;

  return { activeEngine, getAiConfig, isEngineConfigured };
}

export default useAiConfig;
