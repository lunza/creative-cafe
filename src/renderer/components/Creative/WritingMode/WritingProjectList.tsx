import React, { useState } from 'react';
import { Card, Button, List, Tag, Empty, Spin, Input, Select, Popconfirm, message, Modal } from 'antd';
import { PlusOutlined, FolderOpenOutlined, DeleteOutlined, SearchOutlined, EditOutlined } from '@ant-design/icons';
import { WritingProject, ProjectStatus } from '../../../../shared/types/writing.types';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

interface WritingProjectListProps {
  projects: WritingProject[];
  isLoading: boolean;
  onNewProject: () => void;
  onContinueProject: (project: WritingProject) => void;
}

const statusLabels: Record<ProjectStatus, string> = {
  [ProjectStatus.DRAFT]: '草稿',
  [ProjectStatus.OUTLINING]: '大纲',
  [ProjectStatus.WRITING]: '创作中',
  [ProjectStatus.COMPLETED]: '已完成'
};

const statusColors: Record<ProjectStatus, string> = {
  [ProjectStatus.DRAFT]: 'default',
  [ProjectStatus.OUTLINING]: 'processing',
  [ProjectStatus.WRITING]: 'orange',
  [ProjectStatus.COMPLETED]: 'success'
};

const WritingProjectList: React.FC<WritingProjectListProps> = ({ projects, isLoading, onNewProject, onContinueProject }) => {
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('updatedAt');
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renamingProject, setRenamingProject] = useState<WritingProject | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const deleteProject = useWritingProjectStore((state) => state.deleteProject);
  const updateProject = useWritingProjectStore((state) => state.updateProject);

  const filteredProjects = projects
    .filter(p => {
      const matchSearch = p.title.toLowerCase().includes(searchText.toLowerCase());
      const matchStatus = filterStatus === 'all' || p.status === filterStatus;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'updatedAt') return b.updatedAt - a.updatedAt;
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh');
      if (sortBy === 'createdAt') return b.createdAt - a.createdAt;
      return 0;
    });

  const handleDelete = async (id: string) => {
    const success = await deleteProject(id);
    if (success) {
      message.success('已删除');
    } else {
      message.error('删除失败');
    }
  };

  const handleRename = (project: WritingProject) => {
    setRenamingProject(project);
    setNewTitle(project.title);
    setRenameModalVisible(true);
  };

  const handleRenameConfirm = async () => {
    if (!newTitle.trim() || !renamingProject) {
      message.warning('请输入项目名称');
      return;
    }
    const success = await updateProject(renamingProject.id, { title: newTitle.trim() });
    if (success) {
      message.success('重命名成功');
      setRenameModalVisible(false);
      setRenamingProject(null);
    } else {
      message.error('重命名失败');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>写作模式</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>AI 辅助小说创作</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={onNewProject} size="large">
          新建创作
        </Button>
      </div>

      {projects.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索项目..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            value={filterStatus}
            onChange={setFilterStatus}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: ProjectStatus.DRAFT, label: statusLabels[ProjectStatus.DRAFT] },
              { value: ProjectStatus.OUTLINING, label: statusLabels[ProjectStatus.OUTLINING] },
              { value: ProjectStatus.WRITING, label: statusLabels[ProjectStatus.WRITING] },
              { value: ProjectStatus.COMPLETED, label: statusLabels[ProjectStatus.COMPLETED] },
            ]}
          />
          <Select
            value={sortBy}
            onChange={setSortBy}
            style={{ width: 120 }}
            options={[
              { value: 'updatedAt', label: '按更新时间' },
              { value: 'createdAt', label: '按创建时间' },
              { value: 'title', label: '按名称' },
            ]}
          />
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin />
        </div>
      ) : filteredProjects.length === 0 ? (
        <Empty description={searchText || filterStatus !== 'all' ? '未找到匹配的项目' : '暂无创作项目'}>
          <Button type="primary" onClick={onNewProject}>开始新创作</Button>
        </Empty>
      ) : (
        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3 }}
          dataSource={filteredProjects}
          renderItem={(project) => (
            <List.Item>
              <Card
                hoverable
                actions={[
                  <Button
                    type="primary"
                    icon={<FolderOpenOutlined />}
                    onClick={() => onContinueProject(project)}
                  >
                    继续创作
                  </Button>
                ]}
              >
                <Card.Meta
                  title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>{project.title}</span>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRename(project);
                          }}
                          style={{ padding: '0 4px' }}
                        />
                      </div>
                      <Tag color={statusColors[project.status]}>{statusLabels[project.status]}</Tag>
                    </div>
                  }
                  description={
                    <div style={{ fontSize: 12, color: '#999' }}>
                      <div>类型: {project.config?.parameters?.novelType}</div>
                      <div>
                        进度: {project.metadata?.completedChapters || 0}/{project.config?.parameters?.chapterCount || 0} 章
                      </div>
                      <div>字数: {project.metadata?.totalWordCount || 0}</div>
                      <div>更新时间: {new Date(project.updatedAt).toLocaleDateString()}</div>
                    </div>
                  }
                />
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                  <Popconfirm
                    title="确定删除此项目？"
                    description="删除后无法恢复"
                    onConfirm={() => handleDelete(project.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                  </Popconfirm>
                </div>
              </Card>
            </List.Item>
          )}
        />
      )}
      <Modal
        title="重命名项目"
        open={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={() => {
          setRenameModalVisible(false);
          setRenamingProject(null);
        }}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onPressEnter={handleRenameConfirm}
          autoFocus
          maxLength={50}
          showCount
        />
      </Modal>
    </div>
  );
};

export default WritingProjectList;
