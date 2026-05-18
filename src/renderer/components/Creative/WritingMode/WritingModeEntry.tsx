import React, { useEffect } from 'react';
import { theme } from 'antd';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { WritingModeView, WritingProject, WritingConfig, ChapterStatus, ProjectStatus } from '../../../../shared/types/writing.types';
import WritingProjectList from './WritingProjectList';
import WritingConfigPanel from './WritingConfigPanel';
import OutlineEditor from './OutlineEditor';
import ContentWorkspace from './ContentWorkspace';
import { Spin, Alert } from 'antd';

const WritingModeEntry: React.FC = () => {
  const currentView = useWritingModeStore((state) => state.currentView);
  const setCurrentView = useWritingModeStore((state) => state.setCurrentView);
  const setConfig = useWritingModeStore((state) => state.setConfig);
  const config = useWritingModeStore((state) => state.config);
  const outline = useWritingModeStore((state) => state.outline);
  const isOutlineGenerating = useWritingModeStore((state) => state.isOutlineGenerating);
  const reset = useWritingModeStore((state) => state.reset);

  const currentProjectId = useWritingProjectStore((state) => state.currentProjectId);
  const setCurrentProject = useWritingProjectStore((state) => state.setCurrentProject);
  const loadProjects = useWritingProjectStore((state) => state.loadProjects);
  const projects = useWritingProjectStore((state) => state.projects);
  const isLoading = useWritingProjectStore((state) => state.isLoading);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);

  const { token } = theme.useToken();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleNewProject = () => {
    setCurrentProject(null);
    reset();
    setCurrentView(WritingModeView.CONFIG);
  };

  const handleContinueProject = (project: WritingProject) => {
    setCurrentProject(project.id);
    reset();
    setConfig(project.config);
    if (project.outline) {
      useWritingModeStore.getState().setOutline(project.outline);
      setCurrentView(WritingModeView.CONTENT_GENERATION);
    } else {
      setCurrentView(WritingModeView.OUTLINE_EDITING);
    }
  };

  const handleConfigConfirm = (config: WritingConfig) => {
    setConfig(config);
    setCurrentView(WritingModeView.OUTLINE_EDITING);
  };

  const handleOutlineConfirm = async () => {
    if (!config || !outline) return;

    const projectId = await useWritingProjectStore.getState().createProject(config);
    if (projectId) {
      useWritingProjectStore.getState().setCurrentProject(projectId);
      await useWritingProjectStore.getState().updateProject(projectId, {
        outline,
        outlineRaw: useWritingModeStore.getState().outlineRaw || null,
        status: ProjectStatus.IN_PROGRESS
      });
    }
    setCurrentView(WritingModeView.CONTENT_GENERATION);
  };

  const handleBack = () => {
    if (currentView === WritingModeView.CONFIG) {
      setCurrentView(WritingModeView.PROJECT_LIST);
    } else if (currentView === WritingModeView.OUTLINE_GENERATING || currentView === WritingModeView.OUTLINE_EDITING) {
      setCurrentView(WritingModeView.CONFIG);
    } else if (currentView === WritingModeView.CONTENT_GENERATING || currentView === WritingModeView.CONTENT_EDITING || currentView === WritingModeView.CONTENT_GENERATION) {
      setCurrentView(WritingModeView.OUTLINE_EDITING);
    }
  };

  const renderView = () => {
    switch (currentView) {
      case WritingModeView.PROJECT_LIST:
        return (
          <WritingProjectList
            projects={projects}
            isLoading={isLoading}
            onNewProject={handleNewProject}
            onContinueProject={handleContinueProject}
          />
        );
      case WritingModeView.CONFIG:
        return (
          <WritingConfigPanel
            onConfirm={handleConfigConfirm}
            onCancel={handleBack}
          />
        );
      case WritingModeView.OUTLINE_GENERATING:
        return (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <Spin size="large" tip="正在生成大纲..." />
            <div style={{ marginTop: 16 }}>
              AI 正在分析创意并生成结构化大纲，请稍候...
            </div>
          </div>
        );
      case WritingModeView.OUTLINE_EDITING:
        if (!outline) {
          return <Alert message="未找到大纲" type="warning" />;
        }
        return (
          <OutlineEditor
            outline={outline}
            onConfirm={handleOutlineConfirm}
            onRegenerate={() => setCurrentView(WritingModeView.CONFIG)}
            onBack={handleBack}
          />
        );
      case WritingModeView.CONTENT_GENERATING:
      case WritingModeView.CONTENT_GENERATION:
      case WritingModeView.CONTENT_EDITING:
        return (
          <ContentWorkspace
            outline={outline}
            projectId={currentProjectId || 'current'}
            onBack={handleBack}
          />
        );
      default:
        return <div>未知视图</div>;
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: token.colorBgLayout }}>
      {currentView !== WritingModeView.PROJECT_LIST && (
        <div style={{ padding: '8px 16px', background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <button
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: token.colorTextSecondary
            }}
          >
            ← 返回
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderView()}
      </div>
    </div>
  );
};

export default WritingModeEntry;
