import React from 'react';
import { Button } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import PersonaPanel from './PersonaPanel';
import ParameterPanel from './ParameterPanel';
import VectorizationPanel from './VectorizationPanel';
import MemoryTablePanel from './MemoryTablePanel';
import TokenManagementPanel from './TokenManagementPanel';
import { UserPersona, AIParameterConfig, EffectiveAIParams } from './CharacterDialogueChat.types';
import { EngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import './ConfigPanel.css';

interface TokenManagementConfig {
  maxContextTokens?: number;
  reservedForResponse?: number;
  minMessagesToKeep?: number;
  maxMessagesToKeep?: number;
}

interface ConfigPanelProps {
  characterCardId: string;
  characterCardName: string;
  selectedPersonaId: string | undefined;
  effectiveParams: EffectiveAIParams;
  customParameters: AIParameterConfig | undefined;
  personas: UserPersona[];
  personasLoading: boolean;
  boundKnowledgeBaseIds: string[];
  memoryTableEnabled: boolean;
  memoryTableAutoOrganize: boolean;
  memoryTableOrganizeMode: 'sync' | 'async';
  memoryTableTemplateId: string | null;
  memoryTableTemplateName: string;
  tokenManagementConfig: TokenManagementConfig;
  // 自定义停止序列（Spec: optimize-chat-ai-intelligence / Task 3.4）
  customStopSequencesEnabled?: boolean;
  customStopSequences?: string[];
  /**
   * 后端能力探测结果（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）。
   * 透传给 ParameterPanel，决定 repetition_penalty 滑块与 DRY 采样折叠区的显隐。
   */
  engineCapabilities?: EngineCapabilities;
  onPersonaChange: (personaId: string) => void;
  onParameterChange: (params: Partial<AIParameterConfig>) => void;
  onResetParameters: () => void;
  onCustomStopSequencesToggle?: (enabled: boolean) => void;
  onCustomStopSequencesChange?: (stops: string[]) => void;
  onBindKnowledgeBase: (documentId: string) => void;
  onUnbindKnowledgeBase: (documentId: string) => void;
  onMemoryTableToggle: (enabled: boolean) => void;
  onMemoryTableAutoOrganizeToggle: (enabled: boolean) => void;
  onMemoryTableOrganizeModeChange: (mode: 'sync' | 'async') => void;
  onMemoryTableTemplateAssociate: (templateId: string, templateName: string) => void;
  onTokenManagementConfigChange: (config: Partial<TokenManagementConfig>) => void;
  onSaveConfig: () => void;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({
  characterCardId,
  characterCardName,
  selectedPersonaId,
  effectiveParams,
  customParameters,
  personas,
  personasLoading,
  boundKnowledgeBaseIds,
  memoryTableEnabled,
  memoryTableAutoOrganize,
  memoryTableOrganizeMode,
  memoryTableTemplateId,
  memoryTableTemplateName,
  tokenManagementConfig,
  customStopSequencesEnabled,
  customStopSequences,
  engineCapabilities,
  onPersonaChange,
  onParameterChange,
  onResetParameters,
  onCustomStopSequencesToggle,
  onCustomStopSequencesChange,
  onBindKnowledgeBase,
  onUnbindKnowledgeBase,
  onMemoryTableToggle,
  onMemoryTableAutoOrganizeToggle,
  onMemoryTableOrganizeModeChange,
  onMemoryTableTemplateAssociate,
  onTokenManagementConfigChange,
  onSaveConfig,
}) => {
  return (
    <div className="config-panel">
      <PersonaPanel
        personas={personas}
        selectedPersonaId={selectedPersonaId}
        loading={personasLoading}
        onPersonaChange={onPersonaChange}
      />
      <div className="config-panel-divider" />
      <ParameterPanel
        effectiveParams={effectiveParams}
        customParameters={customParameters}
        onParameterChange={onParameterChange}
        onResetParameters={onResetParameters}
        customStopSequencesEnabled={customStopSequencesEnabled}
        customStopSequences={customStopSequences}
        onCustomStopSequencesToggle={onCustomStopSequencesToggle}
        onCustomStopSequencesChange={onCustomStopSequencesChange}
        engineCapabilities={engineCapabilities}
      />
      <div className="config-panel-divider" />
      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--config-panel-sub-title-color)', marginBottom: 8 }}>
        记忆与上下文增强
      </div>
      <VectorizationPanel
        characterCardId={characterCardId}
        boundKnowledgeBaseIds={boundKnowledgeBaseIds}
        onBindKnowledgeBase={onBindKnowledgeBase}
        onUnbindKnowledgeBase={onUnbindKnowledgeBase}
      />
      <div style={{ fontSize: '12px', color: 'var(--config-panel-sub-text-color, #94a3b8)', marginTop: 4 }}>
        从文档中检索相关知识注入上下文
      </div>
      <div className="config-panel-divider" />
      <MemoryTablePanel
        enabled={memoryTableEnabled}
        autoOrganize={memoryTableAutoOrganize}
        organizeMode={memoryTableOrganizeMode}
        associatedTemplateId={memoryTableTemplateId}
        associatedTemplateName={memoryTableTemplateName}
        characterCardName={characterCardName}
        onToggle={onMemoryTableToggle}
        onAutoOrganizeToggle={onMemoryTableAutoOrganizeToggle}
        onOrganizeModeChange={onMemoryTableOrganizeModeChange}
        onTemplateAssociate={onMemoryTableTemplateAssociate}
      />
      <div style={{ fontSize: '12px', color: 'var(--config-panel-sub-text-color, #94a3b8)', marginTop: 4 }}>
        AI 自动整理对话中的关键信息到表格
      </div>
      <div className="config-panel-divider" />
      <TokenManagementPanel
        config={tokenManagementConfig}
        onConfigChange={onTokenManagementConfigChange}
      />
      <div className="config-panel-divider" />
      <div className="config-panel-actions">
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={onSaveConfig}
          className="config-save-btn"
          block
        >
          保存设置
        </Button>
      </div>
    </div>
  );
};

export default ConfigPanel;
