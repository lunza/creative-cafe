/**
 * 漫画解析：单页分析 + 结果预览 + 手动修正
 *
 * Spec: integrate-comic-parsing-mode /
 *   Requirement「AI 单页漫画分析」+「识别结果预览与手动修正」
 *
 * - 「分析此页」按钮（检测 supportsVision，不满足时提示）
 * - 加载状态
 * - 结果分区展示：角色/场景/剧情/情感/文本
 * - 手动修正：每个字段可编辑，保存后标记「已修正」
 * - AI 返回格式错误时显示提示 + 重试按钮
 */
import React, { useEffect, useState } from 'react';
import {
  Button,
  Spin,
  Input,
  Select,
  Tag,
  Empty,
  Alert,
  theme,
} from 'antd';
import {
  ScanOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type {
  MangaPageAnalysis,
  MangaCharacterAnalysis,
  MangaTextExtraction,
} from '../../../../../shared/types/writing-v2.types';

interface Props {
  pageIndex: number;
  analysis: MangaPageAnalysis | null;
  analyzing: boolean;
  supportsVision: boolean;
  /** 触发分析，可携带用户引导提示（可选） */
  onAnalyze: (userGuidance?: string) => void;
  onSaveAnalysis: (updated: MangaPageAnalysis) => void;
  /** 中止进行中的分析（manga:cancel('analyzePage')，可选） */
  onStopAnalyzing?: () => void;
}

const TEXT_TYPE_OPTIONS = [
  { value: 'dialogue', label: '对话' },
  { value: 'narration', label: '旁白' },
  { value: 'soundEffect', label: '拟音' },
];

const V2MangaAnalysisPanel: React.FC<Props> = ({
  pageIndex,
  analysis,
  analyzing,
  supportsVision,
  onAnalyze,
  onSaveAnalysis,
  onStopAnalyzing,
}) => {
  const { token } = theme.useToken();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MangaPageAnalysis | null>(null);
  /** 用户提供的页面内容引导提示（输入框，分析时携带给 AI） */
  const [userGuidance, setUserGuidance] = useState('');

  // 当 analysis 变化且不在编辑态时，同步 draft
  useEffect(() => {
    if (!editing) setDraft(analysis);
  }, [analysis, editing]);

  const startEdit = () => {
    if (!analysis) return;
    setDraft(JSON.parse(JSON.stringify(analysis)));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(analysis);
  };

  const saveEdit = () => {
    if (!draft) return;
    onSaveAnalysis({ ...draft, userModified: true });
    setEditing(false);
  };

  const data = editing ? draft : analysis;

  if (analyzing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
        <Spin size="large" />
        <span style={{ color: token.colorTextSecondary }}>AI 分析中，请稍候...</span>
        {onStopAnalyzing && (
          <Button size="small" danger icon={<StopOutlined />} onClick={onStopAnalyzing}>
            停止分析
          </Button>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <Button
          type="primary"
          icon={<ScanOutlined />}
          onClick={() => onAnalyze(userGuidance.trim() || undefined)}
          disabled={!supportsVision}
          title={supportsVision ? '' : '当前 AI 模型不支持图片识别'}
        >
          {analysis ? `重新分析第 ${pageIndex} 页` : `分析第 ${pageIndex} 页`}
        </Button>
        {analysis && !editing && (
          <Button icon={<EditOutlined />} onClick={startEdit}>
            编辑修正
          </Button>
        )}
        {editing && (
          <>
            <Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>
              保存修正
            </Button>
            <Button icon={<CloseOutlined />} onClick={cancelEdit}>
              取消
            </Button>
          </>
        )}
        {analysis?.userModified && !editing && (
          <Tag color="orange">已修正</Tag>
        )}
      </div>

      {/* 用户引导输入区（分析前可填写，帮助 AI 更准确识别） */}
      {!analyzing && (
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>
            页面内容引导（可选，帮助 AI 更准确识别）
          </div>
          <Input.TextArea
            rows={2}
            value={userGuidance}
            onChange={(e) => setUserGuidance(e.target.value)}
            placeholder="例如：这一页有3个格子，主角小明和神秘人在暗室对话，小明表情紧张"
            disabled={editing}
          />
        </div>
      )}

      {!supportsVision && (
        <Alert
          type="warning"
          showIcon
          message="当前 AI 模型不支持图片识别，请切换到多模态模型"
          style={{ marginBottom: 12, flexShrink: 0 }}
        />
      )}

      {/* 内容区 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {!data ? (
          <Empty description="尚未分析，点击「分析」开始" style={{ marginTop: 48 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 角色区 */}
            <Section title="角色识别">
              {data.pageAnalysis.characters.length === 0 ? (
                <Empty description="未识别到角色" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                data.pageAnalysis.characters.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Field
                      value={c.name}
                      placeholder="角色名/描述"
                      disabled={!editing}
                      onChange={(v) =>
                        updateChar(data, i, { name: v }, setDraft)
                      }
                    />
                    <Field
                      value={c.expression}
                      placeholder="表情"
                      disabled={!editing}
                      onChange={(v) => updateChar(data, i, { expression: v }, setDraft)}
                    />
                    <Field
                      value={c.action}
                      placeholder="动作"
                      disabled={!editing}
                      onChange={(v) => updateChar(data, i, { action: v }, setDraft)}
                    />
                    {editing && (
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => removeChar(data, i, setDraft)}
                      />
                    )}
                  </div>
                ))
              )}
              {editing && (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => addChar(data, setDraft)}
                >
                  添加角色
                </Button>
              )}
            </Section>

            {/* 场景区 */}
            <Section title="场景分析">
              {(['environment', 'time', 'location', 'atmosphere'] as const).map((key) => (
                <div key={key} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>
                    {key === 'environment' && '环境'}
                    {key === 'time' && '时间'}
                    {key === 'location' && '地点'}
                    {key === 'atmosphere' && '氛围'}
                  </div>
                  <Input
                    value={data.pageAnalysis.scene[key]}
                    disabled={!editing}
                    onChange={(e) =>
                      updateScene(data, key, e.target.value, setDraft)
                    }
                  />
                </div>
              ))}
            </Section>

            {/* 剧情区（逐格） */}
            <Section title="剧情理解（逐格）">
              {data.pageAnalysis.panels.map((panel, pi) => (
                <div key={pi} style={{ marginBottom: 12, padding: 8, background: token.colorFillQuaternary, borderRadius: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 6 }}>
                    格 {panel.panelIndex}
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>剧情</div>
                    <Input.TextArea
                      rows={2}
                      value={panel.plot}
                      disabled={!editing}
                      onChange={(e) => updatePanel(data, pi, 'plot', e.target.value, setDraft)}
                    />
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>情绪</div>
                    <Input
                      value={panel.emotion}
                      disabled={!editing}
                      onChange={(e) => updatePanel(data, pi, 'emotion', e.target.value, setDraft)}
                    />
                  </div>
                  {/* 文本提取 */}
                  {panel.texts.map((t, ti) => (
                    <div key={ti} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <Select
                        size="small"
                        style={{ width: 80, flexShrink: 0 }}
                        value={t.type}
                        disabled={!editing}
                        options={TEXT_TYPE_OPTIONS}
                        onChange={(v) => updateText(data, pi, ti, { type: v as MangaTextExtraction['type'] }, setDraft)}
                      />
                      <Field
                        value={t.content}
                        placeholder="文本内容"
                        disabled={!editing}
                        onChange={(v) => updateText(data, pi, ti, { content: v }, setDraft)}
                      />
                      <Field
                        value={t.position}
                        placeholder="位置"
                        disabled={!editing}
                        style={{ width: 90, flexShrink: 0 }}
                        onChange={(v) => updateText(data, pi, ti, { position: v }, setDraft)}
                      />
                      {editing && (
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => removeText(data, pi, ti, setDraft)}
                        />
                      )}
                    </div>
                  ))}
                  {editing && (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => addText(data, pi, setDraft)}
                    >
                      添加文本
                    </Button>
                  )}
                </div>
              ))}
            </Section>

            {/* 情感区 */}
            <Section title="情感识别">
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>整页情绪氛围</div>
                <Input.TextArea
                  rows={2}
                  value={data.pageAnalysis.overallEmotion}
                  disabled={!editing}
                  onChange={(e) =>
                    setDraft({
                      ...data,
                      pageAnalysis: { ...data.pageAnalysis, overallEmotion: e.target.value },
                    })
                  }
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>叙事衔接</div>
                <Input.TextArea
                  rows={2}
                  value={data.pageAnalysis.narrativeContinuity}
                  disabled={!editing}
                  onChange={(e) =>
                    setDraft({
                      ...data,
                      pageAnalysis: { ...data.pageAnalysis, narrativeContinuity: e.target.value },
                    })
                  }
                />
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== 辅助组件 ====================

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const { token } = theme.useToken();
  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: token.colorTextSecondary,
          margin: '0 0 8px',
          paddingBottom: 4,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {title}
      </div>
      <div style={{ color: token.colorText }}>{children}</div>
    </div>
  );
};

