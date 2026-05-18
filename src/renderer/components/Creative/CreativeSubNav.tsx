import React from 'react';
import { Tabs } from 'antd';
import { FolderOutlined, UserOutlined, BookOutlined, EditOutlined } from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import './CreativeSubNav.css';

export type CreativeTabType = 'creative' | 'character' | 'worldbook' | 'writing';

const CreativeSubNav: React.FC = () => {
  const { creativeTab, setCreativeTab } = useUIStore();

  const tabItems = [
    {
      key: 'creative',
      label: (
        <span>
          <FolderOutlined />
          创意
        </span>
      ),
    },
    {
      key: 'character',
      label: (
        <span>
          <UserOutlined />
          角色卡
        </span>
      ),
    },
    {
      key: 'worldbook',
      label: (
        <span>
          <BookOutlined />
          世界书
        </span>
      ),
    },
    {
      key: 'writing',
      label: (
        <span>
          <EditOutlined />
          写作模式
        </span>
      ),
    },
  ];

  const handleChange = (activeKey: string) => {
    setCreativeTab(activeKey as CreativeTabType);
  };

  return (
    <div className="creative-sub-nav">
      <Tabs
        activeKey={creativeTab}
        items={tabItems}
        onChange={handleChange}
        size="default"
        className="creative-sub-tabs"
      />
    </div>
  );
};

export default CreativeSubNav;
