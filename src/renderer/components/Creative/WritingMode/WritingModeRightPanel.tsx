import React, { useState, useCallback } from 'react';
import { Tabs, Input, Button, Empty, Tag, Tooltip, Typography, Spin, Badge } from 'antd';
import { BookOutlined, RobotOutlined, EyeOutlined, SearchOutlined, ReloadOutlined, GlobalOutlined, IdcardOutlined, UserOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { MaterialType } from '../../../shared/types/writing.types';
import { useWritingMaterials } from './useWritingMaterials';
import MaterialList from './MaterialList';

const { TextArea } = Input;
const { Text } = Typography;

interface WritingModeRightPanelProps {
  width: number;
  onClose: () => void;
}

const WritingModeRightPanel: React.FC<WritingModeRightPanelProps> = ({ width, onClose }) => {
  const { token } = theme.useToken();
  const {
    loading,
    searchQuery,
    setSearchQuery,
    filteredWorldBooks,
    filteredCharacters,
    filteredPersonas,
    filteredKnowledgeItems,
    toggleMaterial,
    getSelectedCount,
    refreshMaterials,
  } = useWritingMaterials();

  const [activeMaterialTab, setActiveMaterialTab] = useState<string>('worldbook');
  const [selectedSummaryVisible, setSelectedSummaryVisible] = useState(false);

  const handleRefresh = useCallback(() => {
    refreshMaterials();
  }, [refreshMaterials]);

  const handleToggleMaterial = useCallback(
    (type: MaterialType, id: string) => {
      toggleMaterial(type, id);
    },
    [toggleMaterial]
  );

  const selectedWorldBookCount = getSelectedCount('worldbook');
  const selectedCharacterCount = getSelectedCount('character');
  const selectedPersonaCount = getSelectedCount('persona');
  const selectedKnowledgeCount = getSelectedCount('knowledge');
  const totalSelected = selectedWorldBookCount + selectedCharacterCount + selectedPersonaCount + selectedKnowledgeCount;

  const materialSubTabs = [
    {
      key: 'worldbook',
      label: (
        <Badge count={selectedWorldBookCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <GlobalOutlined />
            世界书
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredWorldBooks}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="worldbook"
          emptyText={searchQuery ? '未匹配的世界书' : '暂无世界书'}
        />
      ),
    },
    {
      key: 'character',
      label: (
        <Badge count={selectedCharacterCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <IdcardOutlined />
            角色卡
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredCharacters}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="character"
          emptyText={searchQuery ? '未匹配的角色卡' : '暂无角色卡'}
        />
      ),
    },
    {
      key: 'persona',
      label: (
        <Badge count={selectedPersonaCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <UserOutlined />
            用户人设
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredPersonas}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="persona"
          emptyText={searchQuery ? '未匹配的用户人设' : '暂无用户人设'}
        />
      ),
    },
    {
      key: 'knowledge',
      label: (
        <Badge count={selectedKnowledgeCount} showZero size="small" offset={[-4, 0]}>
          <span>
            <BookOutlined />
            知识库
          </span>
        </Badge>
      ),
      children: (
        <MaterialList
          materials={filteredKnowledgeItems}
          loading={loading}
          onToggle={handleToggleMaterial}
          type="knowledge"
          emptyText={searchQuery ? '未匹配的知识库条目' : '暂无知识库条目'}
        />
      ),
    },
  ];

  const tabItems = [
    {
      key: 'materials',
      label: (
        <Badge count={totalSelected} showZero size="small" offset={[-4, 0]}>
          <span>
            <BookOutlined />
            素材库
          </span>
        </Badge>
      ),
      children: (
        <div style={{ padding: '12px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Input
              placeholder="搜索素材名称或描述..."
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              size="small"
              style={{ flex: 1 }}
            />
            <Tooltip title="刷新素材列表">
              <Button
                icon={<ReloadOutlined />}
                size="small"
                onClick={handleRefresh}
                loading={loading}
              />
            </Tooltip>
          </div>

          {totalSelected > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: token.colorFillQuaternary,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedSummaryVisible(!selectedSummaryVisible)}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <UnorderedListOutlined style={{ marginRight: 4 }} />
                  已选素材 ({totalSelected})
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {selectedSummaryVisible ? '收起' : '展开'}
                </Text>
              </div>

              {selectedSummaryVisible && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedWorldBookCount > 0 && (
                    <Tag color="blue" closable onClose={() => {
                      filteredWorldBooks.filter(w => w.isSelected).forEach(w => toggleMaterial('worldbook', w.id));
                    }}>
                      世界书 {selectedWorldBookCount}
                    </Tag>
                  )}
                  {selectedCharacterCount > 0 && (
                    <Tag color="green" closable onClose={() => {
                      filteredCharacters.filter(c => c.isSelected).forEach(c => toggleMaterial('character', c.id));
                    }}>
                      角色卡 {selectedCharacterCount}
                    </Tag>
                  )}
                  {selectedPersonaCount > 0 && (
                    <Tag color="purple" closable onClose={() => {
                      filteredPersonas.filter(p => p.isSelected).forEach(p => toggleMaterial('persona', p.id));
                    }}>
                      用户人设 {selectedPersonaCount}
                    </Tag>
                  )}
                  {selectedKnowledgeCount > 0 && (
                    <Tag color="orange" closable onClose={() => {
                      filteredKnowledgeItems.filter(k => k.isSelected).forEach(k => toggleMaterial('knowledge', k.id));
                    }}>
                      知识库 {selectedKnowledgeCount}
                    </Tag>
                  )}
                </div>
              )}
            </div>
          )}

          <Spin spinning={loading} size="small">
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Tabs
                activeKey={activeMaterialTab}
                onChange={setActiveMaterialTab}
                size="small"
                items={materialSubTabs}
                style={{ height: '100%' }}
              />
            </div>
          </Spin>
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
          <div
            style={{
              marginTop: 16,
              minHeight: 200,
              padding: 16,
              border: `1px dashed ${token.colorBorder}`,
              borderRadius: token.borderRadius,
              color: token.colorTextSecondary,
            }}
          >
            章节预览内容将在这里显示...
          </div>
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
