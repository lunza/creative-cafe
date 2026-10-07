import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Segmented,
  Space,
  Spin,
  Tag,
  message,
  theme,
} from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  CheckOutlined,
  AntCloudOutlined,
} from '@ant-design/icons';
import type {
  GeneratedOutline,
  ChapterOutline,
  ChainOfThought,
} from '../../../../../shared/types/writing-v2.types';
import { ProjectStatus, NovelType } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { useV2UIStore } from '../stores/useV2UIStore';
import V2OutlineChapterList, { buildDefaultChapters } from './V2OutlineChapterList';
import { V2_NOVEL_TYPE_LABELS } from '../shared/v2Labels';

/**
 * V2 大纲工作台（Phase 1 / P0）
 * 统一 AI 生成（流式）与手动大纲两种模式；单一真相源 = 项目实体
 * （编辑即 patchProject 防抖落盘）。
 */
const V2OutlineWorkbench: React.FC = () => {
  const { token } = theme.useToken();
  const project = useV2ProjectStore((s) => s.getCurrentProject());
  const patchProject = useV2ProjectStore((s) => s.patchProject);
  const setStage = useV2UIStore((s) => s.setStage);

  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [cot, setCot] = useState<ChainOfThought | null>(null);
  const unsubChunkRef = useRef<(() => void) | null>(null);

  const chapters: ChapterOutline[] = project?.outline?.chapters ?? [];
  const hasOutline = (project?.outline?.chapters?.length ?? 0) > 0;

  useEffect(() => {
    return () => {
      unsubChunkRef.current?.();
    };
  }, []);

  if (!project) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Empty description="未选择项目" />
        <Button type="primary" style={{ marginTop: 16 }} onClick={() => setStage('projects')}>
          返回项目列表
        </Button>
      </div>
    );
  }

  const ensureOutline = (): GeneratedOutline => {
    if (project.outline) return project.outline;
    const p = project.config.parameters;
    return {
      workInfo: {
        suggestedTitle: p.creativeDescription.substring(0, 20) || '新作品',
        novelType: p.novelType,
        estimatedWordCount: p.targetWordCount,
        chapterCount: p.chapterCount,
        creativeDescription: p.creativeDescription,
      },
      storyLine: {
        coreConflict: '',
        storyArc: { beginning: '', development: '', climax: '', resolution: '' },
        theme: '',
      },
      chapters: buildDefaultChapters(p.chapterCount, p.targetWordCount),
      characterRelationships: [],
      worldbuildingNotes: [],
    };
  };

  const saveChapters = (next: ChapterOutline[]) => {
    const outline = ensureOutline();
    const total = next.reduce((sum, c) => sum + (c.targetWordCount || 0), 0);
    patchProject(project.id, {
      outline: {
        ...outline,
        chapters: next,
        workInfo: { ...outline.workInfo, chapterCount: next.length, estimatedWordCount: total || outline.workInfo.estimatedWordCount },
      },
      status: ProjectStatus.OUTLINING,
    });
  };

  const handleGenerate = async () => {
    const api = getWritingV2API();
    if (!api) return;
    setIsGenerating(true);
    setStreamText('');
    setCot(null);
    // 订阅流式 chunk
    unsubChunkRef.current?.();
    unsubChunkRef.current = api.onOutlineChunk(({ chunk }) => {
      setStreamText((prev) => prev + chunk);
    });
    try {
      const result = await api.generateOutline({
        resources: project.config.resources,
        parameters: project.config.parameters,
        modelConfig: project.config.modelConfig,
      });
      if (result.chainOfThought) setCot(result.chainOfThought);
      if (!result.success || !result.outlineRaw) {
        message.error(result.error || '大纲生成失败');
        setIsGenerating(false);
        return;
      }
      // 解析原始文本 → 结构化大纲 → 落盘
      const parsed = await api.parseOutline(result.outlineRaw);
      if (!parsed.success || !parsed.outline) {
        message.error(parsed.error || '大纲解析失败，可在下方手动编辑');
        setIsGenerating(false);
        return;
      }
      // 按配置章节数对齐（与 V1 saveOutline 行为一致：缺省章节补默认值）
      const wantCount = project.config.parameters.chapterCount;
      let finalChapters = parsed.outline.chapters || [];
      if (wantCount > 0) {
        finalChapters = Array.from({ length: wantCount }, (_, i) => {
          const src = finalChapters[i];
          const per = Math.max(
            100,
            Math.round(project.config.parameters.targetWordCount / wantCount)
          );
          return {
            index: i,
            title: src?.title || `第${i + 1}章`,
            summary: src?.summary || '',
            keyPlotPoints: src?.keyPlotPoints || [],
            characters: src?.characters || [],
            scenes: src?.scenes || [],
            targetWordCount: src?.targetWordCount || per,
            content: '',
          };
        });
      }
      patchProject(project.id, {
        outline: { ...parsed.outline, chapters: finalChapters },
        outlineRaw: result.outlineRaw,
        status: ProjectStatus.OUTLINING,
      });
      message.success('大纲生成完成，可继续编辑后确认');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '大纲生成失败');
    } finally {
      setIsGenerating(false);
      unsubChunkRef.current?.();
      unsubChunkRef.current = null;
    }
  };

  const handleCancel = useCallback(async () => {
    const api = getWritingV2API();
    if (!api) return;
    await api.cancelGeneration(project.id);
    setIsGenerating(false);
    unsubChunkRef.current?.();
    unsubChunkRef.current = null;
    message.info('已取消生成');
  }, [project.id]);

  const handleConfirm = () => {
    if (!hasOutline) {
      message.warning('请先生成或编辑大纲章节');
      return;
    }
    patchProject(project.id, { status: ProjectStatus.OUTLINING });
    setStage('writing');
  };

  const workInfo = project.outline?.workInfo;

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{workInfo?.suggestedTitle || project.title}</h2>
          <Space size={4} style={{ marginTop: 4 }}>
            {workInfo && (
              <Tag>{V2_NOVEL_TYPE_LABELS[workInfo.novelType as NovelType] || workInfo.novelType}</Tag>
            )}
            <Tag>目标 {workInfo?.estimatedWordCount ?? project.config.parameters.targetWordCount} 字</Tag>
            <Tag>{chapters.length} 章</Tag>
          </Space>
        </div>
        <Space>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as 'ai' | 'manual')}
            options={[
              { label: 'AI 生成', value: 'ai' },
              { label: '手动大纲', value: 'manual' },
            ]}
          />
          {mode === 'ai' && !isGenerating && (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleGenerate}>
              {hasOutline ? '重新生成大纲' : '生成大纲'}
            </Button>
          )}
          {isGenerating && (
            <Button danger icon={<StopOutlined />} onClick={handleCancel}>
              停止
            </Button>
          )}
          <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirm}>
            确认大纲，进入创作
          </Button>
        </Space>
      </div>

      {/* AI 流式预览 */}
      {isGenerating && (
        <Card
          size="small"
          style={{ marginBottom: 16, borderColor: token.colorPrimary }}
          title={
            <span>
              <Spin size="small" style={{ marginRight: 8 }} />
              AI 正在生成大纲…
            </span>
          }
        >
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflow: 'auto',
              margin: 0,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          >
            {streamText || '等待首个片段…'}
          </pre>
        </Card>
      )}

      {/* CoT 展示 */}
      {cot?.rawData && (
        <Card size="small" style={{ marginBottom: 16 }} title={<span><AntCloudOutlined style={{ marginRight: 8, color: token.colorPrimary }} />AI 思考过程{cot.model ? <Tag style={{ marginLeft: 8 }}>{cot.model}</Tag> : null}</span>}>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflow: 'auto',
              margin: 0,
              fontSize: 12,
              fontFamily: 'monospace',
              color: token.colorTextSecondary,
            }}
          >
            {cot.formattedData || cot.rawData}
          </pre>
        </Card>
      )}

      {/* 章节大纲编辑（AI 模式生成后可编辑；手动模式直接编辑） */}
      <Card
        size="small"
        title={`章节大纲（${chapters.length}）`}
        extra={
          mode === 'manual' && !hasOutline ? (
            <Button
              size="small"
              onClick={() => {
                saveChapters(
                buildDefaultChapters(
                    project.config.parameters.chapterCount,
                    project.config.parameters.targetWordCount
                  )
                );
              }}
            >
              初始化章节列表
            </Button>
          ) : null
        }
      >
        <V2OutlineChapterList chapters={chapters} onChange={saveChapters} />
      </Card>
    </div>
  );
};

export default V2OutlineWorkbench;
