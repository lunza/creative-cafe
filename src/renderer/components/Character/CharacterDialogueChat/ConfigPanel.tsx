import React from 'react';
import { Button } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import PersonaPanel from './PersonaPanel';
import ParameterPanel from './ParameterPanel';
import VectorizationPanel from './VectorizationPanel';
import MemoryTablePanel from './MemoryTablePanel';
import { UserPersona, AIParameterConfig, EffectiveAIParams } from './CharacterDialogueChat.types';
import './ConfigPanel.css';

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
  onPersonaChange: (personaId: string) => void;
  onParameterChange: (params: Partial<AIParameterConfig>) => void;
  onResetParameters: () => void;
  onBindKnowledgeBase: (documentId: string) => void;
  onUnbindKnowledgeBase: (documentId: string) => void;
  onMemoryTableToggle: (enabled: boolean) => void;
  onMemoryTableAutoOrganizeToggle: (enabled: boolean) => void;
  onMemoryTableOrganizeModeChange: (mode: 'sync' | 'async') => void;
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
  onPersonaChange,
  onParameterChange,
  onResetParameters,
  onBindKnowledgeBase,
  onUnbindKnowledgeBase,
  onMemoryTableToggle,
  onMemoryTableAutoOrganizeToggle,
  onMemoryTableOrganizeModeChange,
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
      <VectorizationPanel
        characterCardId={characterCardId}
        boundKnowledgeBaseIds={boundKnowledgeBaseIds}
        onBindKnowledgeBase={onBindKnowledgeBase}
        onUnbindKnowledgeBase={onUnbindKnowledgeBase}
      />
      <div className="config-panel-divider" />
      <MemoryTablePanel
        enabled={memoryTableEnabled}
        autoOrganize={memoryTableAutoOrganize}
        organizeMode={memoryTableOrganizeMode}
        characterCardName={characterCardName}
        onToggle={onMemoryTableToggle}
        onAutoOrganizeToggle={onMemoryTableAutoOrganizeToggle}
        onOrganizeModeChange={onMemoryTableOrganizeModeChange}
      />
      <div className="config-panel-divider" />
      <ParameterPanel
        effectiveParams={effectiveParams}
        customParameters={customParameters}
        onParameterChange={onParameterChange}
        onResetParameters={onResetParameters}
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
