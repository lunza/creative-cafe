import React from 'react';
import { Tabs } from 'antd';
import { OutlineEditSection } from '../../../../shared/types/writing.types';
import {
  BookOutlined,
  FileTextOutlined,
  TeamOutlined,
  GlobalOutlined,
} from '@ant-design/icons';

interface EditTabNavigationProps {
  activeTab: OutlineEditSection;
  onTabChange: (tab: OutlineEditSection) => void;
}

const EditTabNavigation: React.FC<EditTabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const tabItems = [
    {
      key: OutlineEditSection.STORYLINE,
      label: '故事主线',
      icon: <BookOutlined />,
    },
    {
      key: OutlineEditSection.CHAPTERS,
      label: '章节大纲',
      icon: <FileTextOutlined />,
    },
    {
      key: OutlineEditSection.CHARACTERS,
      label: '角色关系',
      icon: <TeamOutlined />,
    },
    {
      key: OutlineEditSection.WORLD,
      label: '世界观',
      icon: <GlobalOutlined />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(key) => onTabChange(key as OutlineEditSection)}
      items={tabItems}
      size="large"
    />
  );
};

export default EditTabNavigation;
