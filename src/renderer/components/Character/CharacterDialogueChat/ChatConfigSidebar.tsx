/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】配置侧栏组件（God Component 拆分 U1-3）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的配置面板区：
 * - configPanelElement：ConfigPanel 的 45+ props 组装（行内区与窄屏抽屉共用）
 * - 行内渲染：宽屏 70/30、中屏 80/20（可折叠）
 * - 窄屏抽屉：M4 U4 抽屉式（不占用消息区空间，默认收起）
 *
 * effectiveParams / engineCapabilities / imageGenEnabled 等派生值在此内部计算，
 * 调用方仅透传 chat 与布局档位。
 */
import React, { Suspense, lazy, useMemo } from 'react';
import { Drawer } from 'antd';
import { useChatUIStore } from './stores/useChatUIStore';
import { deriveThinkTagMode } from './CharacterDialogueChat.types';
import { getDefaultEngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import type { ChatHook } from './CharacterDialogueChat.hooks';
import type { ChatConfigActions } from './useConfigActions';
import type { CharacterInfo } from './CharacterDialogueChat.types';

// 【Phase 2 / M7】配置面板懒加载（首屏包体优化）
const LazyConfigPanel = lazy(() => import('./ConfigPanel').then(m => ({ default: m.default })));
const LazyFallback = <div style={{ padding: 24, color: '#888', fontSize: 12 }}>加载中...</div>;

interface ChatConfigSidebarProps {
  chat: ChatHook;
  characterInfo: CharacterInfo;
  configActions: ChatConfigActions;
  isFullscreen: boolean;
  /** 【Phase 2 / M4】布局档位（调用方派生后传入） */
  activeLayoutMode: 'wide' | 'medium' | 'narrow';
}

const ChatConfigSidebar: React.FC<ChatConfigSidebarProps> = ({ chat, characterInfo, configActions, isFullscreen, activeLayoutMode }) => {
  const configPanelCollapsed = useChatUIStore(s => s.configPanelCollapsed);
  const setConfigPanelCollapsed = useChatUIStore(s => s.setConfigPanelCollapsed);
  const characterConfig = chat.characterConfig;

  const effectiveParams = useMemo(() => chat.getEffectiveParams(), [chat.getEffectiveParams]);

  // 后端能力探测（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）
  // 优先使用引擎显式 capabilities 配置，缺省时按 api_mode 推断默认值。
  // 透传给 ParameterPanel 决定 repetition_penalty 滑块与 DRY 采样折叠区的显隐。
  const engineCapabilities = useMemo(() => {
    const activeEngine = chat.getActiveEngineConfig();
    if (!activeEngine) return undefined;
    return activeEngine.capabilities || getDefaultEngineCapabilities();
  }, [chat.getActiveEngineConfig]);

  const imageGenEnabled = characterConfig?.customParameters?.image_gen_enabled === true;

  // 【Phase 2 / M4】配置面板元素提取（行内区与窄屏抽屉共用，避免 props 重复）
  const configPanelElement = (
    <LazyConfigPanel
      characterCardId={characterInfo.characterCardId}
      characterCardName={characterInfo.characterCardName}
      selectedPersonaId={characterConfig?.selectedPersonaId}
      effectiveParams={effectiveParams}
      customParameters={characterConfig?.customParameters}
      personas={chat.personas}
      personasLoading={chat.personasLoading}
      boundKnowledgeBaseIds={characterConfig?.boundKnowledgeBaseIds || []}
      memoryTableEnabled={chat.memoryTableEnabled}
      memoryTableAutoOrganize={chat.memoryTableAutoOrganize}
      memoryTableOrganizeMode={chat.memoryTableOrganizeMode}
      memoryTableTemplateId={chat.memoryTableTemplateId}
      memoryTableTemplateName={chat.memoryTableTemplateName}
      tokenManagementConfig={chat.tokenManagementConfig}
      customStopSequencesEnabled={characterConfig?.customStopSequencesEnabled ?? false}
      customStopSequences={characterConfig?.customStopSequences}
      thinkTagMode={deriveThinkTagMode(characterConfig?.customParameters)}
      onThinkTagModeChange={(mode) => configActions.handleParameterChange({ think_tag_mode: mode })}
      assistMode={characterConfig?.customParameters?.assist_mode === true}
      onAssistModeToggle={(enabled) => configActions.handleParameterChange({ assist_mode: enabled })}
      language={characterConfig?.customParameters?.language ?? 'zh'}
      onLanguageChange={(lang) => configActions.handleParameterChange({ language: lang })}
      engineCapabilities={engineCapabilities}
      onPersonaChange={configActions.handlePersonaChange}
      onParameterChange={configActions.handleParameterChange}
      onResetParameters={configActions.handleResetParameters}
      onCustomStopSequencesToggle={configActions.handleCustomStopSequencesToggle}
      onCustomStopSequencesChange={configActions.handleCustomStopSequencesChange}
      onBindKnowledgeBase={chat.bindKnowledgeBase}
      onUnbindKnowledgeBase={chat.unbindKnowledgeBase}
      onMemoryTableToggle={chat.handleMemoryTableToggle}
      onMemoryTableAutoOrganizeToggle={chat.handleMemoryTableAutoOrganizeToggle}
      onMemoryTableOrganizeModeChange={chat.handleMemoryTableOrganizeModeChange}
      onMemoryTableTemplateAssociate={chat.handleMemoryTableTemplateAssociate}
      onMemoryTableManualOrganize={chat.handleManualOrganize}
      memoryTableManualOrganizing={chat.manualOrganizing}
      onTokenManagementConfigChange={chat.handleTokenManagementConfigChange}
      onSaveConfig={chat.saveConfig}
      imageGenEnabled={imageGenEnabled}
      imageGenWidth={characterConfig?.customParameters?.image_gen_width}
      imageGenHeight={characterConfig?.customParameters?.image_gen_height}
      onImageGenToggle={configActions.handleImageGenToggle}
      onImageGenSizeChange={configActions.handleImageGenSizeChange}
      // 【Spec: enhance-conversation-interaction-prompt-recognition】互动标签权重提升
      interactionWeight={characterConfig?.customParameters?.interaction_weight ?? 1.2}
      onInteractionWeightChange={configActions.handleInteractionWeightChange}
      // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化试验性功能
      aiOptimizeTraits={characterConfig?.customParameters?.ai_optimize_traits === true}
      onAiOptimizeTraitsToggle={configActions.handleAiOptimizeTraitsToggle}
    />
  );

  // 【Phase 2 / M4】行内显隐：宽屏恒显示；中屏随折叠开关；窄屏改走抽屉
  const configPanelInline = activeLayoutMode === 'wide' || (activeLayoutMode === 'medium' && !configPanelCollapsed);

  return (
    <>
      {/* 【Phase 2 / M4】宽屏/中屏（未折叠）：行内配置区（30%/20%） */}
      {configPanelInline && (
        <Suspense fallback={LazyFallback}>
          {configPanelElement}
        </Suspense>
      )}
      {/* 【Phase 2 / M4】窄屏：配置面板抽屉式（U4：不占用消息区空间，默认收起） */}
      {isFullscreen && activeLayoutMode === 'narrow' && (
        <Drawer
          title="配置面板"
          placement="right"
          width={420}
          open={!configPanelCollapsed}
          onClose={() => setConfigPanelCollapsed(true)}
          styles={{ body: { padding: 12, overflowY: 'auto' } }}
        >
          <Suspense fallback={LazyFallback}>
            {configPanelElement}
          </Suspense>
        </Drawer>
      )}
    </>
  );
};

export default ChatConfigSidebar;
