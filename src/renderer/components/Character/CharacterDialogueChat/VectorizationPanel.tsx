import React, { useState, useCallback, useEffect } from 'react';
import { DownOutlined, RightOutlined, DatabaseOutlined, AppstoreOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import KnowledgeBaseBindingPanel from './KnowledgeBaseBindingPanel';
import './ConfigPanel.css';

interface VectorizationPanelProps {
  characterCardId: string;
  boundKnowledgeBaseIds: string[];
  onBindKnowledgeBase: (documentId: string) => void;
  onUnbindKnowledgeBase: (documentId: string) => void;
}

const VectorizationPanel: React.FC<VectorizationPanelProps> = ({
  characterCardId,
  boundKnowledgeBaseIds,
  onBindKnowledgeBase,
  onUnbindKnowledgeBase,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('vectorization-panel-collapsed');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('vectorization-panel-collapsed', String(collapsed));
  }, [collapsed]);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  return (
    <div className="vectorization-panel">
      <div className="vectorization-panel-header" onClick={toggleCollapse} style={{ cursor: 'pointer' }}>
        <div className="vectorization-panel-title">
          <div className="vectorization-collapse-icon">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </div>
          <AppstoreOutlined className="vectorization-icon" />
          <span>知识库检索</span>
          <Tooltip title="绑定知识库文档，对话时自动检索相关内容注入上下文。向量化模型请在系统设置中配置。">
            <QuestionCircleOutlined className="vectorization-tooltip-icon" />
          </Tooltip>
        </div>
      </div>

      <div className={`vectorization-panel-content ${collapsed ? 'collapsed' : ''}`}>
        <KnowledgeBaseBindingPanel
          characterCardId={characterCardId}
          boundKnowledgeBaseIds={boundKnowledgeBaseIds}
          onBindKnowledgeBase={onBindKnowledgeBase}
          onUnbindKnowledgeBase={onUnbindKnowledgeBase}
        />
      </div>
    </div>
  );
};

export default VectorizationPanel;
