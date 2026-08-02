/**
 * AgentCenter —— 智能体管理中心主页面
 *
 * 来源：spec §add-agent-mode-management-and-center Task 7 + Task 8
 *
 * 职责：
 *  1. 通过 useAgentConfigs hook 加载智能体配置列表
 *  2. 渲染页面标题 + AgentList 列表
 *  3. 管理详情 Drawer 的选中状态与开关（Task 8）
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Spin, Alert, Tabs, message } from 'antd';
import type { AgentConfig } from '@shared/types';
import { useAgentConfigs } from './hooks/useAgentConfigs';
import { useUIStore } from '../../stores/uiStore';
import AgentList from './AgentList';
import AgentDetail from './AgentDetail';
import AgentFormModal from './AgentFormModal';
import AgentDialogueModal from './AgentDialogueModal';
import SkillMarketplace from './SkillMarketplace';
import './AgentCenter.css';

const AgentCenter: React.FC = () => {
  const { configs, loading, error, toggleStatus, updateSkills, updateConfig, createAgent, deleteAgent } = useAgentConfigs();
  const { theme: appTheme } = useUIStore();
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 智能体表单模态窗口
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);

  // 智能体对话模态窗口
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [chattingAgent, setChattingAgent] = useState<AgentConfig | null>(null);

  /**
   * 从 configs 中派生当前选中的智能体，确保技能更新后 selectedAgent 同步刷新。
   * 若智能体已从列表中移除则返回 null。
   */
  const currentAgent = useMemo(
    () => (selectedAgent ? configs.find(c => c.id === selectedAgent.id) ?? null : null),
    [selectedAgent, configs],
  );

  /** 打开创建智能体表单 */
  const handleCreate = () => {
    setFormMode('create');
    setEditingAgent(null);
    setFormOpen(true);
  };

  /** 打开编辑智能体表单 */
  const handleEdit = (config: AgentConfig) => {
    setFormMode('edit');
    setEditingAgent(config);
    setFormOpen(true);
  };

  /** 删除智能体 */
  const handleDelete = async (id: string) => {
    const result = await deleteAgent(id);
    if (result.ok) {
      message.success('智能体已删除');
    } else {
      message.error(result.error || '删除智能体失败');
    }
  };

  /** 创建智能体提交 */
  const handleFormCreate = async (config: any) => {
    const result = await createAgent(config);
    if (result.ok) {
      message.success('智能体创建成功');
      setFormOpen(false);
    } else {
      message.error(result.error || '创建智能体失败');
    }
  };

  /** 编辑智能体提交 */
  const handleFormUpdate = async (id: string, patch: Partial<AgentConfig>) => {
    const result = await updateConfig(id, patch);
    if (result.ok) {
      message.success('智能体更新成功');
      setFormOpen(false);
    } else {
      message.error(result.error || '更新智能体失败');
    }
  };

  /** 打开智能体对话 */
  const handleChat = useCallback((agent: AgentConfig) => {
    setChattingAgent(agent);
    setDialogueOpen(true);
  }, []);

  /** 关闭智能体对话 */
  const handleCloseDialogue = useCallback(() => {
    setDialogueOpen(false);
  }, []);

  return (
    <div className={`agent-center ${appTheme === 'dark' ? 'dark' : ''}`}>
      <div className="agent-center-header">
        <h2 className="agent-center-title">智能体管理中心</h2>
        <p className="agent-center-subtitle">
          管理智能体配置，包括启用/禁用、技能设置和参数调整
        </p>
      </div>

      <Tabs
        defaultActiveKey="agents"
        items={[
          {
            key: 'agents',
            label: '智能体列表',
            children: loading ? (
              <div className="agent-center-loading">
                <Spin />
              </div>
            ) : error ? (
              <Alert
                type="error"
                message="加载智能体配置失败"
                description={error}
                showIcon
                style={{ margin: '24px 0' }}
              />
            ) : (
              <AgentList
                configs={configs}
                loading={loading}
                onToggle={toggleStatus}
                onViewDetail={(config) => {
                  setSelectedAgent(config);
                  setDetailOpen(true);
                }}
                onCreate={handleCreate}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onChat={handleChat}
              />
            ),
          },
          {
            key: 'marketplace',
            label: '技能广场',
            children: <SkillMarketplace />,
          },
        ]}
      />

      <AgentDetail
        open={detailOpen}
        agent={currentAgent}
        onClose={() => setDetailOpen(false)}
        onUpdateSkills={async (id, skills) => { await updateSkills(id, skills); }}
        onUpdateConfig={async (id, patch) => { await updateConfig(id, patch); }}
      />

      <AgentFormModal
        open={formOpen}
        mode={formMode}
        agent={editingAgent}
        existingNames={configs.map(c => c.name)}
        onCreate={handleFormCreate}
        onUpdate={handleFormUpdate}
        onClose={() => setFormOpen(false)}
      />

      <AgentDialogueModal
        open={dialogueOpen}
        agent={chattingAgent}
        onClose={handleCloseDialogue}
      />
    </div>
  );
};

export default AgentCenter;
