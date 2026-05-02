import React, { useRef } from 'react';
import { Card, Typography, Divider, Switch, Space } from 'antd';
import { useUIStore } from '../../stores/uiStore';
import MarkdownEditor, { type MarkdownEditorHandle } from '../Common/MarkdownEditor';

const { Title, Text } = Typography;

const TestPage: React.FC = () => {
  const { theme, setTheme } = useUIStore();
  const editorRef = useRef<MarkdownEditorHandle>(null);

  return (
    <div style={{
      padding: '40px 24px',
      maxWidth: '1200px',
      margin: '0 auto',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        padding: '40px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <Title level={1} style={{
            marginBottom: '8px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            🚀 MarkdownEditor 公共组件测试
          </Title>
          <Text type="secondary" style={{ fontSize: '16px' }}>
            测试封装的 MarkdownEditor 通用组件（支持 AI 流式响应）
          </Text>
        </div>

        <div style={{ textAlign: 'right', marginBottom: '24px' }}>
          <Space>
            <Text>{theme === 'light' ? '亮色模式' : '暗色模式'}</Text>
            <Switch
              checked={theme === 'dark'}
              onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              checkedChildren="🌙"
              unCheckedChildren="☀️"
            />
          </Space>
        </div>

        <Divider style={{ margin: '24px 0' }} />

        {/* 使用公共 MarkdownEditor 组件 */}
        <Card style={{
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <MarkdownEditor
            ref={editorRef}
            theme={theme}
            enableAITools={true}
            enableSave={true}
            storageKey="test_page_markdown_content"
            autoSaveInterval={10000}
            onSave={(content) => {
              console.log('内容已保存:', content.substring(0, 50) + '...');
            }}
            onLoad={(content) => {
              console.log('从本地存储加载内容:', content.substring(0, 50) + '...');
            }}
            minHeight="700px"
            placeholder="开始输入您的内容..."
          />
        </Card>

        <Divider style={{ margin: '32px 0' }} />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '20px'
        }}>
          <Card
            size="small"
            style={{
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none'
            }}
            styles={{ header: { borderBottom: 'none', color: 'white' } }}
            title="✅ 组件状态"
          >
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
              <li>公共组件已封装</li>
              <li>类型定义完整</li>
              <li>文档齐全</li>
              <li>可复用性高</li>
            </ul>
          </Card>

          <Card
            size="small"
            style={{
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              color: 'white',
              border: 'none'
            }}
            styles={{ header: { borderBottom: 'none', color: 'white' } }}
            title="✨ 核心功能"
          >
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
              <li>Markdown 编辑器</li>
              <li>AI 辅助工具（流式响应）</li>
              <li>实时内容更新</li>
              <li>主题切换</li>
              <li>受控/非受控模式</li>
            </ul>
          </Card>

          <Card
            size="small"
            style={{
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
              color: 'white',
              border: 'none'
            }}
            styles={{ header: { borderBottom: 'none', color: 'white' } }}
            title="📱 使用方法"
          >
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
              <li>直接 import 组件</li>
              <li>配置 props</li>
              <li>使用 ref 操作编辑器</li>
              <li>集成到任意页面</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default TestPage;
