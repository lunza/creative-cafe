import React from 'react';
import { Tabs } from 'antd';
import { FolderOutlined, UserOutlined, BookOutlined } from '@ant-design/icons';
import { useUIStore, CreativeTabType } from '../../stores/uiStore';
import './CreativeSubNav.css';

const CreativeSubNav: React.FC = () => {
  const creativeTab = useUIStore(s => s.creativeTab);
  const setCreativeTab = useUIStore(s => s.setCreativeTab);

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
        className="creative-sub-tabs"
      />
    </div>
  );
};

export default CreativeSubNav;
