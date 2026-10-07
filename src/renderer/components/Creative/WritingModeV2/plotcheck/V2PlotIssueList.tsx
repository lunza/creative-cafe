import React from 'react';
import { Button, Empty, Tag, theme } from 'antd';
import { WarningOutlined, CheckOutlined } from '@ant-design/icons';
import type { IssueSeverity } from '../../../../../shared/types/writing-v2.types';
import { ISSUE_SEVERITY_LABELS } from '../../../../../shared/types/writing-v2.types';

export interface V2NormalizedIssue {
  key: string;
  kind: 'dimension' | 'logic';
  /** 维度/逻辑类型中文标签 */
  categoryLabel: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  suggestion: string;
  fixable: boolean;
}

interface V2PlotIssueListProps {
  issues: V2NormalizedIssue[];
  fixedKeys: ReadonlySet<string>;
  fixingKeys: ReadonlySet<string>;
  onFix: (issue: V2NormalizedIssue) => void;
}

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue',
};

/**
 * V2 剧情检查问题列表（维度问题 + 逻辑问题统一渲染）
 * 每个问题可单独触发"自动修正"（由父组件负责 IPC 与确认）。
 */
const V2PlotIssueList: React.FC<V2PlotIssueListProps> = ({
  issues,
  fixedKeys,
  fixingKeys,
  onFix,
}) => {
  const { token } = theme.useToken();

  if (issues.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="未发现问题"
        style={{ margin: '8px 0' }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {issues.map((issue) => {
        const fixed = fixedKeys.has(issue.key);
        const fixing = fixingKeys.has(issue.key);
        return (
          <div
            key={issue.key}
            style={{
              border: `1px solid ${fixed ? token.colorSuccessBorder : token.colorBorderSecondary}`,
              background: fixed ? token.colorSuccessBg : token.colorBgContainer,
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <WarningOutlined style={{ color: fixed ? token.colorSuccess : token.colorWarning }} />
              <Tag color={SEVERITY_COLORS[issue.severity]}>
                {ISSUE_SEVERITY_LABELS[issue.severity]}
              </Tag>
              <Tag style={{ marginInlineEnd: 0 }}>{issue.categoryLabel}</Tag>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {issue.title}
              </span>
              {fixed ? (
                <Tag color="green" icon={<CheckOutlined />} style={{ marginInlineEnd: 0 }}>
                  已修正
                </Tag>
              ) : (
                issue.fixable && (
                  <Button
                    size="small"
                    type="link"
                    loading={fixing}
                    onClick={() => onFix(issue)}
                    style={{ padding: 0 }}
                  >
                    自动修正
                  </Button>
                )
              )}
            </div>
            <div style={{ fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.6 }}>
              {issue.description}
            </div>
            {issue.suggestion && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: token.colorPrimary,
                  background: token.colorPrimaryBg,
                  borderRadius: 6,
                  padding: '4px 8px',
                }}
              >
                建议：{issue.suggestion}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default V2PlotIssueList;
