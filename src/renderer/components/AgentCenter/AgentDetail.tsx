/**
 * AgentDetail —— 智能体详情侧边抽屉
 *
 * 来源：spec §add-agent-mode-management-and-center Task 8
 *
 * 职责：
 *  1. 以 antd Drawer 展示智能体基本信息（Descriptions 只读）
 *  2. 渲染 SkillConfigPanel 供技能白名单配置
 *  3. 支持 onUpdateSkills / onUpdateConfig 回调（当前仅技能配置使用 onUpdateSkills）
 */
import React from 'react';
import { Drawer, Descriptions, Empty } from 'antd';
import type { AgentConfig } from '@shared/types';
import SkillConfigPanel from './SkillConfigPanel';

/** 类型 → 中文标签 */
const TYPE_LABELS: Record<string, string> = {
  dialogue: '对话',
  writing: '写作',
  worldbook: '世界书',
  game: '游戏',
  custom: '自定义',
};

/** 模式 → 中文标签 */
const MODE_LABELS: Record<string, string> = {
  dialogue: '对话',
  writing: '写作',
  game: '游戏',
  worldbook: '世界书',
};

interface AgentDetailProps {
  open: boolean;
  agent: AgentConfig | null;
  onClose: () => void;
  onUpdateSkills: (id: string, skills: string[]) => Promise<void>;
  onUpdateConfig: (id: string, patch: Partial<AgentConfig>) => Promise<void>;
}

const AgentDetail: React.FC<AgentDetailProps> = ({
  open,
  agent,
  onClose,
  onUpdateSkills,
}) => {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={500}
      placement="right"
      title="智能体详情"
      destroyOnClose
    >
      {agent ? (
        <>
          <Descriptions column={1} bordered size="small" className="agent-detail-info">
            <Descriptions.Item label="名称">
              <span className="agent-detail-name">
                {agent.identity?.emoji && <span className="agent-detail-emoji">{agent.identity.emoji}</span>}
                {agent.name}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="描述">{agent.description}</Descriptions.Item>
            <Descriptions.Item label="类型">
              {TYPE_LABELS[agent.type] || agent.type}
            </Descriptions.Item>
            <Descriptions.Item label="模式">
              {MODE_LABELS[agent.mode] || agent.mode}
            </Descriptions.Item>
            <Descriptions.Item label="系统预置">
              {agent.isSystem ? '是' : '否'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(agent.createdAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {new Date(agent.updatedAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
          </Descriptions>

          <div className="agent-detail-skills">
            <SkillConfigPanel agent={agent} onUpdateSkills={onUpdateSkills} readOnly={agent.isSystem} />
          </div>
        </>
      ) : (
        <Empty description="未选择智能体" />
      )}
    </Drawer>
  );
};

export default AgentDetail;
