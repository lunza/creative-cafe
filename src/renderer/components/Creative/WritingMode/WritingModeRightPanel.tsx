import React, { useState, useEffect } from 'react';
import { Tabs, Input, Button, Empty, List, Avatar, Card, Tooltip } from 'antd';
import { BookOutlined, RobotOutlined, EyeOutlined, SearchOutlined, UserOutlined, IdcardOutlined, GlobalOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';

const { TextArea } = Input;

interface ResourceItem {
  id: string;
  name: string;
  description?: string;
}

interface WritingModeRightPanelProps {
  width: number;
  onClose: () => void;
}

const WritingModeRightPanel: React.FC<WritingModeRightPanelProps> = ({ width, onClose }) => {
  const { token } = theme.useToken();
  const projects = useWritingProjectStore((state) => state.projects);
  const currentProjectId = useWritingProjectStore((state) => state.currentProjectId);
  const currentProject = currentProjectId ? projects.find((p) => p.id === currentProjectId) || null : null;

  const [worldBooks, setWorldBooks] = useState<ResourceItem[]>([]);
  const [characters, setCharacters] = useState<ResourceItem[]>([]);
  const [personas, setPersonas] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentProject) {
      setWorldBooks([]);
      setCharacters([]);
      setPersonas([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const config = currentProject.config;
    const worldBookIds = config.resources?.worldBookIds || [];
    const characterCardIds = config.resources?.characterCardIds || [];
    const userPersonaIds = config.resources?.userPersonaIds || [];

    Promise.all([
      worldBookIds.length > 0 && window.electronAPI?.worldBook?.list()
        ? window.electronAPI.worldBook.list()
        : Promise.resolve([]),
      characterCardIds.length > 0 && window.electronAPI?.character?.list()
        ? window.electronAPI.character.list()
        : Promise.resolve([]),
      userPersonaIds.length > 0 && window.electronAPI?.avatar?.list()
        ? window.electronAPI.avatar.list()
        : Promise.resolve([]),
    ]).then(([worldBooksResult, charactersResult, personasResult]) => {
      const wbList = Array.isArray(worldBooksResult) ? worldBooksResult : [];
      const chList = Array.isArray(charactersResult) ? charactersResult : [];
      const paList = Array.isArray(personasResult) ? personasResult : [];

      const matchedWorldBooks = wbList
        .filter((wb: any) => worldBookIds.includes(wb.path))
        .map((wb: any) => ({
          id: wb.path,
          name: wb.name.replace(/\.(json|json5)$/i, ''),
          description: '',
        }));

      const matchedCharacters = chList
        .filter((ch: any) => characterCardIds.includes(ch.path))
        .map((ch: any) => ({
          id: ch.path,
          name: ch.characterName || ch.name.replace(/\.(png|jpg|jpeg|webp)$/i, ''),
          description: '',
        }));

      const matchedPersonas = paList
        .filter((p: any) => userPersonaIds.includes(p.path))
        .map((p: any) => ({
          id: p.path,
          name: p.name || p.path.replace(/\.json$/i, ''),
          description: p.description || '',
        }));

      setWorldBooks(matchedWorldBooks);
      setCharacters(matchedCharacters);
      setPersonas(matchedPersonas);
      setLoading(false);
    }).catch((err) => {
      console.error('[WritingModeRightPanel] Load resources error:', err);
      setLoading(false);
    });
  }, [currentProject]);

  const renderResourceList = (items: ResourceItem[], emptyText: string, icon: React.ReactNode) => (
    <List
      locale={{ emptyText }}
      dataSource={items}
      loading={loading}
      renderItem={(item: ResourceItem) => (
        <List.Item>
          <List.Item.Meta
            avatar={<Avatar icon={icon} />}
            title={item.name}
            description={item.description || '暂无描述'}
          />
        </List.Item>
      )}
    />
  );

  const tabItems = [
    {
      key: 'materials',
      label: (
        <span>
          <BookOutlined />
          素材库
        </span>
      ),
      children: (
        <div style={{ padding: '16px 0' }}>
          <Input
            placeholder="搜索素材..."
            prefix={<SearchOutlined />}
            style={{ marginBottom: 16 }}
          />
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>
              <GlobalOutlined style={{ marginRight: 4 }} />
              世界书
            </h4>
            {renderResourceList(worldBooks, currentProject ? '暂无世界书' : '请先选择或创建项目', <GlobalOutlined />)}
          </div>
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>
              <IdcardOutlined style={{ marginRight: 4 }} />
              角色卡
            </h4>
            {renderResourceList(characters, currentProject ? '暂无角色卡' : '请先选择或创建项目', <IdcardOutlined />)}
          </div>
          <div>
            <h4 style={{ marginBottom: 8 }}>
              <UserOutlined style={{ marginRight: 4 }} />
              用户人设
            </h4>
            {renderResourceList(personas, currentProject ? '暂无用户人设' : '请先选择或创建项目', <UserOutlined />)}
          </div>
        </div>
      ),
    },
    {
      key: 'ai',
      label: (
        <span>
          <RobotOutlined />
          AI 助手
        </span>
      ),
      children: (
        <div style={{ padding: '16px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              border: `1px solid ${token.colorBorder}`,
              borderRadius: token.borderRadius,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <Empty description="开始与 AI 助手对话，获取章节创作建议" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <TextArea
              placeholder="输入你的问题，例如：这章应该怎样开头？"
              rows={3}
              style={{ flex: 1 }}
            />
            <Button type="primary" size="large">
              发送
            </Button>
          </div>
        </div>
      ),
    },
    {
      key: 'preview',
      label: (
        <span>
          <EyeOutlined />
          预览
        </span>
      ),
      children: (
        <div style={{ padding: '16px 0' }}>
          <Empty description="选择章节进行预览" />
          <Card
            style={{ marginTop: 16 }}
            title="章节内容预览"
            bordered={false}
          >
            <div
              style={{
                minHeight: 200,
                padding: 16,
                border: `1px dashed ${token.colorBorder}`,
                borderRadius: token.borderRadius,
                color: token.colorTextSecondary,
              }}
            >
              章节预览内容将在这里显示...
            </div>
          </Card>
        </div>
      ),
    },
  ];

  return (
    <div
      style={{
        width,
        height: '100%',
        borderLeft: `1px solid ${token.colorBorder}`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: token.colorBgContainer,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorder}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0 }}>辅助面板</h3>
        <Button onClick={onClose} size="small">
          关闭
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 16px' }}>
        <Tabs defaultActiveKey="materials" items={tabItems} style={{ height: '100%' }} />
      </div>
    </div>
  );
};

export default WritingModeRightPanel;
