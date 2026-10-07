import React, { useState } from 'react';
import { Empty, theme } from 'antd';
import {
  DatabaseOutlined,
  FontSizeOutlined,
  AppstoreAddOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import type { WritingProject } from '../../../../../shared/types/writing-v2.types';
import V2ResourceBindingPanel from './V2ResourceBindingPanel';
import V2StyleLearningPanel from './V2StyleLearningPanel';
import V2TemplatePanel from './V2TemplatePanel';
import V2MangaStage from '../manga/V2MangaStage';

interface V2AssetsStageProps {
  /** 当前项目（素材绑定为项目级；风格学习/模板管理为全局，可为 null） */
  project: WritingProject | null;
}

/**
 * V2 素材与风格阶段（Phase 3 容器）
 * 四个子面板：素材绑定（项目级）/ 风格学习（全局）/ 模板管理（全局）/ 漫画解析（全局）。
 * 漫画解析：Spec integrate-comic-parsing-mode
 */
const V2AssetsStage: React.FC<V2AssetsStageProps> = ({ project }) => {
  const { token } = theme.useToken();
  const [tab, setTab] = useState<'binding' | 'style' | 'template' | 'manga'>('binding');

  const tabs = [
    { key: 'binding', icon: <DatabaseOutlined />, label: '素材绑定' },
    { key: 'style', icon: <FontSizeOutlined />, label: '风格学习' },
    { key: 'template', icon: <AppstoreAddOutlined />, label: '模板管理' },
    { key: 'manga', icon: <PictureOutlined />, label: '漫画解析' },
  ] as const;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: token.colorBgContainer }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${token.colorBorderSecondary}`, flexShrink: 0 }}>
        {tabs.map((t) => (
          <div
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '10px 0',
              fontSize: 13,
              cursor: 'pointer',
              color: tab === t.key ? token.colorPrimary : token.colorTextSecondary,
              borderBottom: tab === t.key ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
              fontWeight: tab === t.key ? 600 : 400,
            }}
          >
            {t.icon} {t.label}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'binding' &&
          (project ? (
            <V2ResourceBindingPanel project={project} />
          ) : (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Empty description="素材绑定为项目级，请先在「项目列表」选择或新建项目" />
            </div>
          ))}
        {tab === 'style' && <V2StyleLearningPanel />}
        {tab === 'template' && <V2TemplatePanel />}
        {tab === 'manga' && <V2MangaStage />}
      </div>
    </div>
  );
};

export default V2AssetsStage;
