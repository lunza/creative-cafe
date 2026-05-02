import React, { useEffect } from 'react';
import { Card, Tabs, Button, Space, Typography, Divider, Tag, Badge } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  HistoryOutlined,
  FileOutlined,
  RocketOutlined,
  FileTextOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore';
import { useUIStore } from '../../stores/uiStore';
import GeneratePrompt from './GeneratePrompt';
import OptimizePrompt from './OptimizePrompt';
import PromptHistory from './PromptHistory';
import PromptTemplates from './PromptTemplates';
import PreviewPrompt from './PreviewPrompt';
import './PromptOptimizer.css';

const { TabPane } = Tabs;
const { Text, Title } = Typography;

const PromptOptimizer: React.FC = () => {
  const { theme } = useUIStore();
  const { 
    loadHistory, 
    loadTemplates,
    exportData,
    importData,
    currentPrompt
  } = usePromptOptimizerStore();

  useEffect(() => {
    loadHistory();
    loadTemplates();
  }, []);

  const handleExportData = () => {
    const data = exportData();
    if (data) {
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-optimizer-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImportData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          importData(result);
        };
        reader.readAsText(target.files[0]);
      }
    };
    input.click();
  };

  return (
    <div className={`prompt-optimizer ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`}>
      <div className="prompt-optimizer-header">
        <Title level={2} style={{ marginBottom: 0, color: theme === 'dark' ? '#40a9ff' : '#1890ff' }}>
          <RocketOutlined style={{ marginRight: 8 }} /> 系统提示词优化器
        </Title>
        <Text type="secondary">
          基于已连接的大模型，智能生成和优化系统提示词
        </Text>
      </div>

      <Divider />

      {currentPrompt && (
        <Card className="current-prompt-card" size="small">
          <div className="current-prompt-header">
            <Text strong>当前提示词</Text>
            <Space size="small">
              <Badge count={currentPrompt.length} showZero style={{ backgroundColor: theme === 'dark' ? '#40a9ff' : '#1890ff' }} />
              <Button 
                type="link" 
                size="small" 
                onClick={() => navigator.clipboard.writeText(currentPrompt)}
              >
                复制
              </Button>
            </Space>
          </div>
          <div className="current-prompt-content">
            <Text>{currentPrompt}</Text>
          </div>
        </Card>
      )}

      <Divider />

      <Tabs defaultActiveKey="generate" className="prompt-optimizer-tabs">
        <TabPane tab={<><RocketOutlined /> 自动生成</>} key="generate">
          <GeneratePrompt />
        </TabPane>
        <TabPane tab={<><EditOutlined /> 优化功能</>} key="optimize">
          <OptimizePrompt />
        </TabPane>
        <TabPane tab={<><EyeOutlined /> 效果预览</>} key="preview">
          <PreviewPrompt />
        </TabPane>
        <TabPane tab={<><HistoryOutlined /> 历史记录</>} key="history">
          <PromptHistory />
        </TabPane>
        <TabPane tab={<><FileOutlined /> 模板库</>} key="templates">
          <PromptTemplates />
        </TabPane>
      </Tabs>

      <Divider />

      <div className="prompt-optimizer-footer">
        <Space>
          <Button 
            icon={<FileTextOutlined />} 
            onClick={handleExportData}
          >
            导出数据
          </Button>
          <Button 
            icon={<PlusOutlined />} 
            onClick={handleImportData}
          >
            导入数据
          </Button>
        </Space>
        <Text type="secondary">
          提示：该模块需要已连接的大模型才能正常工作
        </Text>
      </div>
    </div>
  );
};

export default PromptOptimizer;
