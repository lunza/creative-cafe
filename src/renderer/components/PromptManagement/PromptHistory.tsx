import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Drawer,
  Timeline,
  Button,
  Tag,
  DatePicker,
  Select,
  Modal,
  Spin,
  Typography,
  Empty,
  Space,
  Popconfirm,
  message,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { PromptHistoryRecord } from '../../../shared/types/promptTemplate.types';

const { Text } = Typography;

interface PromptHistoryProps {
  moduleId: string;
  visible: boolean;
  onClose: () => void;
  onRollback: () => void;
}

const PromptHistory: React.FC<PromptHistoryProps> = ({
  moduleId,
  visible,
  onClose,
  onRollback,
}) => {
  const [history, setHistory] = useState<PromptHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [dateRange, setDateRange] = useState<[number, number] | null>(null);
  const [userFilter, setUserFilter] = useState<string | undefined>(undefined);

  const loadHistory = useCallback(async () => {
    if (!moduleId) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.prompt.getHistory(moduleId);
      if (result.success && result.data) {
        setHistory(result.data as PromptHistoryRecord[]);
      } else {
        message.error(result.error || '加载历史记录失败');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载历史记录时发生错误';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    if (visible && moduleId) {
      loadHistory();
    }
  }, [visible, moduleId, loadHistory]);

  // Sort by timestamp descending (newest first)
  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => b.timestamp - a.timestamp);
  }, [history]);

  // Unique modifiedBy values for filter
  const userOptions = useMemo(() => {
    const users = Array.from(new Set(sortedHistory.map((r) => r.modifiedBy)));
    return users.map((u) => ({ label: u, value: u }));
  }, [sortedHistory]);

  // Apply filters
  const filteredHistory = useMemo(() => {
    return sortedHistory.filter((record) => {
      if (dateRange) {
        const [startTime, endTime] = dateRange;
        if (record.timestamp < startTime || record.timestamp > endTime) {
          return false;
        }
      }
      if (userFilter && record.modifiedBy !== userFilter) {
        return false;
      }
      return true;
    });
  }, [sortedHistory, dateRange, userFilter]);

  const handleRollback = (version: number) => {
    Modal.confirm({
      title: '确认回溯',
      content: '回溯将覆盖当前版本，是否继续？',
      okText: '确认回溯',
      cancelText: '取消',
      onOk: async () => {
        setRollingBack(true);
        try {
          const result = await window.electronAPI.prompt.rollback(
            moduleId,
            version,
            '用户手动回溯'
          );
          if (result.success && result.data) {
            message.success('回溯成功');
            onRollback();
            await loadHistory();
          } else {
            message.error(result.error || '回溯失败：未找到指定版本的历史记录');
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : '回溯时发生错误';
          message.error(msg);
        } finally {
          setRollingBack(false);
        }
      },
    });
  };

  const handleClearHistory = async () => {
    try {
      const result = await window.electronAPI.prompt.clearHistory(moduleId);
      if (result.success) {
        message.success('历史记录已清空');
        setHistory([]);
        onClose();
      } else {
        message.error(result.error || '清空失败');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '清空历史记录时发生错误';
      message.error(msg);
    }
  };

  const timelineItems = useMemo(() => {
    return filteredHistory.map((record, index) => {
      const isLatest = index === 0;
      return {
        color: isLatest ? ('green' as const) : ('blue' as const),
        children: (
          <div style={{ paddingBottom: 8 }}>
            <Space align="center" style={{ marginBottom: 4 }}>
              <Tag color={isLatest ? 'green' : 'blue'}>v{record.version}</Tag>
              {isLatest && <Tag>当前版本</Tag>}
              {!isLatest && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => handleRollback(record.version)}
                  loading={rollingBack}
                >
                  回溯到此版本
                </Button>
              )}
            </Space>
            <div style={{ marginBottom: 2 }}>
              <Text type="secondary">
                {new Date(record.timestamp).toLocaleString('zh-CN')}
              </Text>
            </div>
            <div style={{ marginBottom: 2 }}>
              <Text type="secondary">修改者：{record.modifiedBy}</Text>
            </div>
            <div>
              <Text>{record.changeSummary}</Text>
            </div>
          </div>
        ),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredHistory, rollingBack]);

  return (
    <Drawer
      title="历史记录"
      open={visible}
      onClose={onClose}
      width={560}
      destroyOnClose
      extra={
        <Popconfirm
          title="清空历史记录"
          description={`确定要清空「${moduleId}」的所有历史记录吗？此操作不可恢复。`}
          onConfirm={handleClearHistory}
          okText="确定清空"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          placement="topRight"
          disabled={history.length === 0}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            size="small"
            disabled={history.length === 0}
          >
            清空历史记录
          </Button>
        </Popconfirm>
      }
    >
      <Spin spinning={loading}>
        <Space style={{ marginBottom: 16, width: '100%' }} direction="vertical">
          <Space wrap>
            <DatePicker.RangePicker
              allowClear
              placeholder={['开始日期', '结束日期']}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setDateRange([
                    dates[0].startOf('day').valueOf(),
                    dates[1].endOf('day').valueOf(),
                  ]);
                } else {
                  setDateRange(null);
                }
              }}
            />
            <Select
              allowClear
              placeholder="筛选修改者"
              value={userFilter}
              onChange={(value: string | undefined) => setUserFilter(value)}
              options={userOptions}
              style={{ width: 160 }}
            />
          </Space>
        </Space>

        {filteredHistory.length === 0 ? (
          <Empty description={loading ? '加载中...' : '暂无历史记录'} />
        ) : (
          <Timeline items={timelineItems} />
        )}
      </Spin>
    </Drawer>
  );
};

export default PromptHistory;
