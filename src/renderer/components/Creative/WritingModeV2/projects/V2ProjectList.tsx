import React, { useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Tag, Empty, Spin, Progress, message, theme } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  EditOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { WritingProject } from '../../../../../shared/types/writing-v2.types';
import { ProjectStatus, ChapterStatus } from '../../../../../shared/types/writing-v2.types';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';
import { V2_PROJECT_STATUS_LABELS } from '../shared/v2Labels';

/**
 * V2 项目列表页（Phase 1 / P0）
 * 兼容打开 V1 创建的项目（同一项目库）。
 */
const V2ProjectList: React.FC = () => {
  const { token } = theme.useToken();
  const [searchText, setSearchText] = useState('');

  const projects = useV2ProjectStore((s) => s.projects);
  const isLoading = useV2ProjectStore((s) => s.isLoading);
  const loadProjects = useV2ProjectStore((s) => s.loadProjects);
  const currentProjectId = useV2ProjectStore((s) => s.currentProjectId);
  const selectProject = useV2ProjectStore((s) => s.selectProject);
  const deleteProject = useV2ProjectStore((s) => s.deleteProject);

  const stage = useV2UIStore((s) => s.stage);
  const setStage = useV2UIStore((s) => s.setStage);
  const setShowWizard = useV2UIStore((s) => s.setShowWizard);

  // 打开 V2 时刷新一次项目列表
  React.useEffect(() => {
    if (stage === 'projects') {
      loadProjects();
    }
  }, [stage, loadProjects]);

  const filtered = useMemo(
    () =>
      !searchText
        ? projects
        : projects.filter((p) =>
            p.title.toLowerCase().includes(searchText.toLowerCase())
          ),
    [projects, searchText]
  );

  const getProgress = (project: WritingProject): number => {
    const chapters = project.outline?.chapters || [];
    if (chapters.length === 0) return 0;
    const completed = chapters.filter(
      (ch) => ch.status === ChapterStatus.COMPLETED || (ch.content && ch.content.trim().length > 0)
    ).length;
    return Math.round((completed / chapters.length) * 100);
  };

  const handleOpenProject = (project: WritingProject) => {
    selectProject(project.id);
    setStage(project.outline?.chapters?.length ? 'writing' : 'outline');
  };

  const handleDelete = async (project: WritingProject) => {
    const ok = await deleteProject(project.id);
    if (ok) {
      message.success('项目已删除');
    } else {
      message.error('删除失败');
    }
  };

  const statusIcon = (status: ProjectStatus) => {
    switch (status) {
      case ProjectStatus.COMPLETED:
        return <CheckCircleOutlined style={{ color: token.colorSuccess }} />;
      case ProjectStatus.WRITING:
        return <EditOutlined style={{ color: token.colorWarning }} />;
      case ProjectStatus.OUTLINING:
        return <ClockCircleOutlined style={{ color: token.colorPrimary }} />;
      default:
        return <FileTextOutlined style={{ color: token.colorTextTertiary }} />;
    }
  };

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>项目列表</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索项目"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowWizard(true)}>
            新建项目
          </Button>
        </div>
      </div>

      <Spin spinning={isLoading}>
        {filtered.length === 0 && !isLoading ? (
          <Empty
            style={{ marginTop: 64 }}
            description="暂无项目，点击右上角新建"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((project) => {
              const progress = getProgress(project);
              const isSelected = currentProjectId === project.id;
              return (
                <div
                  key={project.id}
                  onClick={() => handleOpenProject(project)}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `1px solid ${isSelected ? token.colorPrimary : token.colorBorderSecondary}`,
                    background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {statusIcon(project.status)}
                    <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {project.title}
                    </span>
                    <Tag style={{ margin: 0 }}>{V2_PROJECT_STATUS_LABELS[project.status]}</Tag>
                    <Tag style={{ margin: 0, color: token.colorTextTertiary }}>
                      {project.outline?.chapters?.length || 0} 章
                    </Tag>
                    <Popconfirm
                      title="删除项目"
                      description="确定删除此项目？此操作不可撤销。"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDelete(project);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      fontSize: 12,
                      color: token.colorTextTertiary,
                    }}
                  >
                    <Progress
                      percent={progress}
                      size="small"
                      style={{ width: 160, margin: 0 }}
                    />
                    <span>更新于 {new Date(project.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Spin>
    </div>
  );
};

export default V2ProjectList;
