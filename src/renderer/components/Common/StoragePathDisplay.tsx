import React from 'react';
import { Typography, Tooltip } from 'antd';
import { FolderOpenOutlined, CopyOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface StoragePathDisplayProps {
  label: string;
  path: string;
  onOpenFolder: () => void;
  onCopyPath?: () => void;
}

export const StoragePathDisplay: React.FC<StoragePathDisplayProps> = ({
  label,
  path,
  onOpenFolder,
  onCopyPath,
}) => {
  return (
    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <Text type="secondary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{label}:</Text>
      <Tooltip title="点击打开文件夹">
        <Text
          type="secondary"
          style={{
            cursor: 'pointer',
            color: '#1890ff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          onClick={onOpenFolder}
        >
          {path || '加载中...'}
        </Text>
      </Tooltip>
      <FolderOpenOutlined
        style={{ cursor: 'pointer', color: '#1890ff', fontSize: 14, flexShrink: 0 }}
        onClick={onOpenFolder}
        title="打开文件夹"
      />
      {onCopyPath && (
        <CopyOutlined
          style={{ cursor: 'pointer', color: '#8c8c8c', fontSize: 14, flexShrink: 0 }}
          onClick={onCopyPath}
          title="复制路径"
        />
      )}
    </div>
  );
};
