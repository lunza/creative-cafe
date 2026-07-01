import React, { useState, useCallback } from 'react';
import { Modal, Select, Tag, Typography, message } from 'antd';

const { Text } = Typography;
const { Option } = Select;

const DEFAULT_TEMPLATE_ID = 'st-memory-enhancement-default';

export interface TableTemplateInfo {
  id: string;
  name: string;
  description?: string;
  sheets: Array<{ name: string; headers: string[]; description?: string }>;
  isCopy?: boolean;
}

export interface TableConfigState {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: string;
  associatedTemplateId: string | null;
  associatedTemplateName: string;
  organizeRequirements?: string;
}

export interface TableTemplateBinderProps {
  /** 当前项目 ID */
  projectId?: string;
  /** 当前已绑定的表格配置（用于显示已绑定模板信息） */
  tableConfig: TableConfigState | null;
  /** 受控：Modal 是否可见 */
  visible: boolean;
  /** 受控：关闭 Modal */
  onClose: () => void;
  /**
   * 绑定成功的回调，由父组件负责刷新表格数据与更新 tableConfig
   * 父组件在内部应执行 loadTableData() 与 setTableConfig(newConfig)
   */
  onBound: (config: TableConfigState) => void;
}

/**
 * 表格模板绑定 Modal
 *
 * 抽自原 TableOrganizePanelContent 的模板绑定子功能：
 * - 模板列表加载、模板选择、绑定提交
 * - 模板列表的 state 与绑定 loading state 全部聚合在本组件内部
 *
 * 与父组件的接口保持简单：通过 visible/onClose 受控，
 * 绑定成功后通过 onBound 回调通知父组件刷新数据与更新 tableConfig。
 */
const TableTemplateBinder: React.FC<TableTemplateBinderProps> = ({
  projectId,
  tableConfig,
  visible,
  onClose,
  onBound,
}) => {
  const [templates, setTemplates] = useState<TableTemplateInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [bindingLoading, setBindingLoading] = useState(false);

  // 每次 Modal 打开时重新拉取模板列表并初始化选中项
  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const loadTemplates = async () => {
      try {
        const response = await window.electronAPI.writing.table.getAllTemplates();
        if (cancelled) return;
        if (response.success && response.templates) {
          const originalTemplates = (response.templates as TableTemplateInfo[]).filter((t) => !t.isCopy);
          const sortedTemplates = [...originalTemplates].sort((a, b) => {
            if (a.id === DEFAULT_TEMPLATE_ID) return -1;
            if (b.id === DEFAULT_TEMPLATE_ID) return 1;
            return a.name.localeCompare(b.name);
          });
          setTemplates(sortedTemplates);
          if (tableConfig?.associatedTemplateId) {
            setSelectedTemplateId(tableConfig.associatedTemplateId);
          } else {
            const defaultTemplate = sortedTemplates.find((t) => t.id === DEFAULT_TEMPLATE_ID);
            setSelectedTemplateId(defaultTemplate?.id || '');
          }
        } else {
          message.error('获取模板列表失败');
        }
      } catch (error) {
        message.error(`获取模板失败: ${error}`);
      }
    };
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [visible, tableConfig?.associatedTemplateId]);

  const handleClose = useCallback(() => {
    setSelectedTemplateId('');
    onClose();
  }, [onClose]);

  const handleBindTemplate = useCallback(async () => {
    if (!selectedTemplateId) {
      message.warning('请选择要绑定的模板');
      return;
    }

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    if (!selectedTemplate) {
      message.error('模板不存在');
      return;
    }

    const sheetsData = selectedTemplate.sheets;
    const sheetsValid = sheetsData && Array.isArray(sheetsData) && sheetsData.length > 0;
    if (!sheetsValid) {
      message.error('模板数据不完整');
      return;
    }

    if (!projectId) {
      message.error('项目 ID 缺失');
      return;
    }

    setBindingLoading(true);
    try {
      const result = await window.electronAPI.writing.table.associateTableTemplate(
        projectId,
        selectedTemplateId,
        selectedTemplate.name,
        sheetsData
      );
      if (result.success) {
        message.success(`已绑定模板: ${selectedTemplate.name}`);
        const newConfig: TableConfigState = {
          enabled: true,
          autoOrganize: false,
          organizeMode: 'sync',
          associatedTemplateId: selectedTemplateId,
          associatedTemplateName: selectedTemplate.name,
        };
        onBound(newConfig);
        setSelectedTemplateId('');
        onClose();
      } else {
        message.error(`绑定模板失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`绑定模板失败: ${error}`);
    } finally {
      setBindingLoading(false);
    }
  }, [selectedTemplateId, templates, projectId, onBound, onClose]);

  return (
    <Modal
      title="绑定表格模板"
      open={visible}
      onCancel={handleClose}
      onOk={handleBindTemplate}
      confirmLoading={bindingLoading}
    >
      {tableConfig?.associatedTemplateId && (
        <div style={{ marginBottom: 16 }}>
          <Text>当前模板:</Text>{' '}
          <Tag color="green">{tableConfig.associatedTemplateName}</Tag>
        </div>
      )}

      <p>请选择要绑定的表格模板：</p>
      <Select
        style={{ width: '100%' }}
        placeholder="选择模板"
        value={selectedTemplateId}
        onChange={setSelectedTemplateId}
      >
        {templates.length === 0 ? (
          <Option value="" disabled>
            暂无可用模板
          </Option>
        ) : (
          templates.map((template) => (
            <Option key={template.id} value={template.id}>
              {template.id === DEFAULT_TEMPLATE_ID && '⭐ '}
              {template.name}
              {template.id === DEFAULT_TEMPLATE_ID && ' 默认模板'}
              {template.sheets && template.sheets.length > 0 && ` (${template.sheets.length} 个页签)`}
            </Option>
          ))
        )}
      </Select>
      {selectedTemplateId && (
        <p style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
          {templates.find((t) => t.id === selectedTemplateId)?.description || '暂无描述'}
        </p>
      )}
      <p style={{ marginTop: 16, color: '#888', fontSize: 12 }}>
        绑定模板将创建对应的表格结构，已有的表格数据将被覆盖。
      </p>
    </Modal>
  );
};

export default React.memo(TableTemplateBinder);
