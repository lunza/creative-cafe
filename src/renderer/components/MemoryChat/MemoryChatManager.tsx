/**
 * 记忆插件主管理组件
 * 整合表格模板管理和聊天记录管理功能
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Typography, Space, message } from 'antd';
import {
  FileTextOutlined,
  CommentOutlined,
  FolderOpenOutlined,
  CopyOutlined
} from '@ant-design/icons';
import MemoryTemplateManager from './TemplateManager';
import ChatManager from './ChatManager';
import { StoragePathDisplay } from '../common/StoragePathDisplay';
import '../../styles/list-common.css';
import './MemoryChatManager.css';

const { Text, Title } = Typography;

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

  const handleOpenFolder = async () => {
    try {
      if (!memoryDir) return;
      await window.electronAPI.file.openFolder(memoryDir);
    } catch (error) {
      message.error('打开文件夹失败');
    }
  };

  const handleCopyPath = async () => {
    try {
      if (!memoryDir) return;
      await navigator.clipboard.writeText(memoryDir);
      message.success('路径已复制到剪贴板');
    } catch (error) {
      message.error('复制路径失败');
    }
  };

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
      <h2>记忆管理</h2>
      {memoryDir && (
        <StoragePathDisplay
          label="存储路径"
          path={memoryDir}
          onOpenFolder={handleOpenFolder}
          onCopyPath={handleCopyPath}
        />
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
