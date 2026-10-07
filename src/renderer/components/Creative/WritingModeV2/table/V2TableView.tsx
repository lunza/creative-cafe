import React from 'react';
import { Button, Input, Popconfirm, Space, Table, Tooltip, theme } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  DownloadOutlined,
  ClearOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

interface V2TableViewProps {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  dirty: boolean;
  saving: boolean;
  reorganizingRow: number | null;
  onCellChange: (rowIndex: number, column: string, value: string) => void;
  onAddRow: () => void;
  onDeleteRow: (rowIndex: number) => void;
  onReorganizeRow: (rowIndex: number, row: Record<string, unknown>) => void;
  onSave: () => void;
  onExportCsv: () => void;
  onClearSheet: () => void;
}

/**
 * V2 可编辑表格视图
 *
 * 行内编辑（单元格 Input）+ 增行/删行 + 保存/导出 CSV/清空当前表 + 单行 AI 重整理。
 * 数据流：rows 为父组件工作副本，编辑只改副本，「保存修改」落盘后才同步主进程。
 */
const V2TableView: React.FC<V2TableViewProps> = ({
  sheetName,
  headers,
  rows,
  dirty,
  saving,
  reorganizingRow,
  onCellChange,
  onAddRow,
  onDeleteRow,
  onReorganizeRow,
  onSave,
  onExportCsv,
  onClearSheet,
}) => {
  const { token } = theme.useToken();

  const columns: any[] = headers.map((h) => ({
    title: h,
    dataIndex: h,
    key: h,
    render: (value: unknown, _row: Record<string, unknown>, idx: number) => (
      <Input
        size="small"
        variant="borderless"
        value={value == null ? '' : String(value)}
        placeholder="—"
        onChange={(e) => onCellChange(idx, h, e.target.value)}
        style={{ paddingLeft: 8, paddingRight: 8 }}
      />
    ),
  }));

  columns.push({
    title: '操作',
    key: '__actions',
    width: 96,
    render: (_v: unknown, row: Record<string, unknown>, idx: number) => (
      <Space size={4}>
        <Tooltip title="AI 按当前整理要求重新整理这一行">
          <Button
            size="small"
            type="text"
            icon={<ThunderboltOutlined />}
            loading={reorganizingRow === idx}
            onClick={() => onReorganizeRow(idx, row)}
          />
        </Tooltip>
        <Popconfirm
          title="删除这一行？"
          description="保存修改后生效"
          okText="删除"
          cancelText="取消"
          onConfirm={() => onDeleteRow(idx)}
        >
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    ),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          {sheetName} · {rows.length} 行
        </span>
        {dirty && (
          <span style={{ fontSize: 11, color: token.colorWarning }}>
            有未保存修改
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Button size="small" icon={<PlusOutlined />} onClick={onAddRow}>
          添加行
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!dirty}
          onClick={onSave}
        >
          保存修改
        </Button>
        <Button size="small" icon={<DownloadOutlined />} disabled={rows.length === 0} onClick={onExportCsv}>
          导出 CSV
        </Button>
        <Popconfirm
          title={`清空「${sheetName}」的全部行？`}
          description="保存修改后生效"
          okText="清空"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={onClearSheet}
        >
          <Button size="small" danger icon={<ClearOutlined />} disabled={rows.length === 0}>
            清空本表
          </Button>
        </Popconfirm>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table
          size="small"
          rowKey={(_row, idx) => String(idx ?? 0)}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: false, size: 'small' }}
          scroll={{ x: 'max-content' }}
        />
      </div>
    </div>
  );
};

export default V2TableView;
