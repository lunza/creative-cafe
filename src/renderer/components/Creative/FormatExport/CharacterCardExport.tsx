import React, { useState, useEffect } from 'react';
import { Button, Space, Typography, Card, Select, message, Spin, Input } from 'antd';
import { DownloadOutlined, FileImageOutlined } from '@ant-design/icons';
import { useCreativeStore } from '../../../stores/creativeStore';
import { useLogStore } from '../../../stores/logStore';
import { formatCharacterCardV3, downloadCharacterCardPNG, downloadFile } from '../utils/exportFormatters';
import type { CharacterCardV3 } from '../utils/exportFormatters';

const { Title, Text } = Typography;

interface CharacterCardExportProps {
  creativeId: string;
}

const CharacterCardExport: React.FC<CharacterCardExportProps> = ({ creativeId }) => {
  const { creatives, updateCharacterCard } = useCreativeStore();
  const { addLog } = useLogStore();

  const [exportFormat, setExportFormat] = useState<'png' | 'json'>('png');
  const [isExporting, setIsExporting] = useState(false);

  const creative = creatives.find(c => c.id === creativeId);
  const selectedCharacter = creative?.characterCard || null;

  const handleExport = async () => {
    if (!selectedCharacter) {
      message.warning('请选择一个角色卡');
      return;
    }

    setIsExporting(true);

    try {
      const cardV3 = formatCharacterCardV3(
        selectedCharacter.name || 'Unknown Character',
        selectedCharacter.content || '',
        selectedCharacter.tags || []
      );

      if (exportFormat === 'png') {
        downloadCharacterCardPNG(cardV3, selectedCharacter.name || 'character_card');
      } else {
        downloadFile(
          `${selectedCharacter.name || 'character_card'}.json`,
          JSON.stringify(cardV3, null, 2)
        );
      }

      message.success('导出成功');
      addLog('[FormatExport] 角色卡导出成功', 'info', {
        category: 'creative',
        context: {
          characterName: selectedCharacter.name,
          exportFormat
        }
      });
    } catch (error) {
      message.error('导出失败');
      addLog('[FormatExport] 角色卡导出失败', 'error', {
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
          <Text strong>当前角色卡</Text>
          <div style={{ marginTop: 8 }}>
            <Text>{selectedCharacter?.name || '未设置角色卡'}</Text>
          </div>
        </div>

        <div>
          <Text strong>导出格式</Text>
          <Select
            value={exportFormat}
            onChange={setExportFormat}
            style={{ width: '100%', marginTop: 8 }}
            options={[
              { label: 'PNG (包含嵌入JSON)', value: 'png' },
              { label: 'JSON (纯数据)', value: 'json' }
            ]}
          />
        </div>

        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          loading={isExporting}
          disabled={!selectedCharacter}
          size="large"
        >
          导出角色卡
        </Button>

        {selectedCharacter && (
          <Card title="预览" size="small">
            <Text strong>名称：</Text>
            <Text>{selectedCharacter.name}</Text>
            <br />
            <Text strong>内容：</Text>
            <div style={{ maxHeight: 150, overflow: 'auto', marginTop: 8 }}>
              <Text type="secondary">{selectedCharacter.content?.substring(0, 500)}...</Text>
            </div>
          </Card>
        )}
      </Space>
    </div>
  );
};

export default CharacterCardExport;
