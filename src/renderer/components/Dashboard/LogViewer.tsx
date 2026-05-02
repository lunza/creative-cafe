import React, { useEffect, useRef } from 'react';
import { Card, Typography, Divider, Button, Space } from 'antd';
import { ClearOutlined, CopyOutlined } from '@ant-design/icons';

interface LogViewerProps {
  logs: string[];
  clearLogs: () => void;
}

const { Text } = Typography;

export const LogViewer: React.FC<LogViewerProps> = ({ logs, clearLogs }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 自动滚动到底部
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const copyLogs = () => {
    const logText = logs.join('\n');
    navigator.clipboard.writeText(logText);
  };

  return (
    <Card
      title={
        <Space>
          <Text strong>启动日志</Text>
          <Button
            type="text"
            icon={<CopyOutlined />}
            size="small"
            onClick={copyLogs}
          >
            复制
          </Button>
          <Button
            type="text"
            icon={<ClearOutlined />}
            size="small"
            onClick={clearLogs}
          >
            清空
          </Button>
        </Space>
      }
      style={{ height: 'clamp(250px, 35vh, 400px)', width: '100%', margin: 0, marginBottom: 20 }}
    >
      <div
        ref={logContainerRef}
        className="log-container"
      >
        {logs.length === 0 ? (
          <Text type="secondary">启动SillyTavern后，日志将显示在这里</Text>
        ) : (
          logs.map((log, index) => (
            <div key={index}>
              {log}
            </div>
          ))
        )}
      </div>
    </Card>
  );
};