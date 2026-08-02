import React, { useState, useCallback } from 'react';
import { Popover, Button } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

export interface SkillInfo {
  name: string;
  title: string;
  description: string;
  emoji?: string;
  source: string;
  userInvocable: boolean;
}

export interface SkillQuickAccessProps {
  /** 技能列表（已过滤 userInvocable=true） */
  skills: SkillInfo[];
  /** 是否禁用（流式/整理中） */
  disabled?: boolean;
  /** 技能调用回调（由父组件传入，负责调用 IPC 和展示结果） */
  onInvokeSkill: (skillName: string, args: string) => void;
  /** 调用中状态（正在执行的技能名，用于显示 loading） */
  invokingSkill?: string | null;
}

/**
 * 技能快捷调用入口（Spec: optimize-agent-interaction-from-openclaw / M1-Task4）
 *
 * 一行水平排列的技能胶囊按钮，点击弹出参数输入浮层（raw 模式单文本输入）。
 */
const SkillQuickAccess: React.FC<SkillQuickAccessProps> = ({
  skills,
  disabled = false,
  onInvokeSkill,
  invokingSkill = null,
}) => {
  // 当前打开 Popover 的技能名（同时只有一个展开）
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  // 参数输入文本
  const [argsText, setArgsText] = useState('');

  const handleSubmit = useCallback((skillName: string) => {
    onInvokeSkill(skillName, argsText);
    setArgsText('');
    setOpenSkill(null);
  }, [argsText, onInvokeSkill]);

  const handleOpenChange = useCallback((skillName: string, open: boolean) => {
    if (open) {
      setArgsText('');
      setOpenSkill(skillName);
    } else {
      setOpenSkill(null);
    }
  }, []);

  if (!skills || skills.length === 0) {
    return null;
  }

  return (
    <div style={{
      display: 'flex',
      gap: '6px',
      overflowX: 'auto',
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
    }}>
      <style>{`
        .skill-quick-access-btn:hover {
          background: rgba(99, 102, 241, 0.3) !important;
        }
      `}</style>
      {skills.map(skill => {
        const isInvoking = invokingSkill === skill.name;
        const isPopoverOpen = openSkill === skill.name;
        const emoji = skill.emoji || '\u{1F527}';

        const popoverContent = (
          <div style={{ width: '280px' }}>
            {skill.description && (
              <div style={{
                fontSize: '12px',
                color: '#9ca3af',
                marginBottom: '8px',
                lineHeight: '1.5',
              }}>
                {skill.description}
              </div>
            )}
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="输入调用参数（可选）"
              rows={2}
              style={{
                width: '100%',
                background: 'rgba(15, 15, 26, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#e2e8f0',
                fontSize: '13px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: '1.5',
                marginBottom: '8px',
              }}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter 快速提交
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit(skill.name);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="primary"
                size="small"
                loading={isInvoking}
                onClick={() => handleSubmit(skill.name)}
              >
                调用
              </Button>
            </div>
          </div>
        );

        return (
          <Popover
            key={skill.name}
            content={popoverContent}
            trigger="click"
            placement="topLeft"
            open={isPopoverOpen}
            onOpenChange={(open) => handleOpenChange(skill.name, open)}
            overlayInnerStyle={{ background: 'rgba(30, 30, 46, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)' }}
          >
            <button
              type="button"
              disabled={disabled || isInvoking}
              className="skill-quick-access-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 12px',
                borderRadius: '16px',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#e2e8f0',
                fontSize: '12px',
                cursor: (disabled || isInvoking) ? 'not-allowed' : 'pointer',
                opacity: (disabled || isInvoking) ? 0.6 : 1,
                transition: 'background 0.2s ease, opacity 0.2s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {isInvoking ? <LoadingOutlined style={{ fontSize: '12px' }} /> : <span>{emoji}</span>}
              <span>{skill.title}</span>
            </button>
          </Popover>
        );
      })}
    </div>
  );
};

export default SkillQuickAccess;
