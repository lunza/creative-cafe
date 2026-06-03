import React, { useCallback, useState, useEffect } from 'react';
import { Layout, Menu, Button, Avatar, Badge, Input, Divider, Tooltip, Space, Tag, Popconfirm, message } from 'antd';
import {
  PlusOutlined,
  FileTextOutlined,
  EditOutlined,
  BookOutlined,
  ExportOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FolderOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  MinusCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { useWritingModeUIStore, LayoutMode, ActivePanel, RightPanelTab } from '../../../stores/writingModeUIStore';
import { WritingProject, ProjectStatus, ChapterStatus } from '../../../../shared/types/writing.types';
import { PROJECT_STATUS_LABELS } from '../../../../shared/constants/writing.constants';
import WritingConfigModal from './WritingConfigModal';
import OutlineEditor from './OutlineEditor';
import ContentWorkspace from './ContentWorkspace';

const { Sider, Content } = Layout;
const { Search } = Input;

interface StageItem {
  key: ActivePanel;
  icon: React.ReactNode;
  label: string;
}

const STAGES: StageItem[] = [
  { key: ActivePanel.PROJECTS, icon: <FolderOutlined />, label: '项目列表' },
  { key: ActivePanel.OUTLINE, icon: <FileTextOutlined />, label: '大纲设计' },
  { key: ActivePanel.CONTENT, icon: <EditOutlined />, label: '内容创作' },
  { key: ActivePanel.EXPORT, icon: <ExportOutlined />, label: '审阅导出' },
];

const WritingModeEntry: React.FC = () => {
  const { token } = theme.useToken();
  const [searchText, setSearchText] = useState('');
  const [showConfigModal, setShowConfigModal] = useState(false);

  const projects = useWritingProjectStore((state) => state.projects);
  const currentProjectId = useWritingProjectStore((state) => state.currentProjectId);
  const isLoading = useWritingProjectStore((state) => state.isLoading);
  const loadProjects = useWritingProjectStore((state) => state.loadProjects);
  const setCurrentProject = useWritingProjectStore((state) => state.setCurrentProject);
  const getCurrentProject = useWritingProjectStore((state) => state.getCurrentProject);

  // 直接从 store 订阅的数据派生 currentProject，确保 loadProjects 完成后能正确更新
  const currentProject = currentProjectId ? projects.find(p => p.id === currentProjectId) || null : null;

  const layoutMode = useWritingModeUIStore((state) => state.layoutMode);
  const sidebarCollapsed = useWritingModeUIStore((state) => state.sidebarCollapsed);
  const rightPanelVisible = useWritingModeUIStore((state) => state.rightPanelVisible);
  const toggleRightPanel = useWritingModeUIStore((state) => state.toggleRightPanel);
  const activePanel = useWritingModeUIStore((state) => state.activePanel);
  const selectedProjectId = useWritingModeUIStore((state) => state.selectedProjectId);
  const setActivePanel = useWritingModeUIStore((state) => state.setActivePanel);
  const setSelectedProject = useWritingModeUIStore((state) => state.setSelectedProject);
  const toggleSidebar = useWritingModeUIStore((state) => state.toggleSidebar);
  const updateWindowWidth = useWritingModeUIStore((state) => state.updateWindowWidth);
  const detectLayoutMode = useWritingModeUIStore((state) => state.detectLayoutMode);

  useEffect(() => {
    console.log('[WritingModeEntry] Component mounted, loading projects...');
    loadProjects();
    const handleResize = () => {
      const width = window.innerWidth;
      updateWindowWidth(width);
      detectLayoutMode(width);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    console.log('[WritingModeEntry] State changed:', {
      currentProjectId,
      projectsCount: projects.length,
      hasCurrentProject: !!currentProject,
      outlineExists: !!currentProject?.outline,
      chapterCount: currentProject?.outline?.chapters?.length,
      activePanel
    });
  }, [currentProjectId, projects, currentProject, activePanel]);

  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find(p => p.id === selectedProjectId);
      if (project) {
        if (project.outline) {
          setActivePanel(ActivePanel.CONTENT);
        } else {
          setActivePanel(ActivePanel.OUTLINE);
        }
      }
    }
  }, [selectedProjectId]);

  const handleNewProject = useCallback(() => {
    setShowConfigModal(true);
  }, []);

  const handleConfigConfirm = useCallback(async (config, projectId?: string) => {
    let finalProjectId = projectId;
    if (!finalProjectId) {
      finalProjectId = await useWritingProjectStore.getState().createProject(config);
    }
    if (finalProjectId) {
      setCurrentProject(finalProjectId);
      setSelectedProject(finalProjectId);
      loadProjects();
    }
    setShowConfigModal(false);
  }, []);

  const handleSelectProject = useCallback((project: WritingProject) => {
    setCurrentProject(project.id);
    setSelectedProject(project.id);
    if (project.outline) {
      setActivePanel(ActivePanel.CONTENT);
    } else {
      setActivePanel(ActivePanel.OUTLINE);
    }
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.electronAPI?.writing) return;
    try {
      await window.electronAPI.writing.deleteProject(projectId);
      loadProjects();
      setSelectedProject(null);
      setCurrentProject(null);
      setActivePanel(ActivePanel.PROJECTS);
    } catch (err) {
      message.error('删除项目失败');
    }
  }, []);

  const handleStageClick = useCallback((key: string) => {
    if (key === ActivePanel.PROJECTS) {
      setSelectedProject(null);
      setActivePanel(ActivePanel.PROJECTS);
    } else {
      if (!selectedProjectId) return;
      setActivePanel(key as ActivePanel);
    }
  }, [selectedProjectId]);

  const filteredProjects = projects.filter(p =>
    !searchText ||
    p.config.parameters.creativeDescription.toLowerCase().includes(searchText.toLowerCase())
  );

  const getProjectProgress = (project: WritingProject): number => {
    if (!project.outline?.chapters || project.outline.chapters.length === 0) return 0;
    const completed = project.outline.chapters.filter(ch => ch.status === ChapterStatus.COMPLETED).length;
    return Math.round((completed / project.outline.chapters.length) * 100);
  };

  const getProjectStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case ProjectStatus.COMPLETED:
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case ProjectStatus.IN_PROGRESS:
      case ProjectStatus.WRITING:
        return <ClockCircleOutlined style={{ color: '#faad14' }} />;
      default:
        return <MinusCircleOutlined style={{ color: '#d9d9d9' }} />;
    }
  };

  const renderMainContent = () => {
    if (activePanel === ActivePanel.PROJECTS) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}>
          <div style={{ textAlign: 'center' }}>
            <BookOutlined style={{ fontSize: 64, color: token.colorTextTertiary, marginBottom: 16 }} />
            <h3 style={{ color: token.colorTextSecondary, margin: 0 }}>选择一个项目开始创作</h3>
            <p style={{ color: token.colorTextTertiary }}>从左侧列表选择项目，或创建新项目</p>
          </div>
        </div>
      );
    }

    if (!currentProject) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}>
          <div style={{ textAlign: 'center' }}>
            <FolderOutlined style={{ fontSize: 64, color: token.colorTextTertiary, marginBottom: 16 }} />
            <h3 style={{ color: token.colorTextSecondary, margin: 0 }}>暂无选中项目</h3>
            <p style={{ color: token.colorTextTertiary }}>请先从左侧列表选择一个项目</p>
            {/* DEBUG UI */}
            <div style={{ marginTop: 16, padding: 12, background: '#1a1a1a', color: '#ff4d4f', fontSize: 12, fontFamily: 'monospace', textAlign: 'left' }}>
              <div>currentProjectId: {currentProjectId || 'NULL'}</div>
              <div>projects.length: {projects.length}</div>
              <div>selectedProjectId: {selectedProjectId || 'NULL'}</div>
            </div>
          </div>
        </div>
      );
    }

    switch (activePanel) {
      case ActivePanel.OUTLINE:
        return (
          <OutlineEditor
            outline={currentProject.outline || null}
            onConfirm={() => setActivePanel(ActivePanel.CONTENT)}
            onRegenerate={() => {}}
            onBack={() => setActivePanel(ActivePanel.PROJECTS)}
            projectId={currentProject.id}
            initialMode={currentProject.config.manualMode ? 'manual' : 'ai'}
          />
        );
      case ActivePanel.CONTENT:
        return (
          <ContentWorkspace
            outline={currentProject.outline || null}
            projectId={currentProject.id}
            onBack={() => setActivePanel(ActivePanel.OUTLINE)}
          />
        );
      case ActivePanel.EXPORT:
        return (
          <div style={{ padding: 24 }}>
            <h2>审阅导出</h2>
            <p>此功能开发中...</p>
          </div>
        );
      default:
        return null;
    }
  };

  const rightPanelWidth = layoutMode === LayoutMode.WIDE ? 300 : 0;
  const sidebarWidth = sidebarCollapsed ? 60 : 220;

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        collapsedWidth={60}
        theme="light"
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: 'auto' }}
      >
        <div style={{ padding: sidebarCollapsed ? '16px 8px' : '16px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {!sidebarCollapsed && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>写作模式</span>
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNewProject}>
                  新建
                </Button>
              </div>
              <Search
                size="small"
                placeholder="搜索项目"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ marginBottom: 12 }}
              />
            </>
          )}

          {sidebarCollapsed && (
            <Tooltip title="新建项目">
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleNewProject}
                style={{ marginBottom: 12 }}
              />
            </Tooltip>
          )}

          <Divider style={{ margin: '8px 0' }} />

          {!sidebarCollapsed && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              {filteredProjects.map(project => {
                const progress = getProjectProgress(project);
                const isSelected = selectedProjectId === project.id;
                return (
                  <div
                    key={project.id}
                    onClick={() => handleSelectProject(project)}
                    style={{
                      padding: '10px 12px',
                      marginBottom: 4,
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: isSelected ? token.colorPrimaryBg : 'transparent',
                      border: `1px solid ${isSelected ? token.colorPrimary : 'transparent'}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {getProjectStatusIcon(project.status)}
                      <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.config.parameters.creativeDescription.substring(0, 12)}
                      </span>
                      <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{progress}%</Tag>
                      <Popconfirm
                        title="删除项目"
                        description="确定要删除此项目吗？此操作不可撤销。"
                        onConfirm={(e) => handleDeleteProject(project.id, e)}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="确定"
                        cancelText="取消"
                      >
                        <DeleteOutlined
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: token.colorError, cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
                        />
                      </Popconfirm>
                    </div>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {PROJECT_STATUS_LABELS[project.status]} · {project.outline?.chapters?.length || 0} 章
                    </div>
                  </div>
                );
              })}
              {filteredProjects.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, color: token.colorTextTertiary }}>
                  <FileTextOutlined style={{ fontSize: 24, marginBottom: 8 }} />
                  <div style={{ fontSize: 12 }}>暂无项目</div>
                </div>
              )}
            </div>
          )}

          <Divider style={{ margin: '8px 0' }} />

          <Menu
            mode="inline"
            selectedKeys={[activePanel]}
            onClick={({ key }) => handleStageClick(key)}
            style={{ border: 'none', flex: sidebarCollapsed ? 'none' : 1 }}
            items={STAGES.map(stage => ({
              key: stage.key,
              icon: stage.icon,
              label: sidebarCollapsed ? null : stage.label,
              disabled: stage.key !== ActivePanel.PROJECTS && !selectedProjectId,
            }))}
          />

          <div style={{ marginTop: 'auto', paddingTop: 8 }}>
            {!sidebarCollapsed && layoutMode === LayoutMode.WIDE && (
              <Tooltip title={rightPanelVisible ? '关闭辅助面板' : '打开辅助面板'}>
                <Button
                  type="text"
                  icon={rightPanelVisible ? <CloseOutlined /> : <AppstoreOutlined />}
                  onClick={() => toggleRightPanel()}
                  block
                  size="small"
                  style={{ marginBottom: 4 }}
                />
              </Tooltip>
            )}
            <Tooltip title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}>
              <Button
                type="text"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleSidebar}
                block
                size="small"
              />
            </Tooltip>
          </div>
        </div>
      </Sider>

      <Content style={{ overflow: 'auto', position: 'relative' }}>
        {renderMainContent()}
      </Content>

      <WritingConfigModal
        open={showConfigModal}
        onConfirm={handleConfigConfirm}
        onCancel={() => setShowConfigModal(false)}
      />
    </Layout>
  );
};

export default WritingModeEntry;
