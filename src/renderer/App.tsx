import React, { useEffect } from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import { useUIStore } from './stores/uiStore';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import FloatingLogButton from './components/Layout/FloatingLogButton';
import GlobalLogPanel from './components/Layout/GlobalLogPanel';
import Dashboard from './components/Dashboard/Dashboard';

import PromptOptimizer from './components/PromptOptimizer/PromptOptimizer';
import WorldBookManager from './components/WorldBook/WorldBookManager';
import AvatarManager from './components/Avatar/AvatarManager';
import CharacterManager from './components/Character/CharacterManager';
import PluginManager from './components/Plugin/PluginManager';
import Settings from './components/Settings/Settings';
import MemoryChatManager from './components/MemoryChat/MemoryChatManager';
import CreativeManager from './components/Creative/CreativeManager';
import TestPage from './components/Test/TestPage';
import VectorTestPage from './components/Test/VectorTestPage';
import DocumentVectorPage from './components/Test/DocumentVectorPage';
import { KnowledgeBaseManager } from './components/KnowledgeBase/KnowledgeBaseManager';
import './styles/App.css';
import './styles/animations.css';
import './styles/compact.css';

const { Content } = Layout;

function App() {
  const { activeTab, theme: appTheme, compactMode } = useUIStore();

  useEffect(() => {
    if (appTheme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }, [appTheme]);

  useEffect(() => {
    if (compactMode) {
      document.body.classList.add('compact-mode');
    } else {
      document.body.classList.remove('compact-mode');
    }
  }, [compactMode]);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
     
      case 'prompt-optimizer':
        return <PromptOptimizer />;
      case 'worldbook':
        return <WorldBookManager />;
      case 'avatar':
        return <AvatarManager />;
      case 'character':
        return <CharacterManager />;
      case 'plugin':
        return <PluginManager />;
      case 'memory':
        return <MemoryChatManager />;
      case 'knowledge':
        return <KnowledgeBaseManager />;
      case 'creative':
        return <CreativeManager />;
      case 'settings':
        return <Settings />;
      case 'test':
      case 'test-vector':
        return <VectorTestPage />;
      case 'document-vector':
        return <DocumentVectorPage />;
      case 'test-markdown':
        return <TestPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm
      }}
    >
      <Layout className={`app-layout ${appTheme === 'dark' ? 'dark' : ''}`}>
        <Sidebar />
        <Layout>
          <Header />
          <Content className={`app-content ${appTheme === 'dark' ? 'dark' : ''}`}>
            {renderContent()}
          </Content>
        </Layout>
        
        {/* 全局日志浮动按钮 */}
        <FloatingLogButton />
        
        {/* 全局日志面板 */}
        <GlobalLogPanel />
      </Layout>
    </ConfigProvider>
  );
}

export default App;