const Field: React.FC<{
  value: string;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  onChange: (v: string) => void;
}> = ({ value, placeholder, disabled, style, onChange }) => (
  <Input
    size="small"
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    style={style}
    onChange={(e) => onChange(e.target.value)}
  />
);

// ==================== 不可变更新辅助函数 ====================

function updateChar(
  analysis: MangaPageAnalysis,
  index: number,
  patch: Partial<MangaCharacterAnalysis>,
  setDraft: (a: MangaPageAnalysis) => void
) {
  const chars = analysis.pageAnalysis.characters.map((c, i) => (i === index ? { ...c, ...patch } : c));
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, characters: chars } });
}

function removeChar(analysis: MangaPageAnalysis, index: number, setDraft: (a: MangaPageAnalysis) => void) {
  const chars = analysis.pageAnalysis.characters.filter((_, i) => i !== index);
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, characters: chars } });
}

function addChar(analysis: MangaPageAnalysis, setDraft: (a: MangaPageAnalysis) => void) {
  const chars = [...analysis.pageAnalysis.characters, { name: '', expression: '', action: '' }];
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, characters: chars } });
}

function updateScene(
  analysis: MangaPageAnalysis,
  key: keyof import('../../../../../shared/types/writing-v2.types').MangaSceneAnalysis,
  value: string,
  setDraft: (a: MangaPageAnalysis) => void
) {
  setDraft({
    ...analysis,
    pageAnalysis: {
      ...analysis.pageAnalysis,
      scene: { ...analysis.pageAnalysis.scene, [key]: value },
    },
  });
}

