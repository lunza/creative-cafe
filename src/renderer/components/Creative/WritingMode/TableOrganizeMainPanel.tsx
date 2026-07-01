import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Input,
  Button,
  Empty,
  Tag,
  Typography,
  Spin,
  Modal,
  Progress,
  Popconfirm,
  Select,
  message,
} from 'antd';
import {
  DownloadOutlined,
  UnorderedListOutlined,
  SaveOutlined,
  SyncOutlined,
  ClearOutlined,
  RocketOutlined,
  TableOutlined,
  CheckCircleOutlined,
  LinkOutlined,
  RollbackOutlined,
  CheckOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import TableTemplateBinder, { TableConfigState, TableTemplateInfo } from './TableTemplateBinder';
import TableVersionControl, {
  TableVersionControlHandle,
  VersionActionButtons,
} from './TableVersionControl';
import TableReorganizeModal from './TableReorganizeModal';
import FullTableEditorModal from './FullTableEditorModal';
import { useTableOrganize } from './useTableOrganize';

const { Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export interface TableOrganizeMainPanelProps {
  projectId?: string;
  chapterId?: number;
  chapterTitle?: string;
  chapterContent?: string;
  onComplete?: () => void;
  onOrganizeStatusChange?: (isOrganizing: boolean) => void;
}

/**
 * 表格整理主面板
 *
 * 抽自原 WritingModeRightPanel.tsx 内联的 TableOrganizePanelContent。
 * 负责协调以下子功能（拆分后）：
 * - 模板绑定（TableTemplateBinder）
 * - 版本控制（TableVersionControl）
 * - 单表整理（本组件内 Modal，整理逻辑见 useTableOrganize）
 * - 全表编辑（FullTableEditorModal）
 * - 重整单行（TableReorganizeModal）
 *
 * 保留的共享状态：
 * - sheets / currentSheet / allSheetData / allSheetHeaders / tableData
 * - tableConfig / organizeRequirements
 * - saving / syncing / lastSynced
 *
 * 整理相关 state 与 handler 已下沉到 useTableOrganize hook。
 * 子功能相关 state 已下沉到各子组件内部。
 */
const TableOrganizeMainPanel: React.FC<TableOrganizeMainPanelProps> = ({
  projectId,
  chapterId,
  chapterTitle,
  onComplete,
  onOrganizeStatusChange,
}) => {
  const { token } = theme.useToken();

  // ===== 共享数据状态 =====
  const [loading, setLoading] = useState(false);
  const [sheets, setSheets] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [allSheetData, setAllSheetData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [allSheetHeaders, setAllSheetHeaders] = useState<Record<string, string[]>>({});
  const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
  const [pageSize] = useState(20);

  // 主表格内联编辑状态
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // 表格配置
  const [tableConfig, setTableConfig] = useState<TableConfigState | null>(null);

  // 整理相关状态
  const [organizeRequirements, setOrganizeRequirements] = useState<string>('');

  // 保存/同步状态
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string>('');

  // 单表整理相关状态
  const [singleSheetModalVisible, setSingleSheetModalVisible] = useState(false);
  const [selectedSingleSheet, setSelectedSingleSheet] = useState<string>('');
  const [templates, setTemplates] = useState<TableTemplateInfo[]>([]);

  // 全表 Modal
  const [fullTableModalVisible, setFullTableModalVisible] = useState(false);

  // 重整行 Modal
  const [reorganizeModalVisible, setReorganizeModalVisible] = useState(false);
  const [reorganizeRowKey, setReorganizeRowKey] = useState<string | null>(null);
  const [reorganizeRowIndex, setReorganizeRowIndex] = useState<number>(-1);

  // 模板绑定 Modal
  const [templateModalVisible, setTemplateModalVisible] = useState(false);

  // 版本控制 - 由子组件管理，仅镜像 hasPendingVersion 用于显示 banner
  const [hasPendingVersion, setHasPendingVersion] = useState(false);
  const versionControlRef = useRef<TableVersionControlHandle>(null);

  // refs（用于闭包中读取最新值，避免 useCallback 依赖过重）
  const tableDataRef = useRef(tableData);
  const allSheetDataRef = useRef(allSheetData);
  const allSheetHeadersRef = useRef(allSheetHeaders);
  const currentSheetRef = useRef(currentSheet);
  const editingCellRef = useRef(editingCell);
  const editValueRef = useRef(editValue);
  const tableConfigRef = useRef(tableConfig);
  const organizeRequirementsRef = useRef(organizeRequirements);

  useEffect(() => { tableDataRef.current = tableData; }, [tableData]);
  useEffect(() => { allSheetDataRef.current = allSheetData; }, [allSheetData]);
  useEffect(() => { allSheetHeadersRef.current = allSheetHeaders; }, [allSheetHeaders]);
  useEffect(() => { currentSheetRef.current = currentSheet; }, [currentSheet]);
  useEffect(() => { editingCellRef.current = editingCell; }, [editingCell]);
  useEffect(() => { editValueRef.current = editValue; }, [editValue]);
  useEffect(() => { tableConfigRef.current = tableConfig; }, [tableConfig]);
  useEffect(() => { organizeRequirementsRef.current = organizeRequirements; }, [organizeRequirements]);

  // ===== 配置加载 =====
  const loadTableConfig = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await window.electronAPI.writing.table.getTableConfig(projectId);
      const configResponse = response?.config || response;
      if (configResponse && (configResponse.enabled || configResponse.associatedTemplateId)) {
        setTableConfig(configResponse);
        if (configResponse.organizeRequirements) {
          setOrganizeRequirements(configResponse.organizeRequirements);
        }
      } else {
        setTableConfig(null);
      }
    } catch (err) {
      console.error('Failed to load table config:', err);
      setTableConfig(null);
    }
  }, [projectId]);

  const saveOrganizeRequirements = useCallback(async (requirements: string) => {
    if (!projectId || !tableConfigRef.current) return;
    try {
      await window.electronAPI.writing.table.saveTableConfig(projectId, {
        ...tableConfigRef.current,
        organizeRequirements: requirements,
      });
    } catch (err) {
      console.error('Failed to save organize requirements:', err);
    }
  }, [projectId]);

  const loadTableData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
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
      }
    } catch {
      // 表格文件不存在或加载失败，显示绑定模板入口
    } finally {
      setLoading(false);
    }
    await loadTableConfig();
  }, [projectId, loadTableConfig]);

  useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  // ===== 整理 hook =====
  const {
    organizing,
    organizeProgress,
    organizeStatus,
    currentOrganizeInfo,
    currentChunk,
    totalChunks,
    singleSheetOrganizing,
    handleStartOrganize,
    handleOrganizeAll,
    handleOrganizeSkipOrganized,
    handleOrganizeCancel,
    handleStartSingleSheetOrganize,
    setChapterStatusModalVisible,
    chapterStatusModalVisible,
    organizedChapterCount,
  } = useTableOrganize({
    projectId,
    chapterId,
    chapterTitle,
    organizeRequirementsRef,
    saveOrganizeRequirements,
    loadTableData,
    openTemplateModal: () => setTemplateModalVisible(true),
    onOrganizeStatusChange,
    versionControlRef,
  });

  // ===== 主表格编辑相关 =====
  const handleSheetChange = useCallback((sheetName: string) => {
    setCurrentSheet(sheetName);
    setTableData(allSheetDataRef.current[sheetName] || []);
  }, []);

  const handleExport = useCallback(() => {
    if (!currentSheet || !allSheetHeaders[currentSheet]) return;
    const headers = allSheetHeaders[currentSheet];
    const data = allSheetData[currentSheet] || [];
    const csvContent = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((h) => {
            const val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
            return val.includes(',') ? `"${val}"` : val;
          })
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `writing_${projectId}_${currentSheet}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [currentSheet, allSheetData, allSheetHeaders, projectId]);

  const startEdit = useCallback((record: Record<string, string>, colKey: string) => {
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
      const result = await window.electronAPI.writing.table.updateRowInTable(projId!, sheet, rowIndex, updatedRow);
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

  const columns = useMemo(() => {
    if (!currentSheet || !allSheetHeaders[currentSheet]) return [];
    return allSheetHeaders[currentSheet].map((header, index) => ({
      title: header,
      dataIndex: index.toString(),
      key: header,
    }));
  }, [currentSheet, allSheetHeaders]);

  const dataSource = useMemo(() => {
    return tableData.map((row, rowIndex) => {
      const item: Record<string, string> = { key: rowIndex.toString() };
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
      const storageData = tableData.map((row) => {
        const storageRow: Record<string, unknown> = {};
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
      setAllSheetData((prev) => ({ ...prev, [currentSheet]: [] }));
      setTableData([]);
      message.success(`表格"${currentSheet}"已清空`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [currentSheet, projectId]);

  const handleClearAll = useCallback(async () => {
    if (!projectId) return;
    try {
      await window.electronAPI.writing.table.clearTableData(projectId);
      setSheets([]);
      setAllSheetData({});
      setAllSheetHeaders({});
      setTableData([]);
      setCurrentSheet('');
      message.success('所有表格数据已清空');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [projectId]);

  const handleManualSync = useCallback(async () => {
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
  }, [currentSheet, projectId, allSheetData]);

  // ===== 模板绑定 Modal 打开 =====
  const handleTemplateBound = useCallback(
    (newConfig: TableConfigState) => {
      setTableConfig(newConfig);
      setTemplateModalVisible(false);
      loadTableData();
    },
    [loadTableData]
  );

  // ===== 单表整理 Modal =====
  const handleOpenSingleSheetModal = useCallback(async () => {
    if (organizing || singleSheetOrganizing) {
      message.warning('整理任务正在进行中');
      return;
    }
    if (chapterId === undefined) {
      message.warning('请先选择一个章节');
      return;
    }
    if (!tableConfig?.associatedTemplateId) {
      message.error('请先绑定表格模板');
      setTemplateModalVisible(true);
      return;
    }
    try {
      const response = await window.electronAPI.writing.table.getAllTemplates();
      if (response.success && response.templates) {
        const originalTemplates = (response.templates as TableTemplateInfo[]).filter((t) => !t.isCopy);
        setTemplates(originalTemplates);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
    setSelectedSingleSheet('');
    setSingleSheetModalVisible(true);
  }, [organizing, singleSheetOrganizing, chapterId, tableConfig]);

  const handleSingleSheetModalOk = useCallback(() => {
    handleStartSingleSheetOrganize(selectedSingleSheet);
  }, [handleStartSingleSheetOrganize, selectedSingleSheet]);

  const handleSingleSheetModalCancel = useCallback(() => {
    setSingleSheetModalVisible(false);
    setSelectedSingleSheet('');
  }, []);

  // ===== 全表 Modal =====
  const handleOpenFullTableModal = useCallback(() => {
    setFullTableModalVisible(true);
  }, []);

  const handleFullTableSheetChange = useCallback((sheetName: string) => {
    setCurrentSheet(sheetName);
    setTableData(allSheetDataRef.current[sheetName] || []);
  }, []);

  const handleFullTableSheetDataChange = useCallback(
    (sheetName: string, newData: Record<string, unknown>[]) => {
      setAllSheetData((prev) => ({ ...prev, [sheetName]: newData }));
      if (sheetName === currentSheetRef.current) {
        setTableData(newData);
      }
    },
    []
  );

  const handleFullTableModalClose = useCallback(() => {
    setFullTableModalVisible(false);
    // Reload to ensure data consistency（与原 handleCloseFullTableModal 行为一致）
    loadTableData();
  }, [loadTableData]);

  // ===== 重整行 =====
  const handleTriggerReorganize = useCallback((rowIndex: number) => {
    setReorganizeRowIndex(rowIndex);
    setReorganizeRowKey(rowIndex.toString());
    setReorganizeModalVisible(true);
  }, []);

  const handleReorganizeSuccess = useCallback(
    (updatedRow: Record<string, unknown>) => {
      const sheet = currentSheetRef.current;
      if (!sheet || reorganizeRowIndex < 0) return;
      const currentData = [...(allSheetDataRef.current[sheet] || [])];
      if (reorganizeRowIndex < currentData.length) {
        currentData[reorganizeRowIndex] = updatedRow;
        setAllSheetData((prev) => ({ ...prev, [sheet]: currentData }));
        if (sheet === currentSheetRef.current) {
          setTableData(currentData);
        }
      }
      setReorganizeModalVisible(false);
      setReorganizeRowKey(null);
      setReorganizeRowIndex(-1);
    },
    [reorganizeRowIndex]
  );

  const handleReorganizeModalClose = useCallback(() => {
    setReorganizeModalVisible(false);
    setReorganizeRowKey(null);
    setReorganizeRowIndex(-1);
  }, []);

  // ===== 渲染 =====
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin size="large" tip="加载表格数据..." />
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div style={{ padding: '16px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 操作按钮区域 */}
        <div style={{ padding: '0 0 8px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button
            icon={tableConfig?.associatedTemplateId ? <CheckCircleOutlined /> : <LinkOutlined />}
            onClick={() => setTemplateModalVisible(true)}
            type={tableConfig?.associatedTemplateId ? 'link' : 'default'}
            size="small"
          >
            {tableConfig?.associatedTemplateId
              ? `已绑定: ${tableConfig.associatedTemplateName}`
              : '绑定模板'}
          </Button>
          <Button
            icon={<RocketOutlined />}
            onClick={handleStartOrganize}
            loading={organizing}
            disabled={organizing || singleSheetOrganizing}
            size="small"
            type="primary"
          >
            {organizing ? '整理中...' : '开始整理'}
          </Button>
          <Button
            icon={<TableOutlined />}
            onClick={handleOpenSingleSheetModal}
            loading={singleSheetOrganizing}
            disabled={organizing || singleSheetOrganizing || !tableConfig?.associatedTemplateId}
            size="small"
          >
            {singleSheetOrganizing ? '整理中...' : '整理单个表格'}
          </Button>
          {hasPendingVersion && (
            <VersionActionButtons
              organizing={organizing}
              singleSheetOrganizing={singleSheetOrganizing}
              onRollback={() => versionControlRef.current?.openRollback()}
              onConfirm={() => versionControlRef.current?.openConfirm()}
            />
          )}
        </div>

        {/* 整理要求输入框 */}
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>整理要求（可选）</Text>
          </div>
          <TextArea
            placeholder="请输入表格整理的侧重点和要求，例如：重点关注角色关系、战斗数据、魔法体系等"
            value={organizeRequirements}
            onChange={(e) => setOrganizeRequirements(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            size="small"
            disabled={organizing}
          />
        </div>

        {/* 整理进度显示 */}
        {organizing && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>整理进度:</Text>
            {totalChunks > 0 ? (
              <Text>已处理 {currentChunk} / 共 {totalChunks} 个分片</Text>
            ) : (
              <Progress percent={organizeProgress} status="active" size="small" />
            )}
            <Text type="secondary">{organizeStatus}</Text>
            {currentOrganizeInfo && (
              <Text type="secondary">
                {' '}({currentOrganizeInfo.processedCount}/{currentOrganizeInfo.totalChapters})
              </Text>
            )}
          </div>
        )}

        <Empty description="暂无表格数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Text type="secondary">请先绑定表格模板并开始整理</Text>
        </div>

        {/* 子组件：模板绑定 / 版本控制 */}
        <TableTemplateBinder
          projectId={projectId}
          tableConfig={tableConfig}
          visible={templateModalVisible}
          onClose={() => setTemplateModalVisible(false)}
          onBound={handleTemplateBound}
        />
        <TableVersionControl
          ref={versionControlRef}
          projectId={projectId}
          chapterId={chapterId}
          organizing={organizing}
          singleSheetOrganizing={singleSheetOrganizing}
          reloadTableData={loadTableData}
          onPendingVersionChange={setHasPendingVersion}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 版本状态提示栏 */}
      {hasPendingVersion && (
        <div
          style={{
            margin: '0 12px 12px 12px',
            padding: '10px 14px',
            backgroundColor: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
            borderLeft: `3px solid ${token.colorWarning}`,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ExclamationCircleOutlined style={{ color: token.colorWarning, fontSize: 15 }} />
          <Text strong style={{ fontSize: 13, color: token.colorWarningTextHover }}>
            当前显示：整理后的新版本数据（未确认）
          </Text>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button
              size="small"
              icon={<RollbackOutlined />}
              onClick={() => versionControlRef.current?.openRollback()}
              disabled={organizing || singleSheetOrganizing}
            >
              回退
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => versionControlRef.current?.openConfirm()}
              disabled={organizing || singleSheetOrganizing}
            >
              确认
            </Button>
          </div>
        </div>
      )}

      {/* 整理进度显示 */}
      {(organizing || singleSheetOrganizing) && (
        <div style={{ marginBottom: 16, padding: '0 12px' }}>
          <Text strong>整理进度:</Text>
          {totalChunks > 0 ? (
            <Text>已处理 {currentChunk} / 共 {totalChunks} 个分片</Text>
          ) : (
            <Progress percent={organizeProgress} status="active" size="small" />
          )}
          <Text type="secondary">{organizeStatus}</Text>
          {currentOrganizeInfo && (
            <Text type="secondary">
              {' '}({currentOrganizeInfo.processedCount}/{currentOrganizeInfo.totalChapters})
            </Text>
          )}
        </div>
      )}

      {/* 操作按钮区域 */}
      <div style={{ padding: '0 12px 8px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button
          icon={tableConfig?.associatedTemplateId ? <CheckCircleOutlined /> : <LinkOutlined />}
          onClick={() => setTemplateModalVisible(true)}
          type={tableConfig?.associatedTemplateId ? 'link' : 'default'}
          size="small"
        >
          {tableConfig?.associatedTemplateId
            ? `已绑定: ${tableConfig.associatedTemplateName}`
            : '绑定模板'}
        </Button>
        <Button
          icon={<RocketOutlined />}
          onClick={handleStartOrganize}
          loading={organizing}
          disabled={organizing || singleSheetOrganizing}
          size="small"
          type="primary"
        >
          {organizing ? '整理中...' : '开始整理'}
        </Button>
        <Button
          icon={<TableOutlined />}
          onClick={handleOpenSingleSheetModal}
          loading={singleSheetOrganizing}
          disabled={organizing || singleSheetOrganizing || !tableConfig?.associatedTemplateId}
          size="small"
        >
          {singleSheetOrganizing ? '整理中...' : '整理单个表格'}
        </Button>
      </div>

      {/* 整理要求输入框 */}
      <div style={{ padding: '0 12px 8px 12px' }}>
        <div style={{ marginBottom: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>整理要求（可选）</Text>
        </div>
        <TextArea
          placeholder="请输入表格整理的侧重点和要求，例如：重点关注角色关系、战斗数据、魔法体系等"
          value={organizeRequirements}
          onChange={(e) => setOrganizeRequirements(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 4 }}
          size="small"
          disabled={organizing}
        />
      </div>

      {/* 操作按钮区域 2 */}
      <div style={{ padding: '0 12px 8px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!currentSheet || tableData.length === 0} size="small">保存修改</Button>
        <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!currentSheet || tableData.length === 0} size="small">导出 CSV</Button>
        <Button icon={<UnorderedListOutlined />} onClick={handleOpenFullTableModal} disabled={!currentSheet || tableData.length === 0} size="small" type="primary">查看全部数据 ({tableData.length} 行)</Button>
        {lastSynced && <Text type="secondary" style={{ fontSize: 11 }}>上次同步: {lastSynced}</Text>}
        <Button icon={<SyncOutlined spin={syncing} />} onClick={handleManualSync} loading={syncing} disabled={!currentSheet || tableData.length === 0} size="small">同步到存储</Button>
        <Popconfirm
          title={`确定清空表格"${currentSheet}"的所有数据？`}
          description="此操作不可撤销，确认后表格数据将被清空。"
          onConfirm={handleClearCurrentSheet}
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={!currentSheet || tableData.length === 0}
        >
          <Button icon={<ClearOutlined />} disabled={!currentSheet || tableData.length === 0} size="small">清空当前表格</Button>
        </Popconfirm>
        <Popconfirm
          title="确定清空所有表格的数据？"
          description="此操作不可撤销，确认后所有表格数据将被清空。"
          onConfirm={handleClearAll}
          okText="确定"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={sheets.length === 0}
        >
          <Button icon={<ClearOutlined />} danger disabled={sheets.length === 0} size="small">清空所有表格</Button>
        </Popconfirm>
        {onComplete && (
          <Button size="small" type="primary" onClick={() => { onComplete(); }}>标记完成</Button>
        )}
      </div>

      <Tabs
        activeKey={currentSheet}
        onChange={handleSheetChange}
        size="small"
        items={sheets.map((sheetName) => ({
          key: sheetName,
          label: `${sheetName} (${(allSheetData[sheetName] || []).length} 行)`,
        }))}
        style={{ marginBottom: 8, padding: '0 12px' }}
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: '6px 8px',
                    border: `1px solid ${token.colorBorder}`,
                    background: token.colorFillQuaternary,
                    textAlign: 'left',
                    fontWeight: 600,
                  }}
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataSource.slice(0, pageSize).map((row) => (
              <tr key={row.key}>
                {columns.map((col) => (
                  <td
                    key={`${row.key}-${col.key}`}
                    style={{
                      padding: '6px 8px',
                      border: `1px solid ${token.colorBorder}`,
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => startEdit(row, col.dataIndex)}
                  >
                    {editingCell?.rowKey === row.key && editingCell?.colKey === col.dataIndex ? (
                      <Input
                        size="small"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onPressEnter={saveEdit}
                        onBlur={saveEdit}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      row[col.dataIndex] || '-'
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {dataSource.length > pageSize && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Text type="secondary">显示前 {pageSize} 行，共 {dataSource.length} 行</Text>
          </div>
        )}
      </div>

      {/* 子组件：模板绑定 Modal */}
      <TableTemplateBinder
        projectId={projectId}
        tableConfig={tableConfig}
        visible={templateModalVisible}
        onClose={() => setTemplateModalVisible(false)}
        onBound={handleTemplateBound}
      />

      {/* 子组件：版本控制 */}
      <TableVersionControl
        ref={versionControlRef}
        projectId={projectId}
        chapterId={chapterId}
        organizing={organizing}
        singleSheetOrganizing={singleSheetOrganizing}
        reloadTableData={loadTableData}
        onPendingVersionChange={setHasPendingVersion}
      />

      {/* 子组件：全表编辑 Modal */}
      <FullTableEditorModal
        visible={fullTableModalVisible}
        onClose={handleFullTableModalClose}
        projectId={projectId}
        sheets={sheets}
        currentSheet={currentSheet}
        allSheetData={allSheetData}
        allSheetHeaders={allSheetHeaders}
        lastSynced={lastSynced}
        syncing={syncing}
        onSheetChange={handleFullTableSheetChange}
        onSheetDataChange={handleFullTableSheetDataChange}
        onLastSyncedChange={setLastSynced}
        onReorganizeRow={handleTriggerReorganize}
        reorganizingRowKey={reorganizeModalVisible ? reorganizeRowKey : null}
      />

      {/* 子组件：重整行 Modal */}
      <TableReorganizeModal
        visible={reorganizeModalVisible}
        rowIndex={reorganizeRowIndex}
        projectId={projectId}
        currentSheet={currentSheet}
        sheetData={allSheetData[currentSheet] || []}
        onClose={handleReorganizeModalClose}
        onSuccess={handleReorganizeSuccess}
      />

      {/* 单表整理选择 Modal（保留在主面板内） */}
      <Modal
        title="选择要整理的表格"
        open={singleSheetModalVisible}
        onCancel={handleSingleSheetModalCancel}
        onOk={handleSingleSheetModalOk}
        confirmLoading={singleSheetOrganizing}
        okText="开始整理"
        cancelText="取消"
        width={500}
      >
        <p style={{ marginBottom: 12, color: '#888', fontSize: 12 }}>
          请选择要整理的表格。整理完成后仅更新所选表格，其他表格不受影响。
        </p>
        {tableConfig?.associatedTemplateId && (
          <Select
            style={{ width: '100%' }}
            placeholder="选择要整理的表格"
            value={selectedSingleSheet || undefined}
            onChange={setSelectedSingleSheet}
            size="large"
          >
            {(() => {
              const template = templates.find((t) => t.id === tableConfig.associatedTemplateId);
              return (
                template?.sheets?.map((sheet) => (
                  <Option key={sheet.name} value={sheet.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{sheet.name}</span>
                      {allSheetData[sheet.name] && (
                        <Tag color="blue">{allSheetData[sheet.name].length} 行</Tag>
                      )}
                    </div>
                    {sheet.description && (
                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                        {sheet.description}
                      </div>
                    )}
                  </Option>
                )) || []
              );
            })()}
          </Select>
        )}
      </Modal>

      {/* 章节整理状态检查弹窗 */}
      <Modal
        title="章节整理状态提示"
        open={chapterStatusModalVisible}
        onCancel={handleOrganizeCancel}
        footer={null}
      >
        <Text>
          有 <Text strong type="warning">{organizedChapterCount}</Text> 个章节已整理完成，是否重新整理？
        </Text>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <Button onClick={handleOrganizeCancel}>取消</Button>
          <Button onClick={handleOrganizeSkipOrganized}>仅整理未完成</Button>
          <Button type="primary" onClick={handleOrganizeAll}>全部重新整理</Button>
        </div>
      </Modal>
    </div>
  );
};

export default React.memo(TableOrganizeMainPanel);
