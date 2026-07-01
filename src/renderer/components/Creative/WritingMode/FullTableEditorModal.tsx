import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Modal, Input, Button, Typography, Table, Tabs, Tooltip, Popconfirm, Space, message } from 'antd';
import {
  SearchOutlined,
  SaveOutlined,
  PlusOutlined,
  DownloadOutlined,
  SyncOutlined,
  DeleteOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export interface FullTableEditorModalProps {
  /** 受控：Modal 是否可见 */
  visible: boolean;
  /** 关闭 Modal 的回调（父组件同时清空搜索/编辑状态由本组件自行处理） */
  onClose: () => void;
  /** 项目 ID */
  projectId?: string;
  /** 所有 sheet 名列表 */
  sheets: string[];
  /** 当前选中的 sheet（受控） */
  currentSheet: string;
  /** 全部 sheet 的数据：sheetName -> 行数组 */
  allSheetData: Record<string, Record<string, unknown>[]>;
  /** 全部 sheet 的表头：sheetName -> 字段名数组 */
  allSheetHeaders: Record<string, string[]>;
  /** 上次同步时间显示文本 */
  lastSynced: string;
  /** 是否正在同步到存储（用于禁用按钮） */
  syncing: boolean;
  /** 切换当前 sheet 的回调（同步更新父组件状态） */
  onSheetChange: (sheetName: string) => void;
  /** 更新某个 sheet 的全部行数据（用于编辑/新增/删除行后） */
  onSheetDataChange: (sheetName: string, newData: Record<string, unknown>[]) => void;
  /** 设置 lastSynced 显示文本（同步成功后调用） */
  onLastSyncedChange: (text: string) => void;
  /** 触发重新整理某行的回调（由父组件打开 TableReorganizeModal） */
  onReorganizeRow: (rowIndex: number) => void;
  /** 正在重整的行 key（用于按钮 loading 状态） */
  reorganizingRowKey: string | null;
}

/**
 * 全表编辑 Modal
 *
 * 抽自原 TableOrganizePanelContent 的「完整表格模态框」子功能：
 * - 全量数据展示（带分页、搜索）
 * - 单元格双击编辑（支持回车保存 / 失焦保存）
 * - 新增行 / 删除行 / 保存全部 / 同步到存储 / 导出 CSV
 * - 触发重新整理单行（通过 onReorganizeRow 回调委托父组件打开 Modal）
 *
 * 与父组件的数据流：
 * - allSheetData / allSheetHeaders / currentSheet 通过 props 传入（父组件持有，便于其他视图共享）
 * - 修改后通过 onSheetDataChange 回写
 */
const FullTableEditorModal: React.FC<FullTableEditorModalProps> = ({
  visible,
  onClose,
  projectId,
  sheets,
  currentSheet,
  allSheetData,
  allSheetHeaders,
  lastSynced,
  syncing,
  onSheetChange,
  onSheetDataChange,
  onLastSyncedChange,
  onReorganizeRow,
  reorganizingRowKey,
}) => {
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // refs 用于在 onPressEnter/onBlur 闭包中读取最新值（与原行为保持一致）
  const editingCellRef = useRef(editingCell);
  const editValueRef = useRef(editValue);
  const sheetRef = useRef(currentSheet);
  const allSheetHeadersRef = useRef(allSheetHeaders);
  const allSheetDataRef = useRef(allSheetData);
  const projIdRef = useRef(projectId);

  useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);
  useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);
  useEffect(() => {
    sheetRef.current = currentSheet;
  }, [currentSheet]);
  useEffect(() => {
    allSheetHeadersRef.current = allSheetHeaders;
  }, [allSheetHeaders]);
  useEffect(() => {
    allSheetDataRef.current = allSheetData;
  }, [allSheetData]);
  useEffect(() => {
    projIdRef.current = projectId;
  }, [projectId]);

  // 打开时重置 UI 状态（与原 handleCloseFullTableModal 一致，但只清 UI；数据 reload 由父组件负责）
  useEffect(() => {
    if (visible) {
      setSearch('');
      setPageSize(20);
      setEditingCell(null);
      setEditValue('');
    }
  }, [visible]);

  // 切换 sheet 时清空搜索与编辑状态
  const handleSheetChange = useCallback(
    (sheetName: string) => {
      onSheetChange(sheetName);
      setSearch('');
      setEditingCell(null);
    },
    [onSheetChange]
  );

  const handleClose = useCallback(() => {
    setEditingCell(null);
    setSearch('');
    onClose();
  }, [onClose]);

  // 当前 sheet 的全部行数据与表头
  const sheetData = useMemo(() => allSheetData[currentSheet] || [], [allSheetData, currentSheet]);
  const sheetHeaders = useMemo(() => allSheetHeaders[currentSheet] || [], [allSheetHeaders, currentSheet]);

  // 构造 Table dataSource
  const fullDataSource = useMemo(() => {
    return sheetData.map((row, rowIndex) => {
      const item: Record<string, string> = { key: rowIndex.toString() };
      sheetHeaders.forEach((header, index) => {
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
  }, [sheetData, sheetHeaders]);

  // 搜索过滤
  const filteredDataSource = useMemo(() => {
    if (!search.trim()) return fullDataSource;
    const searchLower = search.toLowerCase();
    return fullDataSource.filter((row) => {
      return sheetHeaders.some((_, idx) => {
        const val = row[idx.toString()];
        return val && String(val).toLowerCase().includes(searchLower);
      });
    });
  }, [fullDataSource, search, sheetHeaders]);

  // 保存单元格编辑的统一逻辑
  const saveCellEdit = useCallback(() => {
    const cell = editingCellRef.current;
    const sheet = sheetRef.current;
    const value = editValueRef.current;
    const headers = allSheetHeadersRef.current[sheet] || [];
    const allData = allSheetDataRef.current;
    const projId = projIdRef.current;

    if (!cell || !sheet || !projId) return;
    const { rowKey, colKey } = cell;
    const rowIndex = parseInt(rowKey, 10);
    const colIndex = headers.findIndex((_, idx) => idx.toString() === colKey);
    if (colIndex < 0 || rowIndex < 0) return;
    const currentData = allData[sheet] || [];
    if (rowIndex >= currentData.length) return;

    const updatedRow = { ...currentData[rowIndex] };
    updatedRow[colIndex.toString()] = value;
    const updatedSheetData = currentData.map((r, i) => (i === rowIndex ? updatedRow : r));

    onSheetDataChange(sheet, updatedSheetData);
    setEditingCell(null);
    setEditValue('');

    // 异步同步到存储
    window.electronAPI.writing.table
      .updateRowInTable(projId, sheet, rowIndex, updatedRow)
      .then(() => {
        onLastSyncedChange(new Date().toLocaleTimeString());
      })
      .catch(() => {});
  }, [onSheetDataChange, onLastSyncedChange]);

  // 列定义
  const columns = useMemo(() => {
    return sheetHeaders.map((header, index) => ({
      title: header,
      dataIndex: index.toString(),
      key: header,
      ellipsis: true,
      width: Math.max(100, header.length * 20),
      onCell: (record: Record<string, string>) => ({
        onDoubleClick: () => {
          setEditingCell({ rowKey: record.key, colKey: index.toString() });
          setEditValue(record[index.toString()] || '');
        },
        style: { cursor: 'pointer', userSelect: 'none' },
      }),
      render: (text: string, record: Record<string, string>) => {
        if (editingCell && editingCell.rowKey === record.key && editingCell.colKey === index.toString()) {
          return (
            <Input
              size="small"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={saveCellEdit}
              onBlur={saveCellEdit}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        return text || '-';
      },
    }));
  }, [sheetHeaders, editingCell, editValue, saveCellEdit]);

  // 新增行
  const handleAddRow = useCallback(async () => {
    const sheet = currentSheet;
    if (!sheet || !projectId) return;
    if (sheetHeaders.length === 0) return;

    const newRow: Record<string, string> = {};
    sheetHeaders.forEach((_, idx) => {
      newRow[idx.toString()] = '';
    });

    const currentData = [...(allSheetData[sheet] || [])];
    currentData.push(newRow);
    onSheetDataChange(sheet, currentData);

    message.success('已添加新行，请编辑后保存');
  }, [currentSheet, projectId, sheetHeaders, allSheetData, onSheetDataChange]);

  // 删除行
  const handleDeleteRow = useCallback(
    async (rowIndex: number) => {
      const sheet = currentSheet;
      if (!sheet || !projectId) return;

      const currentData = [...(allSheetData[sheet] || [])];
      currentData.splice(rowIndex, 1);
      onSheetDataChange(sheet, currentData);

      try {
        // 删除后重新同步所有行
        for (let i = 0; i < currentData.length; i++) {
          await window.electronAPI.writing.table.updateRowInTable(projectId, sheet, i, currentData[i]);
        }
        message.success('已删除并同步到存储');
        onLastSyncedChange(new Date().toLocaleTimeString());
      } catch (error) {
        message.error('同步失败');
      }
    },
    [currentSheet, projectId, allSheetData, onSheetDataChange, onLastSyncedChange]
  );

  // 保存全部
  const handleSaveAll = useCallback(async () => {
    if (!currentSheet || !projectId) return;
    setSaving(true);
    try {
      const headers = allSheetHeaders[currentSheet] || [];
      const currentData = allSheetData[currentSheet] || [];
      const storageData = currentData.map((row) => {
        const storageRow: Record<string, unknown> = {};
        headers.forEach((_, index) => {
          storageRow[index.toString()] = row[index.toString()] || '';
        });
        return storageRow;
      });

      await window.electronAPI.writing.table.saveTableData(projectId, currentSheet, storageData);
      message.success(`表格"${currentSheet}"已保存`);
      onLastSyncedChange(new Date().toLocaleTimeString());
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败: ${errorMsg}`);
    } finally {
      setSaving(false);
    }
  }, [currentSheet, projectId, allSheetHeaders, allSheetData, onLastSyncedChange]);

  // 同步到存储
  const handleSync = useCallback(async () => {
    if (!currentSheet || !projectId) return;
    // 同步逻辑由父组件统一处理（避免重复实现），通过 syncing prop 反映状态
    // 这里委托给 onLastSyncedChange 之外，需要自行实现
    const currentData = allSheetData[currentSheet] || [];
    let successCount = 0;
    try {
      for (let i = 0; i < currentData.length; i++) {
        const result = await window.electronAPI.writing.table.updateRowInTable(
          projectId,
          currentSheet,
          i,
          currentData[i]
        );
        if (result.success) successCount++;
      }
      onLastSyncedChange(new Date().toLocaleTimeString());
      message.success(`已同步 ${successCount} 行数据`);
    } catch (error) {
      message.error(`同步失败: ${error}`);
    }
  }, [currentSheet, projectId, allSheetData, onLastSyncedChange]);

  // 导出 CSV
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

  // 操作列
  const actionColumn = useMemo(
    () => ({
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'right' as const,
      render: (_: unknown, record: Record<string, string>) => {
        const rowIndex = parseInt(record.key, 10);
        const isReorganizing = reorganizingRowKey === record.key;
        return (
          <Space size="small">
            <Tooltip title="重新整理">
              <Button
                size="small"
                icon={<SyncOutlined spin={isReorganizing} />}
                onClick={() => onReorganizeRow(rowIndex)}
                loading={isReorganizing}
              />
            </Tooltip>
            <Popconfirm
              title={`确定删除第 ${rowIndex + 1} 行？`}
              description="此操作不可撤销"
              onConfirm={() => handleDeleteRow(rowIndex)}
              okText="确定"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    }),
    [reorganizingRowKey, onReorganizeRow, handleDeleteRow]
  );

  return (
    <Modal
      title={`查看全部数据 - ${currentSheet} (${fullDataSource.length} 行)`}
      open={visible}
      onCancel={handleClose}
      width="90vw"
      footer={[
        <Space key="left">
          {lastSynced && <Text type="secondary">上次同步: {lastSynced}</Text>}
        </Space>,
        <Space key="right">
          <Button
            icon={<SyncOutlined spin={syncing} />}
            onClick={handleSync}
            loading={syncing}
            disabled={fullDataSource.length === 0}
          >
            同步到存储
          </Button>
          <Button
            icon={<SaveOutlined />}
            onClick={handleSaveAll}
            loading={saving}
            disabled={fullDataSource.length === 0}
          >
            保存全部
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleAddRow} disabled={!currentSheet}>
            新增行
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={handleExport}
            disabled={fullDataSource.length === 0}
          >
            导出CSV
          </Button>
          <Button type="primary" onClick={handleClose}>
            关闭
          </Button>
        </Space>,
      ]}
      styles={{ body: { maxHeight: '75vh', overflow: 'auto' } }}
    >
      {/* Sheet 切换 */}
      {sheets.length > 1 && (
        <Tabs
          activeKey={currentSheet}
          onChange={handleSheetChange}
          size="small"
          items={sheets.map((sheetName) => ({
            key: sheetName,
            label: `${sheetName} (${(allSheetData[sheetName] || []).length} 行)`,
          }))}
          style={{ marginBottom: 8 }}
        />
      )}

      {/* 搜索框 */}
      <div style={{ marginBottom: 8 }}>
        <Input
          placeholder="搜索表格内容..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="small"
        />
        {search && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            找到 {filteredDataSource.length} / {fullDataSource.length} 行
          </Text>
        )}
      </div>

      {/* 数据表格 */}
      <Table
        columns={[...columns, actionColumn]}
        dataSource={filteredDataSource}
        size="small"
        virtual
        pagination={{
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 行`,
          onChange: (_page, size) => {
            setPageSize(size);
          },
        }}
        scroll={{ x: 'max-content', y: 500 }}
        bordered
      />
    </Modal>
  );
};

export default React.memo(FullTableEditorModal);
