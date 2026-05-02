import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/global.css';

console.log('Main.tsx: Starting app');
try {
  const rootElement = document.getElementById('root');
  console.log('Main.tsx: Root element found:', rootElement);
  
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    console.log('Main.tsx: Root created');
    
    root.render(
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#1890ff',
            borderRadius: 6
          }
        }}
      >
        <App />
      </ConfigProvider>
    );
    console.log('Main.tsx: App rendered');
  } else {
    console.error('Main.tsx: Root element not found');
  }
} catch (error) {
  console.error('Main.tsx: Error rendering app:', error);
}
