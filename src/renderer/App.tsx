import { useEffect } from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import { useUIStore } from './stores/uiStore';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import PageTransition from './components/Layout/PageTransition';
import Dashboard from './components/Dashboard/Dashboard';
import { findRouteComponent } from './routeConfig';
import './styles/ui-variables.css';
import './styles/App.css';
import './styles/animations.css';
import './styles/compact.css';

const { Content } = Layout;

function App() {
  const { activeTab, theme: appTheme, compactMode, animationEnabled } = useUIStore();

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

  useEffect(() => {
    if (!animationEnabled) {
      document.getElementById('root')?.classList.add('animation-disabled');
    } else {
      document.getElementById('root')?.classList.remove('animation-disabled');
    }
  }, [animationEnabled]);

  const renderContent = () => {
    const Component = findRouteComponent(activeTab);
    if (Component) {
      return <Component />;
    }
    // 兼容原 default 行为：未配置 component 的 tab（如 test-vector）回退到 Dashboard
    return <Dashboard />;
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
            <PageTransition activeKey={activeTab}>
              {renderContent()}
            </PageTransition>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
