import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Select, Tag, Space, message, Input, Modal, Form } from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import type { ColumnsType } from 'antd/es/table';

const { Option } = Select;
const { TextArea } = Input;

interface WorldBook {
  path: string;
  name: string;
  entries: WorldBookEntry[];
}

interface WorldBookEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  selectiveLogic: number;
  addMemo: boolean;
  order: number;
  position: number;
  useProbability: boolean;
  depth: number;
  role: string;
  vectorized?: boolean;
}

interface VectorStatus {
  entryUid: number;
  vectorized: boolean;
  vectorId?: string;
}

export const WorldBookVectorPanel: React.FC<{ worldBook: WorldBook | null }> = ({ worldBook }) => {
  const { setting } = useSettingStore();
  const [vectorStatuses, setVectorStatuses] = useState<VectorStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);

  useEffect(() => {
    if (worldBook) {
      loadVectorStatuses();
    }
  }, [worldBook]);

  const loadVectorStatuses = async () => {
    if (!worldBook) return;
    setLoading(true);
    try {
      const countResult = await window.electronAPI.vector.count();
      const statuses: VectorStatus[] = worldBook.entries.map(entry => ({
        entryUid: entry.uid,
        vectorized: false
      }));
      setVectorStatuses(statuses);
    } catch (error) {
      console.error('Failed to load vector statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  const vectorizeEntry = async (entry: WorldBookEntry) => {
    if (!worldBook || !entry.content) {
      message.warning('条目内容为空');
      return;
    }

    setLoading(true);
    try {
      const embedResult = await window.electronAPI.embedding.generate(entry.content);
      if (!embedResult.success || !embedResult.vector) {
        message.error(`向量化失败: ${embedResult.error}`);
        return;
      }

      await window.electronAPI.vector.add(`wb_${worldBook.path}_${entry.uid}`, embedResult.vector, {
        text: entry.content,
        source: 'worldbook',
        sourceId: worldBook.path,
        entryUid: String(entry.uid),
        key: entry.key,
        comment: entry.comment,
        worldBookPath: worldBook.path,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      setVectorStatuses(prev =>
        prev.map(s =>
          s.entryUid === entry.uid ? { ...s, vectorized: true, vectorId: `wb_${worldBook.path}_${entry.uid}` } : s
        )
      );
      message.success('向量化成功');
    } catch (error) {
      message.error(`向量化失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const searchEntries = () => {
    if (!searchQuery.trim() || !worldBook) return;

    const query = searchQuery.replace(/\s/g, '').toLowerCase();
    const matchedEntries = worldBook.entries.filter(entry => {
      const keyArr = Array.isArray(entry.key) ? entry.key : [];
      const keysecondaryArr = Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
      const keyStr = keyArr.join('').replace(/\s/g, '').toLowerCase();
      const keysecondaryStr = keysecondaryArr.join('').replace(/\s/g, '').toLowerCase();
      const commentStr = String(entry.comment ?? '').replace(/\s/g, '').toLowerCase();
      const contentStr = String(entry.content ?? '').replace(/\s/g, '').toLowerCase();
      return (
        keyStr.includes(query) ||
        keysecondaryStr.includes(query) ||
        commentStr.includes(query) ||
        contentStr.includes(query)
      );
    });

    setSearchResults(matchedEntries);
    setIsSearchModalVisible(true);
  };

  const columns: ColumnsType<VectorStatus> = [
    {
      title: '条目UID',
      dataIndex: 'entryUid',
      key: 'entryUid',
      width: 100
    },
    {
      title: '向量化状态',
      key: 'status',
      width: 120,
      render: (_, record) => (
        <Tag color={record.vectorized ? 'success' : 'default'}>
          {record.vectorized ? '已向量化' : '未向量化'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => {
        const entry = worldBook?.entries.find(e => e.uid === record.entryUid);
        return (
          <Button
            type="link"
            size="small"
            loading={loading}
            onClick={() => entry && vectorizeEntry(entry)}
          >
            {record.vectorized ? '重新向量化' : '向量化'}
          </Button>
        );
      }
    }
  ];

  if (!worldBook) {
    return (
      <Card title="世界书向量化" size="small">
        <p style={{ color: '#999', textAlign: 'center', padding: '20px 0' }}>
          请先选择一个世界书
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="世界书向量化"
        size="small"
        extra={
          <Space>
            <Input
              style={{ width: 200 }}
              placeholder="搜索世界书条目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={searchEntries}
              allowClear
            />
            <Button icon={<SearchOutlined />} onClick={searchEntries} loading={loading}>
              条目搜索
            </Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <p>
            世界书: <strong>{worldBook.name}</strong> | 路径: {worldBook.path} | 条目数: {worldBook.entries.length}
          </p>
          {setting?.vector?.autoVectorizeWorldBook && (
            <Tag color="green">自动向量化已启用</Tag>
          )}
        </div>
        <Table
          columns={columns}
          dataSource={vectorStatuses}
          rowKey="entryUid"
          loading={loading}
          size="small"
          pagination={{ pageSize: 10 }}
          scroll={{ y: 300 }}
        />
      </Card>

      <Modal
        title="条目搜索结果"
        open={isSearchModalVisible}
        onCancel={() => setIsSearchModalVisible(false)}
        footer={null}
        width={800}
      >
        <Table
          columns={[
            { title: 'UID', dataIndex: 'uid', key: 'uid', width: 100 },
            { title: '关键词', dataIndex: 'key', key: 'key', width: 200, render: (keys: string[]) => keys?.join(', ') },
            { title: '注释', dataIndex: 'comment', key: 'comment', width: 150 },
            { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true }
          ]}
          dataSource={searchResults}
          rowKey="uid"
          size="small"
          pagination={false}
          scroll={{ y: 400 }}
        />
      </Modal>
    </>
  );
};
