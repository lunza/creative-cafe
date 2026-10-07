import React from 'react';
import { Button, Empty, Layout, Menu, Tag, theme } from 'antd';
import {
  FolderOutlined,
  FileTextOutlined,
  EditOutlined,
  ExportOutlined,
  PlusOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import type { V2Stage } from './stores/useV2UIStore';
import { useV2UIStore } from './stores/useV2UIStore';
import { useV2ProjectStore } from './stores/useV2ProjectStore';
import V2ProjectList from './projects/V2ProjectList';
import V2NewProjectWizard from './projects/V2NewProjectWizard';
import V2OutlineWorkbench from './outline/V2OutlineWorkbench';
import V2ChapterWorkbench from './writing/V2ChapterWorkbench';
import V2ExportDialog from './export/V2ExportDialog';
import V2AssetsStage from './assets/V2AssetsStage';
import V2BoundResourceBar from './shared/V2BoundResourceBar';
import V2PipelineSelfTest from './V2PipelineSelfTest';

/**
 * 写作模式 2.0 入口（Phase 1 完整版）
 *
 * Spec: refactor-writing-mode-v2 / Phase 1
 * 4 阶段路由（useV2UIStore.stage）：
 *   projects → V2ProjectList；outline → V2OutlineWorkbench；
 *   writing → V2ChapterWorkbench；export → 导出页（复用 V2ExportDialog）。
 * 全局挂载新建向导与导出对话框（均经 UI store 控制可见性）。
 */

// 注：import.meta.env 由 Vite 注入，但项目未引用 vite/client 类型，故用 as any 访问（同 LazyImage 模式）
const IS_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;

const STAGES: Array<{ key: V2Stage; icon: React.ReactNode; label: string }> = [
  { key: 'projects', icon: <FolderOutlined />, label: '项目列表' },
  { key: 'outline', icon: <FileTextOutlined />, label: '大纲设计' },
  { key: 'writing', icon: <EditOutlined />, label: '内容创作' },
  { key: 'export', icon: <ExportOutlined />, label: '审阅导出' },
  { key: 'assets', icon: <DatabaseOutlined />, label: '素材与风格' },
];

const WritingV2Entry: React.FC = () => {
  const { token } = theme.useToken();
  const stage = useV2UIStore((s) => s.stage);
  const setStage = useV2UIStore((s) => s.setStage);
  const setShowWizard = useV2UIStore((s) => s.setShowWizard);
  const setShowExportDialog = useV2UIStore((s) => s.setShowExportDialog);
  const project = useV2ProjectStore((s) => s.getCurrentProject());

  const hasProject = !!project;
  const hasOutline = !!project?.outline && (project.outline.chapters?.length ?? 0) > 0;

  const stageDisabled = (key: V2Stage): boolean => {
    if (key === 'outline' || key === 'export') return !hasProject;
    if (key === 'writing') return !hasOutline;
    return false;
  };

  return (
    <Layout style={{ height: '100%', overflow: 'hidden' }}>
      <Layout.Sider width={200} style={{ background: token.colorBgContainer }}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              写作模式 <Tag color="blue" style={{ marginLeft: 4 }}>2.0</Tag>
            </span>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setShowWizard(true)}
            >
              新建
            </Button>
          </div>
          {hasProject && (
            <div
              style={{
                padding: '6px 10px',
                marginBottom: 8,
                borderRadius: 6,
                background: token.colorFillQuaternary,
                fontSize: 12,
                color: token.colorTextSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={project.title}
            >
              当前项目：{project.title || '未命名'}
            </div>
          )}
          <Menu
            mode="inline"
            selectedKeys={[stage]}
            onClick={({ key }) => setStage(key as V2Stage)}
            style={{ border: 'none', flex: 1 }}
            items={STAGES.map((s) => ({
              key: s.key,
              icon: s.icon,
              label: s.label,
              disabled: stageDisabled(s.key),
            }))}
          />
          {/* dev-only：全流程流水线 E2E 自测控制台（生产构建不渲染） */}
          {IS_DEV && <V2PipelineSelfTest />}
        </div>
      </Layout.Sider>

      <Layout.Content style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', background: token.colorBgLayout }}>
        {stage !== 'projects' && hasProject && (
          <div
            style={{
              padding: '8px 16px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: token.colorBgContainer,
            }}
          >
            <Button size="small" onClick={() => setStage('projects')}>
              返回项目列表
            </Button>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={project.title}
            >
              {project.title || '未命名作品'}
            </span>
            {/* 大纲/创作阶段：显示已绑定上下文（素材注入可见性） */}
            {(stage === 'outline' || stage === 'writing') && (
              <V2BoundResourceBar project={project} />
            )}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {stage === 'projects' && <V2ProjectList />}
          {stage === 'outline' &&
            (project ? (
              <V2OutlineWorkbench />
            ) : (
              <StageEmpty description="请先在「项目列表」选择或新建项目" />
            ))}
          {stage === 'writing' &&
            (hasOutline ? (
              <V2ChapterWorkbench project={project} />
            ) : (
              <StageEmpty description="该项目还没有大纲，请先在「大纲设计」阶段完成大纲" />
            ))}
          {stage === 'export' &&
            (hasProject ? (
              <div style={{ padding: 24, overflow: 'auto' }}>
                <Empty
                  description={
                    <span>
                      共 {project.outline?.chapters?.length ?? 0} 章，
                      {project.outline?.chapters?.filter((c) => c.content && c.content.trim()).length ?? 0} 章有正文
                    </span>
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Button type="primary" icon={<ExportOutlined />} onClick={() => setShowExportDialog(true)}>
                    导出作品
                  </Button>
                </Empty>
              </div>
            ) : (
              <StageEmpty description="请先选择项目" />
            ))}
          {stage === 'assets' && <V2AssetsStage project={project} />}
        </div>
      </Layout.Content>

      {/* 全局弹窗（store 控制可见性） */}
      <V2NewProjectWizard />
      {project && <V2ExportDialog project={project} />}
    </Layout>
  );
};

const StageEmpty: React.FC<{ description: string }> = ({ description }) => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Empty description={description} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  </div>
);

export default WritingV2Entry;
