import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Tabs, Button, Spin, Card, Tag, Tooltip, Empty, Typography, message, Space, Modal } from 'antd';
import {
  LockOutlined,
  EditOutlined,
  HistoryOutlined,
  SaveOutlined,
  RedoOutlined,
  EyeOutlined,
  ApartmentOutlined,
  BlockOutlined,
} from '@ant-design/icons';
import { usePromptStore } from '../../stores/promptStore';
import { useUIStore } from '../../stores/uiStore';
import type { PromptTemplate, PromptPart } from '../../../shared/types/promptTemplate.types';
import PromptAssemblyView from './PromptAssemblyView';
import PromptFlowChart from './PromptFlowChart';
import PromptEditor from './PromptEditor';
import PromptPreview from './PromptPreview';
import PromptHistory from './PromptHistory';
import PromptSaveDialog from './PromptSaveDialog';
import './PromptManagement.css';

const { Title, Text } = Typography;

export interface ModuleInfo {
  moduleId: string;
  name: string;
  description: string;
}

export interface ModuleGroup {
  groupName: string;
  modules: ModuleInfo[];
}

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    groupName: '角色卡管理',
    modules: [
      { moduleId: 'character-card.generate', name: '生成', description: '角色卡字段内容生成' },
      { moduleId: 'character-card.translate', name: '翻译', description: '角色卡内容翻译为中文' },
      { moduleId: 'character-card.polish', name: '润色', description: '角色卡内容文本润色' },
    ],
  },
  {
    groupName: '世界书管理',
    modules: [
      { moduleId: 'world-book.translate', name: '翻译', description: '世界书条目文本翻译' },
      { moduleId: 'world-book.polish-keyword', name: '关键词润色', description: '世界书关键词润色优化' },
      { moduleId: 'world-book.polish-comment', name: '注释润色', description: '世界书条目注释润色优化' },
      { moduleId: 'world-book.polish-content', name: '内容润色', description: '世界书条目内容润色优化' },
      { moduleId: 'world-book.generate-keywords', name: '关键词生成', description: '为世界书条目生成主/次关键词' },
      { moduleId: 'world-book.generate-tags', name: '标签生成', description: '为世界书条目生成分类标签' },
      { moduleId: 'world-book.sort-entries', name: 'AI排序', description: 'AI智能排序世界书条目' },
      { moduleId: 'world-book.generate-entries', name: '条目生成', description: '根据主题描述生成完整世界书' },
      { moduleId: 'world-book.generate-from-template', name: '模板生成', description: '基于模板参数生成世界书条目' },
      { moduleId: 'world-book.expand-keywords', name: '关键词扩写', description: 'AI扩写关键词的同义词和相关词' },
      { moduleId: 'world-book.generate-description', name: '描述生成', description: '根据关键词和主题生成条目内容' },
      { moduleId: 'world-book.generate-new-entries', name: '新条目生成', description: '生成指定数量的新世界书条目' },
      { moduleId: 'world-book.generate-from-characters', name: '角色卡生成', description: '基于角色卡信息生成配套世界书' },
    ],
  },
  {
    groupName: '创作中心-聊天模式',
    modules: [
      { moduleId: 'creative-chat.dialogue', name: '对话模式指令', description: '角色扮演对话的核心系统提示词' },
      { moduleId: 'creative-chat.continuation', name: '续写模式指令', description: '内容续写的核心系统提示词' },
      { moduleId: 'creative-chat.async-table-instructions', name: '异步表格整理指令', description: '记忆表格异步整理的详细指令' },
      { moduleId: 'creative-chat.context-regions', name: '上下文区域分隔', description: '向量背景/记忆表格/异步指令的区域包装模板' },
    ],
  },
];

/** 根据 moduleId 查找任务描述（用于 AI 润色时提供任务上下文） */
export function findModuleDescription(moduleId: string): string | undefined {
  for (const group of MODULE_GROUPS) {
    const mod = group.modules.find((m) => m.moduleId === moduleId);
    if (mod) {
      return `${group.groupName} - ${mod.name}（${mod.description}）`;
    }
  }
  return undefined;
}

type TabKey = 'assembly' | 'flowchart' | 'editor' | 'preview';

const formatTime = (timestamp: number): string => {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('zh-CN');
};

// [perf] 列表数据量典型 < 50 项（MODULE_GROUPS 静态定义 ~20 项），未启用虚拟滚动
//        （阈值 50）；已应用 React.memo + useCallback。若数据量增长可改用 useVirtualizer。

