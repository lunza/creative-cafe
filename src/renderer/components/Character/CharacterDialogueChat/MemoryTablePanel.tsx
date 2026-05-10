import React, { useState, useCallback, useEffect } from 'react';
import { Switch, Tooltip, Button, Radio } from 'antd';
import { DownOutlined, RightOutlined, TableOutlined, QuestionCircleOutlined, EyeOutlined } from '@ant-design/icons';
import TablePreviewModal from './TablePreviewModal';
import './ConfigPanel.css';

interface MemoryTablePanelProps {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async';
  characterCardName: string;
  onToggle: (enabled: boolean) => void;
  onAutoOrganizeToggle: (enabled: boolean) => void;
  onOrganizeModeChange: (mode: 'sync' | 'async') => void;
}

const MemoryTablePanel: React.FC<MemoryTablePanelProps> = ({
  enabled,
  autoOrganize,
  organizeMode,
  characterCardName,
  onToggle,
  onAutoOrganizeToggle,
  onOrganizeModeChange,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('memory-table-panel-collapsed');
    return saved === 'true';
  });
  const [previewVisible, setPreviewVisible] = useState(false);

  useEffect(() => {
    localStorage.setItem('memory-table-panel-collapsed', String(collapsed));
  }, [collapsed]);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  const handleToggle = useCallback((checked: boolean) => {
    onToggle(checked);
    if (!checked) {
      onAutoOrganizeToggle(false);
    }
  }, [onToggle, onAutoOrganizeToggle]);

  const handleAutoOrganizeToggle = useCallback((checked: boolean) => {
    onAutoOrganizeToggle(checked);
    if (!checked) {
      // 关闭实时整理时，重置为同步模式
      onOrganizeModeChange('sync');
    }
  }, [onAutoOrganizeToggle, onOrganizeModeChange]);

  const handlePreview = useCallback(() => {
    setPreviewVisible(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewVisible(false);
  }, []);

  return (
    <div className="memory-table-panel">
      <div className="memory-table-panel-header" onClick={toggleCollapse} style={{ cursor: 'pointer' }}>
        <div className="memory-table-panel-title">
          <div className="memory-table-collapse-icon">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </div>
          <TableOutlined className="memory-table-icon" />
          <span>记忆表格设置</span>
        </div>
      </div>

      <div className={`memory-table-panel-content ${collapsed ? 'collapsed' : ''}`}>
        <div className="memory-table-toggles">
          <div className="memory-table-toggle-row">
            <div className="memory-table-toggle-label">
              <span>是否启用</span>
              <Tooltip title="启用后，系统将在对话提示词中整合记忆管理模块的表格数据，强化AI的历史记忆能力">
                <QuestionCircleOutlined className="memory-table-tooltip-icon" />
              </Tooltip>
            </div>
            <Switch
              checked={enabled}
              onChange={handleToggle}
              size="small"
              className="memory-table-switch"
            />
          </div>

          <div className="memory-table-toggle-row">
            <div className="memory-table-toggle-label">
              <span>是否实时整理表格</span>
              <Tooltip title="启用后，每次对话完成后将自动触发表格整理操作">
                <QuestionCircleOutlined className="memory-table-tooltip-icon" />
              </Tooltip>
            </div>
            <Switch
              checked={enabled && autoOrganize}
              onChange={handleAutoOrganizeToggle}
              disabled={!enabled}
              size="small"
              className="memory-table-switch"
            />
          </div>

          {enabled && autoOrganize && (
            <div className="memory-table-toggle-row" style={{ paddingLeft: 24 }}>
              <div className="memory-table-toggle-label" style={{ width: '100%' }}>
                <Radio.Group
                  value={organizeMode}
                  onChange={(e) => onOrganizeModeChange(e.target.value)}
                  size="small"
                >
                  <Tooltip
                    title={
                      <div>
                        <div><b>同步整理</b></div>
                        <div><b>原理：</b>对话结束后，系统独立发起一次API请求，AI专注于分析对话并生成整理命令</div>
                        <div><b>速度：</b>较慢（需额外等待一次API响应）</div>
                        <div><b>质量：</b>较高（AI可集中精力分析，命令更精准）</div>
                        <div><b>适用：</b>对数据准确性要求高的场景</div>
                      </div>
                    }
                  >
                    <Radio value="sync">同步整理</Radio>
                  </Tooltip>
                  <Tooltip
                    title={
                      <div>
                        <div><b>异步整理</b></div>
                        <div><b>原理：</b>在对话提示词中嵌入整理指令，AI在回复对话内容的同时，在末尾隐式附带整理命令</div>
                        <div><b>速度：</b>较快（无需额外API请求，与对话同步完成）</div>
                        <div><b>质量：</b>一般（AI需兼顾对话和整理，命令可能不够完善）</div>
                        <div><b>延时：</b>整理触发延时一回合（即第5条对话整理的是第3条对话的信息）</div>
                        <div><b>适用：</b>追求流畅体验、对速度要求高的场景</div>
                      </div>
                    }
                  >
                    <Radio value="async">异步整理</Radio>
                  </Tooltip>
                </Radio.Group>
              </div>
            </div>
          )}

          <div className="memory-table-action-row">
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreview}
              size="small"
              className="memory-table-preview-btn"
              block
            >
              预览表格
            </Button>
          </div>
        </div>
      </div>

      <TablePreviewModal
        visible={previewVisible}
        characterCardName={characterCardName}
        onClose={handleClosePreview}
      />
    </div>
  );
};

export default MemoryTablePanel;
