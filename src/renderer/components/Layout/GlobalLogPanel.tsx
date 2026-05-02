import React, { useEffect, useRef, useState } from 'react';
import { Card, Button, Space, Typography, Badge, Select, Input, Modal } from 'antd';
import {
  CloseOutlined,
  ClearOutlined,
  CopyOutlined,
  SearchOutlined,
  DownloadOutlined,
  DownOutlined,
  RightOutlined
} from '@ant-design/icons';
import { useLogStore } from '../../stores/logStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import './GlobalLogPanel.css';

const { Text, Pre } = Typography;

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type LogCategory = 'system' | 'ai' | 'setting' | 'network' | 'user' | 'other';

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const LOG_CATEGORIES: LogCategory[] = ['system', 'ai', 'setting', 'network', 'user', 'other'];

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  'error': 0,
  'warn': 1,
  'info': 2,
  'debug': 3
};

const GlobalLogPanel: React.FC = () => {
  const { logs, isLogPanelOpen, setLogPanelOpen, clearLogs } = useLogStore();
  const { theme } = useUIStore();
  const { setting } = useSettingStore();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
  const [filterCategory, setFilterCategory] = useState<LogCategory | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (logContainerRef.current && isLogPanelOpen) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isLogPanelOpen]);

  const toggleExpand = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  const copyLogToClipboard = (log: any) => {
    const category = log.category || 'other';
    const logText = `[${log.timestamp}] [${category.toUpperCase()}] [${log.type.toUpperCase()}] ${log.message}`;
    const contextText = log.context ? `\nContext: ${JSON.stringify(log.context, null, 2)}` : '';
    const detailsText = log.details ? `\nDetails: ${log.details}` : '';
    const fullText = logText + contextText + detailsText;
    navigator.clipboard.writeText(fullText);
  };

  const [exportModalVisible, setExportModalVisible] = useState(false);

  const exportLogsAsTxt = () => {
    const logText = filteredLogs.map(log => {
      const category = log.category || 'other';
      let text = `[${log.timestamp}] [${category.toUpperCase()}] [${log.type.toUpperCase()}] ${log.message}`;
      if (log.context) text += `\nContext: ${JSON.stringify(log.context, null, 2)}`;
      if (log.details) text += `\nDetails: ${log.details}`;
      return text;
    }).join('\n\n');
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `travenmanager-logs-${timestamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportModalVisible(false);
  };

  const exportLogsAsJson = () => {
    const logData = filteredLogs.map(log => ({
      id: log.id,
      timestamp: log.timestamp,
      isoTimestamp: log.isoTimestamp || log.timestamp,
      type: log.type,
      category: log.category || 'other',
      message: log.message,
      context: log.context,
      details: log.details
    }));
    const jsonText = JSON.stringify(logData, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `travenmanager-logs-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportModalVisible(false);
  };

  const getLogColor = (type: LogLevel) => {
    const isDark = theme === 'dark';
    switch (type) {
      case 'error':
        return isDark ? '#ff6b6b' : '#ff4d4f';
      case 'warn':
        return isDark ? '#ffd43b' : '#faad14';
      case 'info':
        return isDark ? '#4dabf7' : '#1890ff';
      case 'debug':
        return isDark ? '#868e96' : '#8c8c8c';
      default:
        return isDark ? '#4dabf7' : '#1890ff';
    }
  };

  const getLogLabel = (type: LogLevel) => {
    switch (type) {
      case 'error':
        return '错误';
      case 'warn':
        return '警告';
      case 'info':
        return '信息';
      case 'debug':
        return '调试';
      default:
        return type;
    }
  };

  const getCategoryLabel = (category: LogCategory) => {
    switch (category) {
      case 'system':
        return '系统';
      case 'ai':
        return 'AI';
      case 'setting':
        return '设置';
      case 'network':
        return '网络';
      case 'user':
        return '用户';
      case 'other':
        return '其他';
      default:
        return category;
    }
  };

  const shouldShowLog = (log: { type: LogLevel; message: string; category?: LogCategory; context?: any; details?: string }) => {
    const configLevel = (setting?.logLevel as LogLevel) || 'info';
    const configPriority = LOG_LEVEL_PRIORITY[configLevel];
    const logPriority = LOG_LEVEL_PRIORITY[log.type];

    if (logPriority > configPriority) {
      return false;
    }

    if (filterLevel !== 'all' && log.type !== filterLevel) {
      return false;
    }

    if (filterCategory !== 'all' && log.category !== filterCategory) {
      return false;
    }

    if (searchText) {
      const lowerSearch = searchText.toLowerCase();
      const messageMatch = log.message.toLowerCase().includes(lowerSearch);
      const contextMatch = log.context ? JSON.stringify(log.context).toLowerCase().includes(lowerSearch) : false;
      const detailsMatch = log.details ? log.details.toLowerCase().includes(lowerSearch) : false;
      if (!messageMatch && !contextMatch && !detailsMatch) {
        return false;
      }
    }

    return true;
  };

  const filteredLogs = logs.filter(shouldShowLog);

  const renderContext = (context: any) => {
    try {
      if (context === null || context === undefined) {
        return 'null';
      }
      return JSON.stringify(context, null, 2);
    } catch (error) {
      console.error('Error rendering context:', error);
      return String(context);
    }
  };

  const renderDetails = (details: any) => {
    try {
      if (details === null || details === undefined) {
        return 'null';
      }
      if (typeof details === 'object') {
        return JSON.stringify(details, null, 2);
      }
      return String(details);
    } catch (error) {
      console.error('Error rendering details:', error);
      return String(details);
    }
  };

  if (!isLogPanelOpen) {
    return null;
  }

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#1f1f1f' : '#ffffff';
  const timestampColor = isDark ? '#888' : '#666';
  const borderColor = isDark ? '#333' : '#e8e8e8';
  const categoryBgColor = isDark ? '#2a2a2a' : '#f5f5f5';

  return (
    <div className="global-log-panel">
      <Card
        className="log-panel-card"
        title={
          <Space>
            <Text strong>系统日志</Text>
            <Badge count={filteredLogs.length} showZero style={{ backgroundColor: isDark ? '#40a9ff' : '#1890ff' }} />
          </Space>
        }
        extra={
          <Space>
            <Select
              value={filterCategory}
              onChange={setFilterCategory}
              style={{ width: 100 }}
              size="small"
            >
              <Select.Option value="all">全部分类</Select.Option>
              <Select.Option value="system">系统</Select.Option>
              <Select.Option value="ai">AI</Select.Option>
              <Select.Option value="setting">设置</Select.Option>
              <Select.Option value="network">网络</Select.Option>
              <Select.Option value="user">用户</Select.Option>
              <Select.Option value="other">其他</Select.Option>
            </Select>
            <Select
              value={filterLevel}
              onChange={setFilterLevel}
              style={{ width: 100 }}
              size="small"
            >
              <Select.Option value="all">全部级别</Select.Option>
              <Select.Option value="error">错误</Select.Option>
              <Select.Option value="warn">警告</Select.Option>
              <Select.Option value="info">信息</Select.Option>
              <Select.Option value="debug">调试</Select.Option>
            </Select>
            <Input
              placeholder="搜索日志"
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 180 }}
              size="small"
              allowClear
            />
            <Button
              type="text"
              icon={<DownloadOutlined />}
              size="small"
              onClick={() => setExportModalVisible(true)}
            >
              导出
            </Button>
            <Button
              type="text"
              icon={<ClearOutlined />}
              size="small"
              onClick={clearLogs}
            >
              清空
            </Button>
            <Button
              type="text"
              icon={<CloseOutlined />}
              size="small"
              onClick={() => setLogPanelOpen(false)}
            />
          </Space>
        }
      >
        <div
          ref={logContainerRef}
          className="log-panel-content"
          style={{
            backgroundColor: bgColor
          }}
        >
          {filteredLogs.length === 0 ? (
            <div className="log-empty">
              <Text type="secondary">暂无日志</Text>
            </div>
          ) : (
            filteredLogs.map((log) => {
              try {
                const isExpanded = expandedLogs.has(log.id);
                const hasContext = log.context !== null && log.context !== undefined;
                const hasDetails = log.details !== null && log.details !== undefined;
                const hasAnyDetails = hasContext || hasDetails;
                const category = log.category || 'other';
                const logType = log.type || 'info';
                const logMessage = log.message || '';
                const logTimestamp = log.timestamp || '';
                
                return (
                  <div
                    key={log.id}
                    className={`log-entry log-${logType}`}
                    style={{ 
                      borderBottom: `1px solid ${borderColor}`,
                      padding: '6px 0',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    <div className="log-header" style={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      marginBottom: isExpanded ? 8 : 0
                    }}>
                      {hasAnyDetails && (
                        <Button
                          type="text"
                          size="small"
                          icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                          onClick={() => toggleExpand(log.id)}
                          style={{ marginRight: 8, padding: '0 4px' }}
                        />
                      )}
                      <span
                        className="log-category"
                        style={{
                          backgroundColor: categoryBgColor,
                          color: timestampColor,
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 10,
                          marginRight: 8
                        }}
                      >
                        {getCategoryLabel(category as LogCategory)}
                      </span>
                      <span
                        className="log-level"
                        style={{
                          color: getLogColor(logType as LogLevel),
                          fontWeight: 600,
                          minWidth: 40,
                          marginRight: 8
                        }}
                      >
                        [{getLogLabel(logType as LogLevel)}]
                      </span>
                      <span
                        className="log-message"
                        style={{ 
                          color: getLogColor(logType as LogLevel), 
                          flex: 1,
                          fontSize: 13,
                          lineHeight: '1.4'
                        }}
                      >
                        {(() => {
                          if (typeof logMessage === 'string') {
                            return logMessage;
                          }
                          if (logMessage === null || logMessage === undefined) {
                            return String(logMessage);
                          }
                          try {
                            return JSON.stringify(logMessage);
                          } catch {
                            return String(logMessage);
                          }
                        })()}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => copyLogToClipboard(log)}
                        style={{ marginLeft: 8, padding: '0 4px' }}
                      />
                    </div>
                    {isExpanded && hasAnyDetails && (
                      <div 
                        className="log-details" 
                        style={{ 
                          marginTop: 8, 
                          padding: '12px', 
                          backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0',
                          borderRadius: 6,
                          border: `1px solid ${borderColor}`,
                          fontSize: 12,
                          lineHeight: '1.5'
                        }}
                      >
                        <div style={{ marginBottom: 12, fontSize: 11, color: timestampColor }}>
                          <strong>时间:</strong> {logTimestamp}
                        </div>
                        {hasContext && (
                          <div style={{ marginBottom: 12 }}>
                            <Text strong style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>上下文信息:</Text>
                            <div
                              style={{
                                backgroundColor: isDark ? '#333' : '#fff',
                                padding: '10px',
                                borderRadius: 4,
                                border: `1px solid ${borderColor}`,
                                fontSize: 11,
                                color: isDark ? '#ccc' : '#333',
                                fontFamily: 'monospace',
                                whiteSpace: 'pre-wrap',
                                maxHeight: 300,
                                overflow: 'auto'
                              }}
                            >
                              {renderContext(log.context)}
                            </div>
                          </div>
                        )}
                        {hasDetails && (
                          <div>
                            <Text strong style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>详细信息:</Text>
                            <div
                              style={{
                                backgroundColor: isDark ? '#333' : '#fff',
                                padding: '10px',
                                borderRadius: 4,
                                border: `1px solid ${borderColor}`,
                                fontSize: 11,
                                color: isDark ? '#ccc' : '#333',
                                fontFamily: 'monospace',
                                whiteSpace: 'pre-wrap',
                                maxHeight: 300,
                                overflow: 'auto'
                              }}
                            >
                              {renderDetails(log.details)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              } catch (error) {
                console.error('Error rendering log:', error);
                return (
                  <div
                    key={log.id}
                    className="log-entry log-error"
                    style={{ borderBottomColor: borderColor }}
                  >
                    <span className="log-message">Error rendering log: {error.message}</span>
                  </div>
                );
              }
            })
          )}
        </div>
      </Card>

      <Modal
        title="导出日志"
        open={exportModalVisible}
        onCancel={() => setExportModalVisible(false)}
        footer={null}
      >
        <div style={{ padding: '16px 0' }}>
          <Text>请选择导出格式：</Text>
          <Space orientation="vertical" style={{ width: '100%', marginTop: 16 }}>
            <Button
              type="primary"
              size="large"
              block
              onClick={exportLogsAsTxt}
            >
              导出为文本文件 (.txt)
            </Button>
            <Button
              size="large"
              block
              onClick={exportLogsAsJson}
            >
              导出为 JSON 文件 (.json)
            </Button>
          </Space>
        </div>
      </Modal>
    </div>
  );
};

export default GlobalLogPanel;
