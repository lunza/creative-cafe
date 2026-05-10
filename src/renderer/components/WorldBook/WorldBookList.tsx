import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Popconfirm, Typography, message } from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  EditOutlined
} from '@ant-design/icons';
import { useWorldBookStore } from '../../stores/worldBookStore';
import { useUIStore } from '../../stores/uiStore';
import { useLogStore } from '../../stores/logStore';
import type { ColumnsType } from 'antd/es/table';
import '../../styles/list-common.css';
import './WorldBookManager.css';

const { Text } = Typography;

interface WorldBookMeta {
  name: string;
  path: string;
  size: number;
  modified: Date;
}

interface WorldBookListProps {
  onViewWorldBook: (record: WorldBookMeta) => void;
  onOptimizeWorldBook: (path: string) => void;
  onDeleteWorldBook: (path: string) => void;
  onImportWorldBook: () => void;
  onCreateWorldBook: () => void;
}

const WorldBookList: React.FC<WorldBookListProps> = ({
  onViewWorldBook,
  onOptimizeWorldBook,
  onDeleteWorldBook,
  onImportWorldBook,
  onCreateWorldBook
}) => {
  const { worldBooks, loading, fetchWorldBooks, optimizeWorldBook } = useWorldBookStore();
  const { theme: appTheme } = useUIStore();
  const { addLog } = useLogStore();
  const [worldBookDir, setWorldBookDir] = useState<string>('');
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const getWorldBookDir = async () => {
      try {
        const dir = await window.electronAPI.worldBook.getDirectory();
        setWorldBookDir(dir);
      } catch (error) {
        addLog(`获取世界书目录失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    };
    getWorldBookDir();
  }, []);

  useEffect(() => {
    fetchWorldBooks();
  }, [fetchWorldBooks]);

  const handleOptimize = async (path: string) => {
    addLog(`[WorldBook] 开始优化世界书: ${path}`);
    try {
      await optimizeWorldBook(path);
      addLog(`[WorldBook] 优化成功: ${path}`, 'info');
      message.success('优化成功');
    } catch (error) {
      addLog(`[WorldBook] 优化失败: ${path}`, 'error');
      message.error('优化失败');
    }
  };

  const handleDelete = async (path: string) => {
    addLog(`[WorldBook] 删除世界书: ${path}`);
    try {
      await window.electronAPI.worldBook.delete(path);
      addLog(`[WorldBook] 删除成功: ${path}`, 'info');
      message.success('删除成功');
      fetchWorldBooks();
    } catch (error) {
      addLog(`[WorldBook] 删除失败: ${path}`, 'error');
      message.error('删除失败');
    }
  };

  const columns: ColumnsType<WorldBookMeta> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name)
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => `${(size / 1024).toFixed(2)} KB`,
      sorter: (a, b) => a.size - b.size
    },
    {
      title: '修改时间',
      dataIndex: 'modified',
      key: 'modified',
      render: (modified: Date) => new Date(modified).toLocaleString(),
      sorter: (a, b) => new Date(a.modified).getTime() - new Date(b.modified).getTime()
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => onViewWorldBook(record)}
          >
            查看
          </Button>
          <Button
            type="link"
            icon={<ThunderboltOutlined />}
            onClick={() => onOptimizeWorldBook(record.path)}
          >
            优化
          </Button>
          <Popconfirm
            title="确定要删除这个世界书吗？"
            onConfirm={() => onDeleteWorldBook(record.path)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div className={`worldbook-manager list-container ${appTheme === 'dark' ? 'dark' : ''}`}>
      <div className="worldbook-header list-header">
        <h2>世界书管理</h2>
        <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
          世界书存储地址: {worldBookDir}
        </Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchWorldBooks}>
            刷新
          </Button>
          <Button icon={<UploadOutlined />} onClick={onImportWorldBook}>
            导入世界书
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreateWorldBook}>
            新建世界书
          </Button>
        </Space>
      </div>

      <Card className="table-container">
        <Table
          columns={columns}
          dataSource={worldBooks}
          rowKey="path"
          loading={loading}
          bordered
          pagination={{
            pageSize,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            className: 'table-pagination-wrapper',
            onChange: (page, size) => { setPageSize(size); },
          }}
        />
      </Card>
    </div>
  );
};

export default WorldBookList;
