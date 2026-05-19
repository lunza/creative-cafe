import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Tree, Form, Input, Select, Button, InputNumber, message, Empty, Space, Tag, Popconfirm, Tooltip, Spin } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  MergeCellsOutlined,
  SplitCellsOutlined,
  EditOutlined,
  UnorderedListOutlined,
  UndoOutlined,
  RedoOutlined,
  SaveOutlined
} from '@ant-design/icons';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import { ChapterOutline, ChapterType, ImportanceLevel } from '../../../../shared/types/writing.types';
import {
  CHAPTER_TYPE_OPTIONS,
  IMPORTANCE_LEVEL_OPTIONS,
  IMPORTANCE_COLORS,
  MAX_CHAPTER_TITLE_LENGTH,
  MAX_CHAPTER_SUMMARY_LENGTH,
  MIN_CHAPTER_WORD_COUNT,
  MAX_CHAPTER_WORD_COUNT
} from '../../../../shared/constants/writing.constants';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

const { TextArea } = Input;

interface ManualOutlineEditorProps {
  chapters: ChapterOutline[];
  onChange: (chapters: ChapterOutline[]) => void;
  projectId: string;
}

interface TreeNodeData extends DataNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  chapterIndex: number;
  level: number;
  children?: TreeNodeData[];
}

