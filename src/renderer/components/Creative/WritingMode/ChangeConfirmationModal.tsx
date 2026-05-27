import React from 'react';
import { Modal, Alert, List, Tag, Space, Typography, Button } from 'antd';
import { WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { OutlineImpactAnalysis } from '../../../../shared/types/writing.types';
import { ImpactDetail } from '../../../utils/ImpactAnalyzer';

const { Text } = Typography;

interface ChangeConfirmationModalProps {
  visible: boolean;
  impact: OutlineImpactAnalysis | null;
  affectedDetails: ImpactDetail[];
  onConfirm: (action: 'save_only' | 'save_and_mark') => void;
  onCancel: () => void;
}

const severityConfig = {
  low: { color: 'blue', icon: <InfoCircleOutlined />, label: '低影响' },
  medium: { color: 'orange', icon: <WarningOutlined />, label: '中等影响' },
  high: { color: 'red', icon: <WarningOutlined />, label: '高影响' },
};

const ChangeConfirmationModal: React.FC<ChangeConfirmationModalProps> = ({
  visible,
  impact,
  affectedDetails,
  onConfirm,
  onCancel,
}) => {
  if (!impact) return null;

  const severity = severityConfig[impact.severity];

  const alertMessage = `检测到 ${impact.affectedChapters.length} 个章节可能受到此变更影响`;

  return (
    <Modal
      title="变更影响确认"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={600}
    >
      <Alert
        message={alertMessage}
        description={impact.description}
        type={impact.severity === 'high' ? 'error' : impact.severity === 'medium' ? 'warning' : 'info'}
        icon={severity.icon}
        showIcon
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 16 }}>
        <Space>
          <Text strong>影响程度:</Text>
          <Tag color={severity.color}>{severity.label}</Tag>
        </Space>
      </div>

      {impact.affectedChapters.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            受影响章节:
          </Text>
          <List
            size="small"
            dataSource={impact.affectedChapters.map(idx => ({
              index: idx,
              chapter: `第 ${idx + 1} 章`,
            }))}
            renderItem={item => (
              <List.Item>
                <Space>
                  <Tag color={severity.color}>{item.chapter}</Tag>
                  {affectedDetails.length > 0 && affectedDetails[item.index] && (
                    <Text type="secondary">
                      {affectedDetails[item.index].reason}
                    </Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}

      {impact.affectedCharacters.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            受影响角色:
          </Text>
          <Space wrap>
            {impact.affectedCharacters.map(char => (
              <Tag key={char} color="purple">{char}</Tag>
            ))}
          </Space>
        </div>
      )}

      {impact.affectedWorldSettings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            受影响世界观设定:
          </Text>
          <Space wrap>
            {impact.affectedWorldSettings.map(setting => (
              <Tag key={setting} color="green">{setting}</Tag>
            ))}
          </Space>
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>
          取消
        </Button>
        <Button onClick={() => onConfirm('save_only')}>
          仅保存设定
        </Button>
        <Button
          type="primary"
          onClick={() => onConfirm('save_and_mark')}
        >
          保存并标记受影响章节
        </Button>
      </div>
    </Modal>
  );
};

export default ChangeConfirmationModal;
