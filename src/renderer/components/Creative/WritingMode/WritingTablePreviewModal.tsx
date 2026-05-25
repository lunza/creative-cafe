import React, { useState, useCallback, useRef } from 'react';
import { Modal, Table, Tabs, Spin, Empty, Button, Input, Popconfirm, message, Space, Typography, Select, Progress, Tag, Alert } from 'antd';
import { DownloadOutlined, ClearOutlined, SaveOutlined, SyncOutlined, LinkOutlined, RocketOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../../stores/settingStore';

const { Text } = Typography;
const { Option } = Select;

interface SheetData {
  [sheetName: string]: Record<string, any>[];
}

interface SheetHeaders {
  [sheetName: string]: string[];
}

interface TemplateInfo {
  id: string;
  name: string;
  description?: string;
  sheets: Array<{ name: string; headers: string[]; description?: string }>;
  isCopy?: boolean;
}

interface WritingTablePreviewModalProps {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  chapterId?: number;
  chapterTitle?: string;
  chapterContent?: string;
  onOrganizeStatusChange?: (isOrganizing: boolean) => void;
}

const WritingTablePreviewModal: React.FC<WritingTablePreviewModalProps> = ({
  visible,
  projectId,
  onClose,
  chapterId,
  chapterTitle,
  chapterContent,
  onOrganizeStatusChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [tableConfig, setTableConfig] = useState<{
    enabled: boolean;
    autoOrganize: boolean;
    organizeMode: string;
    associatedTemplateId: string | null;
    associatedTemplateName: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheets, setSheets] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [allSheetData, setAllSheetData] = useState<SheetData>({});
  const [allSheetHeaders, setAllSheetHeaders] = useState<SheetHeaders>({});
  const [tableData, setTableData] = useState<Record<string, any>[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string>('');
  const [pageSize, setPageSize] = useState(20);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string>('');

  const DEFAULT_TEMPLATE_ID = 'st-memory-enhancement-default';

  const setting = useSettingStore((state) => state.setting);
  const aiEngines = setting?.ai_engines || [];
  const activeEngine = aiEngines.find((e) => e.is_active) || aiEngines[0];

  // 模板绑定相关状态
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [bindingLoading, setBindingLoading] = useState(false);

  // 整理相关状态
  const [organizing, setOrganizing] = useState(false);
  const [organizeProgress, setOrganizeProgress] = useState<number>(0);
  const [organizeStatus, setOrganizeStatus] = useState<string>('');
  const [currentOrganizeInfo, setCurrentOrganizeInfo] = useState<{ processedCount: number; totalChapters: number } | null>(null);

  const tableDataRef = useRef(tableData);
  const allSheetDataRef = useRef(allSheetData);
  const allSheetHeadersRef = useRef(allSheetHeaders);
  const currentSheetRef = useRef(currentSheet);
  const editingCellRef = useRef(editingCell);
  const editValueRef = useRef(editValue);
  const tableConfigRef = useRef(tableConfig);

  React.useEffect(() => {
    tableDataRef.current = tableData;
  }, [tableData]);

  React.useEffect(() => {
    allSheetDataRef.current = allSheetData;
  }, [allSheetData]);

  React.useEffect(() => {
    allSheetHeadersRef.current = allSheetHeaders;
  }, [allSheetHeaders]);

  React.useEffect(() => {
    currentSheetRef.current = currentSheet;
  }, [currentSheet]);

  React.useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);

  React.useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);

  React.useEffect(() => {
    tableConfigRef.current = tableConfig;
  }, [tableConfig]);

  const loadTableConfig = useCallback(async () => {
    if (!visible || !projectId) {
      console.log('[DEBUG loadTableConfig] 跳过: visible=', visible, 'projectId=', projectId);
      return;
    }

    setConfigLoading(true);
    try {
      const response = await window.electronAPI.writing.table.getTableConfig(projectId);
      console.log('[DEBUG loadTableConfig] IPC 返回:', response);
      const configResponse = response?.config || response;
      console.log('[DEBUG loadTableConfig] 提取的 config:', configResponse);
      if (configResponse && (configResponse.enabled || configResponse.associatedTemplateId)) {
        setTableConfig(configResponse);
        console.log('[DEBUG loadTableConfig] 设置 tableConfig:', configResponse);
      } else {
        setTableConfig(null);
        console.log('[DEBUG loadTableConfig] tableConfig 为空');
      }
    } catch (err) {
      console.error('Failed to load table config:', err);
      setTableConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }, [visible, projectId]);

  const loadTableData = useCallback(async () => {
    if (!visible || !projectId) return;

    setLoading(true);
    setError('');
    try {
      const response = await window.electronAPI.writing.table.getTableData(projectId);

      if (response.success && response.data && response.data.sheets && response.data.sheets.length > 0) {
        const data = response.data;
        setSheets(data.sheets);
        const sheetData = data.data || {};
        const sheetHeaders = data.headers || {};
        setAllSheetData(sheetData);
        setAllSheetHeaders(sheetHeaders);

        const firstSheet = data.sheets[0];
        setCurrentSheet(firstSheet);
        setTableData(sheetData[firstSheet] || []);
      } else {
        setError('表格文件不存在或为空');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`加载失败: ${errorMsg}`);
    } finally {
      setLoading(false);
    }

    await loadTableConfig();
  }, [visible, projectId, loadTableConfig]);

  React.useEffect(() => {
    if (visible) {
      loadTableData();
    }
  }, [visible, loadTableData]);

  const handleSheetChange = useCallback((sheetName: string) => {
    setCurrentSheet(sheetName);
    setTableData(allSheetData[sheetName] || []);
  }, [allSheetData]);

  const handleExport = useCallback(() => {
    if (!currentSheet || !allSheetHeaders[currentSheet]) return;

    const headers = allSheetHeaders[currentSheet];
    const data = allSheetData[currentSheet] || [];

    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(h => {
        const val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
        return val.includes(',') ? `"${val}"` : val;
      }).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `writing_${projectId}_${currentSheet}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [currentSheet, allSheetData, allSheetHeaders, projectId]);

  const startEdit = useCallback((record: Record<string, any>, colKey: string) => {
    setEditingCell({ rowKey: record.key, colKey });
    setEditValue(record[colKey] || '');
  }, []);

  const saveEdit = useCallback(async () => {
    const cell = editingCellRef.current;
    const sheet = currentSheetRef.current;
    const value = editValueRef.current;
    const headers = allSheetHeadersRef.current[sheet] || [];
    const data = tableDataRef.current;
    const allData = allSheetDataRef.current;
    const projId = projectId;

    if (!cell || !sheet) return;

    const { rowKey, colKey } = cell;
    const rowIndex = parseInt(rowKey, 10);
    const colIndex = headers.findIndex((_, idx) => idx.toString() === colKey);

    if (colIndex < 0 || rowIndex < 0 || rowIndex >= data.length) return;

    const newData = [...data];
    const updatedRow = { ...newData[rowIndex] };
    updatedRow[colIndex.toString()] = value;
    newData[rowIndex] = updatedRow;
    setTableData(newData);

    const updatedSheetData = { ...allData };
    updatedSheetData[sheet] = newData;
    setAllSheetData(updatedSheetData);

    setEditingCell(null);
    setEditValue('');

    try {
      setSyncing(true);
      const result = await window.electronAPI.writing.table.updateRowInTable(
        projId,
        sheet,
        rowIndex,
        updatedRow
      );
      if (result.success) {
        setLastSynced(new Date().toLocaleTimeString());
        message.success('已同步');
      } else {
        message.error('同步失败');
      }
    } catch (error) {
      message.error(`同步失败: ${error}`);
    } finally {
      setSyncing(false);
    }
  }, [projectId]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const columns = React.useMemo(() => {
    if (!currentSheet || !allSheetHeaders[currentSheet]) return [];

    return allSheetHeaders[currentSheet].map((header, index) => ({
      title: header,
      dataIndex: index.toString(),
      key: header,
      ellipsis: true,
      onCell: (record: Record<string, any>) => ({
        onClick: () => startEdit(record, index.toString()),
        style: { cursor: 'pointer', userSelect: 'none' },
      }),
      render: (text: string, record: Record<string, any>) => {
        if (editingCell && editingCell.rowKey === record.key && editingCell.colKey === index.toString()) {
          return (
            <Input
              size="small"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={saveEdit}
              onBlur={saveEdit}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        return text || '-';
      },
      width: Math.max(100, header.length * 20),
    }));
  }, [currentSheet, allSheetHeaders, editingCell, editValue, startEdit, saveEdit]);

  const dataSource = React.useMemo(() => {
    return tableData.map((row, rowIndex) => {
      const item: Record<string, any> = { key: rowIndex.toString() };
      const headers = allSheetHeaders[currentSheet] || [];
      headers.forEach((header, index) => {
        const val = row[header];
        if (val !== undefined && val !== null) {
          item[index.toString()] = String(val);
        } else if (row[index.toString()] !== undefined) {
          item[index.toString()] = String(row[index.toString()]);
        } else {
          item[index.toString()] = '';
        }
      });
      return item;
    });
  }, [tableData, currentSheet, allSheetHeaders]);

  const handleSave = useCallback(async () => {
    if (!currentSheet || !projectId) return;

    setSaving(true);
    try {
      const headers = allSheetHeaders[currentSheet] || [];
      const storageData = tableData.map(row => {
        const storageRow: Record<string, any> = {};
        headers.forEach((_, index) => {
          storageRow[index.toString()] = row[index.toString()] || '';
        });
        return storageRow;
      });

      await window.electronAPI.writing.table.saveTableData(projectId, currentSheet, storageData);
      message.success(`表格"${currentSheet}"已保存`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败: ${errorMsg}`);
    } finally {
      setSaving(false);
    }
  }, [currentSheet, projectId, allSheetHeaders, tableData]);

  const handleClearCurrentSheet = useCallback(async () => {
    if (!currentSheet || !projectId) return;

    try {
      await window.electronAPI.writing.table.saveTableData(projectId, currentSheet, []);
      message.success(`表格"${currentSheet}"已清空`);
      loadTableData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [currentSheet, projectId, loadTableData]);

  const handleClearAll = useCallback(async () => {
    if (!projectId) return;

    try {
      await window.electronAPI.writing.table.clearTableData(projectId);
      message.success('所有表格数据已清空');
      loadTableData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [projectId, loadTableData]);

  const handleManualSync = async () => {
    if (!currentSheet || !projectId) return;
    
    setSyncing(true);
    try {
      const currentData = allSheetData[currentSheet] || [];
      let successCount = 0;
      for (let i = 0; i < currentData.length; i++) {
        const result = await window.electronAPI.writing.table.updateRowInTable(
          projectId,
          currentSheet,
          i,
          currentData[i]
        );
        if (result.success) successCount++;
      }
      setLastSynced(new Date().toLocaleTimeString());
      message.success(`已同步 ${successCount} 行数据`);
    } catch (error) {
      message.error(`同步失败: ${error}`);
    } finally {
      setSyncing(false);
    }
  };

  // 模板绑定相关函数
  const handleOpenTemplateModal = useCallback(async () => {
    try {
      const response = await window.electronAPI.writing.table.getAllTemplates();
      console.log('[DEBUG] 获取模板列表 API 响应:', {
        success: response.success,
        templateCount: response.templates?.length,
        firstTemplate: response.templates?.[0] ? JSON.stringify({
          id: response.templates[0].id,
          name: response.templates[0].name,
          hasSheets: !!response.templates[0].sheets,
          sheetsCount: response.templates[0].sheets?.length
        }) : 'N/A'
      });
      if (response.success && response.templates) {
        // 过滤掉复制的模板，只保留原始模板
        const originalTemplates = response.templates.filter(t => !t.isCopy);
        const sortedTemplates = [...originalTemplates].sort((a, b) => {
          if (a.id === DEFAULT_TEMPLATE_ID) return -1;
          if (b.id === DEFAULT_TEMPLATE_ID) return 1;
          return a.name.localeCompare(b.name);
        });
        console.log('[DEBUG] 过滤后的模板列表:', sortedTemplates.map(t => ({
          id: t.id,
          name: t.name,
          hasSheets: !!t.sheets,
          sheetsCount: t.sheets?.length
        })));
        setTemplates(sortedTemplates);
        if (tableConfig?.associatedTemplateId) {
          // 如果已绑定模板，预选当前绑定的模板
          setSelectedTemplateId(tableConfig.associatedTemplateId);
        } else {
          // 如果未绑定，自动选中默认模板
          const defaultTemplate = sortedTemplates.find(t => t.id === DEFAULT_TEMPLATE_ID);
          console.log('[DEBUG] 默认模板:', defaultTemplate ? {
            id: defaultTemplate.id,
            name: defaultTemplate.name,
            hasSheets: !!defaultTemplate.sheets,
            sheetsCount: defaultTemplate.sheets?.length
          } : '未找到');
          setSelectedTemplateId(defaultTemplate?.id || '');
        }
        setTemplateModalVisible(true);
      } else {
        message.error('获取模板列表失败');
      }
    } catch (error) {
      message.error(`获取模板失败: ${error}`);
    }
  }, [tableConfig]);

  const handleBindTemplate = useCallback(async () => {
    if (!selectedTemplateId) {
      message.warning('请选择要绑定的模板');
      return;
    }

    const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
    if (!selectedTemplate) {
      message.error('模板不存在');
      return;
    }

    const sheetsData = selectedTemplate.sheets;
    const sheetsValid = sheetsData && Array.isArray(sheetsData) && sheetsData.length > 0;

    console.log('[DEBUG] 绑定模板前检查:', {
      templateId: selectedTemplate.id,
      templateName: selectedTemplate.name,
      hasSheets: !!sheetsData,
      sheetsType: typeof sheetsData,
      sheetsIsArray: Array.isArray(sheetsData),
      sheetsLength: sheetsData?.length,
      sheetsValid,
      sheetsKeys: sheetsData ? Object.keys(sheetsData) : 'N/A',
      sheetsContent: sheetsValid ? JSON.stringify(sheetsData.slice(0, 1)) : 'N/A'
    });

    if (!sheetsValid) {
      message.error('模板数据不完整');
      console.error('[DEBUG] 模板数据不完整，完整模板:', JSON.stringify(selectedTemplate, null, 2));
      return;
    }

    setBindingLoading(true);
    try {
      console.log('[DEBUG] 调用 IPC API 参数:', {
        projectId,
        templateId: selectedTemplateId,
        templateName: selectedTemplate.name,
        sheetsDataLength: sheetsData?.length,
        sheetsDataFirst: JSON.stringify(sheetsData?.[0])
      });
      const result = await window.electronAPI.writing.table.associateTableTemplate(
        projectId,
        selectedTemplateId,
        selectedTemplate.name,
        sheetsData
      );
      console.log('[DEBUG] IPC API 返回结果:', result);
      if (result.success) {
        message.success(`已绑定模板: ${selectedTemplate.name}`);
        setTemplateModalVisible(false);
        setSelectedTemplateId('');
        // 直接更新配置，而不是等待重新加载
        const newConfig = {
          enabled: true,
          autoOrganize: false,
          organizeMode: 'sync' as const,
          associatedTemplateId: selectedTemplateId,
          associatedTemplateName: selectedTemplate.name
        };
        console.log('[DEBUG handleBindTemplate] 准备设置 tableConfig:', newConfig);
        setTableConfig(newConfig);
        console.log('[DEBUG handleBindTemplate] 设置 tableConfig 后，准备重新加载数据');
        loadTableData();
      } else {
        message.error(`绑定模板失败: ${result.error}`);
      }
    } catch (error) {
      message.error(`绑定模板失败: ${error}`);
    } finally {
      setBindingLoading(false);
    }
  }, [projectId, selectedTemplateId, templates, loadTableData]);

  const handleStartOrganize = useCallback(async () => {
    if (organizing) {
      message.warning('整理任务正在进行中');
      return;
    }

    if (chapterId === undefined) {
      message.warning('请先选择一个章节');
      return;
    }

    // 先重新加载配置，确保获取最新状态
    console.log('[DEBUG handleStartOrganize] 开始检查配置');
    const response = await window.electronAPI.writing.table.getTableConfig(projectId);
    console.log('[DEBUG handleStartOrganize] IPC 返回:', response);
    const currentConfig = response?.config || response;
    console.log('[DEBUG handleStartOrganize] 当前配置:', currentConfig);
    
    if (!currentConfig?.associatedTemplateId) {
      message.error('请先绑定表格模板');
      handleOpenTemplateModal();
      return;
    }

    // 更新状态
    setTableConfig(currentConfig);

    // 通知父组件进入整理状态，锁定章节切换
    onOrganizeStatusChange?.(true);
    setOrganizing(true);
    setOrganizeProgress(0);
    setOrganizeStatus(`开始整理章节: ${chapterTitle || `第 ${chapterId} 章`}`);
    setCurrentOrganizeInfo(null);

    // 注册进度事件监听器
    let lastLoadTime = 0;
    const LOAD_THROTTLE_MS = 50; // 至少间隔50ms再加载表格数据，确保每个分片完成后快速刷新

    const progressListener = (_event: any, _projectId: string, progressData: { current: number; total: number; message: string; percent: number; timestamp: number }) => {
      console.log('[WritingOrganize] 收到进度更新:', progressData);
      try {
        setOrganizeProgress(progressData.percent || 0);
        setOrganizeStatus(progressData.message || '处理中...');
        // 节流加载表格数据，避免过于频繁的DOM更新
        const now = Date.now();
        if (now - lastLoadTime >= LOAD_THROTTLE_MS) {
          lastLoadTime = now;
          loadTableData();
        }
      } catch (listenerError) {
        console.error('[WritingOrganize] 进度监听器错误:', listenerError);
      }
    };

    try {
      window.electronAPI.ipcRenderer.on('writing:table:organizeProgress', progressListener);
    } catch (registerError) {
      console.warn('[WritingOrganize] 注册进度监听器失败:', registerError);
    }

    try {
      // 获取当前活跃的 AI 引擎配置
      const settingResponse = await window.electronAPI.setting.load();
      if (!settingResponse.success) {
        throw new Error('无法获取系统设置');
      }
      
      const setting = settingResponse.setting;
      const activeEngineId = setting?.activeEngineId;
      const engines = setting?.aiEngines || [];
      const activeEngine = engines.find((e: any) => e.id === activeEngineId) || engines[0];
      
      if (!activeEngine) {
        throw new Error('未配置 AI 引擎，请在设置中配置');
      }
      
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2)
        ? activeEngine.temperature
        : 0.7;
      
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0)
        ? activeEngine.max_tokens
        : 10240;
      
      const modelConfig = {
        temperature,
        maxTokens
      };

      const result = await window.electronAPI.writing.table.organizeTable(projectId, modelConfig, chapterId);

      if (result.success) {
        setOrganizeProgress(100);
        setOrganizeStatus('整理完成');
        message.success(`表格整理完成: ${result.errorCount > 0 ? `有 ${result.errorCount} 个错误` : '成功'}`);
        loadTableData();
      } else {
        setOrganizeStatus('整理失败');
        message.error(`整理失败: ${result.errors?.join(', ') || '未知错误'}`);
      }
    } catch (error) {
      setOrganizeStatus('整理出错');
      message.error(`整理出错: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // 移除进度事件监听器
      try {
        window.electronAPI.ipcRenderer.removeListener('writing:table:organizeProgress', progressListener);
      } catch (unregisterError) {
        console.warn('[WritingOrganize] 移除进度监听器失败:', unregisterError);
      }
      // 通知父组件整理结束，解除章节锁定
      onOrganizeStatusChange?.(false);
      setOrganizing(false);
    }
  }, [projectId, organizing, loadTableData, handleOpenTemplateModal, chapterId, chapterTitle, onOrganizeStatusChange, activeEngine]);

  return (
    <Modal
      title={`写作表格整理 - ${projectId}`}
      open={visible}
      onCancel={onClose}
      width="90vw"
      footer={[
        <Space key="left-actions">
          <Button
            icon={tableConfig?.associatedTemplateId ? <CheckCircleOutlined /> : <LinkOutlined />}
            onClick={handleOpenTemplateModal}
            type={tableConfig?.associatedTemplateId ? 'link' : 'default'}
          >
            {tableConfig?.associatedTemplateId
              ? `已绑定: ${tableConfig.associatedTemplateName}`
              : '绑定模板'}
          </Button>
          <Button
            icon={<RocketOutlined />}
            onClick={handleStartOrganize}
            loading={organizing}
            disabled={organizing}
          >
            {organizing ? '整理中...' : '开始整理'}
          </Button>
        </Space>,
        <Space key="sync">
          {lastSynced && <Text type="secondary">上次同步: {lastSynced}</Text>}
          <Button
            icon={<SyncOutlined spin={syncing} />}
            onClick={handleManualSync}
            loading={syncing}
            disabled={!currentSheet || tableData.length === 0}
          >
            同步到存储
          </Button>
        </Space>,
        <Popconfirm
          key="clearCurrent"
          title={`确定清空表格"${currentSheet}"的所有数据？`}
          description="此操作不可撤销，确认后表格数据将被清空。"
          onConfirm={handleClearCurrentSheet}
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={!currentSheet || tableData.length === 0}
        >
          <Button
            icon={<ClearOutlined />}
            disabled={!currentSheet || tableData.length === 0}
          >
            清空当前表格
          </Button>
        </Popconfirm>,
        <Popconfirm
          key="clearAll"
          title="确定清空所有表格的数据？"
          description="此操作不可撤销，确认后所有表格数据将被清空。"
          onConfirm={handleClearAll}
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={sheets.length === 0}
        >
          <Button
            icon={<ClearOutlined />}
            danger
            disabled={sheets.length === 0}
          >
            清空所有表格
          </Button>
        </Popconfirm>,
        <Button
          key="save"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!currentSheet || tableData.length === 0}
        >
          保存修改
        </Button>,
        <Button
          key="export"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          disabled={!currentSheet || tableData.length === 0}
        >
          导出 CSV
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      {organizing && (
        <div style={{ marginBottom: 16 }}>
          <Text strong>整理进度:</Text>
          <Progress percent={organizeProgress} status="active" />
          <Text type="secondary">{organizeStatus}</Text>
          {currentOrganizeInfo && (
            <Text type="secondary">
              {' '}({currentOrganizeInfo.processedCount}/{currentOrganizeInfo.totalChapters})
            </Text>
          )}
        </div>
      )}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: '16px', color: '#888' }}>加载中...</div>
        </div>
      ) : error ? (
        <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : sheets.length === 0 ? (
        <Empty description="暂无表格数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="table-container">
          <Tabs
            activeKey={currentSheet}
            onChange={handleSheetChange}
            size="small"
            items={sheets.map(sheetName => ({
              key: sheetName,
              label: `${sheetName} (${(allSheetData[sheetName] || []).length} 行)`,
            }))}
          />
          <Table
            columns={columns}
            dataSource={dataSource}
            size="small"
            pagination={{
              pageSize,
              showSizeChanger: true,
              showQuickJumper: true,
              className: 'table-pagination-wrapper',
              onChange: (page, size) => { setPageSize(size); },
            }}
            scroll={{ y: 400, x: true }}
            bordered
          />
        </div>
      )}

      <Modal
        title="绑定表格模板"
        open={templateModalVisible}
        onCancel={() => {
          setTemplateModalVisible(false);
          setSelectedTemplateId('');
        }}
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
            templates.map(template => (
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
            {templates.find(t => t.id === selectedTemplateId)?.description || '暂无描述'}
          </p>
        )}
        <p style={{ marginTop: 16, color: '#888', fontSize: 12 }}>
          绑定模板将创建对应的表格结构，已有的表格数据将被覆盖。
        </p>
      </Modal>
    </Modal>
  );
};

export default WritingTablePreviewModal;
