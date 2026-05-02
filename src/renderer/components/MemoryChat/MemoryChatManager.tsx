/**
 * 记忆插件主管理组件
 * 整合表格模板管理和聊天记录管理功能
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Typography, Space } from 'antd';
import {
  FileTextOutlined,
  CommentOutlined
} from '@ant-design/icons';
import MemoryTemplateManager from './TemplateManager';
import ChatManager from './ChatManager';
import '../../styles/list-common.css';
import './MemoryChatManager.css';

const { Text } = Typography;

const MemoryChatManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState('templates');
  const [memoryDir, setMemoryDir] = useState<string>('');

  useEffect(() => {
    loadMemoryDir();
  }, []);

  const loadMemoryDir = useCallback(async () => {
    try {
      const dir = await window.electronAPI.memory.getMemoryDirectory();
      setMemoryDir(dir);
    } catch (error) {
      console.error('Failed to load memory directory:', error);
    }
  }, []);

  const tabItems = [
    {
      key: 'templates',
      label: '表格模板管理',
      icon: <FileTextOutlined />,
      children: <MemoryTemplateManager />
    },
    {
      key: 'chats',
      label: '聊天记录管理',
      icon: <CommentOutlined />,
      children: <ChatManager />
    }
  ];

  return (
    <div className="memory-chat-manager-container list-container">
      {memoryDir && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            存储路径: <Text copyable style={{ fontSize: 12 }}>{memoryDir}</Text>
          </Text>
        </div>
      )}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        type="card"
      />
    </div>
  );
};

export default MemoryChatManager;