function updatePanel(
  analysis: MangaPageAnalysis,
  panelIndex: number,
  field: 'plot' | 'emotion',
  value: string,
  setDraft: (a: MangaPageAnalysis) => void
) {
  const panels = analysis.pageAnalysis.panels.map((p, i) => (i === panelIndex ? { ...p, [field]: value } : p));
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, panels } });
}

function updateText(
  analysis: MangaPageAnalysis,
  panelIndex: number,
  textIndex: number,
  patch: Partial<MangaTextExtraction>,
  setDraft: (a: MangaPageAnalysis) => void
) {
  const panels = analysis.pageAnalysis.panels.map((p, pi) => {
    if (pi !== panelIndex) return p;
    return {
      ...p,
      texts: p.texts.map((t, ti) => (ti === textIndex ? { ...t, ...patch } : t)),
    };
  });
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, panels } });
}

function removeText(analysis: MangaPageAnalysis, panelIndex: number, textIndex: number, setDraft: (a: MangaPageAnalysis) => void) {
  const panels = analysis.pageAnalysis.panels.map((p, pi) => {
    if (pi !== panelIndex) return p;
    return { ...p, texts: p.texts.filter((_, ti) => ti !== textIndex) };
  });
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, panels } });
}

function addText(analysis: MangaPageAnalysis, panelIndex: number, setDraft: (a: MangaPageAnalysis) => void) {
  const panels = analysis.pageAnalysis.panels.map((p, pi) => {
    if (pi !== panelIndex) return p;
    return { ...p, texts: [...p.texts, { content: '', type: 'dialogue' as const, position: '' }] };
  });
  setDraft({ ...analysis, pageAnalysis: { ...analysis.pageAnalysis, panels } });
}

export default V2MangaAnalysisPanel;
