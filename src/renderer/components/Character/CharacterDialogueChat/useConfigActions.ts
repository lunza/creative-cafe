/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】配置项变更 Hook（God Component 拆分）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中透传给 ConfigPanel 的参数变更回调，
 * 全部是 updateConfig / resetParameters 的薄包装（含范围校验）。
 */
import { useCallback } from 'react';
import { AIParameterConfig } from './CharacterDialogueChat.types';
import type { ChatHook } from './CharacterDialogueChat.hooks';

export function useConfigActions(chat: ChatHook) {
  const handlePersonaChange = useCallback((personaId: string) => {
    chat.updateConfig({ selectedPersonaId: personaId });
  }, [chat]);

  const handleParameterChange = useCallback((params: Partial<AIParameterConfig>) => {
    chat.updateConfig((prev: any) => {
      const mergedCustomParams = { ...(prev?.customParameters || {}), ...params };
      return { customParameters: mergedCustomParams };
    });
  }, [chat]);

  const handleResetParameters = useCallback(() => {
    chat.resetParameters();
  }, [chat]);

  // 自定义停止序列处理（Spec: optimize-chat-ai-intelligence / Task 3.4）
  // 持久化到 character-session-<cardId> localStorage 的 customStopSequencesEnabled / customStopSequences 字段
  const handleCustomStopSequencesToggle = useCallback((enabled: boolean) => {
    chat.updateConfig({ customStopSequencesEnabled: enabled });
  }, [chat]);

  const handleCustomStopSequencesChange = useCallback((stops: string[]) => {
    chat.updateConfig({ customStopSequences: stops });
  }, [chat]);

  // 图片生成开关切换（Spec: add-conversation-image-generation）
  const handleImageGenToggle = useCallback((enabled: boolean) => {
    handleParameterChange({ image_gen_enabled: enabled });
  }, [handleParameterChange]);

  // 图片大小变更（Spec: add-conversation-image-generation）
  const handleImageGenSizeChange = useCallback((width: number, height: number) => {
    handleParameterChange({ image_gen_width: width, image_gen_height: height });
  }, [handleParameterChange]);

  // 互动标签权重变更（Spec: enhance-conversation-interaction-prompt-recognition）
  // 互动标签（disembodied_hand / hugging_another 等）拼接位置靠后，角色特征较多时容易被图像模型忽略，
  // 通过分类级权重提升加强。默认 1.2，范围 1.0-2.0，1.0 = 不提升。
  const handleInteractionWeightChange = useCallback((weight: number) => {
    // 兜底范围校验：限制在 1.0-2.0，保留 1 位小数
    const clamped = Math.min(2.0, Math.max(1.0, Math.round(weight * 10) / 10));
    handleParameterChange({ interaction_weight: clamped });
  }, [handleParameterChange]);

  // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化试验性功能开关
  // 开启后图片生成前 AI 会分析角色特征与对话上下文的矛盾，自动删除不再适用的标签
  const handleAiOptimizeTraitsToggle = useCallback((enabled: boolean) => {
    handleParameterChange({ ai_optimize_traits: enabled });
  }, [handleParameterChange]);

  return {
    handlePersonaChange,
    handleParameterChange,
    handleResetParameters,
    handleCustomStopSequencesToggle,
    handleCustomStopSequencesChange,
    handleImageGenToggle,
    handleImageGenSizeChange,
    handleInteractionWeightChange,
    handleAiOptimizeTraitsToggle,
  };
}

export type ChatConfigActions = ReturnType<typeof useConfigActions>;
