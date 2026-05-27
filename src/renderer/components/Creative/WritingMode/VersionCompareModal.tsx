import React from 'react';
import { Modal, Tabs, Typography, Tag, Card, Table, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DiffOutlined, PlusOutlined, MinusOutlined, EditOutlined } from '@ant-design/icons';
import { GeneratedOutline } from '../../../../shared/types/writing.types';
import { compareOutlines, OutlineDiff } from '../../../utils/outlineVersionUtils';

const { Text } = Typography;
const { TabPane } = Tabs;

interface VersionCompareModalProps {
  oldOutline: GeneratedOutline;
  newOutline: GeneratedOutline;
  visible: boolean;
  onClose: () => void;
}

const DiffText: React.FC<{ oldText: string; newText: string }> = ({ oldText, newText }) => {
  const { token } = theme.useToken();
  const hasDiff = oldText !== newText;

  if (!hasDiff) {
    return <Text>{newText}</Text>;
  }

  return (
    <div>
      <div style={{ backgroundColor: token.colorErrorBg, padding: '4px 8px', borderRadius: '4px', marginBottom: '4px' }}>
        <Text delete style={{ color: token.colorError }}>{oldText}</Text>
      </div>
      <div style={{ backgroundColor: token.colorSuccessBg, padding: '4px 8px', borderRadius: '4px' }}>
        <Text style={{ color: token.colorSuccess }}>{newText}</Text>
      </div>
    </div>
  );
};

