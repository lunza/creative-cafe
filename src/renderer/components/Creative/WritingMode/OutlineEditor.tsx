import React, { useState } from 'react';
import { Button, Collapse, Input, Tabs, Tag, message } from 'antd';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { GeneratedOutline, NovelType } from '../../../../shared/types/writing.types';
import { NOVEL_TYPE_LABELS } from '../../../../shared/constants/writing.constants';

const { TextArea } = Input;

interface OutlineEditorProps {
  outline: GeneratedOutline;
  onConfirm: () => void;
  onRegenerate: () => void;
  onBack: () => void;
}

const OutlineEditor: React.FC<OutlineEditorProps> = ({ outline, onConfirm, onRegenerate, onBack }) => {
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [editedOutline, setEditedOutline] = useState<GeneratedOutline>(outline);

  const handleChapterEdit = (index: number, field: string, value: string) => {
    setEditedOutline(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch => 
        ch.index === index ? { ...ch, [field]: value } : ch
      )
    }));
  };

  const handleSaveChapter = () => {
    setEditingChapter(null);
    message.success('章节已更新');
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>{editedOutline.workInfo.suggestedTitle}</h2>
          <div style={{ marginTop: 4 }}>
            <Tag>{NOVEL_TYPE_LABELS[editedOutline.workInfo.novelType as NovelType]}</Tag>
            <Tag>目标 {editedOutline.workInfo.estimatedWordCount} 字</Tag>
            <Tag>{editedOutline.workInfo.chapterCount} 章</Tag>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={onRegenerate}>重新生成</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={onConfirm} size="large">
            确认大纲
          </Button>
        </div>
      </div>

      <Tabs
        defaultActiveKey="storyline"
        items={[
          {
            key: 'storyline',
            label: '故事主线',
            children: (
              <div style={{ padding: '12px 0' }}>
                <h4>核心冲突</h4>
                <p>{editedOutline.storyLine.coreConflict}</p>
                <h4>故事弧光</h4>
                <ul>
                  <li><strong>起:</strong> {editedOutline.storyLine.storyArc.beginning}</li>
                  <li><strong>承:</strong> {editedOutline.storyLine.storyArc.development}</li>
                  <li><strong>转:</strong> {editedOutline.storyLine.storyArc.climax}</li>
                  <li><strong>合:</strong> {editedOutline.storyLine.storyArc.resolution}</li>
                </ul>
                <h4>主题</h4>
                <p>{editedOutline.storyLine.theme}</p>
              </div>
            )
          },
          {
            key: 'chapters',
            label: '章节大纲',
            children: (
              <Collapse accordion>
                {editedOutline.chapters.map((chapter) => (
                  <Collapse.Panel
                    key={chapter.index}
                    header={`第${chapter.index + 1}章 ${chapter.title}`}
                  >
                    {editingChapter === chapter.index ? (
                      <div>
                        <Input
                          value={chapter.title}
                          onChange={(e) => handleChapterEdit(chapter.index, 'title', e.target.value)}
                          placeholder="章节标题"
                          style={{ marginBottom: 8 }}
                        />
                        <TextArea
                          value={chapter.summary}
                          onChange={(e) => handleChapterEdit(chapter.index, 'summary', e.target.value)}
                          placeholder="章节概要"
                          rows={4}
                          style={{ marginBottom: 8 }}
                        />
                        <Button onClick={handleSaveChapter}>保存</Button>
                      </div>
                    ) : (
                      <div>
                        <p>{chapter.summary}</p>
                        {chapter.keyPlotPoints.length > 0 && (
                          <div>
                            <strong>关键情节:</strong>
                            <ul>
                              {chapter.keyPlotPoints.map((point, idx) => (
                                <li key={idx}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {chapter.characters.length > 0 && (
                          <div>
                            <strong>出场角色:</strong> {chapter.characters.join('、')}
                          </div>
                        )}
                        {chapter.scenes.length > 0 && (
                          <div>
                            <strong>场景:</strong> {chapter.scenes.join('、')}
                          </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                          <Button size="small" onClick={() => setEditingChapter(chapter.index)}>编辑</Button>
                        </div>
                      </div>
                    )}
                  </Collapse.Panel>
                ))}
              </Collapse>
            )
          },
          {
            key: 'characters',
            label: '角色关系',
            children: (
              <div>
                {editedOutline.characterRelationships.map((rel, idx) => (
                  <div key={idx} style={{ marginBottom: 16 }}>
                    <h4>{rel.name} <Tag>{rel.role}</Tag></h4>
                    {rel.relationships.map((r, rIdx) => (
                      <div key={rIdx} style={{ marginLeft: 16 }}>
                        → {r.targetCharacter}: {r.description}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          },
          {
            key: 'worldbuilding',
            label: '世界观',
            children: (
              <div>
                {editedOutline.worldbuildingNotes.map((note, idx) => (
                  <div key={idx} style={{ marginBottom: 16 }}>
                    <h4>{note.category}</h4>
                    <ul>
                      {note.points.map((point, pIdx) => (
                        <li key={pIdx}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          }
        ]}
      />
    </div>
  );
};

export default OutlineEditor;
