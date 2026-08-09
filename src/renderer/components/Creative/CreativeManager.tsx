import React, { useEffect, useCallback, useState } from 'react';
import { Layout, Typography } from 'antd';
import { RocketOutlined } from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import CreativeSubNav from './CreativeSubNav';
import CreativeListPage from './CreativeListPage';
import CreativeEditPage from './CreativeEditPage';
import CharacterCardListPage from './CharacterCardListPage';
import CharacterCardEditPage from './CharacterCardEditPage';
import WorldBookListPage from './WorldBookListPage';
import WorldBookEditPage from './WorldBookEditPage';
import { StoragePathDisplay } from '../common/StoragePathDisplay';
import './CreativeManager.css';

const { Title, Text } = Typography;
const { Content } = Layout;

const CreativeManager: React.FC = () => {
  const creativeTab = useUIStore(s => s.creativeTab);
  const creativeView = useUIStore(s => s.creativeView);
  const theme = useUIStore(s => s.theme);
  const [creativeDir, setCreativeDir] = useState<string>('');

  useEffect(() => {
    loadCreativeDir();
  }, []);

  const loadCreativeDir = useCallback(async () => {
    try {
      const dir = await window.electronAPI.creative.getDirectory();
      setCreativeDir(dir);
    } catch (error) {
      console.error('Failed to load creative directory:', error);
    }
  }, []);

  const handleOpenFolder = async () => {
    try {
      if (!creativeDir) return;
      await window.electronAPI.file.openFolder(creativeDir);
    } catch {
      // ignore
    }
  };

  const handleCopyPath = async () => {
    try {
      if (!creativeDir) return;
      await navigator.clipboard.writeText(creativeDir);
    } catch {
      // ignore
    }
  };

  const renderContent = () => {
    switch (creativeTab) {
      case 'creative':
        return creativeView === 'list' ? <CreativeListPage /> : <CreativeEditPage />;
      case 'character':
        return creativeView === 'list' ? <CharacterCardListPage /> : <CharacterCardEditPage />;
      case 'worldbook':
        return creativeView === 'list' ? <WorldBookListPage /> : <WorldBookEditPage />;
      default:
        return <CreativeListPage />;
    }
  };

  return (
    <Layout className="creative-manager-layout" style={{ height: '100%' }}>
      <Layout className="creative-manager-content">
        <div className="creative-manager-header">
          <div>
            <Title level={3} style={{ margin: 0 }}>
              <RocketOutlined style={{ marginRight: 8 }} /> 创意管理
            </Title>
            <Text type="secondary">
              基于已连接的大模型，智能生成和优化角色卡与世界书内容
            </Text>
            {creativeDir && (
              <StoragePathDisplay
                label="创意存储路径"
                path={creativeDir}
                onOpenFolder={handleOpenFolder}
                onCopyPath={handleCopyPath}
              />
            )}
          </div>
        </div>

        <CreativeSubNav />

        <Content className="creative-manager-body">
          {renderContent()}
        </Content>
      </Layout>
    </Layout>
  );
};

export default CreativeManager;