const StorylineCompare: React.FC<{ diff: OutlineDiff; oldOutline: GeneratedOutline; newOutline: GeneratedOutline }> = ({
  diff,
  oldOutline,
  newOutline,
}) => {
  if (!diff.storyline.changed) {
    return <Text type="secondary">故事主线未发生变化</Text>;
  }

  const fields: { key: string; label: string }[] = [
    { key: 'coreConflict', label: '核心冲突' },
    { key: 'theme', label: '主题' },
  ];

  const storyArcFields: { key: keyof typeof oldOutline.storyLine.storyArc; label: string }[] = [
    { key: 'beginning', label: '起' },
    { key: 'development', label: '承' },
    { key: 'climax', label: '转' },
    { key: 'resolution', label: '合' },
  ];

  return (
    <div>
      {fields.map(({ key, label }) => {
        const diffItem = diff.storyline.differences.find(d => d.old === (oldOutline.storyLine as any)[key] && d.new === (newOutline.storyLine as any)[key]);
        if (!diffItem) return null;
        return (
          <div key={key} style={{ marginBottom: '16px' }}>
            <Text strong>{label}</Text>
            <div style={{ marginTop: '8px' }}>
              <DiffText oldText={diffItem.old} newText={diffItem.new} />
            </div>
          </div>
        );
      })}
      {storyArcFields.map(({ key, label }) => {
        const diffItem = diff.storyline.differences.find(d => d.old === oldOutline.storyLine.storyArc[key] && d.new === newOutline.storyLine.storyArc[key]);
        if (!diffItem) return null;
        return (
          <div key={key} style={{ marginBottom: '16px' }}>
            <Text strong>故事弧光 - {label}</Text>
            <div style={{ marginTop: '8px' }}>
              <DiffText oldText={diffItem.old} newText={diffItem.new} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ChaptersCompare: React.FC<{ diff: OutlineDiff; oldOutline: GeneratedOutline; newOutline: GeneratedOutline }> = ({
  diff,
  oldOutline,
  newOutline,
}) => {
  const { token } = theme.useToken();

  const columns: ColumnsType<{
    type: 'added' | 'removed' | 'modified';
    chapterIndex: number;
    title: string;
    changes?: { field: string; old: string; new: string }[];
  }> = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: '80px',
      render: (type: string) => {
        if (type === 'added') return <Tag color="green" icon={<PlusOutlined />}>新增</Tag>;
        if (type === 'removed') return <Tag color="red" icon={<MinusOutlined />}>删除</Tag>;
        return <Tag color="blue" icon={<EditOutlined />}>修改</Tag>;
      },
    },
    {
      title: '章节',
      dataIndex: 'chapterIndex',
      key: 'chapterIndex',
      width: '80px',
      render: (index: number) => `第${index}章`,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
    },
  ];

  const dataSource: Array<{
    type: 'added' | 'removed' | 'modified';
    chapterIndex: number;
    title: string;
    changes?: { field: string; old: string; new: string }[];
  }> = [];

  diff.chapters.added.forEach(index => {
    const chapter = newOutline.chapters.find(c => c.index === index);
    if (chapter) {
      dataSource.push({ type: 'added', chapterIndex: index, title: chapter.title });
    }
  });

  diff.chapters.removed.forEach(index => {
    const chapter = oldOutline.chapters.find(c => c.index === index);
    if (chapter) {
      dataSource.push({ type: 'removed', chapterIndex: index, title: chapter.title });
    }
  });

  diff.chapters.modified.forEach(mod => {
    const chapter = newOutline.chapters.find(c => c.index === mod.index);
    if (chapter) {
      dataSource.push({ type: 'modified', chapterIndex: mod.index, title: chapter.title, changes: mod.changes });
    }
  });

  if (dataSource.length === 0) {
    return <Text type="secondary">章节未发生变化</Text>;
  }

  return (
    <div>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey={(record) => `${record.type}-${record.chapterIndex}`}
        pagination={false}
        size="small"
        expandable={{
          expandedRowRender: (record) => {
            if (record.type !== 'modified' || !record.changes) return null;

            const fieldLabels: Record<string, string> = {
              title: '标题',
              summary: '摘要',
              keyPlotPoints: '关键情节',
              characters: '出场角色',
              scenes: '场景',
            };

            return (
              <div style={{ padding: '12px', backgroundColor: token.colorBgContainerDisabled }}>
                {record.changes.map((change, idx) => (
                  <div key={idx} style={{ marginBottom: '12px' }}>
                    <Text strong>{fieldLabels[change.field] || change.field}</Text>
                    <div style={{ marginTop: '4px' }}>
                      <DiffText oldText={change.old} newText={change.new} />
                    </div>
                  </div>
                ))}
              </div>
            );
          },
        }}
      />
    </div>
  );
};

const CharactersCompare: React.FC<{ diff: OutlineDiff; oldOutline: GeneratedOutline; newOutline: GeneratedOutline }> = ({
  diff,
  oldOutline,
  newOutline,
}) => {
  if (!diff.characters.changed) {
    return <Text type="secondary">角色关系未发生变化</Text>;
  }

  const oldNames = new Set(oldOutline.characterRelationships.map(c => c.name));
  const newNames = new Set(newOutline.characterRelationships.map(c => c.name));

  const added = newOutline.characterRelationships.filter(c => !oldNames.has(c.name));
  const removed = oldOutline.characterRelationships.filter(c => !newNames.has(c.name));
  const modified = oldOutline.characterRelationships.filter(oldChar => {
    const newChar = newOutline.characterRelationships.find(c => c.name === oldChar.name);
    return newChar && JSON.stringify(oldChar) !== JSON.stringify(newChar);
  });

  return (
    <div>
      {added.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Tag color="green" icon={<PlusOutlined />}>新增角色 ({added.length})</Tag>
          <div style={{ marginTop: '8px' }}>
            {added.map(char => (
              <Tag key={char.name} style={{ marginBottom: '4px' }}>{char.name} - {char.role}</Tag>
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Tag color="red" icon={<MinusOutlined />}>删除角色 ({removed.length})</Tag>
          <div style={{ marginTop: '8px' }}>
            {removed.map(char => (
              <Tag key={char.name} style={{ marginBottom: '4px' }}>{char.name} - {char.role}</Tag>
            ))}
          </div>
        </div>
      )}
      {modified.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Tag color="blue" icon={<EditOutlined />}>修改角色 ({modified.length})</Tag>
          <div style={{ marginTop: '8px' }}>
            {modified.map(char => (
              <Tag key={char.name} style={{ marginBottom: '4px' }}>{char.name}</Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const WorldbuildingCompare: React.FC<{ diff: OutlineDiff; oldOutline: GeneratedOutline; newOutline: GeneratedOutline }> = ({
  diff,
  oldOutline,
  newOutline,
}) => {
  if (!diff.worldbuilding.changed) {
    return <Text type="secondary">世界观设定未发生变化</Text>;
  }

  const oldCategories = new Set(oldOutline.worldbuildingNotes.map(w => w.category));
  const newCategories = new Set(newOutline.worldbuildingNotes.map(w => w.category));

  const added = newOutline.worldbuildingNotes.filter(w => !oldCategories.has(w.category));
  const removed = oldOutline.worldbuildingNotes.filter(w => !newCategories.has(w.category));
  const modified = oldOutline.worldbuildingNotes.filter(oldNote => {
    const newNote = newOutline.worldbuildingNotes.find(w => w.category === oldNote.category);
    return newNote && JSON.stringify(oldNote) !== JSON.stringify(newNote);
  });

  return (
    <div>
      {added.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Tag color="green" icon={<PlusOutlined />}>新增分类 ({added.length})</Tag>
          <div style={{ marginTop: '8px' }}>
            {added.map(note => (
              <Tag key={note.category} style={{ marginBottom: '4px' }}>{note.category} ({note.points.length} 条)</Tag>
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Tag color="red" icon={<MinusOutlined />}>删除分类 ({removed.length})</Tag>
          <div style={{ marginTop: '8px' }}>
            {removed.map(note => (
              <Tag key={note.category} style={{ marginBottom: '4px' }}>{note.category} ({note.points.length} 条)</Tag>
            ))}
          </div>
        </div>
      )}
      {modified.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Tag color="blue" icon={<EditOutlined />}>修改分类 ({modified.length})</Tag>
          <div style={{ marginTop: '8px' }}>
            {modified.map(note => (
              <Tag key={note.category} style={{ marginBottom: '4px' }}>{note.category}</Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const VersionCompareModal: React.FC<VersionCompareModalProps> = ({
  oldOutline,
  newOutline,
  visible,
  onClose,
}) => {
  const diff = compareOutlines(oldOutline, newOutline);

  const hasChanges =
    diff.storyline.changed ||
    diff.chapters.added.length > 0 ||
    diff.chapters.removed.length > 0 ||
    diff.chapters.modified.length > 0 ||
    diff.characters.changed ||
    diff.worldbuilding.changed;

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <DiffOutlined />
          <span>版本比较</span>
        </div>
      }
      open={visible}
      onCancel={onClose}
      width={900}
      footer={null}
    >
      {!hasChanges && (
        <div style={{ padding: '24px', textAlign: 'center' }}>
          <Text type="secondary">两个版本之间没有差异</Text>
        </div>
      )}
      {hasChanges && (
        <Tabs defaultActiveKey="storyline">
          <TabPane tab="故事主线" key="storyline">
            <Card size="small" style={{ minHeight: '300px' }}>
              <StorylineCompare diff={diff} oldOutline={oldOutline} newOutline={newOutline} />
            </Card>
          </TabPane>
          <TabPane tab="章节" key="chapters">
            <Card size="small" style={{ minHeight: '300px' }}>
              <ChaptersCompare diff={diff} oldOutline={oldOutline} newOutline={newOutline} />
            </Card>
          </TabPane>
          <TabPane tab="角色关系" key="characters">
            <Card size="small" style={{ minHeight: '300px' }}>
              <CharactersCompare diff={diff} oldOutline={oldOutline} newOutline={newOutline} />
            </Card>
          </TabPane>
          <TabPane tab="世界观设定" key="worldbuilding">
            <Card size="small" style={{ minHeight: '300px' }}>
              <WorldbuildingCompare diff={diff} oldOutline={oldOutline} newOutline={newOutline} />
            </Card>
          </TabPane>
        </Tabs>
      )}
    </Modal>
  );
};

export default VersionCompareModal;
