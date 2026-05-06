import React, { useState, useEffect, useCallback } from 'react';
import { Button, Select, Empty, Tag, Tooltip, Spin, Space } from 'antd';
import { DatabaseOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import './ConfigPanel.css';

export interface KnowledgeBaseItem {
  id: string;
  documentId: string;
  documentName: string;
  sourceType: string;
  vectorCount: number;
  description?: string;
}

interface KnowledgeBaseBindingPanelProps {
  characterCardId: string;
  boundKnowledgeBaseIds: string[];
  onBindKnowledgeBase: (documentId: string) => void;
  onUnbindKnowledgeBase: (documentId: string) => void;
}

const { Option } = Select;

const KnowledgeBaseBindingPanel: React.FC<KnowledgeBaseBindingPanelProps> = ({
  characterCardId,
  boundKnowledgeBaseIds,
  onBindKnowledgeBase,
  onUnbindKnowledgeBase,
}) => {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKnowledgeBases = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.vector.getAvailableScopes();
      console.log('Fetched vector scopes result:', result);
      
      // API 返回格式为 { success: boolean, scopes: Array }
      if (!result || !result.success || !Array.isArray(result.scopes)) {
        setKnowledgeBases([]);
        setError('获取到的数据格式不正确');
        return;
      }
      
      const scopes = result.scopes;
      console.log('Available scopes:', scopes);
      
      // 过滤出所有可绑定的知识库类型
      // 支持的类型: knowledge(上传文件), manual_knowledge(手动知识), worldbook(世界书), character_chat(对话记录)
      const bindableTypes = ['knowledge', 'manual_knowledge', 'worldbook', 'character_chat'];
      const knowledgeBaseScopes = scopes.filter(scope => 
        bindableTypes.includes(scope.sourceType)
      );
      
      console.log('Filtered knowledge base scopes:', knowledgeBaseScopes);
      
      const items: KnowledgeBaseItem[] = knowledgeBaseScopes.map(scope => ({
        id: scope.id,
        documentId: scope.sourceId,
        documentName: scope.sourceName || scope.label || '未命名',
        sourceType: scope.sourceType,
        vectorCount: scope.vectorCount,
        description: scope.description,
      }));
      setKnowledgeBases(items);
    } catch (error) {
      console.error('Failed to fetch knowledge bases:', error);
      setError(`获取知识库列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setKnowledgeBases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKnowledgeBases();
  }, [characterCardId, fetchKnowledgeBases]);

  const getSourceTypeTagColor = (sourceType: string): string => {
    const colors: Record<string, string> = {
      knowledge: 'green',
      document: 'cyan',
      worldbook: 'blue',
      manual_knowledge: 'purple',
      character_chat: 'orange',
    };
    return colors[sourceType] || 'default';
  };

  const getSourceTypeName = (sourceType: string): string => {
    const typeNames: Record<string, string> = {
      knowledge: '知识文档',
      document: '文档',
      worldbook: '世界书',
      manual_knowledge: '手动知识',
      character_chat: '对话记录',
    };
    return typeNames[sourceType] || sourceType;
  };

  const handleSelectChange = useCallback((selectedIds: string[]) => {
    // 计算需要绑定的和需要解绑的
    const currentBoundSet = new Set(boundKnowledgeBaseIds);
    const selectedSet = new Set(selectedIds);
    
    // 需要绑定的（在选中的但不在已绑定的中）
    const toBind = selectedIds.filter(id => !currentBoundSet.has(id));
    // 需要解绑的（在已绑定的但不在选中的中）
    const toUnbind = boundKnowledgeBaseIds.filter(id => !selectedSet.has(id));
    
    // 执行绑定
    toBind.forEach(id => onBindKnowledgeBase(id));
    // 执行解绑
    toUnbind.forEach(id => onUnbindKnowledgeBase(id));
  }, [boundKnowledgeBaseIds, onBindKnowledgeBase, onUnbindKnowledgeBase]);

  const getSelectedNames = (): string[] => {
    return knowledgeBases
      .filter(item => boundKnowledgeBaseIds.includes(item.id))
      .map(item => item.documentName);
  };

  const renderOptionLabel = (item: KnowledgeBaseItem): React.ReactNode => {
    const sourceTypeName = getSourceTypeName(item.sourceType);
    const sourceTypeColor = getSourceTypeTagColor(item.sourceType);
    return (
      <div className="kb-select-option">
        <span className="kb-option-name">{item.documentName}</span>
        <Space size="small">
          <Tag size="small" color={sourceTypeColor}>{sourceTypeName}</Tag>
          <span className="kb-option-count">{item.vectorCount}条</span>
        </Space>
      </div>
    );
  };

  return (
    <div className="knowledge-base-panel">
      <div className="knowledge-base-panel-header">
        <div className="knowledge-base-panel-title">
          <DatabaseOutlined className="knowledge-base-icon" />
          <span>知识库绑定</span>
        </div>
        <div className="knowledge-base-panel-actions">
          <Tooltip
            title="绑定知识库后，角色在对话时会自动检索相关知识上下文"
            placement="top"
          >
            <InfoCircleOutlined className="knowledge-base-info-icon" />
          </Tooltip>
          <Tooltip title="刷新知识库列表">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchKnowledgeBases}
              loading={loading}
            />
          </Tooltip>
        </div>
      </div>

      <div className="knowledge-base-status">
        {boundKnowledgeBaseIds.length > 0 ? (
          <Tag color="success">
            已绑定 {boundKnowledgeBaseIds.length} 个知识库
          </Tag>
        ) : (
          <Tag color="default">未绑定知识库</Tag>
        )}
      </div>

      {loading ? (
        <div className="knowledge-base-loading">
          <Spin size="small" />
          <span>加载知识库列表...</span>
        </div>
      ) : error ? (
        <div className="knowledge-base-error">
          <InfoCircleOutlined className="error-icon" />
          <span>{error}</span>
        </div>
      ) : knowledgeBases.length === 0 ? (
        <div className="knowledge-base-empty">
          <Empty
            description={
              <span>
                暂无可用知识库
                <br />
                <small style={{ color: 'var(--text-secondary)' }}>
                  请先在知识库管理中上传文档
                </small>
              </span>
            }
          />
        </div>
      ) : (
        <div className="knowledge-base-select-wrapper">
          <Select
            mode="multiple"
            placeholder="选择要绑定的知识库"
            value={boundKnowledgeBaseIds}
            onChange={handleSelectChange}
            style={{ width: '100%' }}
            maxTagCount="responsive"
            dropdownMatchSelectWidth={false}
            dropdownClassName="knowledge-base-dropdown"
            allowClear
            optionFilterProp="children"
          >
            {knowledgeBases.map(item => (
              <Option key={item.id} value={item.id}>
                {renderOptionLabel(item)}
              </Option>
            ))}
          </Select>
          {boundKnowledgeBaseIds.length > 0 && (
            <div className="knowledge-base-bound-tags">
              {getSelectedNames().map(name => (
                <Tag key={name} color="blue" className="bound-tag">{name}</Tag>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="knowledge-base-hint">
        <InfoCircleOutlined className="hint-icon" />
        <span>
          绑定知识库后，角色在对话时会自动从绑定的知识库中检索相关上下文信息，
          帮助角色更好地理解和回应用户的问题。
        </span>
      </div>
    </div>
  );
};

export default KnowledgeBaseBindingPanel;