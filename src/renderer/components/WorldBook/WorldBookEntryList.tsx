import React from 'react';
import { Card, Button, Tag, Pagination, Modal, Space } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  TagOutlined,
  LoadingOutlined,
  StopOutlined
} from '@ant-design/icons';

interface WorldBookEntryListProps {
  worldBookContent: any;
  expandedEntries: Set<number | string>;
  selectedEntries: Set<number | string>;
  currentPage: number;
  pageSize: number;
  tags: any[];
  associations: any[];
  generatingKeywordsUid: string | number | null;
  onToggleExpand: (uid: number | string) => void;
  onToggleSelect: (uid: number | string) => void;
  onSelectAll: (checked: boolean) => void;
  onPageChange: (page: number, pageSize?: number) => void;
  onEditEntry: (entry: any, uid: number | string) => void;
  onDeleteEntry: (uid: number | string) => void;
  onGenerateKeywords: (uid: string | number) => void;
  onEditEntryTags: (uid: number | string) => void;
  onCancelAIRequest?: () => void;
}

const WorldBookEntryList: React.FC<WorldBookEntryListProps> = ({
  worldBookContent,
  expandedEntries,
  selectedEntries,
  currentPage,
  pageSize,
  tags,
  associations,
  generatingKeywordsUid,
  onToggleExpand,
  onToggleSelect,
  onSelectAll,
  onPageChange,
  onEditEntry,
  onDeleteEntry,
  onGenerateKeywords,
  onEditEntryTags,
  onCancelAIRequest
}) => {
  const displayedProps = ['uid', 'key', 'keysecondary', 'comment', 'content', 'constant', 'selective', 'order', 'position', 'disable', 'displayIndex', 'addMemo', 'group', 'groupOverride', 'groupWeight', 'sticky', 'cooldown', 'delay', 'probability', 'depth', 'useProbability', 'role', 'excludeRecursion', 'preventRecursion', 'delayUntilRecursion', 'scanDepth', 'caseSensitive', 'matchWholeWords', 'useGroupScoring', 'automationId'];

  const entries = Object.values(worldBookContent.entries);
  const totalEntries = entries.length;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentPageEntries = entries.slice(startIndex, endIndex);

  const entriesWithTags = currentPageEntries.map((entry: any, index: number) => {
    const uid = entry.uid !== undefined ? entry.uid : (startIndex + index);
    const entryTags = associations
      .filter(assoc => assoc.entryUid === uid)
      .map(assoc => tags.find(tag => tag.id === assoc.tagId))
      .filter((tag): tag is any => tag !== undefined);
    return { ...entry, uid, tags: entryTags };
  });

  const groupedEntries: Record<string, typeof entriesWithTags> = {};
  const processedEntries = new Set<number>();

  entriesWithTags.forEach(entry => {
    const uid = entry.uid;
    if (processedEntries.has(uid)) return;

    if (entry.tags && entry.tags.length > 0) {
      const firstTag = entry.tags[0];
      if (!groupedEntries[firstTag.id]) {
        groupedEntries[firstTag.id] = [];
      }
      groupedEntries[firstTag.id].push(entry);
    } else {
      if (!groupedEntries['无标签']) {
        groupedEntries['无标签'] = [];
      }
      groupedEntries['无标签'].push(entry);
    }
    processedEntries.add(uid);
  });

  const sortedTagIds = Object.keys(groupedEntries);

  const isAllSelected = currentPageEntries.every((entry: any, index: number) => {
    const uid = entry.uid !== undefined ? entry.uid : (startIndex + index);
    return selectedEntries.has(uid);
  });

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="checkbox"
          checked={isAllSelected && currentPageEntries.length > 0}
          onChange={(e) => {
            if (e.target.checked) {
              const allUids = currentPageEntries.map((entry: any, index: number) => 
                entry.uid !== undefined ? entry.uid : (startIndex + index)
              );
              onSelectAll(true);
            } else {
              onSelectAll(false);
            }
          }}
          style={{ transform: 'scale(1.2)' }}
        />
        <span style={{ fontWeight: 'bold' }}>全选</span>
        <span style={{ color: 'var(--text-secondary, #8c8c8c)' }}>已选择 {selectedEntries.size} 个条目</span>
      </div>

      {sortedTagIds.map(tagId => {
        const tag = tags.find(t => t.id === tagId);
        const tagName = tag ? tag.name : '无标签';
        const tagColor = tag ? tag.color : 'default';
        const groupEntries = groupedEntries[tagId];

        return (
          <div key={tagId} style={{ marginBottom: 24 }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: '2px solid var(--border-base, #333)'
            }}>
              <Tag color={tagColor} style={{ fontSize: 16, padding: '4px 12px', marginRight: 8 }}>{tagName}</Tag>
              <span style={{ color: 'var(--text-secondary, #8c8c8c)', fontSize: 14 }}>共 {groupEntries.length} 个条目</span>
            </div>
            {groupEntries.map((entry: any) => {
              const uid = entry.uid;
              const isExpanded = expandedEntries.has(uid);
              const additionalProps = Object.entries(entry).filter(([key]) => !displayedProps.includes(key));

              return (
                <Card key={uid} style={{ marginBottom: 16, border: '1px solid var(--border-base, #333)', backgroundColor: 'var(--bg-elevated, #2a2a2a)', color: 'var(--text-primary, #ffffff)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(uid)}
                        onChange={() => onToggleSelect(uid)}
                        style={{ transform: 'scale(1.2)' }}
                      />
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 'bold' }}>条目 {entry.uid}: {entry.comment || '无注释'}</h3>
                    </div>
                  </div>
                  <div style={{ color: 'var(--text-color, #000)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <strong>关键词:</strong> {entry.key?.join(', ') || '无'}
                      </div>
                      {generatingKeywordsUid === uid ? (
                        <Button 
                          type="link" 
                          size="small"
                          danger
                          icon={<StopOutlined />}
                          onClick={onCancelAIRequest}
                        >
                          中断
                        </Button>
                      ) : (
                        <Button 
                          type="link" 
                          size="small"
                          icon={<TagOutlined />}
                          onClick={() => onGenerateKeywords(uid)}
                        >
                          AI生成关键词
                        </Button>
                      )}
                    </div>
                    {entry.keysecondary && entry.keysecondary.length > 0 && (
                      <p style={{ marginBottom: 8 }}>
                        <strong>次要关键词:</strong> {entry.keysecondary.join(', ')}
                      </p>
                    )}
                    <p style={{ marginBottom: 8 }}>
                      <strong>内容:</strong>
                    </p>
                    <div style={{ 
                      padding: 12, 
                      backgroundColor: 'var(--bg-elevated, #2a2a2a)', 
                      color: 'var(--text-primary, #ffffff)',
                      borderRadius: 4, 
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'monospace'
                    }}>
                      {entry.content || '无'}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <Tag color="blue">顺序: {entry.order}</Tag>
                      <Tag color="green">概率: {entry.probability}%</Tag>
                      <Tag color="orange">深度: {entry.depth}</Tag>
                      <Tag color="cyan">位置: {entry.position}</Tag>
                      {entry.constant && <Tag color="red">常量</Tag>}
                      {entry.selective && <Tag color="purple">选择性</Tag>}
                      {entry.disable && <Tag color="gray">禁用</Tag>}
                      {entry.addMemo && <Tag color="geekblue">添加到记忆</Tag>}
                    </div>
                    <div style={{ marginTop: 8, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontWeight: 'bold' }}>标签:</span>
                        <Button 
                          type="link" 
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => onEditEntryTags(uid)}
                        >
                          编辑标签
                        </Button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {entry.tags && entry.tags.length > 0 ? (
                          entry.tags.map((tag: any) => (
                            <Tag key={tag.id} color={tag.color}>{tag.name}</Tag>
                          ))
                        ) : (
                          <Tag color="default">无标签</Tag>
                        )}
                      </div>
                    </div>
                    {additionalProps.length > 0 && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color, #e8e8e8)', paddingTop: 12 }}>
                        <Button 
                          type="link" 
                          onClick={() => onToggleExpand(uid)}
                          style={{ padding: 0, height: 'auto' }}
                        >
                          {isExpanded ? '收起 ▲' : '更多 ▼'}
                        </Button>
                        {isExpanded && (
                          <div style={{ 
                            marginTop: 12,
                            padding: 16, 
                            backgroundColor: 'var(--bg-color, #fafafa)', 
                            color: 'var(--text-color, #000)',
                            borderRadius: 8,
                            border: '1px solid var(--border-color, #e8e8e8)'
                          }}>
                            <p style={{ marginBottom: 12, fontWeight: 'bold', color: 'var(--text-color, #333)', fontSize: 14 }}>更多属性:</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {additionalProps.map(([key, value]) => {
                                const getDisplayName = (propKey: string): string => {
                                  return propKey
                                    .replace(/([A-Z])/g, ' $1')
                                    .replace(/^./, str => str.toUpperCase())
                                    .trim();
                                };
                                const displayName = getDisplayName(key);
                                return (
                                  <div key={key} style={{ 
                                    display: 'flex', 
                                    alignItems: 'flex-start',
                                    padding: '8px 12px',
                                    backgroundColor: 'var(--card-bg-color, #fff)', 
                                    color: 'var(--text-color, #000)',
                                    borderRadius: 6,
                                    border: '1px solid var(--border-color, #f0f0f0)'
                                  }}>
                                    <span style={{ 
                                      fontWeight: 'bold', 
                                      color: 'var(--primary-color, #1890ff)',
                                      minWidth: 120,
                                      marginRight: 12,
                                      flexShrink: 0
                                    }}>{displayName}:</span>
                                    <span style={{ 
                                      color: 'var(--text-color, #666)',
                                      wordBreak: 'break-all',
                                      fontFamily: 'monospace',
                                      fontSize: 13
                                    }}>{JSON.stringify(value)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 12, textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Button 
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          Modal.confirm({
                            title: '确定要删除这个条目吗？',
                            onOk: () => onDeleteEntry(uid),
                            okText: '确定',
                            cancelText: '取消'
                          });
                        }}
                        size="small"
                      >
                        删除条目
                      </Button>
                      <Button 
                        type="primary" 
                        icon={<EditOutlined />}
                        onClick={() => onEditEntry(entry, uid)}
                        size="small"
                      >
                        编辑条目
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        );
      })}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-color, #e8e8e8)' }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={totalEntries}
          showSizeChanger
          pageSizeOptions={['10', '20', '50', '100']}
          showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`}
          onChange={onPageChange}
          style={{ color: 'var(--text-color, #000)' }}
        />
      </div>
    </div>
  );
};

export default WorldBookEntryList;
