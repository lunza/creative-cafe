import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Table, Button, Tabs, Typography, Tag, Statistic, Row, Col, Input, message, Tooltip, theme } from 'antd';
import { EditOutlined, CheckOutlined, SwapOutlined } from '@ant-design/icons';
import type { TableOrganizeVersionSnapshot } from '../../../../shared/types/writing.types';

const { Text, Title } = Typography;

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

// 单元格内容组件：截断 + hover tooltip
const CellContent: React.FC<{
  text: any;
  isAdded?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
  editMode?: boolean;
  isEditing?: boolean;
  editValue?: string;
  onEditStart?: () => void;
  onEditChange?: (v: string) => void;
  onEditSave?: () => void;
  token: any;
}> = ({ text, isAdded, isModified, isDeleted, editMode, isEditing, editValue, onEditStart, onEditChange, onEditSave, token }) => {
  const displayText = String(text ?? '');
  const maxLen = 30;
  const isTruncated = displayText.length > maxLen;

  if (isEditing) {
    return (
      <Input
        value={editValue}
        onChange={e => onEditChange?.(e.target.value)}
        onBlur={onEditSave}
        onPressEnter={onEditSave}
        autoFocus
        size="small"
      />
    );
  }

  const bgColor = isAdded ? token.colorSuccessBg : isModified ? token.colorWarningBg : isDeleted ? token.colorErrorBg : 'transparent';
  const borderLeft = isAdded ? `3px solid ${token.colorSuccess}` : isDeleted ? `3px solid ${token.colorError}` : 'none';

  const cell = (
    <div
      style={{
        backgroundColor: bgColor,
        padding: '4px 8px',
        borderLeft,
        cursor: editMode ? 'pointer' : 'default',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: 200,
      }}
      onDoubleClick={() => editMode && onEditStart?.()}
    >
      {displayText}
    </div>
  );

  if (isTruncated) {
    return <Tooltip title={displayText} mouseEnterDelay={0.3}>{cell}</Tooltip>;
  }
  return cell;
};

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
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const { token } = theme.useToken();

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
        setActiveSheet(response.snapshot.newData.sheets?.[0] || '');
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
    let added = 0, modified = 0, deleted = 0;
    const modifiedCells: CellChange[] = [];

    for (const sheetName of newData.sheets) {
      const oldRows = oldData.data[sheetName] || [];
      const newRows = newData.data[sheetName] || [];
      for (const row of newRows) {
        const uid = row['1'];
        if (uid && !oldRows.some(r => r['1'] === uid)) added++;
      }
      for (const row of oldRows) {
        const uid = row['1'];
        if (uid && !newRows.some(r => r['1'] === uid)) deleted++;
      }
      const headers = newData.headers[sheetName] || [];
      for (let i = 0; i < newRows.length; i++) {
        const newRow = newRows[i];
        const uid = newRow['1'];
        const oldRow = oldRows.find(r => r['1'] === uid);
        if (oldRow) {
          for (const header of headers) {
            if (JSON.stringify(oldRow[header]) !== JSON.stringify(newRow[header])) {
              modified++;
              modifiedCells.push({ sheetName, rowIndex: i, columnName: header, oldValue: oldRow[header], newValue: newRow[header] });
            }
          }
        }
      }
    }
    return { added, modified, deleted, modifiedCells };
  }, [snapshot, editedData]);

  // 当前 sheet 的变更统计
  const sheetChangeStats = useMemo(() => {
    if (!snapshot || !activeSheet) return { added: 0, modified: 0, deleted: 0 };
    const oldData = snapshot.originalData;
    const newData = editedData || snapshot.newData;
    const oldRows = oldData.data[activeSheet] || [];
    const newRows = newData.data[activeSheet] || [];
    let added = 0, modified = 0, deleted = 0;
    for (const row of newRows) {
      const uid = row['1'];
      if (uid && !oldRows.some(r => r['1'] === uid)) added++;
    }
    for (const row of oldRows) {
      const uid = row['1'];
      if (uid && !newRows.some(r => r['1'] === uid)) deleted++;
    }
    const headers = newData.headers[activeSheet] || [];
    for (let i = 0; i < newRows.length; i++) {
      const newRow = newRows[i];
      const uid = newRow['1'];
      const oldRow = oldRows.find(r => r['1'] === uid);
      if (oldRow) {
        for (const header of headers) {
          if (JSON.stringify(oldRow[header]) !== JSON.stringify(newRow[header])) modified++;
        }
      }
    }
    return { added, modified, deleted };
  }, [snapshot, editedData, activeSheet]);

  const isCellModified = (sheetName: string, rowIndex: number, columnName: string): boolean =>
    changeStats.modifiedCells.some(c => c.sheetName === sheetName && c.rowIndex === rowIndex && c.columnName === columnName);

  const isRowAdded = (sheetName: string, rowIndex: number): boolean => {
    if (!snapshot) return false;
    const oldRows = snapshot.originalData.data[sheetName] || [];
    const newRows = (editedData || snapshot.newData).data[sheetName] || [];
    const row = newRows[rowIndex];
    if (!row) return false;
    const uid = row['1'];
    return !!uid && !oldRows.some(r => r['1'] === uid);
  };

  const isRowDeleted = (sheetName: string, rowIndex: number): boolean => {
    if (!snapshot) return false;
    const oldRows = snapshot.originalData.data[sheetName] || [];
    const newRows = (editedData || snapshot.newData).data[sheetName] || [];
    const row = oldRows[rowIndex];
    if (!row) return false;
    const uid = row['1'];
    return !!uid && !newRows.some(r => r['1'] === uid);
  };

  const startEdit = (record: any, colKey: string) => {
    setEditingCell({ rowKey: record.key, colKey });
    setEditValue(record[colKey] || '');
  };

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

  const handleConfirm = () => setConfirmModalVisible(true);

  const handleConfirmOk = async () => {
    setConfirmLoading(true);
    try {
      await onConfirm();
      message.success('数据已成功覆盖');
      setConfirmModalVisible(false);
      onClose();
    } catch (error) {
      console.error('确认覆盖失败:', error);
      message.error('确认覆盖失败');
    } finally {
      setConfirmLoading(false);
    }
  };

  // 构建表格列
  const buildColumns = (sheetName: string, headers: string[], isOld: boolean) =>
    headers.map((header, idx) => ({
      title: header,
      dataIndex: String(idx),
      key: String(idx),
      width: 150,
      render: (text: any, record: any, rowIndex: number) => {
        const colKey = String(idx);
        const isEditing = editingCell?.rowKey === record.key && editingCell?.colKey === colKey;
        if (isOld) {
          return (
            <CellContent
              text={text}
              isDeleted={isRowDeleted(sheetName, rowIndex)}
              token={token}
            />
          );
        }
        return (
          <CellContent
            text={text}
            isAdded={isRowAdded(sheetName, rowIndex)}
            isModified={isCellModified(sheetName, rowIndex, colKey)}
            editMode={editMode}
            isEditing={isEditing}
            editValue={editValue}
            onEditStart={() => startEdit(record, colKey)}
            onEditChange={setEditValue}
            onEditSave={saveEdit}
            token={token}
          />
        );
      },
    }));

  const renderSheetTable = (sheetName: string, data: any, isOld: boolean) => {
    const headers = data.headers[sheetName] || [];
    const rows = data.data[sheetName] || [];
    const columns = buildColumns(sheetName, headers, isOld);
    const dataSource = rows.map((row: any, idx: number) => ({ ...row, key: row['1'] || `row-${idx}` }));

    return (
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content', y: 450 }}
        style={{ width: '100%' }}
      />
    );
  };

  // Sheet 页签
  const sheetTabs = snapshot
    ? (editedData || snapshot.newData).sheets.map((name: string) => {
        const stats = (() => {
          const oldRows = snapshot.originalData.data[name] || [];
          const newRows = (editedData || snapshot.newData).data[name] || [];
          let a = 0, m = 0, d = 0;
          for (const row of newRows) { const uid = row['1']; if (uid && !oldRows.some(r => r['1'] === uid)) a++; }
          for (const row of oldRows) { const uid = row['1']; if (uid && !newRows.some(r => r['1'] === uid)) d++; }
          const headers = (editedData || snapshot.newData).headers[name] || [];
          for (let i = 0; i < newRows.length; i++) {
            const newRow = newRows[i];
            const uid = newRow['1'];
            const oldRow = oldRows.find(r => r['1'] === uid);
            if (oldRow) {
              for (const header of headers) {
                if (JSON.stringify(oldRow[header]) !== JSON.stringify(newRow[header])) m++;
              }
            }
          }
          return { a, m, d };
        })();
        const hasChanges = stats.a > 0 || stats.m > 0 || stats.d > 0;
        return {
          key: name,
          label: (
            <span>
              {name}
              {hasChanges && (
                <Tag style={{ marginLeft: 6, fontSize: 11 }} color={stats.a > 0 ? 'green' : stats.d > 0 ? 'red' : 'orange'}>
                  {stats.a > 0 && `+${stats.a}`}
                  {stats.d > 0 && ` -${stats.d}`}
                  {stats.m > 0 && ` ~${stats.m}`}
                </Tag>
              )}
            </span>
          ),
          children: (
            <div style={{ display: 'flex', gap: 16, height: 520 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Title level={5} style={{ margin: 0 }}>原始版本</Title>
                  <Tag color="default">只读</Tag>
                </div>
                <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${token.colorBorder}`, borderRadius: 6 }}>
                  {renderSheetTable(name, snapshot.originalData, true)}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Title level={5} style={{ margin: 0 }}>新版本</Title>
                  {editMode && <Tag color="blue">编辑中</Tag>}
                </div>
                <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${token.colorBorder}`, borderRadius: 6 }}>
                  {renderSheetTable(name, editedData || snapshot.newData, false)}
                </div>
              </div>
            </div>
          ),
        };
      })
    : [];

  return (
    <>
    <Modal
      title="版本对比"
      open={visible}
      onCancel={onClose}
      width="95vw"
      style={{ top: 20 }}
      bodyStyle={{ padding: '16px 24px' }}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="edit" icon={<EditOutlined />} onClick={() => setEditMode(!editMode)}>
          {editMode ? '退出编辑' : '编辑模式'}
        </Button>,
        <Button key="confirm" type="primary" icon={<CheckOutlined />} onClick={handleConfirm} loading={confirmLoading}>
          确认覆盖
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Text>加载中...</Text></div>
      ) : snapshot ? (
        <>
          {/* 全局变更统计 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Statistic title="新增行数" value={changeStats.added} valueStyle={{ color: token.colorSuccess }} />
            </Col>
            <Col span={8}>
              <Statistic title="修改单元格数" value={changeStats.modified} valueStyle={{ color: token.colorWarning }} />
            </Col>
            <Col span={8}>
              <Statistic title="删除行数" value={changeStats.deleted} valueStyle={{ color: token.colorError }} />
            </Col>
          </Row>

          {/* Sheet 页签 + 对比表格 */}
          <Tabs
            activeKey={activeSheet}
            onChange={setActiveSheet}
            items={sheetTabs}
            tabBarExtraContent={
              activeSheet ? (
                <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                  <Text type="success">当前 Sheet 新增: {sheetChangeStats.added}</Text>
                  <Text type="warning">修改: {sheetChangeStats.modified}</Text>
                  <Text type="danger">删除: {sheetChangeStats.deleted}</Text>
                </div>
              ) : null
            }
          />

          {/* 图例 */}
          <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 12 }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: token.colorSuccessBg, border: `2px solid ${token.colorSuccess}`, marginRight: 4, verticalAlign: 'middle' }} />新增行</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: token.colorWarningBg, marginRight: 4, verticalAlign: 'middle' }} />修改单元格</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: token.colorErrorBg, border: `2px solid ${token.colorError}`, marginRight: 4, verticalAlign: 'middle' }} />删除行</span>
            <span style={{ color: token.colorTextSecondary }}>💡 内容过长时 hover 查看完整内容</span>
          </div>
        </>
      ) : null}
    </Modal>

    {/* 二次确认弹窗 */}
    <Modal
      title="确认覆盖原始数据"
      open={confirmModalVisible}
      onOk={handleConfirmOk}
      onCancel={() => setConfirmModalVisible(false)}
      okText="确认覆盖"
      cancelText="取消"
      confirmLoading={confirmLoading}
    >
      <Text>此操作将用新版本数据覆盖原始数据，覆盖后将无法恢复。确定要继续吗？</Text>
    </Modal>
    </>
  );
};

export default TableVersionCompareModal;