const ManualOutlineEditor: React.FC<ManualOutlineEditorProps> = ({ chapters, onChange, projectId }) => {
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  const pushOutlineHistory = useWritingProjectStore((state) => state.pushOutlineHistory);
  const undoOutline = useWritingProjectStore((state) => state.undoOutline);
  const redoOutline = useWritingProjectStore((state) => state.redoOutline);
  const canUndo = useWritingProjectStore((state) => state.canUndo());
  const canRedo = useWritingProjectStore((state) => state.canRedo());
  const isSaving = useWritingProjectStore((state) => state.isSaving);
  const updateOutline = useWritingProjectStore((state) => state.updateOutline);

  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleUndo = useCallback(() => {
    const prevChapters = undoOutline();
    if (prevChapters) {
      onChange(prevChapters);
      message.success('已撤销');
    } else {
      message.info('没有可撤销的操作');
    }
  }, [undoOutline, onChange]);

  const handleRedo = useCallback(() => {
    const nextChapters = redoOutline();
    if (nextChapters) {
      onChange(nextChapters);
      message.success('已重做');
    } else {
      message.info('没有可重做的操作');
    }
  }, [redoOutline, onChange]);

  const handleSave = useCallback(() => {
    updateOutline(chapters);
    message.success('大纲已保存');
  }, [chapters, updateOutline]);

  const triggerChangeWithHistory = useCallback((updatedChapters: ChapterOutline[], description: string = '编辑章节') => {
    pushOutlineHistory(chaptersRef.current, description);
    onChange(updatedChapters);
  }, [onChange, pushOutlineHistory]);

  const generateChapterKey = (index: number, level: number = 0) => {
    return `chapter-${level}-${index}`;
  };

  const buildTreeData = useCallback((chapterList: ChapterOutline[], level: number = 0): TreeNodeData[] => {
    return chapterList.map((chapter) => {
      const hasChildren = level < 1 && chapter.children && chapter.children.length > 0;
      const node: TreeNodeData = {
        key: generateChapterKey(chapter.index, level),
        title: chapter.title || `第 ${chapter.index + 1} 章`,
        isLeaf: !hasChildren,
        chapterIndex: chapter.index,
        level,
      };

      if (hasChildren && chapter.children) {
        node.children = buildTreeData(chapter.children, level + 1);
      }

      return node;
    });
  }, []);

  const findChapterByKeys = useCallback((keys: string[], chapterList: ChapterOutline[]): { chapter: ChapterOutline; parentList: ChapterOutline[]; index: number } | null => {
    if (!keys || keys.length === 0) return null;

    const key = keys[0];
    const parts = key.split('-');
    const level = parseInt(parts[1]);
    const index = parseInt(parts[2]);

    if (level === 0) {
      return { chapter: chapterList[index], parentList: chapterList, index };
    }

    const findInLevel = (list: ChapterOutline[], currentLevel: number, targetLevel: number, targetIndex: number): { chapter: ChapterOutline; parentList: ChapterOutline[]; index: number } | null => {
      for (let i = 0; i < list.length; i++) {
        if (currentLevel === targetLevel && i === targetIndex) {
          return { chapter: list[i], parentList: list, index: i };
        }

        if (currentLevel < targetLevel && list[i].children) {
          const result = findInLevel(list[i].children!, currentLevel + 1, targetLevel, targetIndex);
          if (result) return result;
        }
      }
      return null;
    };

    return findInLevel(chapterList, 0, level, index);
  }, []);

  const selectedChapter = React.useMemo(() => {
    if (selectedKeys.length === 0) return null;
    const result = findChapterByKeys(selectedKeys as string[], chapters);
    return result?.chapter || null;
  }, [selectedKeys, chapters, findChapterByKeys]);

  const handleSelect = useCallback((keys: React.Key[], info: { selected: boolean; selectedNodes: any; node: EventDataNode<any>; event: any }) => {
    setSelectedKeys(keys);
    if (keys.length > 0 && info.node) {
      const result = findChapterByKeys(keys as string[], chapters);
      if (result) {
        form.setFieldsValue({
          title: result.chapter.title,
          targetWordCount: result.chapter.targetWordCount,
          summary: result.chapter.summary,
          chapterType: result.chapter.chapterType,
          importance: result.chapter.importance,
        });
        setValidationErrors({});
      }
    }
  }, [chapters, form, findChapterByKeys]);

  const handleExpand = useCallback((keys: React.Key[]) => {
    setExpandedKeys(keys);
  }, []);

  const validateForm = useCallback((values: any): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!values.title || values.title.trim().length === 0) {
      errors.title = '章节名称为必填项';
    } else if (values.title.length > MAX_CHAPTER_TITLE_LENGTH) {
      errors.title = `章节名称不能超过 ${MAX_CHAPTER_TITLE_LENGTH} 个字符`;
    }

    if (values.targetWordCount !== undefined && values.targetWordCount !== null) {
      if (values.targetWordCount < MIN_CHAPTER_WORD_COUNT || values.targetWordCount > MAX_CHAPTER_WORD_COUNT) {
        errors.targetWordCount = `字数范围必须在 ${MIN_CHAPTER_WORD_COUNT} 到 ${MAX_CHAPTER_WORD_COUNT} 之间`;
      }
    }

    if (values.summary && values.summary.length > MAX_CHAPTER_SUMMARY_LENGTH) {
      errors.summary = `故事摘要不能超过 ${MAX_CHAPTER_SUMMARY_LENGTH} 个字符`;
    }

    setValidationErrors(errors);
    return errors;
  }, []);

  const handleFormChange = useCallback((changedValues: any, allValues: any) => {
    const errors = validateForm(allValues);

    if (Object.keys(errors).length === 0 && selectedChapter) {
      const updatedChapters = [...chapters];
      const result = findChapterByKeys(selectedKeys as string[], updatedChapters);

      if (result) {
        result.chapter = {
          ...result.chapter,
          title: allValues.title,
          targetWordCount: allValues.targetWordCount,
          summary: allValues.summary || '',
          chapterType: allValues.chapterType,
          importance: allValues.importance,
        };

        onChange(updatedChapters);
      }
    }
  }, [chapters, selectedChapter, selectedKeys, onChange, findChapterByKeys, validateForm]);

  const addChapter = useCallback(() => {
    const newIndex = chapters.length;
    const newChapter: ChapterOutline = {
      index: newIndex,
      title: `第 ${newIndex + 1} 章`,
      summary: '',
      keyPlotPoints: [],
      characters: [],
      scenes: [],
      targetWordCount: 2000,
      chapterType: ChapterType.MAIN_PLOT,
      importance: ImportanceLevel.MEDIUM,
    };

    const updatedChapters = [...chapters, newChapter];
    triggerChangeWithHistory(updatedChapters, '添加章节');

    const newKey = generateChapterKey(newIndex, 0);
    setSelectedKeys([newKey]);
    setExpandedKeys([...expandedKeys, newKey]);
    message.success('章节已添加');
  }, [chapters, expandedKeys, triggerChangeWithHistory]);

  const addSubChapter = useCallback(() => {
    if (selectedKeys.length === 0) {
      message.warning('请先选择一个章节');
      return;
    }

    const result = findChapterByKeys(selectedKeys as string[], chapters);
    if (!result) return;

    const selectedKey = selectedKeys[0] as string;
    const parts = selectedKey.split('-');
    const level = parseInt(parts[1]);

    if (level !== 0) {
      message.warning('只能在主章节下添加子章节');
      return;
    }

    if (!result.chapter.children) {
      result.chapter.children = [];
    }

    if (result.chapter.children.length >= 10) {
      message.warning('子章节数量不能超过10个');
      return;
    }

    const newSubIndex = result.chapter.children.length;
    const newSubChapter: ChapterOutline = {
      index: newSubIndex,
      title: `子章节 ${newSubIndex + 1}`,
      summary: '',
      keyPlotPoints: [],
      characters: [],
      scenes: [],
      targetWordCount: 1000,
      chapterType: ChapterType.SUB_PLOT,
      importance: ImportanceLevel.LOW,
    };

    const updatedChapters = [...chapters];
    const updatedResult = findChapterByKeys(selectedKeys as string[], updatedChapters);
    if (updatedResult && updatedResult.chapter.children) {
      updatedResult.chapter.children.push(newSubChapter);
      triggerChangeWithHistory(updatedChapters, '添加子章节');
      message.success('子章节已添加');
    }
  }, [selectedKeys, chapters, triggerChangeWithHistory, findChapterByKeys]);

  const deleteChapter = useCallback(() => {
    if (selectedKeys.length === 0) {
      message.warning('请先选择要删除的章节');
      return;
    }

    const result = findChapterByKeys(selectedKeys as string[], chapters);
    if (!result) return;

    const updatedChapters = [...chapters];
    const updatedResult = findChapterByKeys(selectedKeys as string[], updatedChapters);

    if (updatedResult) {
      if (updatedResult.parentList === updatedChapters) {
        updatedChapters.splice(updatedResult.index, 1);
        updatedChapters.forEach((ch, idx) => {
          ch.index = idx;
        });
      } else {
        updatedResult.parentList!.splice(updatedResult.index, 1);
        updatedResult.parentList!.forEach((ch, idx) => {
          ch.index = idx;
        });
      }

      triggerChangeWithHistory(updatedChapters, '删除章节');
      setSelectedKeys([]);
      form.resetFields();
      message.success('章节已删除');
    }
  }, [selectedKeys, chapters, form, triggerChangeWithHistory, findChapterByKeys]);

  const moveChapter = useCallback((direction: 'up' | 'down') => {
    if (selectedKeys.length === 0) return;

    const updatedChapters = [...chapters];
    const result = findChapterByKeys(selectedKeys as string[], updatedChapters);
    if (!result) return;

    const parentList = result.parentList;
    const currentIndex = result.index;

    if (direction === 'up' && currentIndex === 0) {
      message.warning('已经是第一个章节');
      return;
    }

    if (direction === 'down' && currentIndex === parentList.length - 1) {
      message.warning('已经是最后一个章节');
      return;
    }

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    const temp = parentList[currentIndex];
    parentList[currentIndex] = parentList[newIndex];
    parentList[newIndex] = temp;

    parentList.forEach((ch, idx) => {
      ch.index = idx;
    });

    triggerChangeWithHistory(updatedChapters, `移动章节${direction === 'up' ? '上' : '下'}`);
    message.success('章节已移动');
  }, [selectedKeys, chapters, triggerChangeWithHistory, findChapterByKeys]);

  const mergeChapters = useCallback(() => {
    if (selectedKeys.length === 0) {
      message.warning('请先选择要合并的章节');
      return;
    }

    const result = findChapterByKeys(selectedKeys as string[], chapters);
    if (!result) return;

    const parentList = result.parentList;
    const currentIndex = result.index;

    if (parentList.length < 2) {
      message.warning('至少需要两个章节才能合并');
      return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= parentList.length) {
      message.warning('无法合并，后面没有相邻章节');
      return;
    }

    const currentChapter = parentList[currentIndex];
    const nextChapter = parentList[nextIndex];

    const mergedChapter: ChapterOutline = {
      ...currentChapter,
      title: currentChapter.title,
      summary: `${currentChapter.summary}\n\n---\n\n${nextChapter.title}\n\n${nextChapter.summary}`,
      keyPlotPoints: [...currentChapter.keyPlotPoints, ...nextChapter.keyPlotPoints],
      characters: [...new Set([...currentChapter.characters, ...nextChapter.characters])],
      scenes: [...new Set([...currentChapter.scenes, ...nextChapter.scenes])],
      targetWordCount: (currentChapter.targetWordCount || 0) + (nextChapter.targetWordCount || 0),
      children: [...(currentChapter.children || []), ...(nextChapter.children || [])]
    };

    const updatedChapters = [...chapters];
    const updatedResult = findChapterByKeys(selectedKeys as string[], updatedChapters);

    if (updatedResult) {
      updatedResult.parentList.splice(currentIndex, 2, mergedChapter);
      updatedResult.parentList.forEach((ch, idx) => {
        ch.index = idx;
      });

      triggerChangeWithHistory(updatedChapters, '合并章节');
      message.success('章节已合并');
    }
  }, [selectedKeys, chapters, triggerChangeWithHistory, findChapterByKeys]);

  const splitChapter = useCallback(() => {
    if (selectedKeys.length === 0) {
      message.warning('请先选择要分割的章节');
      return;
    }

    const result = findChapterByKeys(selectedKeys as string[], chapters);
    if (!result) return;

    const parentList = result.parentList;
    const currentChapter = parentList[result.index];

    const summaryParts = currentChapter.summary.split('\n\n---\n\n');
    if (summaryParts.length < 2) {
      message.warning('章节内容不足以分割，需要包含"---"分隔符');
      return;
    }

    const firstChapter: ChapterOutline = {
      ...currentChapter,
      summary: summaryParts[0],
      targetWordCount: Math.floor(currentChapter.targetWordCount / 2)
    };

    const secondChapter: ChapterOutline = {
      index: currentChapter.index + 1,
      title: `${currentChapter.title}（下）`,
      summary: summaryParts.slice(1).join('\n\n---\n\n'),
      keyPlotPoints: currentChapter.keyPlotPoints,
      characters: currentChapter.characters,
      scenes: currentChapter.scenes,
      targetWordCount: currentChapter.targetWordCount - firstChapter.targetWordCount,
      chapterType: currentChapter.chapterType,
      importance: currentChapter.importance
    };

    const updatedChapters = [...chapters];
    const updatedResult = findChapterByKeys(selectedKeys as string[], updatedChapters);

    if (updatedResult) {
      updatedResult.parentList.splice(result.index, 1, firstChapter, secondChapter);
      updatedResult.parentList.forEach((ch, idx) => {
        ch.index = idx;
      });

      triggerChangeWithHistory(updatedChapters, '拆分章节');
      message.success('章节已分割');
    }
  }, [selectedKeys, chapters, triggerChangeWithHistory, findChapterByKeys]);

  const renderChapterTag = (chapter: ChapterOutline) => {
    const tags: React.ReactNode[] = [];

    if (chapter.chapterType) {
      tags.push(
        <Tag key="type" style={{ margin: 0, marginLeft: 8, fontSize: 12 }}>
          {CHAPTER_TYPE_OPTIONS.find(opt => opt.value === chapter.chapterType)?.label || chapter.chapterType}
        </Tag>
      );
    }

    if (chapter.importance) {
      tags.push(
        <Tag
          key="importance"
          color={IMPORTANCE_COLORS[chapter.importance as ImportanceLevel]}
          style={{ margin: 0, marginLeft: 4, fontSize: 12 }}
        >
          {IMPORTANCE_LEVEL_OPTIONS.find(opt => opt.value === chapter.importance)?.label || chapter.importance}
        </Tag>
      );
    }

    return tags;
  };

  const treeData = React.useMemo(() => buildTreeData(chapters), [chapters, buildTreeData]);

  const renderTreeNode = (node: TreeNodeData) => {
    const chapter = chapters[node.level === 0 ? node.chapterIndex : -1];
    let chapterData: ChapterOutline | undefined;

    if (node.level === 0) {
      chapterData = chapters[node.chapterIndex];
    } else {
      const findChapter = (list: ChapterOutline[], targetLevel: number, targetIndex: number, currentLevel: number = 0): ChapterOutline | undefined => {
        for (const ch of list) {
          if (currentLevel === targetLevel && ch.index === targetIndex) {
            return ch;
          }
          if (ch.children && currentLevel < targetLevel) {
            const found = findChapter(ch.children, targetLevel, targetIndex, currentLevel + 1);
            if (found) return found;
          }
        }
        return undefined;
      };
      chapterData = findChapter(chapters, node.level, node.chapterIndex);
    }

    return {
      ...node,
      title: (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.title}
          </span>
          {chapterData && renderChapterTag(chapterData)}
        </span>
      ),
    };
  };

  const processedTreeData = React.useMemo(() => {
    const processNodes = (nodes: TreeNodeData[]): any[] => {
      return nodes.map(node => {
        const processed = renderTreeNode(node);
        if (node.children) {
          return {
            ...processed,
            children: processNodes(node.children),
          };
        }
        return processed;
      });
    };
    return processNodes(treeData);
  }, [treeData]);

  useEffect(() => {
    if (chapters.length === 0) {
      setSelectedKeys([]);
      form.resetFields();
    }
  }, [chapters, form]);

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      <div style={{ width: 320, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500, fontSize: 16 }}>章节大纲</span>
              <Space>
                {isSaving && <Spin size="small" />}
                <UnorderedListOutlined style={{ color: '#8c8c8c' }} />
              </Space>
            </div>
            <Space wrap>
              <Tooltip title="撤销 (Ctrl+Z)">
                <Button size="small" icon={<UndoOutlined />} onClick={handleUndo} disabled={!canUndo} />
              </Tooltip>
              <Tooltip title="重做 (Ctrl+Y)">
                <Button size="small" icon={<RedoOutlined />} onClick={handleRedo} disabled={!canRedo} />
              </Tooltip>
              <Tooltip title="保存">
                <Button size="small" icon={<SaveOutlined />} onClick={handleSave} />
              </Tooltip>
            </Space>
            <Space wrap>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addChapter}>
                添加章节
              </Button>
              <Button size="small" icon={<PlusOutlined />} onClick={addSubChapter} disabled={selectedKeys.length === 0}>
                添加子章节
              </Button>
              <Popconfirm title="确定删除此章节吗？" onConfirm={deleteChapter} disabled={selectedKeys.length === 0}>
                <Button size="small" danger icon={<DeleteOutlined />} disabled={selectedKeys.length === 0}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
            <Space wrap>
              <Button size="small" icon={<ArrowUpOutlined />} onClick={() => moveChapter('up')} disabled={selectedKeys.length === 0}>
                上移
              </Button>
              <Button size="small" icon={<ArrowDownOutlined />} onClick={() => moveChapter('down')} disabled={selectedKeys.length === 0}>
                下移
              </Button>
              <Button size="small" icon={<MergeCellsOutlined />} onClick={mergeChapters} disabled={selectedKeys.length === 0}>
                合并
              </Button>
              <Button size="small" icon={<SplitCellsOutlined />} onClick={splitChapter} disabled={selectedKeys.length === 0}>
                分割
              </Button>
            </Space>
          </Space>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {chapters.length === 0 ? (
            <Empty
              description="暂无章节"
              style={{ marginTop: 80 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Tree
              treeData={processedTreeData}
              selectedKeys={selectedKeys}
              expandedKeys={expandedKeys}
              onSelect={handleSelect}
              onExpand={handleExpand}
              showLine
              showIcon={false}
              defaultExpandAll={false}
              blockNode
              style={{ backgroundColor: 'transparent' }}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {selectedChapter ? (
          <div>
            <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center' }}>
              <EditOutlined style={{ marginRight: 8, color: '#1890ff' }} />
              <span style={{ fontSize: 18, fontWeight: 500 }}>章节属性</span>
            </div>

            <Form
              form={form}
              layout="vertical"
              onValuesChange={handleFormChange}
              initialValues={{
                title: selectedChapter.title,
                targetWordCount: selectedChapter.targetWordCount,
                summary: selectedChapter.summary,
                chapterType: selectedChapter.chapterType || ChapterType.MAIN_PLOT,
                importance: selectedChapter.importance || ImportanceLevel.MEDIUM,
              }}
            >
              <Form.Item
                label="章节名称"
                name="title"
                rules={[
                  { required: true, message: '请输入章节名称' },
                  { max: MAX_CHAPTER_TITLE_LENGTH, message: `不能超过 ${MAX_CHAPTER_TITLE_LENGTH} 个字符` }
                ]}
                validateStatus={validationErrors.title ? 'error' : ''}
                help={validationErrors.title}
              >
                <Input placeholder="请输入章节名称" maxLength={MAX_CHAPTER_TITLE_LENGTH} showCount />
              </Form.Item>

              <Form.Item
                label="预估字数"
                name="targetWordCount"
                rules={[
                  {
                    type: 'number',
                    min: MIN_CHAPTER_WORD_COUNT,
                    max: MAX_CHAPTER_WORD_COUNT,
                    message: `字数范围必须在 ${MIN_CHAPTER_WORD_COUNT} 到 ${MAX_CHAPTER_WORD_COUNT} 之间`
                  }
                ]}
                validateStatus={validationErrors.targetWordCount ? 'error' : ''}
                help={validationErrors.targetWordCount}
              >
                <InputNumber
                  placeholder="请输入预估字数"
                  min={MIN_CHAPTER_WORD_COUNT}
                  max={MAX_CHAPTER_WORD_COUNT}
                  style={{ width: '100%' }}
                  formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value) => parseInt(value?.replace(/\$\s?|(,*)/g, '') || '0', 10)}
                />
              </Form.Item>

              <Form.Item
                label="章节类型"
                name="chapterType"
              >
                <Select
                  placeholder="请选择章节类型"
                  options={CHAPTER_TYPE_OPTIONS}
                />
              </Form.Item>

              <Form.Item
                label="重要程度"
                name="importance"
              >
                <Select
                  placeholder="请选择重要程度"
                  options={IMPORTANCE_LEVEL_OPTIONS}
                  optionRender={(option) => (
                    <Space>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: IMPORTANCE_COLORS[option.data.value as ImportanceLevel],
                        }}
                      />
                      <span>{option.data.label}</span>
                    </Space>
                  )}
                />
              </Form.Item>

              <Form.Item
                label="故事摘要"
                name="summary"
                rules={[
                  { max: MAX_CHAPTER_SUMMARY_LENGTH, message: `不能超过 ${MAX_CHAPTER_SUMMARY_LENGTH} 个字符` }
                ]}
                validateStatus={validationErrors.summary ? 'error' : ''}
                help={validationErrors.summary}
              >
                <TextArea
                  placeholder="请输入故事摘要"
                  rows={6}
                  maxLength={MAX_CHAPTER_SUMMARY_LENGTH}
                  showCount
                />
              </Form.Item>
            </Form>
          </div>
        ) : (
          <Empty
            description={chapters.length > 0 ? '请选择一个章节进行编辑' : '暂无章节，请先添加章节'}
            style={{ marginTop: 120 }}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </div>
    </div>
  );
};

export default ManualOutlineEditor;
