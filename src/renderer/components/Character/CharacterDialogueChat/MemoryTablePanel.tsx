import React, { useState, useCallback, useEffect } from 'react';
import { Switch, Tooltip, Button, Radio, Select, Modal, message } from 'antd';
import { DownOutlined, RightOutlined, TableOutlined, QuestionCircleOutlined, EyeOutlined, LinkOutlined, ThunderboltOutlined } from '@ant-design/icons';
import TablePreviewModal from './TablePreviewModal';
import './ConfigPanel.css';

const { Option } = Select;

interface MemoryTablePanelProps {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async';
  associatedTemplateId: string | null;
  associatedTemplateName: string;
  characterCardName: string;
  onToggle: (enabled: boolean) => void;
  onAutoOrganizeToggle: (enabled: boolean) => void;
  onOrganizeModeChange: (mode: 'sync' | 'async') => void;
  onTemplateAssociate: (templateId: string, templateName: string) => void;
  // 手动触发表格整理（Spec: add-manual-table-organize-button / Task 3）
  onManualOrganize: () => void;
  manualOrganizing: boolean;
}

const MemoryTablePanel: React.FC<MemoryTablePanelProps> = ({
  enabled,
  autoOrganize,
  organizeMode,
  associatedTemplateId,
  associatedTemplateName,
  characterCardName,
  onToggle,
  onAutoOrganizeToggle,
  onOrganizeModeChange,
  onTemplateAssociate,
  onManualOrganize,
  manualOrganizing,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('memory-table-panel-collapsed');
    return saved === 'true';
  });
  const [previewVisible, setPreviewVisible] = useState(false);

  // 关联模板 Modal 相关状态
  const [associateModalVisible, setAssociateModalVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [associateLoading, setAssociateLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('memory-table-panel-collapsed', String(collapsed));
  }, [collapsed]);

  // 加载模板列表
  useEffect(() => {
    loadTemplates();
  }, []);

  // 同步 selectedTemplate 与 associatedTemplateId
  useEffect(() => {
    setSelectedTemplate(associatedTemplateId || '');
  }, [associatedTemplateId]);

  const loadTemplates = async () => {
    try {
      const allTemplates = await window.electronAPI.memory.getAllTemplates();
      setTemplates(allTemplates || []);
    } catch (error) {
      console.error('加载模板列表失败:', error);
    }
  };

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  const handleToggle = useCallback((checked: boolean) => {
    if (checked && !associatedTemplateId) {
      message.warning('启用记忆表格前，请先关联一个模板');
      setAssociateModalVisible(true);
      return;
    }
    onToggle(checked);
    if (!checked) {
      onAutoOrganizeToggle(false);
    }
  }, [onToggle, onAutoOrganizeToggle, associatedTemplateId]);

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

  const handleAssociateTemplate = async () => {
    const templateIdToAssociate = selectedTemplate || associatedTemplateId;
    if (!templateIdToAssociate) {
      message.error('请选择模板');
      return;
    }

    // 查找模板名称
    const template = templates.find(t => t.id === templateIdToAssociate);
    const templateName = template?.name || templateIdToAssociate;

    setAssociateLoading(true);
    try {
      // 调用 IPC 执行实际的模板关联（创建模板副本、创建表格文件、存储关联关系）
      await window.electronAPI.memory.associateTemplate(characterCardName, templateIdToAssociate);

      // 将关联信息持久化到角色配置中
      onTemplateAssociate(templateIdToAssociate, templateName);

      message.success('关联模板成功');
      setAssociateModalVisible(false);
    } catch (error) {
      console.error('关联模板失败:', error);
      message.error('关联模板失败');
    } finally {
      setAssociateLoading(false);
    }
  };

  const handleOpenAssociateModal = useCallback(() => {
    setSelectedTemplate(associatedTemplateId || '');
    setAssociateModalVisible(true);
  }, [associatedTemplateId]);

  return (
    <div className="memory-table-panel">
      <div className="memory-table-panel-header" onClick={toggleCollapse} style={{ cursor: 'pointer' }}>
        <div className="memory-table-panel-title">
          <div className="memory-table-collapse-icon">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </div>
          <TableOutlined className="memory-table-icon" />
          <span>记忆表格设置</span>
          <Tooltip title="启用后，系统将在对话提示词中整合记忆管理模块的表格数据，强化AI的历史记忆能力">
            <QuestionCircleOutlined className="memory-table-tooltip-icon" />
          </Tooltip>
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

          {/* 手动触发表格整理（Spec: add-manual-table-organize-button / Task 3）
              仅在启用记忆表格且未启用实时整理时显示，作为实时整理功能的手动替代方案 */}
          {enabled && !autoOrganize && (
            <div className="memory-table-action-row">
              <Tooltip
                title={
                  <div>
                    <div><b>手动整理表格</b></div>
                    <div>对未启用实时整理期间积累的对话记录，手动触发一次表格整理</div>
                    <div>整理算法与规则和实时整理完全一致，仅处理上次整理位置之后的记录</div>
                  </div>
                }
              >
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={onManualOrganize}
                  loading={manualOrganizing}
                  size="small"
                  className="memory-table-manual-organize-btn"
                  block
                >
                  手动整理表格
                </Button>
              </Tooltip>
              <div style={{ fontSize: '12px', color: '#999', marginTop: 4, textAlign: 'center' }}>
                实时整理未启用，可点击上方按钮手动触发表格整理
              </div>
            </div>
          )}

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
              icon={<LinkOutlined />}
              onClick={handleOpenAssociateModal}
              size="small"
              className={`memory-table-associate-btn ${associatedTemplateId ? 'has-association' : 'no-association'}`}
              block
            >
              {associatedTemplateId ? `已关联: ${associatedTemplateName}` : '关联模板'}
            </Button>
          </div>

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

      {/* 关联模板 Modal */}
      <Modal
        title="关联模板"
        open={associateModalVisible}
        onCancel={() => {
          setAssociateModalVisible(false);
          setSelectedTemplate(associatedTemplateId || '');
        }}
        onOk={handleAssociateTemplate}
        confirmLoading={associateLoading}
        width={480}
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
            选择要关联的表格模板，关联后系统将使用该模板的结构创建记忆表格
          </p>
        </div>
        <Select
          placeholder="选择模板"
          value={selectedTemplate || undefined}
          onChange={setSelectedTemplate}
          style={{ width: '100%' }}
          allowClear
        >
          {templates.map(template => (
            <Option key={template.id} value={template.id}>
              {template.name}
            </Option>
          ))}
        </Select>
        {templates.length === 0 && (
          <p style={{ color: '#ff4d4f', fontSize: 12, marginTop: 8 }}>
            暂无可用模板，请先在记忆管理 - 模板管理中创建模板
          </p>
        )}
      </Modal>
    </div>
  );
};

export default MemoryTablePanel;
