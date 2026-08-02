/**
 * SkillConfigPanel —— 技能配置面板
 *
 * 来源：spec §add-agent-mode-management-and-center Task 8
 *
 * 职责：
 *  1. 通过 skill:list IPC 加载所有可用技能
 *  2. 以 Switch 开关控制每个技能的启用/禁用（白名单机制）
 *  3. 已启用技能支持上/下箭头按钮调整优先级顺序
 *  4. Collapse 展开查看技能详情（只读）
 *  5. 空状态展示 antd Empty
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Switch, Button, Tooltip, Collapse, Empty, Typography, Space, Spin, Alert } from 'antd';
import { UpOutlined, DownOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { AgentConfig } from '@shared/types';

/** 可用技能（来自 skill:list IPC 返回） */
interface AvailableSkill {
  name: string;
  title?: string;
  description?: string;
  emoji?: string;
  source?: string;
}

interface SkillConfigPanelProps {
  agent: AgentConfig;
  onUpdateSkills: (id: string, skills: string[]) => Promise<void>;
  readOnly?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  builtin: '内置',
  workspace: '工作区',
  unknown: '未知',
};

const SkillConfigPanel: React.FC<SkillConfigPanelProps> = ({ agent, onUpdateSkills, readOnly }) => {
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadSkills = async () => {
      try {
        const result = await window.electronAPI.skill.list();
        if (!cancelled && result.success && result.skills) {
          setAvailableSkills(result.skills);
        }
      } catch {
        // 降级：技能列表加载失败时保持空数组
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadSkills();
    return () => { cancelled = true; };
  }, []);

  /**
   * 构建显示列表：
   *  - 已启用技能按 agent.skills[] 顺序排列（含孤儿技能——在白名单中但不在可用列表中）
   *  - 未启用技能排列在后面
   */
  const { enabledRows, disabledRows } = useMemo(() => {
    const skillMap = new Map(availableSkills.map(s => [s.name, s]));

    const enabled: AvailableSkill[] = [];
    for (const skillName of agent.skills) {
      const skill = skillMap.get(skillName);
      if (skill) {
        enabled.push(skill);
      } else {
        // 孤儿技能：在白名单中但可用列表里找不到
        enabled.push({ name: skillName, description: '（技能未安装或已移除）' });
      }
    }

    const disabled = availableSkills.filter(s => !agent.skills.includes(s.name));

    return { enabledRows: enabled, disabledRows: disabled };
  }, [availableSkills, agent.skills]);

  /** Switch 切换：添加/移除技能 ID */
  const handleToggle = async (skillName: string, enabled: boolean) => {
    const newSkills = enabled
      ? [...agent.skills, skillName]
      : agent.skills.filter(s => s !== skillName);
    await onUpdateSkills(agent.id, newSkills);
  };

  /** 上/下移动：调整 agent.skills[] 中的顺序 */
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newSkills = [...agent.skills];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSkills.length) return;
    [newSkills[index], newSkills[targetIndex]] = [newSkills[targetIndex], newSkills[index]];
    await onUpdateSkills(agent.id, newSkills);
  };

  if (loading) {
    return (
      <div className="skill-config-loading">
        <Spin size="small" />
      </div>
    );
  }

  if (availableSkills.length === 0 && agent.skills.length === 0) {
    return <Empty description="暂无技能配置" />;
  }

  /** 渲染 Collapse 面板头部（Switch + 名称 + 上/下按钮） */
  const renderHeader = (skill: AvailableSkill, isEnabled: boolean, index?: number) => (
    <div className="skill-row-header" onClick={e => e.stopPropagation()}>
      <Switch
        checked={isEnabled}
        size="small"
        disabled={readOnly}
        onChange={(checked) => handleToggle(skill.name, checked)}
      />
      <span className="skill-name">
        {skill.emoji && <span className="skill-emoji">{skill.emoji}</span>}
        {skill.title || skill.name}
      </span>
      {isEnabled && index !== undefined && (
        <span className="skill-order-btns">
          <Button
            size="small"
            type="text"
            icon={<UpOutlined />}
            disabled={readOnly || index === 0}
            onClick={(e) => { e.stopPropagation(); handleMove(index, 'up'); }}
          />
          <Button
            size="small"
            type="text"
            icon={<DownOutlined />}
            disabled={readOnly || index === enabledRows.length - 1}
            onClick={(e) => { e.stopPropagation(); handleMove(index, 'down'); }}
          />
        </span>
      )}
    </div>
  );

  /** 渲染 Collapse 面板内容（只读详情） */
  const renderDetail = (skill: AvailableSkill) => (
    <div className="skill-detail">
      <Typography.Paragraph className="skill-detail-item">
        <Typography.Text type="secondary">名称：</Typography.Text>
        {skill.name}
      </Typography.Paragraph>
      {skill.description && (
        <Typography.Paragraph className="skill-detail-item">
          <Typography.Text type="secondary">描述：</Typography.Text>
          {skill.description}
        </Typography.Paragraph>
      )}
      {skill.source && (
        <Typography.Paragraph className="skill-detail-item">
          <Typography.Text type="secondary">来源：</Typography.Text>
          {SOURCE_LABELS[skill.source] || skill.source}
        </Typography.Paragraph>
      )}
    </div>
  );

  /** 合并已启用 + 未启用行为 Collapse items */
  const items = [
    ...enabledRows.map((skill, index) => ({
      key: `enabled-${skill.name}`,
      label: renderHeader(skill, true, index),
      children: renderDetail(skill),
    })),
    ...disabledRows.map(skill => ({
      key: `disabled-${skill.name}`,
      label: renderHeader(skill, false),
      children: renderDetail(skill),
    })),
  ];

  return (
    <div className="skill-config-panel">
      {readOnly && (
        <Alert
          type="info"
          showIcon
          message="系统智能体配置为只读"
          style={{ marginBottom: 12 }}
        />
      )}
      <div className="skill-config-title">
        <Space>
          <Typography.Text strong>技能配置</Typography.Text>
          <Tooltip title="技能白名单控制智能体可用的技能，参照 openclaw 技能管理机制">
            <QuestionCircleOutlined style={{ color: 'var(--text-secondary, #94a3b8)', cursor: 'help' }} />
          </Tooltip>
        </Space>
      </div>

      <Collapse size="small" items={items} />
    </div>
  );
};

export default SkillConfigPanel;
