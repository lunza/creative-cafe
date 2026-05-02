import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Select, Tag, Space, message, Form, Input, InputNumber } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Option } = Select;

interface CharacterWorldBookRelation {
  characterId: string;
  worldBookPath: string;
  worldBookName: string;
  enabled: boolean;
  priority: number;
  filterTags?: string[];
}

interface WorldBook {
  path: string;
  name: string;
}

interface WorldBookRelationPanelProps {
  characterId: string;
  relations: CharacterWorldBookRelation[];
  availableWorldBooks: WorldBook[];
  onChange: (relations: CharacterWorldBookRelation[]) => void;
}

export const WorldBookRelationPanel: React.FC<WorldBookRelationPanelProps> = ({
  characterId,
  relations,
  availableWorldBooks,
  onChange
}) => {
  const [loading, setLoading] = useState(false);
  const [editingRelations, setEditingRelations] = useState<CharacterWorldBookRelation[]>(relations || []);

  useEffect(() => {
    setEditingRelations(relations || []);
  }, [relations]);

  const handleAdd = () => {
    if (availableWorldBooks.length === 0) {
      message.warning('没有可用的世界书');
      return;
    }

    const firstWorldBook = availableWorldBooks[0];
    const newRelation: CharacterWorldBookRelation = {
      characterId,
      worldBookPath: firstWorldBook.path,
      worldBookName: firstWorldBook.name,
      enabled: true,
      priority: 5
    };

    const updated = [...editingRelations, newRelation];
    setEditingRelations(updated);
    onChange(updated);
  };

  const handleRemove = (index: number) => {
    const updated = editingRelations.filter((_, i) => i !== index);
    setEditingRelations(updated);
    onChange(updated);
  };

  const handleUpdate = (index: number, field: keyof CharacterWorldBookRelation, value: any) => {
    const updated = [...editingRelations];
    updated[index] = { ...updated[index], [field]: value };
    setEditingRelations(updated);
    onChange(updated);
  };

  const columns: ColumnsType<CharacterWorldBookRelation> = [
    {
      title: '世界书',
      dataIndex: 'worldBookPath',
      key: 'worldBookPath',
      width: 200,
      render: (path: string, record, index) => (
        <Select
          value={path}
          style={{ width: '100%' }}
          onChange={(value) => {
            const wb = availableWorldBooks.find(w => w.path === value);
            handleUpdate(index, 'worldBookPath', value);
            if (wb) {
              handleUpdate(index, 'worldBookName', wb.name);
            }
          }}
        >
          {availableWorldBooks.map(wb => (
            <Option key={wb.path} value={wb.path}>
              {wb.name}
            </Option>
          ))}
        </Select>
      )
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, record, index) => (
        <Tag color={enabled ? 'success' : 'default'} onClick={() => handleUpdate(index, 'enabled', !enabled)}>
          {enabled ? '是' : '否'}
        </Tag>
      )
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 100,
      render: (priority: number, record, index) => (
        <InputNumber
          min={1}
          max={10}
          value={priority}
          size="small"
          onChange={(value) => handleUpdate(index, 'priority', value || 5)}
        />
      )
    },
    {
      title: '过滤标签',
      dataIndex: 'filterTags',
      key: 'filterTags',
      width: 200,
      render: (tags: string[], record, index) => (
        <Select
          mode="tags"
          value={tags || []}
          style={{ width: '100%' }}
          placeholder="输入标签过滤"
          onChange={(value) => handleUpdate(index, 'filterTags', value)}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record, index) => (
        <Button
          type="link"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemove(index)}
        >
          删除
        </Button>
      )
    }
  ];

  return (
    <Card
      title="关联世界书"
      size="small"
      extra={
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            disabled={availableWorldBooks.length === 0}
          >
            添加关联
          </Button>
        </Space>
      }
    >
      {editingRelations.length === 0 ? (
        <p style={{ color: '#999', textAlign: 'center', padding: '20px 0' }}>
          暂无关联世界书，点击"添加关联"开始配置
        </p>
      ) : (
        <Table
          columns={columns}
          dataSource={editingRelations}
          rowKey={(record) => `${record.characterId}_${record.worldBookPath}`}
          size="small"
          pagination={false}
          scroll={{ y: 300 }}
        />
      )}
      <div style={{ marginTop: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
          <strong>说明:</strong> 在与此角色对话时，系统会自动检索关联世界书的条目。优先级越高，检索权重越大。
        </p>
      </div>
    </Card>
  );
};
