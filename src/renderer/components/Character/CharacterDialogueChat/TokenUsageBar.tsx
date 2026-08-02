import React from 'react';
import { Tooltip, Button } from 'antd';
import { LoadingOutlined, WarningOutlined, CompressOutlined } from '@ant-design/icons';

/**
 * 上下文窗口守卫常量（Spec: optimize-agent-interaction-from-openclaw / M3-Task11）
 *
 * - HARD_MIN_TOKENS：硬下限，剩余 token 低于此值时红色警告 + 显示"压缩对话历史"按钮
 * - WARN_BELOW_TOKENS：软警告阈值，剩余 token 低于此值时黄色警告
 */
const HARD_MIN_TOKENS = 4000;
const WARN_BELOW_TOKENS = 8000;

interface TokenUsageBarProps {
  /** 已用 token 数 */
  used: number;
  /** 总量 token 数 */
  total: number;
  /** 点击"压缩对话历史"回调 */
  onCompress?: () => void;
  /** 是否正在压缩 */
  isCompressing?: boolean;
}

const TokenUsageBar: React.FC<TokenUsageBarProps> = ({
  used,
  total,
  onCompress,
  isCompressing = false,
}) => {
  if (total <= 0) return null;

  const remaining = Math.max(0, total - used);
  const percent = Math.min(100, Math.round((used / total) * 100));

  // 根据剩余 token 决定颜色级别
  let barColor = '#22c55e'; // 绿色（安全）
  let showWarning = false;
  let showCompressButton = false;

  if (remaining <= HARD_MIN_TOKENS) {
    barColor = '#ef4444'; // 红色（危险）
    showCompressButton = true;
  } else if (remaining <= WARN_BELOW_TOKENS) {
    barColor = '#eab308'; // 黄色（警告）
    showWarning = true;
  }

  const tooltipContent = `已用 ${used.toLocaleString()} tokens (${percent}%)，剩余 ${remaining.toLocaleString()} tokens`;

  return (
    <Tooltip title={tooltipContent} placement="top">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
        }}
      >
        {/* 进度条容器 */}
        <div
          style={{
            flex: 1,
            height: '20px',
            borderRadius: '4px',
            background: 'rgba(15, 15, 26, 0.6)',
            position: 'relative',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {/* 进度条填充 */}
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              borderRadius: '4px',
              background: barColor,
              transition: 'width 0.3s ease, background 0.3s ease',
            }}
          />
          {/* 进度条文字（居中显示在条上） */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#e2e8f0',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {used.toLocaleString()} / {total.toLocaleString()} tokens
          </div>
        </div>

        {/* 黄色警告图标 */}
        {showWarning && !showCompressButton && (
          <WarningOutlined style={{ color: '#eab308', fontSize: '14px' }} />
        )}

        {/* 压缩对话历史按钮 */}
        {showCompressButton && (
          <Button
            size="small"
            type="link"
            icon={isCompressing ? <LoadingOutlined /> : <CompressOutlined />}
            onClick={onCompress}
            disabled={isCompressing}
            style={{
              padding: '0 4px',
              fontSize: '12px',
              color: '#ef4444',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            压缩对话历史
          </Button>
        )}
      </div>
    </Tooltip>
  );
};

export default TokenUsageBar;
