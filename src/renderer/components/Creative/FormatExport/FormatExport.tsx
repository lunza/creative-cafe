import React, { useState } from 'react';
import { Button, Space, Typography, Modal, Card, Divider, Tabs } from 'antd';
import { DownloadOutlined, FileImageOutlined, FileTextOutlined, EyeOutlined } from '@ant-design/icons';
import CharacterCardExport from './CharacterCardExport';
import WorldBookExport from './WorldBookExport';

const { Title, Text } = Typography;

interface FormatExportProps {
  creativeId: string | null;
}

const FormatExport: React.FC<FormatExportProps> = ({ creativeId }) => {
  const [activeTab, setActiveTab] = useState('character');

  if (!creativeId) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Text type="secondary">请先选择一个创意以进行导出</Text>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Title level={5}>导出选项</Title>
      <Divider />
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'character',
            label: <><FileImageOutlined /> 角色卡V3</>,
            children: <CharacterCardExport creativeId={creativeId} />
          },
          {
            key: 'worldbook',
            label: <><FileTextOutlined /> 世界书JSON</>,
            children: <WorldBookExport creativeId={creativeId} />
          }
        ]}
      />
    </div>
  );
};

export default FormatExport;
