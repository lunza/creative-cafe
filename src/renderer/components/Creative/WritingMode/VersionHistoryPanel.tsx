import React from 'react';
import { Drawer, Button, Tag, Modal, Typography, Empty, Space, Timeline } from 'antd';
import { theme } from 'antd';
import { ClockCircleOutlined, UndoOutlined, DiffOutlined, CheckOutlined } from '@ant-design/icons';
import { OutlineVersion } from '../../../../shared/types/writing.types';
import { formatTimestamp, getSourceLabel, getSourceColor } from '../../../utils/outlineVersionUtils';

const { Text } = Typography;

interface VersionHistoryPanelProps {
  visible: boolean;
  versions: OutlineVersion[];
  currentVersionId: string;
  onRestore: (versionId: string) => void;
  onCompare: (versionId: string) => void;
  onClose: () => void;
}

const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
  visible,
  versions,
  currentVersionId,
  onRestore,
  onCompare,
  onClose,
}) => {
  const { token } = theme.useToken();

  const sortedVersions = [...versions].sort((a, b) => b.timestamp - a.timestamp);

  const handleRestore = (versionId: string) => {
    Modal.confirm({
      title: '恢复版本',
      content: '恢复此版本将覆盖当前大纲，是否继续？',
      okText: '确认恢复',
      cancelText: '取消',
      onOk: () => onRestore(versionId),
    });
  };

  if (versions.length === 0) {
    return (
      <Drawer
        title="版本历史"
        placement="right"
        width={400}
        onClose={onClose}
        open={visible}
      >
        <Empty description="暂无版本历史" />
      </Drawer>
    );
  }

  return (
    <Drawer
      title="版本历史"
      placement="right"
      width={450}
      onClose={onClose}
      open={visible}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: '16px 24px' }}>
        <Timeline
          items={sortedVersions.map(version => ({
            dot: version.isCurrent ? (
              <CheckOutlined style={{ color: token.colorSuccess }} />
            ) : (
              <ClockCircleOutlined style={{ color: token.colorTextTertiary }} />
            ),
            children: (
              <div
                style={{
                  background: version.id === currentVersionId
                    ? token.colorSuccessBg
                    : 'transparent',
                  padding: '12px',
                  borderRadius: token.borderRadiusLG,
                  marginBottom: '8px',
                  border: `1px solid ${version.id === currentVersionId ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ fontSize: '14px' }}>
                      {formatTimestamp(version.timestamp)}
                    </Text>
                    {version.id === currentVersionId && (
                      <Tag color="success" style={{ marginLeft: '8px' }}>
                        当前版本
                      </Tag>
                    )}
                  </div>
                </div>

                <Space style={{ marginBottom: '8px' }} size="small">
                  <Tag color={getSourceColor(version.source)}>
                    {getSourceLabel(version.source)}
                  </Tag>
                </Space>

                {version.note && (
                  <Text type="secondary" style={{ display: 'block', marginBottom: '8px', fontSize: '12px' }}>
                    {version.note}
                  </Text>
                )}

                <Space size="small">
                  {version.id !== currentVersionId && (
                    <>
                      <Button
                        size="small"
                        icon={<UndoOutlined />}
                        onClick={() => handleRestore(version.id)}
                      >
                        恢复
                      </Button>
                      <Button
                        size="small"
                        icon={<DiffOutlined />}
                        onClick={() => onCompare(version.id)}
                      >
                        比较
                      </Button>
                    </>
                  )}
                </Space>
              </div>
            ),
          }))}
        />
      </div>
    </Drawer>
  );
};

export default VersionHistoryPanel;
