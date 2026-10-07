import React, { useEffect, useState } from 'react';
import { Space, Tag, Tooltip, theme } from 'antd';
import {
  GlobalOutlined,
  TeamOutlined,
  UserOutlined,
  FontSizeOutlined,
  RobotOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { WritingProject } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';

/** 名称映射模块级缓存：大纲/创作阶段来回切换不重复请求 */
let nameMapCache: { map: Record<string, string>; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadNameMap(): Promise<Record<string, string>> {
  if (nameMapCache && Date.now() - nameMapCache.ts < CACHE_TTL_MS) return nameMapCache.map;
  const api = getWritingV2API();
  if (!api) return nameMapCache?.map ?? {};
  try {
    const [wb, ch, p, st] = await Promise.all([
      api.resources.listWorldBooks(),
      api.resources.listCharacters(),
      api.resources.listPersonas(),
      api.style.list(),
    ]);
    const map: Record<string, string> = {};
    for (const c of wb.candidates) map[c.id] = c.name;
    for (const c of ch.candidates) map[c.id] = c.name;
    for (const c of p.candidates) map[c.id] = c.name;
    for (const s of st.styles) map[s.id] = s.name;
    nameMapCache = { map, ts: Date.now() };
    return map;
  } catch {
    return nameMapCache?.map ?? {};
  }
}

const GROUPS = [
  { key: 'worldBookIds', label: '世界书', icon: <GlobalOutlined /> },
  { key: 'characterCardIds', label: '角色卡', icon: <TeamOutlined /> },
  { key: 'userPersonaIds', label: '人设', icon: <UserOutlined /> },
  { key: 'writingStyleIds', label: '风格', icon: <FontSizeOutlined /> },
] as const;

interface V2BoundResourceBarProps {
  project: WritingProject;
}

/**
 * V2 已绑定上下文指示条（内联，置于大纲/创作阶段顶栏右侧）
 *
 * 目的：让"素材已被带入生成"在界面上可见——
 *  - 已绑定：图标+数量 Tag（hover 显示具体名称），右侧附 AI 模型 Tag；
 *  - 未绑定：明确提示"未绑定素材"，避免用户误以为绑定未生效。
 * 注入链路（均消费 project.config.resources）：大纲生成 / 分片生成 / 剧情检查。
 */
const V2BoundResourceBar: React.FC<V2BoundResourceBarProps> = ({ project }) => {
  const { token } = theme.useToken();
  const [nameMap, setNameMap] = useState<Record<string, string>>(nameMapCache?.map ?? {});

  useEffect(() => {
    let cancelled = false;
    void loadNameMap().then((map) => {
      if (!cancelled) setNameMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const resources = project.config.resources;
  const bound = GROUPS.filter((g) => (resources?.[g.key] ?? []).length > 0);
  const total = bound.reduce((n, g) => n + (resources?.[g.key] ?? []).length, 0);
  const model = project.config.modelConfig;

  const namesOf = (ids: string[]): string[] =>
    ids.map((id) => nameMap[id] ?? id.split(/[\\/]/).pop() ?? id);

  return (
    <Space size={6} align="center">
      <span style={{ fontSize: 11, color: token.colorTextTertiary, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <LinkOutlined style={{ fontSize: 11 }} />
        上下文
      </span>
      {total === 0 ? (
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
          未绑定素材（生成不含素材上下文）· 左栏「素材与风格」可绑定
        </span>
      ) : (
        bound.map((g) => {
          const ids = resources?.[g.key] ?? [];
          const names = namesOf(ids);
          const preview = names.slice(0, 3).join('、');
          const tip = names.length > 3 ? `${preview} 等 ${names.length} 项` : preview;
          return (
            <Tooltip key={g.key} title={tip}>
              <Tag icon={g.icon} color="cyan" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
                {g.label} {ids.length}
              </Tag>
            </Tooltip>
          );
        })
      )}
      {model?.model && (
        <Tag icon={<RobotOutlined />} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
          {model.model}
          {typeof model.temperature === 'number' ? ` · T${model.temperature}` : ''}
        </Tag>
      )}
    </Space>
  );
};

export default V2BoundResourceBar;
