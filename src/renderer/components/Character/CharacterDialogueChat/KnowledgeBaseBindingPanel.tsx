import React, { useState, useEffect, useCallback } from 'react';
import { Button, Select, Empty, Tag, Tooltip, Spin, Space } from 'antd';
import { DatabaseOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import './ConfigPanel.css';

const { Option } = Select;

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
      console.log('Fetched scopes result:', result);
      
      const scopes = result?.scopes || result || [];
      if (!Array.isArray(scopes)) {
        throw new Error('获取到的知识库数据格式不正确');
      }
      
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
  }, [fetchKnowledgeBases]);

  useEffect(() => {
    if (!characterCardId) return;
    
    const loadSavedBindings = async () => {
      try {
        const saved = await window.electronAPI.characterConfig.load(characterCardId);
        if (saved && saved.boundKnowledgeBaseIds) {
          const validIds = saved.boundKnowledgeBaseIds.filter(id => 
            knowledgeBases.some(kb => kb.id === id)
          );
          if (validIds.length !== saved.boundKnowledgeBaseIds.length) {
            console.log('Some saved knowledge base IDs are no longer valid, filtering them out');
          }
          validIds.forEach(id => {
            if (!boundKnowledgeBaseIds.includes(id)) {
              onBindKnowledgeBase(id);
            }
          });
        }
      } catch (error) {
        console.error('Failed to load saved knowledge base bindings:', error);
      }
    };

    if (knowledgeBases.length > 0) {
      loadSavedBindings();
    }
  }, [characterCardId, knowledgeBases, boundKnowledgeBaseIds, onBindKnowledgeBase]);

  const handleSelectChange = useCallback((values: string[]) => {
    const currentIds = new Set(boundKnowledgeBaseIds);
    const newIds = new Set(values);
    
    const toBind = values.filter(id => !currentIds.has(id));
    const toUnbind = boundKnowledgeBaseIds.filter(id => !newIds.has(id));
    
    toBind.forEach(id => onBindKnowledgeBase(id));
    toUnbind.forEach(id => onUnbindKnowledgeBase(id));
  }, [boundKnowledgeBaseIds, onBindKnowledgeBase, onUnbindKnowledgeBase]);

  const getSelectedNames = useCallback(() => {
    return knowledgeBases
      .filter(kb => boundKnowledgeBaseIds.includes(kb.id))
      .map(kb => kb.documentName);
  }, [knowledgeBases, boundKnowledgeBaseIds]);

  const getSourceTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      worldbook: '世界书',
      knowledge: '知识库',
      manual_knowledge: '手动知识库',
      character_chat: '角色对话',
    };
    return labels[type] || type;
  };

  const getSourceTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      worldbook: '#a855f7',
      knowledge: '#3b82f6',
      manual_knowledge: '#22c55e',
      character_chat: '#f59e0b',
    };
    return colors[type] || '#94a3b8';
  };

  const renderOptionLabel = (item: KnowledgeBaseItem) => (
    <Space className="kb-select-option">
      <span className="kb-option-name">{item.documentName}</span>
      <span className="kb-option-count">{item.vectorCount} 向量</span>
      <Tag color={getSourceTypeColor(item.sourceType)} style={{ fontSize: '10px', padding: '0 4px' }}>
        {getSourceTypeLabel(item.sourceType)}
      </Tag>
    </Space>
  );

  return (
    <div className="knowledge-base-panel">
      <div className="knowledge-base-panel-header">
        <div className="knowledge-base-panel-title">
          <DatabaseOutlined className="knowledge-base-icon" />
          <span>知识库绑定</span>
          {boundKnowledgeBaseIds.length > 0 && (
            <Tag color="success" className="knowledge-base-count-tag">
              {boundKnowledgeBaseIds.length}
            </Tag>
          )}
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