interface ModuleListItemProps {
  module: ModuleInfo;
  template: PromptTemplate | undefined;
  isActive: boolean;
  onSelect: (moduleId: string) => void;
}

/**
 * 侧边栏单个模块项（React.memo）。
 *
 * 拆分目的：避免父级 PromptManagement 因 activeTab / editedParts / isDirty 等
 * 与列表无关的状态变化时整列重渲染。props 仅在 module / template / isActive /
 * onSelect 引用变化时才重渲染。
 */
const ModuleListItem = React.memo<ModuleListItemProps>(({ module, template, isActive, onSelect }) => (
  <div
    className={`prompt-management-module-item ${isActive ? 'active' : ''}`}
    onClick={() => onSelect(module.moduleId)}
  >
    <div className="prompt-management-module-name">
      <span className="prompt-management-module-title">{module.name}</span>
      {template && (
        <Tag color="blue" className="prompt-management-version-tag">
          v{template.metadata.version}
        </Tag>
      )}
    </div>
    <div className="prompt-management-module-desc">{module.description}</div>
    {template && (
      <div className="prompt-management-module-time">
        更新于 {formatTime(template.metadata.updatedAt)}
      </div>
    )}
  </div>
));

const PromptManagement: React.FC = () => {
  const theme = useUIStore(s => s.theme);
  // TODO(perf): 整体订阅，待拆分为 selector（9 字段，>5 暂缓）
  const {
    templates,
    selectedModuleId,
    loading,
    error,
    loadTemplates,
    selectModule,
    saveTemplate,
    resetTemplate,
    getHistory,
  } = usePromptStore();
  const [activeTab, setActiveTab] = useState<TabKey>('assembly');
  const [editedParts, setEditedParts] = useState<PromptPart[] | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (error) {
      message.error(error);
    }
  }, [error]);

  // Reset editor state when switching modules
  useEffect(() => {
    setEditedParts(null);
    setIsDirty(false);
  }, [selectedModuleId]);

  // 有未保存更改时，提示用户 beforeunload
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const selectedTemplate = useMemo<PromptTemplate | undefined>(
    () => templates.find((t) => t.moduleId === selectedModuleId),
    [templates, selectedModuleId]
  );

  // Template with edited parts merged in (for saving and validation)
  const effectiveTemplate = useMemo<PromptTemplate | undefined>(() => {
    if (!selectedTemplate) return undefined;
    if (!editedParts) return selectedTemplate;
    return { ...selectedTemplate, parts: editedParts };
  }, [selectedTemplate, editedParts]);

  const selectedModuleInfo = useMemo<ModuleInfo | undefined>(() => {
    for (const group of MODULE_GROUPS) {
      const found = group.modules.find((m) => m.moduleId === selectedModuleId);
      if (found) return found;
    }
    return undefined;
  }, [selectedModuleId]);

  const handlePartsChange = useCallback((parts: PromptPart[]) => {
    setEditedParts(parts);
    setIsDirty(true);
  }, []);

  const handleSaveClick = useCallback(() => {
    if (!effectiveTemplate) return;
    setSaveDialogVisible(true);
  }, [effectiveTemplate]);

  const handleSaveConfirm = useCallback(async (changeSummary: string) => {
    if (!effectiveTemplate) return;
    setSaveDialogVisible(false);
    const success = await saveTemplate(effectiveTemplate, changeSummary);
    if (success) {
      message.success('保存成功');
      setIsDirty(false);
      setEditedParts(null);
    }
  }, [effectiveTemplate, saveTemplate]);

  const handleReset = useCallback(async () => {
    if (!selectedModuleId) return;
    const success = await resetTemplate(selectedModuleId);
    if (success) {
      message.success('已重置为默认模板');
      setIsDirty(false);
      setEditedParts(null);
    }
  }, [selectedModuleId, resetTemplate]);

  const handleHistory = useCallback(() => {
    if (!selectedModuleId) return;
    setHistoryVisible(true);
  }, [selectedModuleId]);

  const handleHistoryRollback = useCallback(async () => {
    await loadTemplates();
    setIsDirty(false);
    setEditedParts(null);
  }, [loadTemplates]);

  const handleSelectModule = useCallback((moduleId: string) => {
    if (isDirty) {
      Modal.confirm({
        title: '未保存的更改',
        content: '当前模板有未保存的更改，切换模块将丢失这些更改。是否继续？',
        okText: '继续',
        cancelText: '取消',
        onOk: () => {
          selectModule(moduleId);
        },
      });
    } else {
      selectModule(moduleId);
    }
  }, [isDirty, selectModule]);

  const renderSidebar = () => (
    <div className="prompt-management-sidebar">
      <div className="prompt-management-sidebar-header">
        <Title level={5} style={{ margin: 0 }}>
          模块列表
        </Title>
      </div>
      <div className="prompt-management-sidebar-body">
        {MODULE_GROUPS.map((group) => (
          <div key={group.groupName} className="prompt-management-module-group">
            <div className="prompt-management-group-header">
              <LockOutlined style={{ marginRight: 6 }} />
              {group.groupName}
            </div>
            {group.modules.map((module) => {
              const tpl = templates.find((t) => t.moduleId === module.moduleId);
              const isActive = selectedModuleId === module.moduleId;
              return (
                <ModuleListItem
                  key={module.moduleId}
                  module={module}
                  template={tpl}
                  isActive={isActive}
                  onSelect={handleSelectModule}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="prompt-management-sidebar-footer">
        <Button icon={<HistoryOutlined />} block type="text" onClick={handleHistory}>
          历史记录
        </Button>
      </div>
    </div>
  );

  const renderContent = () => {
    if (loading && templates.length === 0) {
      return (
        <div className="prompt-management-loading">
          <Spin tip="加载中..." />
        </div>
      );
    }

    if (!selectedModuleId || !selectedModuleInfo || !effectiveTemplate) {
      return (
        <div className="prompt-management-empty">
          <Empty description="请选择一个模块" />
        </div>
      );
    }

    return (
      <div className="prompt-management-content">
        <div className="prompt-management-content-header">
          <div className="prompt-management-content-title">
            <Title level={4} style={{ marginBottom: 0 }}>
              {selectedModuleInfo.name}
              {isDirty && (
                <Tag color="orange" style={{ marginLeft: 8, fontSize: 12 }}>
                  未保存
                </Tag>
              )}
            </Title>
            <Text type="secondary">{selectedModuleInfo.description}</Text>
          </div>
          <Space>
            <Tooltip title="保存当前模板">
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveClick}
                disabled={!isDirty}
              >
                保存
              </Button>
            </Tooltip>
            <Tooltip title="重置为默认模板">
              <Button icon={<RedoOutlined />} onClick={handleReset} loading={loading}>
                重置为默认
              </Button>
            </Tooltip>
            <Tooltip title="查看历史记录">
              <Button icon={<HistoryOutlined />} onClick={handleHistory}>
                历史记录
              </Button>
            </Tooltip>
          </Space>
        </div>

        <Card className="prompt-management-tabs-card">
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as TabKey)}
            className="prompt-management-tabs"
            items={[
              {
                key: 'assembly',
                label: (
                  <span>
                    <BlockOutlined /> 拼接视图
                  </span>
                ),
                children: <PromptAssemblyView template={effectiveTemplate} />,
              },
              {
                key: 'flowchart',
                label: (
                  <span>
                    <ApartmentOutlined /> 流程图
                  </span>
                ),
                children: <PromptFlowChart template={effectiveTemplate} />,
              },
              {
                key: 'editor',
                label: (
                  <span>
                    <EditOutlined /> 编辑器
                  </span>
                ),
                children: (
                  <PromptEditor
                    template={effectiveTemplate}
                    onPartsChange={handlePartsChange}
                    isDirty={isDirty}
                  />
                ),
              },
              {
                key: 'preview',
                label: (
                  <span>
                    <EyeOutlined /> 预览
                  </span>
                ),
                children: <PromptPreview template={effectiveTemplate} />,
              },
            ]}
          />
        </Card>
      </div>
    );
  };

  return (
    <div className={`prompt-management-container ${theme === 'dark' ? 'dark' : ''}`}>
      {renderSidebar()}
      {renderContent()}
      {selectedModuleId && (
        <PromptHistory
          moduleId={selectedModuleId}
          visible={historyVisible}
          onClose={() => setHistoryVisible(false)}
          onRollback={handleHistoryRollback}
        />
      )}
      {effectiveTemplate && (
        <PromptSaveDialog
          visible={saveDialogVisible}
          template={effectiveTemplate}
          onCancel={() => setSaveDialogVisible(false)}
          onConfirm={handleSaveConfirm}
        />
      )}
    </div>
  );
};

export default PromptManagement;
