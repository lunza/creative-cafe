import React, { useEffect, useState } from 'react';
import { Select, Space, Tag, Tooltip, Spin, Empty, Button, Badge } from 'antd';
import { FilterOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons';
import { useVectorStore, type VectorScope } from '../../stores/vectorStore';

interface VectorScopeSelectorProps {
  value?: string[];
  onChange?: (scopeIds: string[]) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}

export const VectorScopeSelector: React.FC<VectorScopeSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className,
  style,
  placeholder = '选择查询范围',
}) => {
  const { 
    availableScopes, 
    selectedScopes, 
    scopesLoading,
    getAvailableScopes, 
    setSelectedScopes,
    toggleScope 
  } = useVectorStore();

  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 获取最新的可用范围
  const fetchLatestScopes = async () => {
    setLoading(true);
    try {
      await getAvailableScopes();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialized) {
      fetchLatestScopes().then(() => {
        setInitialized(true);
      });
    }
  }, [getAvailableScopes, initialized]);

  // 当下拉框打开时，异步刷新可用范围列表（不阻塞下拉框显示）
  const handleDropdownVisibleChange = async (open: boolean) => {
    if (open) {
      // 使用 setTimeout 避免阻塞下拉框渲染
      setTimeout(async () => {
        try {
          await getAvailableScopes();
        } catch (err) {
          console.error('[VectorScopeSelector] Failed to refresh scopes:', err);
        }
      }, 0);
    }
  };

  const handleScopeChange = (selectedValues: string[]) => {
    setSelectedScopes(selectedValues);
    onChange?.(selectedValues);
  };

  const handleToggleAll = () => {
    if (selectedScopes.length === availableScopes.length) {
      handleScopeChange([]);
    } else {
      handleScopeChange(availableScopes.map(s => s.id));
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    await getAvailableScopes();
    setLoading(false);
  };

  const selectedScopesData = availableScopes.filter(s => selectedScopes.includes(s.id));

  const options = availableScopes.map(scope => ({
    label: (
      <Space>
        <span>{scope.sourceName}</span>
        <Badge count={scope.vectorCount} style={{ backgroundColor: '#722ed1' }} size="small" />
        <Tag color="blue">{scope.sourceType}</Tag>
      </Space>
    ),
    value: scope.id,
    description: scope.description,
  }));

  const tagRender = (props: { label: React.ReactNode; value: string; onClose: () => void; closable: boolean }) => {
    const { label, value: tagValue, onClose, closable } = props;
    const scope = availableScopes.find(s => s.id === tagValue);
    
    return (
      <Tag
        closable={closable && !disabled}
        onClose={(e) => {
          e.preventDefault();
          onClose();
        }}
        color="purple"
        style={{ marginRight: 4, marginBottom: 4 }}
      >
        {scope ? (
          <Space size={2}>
            <span>{scope.sourceName}</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>({scope.vectorCount})</span>
          </Space>
        ) : (
          label
        )}
      </Tag>
    );
  };

  return (
    <div className={className} style={style}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space>
          <FilterOutlined />
          <span style={{ fontWeight: 500 }}>查询范围</span>
          {selectedScopes.length > 0 && (
            <Tag color="purple">{selectedScopes.length} 个范围</Tag>
          )}
        </Space>
        <Space size="small">
          <Button 
            type="link" 
            size="small" 
            icon={<ReloadOutlined spin={loading} />} 
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
          {availableScopes.length > 0 && (
            <Button 
              type="link" 
              size="small" 
              icon={selectedScopes.length === availableScopes.length ? <CheckOutlined /> : undefined}
              onClick={handleToggleAll}
              disabled={disabled}
            >
              {selectedScopes.length === availableScopes.length ? '取消全选' : '全选'}
            </Button>
          )}
        </Space>
      </div>

      <>
        <Select
          mode="multiple"
          allowClear
          placeholder={placeholder}
          value={value ?? selectedScopes}
          onChange={handleScopeChange}
          options={options}
          disabled={disabled || (availableScopes.length === 0 && !loading && !scopesLoading)}
          tagRender={tagRender}
          maxTagCount="responsive"
          optionFilterProp="label"
          style={{ width: '100%' }}
          size="middle"
          onDropdownVisibleChange={handleDropdownVisibleChange}
          dropdownRender={availableScopes.length === 0 ? (menu) => (
            <div style={{ padding: '16px', textAlign: 'center', color: '#999' }}>
              暂无可用的查询范围，请先完成向量化
            </div>
          ) : undefined}
        />
        
        {selectedScopesData.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
            总计 {selectedScopesData.reduce((sum, s) => sum + s.vectorCount, 0)} 条向量数据
          </div>
        )}
      </>
    </div>
  );
};

export const VectorScopeTag: React.FC<{ scopeId: string }> = ({ scopeId }) => {
  const { availableScopes } = useVectorStore();
  const scope = availableScopes.find(s => s.id === scopeId);

  if (!scope) {
    return <Tag color="default">未知范围</Tag>;
  }

  return (
    <Tooltip title={`${scope.sourceType}: ${scope.sourceName} (${scope.vectorCount} 条)`}>
      <Tag color="purple">{scope.sourceName}</Tag>
    </Tooltip>
  );
};
