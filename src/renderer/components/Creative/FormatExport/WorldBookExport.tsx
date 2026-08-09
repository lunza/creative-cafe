import React, { useState } from 'react';
import { Button, Space, Typography, Select, message } from 'antd';
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../../stores/creativeStore';
import { useLogStore } from '../../../stores/logStore';
import { formatWorldBookJSON, downloadFile } from '../utils/exportFormatters';

const { Title, Text } = Typography;

interface WorldBookExportProps {
  creativeId: string;
}

const WorldBookExport: React.FC<WorldBookExportProps> = ({ creativeId }) => {
  const creatives = useCreativeStore(s => s.creatives);
  const addLog = useLogStore(s => s.addLog);

  const [isExporting, setIsExporting] = useState(false);

  const creative = creatives.find(c => c.id === creativeId);
  const selectedWorldBook = creative?.worldBook || null;

  const handleExport = async () => {
    if (!selectedWorldBook) {
      message.warning('请选择一个世界书');
      return;
    }

    setIsExporting(true);

    try {
      const worldBookData = formatWorldBookJSON(
        selectedWorldBook.name || 'Unknown World',
        selectedWorldBook.description || '',
        [{ key: 'content', content: selectedWorldBook.content || '', comment: selectedWorldBook.comment || '' }]
      );

      downloadFile(
        `${selectedWorldBook.name || 'worldbook'}.json`,
        JSON.stringify(worldBookData, null, 2)
      );

      message.success('导出成功');
      addLog('[FormatExport] 世界书导出成功', 'info', {
        category: 'creative',
        context: {
          worldBookName: selectedWorldBook.name,
        }
      });
    } catch (error) {
      message.error('导出失败');
      addLog('[FormatExport] 世界书导出失败', 'error', {
        category: 'creative',
        error: error as Error
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text strong>当前世界书</Text>
          <div style={{ marginTop: 8 }}>
            <Text>{selectedWorldBook?.name || '未设置世界书'}</Text>
          </div>
        </div>

        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          loading={isExporting}
          disabled={!selectedWorldBook}
          size="large"
        >
          导出世界书JSON
        </Button>

        {selectedWorldBook && (
          <div style={{ marginTop: 16, padding: 12, backgroundColor: 'var(--card-bg-color, #f5f5f5)', borderRadius: 4 }}>
            <Text strong>名称：</Text>
            <Text>{selectedWorldBook.name}</Text>
            <br />
            <Text strong>描述：</Text>
            <Text>{selectedWorldBook.description}</Text>
          </div>
        )}
      </Space>
    </div>
  );
};

export default WorldBookExport;
