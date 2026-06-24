import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Table, Button, Space, Typography, Tag, Statistic, Row, Col, Input, message, Tooltip } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined, CheckOutlined, RollbackOutlined } from '@ant-design/icons';
import type { TableOrganizeVersionSnapshot, TableOrganizeChangeRecord } from '../../../../shared/types/writing.types';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface TableVersionCompareModalProps {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onRollback: () => Promise<void>;
}

interface CellChange {
  sheetName: string;
  rowIndex: number;
  columnName: string;
  oldValue: any;
  newValue: any;
}

const TableVersionCompareModal: React.FC<TableVersionCompareModalProps> = ({
  visible,
  projectId,
  onClose,
  onConfirm,
  onRollback
}) => {
  const [snapshot, setSnapshot] = useState<TableOrganizeVersionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<any>(null);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 加载版本快照
  useEffect(() => {
    if (visible && projectId) {
      loadSnapshot();
    }
  }, [visible, projectId]);

  const loadSnapshot = async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.writing.table.getVersionSnapshot(projectId);
      if (response.success && response.snapshot) {
        setSnapshot(response.snapshot);
        setEditedData(JSON.parse(JSON.stringify(response.snapshot.newData)));
      } else {
        message.error('加载版本快照失败');
      }
    } catch (error) {
      console.error('加载版本快照失败:', error);
      message.error('加载版本快照失败');
    } finally {
      setLoading(false);
    }
  };

  // 计算变更统计
  const changeStats = useMemo(() => {
    if (!snapshot) return { added: 0, modified: 0, deleted: 0, modifiedCells: [] as CellChange[] };

    const oldData = snapshot.originalData;
    const newData = editedData || snapshot.newData;
    const changeRecord = snapshot.changeRecord;

    // 重新计算变更（考虑用户编辑）
    let added = 0;
    let modified = 0;
    let deleted = 0;
    const modifiedCells: CellChange[] = [];

    for (const sheetName of newData.sheets) {
      const oldRows = oldData.data[sheetName] || [];
      const newRows = newData.data[sheetName] || [];

      // 统计新增行
      for (const row of newRows) {
        const uniqueId = row['1'];
        const existsInOld = oldRows.some(r => r['1'] === uniqueId);
        if (!existsInOld && uniqueId) {
          added++;
        }
      }

      // 统计删除行
      for (const row of oldRows) {
        const uniqueId = row['1'];
        const existsInNew = newRows.some(r => r['1'] === uniqueId);
        if (!existsInNew && uniqueId) {
          deleted++;
        }
      }

      // 统计修改的单元格
      const headers = newData.headers[sheetName] || [];
      for (let i = 0; i < newRows.length; i++) {
        const newRow = newRows[i];
        const uniqueId = newRow['1'];
        const oldRow = oldRows.find(r => r['1'] === uniqueId);

        if (oldRow) {
          for (const header of headers) {
            const oldVal = oldRow[header];
            const newVal = newRow[header];
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
              modified++;
              modifiedCells.push({
                sheetName,
                rowIndex: i,
                columnName: header,
                oldValue: oldVal,
                newValue: newVal
              });
            }
          }
        }
      }
    }

    return { added, modified, deleted, modifiedCells };
  }, [snapshot, editedData]);

  // 检查单元格是否被修改
  const isCellModified = (sheetName: string, rowIndex: number, columnName: string): boolean => {
    return changeStats.modifiedCells.some(
      c => c.sheetName === sheetName && c.rowIndex === rowIndex && c.columnName === columnName
    );
  };

  // 检查行是否新增
  const isRowAdded = (sheetName: string, rowIndex: number): boolean => {
    if (!snapshot) return false;
    const oldRows = snapshot.originalData.data[sheetName] || [];
    const newRows = (editedData || snapshot.newData).data[sheetName] || [];
    const row = newRows[rowIndex];
    if (!row) return false;
    const uniqueId = row['1'];
    return !oldRows.some(r => r['1'] === uniqueId) && !!uniqueId;
  };

  // 检查行是否删除
  const isRowDeleted = (sheetName: string, rowIndex: number): boolean => {
    if (!snapshot) return false;
    const oldRows = snapshot.originalData.data[sheetName] || [];
    const newRows = (editedData || snapshot.newData).data[sheetName] || [];
    const row = oldRows[rowIndex];
    if (!row) return false;
    const uniqueId = row['1'];
    return !newRows.some(r => r['1'] === uniqueId) && !!uniqueId;
  };

  // 开始编辑单元格
  const startEdit = (record: any, colKey: string) => {
    setEditingCell({ rowKey: record.key, colKey });
    setEditValue(record[colKey] || '');
  };

  // 保存编辑
  const saveEdit = () => {
    if (!editingCell || !editedData) return;

    const newData = { ...editedData };
    for (const sheetName of newData.sheets) {
      const rows = [...(newData.data[sheetName] || [])];
      const rowIndex = rows.findIndex(r => r.key === editingCell.rowKey);
      if (rowIndex !== -1) {
        rows[rowIndex] = { ...rows[rowIndex], [editingCell.colKey]: editValue };
        newData.data[sheetName] = rows;
        break;
      }
    }

    setEditedData(newData);
    setEditingCell(null);
    setEditValue('');
  };

  // 确认覆盖
  const handleConfirm = async () => {
    Modal.confirm({
      title: '确认覆盖原始数据',
      content: '此操作将用新版本数据覆盖原始数据，覆盖后将无法恢复。确定要继续吗？',
      okText: '确认覆盖',
      cancelText: '取消',
      onOk: async () => {
        setConfirmLoading(true);
        try {
          // 如果有编辑，先保存编辑后的数据
          if (editMode && editedData) {
            // TODO: 保存编辑后的数据到临时存储
            // await window.electronAPI.writing.table.updateVersionSnapshot(projectId, editedData);
          }
          
          await onConfirm();
          message.success('数据已成功覆盖');
          onClose();
        } catch (error) {
          console.error('确认覆盖失败:', error);
          message.error('确认覆盖失败');
        } finally {
          setConfirmLoading(false);
        }
      }
    });
  };

  // 渲染旧版本表格
  const renderOldTable = () => {
    if (!snapshot) return null;
    const oldData = snapshot.originalData;
    const sheets = oldData.sheets;
    
    return sheets.map(sheetName => {
      const headers = oldData.headers[sheetName] || [];
      const rows = oldData.data[sheetName] || [];
      
      const columns = headers.map((header, idx) => ({
        title: header,
        dataIndex: String(idx),
        key: String(idx),
        render: (text: any, record: any, rowIndex: number) => {
          const isDeleted = isRowDeleted(sheetName, rowIndex);
          return (
            <div style={{
              backgroundColor: isDeleted ? '#fff1f0' : 'transparent',
              padding: '4px 8px',
              borderLeft: isDeleted ? '3px solid #ff4d4f' : 'none'
            }}>
              {text}
            </div>
          );
        }
      }));

      const dataSource = rows.map((row, idx) => ({
        ...row,
        key: row['1'] || `row-${idx}`
      }));

      return (
        <div key={sheetName} style={{ marginBottom: 24 }}>
          <Title level={5}>{sheetName}</Title>
          <Table
            columns={columns}
            dataSource={dataSource}
            pagination={false}
            size="small"
            scroll={{ y: 400 }}
          />
        </div>
      );
    });
  };

  // 渲染新版本表格
  const renderNewTable = () => {
    if (!editedData && !snapshot) return null;
    const data = editedData || snapshot?.newData;
    if (!data) return null;
    
    const sheets = data.sheets;
    
    return sheets.map(sheetName => {
      const headers = data.headers[sheetName] || [];
      const rows = data.data[sheetName] || [];
      
      const columns = headers.map((header, idx) => ({
        title: header,
        dataIndex: String(idx),
        key: String(idx),
        render: (text: any, record: any, rowIndex: number) => {
          const isAdded = isRowAdded(sheetName, rowIndex);
          const isModified = isCellModified(sheetName, rowIndex, String(idx));
          const isEditing = editingCell?.rowKey === record.key && editingCell?.colKey === String(idx);

          if (isEditing) {
            return (
              <Input
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onPressEnter={saveEdit}
                autoFocus
                size="small"
              />
            );
          }

          return (
            <div
              style={{
                backgroundColor: isAdded ? '#f6ffed' : isModified ? '#fffbe6' : 'transparent',
                padding: '4px 8px',
                borderLeft: isAdded ? '3px solid #52c41a' : 'none',
                cursor: editMode ? 'pointer' : 'default'
              }}
              onDoubleClick={() => editMode && startEdit(record, String(idx))}
            >
              {text}
            </div>
          );
        }
      }));

      const dataSource = rows.map((row, idx) => ({
        ...row,
        key: row['1'] || `row-${idx}`
      }));

      return (
        <div key={sheetName} style={{ marginBottom: 24 }}>
          <Title level={5}>{sheetName}</Title>
          <Table
            columns={columns}
            dataSource={dataSource}
            pagination={false}
            size="small"
            scroll={{ y: 400 }}
          />
        </div>
      );
    });
  };

  return (
    <Modal
      title="版本对比"
      open={visible}
      onCancel={onClose}
      width="90vw"
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="edit"
          icon={<EditOutlined />}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? '退出编辑' : '编辑模式'}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          icon={<CheckOutlined />}
          onClick={handleConfirm}
          loading={confirmLoading}
        >
          确认覆盖
        </Button>
      ]}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text>加载中...</Text>
        </div>
      ) : (
        <>
          {/* 变更统计 */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Statistic
                title="新增行数"
                value={changeStats.added}
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="修改单元格数"
                value={changeStats.modified}
                valueStyle={{ color: '#faad14' }}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="删除行数"
                value={changeStats.deleted}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Col>
          </Row>

          {/* 对比表格 */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <Title level={4}>原始版本</Title>
              {renderOldTable()}
            </div>
            <div style={{ flex: 1 }}>
              <Title level={4}>
                新版本
                {editMode && <Tag color="blue" style={{ marginLeft: 8 }}>编辑中</Tag>}
              </Title>
              {renderNewTable()}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
};

export default TableVersionCompareModal;
