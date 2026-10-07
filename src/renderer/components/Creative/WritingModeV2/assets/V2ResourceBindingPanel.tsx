import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Select, Space, Tag, Spin, theme, message } from 'antd';
import { SaveOutlined, LinkOutlined } from '@ant-design/icons';
import type {
  WritingProject,
  V2ResourceCandidate,
  WritingStyleResource,
} from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { useV2ProjectStore } from '../stores/useV2ProjectStore';
import { V2_RESOURCE_GROUPS, buildResourcesPatch, type V2ResourceGroupKey } from './v2ResourceUtils';

interface V2ResourceBindingPanelProps {
  project: WritingProject;
}

/**
 * V2 素材绑定面板（Phase 3 / P2 扩展能力）
 *
 * 四组多选：世界书 / 角色卡 / 人设 / 写作风格。
 * 候选列表经 writingV2.resources（preload 归一化）加载；
 * 保存时 patchProject(config.resources) 防抖落盘，主进程生成/检查管线自动注入
 * （H4：plotcheck 读 project.config?.resources；分片生成请求已透传 resources）。
 */
const V2ResourceBindingPanel: React.FC<V2ResourceBindingPanelProps> = ({ project }) => {
  const { token } = theme.useToken();
  const patchProject = useV2ProjectStore((s) => s.patchProject);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [worldBooks, setWorldBooks] = useState<V2ResourceCandidate[]>([]);
  const [characters, setCharacters] = useState<V2ResourceCandidate[]>([]);
  const [personas, setPersonas] = useState<V2ResourceCandidate[]>([]);
  const [styles, setStyles] = useState<WritingStyleResource[]>([]);
  const [selected, setSelected] = useState<Record<V2ResourceGroupKey, string[]>>({
    worldBookIds: [],
    characterCardIds: [],
    userPersonaIds: [],
    writingStyleIds: [],
  });

  const reload = useCallback(async () => {
    const api = getWritingV2API();
    if (!api) return;
    setLoading(true);
    try {
      const [wbRes, chRes, pRes, styleRes] = await Promise.all([
        api.resources.listWorldBooks(),
        api.resources.listCharacters(),
        api.resources.listPersonas(),
        api.style.list(),
      ]);
      setWorldBooks(wbRes.success ? wbRes.candidates : []);
      setCharacters(chRes.success ? chRes.candidates : []);
      setPersonas(pRes.success ? pRes.candidates : []);
      setStyles(styleRes.success ? styleRes.styles : []);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载候选 + 初始化选中集（以项目当前 resources 为准）
  useEffect(() => {
    reload();
    const r = project.config.resources;
    setSelected({
      worldBookIds: r?.worldBookIds ?? [],
      characterCardIds: r?.characterCardIds ?? [],
      userPersonaIds: r?.userPersonaIds ?? [],
      writingStyleIds: r?.writingStyleIds ?? [],
    });
    // 仅项目切换时重置选中集（候选 reload 独立）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const setGroup = (group: V2ResourceGroupKey, ids: string[]) =>
    setSelected((prev) => ({ ...prev, [group]: ids }));

  const handleSave = async () => {
    // 以选中集为准重建四组绑定，保留未分组字段（knowledgeItemIds / referenceMaterials）
    const next = buildResourcesPatch(
      project.config.resources,
      'worldBookIds',
      selected.worldBookIds
    );
    next.characterCardIds = selected.characterCardIds;
    next.userPersonaIds = selected.userPersonaIds;
    next.writingStyleIds = selected.writingStyleIds;
    setSaving(true);
    try {
      patchProject(project.id, {
        config: { ...project.config, resources: next },
      });
      message.success('素材绑定已保存，生成/剧情检查将自动注入');
    } finally {
      setSaving(false);
    }
  };

  const totalBound =
    selected.worldBookIds.length +
    selected.characterCardIds.length +
    selected.userPersonaIds.length +
    selected.writingStyleIds.length;

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载素材候选列表…" />
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', height: '100%' }}>
      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
        绑定的素材将作为上下文注入分片生成、大纲生成与剧情检查（项目级，防抖自动落盘）。
      </div>

      {V2_RESOURCE_GROUPS.map((group) => {
        const candidates =
          group.key === 'worldBookIds'
            ? worldBooks
            : group.key === 'characterCardIds'
              ? characters
              : group.key === 'userPersonaIds'
                ? personas
                : null;
        const styleOptions =
          group.key === 'writingStyleIds'
            ? styles.map((s) => ({ label: s.name, value: s.id }))
            : [];
        const candidateOptions =
          candidates?.map((c) => ({
            label: c.description ? `${c.name}（${c.description.slice(0, 20)}）` : c.name,
            value: c.id,
          })) ?? [];
        const options = group.key === 'writingStyleIds' ? styleOptions : candidateOptions;
        return (
          <Card
            key={group.key}
            size="small"
            title={
              <Space size={8}>
                <LinkOutlined style={{ color: token.colorPrimary }} />
                {group.label}
                <Tag>{selected[group.key].length}</Tag>
              </Space>
            }
          >
            <Select
              mode="multiple"
              allowClear
              size="small"
              style={{ width: '100%' }}
              placeholder={options.length === 0 ? `暂无可用${group.label}` : `选择${group.label}（可多选）`}
              value={selected[group.key]}
              onChange={(ids: string[]) => setGroup(group.key, ids)}
              options={options}
              optionFilterProp="label"
              maxTagCount="responsive"
            />
          </Card>
        );
      })}

      <Space>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={totalBound === 0 && !project.config.resources?.worldBookIds?.length}
          onClick={handleSave}
        >
          保存绑定
        </Button>
        <Button size="small" onClick={reload}>
          刷新候选
        </Button>
      </Space>
    </div>
  );
};

export default V2ResourceBindingPanel;
