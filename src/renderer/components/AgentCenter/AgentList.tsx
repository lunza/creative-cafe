/**
 * AgentList —— 智能体配置列表表格
 *
 * 来源：spec §add-agent-mode-management-and-center Task 7
 *
 * 职责：
 *  1. 以 antd Table 渲染智能体配置列表
 *  2. 提供启用/禁用切换、查看详情入口
 *  3. 响应式：小屏幕下隐藏"创建时间"列
 */
import React, { useMemo } from 'react';
import { Table, Switch, Button, Tag, Empty, Modal, Space } from 'antd';
import { Grid } from 'antd';
import { PlusOutlined, MessageOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { AgentConfig, AgentType } from '@shared/types';

/** 类型 → 中文标签映射 */
const TYPE_LABELS: Record<AgentType, string> = {
  dialogue: '对话',
  writing: '写作',
  worldbook: '世界书',
  game: '游戏',
  custom: '自定义',
};

/** 类型 → Tag 颜色映射 */
const TYPE_COLORS: Record<AgentType, string> = {
  dialogue: 'blue',
  writing: 'green',
  worldbook: 'purple',
  game: 'orange',
  custom: 'default',
};

interface AgentListProps {
  configs: AgentConfig[];
  loading: boolean;
  onToggle: (id: string) => void;
  onViewDetail: (config: AgentConfig) => void;
  onCreate: () => void;
  onEdit: (config: AgentConfig) => void;
  onDelete: (id: string) => void;
  onChat: (agent: AgentConfig) => void;
}

const AgentList: React.FC<AgentListProps> = ({
  configs,
  loading,
  onToggle,
  onViewDetail,
  onCreate,
  onEdit,
  onDelete,
  onChat,
}) => {
  const screens = Grid.useBreakpoint();

  /** 删除智能体确认 */
  const handleDelete = (config: AgentConfig) => {
    Modal.confirm({
      title: '确认删除智能体',
      content: `确定要删除智能体「${config.name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => onDelete(config.id),
    });
  };

  const columns: ColumnsType<AgentConfig> = useMemo(() => {
    const cols: ColumnsType<AgentConfig> = [
      {
        title: '智能体',
        dataIndex: 'name',
        key: 'name',
        render: (_text, record) => (
          <div className="agent-name-cell">
            <span className="agent-emoji">
              {record.identity?.emoji || '🤖'}
            </span>
            <span className="agent-name-text">{record.name}</span>
            {record.isSystem && <Tag className="agent-system-badge" color="gold">系统</Tag>}
          </div>
        ),
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        render: (type: AgentType) => (
          <Tag color={TYPE_COLORS[type]}>{TYPE_LABELS[type]}</Tag>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (status, record) => (
          <Switch
            checked={status === 'enabled'}
            onChange={() => onToggle(record.id)}
            size="small"
          />
        ),
      },
      {
        title: '技能数',
        dataIndex: 'skills',
        key: 'skills',
        render: (skills: string[]) => skills.length,
      },
      {
        title: '操作',
        key: 'action',
        render: (_text, record) => (
          <Space>
            <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => onChat(record)}>
              对话
            </Button>
            <Button type="link" size="small" onClick={() => onViewDetail(record)}>
              详情
            </Button>
            {!record.isSystem && (
              <>
                <Button type="link" size="small" onClick={() => onEdit(record)}>
                  编辑
                </Button>
                <Button type="link" size="small" danger onClick={() => handleDelete(record)}>
                  删除
                </Button>
              </>
            )}
          </Space>
        ),
      },
    ];

    // 大屏幕（md 及以上）才显示创建时间列
    if (screens.md !== false) {
      cols.splice(4, 0, {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (createdAt: number) =>
          new Date(createdAt).toLocaleDateString('zh-CN'),
      });
    }

    return cols;
  }, [screens.md, onToggle, onViewDetail, onEdit, onDelete, onChat]);

  if (!loading && configs.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            创建智能体
          </Button>
        </div>
        <Empty description="暂无智能体配置" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          创建智能体
        </Button>
      </div>
      <Table<AgentConfig>
        columns={columns}
        dataSource={configs}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
};

export default AgentList;
