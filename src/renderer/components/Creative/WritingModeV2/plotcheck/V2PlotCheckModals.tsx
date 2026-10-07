import React, { useEffect, useState } from 'react';
import { Button, Modal, Popconfirm, Space, Table, theme, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type {
  V2AutoFixResult,
  V2LogicCheckRecord,
} from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';

/**
 * V2 剧情检查弹窗集合（从 V2PlotCheckPanel 拆出，满足单组件 ≤ 400 行）
 *  - FixConfirmModal：单条修正确认（diff 对比）
 *  - BatchConfirmModal：批量修正确认
 *  - LogicRecordsModal：逻辑矛盾记录查询/清空
 */

interface FixConfirmModalProps {
  open: boolean;
  title: string;
  result: V2AutoFixResult | null;
  onAccept: () => void;
  onCancel: () => void;
}

export const V2FixConfirmModal: React.FC<FixConfirmModalProps> = ({
  open,
  title,
  result,
  onAccept,
  onCancel,
}) => {
  const { token } = theme.useToken();
  const diffs = result?.diffs ?? [];
  return (
    <Modal title={`确认修正：${title}`} open={open} onCancel={onCancel} onOk={onAccept} okText="接受修正" width={640}>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {diffs.length === 0 ? (
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 8 }}>
            AI 未返回具体差异，将整体替换正文为修正后版本。
          </div>
        ) : (
          diffs.map((d, i) => (
            <div key={i} style={{ marginBottom: 10, fontSize: 12 }}>
              <div
                style={{
                  background: token.colorErrorBg,
                  border: `1px solid ${token.colorErrorBorder}`,
                  borderRadius: 6,
                  padding: '4px 8px',
                  marginBottom: 4,
                  whiteSpace: 'pre-wrap',
                }}
              >
                - {d.originalText}
              </div>
              <div
                style={{
                  background: token.colorSuccessBg,
                  border: `1px solid ${token.colorSuccessBorder}`,
                  borderRadius: 6,
                  padding: '4px 8px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                + {d.fixedText}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};

interface BatchConfirmModalProps {
  open: boolean;
  okCount: number;
  total: number;
  onAccept: () => void;
  onCancel: () => void;
}

export const V2BatchConfirmModal: React.FC<BatchConfirmModalProps> = ({
  open,
  okCount,
  total,
  onAccept,
  onCancel,
}) => {
  const { token } = theme.useToken();
  return (
    <Modal title="确认批量修正结果" open={open} onCancel={onCancel} onOk={onAccept} okText="接受全部修正" width={520}>
      <div style={{ fontSize: 13 }}>
        共处理 {total} 个问题，成功 {okCount} 个。
        <br />
        <span style={{ color: token.colorTextSecondary }}>
          接受后正文将整体替换为批量修正后的版本（可用撤销恢复）。
        </span>
      </div>
    </Modal>
  );
};

interface LogicRecordsModalProps {
  open: boolean;
  onClose: () => void;
}

const LOGIC_RECORD_COLUMNS = [
  { title: '#', dataIndex: '0', key: '0', width: 40 },
  { title: '类型', dataIndex: '2', key: '2', width: 110 },
  { title: '情节描述', dataIndex: '3', key: '3' },
  { title: '章节', dataIndex: '5', key: '5', width: 110 },
  { title: '严重度', dataIndex: '6', key: '6', width: 60 },
  { title: '建议', dataIndex: '7', key: '7' },
  { title: '时间', dataIndex: '8', key: '8', width: 140 },
];

export const V2LogicRecordsModal: React.FC<LogicRecordsModalProps> = ({ open, onClose }) => {
  const [records, setRecords] = useState<V2LogicCheckRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const api = getWritingV2API();
    if (!api) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await api.getLogicCheckRecords();
        if (cancelled) return;
        setRecords(result.success ? result.records : []);
        if (!result.success) message.error(result.error || '获取逻辑记录失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleClear = async () => {
    const api = getWritingV2API();
    if (!api) return;
    setClearing(true);
    try {
      const result = await api.clearLogicCheckRecords();
      if (result.success) {
        setRecords([]);
        message.success('逻辑记录已清空');
      } else {
        message.error(result.error || '清空失败');
      }
    } finally {
      setClearing(false);
    }
  };

  return (
    <Modal
      title="逻辑矛盾记录（全局）"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Popconfirm
            title="确认清空全部逻辑矛盾记录？"
            onConfirm={handleClear}
            okText="清空"
            okButtonProps={{ danger: true, loading: clearing }}
          >
            <Button danger icon={<DeleteOutlined />}>
              清空记录
            </Button>
          </Popconfirm>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
      width={860}
    >
      <Table
        size="small"
        loading={loading}
        rowKey="1"
        columns={LOGIC_RECORD_COLUMNS}
        dataSource={records}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </Modal>
  );
};
