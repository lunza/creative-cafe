import React from 'react';
import { Input, InputNumber, Button, Space, theme } from 'antd';
import { PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { ChapterOutline } from '../../../../../shared/types/writing-v2.types';
import { ChapterStatus } from '../../../../../shared/types/writing-v2.types';

interface V2OutlineChapterListProps {
  chapters: ChapterOutline[];
  onChange: (chapters: ChapterOutline[]) => void;
}

/** 从空配置构建默认章节（手动大纲初始态） */
export function buildDefaultChapters(count: number, totalWordCount: number): ChapterOutline[] {
  const per = Math.max(100, Math.round(totalWordCount / Math.max(1, count)));
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    index: i,
    title: `第${i + 1}章`,
    summary: '',
    keyPlotPoints: [],
    characters: [],
    scenes: [],
    targetWordCount: per,
    content: '',
    status: ChapterStatus.PENDING,
  }));
}

/**
 * V2 大纲章节编辑列表
 * 统一服务于 AI 生成后的编辑与纯手动大纲两种模式。
 */
const V2OutlineChapterList: React.FC<V2OutlineChapterListProps> = ({ chapters, onChange }) => {
  const { token } = theme.useToken();

  const update = (index: number, patch: Partial<ChapterOutline>) => {
    const next = chapters.map((c, i) => (i === index ? { ...c, ...patch } : c));
    next.forEach((c, i) => {
      c.index = i;
    });
    onChange(next);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= chapters.length) return;
    const next = [...chapters];
    [next[index], next[target]] = [next[target], next[index]];
    next.forEach((c, i) => {
      c.index = i;
    });
    onChange(next);
  };

  const remove = (index: number) => {
    const next = chapters.filter((_, i) => i !== index);
    next.forEach((c, i) => {
      c.index = i;
    });
    onChange(next);
  };

  const add = () => {
    const prev = chapters[chapters.length - 1];
    const next = [
      ...chapters,
      {
        index: chapters.length,
        title: `第${chapters.length + 1}章`,
        summary: '',
        keyPlotPoints: [],
        characters: [],
        scenes: [],
        targetWordCount: prev?.targetWordCount ?? 2000,
        content: '',
      },
    ];
    onChange(next);
  };

  if (chapters.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32, color: token.colorTextTertiary }}>
        暂无章节，点击下方按钮添加
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {chapters.map((chapter, i) => (
        <div
          key={`${chapter.index}-${i}`}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            padding: 12,
            background: token.colorBgContainer,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, width: 24, color: token.colorTextSecondary }}>
              {i + 1}
            </span>
            <Input
              value={chapter.title}
              placeholder="章节标题"
              onChange={(e) => update(i, { title: e.target.value })}
              style={{ flex: 1 }}
            />
            <InputNumber
              value={chapter.targetWordCount}
              min={100}
              step={100}
              addonAfter="字"
              onChange={(v) => update(i, { targetWordCount: v ?? 1000 })}
              style={{ width: 110 }}
            />
            <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />
            <Button
              size="small"
              type="text"
              icon={<ArrowDownOutlined />}
              disabled={i === chapters.length - 1}
              onClick={() => move(i, 1)}
            />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(i)} />
          </div>
          <Input.TextArea
            value={chapter.summary}
            placeholder="本章剧情摘要（AI 生成章节内容时的核心依据）"
            autoSize={{ minRows: 2, maxRows: 6 }}
            onChange={(e) => update(i, { summary: e.target.value })}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Input.TextArea
              value={(chapter.keyPlotPoints || []).join('\n')}
              placeholder="关键情节点（每行一条）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={(e) =>
                update(i, { keyPlotPoints: e.target.value.split('\n').filter((s) => s.trim()) })
              }
              style={{ flex: 1 }}
            />
            <Input.TextArea
              value={(chapter.characters || []).join('\n')}
              placeholder="出场人物（每行一个）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={(e) =>
                update(i, { characters: e.target.value.split('\n').filter((s) => s.trim()) })
              }
              style={{ flex: 1 }}
            />
            <Input.TextArea
              value={(chapter.scenes || []).join('\n')}
              placeholder="场景（每行一个）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={(e) =>
                update(i, { scenes: e.target.value.split('\n').filter((s) => s.trim()) })
              }
              style={{ flex: 1 }}
            />
          </div>
        </div>
      ))}
      <Space>
        <Button icon={<PlusOutlined />} onClick={add}>
          添加章节
        </Button>
      </Space>
    </div>
  );
};

export default V2OutlineChapterList;
