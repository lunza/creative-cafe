import { Suspense, useEffect } from 'react';
import { Layout, Spin } from 'antd';
import { useUIStore } from './stores/uiStore';
import { useSettingStore } from './stores/settingStore';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import { ThemeProvider } from './components/Common/ThemeProvider';
import PageTransition from './components/Layout/PageTransition';
import Dashboard from './components/Dashboard/Dashboard';
import { findRouteComponent } from './routeConfig';
import './styles/ui-variables.css';
import './styles/App.css';
import './styles/animations.css';
import './styles/compact.css';

// 路由懒加载时的占位 fallback（居中 Spin）
const routeFallback = (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
    <Spin size="large" />
  </div>
);

const { Content } = Layout;

function App() {
  const activeTab = useUIStore(s => s.activeTab);
  const compactMode = useUIStore(s => s.compactMode);
  const animationEnabled = useUIStore(s => s.animationEnabled);

  useEffect(() => {
    // 应用启动时全局加载设置：settingStore 无初始值，此前依赖各页面组件自行 fetchSetting
    // （Dashboard/Settings 等的挂载 effect）。uiStore.activeTab 会恢复上次所在页，
    // 若恢复到的页面不触发 fetch（如创作中心），读取设置的功能（如漫画解析的
    // supportsVision 判断）会拿到 null 而误报「AI 模型不支持图片识别」。
    useSettingStore.getState().fetchSetting();
  }, []);

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
    <ThemeProvider>
      <Layout className="app-layout">
        <Sidebar />
        <Layout>
          <Header />
          <Content className="app-content">
            <PageTransition activeKey={activeTab}>
              {/* Suspense 仅包裹路由内容，保持 Sidebar/Header 始终可见 */}
              <Suspense fallback={routeFallback}>{renderContent()}</Suspense>
            </PageTransition>
          </Content>
        </Layout>
      </Layout>
    </ThemeProvider>
  );
}

export default App;
