import React from 'react';
import PersonaPanel from './PersonaPanel';
import ParameterPanel from './ParameterPanel';
import { UserPersona, AIParameterConfig, EffectiveAIParams } from './CharacterTestChat.types';
import './ConfigPanel.css';

interface ConfigPanelProps {
  characterCardId: string;
  selectedPersonaId: string | undefined;
  effectiveParams: EffectiveAIParams;
  customParameters: AIParameterConfig | undefined;
  personas: UserPersona[];
  personasLoading: boolean;
  onPersonaChange: (personaId: string) => void;
  onParameterChange: (params: Partial<AIParameterConfig>) => void;
  onResetParameters: () => void;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({
  selectedPersonaId,
  effectiveParams,
  customParameters,
  personas,
  personasLoading,
  onPersonaChange,
  onParameterChange,
  onResetParameters,
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
      />
    </div>
  );
};

export default ConfigPanel;
