import React, { useState } from 'react';
import { message, Button, Space } from 'antd';
import { PlusOutlined, HistoryOutlined } from '@ant-design/icons';
import { OutlineEditSection, GeneratedOutline, StoryLine, CharacterRelationship, WorldbuildingNotes, ChapterOutline, AIEditResult } from '../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import EditTabNavigation from './EditTabNavigation';
import StorylineEditor from './StorylineEditor';
import CharacterRelationEditor from './CharacterRelationEditor';
import WorldSettingEditor from './WorldSettingEditor';
import ManualOutlineEditor from './ManualOutlineEditor';
import AIEditPrompt from './AIEditPrompt';
import OutlineContinuation from './OutlineContinuation';
import VersionHistoryPanel from './VersionHistoryPanel';
import VersionCompareModal from './VersionCompareModal';

interface OutlineEditPanelProps {
  outline: GeneratedOutline;
  onConfirm: () => void;
  onRegenerate: () => void;
  onBack: () => void;
  projectId: string;
}

const OutlineEditPanel: React.FC<OutlineEditPanelProps> = ({
  outline,
  onConfirm: _onConfirm,
  onRegenerate: _onRegenerate,
  onBack: _onBack,
  projectId,
}) => {
  const [activeSection, setActiveSection] = useState<OutlineEditSection>(OutlineEditSection.STORYLINE);
  const [aiEditVisible, setAiEditVisible] = useState(false);
  const [continuationVisible, setContinuationVisible] = useState(false);
  const [aiTargetId, setAiTargetId] = useState<string | undefined>();
  const [versionHistoryVisible, setVersionHistoryVisible] = useState(false);
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<string>('');

  const versions = useWritingModeStore((state) => state.versions);
  const currentVersionId = useWritingModeStore((state) => state.currentVersionId);
  const { addVersion, restoreVersion, setOutline } = useWritingModeStore.getState();

  const handleRestoreVersion = (versionId: string) => {
    restoreVersion(versionId);
    message.success('版本已恢复');
  };

  const handleCompareVersion = (versionId: string) => {
    setCompareVersionId(versionId);
    setCompareModalVisible(true);
  };

  const getCompareOutline = (): GeneratedOutline | null => {
    const version = versions.find(v => v.id === compareVersionId);
    return version?.outline || null;
  };

  const handleStoryLineChange = (storyLine: StoryLine) => {
    const updatedOutline: GeneratedOutline = {
      ...outline,
      storyLine,
    };
    setOutline(updatedOutline);
  };

  const handleCharacterChange = (characters: CharacterRelationship[]) => {
    const updatedOutline: GeneratedOutline = {
      ...outline,
      characterRelationships: characters,
    };
    setOutline(updatedOutline);
  };

  const handleWorldChange = (notes: WorldbuildingNotes[]) => {
    const updatedOutline: GeneratedOutline = {
      ...outline,
      worldbuildingNotes: notes,
    };
    setOutline(updatedOutline);
  };

  const handleChaptersChange = (chapters: ChapterOutline[]) => {
    const updatedOutline: GeneratedOutline = {
      ...outline,
      chapters,
    };
    setOutline(updatedOutline);
  };

  const handleContinuationConfirm = (newChapters: ChapterOutline[]) => {
    addVersion(outline, 'auto_save', `续写 ${newChapters.length} 个章节`);

    const existingChapters = outline.chapters;
    const allChapters = [...existingChapters, ...newChapters];
    const updatedOutline: GeneratedOutline = {
      ...outline,
      chapters: allChapters,
    };
    setOutline(updatedOutline);
    setContinuationVisible(false);
    message.success(`已添加 ${newChapters.length} 个章节`);
  };

  const handleContinuationCancel = () => {
    setContinuationVisible(false);
  };

  const handleAIEdit = (targetId?: string) => {
    addVersion(outline, 'auto_save', 'AI编辑前快照');
    setAiTargetId(targetId);
    setAiEditVisible(true);
  };

  const handleAIEditConfirm = (result: AIEditResult) => {
    if (!result.success) {
      message.error(result.error || 'AI编辑失败');
      return;
    }

    let updatedOutline: GeneratedOutline = { ...outline };

    if (result.content) {
      switch (activeSection) {
        case OutlineEditSection.STORYLINE:
          updatedOutline = {
            ...outline,
            storyLine: {
              ...outline.storyLine,
              coreConflict: result.content,
            },
          };
          break;
        case OutlineEditSection.CHARACTERS:
          if (result.changes) {
            updatedOutline = {
              ...outline,
              characterRelationships: result.changes.characters || outline.characterRelationships,
            };
          }
          break;
        case OutlineEditSection.WORLD:
          if (result.changes) {
            updatedOutline = {
              ...outline,
              worldbuildingNotes: result.changes.worldSettings || outline.worldbuildingNotes,
            };
          }
          break;
        case OutlineEditSection.CHAPTERS:
          if (result.changes && aiTargetId) {
            const chapterIndex = parseInt(aiTargetId);
            const chapterIdx = outline.chapters.findIndex((ch) => ch.index === chapterIndex);
            if (chapterIdx >= 0) {
              const updatedChapters = [...outline.chapters];
              updatedChapters[chapterIdx] = {
                ...updatedChapters[chapterIdx],
                summary: result.content || updatedChapters[chapterIdx].summary,
                ...result.changes,
              };
              updatedOutline = {
                ...outline,
                chapters: updatedChapters,
              };
            }
          }
          break;
      }
    } else if (result.changes) {
      updatedOutline = {
        ...outline,
        ...result.changes,
      };
    }

    setOutline(updatedOutline);
    setAiEditVisible(false);
    message.success('AI编辑已应用');
  };

  const renderEditor = () => {
    switch (activeSection) {
      case OutlineEditSection.STORYLINE:
        return (
          <StorylineEditor
            storyLine={outline.storyLine}
            onChange={handleStoryLineChange}
            projectId={projectId}
            onAIEdit={() => handleAIEdit()}
          />
        );
      case OutlineEditSection.CHARACTERS:
        return (
          <CharacterRelationEditor
            characterRelationships={outline.characterRelationships}
            onChange={handleCharacterChange}
            onAIEdit={() => handleAIEdit()}
          />
        );
      case OutlineEditSection.WORLD:
        return (
          <WorldSettingEditor
            worldbuildingNotes={outline.worldbuildingNotes}
            onChange={handleWorldChange}
            onAIEdit={() => handleAIEdit()}
          />
        );
      case OutlineEditSection.CHAPTERS:
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Space>
                <Button
                  icon={<HistoryOutlined />}
                  onClick={() => setVersionHistoryVisible(true)}
                >
                  版本历史
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setContinuationVisible(true)}
                >
                  续写章节
                </Button>
              </Space>
            </div>
            <div style={{ height: '600px' }}>
              <ManualOutlineEditor
                chapters={outline.chapters}
                onChange={handleChaptersChange}
                projectId={projectId}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const compareOutline = getCompareOutline();

  return (
    <div>
      <EditTabNavigation
        activeTab={activeSection}
        onTabChange={setActiveSection}
      />
      <div style={{ marginTop: 16 }}>
        {renderEditor()}
      </div>

      <AIEditPrompt
        visible={aiEditVisible}
        section={activeSection}
        targetId={aiTargetId}
        outline={outline}
        onConfirm={handleAIEditConfirm}
        onCancel={() => setAiEditVisible(false)}
      />

      <OutlineContinuation
        visible={continuationVisible}
        outline={outline}
        onConfirm={handleContinuationConfirm}
        onCancel={handleContinuationCancel}
        projectId={projectId}
      />

      <VersionHistoryPanel
        visible={versionHistoryVisible}
        versions={versions}
        currentVersionId={currentVersionId}
        onRestore={handleRestoreVersion}
        onCompare={handleCompareVersion}
        onClose={() => setVersionHistoryVisible(false)}
      />

      {compareModalVisible && compareOutline && (
        <VersionCompareModal
          oldOutline={compareOutline}
          newOutline={outline}
          visible={compareModalVisible}
          onClose={() => setCompareModalVisible(false)}
        />
      )}
    </div>
  );
};

export default OutlineEditPanel;
