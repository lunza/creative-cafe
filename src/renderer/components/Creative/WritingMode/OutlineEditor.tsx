import React, { useState } from 'react';
import { Button, Collapse, Input, Tabs, Tag, message, Modal, Empty, Space } from 'antd';
import { CheckOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { GeneratedOutline, NovelType, ChapterOutline, ProjectStatus, ChapterStatus } from '../../../../shared/types/writing.types';
import { NOVEL_TYPE_LABELS } from '../../../../shared/constants/writing.constants';
import ManualOutlineEditor from './ManualOutlineEditor';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

const { TextArea } = Input;

// 将文本中匹配 importantSpans 的部分以加粗样式显示
function renderWithImportantSpans(text: string, importantSpans?: string[]): React.ReactNode {
  if (!importantSpans || importantSpans.length === 0) return text;

  const spans = importantSpans.filter(s => s && s.length > 0);
  if (spans.length === 0) return text;

  // 按长度降序排列，避免短 span 先匹配导致长 span 无法匹配
  const sortedSpans = [...spans].sort((a, b) => b.length - a.length);

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    let earliestIndex = -1;
    let earliestSpan = '';

    for (const span of sortedSpans) {
      const idx = remaining.indexOf(span);
      if (idx >= 0 && (earliestIndex < 0 || idx < earliestIndex)) {
        earliestIndex = idx;
        earliestSpan = span;
      }
    }

    if (earliestIndex < 0) {
      // 没有找到更多匹配，剩余部分作为普通文本
      parts.push(<React.Fragment key={keyIndex++}>{remaining}</React.Fragment>);
      break;
    }

    // 添加匹配前的普通文本
    if (earliestIndex > 0) {
      parts.push(<React.Fragment key={keyIndex++}>{remaining.slice(0, earliestIndex)}</React.Fragment>);
    }

    // 添加加粗的 span
    parts.push(<strong key={keyIndex++}>{earliestSpan}</strong>);

    // 继续处理剩余部分
    remaining = remaining.slice(earliestIndex + earliestSpan.length);
  }

  return <span>{parts}</span>;
}

interface OutlineEditorProps {
  outline: GeneratedOutline | null;
  onConfirm: () => void;
  onRegenerate: () => void;
  onBack: () => void;
  projectId: string;
  initialMode?: 'ai' | 'manual';
}

