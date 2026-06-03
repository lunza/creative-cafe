import React, { useState } from 'react';
import { Button, Tag, message, Empty, Space } from 'antd';
import { CheckOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { GeneratedOutline, NovelType, ChapterOutline, ProjectStatus, ChapterStatus } from '../../../../shared/types/writing.types';
import { NOVEL_TYPE_LABELS } from '../../../../shared/constants/writing.constants';
import OutlineEditPanel from './OutlineEditPanel';
import ManualOutlineEditor from './ManualOutlineEditor';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

interface OutlineEditorProps {
  outline: GeneratedOutline | null;
  onConfirm: () => void;
  onRegenerate: () => void;
  onBack: () => void;
  projectId: string;
  initialMode?: 'ai' | 'manual';
}

const OutlineEditor: React.FC<OutlineEditorProps> = ({ 
  outline, 
  onConfirm, 
  onRegenerate, 
  onBack,
  projectId,
  initialMode = 'ai'
}) => {
  const [currentMode, setCurrentMode] = useState<'ai' | 'manual'>(initialMode);
  const [manualChapters, setManualChapters] = useState<ChapterOutline[]>(outline?.chapters || []);

  const handleManualChaptersChange = (chapters: ChapterOutline[]) => {
    setManualChapters(chapters);
    setCurrentMode('manual');
    
    const newOutline: GeneratedOutline = {
      workInfo: outline?.workInfo || {
        suggestedTitle: '手动大纲',
        novelType: NovelType.WEB_NOVEL,
        estimatedWordCount: chapters.reduce((sum, ch) => sum + (ch.targetWordCount || 0), 0),
        chapterCount: chapters.length,
        creativeDescription: ''
      },
      storyLine: outline?.storyLine || {
        coreConflict: '',
        storyArc: { beginning: '', development: '', climax: '', resolution: '' },
        theme: ''
      },
      chapters,
      characterRelationships: outline?.characterRelationships || [],
      worldbuildingNotes: outline?.worldbuildingNotes || []
    };
    useWritingModeStore.getState().setOutline(newOutline);
    useWritingModeStore.getState().setOutlineMode('manual');
    message.success('大纲已更新');
  };

  const handleConfirmOutline = async () => {
    const { updateProject, getCurrentProject } = useWritingProjectStore.getState();
    const project = getCurrentProject();
    if (!project) {
      message.error('未找到当前项目');
      return;
    }

    const finalOutline = currentMode === 'manual'
      ? {
          workInfo: outline?.workInfo || {
            suggestedTitle: '手动大纲',
            novelType: NovelType.WEB_NOVEL,
            estimatedWordCount: manualChapters.reduce((sum, ch) => sum + (ch.targetWordCount || 0), 0),
            chapterCount: manualChapters.length,
            creativeDescription: ''
          },
          storyLine: outline?.storyLine || {
            coreConflict: '',
            storyArc: { beginning: '', development: '', climax: '', resolution: '' },
            theme: ''
          },
          chapters: manualChapters,
          characterRelationships: outline?.characterRelationships || [],
          worldbuildingNotes: outline?.worldbuildingNotes || []
        }
      : outline;

    if (!finalOutline || finalOutline.chapters.length === 0) {
      message.error('大纲内容为空');
      return;
    }

    await updateProject(project.id, {
      outline: finalOutline,
      outlineRaw: JSON.stringify(finalOutline, null, 2),
      status: ProjectStatus.OUTLINING,
    });

    message.success('大纲已保存');
    onConfirm();
  };

  if (!outline && currentMode === 'ai') {
    return (
      <div style={{ padding: 24, textAlign: 'center', minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          description="暂无大纲"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" onClick={() => setCurrentMode('manual')}>
            手动创建大纲
          </Button>
          <Button onClick={onBack}>
            返回调整参数
          </Button>
        </Space>
      </div>
    );
  }

  const displayOutline = currentMode === 'ai' ? outline : {
    workInfo: outline?.workInfo || {
      suggestedTitle: '手动大纲',
      novelType: NovelType.WEB_NOVEL,
      estimatedWordCount: manualChapters.reduce((sum, ch) => sum + (ch.targetWordCount || 0), 0),
      chapterCount: manualChapters.length,
      creativeDescription: ''
    },
    storyLine: outline?.storyLine || {
      coreConflict: '',
      storyArc: { beginning: '', development: '', climax: '', resolution: '' },
      theme: ''
    },
    chapters: manualChapters,
    characterRelationships: outline?.characterRelationships || [],
    worldbuildingNotes: outline?.worldbuildingNotes || []
  };

  if (!displayOutline && currentMode === 'ai') {
    return <div>加载中...</div>;
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>{(displayOutline as GeneratedOutline).workInfo.suggestedTitle}</h2>
          <div style={{ marginTop: 4 }}>
            <Tag>{NOVEL_TYPE_LABELS[(displayOutline as GeneratedOutline).workInfo.novelType as NovelType]}</Tag>
            <Tag>目标 {(displayOutline as GeneratedOutline).workInfo.estimatedWordCount} 字</Tag>
            <Tag>{(displayOutline as GeneratedOutline).workInfo.chapterCount} 章</Tag>
            {(displayOutline as GeneratedOutline).workInfo.isComplete === false && (
              <Tag color="orange">未完结</Tag>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<EditOutlined />} onClick={onBack}>调整参数</Button>
          <Button icon={<ReloadOutlined />} onClick={onRegenerate}>重新生成</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirmOutline} size="large">
            确认大纲
          </Button>
        </div>
      </div>

      {currentMode === 'ai' ? (
        <OutlineEditPanel
          outline={displayOutline as GeneratedOutline}
          onConfirm={onConfirm}
          onRegenerate={onRegenerate}
          onBack={onBack}
          projectId={projectId}
        />
      ) : (
        <div style={{ height: '600px' }}>
          <ManualOutlineEditor
            chapters={manualChapters}
            onChange={handleManualChaptersChange}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  );
};

export default OutlineEditor;
