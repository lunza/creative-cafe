import React from 'react';
import { Badge, Button, Tooltip } from 'antd';
import { ConsoleSqlOutlined } from '@ant-design/icons';
import { useLogStore } from '../../stores/logStore';
import './FloatingLogButton.css';

const FloatingLogButton: React.FC = () => {
  const { isLogPanelOpen, toggleLogPanel, unreadCount } = useLogStore();

  return (
    <div className="floating-log-button">
      <Tooltip title={isLogPanelOpen ? '关闭日志' : '查看日志'} placement="right">
        <Badge count={unreadCount} size="small" offset={[-5, 5]}>
          <Button
            type="primary"
            shape="circle"
            icon={<ConsoleSqlOutlined />}
            onClick={toggleLogPanel}
            className={`log-toggle-btn ${isLogPanelOpen ? 'active' : ''}`}
            size="large"
          />
        </Badge>
      </Tooltip>
    </div>
  );
};

export default FloatingLogButton;