const OutlineEditor: React.FC<OutlineEditorProps> = ({ 
  outline, 
  onConfirm, 
  onRegenerate, 
  onBack,
  projectId,
  initialMode = 'ai'
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialMode === 'manual' ? 'manual' : 'ai');
  const [currentMode, setCurrentMode] = useState<'ai' | 'manual'>(initialMode);
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [editedOutline, setEditedOutline] = useState<GeneratedOutline | null>(outline);
  const [manualChapters, setManualChapters] = useState<ChapterOutline[]>(outline?.chapters || []);

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

  const handleTabChange = (key: string) => {
    if (key === 'manual' && currentMode === 'ai') {
      setCurrentMode('manual');
      setActiveTab(key);
    } else if (key === 'ai' && currentMode === 'manual') {
      Modal.confirm({
        title: '确认切换',
        content: 'AI生成将覆盖当前手动大纲，是否继续？',
        okText: '继续',
        cancelText: '取消',
        onOk: () => {
          setCurrentMode('ai');
          setActiveTab(key);
        }
      });
    } else {
      setActiveTab(key);
    }
  };

  const handleManualChaptersChange = (chapters: ChapterOutline[]) => {
    setManualChapters(chapters);
    setCurrentMode('manual');
    
    const newOutline: GeneratedOutline = {
      workInfo: outline?.workInfo || {
        suggestedTitle: '手动大纲',
        novelType: 'web_novel',
        estimatedWordCount: chapters.reduce((sum, ch) => sum + (ch.targetWordCount || 0), 0),
        chapterCount: chapters.length,
        creativeDescription: ''
      },
      storyLine: outline?.storyLine || {
        coreConflict: '',
        storyArc: { beginning: '', development: '', climax: '', resolution: '' },
        theme: ''
      },
      chapters,
      characterRelationships: outline?.characterRelationships || [],
      worldbuildingNotes: outline?.worldbuildingNotes || []
    };
    useWritingModeStore.getState().setOutline(newOutline);
    useWritingModeStore.getState().setOutlineMode('manual');
    message.success('大纲已更新');
  };

  const handleConfirmOutline = async () => {
    const { updateProject, getCurrentProject } = useWritingProjectStore.getState();
    const project = getCurrentProject();
    if (!project) {
      message.error('未找到当前项目');
      return;
    }

    const finalOutline = currentMode === 'manual'
      ? {
          workInfo: outline?.workInfo || {
            suggestedTitle: '手动大纲',
            novelType: 'web_novel' as NovelType,
            estimatedWordCount: manualChapters.reduce((sum, ch) => sum + (ch.targetWordCount || 0), 0),
            chapterCount: manualChapters.length,
            creativeDescription: ''
          },
          storyLine: outline?.storyLine || {
            coreConflict: '',
            storyArc: { beginning: '', development: '', climax: '', resolution: '' },
            theme: ''
          },
          chapters: manualChapters,
          characterRelationships: outline?.characterRelationships || [],
          worldbuildingNotes: outline?.worldbuildingNotes || []
        }
      : editedOutline;

    if (!finalOutline || finalOutline.chapters.length === 0) {
      message.error('大纲内容为空');
      return;
    }

    await updateProject(project.id, {
      outline: finalOutline,
      outlineRaw: JSON.stringify(finalOutline, null, 2),
      status: ProjectStatus.OUTLINING,
      chapters: finalOutline.chapters.map(ch => ({
        index: ch.index,
        title: ch.title,
        outline: {
          summary: ch.summary || '',
          keyPlotPoints: ch.keyPlotPoints || [],
          characters: ch.characters || [],
          scenes: ch.scenes || [],
          targetWordCount: ch.targetWordCount || 3000
        },
        content: project.chapters.find(c => c.index === ch.index)?.content || '',
        status: ChapterStatus.PENDING,
        wordCount: project.chapters.find(c => c.index === ch.index)?.wordCount || 0,
        versions: project.chapters.find(c => c.index === ch.index)?.versions || [],
        lastModified: Date.now()
      }))
    });

    message.success('大纲已保存');
    onConfirm();
  };

  if (!outline && currentMode === 'ai') {
    return (
      <div style={{ padding: 24, textAlign: 'center', minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          description="暂无大纲"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" onClick={() => { setCurrentMode('manual'); setActiveTab('manual'); }}>
            手动创建大纲
          </Button>
          <Button onClick={onBack}>
            返回调整参数
          </Button>
        </Space>
      </div>
    );
  }

  const displayOutline = currentMode === 'ai' ? editedOutline : outline;
  if (!displayOutline && currentMode === 'ai') {
    return <div>加载中...</div>;
  }

  const targetOutline = currentMode === 'manual' ? (editedOutline || {
    workInfo: {
      suggestedTitle: '手动大纲',
      novelType: 'web_novel' as NovelType,
      estimatedWordCount: manualChapters.reduce((sum, ch) => sum + (ch.targetWordCount || 0), 0),
      chapterCount: manualChapters.length,
      creativeDescription: ''
    },
    storyLine: {
      coreConflict: '',
      storyArc: { beginning: '', development: '', climax: '', resolution: '' },
      theme: ''
    },
    chapters: manualChapters,
    characterRelationships: [],
    worldbuildingNotes: []
  }) : editedOutline;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>{(targetOutline as GeneratedOutline).workInfo.suggestedTitle}</h2>
          <div style={{ marginTop: 4 }}>
            <Tag>{NOVEL_TYPE_LABELS[(targetOutline as GeneratedOutline).workInfo.novelType as NovelType]}</Tag>
            <Tag>目标 {(targetOutline as GeneratedOutline).workInfo.estimatedWordCount} 字</Tag>
            <Tag>{(targetOutline as GeneratedOutline).workInfo.chapterCount} 章</Tag>
            {(targetOutline as GeneratedOutline).workInfo.isComplete === false && (
              <Tag color="orange">未完结</Tag>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<EditOutlined />} onClick={onBack}>调整参数</Button>
          <Button icon={<ReloadOutlined />} onClick={onRegenerate}>重新生成</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirmOutline} size="large">
            确认大纲
          </Button>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        centered
        items={[
          {
            key: 'ai',
            label: 'AI生成',
            children: (
              <Tabs
                defaultActiveKey="storyline"
                items={[
                  {
                    key: 'storyline',
                    label: '故事主线',
                    children: (
                      <div style={{ padding: '12px 0' }}>
                        <h4>核心冲突</h4>
                        <p>{(targetOutline as GeneratedOutline).storyLine.coreConflict}</p>
                        <h4>故事弧光</h4>
                        <ul>
                          <li><strong>起:</strong> {(targetOutline as GeneratedOutline).storyLine.storyArc.beginning}</li>
                          <li><strong>承:</strong> {(targetOutline as GeneratedOutline).storyLine.storyArc.development}</li>
                          <li><strong>转:</strong> {(targetOutline as GeneratedOutline).storyLine.storyArc.climax}</li>
                          <li><strong>合:</strong> {(targetOutline as GeneratedOutline).storyLine.storyArc.resolution}</li>
                        </ul>
                        <h4>主题</h4>
                        <p>{(targetOutline as GeneratedOutline).storyLine.theme}</p>
                      </div>
                    )
                  },
                  {
                    key: 'chapters',
                    label: '章节大纲',
                    children: (
                      <Collapse accordion>
                        {(targetOutline as GeneratedOutline).chapters.map((chapter) => (
                          <Collapse.Panel
                            key={chapter.index}
                            header={`第${chapter.index + 1}章 ${chapter.title}`}
                          >
                            {editingChapter === chapter.index ? (
                              <div>
                                <Input
                                  value={(targetOutline as GeneratedOutline).chapters.find(c => c.index === chapter.index)?.title ?? chapter.title}
                                  onChange={(e) => handleChapterEdit(chapter.index, 'title', e.target.value)}
                                  placeholder="章节标题"
                                  style={{ marginBottom: 8 }}
                                />
                                <TextArea
                                  value={(targetOutline as GeneratedOutline).chapters.find(c => c.index === chapter.index)?.summary ?? chapter.summary}
                                  onChange={(e) => handleChapterEdit(chapter.index, 'summary', e.target.value)}
                                  placeholder="章节概要"
                                  rows={4}
                                  style={{ marginBottom: 8 }}
                                />
                                <Button onClick={handleSaveChapter}>保存</Button>
                              </div>
                            ) : (
                              <div>
                                <p>{renderWithImportantSpans(chapter.summary, chapter.importantSpans)}</p>
                                {chapter.keyPlotPoints.length > 0 && (
                                  <div>
                                    <strong>关键情节:</strong>
                                    <ul>
                                      {chapter.keyPlotPoints.map((point, idx) => (
                                        <li key={idx}>{renderWithImportantSpans(point, chapter.importantSpans)}</li>
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
                        {(targetOutline as GeneratedOutline).characterRelationships.map((rel, idx) => (
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
                        {(targetOutline as GeneratedOutline).worldbuildingNotes.map((note, idx) => (
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
            )
          },
          {
            key: 'manual',
            label: '手动编辑',
            children: (
              <div style={{ height: '600px' }}>
                <ManualOutlineEditor
                  chapters={manualChapters}
                  onChange={handleManualChaptersChange}
                  projectId={projectId}
                />
              </div>
            )
          }
        ]}
      />
    </div>
  );
};

export default OutlineEditor;
