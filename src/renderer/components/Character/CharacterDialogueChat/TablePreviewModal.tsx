import React, { useState, useCallback, useRef } from 'react';
import { Modal, Table, Tabs, Spin, Empty, Button, Input, Popconfirm, message } from 'antd';
import { DownloadOutlined, ClearOutlined, SaveOutlined } from '@ant-design/icons';

interface SheetData {
  [sheetName: string]: Record<string, any>[];
}

interface SheetHeaders {
  [sheetName: string]: string[];
}

interface TablePreviewModalProps {
  visible: boolean;
  characterCardName: string;
  onClose: () => void;
}

const TablePreviewModal: React.FC<TablePreviewModalProps> = ({
  visible,
  characterCardName,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
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

  const tableDataRef = useRef(tableData);
  const allSheetDataRef = useRef(allSheetData);
  const allSheetHeadersRef = useRef(allSheetHeaders);
  const currentSheetRef = useRef(currentSheet);
  const editingCellRef = useRef(editingCell);
  const editValueRef = useRef(editValue);

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

  const loadTableData = useCallback(async () => {
    if (!visible || !characterCardName) return;

    setLoading(true);
    setError('');
    try {
      const data = await window.electronAPI.memory.getTableData(characterCardName);

      if (data && data.sheets && data.sheets.length > 0) {
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
  }, [visible, characterCardName]);

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
    link.download = `${characterCardName}_${currentSheet}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [currentSheet, allSheetData, allSheetHeaders, characterCardName]);

  const startEdit = useCallback((record: Record<string, any>, colKey: string) => {
    setEditingCell({ rowKey: record.key, colKey });
    setEditValue(record[colKey] || '');
  }, []);

  const saveEdit = useCallback(() => {
    const cell = editingCellRef.current;
    const sheet = currentSheetRef.current;
    const value = editValueRef.current;
    const headers = allSheetHeadersRef.current[sheet] || [];
    const data = tableDataRef.current;
    const allData = allSheetDataRef.current;

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
  }, []);

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
    if (!currentSheet || !characterCardName) return;

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

      await window.electronAPI.memory.saveTableData(characterCardName, currentSheet, storageData);
      message.success(`表格"${currentSheet}"已保存`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`保存失败: ${errorMsg}`);
    } finally {
      setSaving(false);
    }
  }, [currentSheet, characterCardName, allSheetHeaders, tableData]);

  const handleClearCurrentSheet = useCallback(async () => {
    if (!currentSheet || !characterCardName) return;

    try {
      await window.electronAPI.memory.saveTableData(characterCardName, currentSheet, []);
      message.success(`表格"${currentSheet}"已清空`);
      loadTableData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [currentSheet, characterCardName, loadTableData]);

  const handleClearAll = useCallback(async () => {
    if (!characterCardName) return;

    try {
      await window.electronAPI.memory.clearTableData(characterCardName);
      message.success('所有表格数据已清空');
      loadTableData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      message.error(`清空失败: ${errorMsg}`);
    }
  }, [characterCardName, loadTableData]);

  return (
    <Modal
      title={`记忆表格预览 - ${characterCardName}`}
      open={visible}
      onCancel={onClose}
      width="90vw"
      footer={[
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
    </Modal>
  );
};

export default TablePreviewModal;
