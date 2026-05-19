import React, { useCallback, useMemo } from 'react';
import { List, Avatar, Checkbox, Tag, Tooltip, Empty, Typography } from 'antd';
import { CheckOutlined, GlobalOutlined, IdcardOutlined, UserOutlined, BookOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { MaterialItem, MaterialType } from '../../../shared/types/writing.types';

const { Text } = Typography;

const MATERIAL_ICONS: Record<MaterialType, React.ReactNode> = {
  worldbook: <GlobalOutlined />,
  character: <IdcardOutlined />,
  persona: <UserOutlined />,
  knowledge: <BookOutlined />,
};

const MATERIAL_TAG_COLORS: Record<MaterialType, string> = {
  worldbook: 'blue',
  character: 'green',
  persona: 'purple',
  knowledge: 'orange',
};

const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  worldbook: '世界书',
  character: '角色卡',
  persona: '用户人设',
  knowledge: '知识库',
};

interface MaterialListProps {
  materials: MaterialItem[];
  loading: boolean;
  onToggle: (type: MaterialType, id: string) => void;
  type: MaterialType;
  emptyText?: string;
}

const MaterialList: React.FC<MaterialListProps> = ({ materials, loading, onToggle, type, emptyText }) => {
  const { token } = theme.useToken();

  const handleToggle = useCallback(
    (id: string) => {
      onToggle(type, id);
    },
    [onToggle, type]
  );

  const selectedCount = useMemo(
    () => materials.filter((m) => m.isSelected).length,
    [materials]
  );

  if (!loading && materials.length === 0) {
    return (
      <Empty
        description={emptyText || `暂无${MATERIAL_TYPE_LABELS[type]}`}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ padding: '24px 0' }}
      />
    );
  }

  return (
    <div>
      {selectedCount > 0 && (
        <div style={{ marginBottom: 8, padding: '4px 0' }}>
          <Tag color={MATERIAL_TAG_COLORS[type]}>
            已选 {selectedCount}/{materials.length}
          </Tag>
        </div>
      )}
      <List
        dataSource={materials}
        loading={loading}
        renderItem={(item: MaterialItem) => (
          <List.Item
            onClick={() => handleToggle(item.id)}
            style={{
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: 6,
              cursor: 'pointer',
              background: item.isSelected ? token.colorPrimaryBg : 'transparent',
              border: `1px solid ${item.isSelected ? token.colorPrimaryBorder : 'transparent'}`,
              transition: 'all 0.2s',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 12 }}>
              <div style={{ paddingTop: 2, flexShrink: 0 }}>
                <Checkbox
                  checked={item.isSelected}
                  onChange={() => handleToggle(item.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <Avatar
                size="small"
                icon={MATERIAL_ICONS[item.type]}
                style={{
                  backgroundColor: item.isSelected
                    ? token.colorPrimary
                    : token.colorFillSecondary,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Text
                    strong
                    style={{
                      fontSize: 13,
                      color: item.isSelected ? token.colorPrimary : token.colorText,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </Text>
                  {item.isSelected && (
                    <CheckOutlined
                      style={{ fontSize: 10, color: token.colorPrimary }}
                    />
                  )}
                </div>
                {item.description && (
                  <Tooltip title={item.description}>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                      }}
                    >
                      {item.description}
                    </Text>
                  </Tooltip>
                )}
              </div>
            </div>
          </List.Item>
        )}
        locale={{
          emptyText: emptyText || `暂无${MATERIAL_TYPE_LABELS[type]}`,
        }}
      />
    </div>
  );
};

export default MaterialList;
