import React, { useState } from 'react';
import { Modal, Input, Button, Space, Typography, theme, Tag, Spin, Alert, Divider, Card } from 'antd';
import { RobotOutlined, ThunderboltOutlined, EditOutlined, ArrowRightOutlined, StopOutlined } from '@ant-design/icons';
import { GeneratedOutline, AIEditResult, OutlineEditSection } from '../../../../shared/types/writing.types';
import { aiEditService } from '../../../services/AIEditService';

const { TextArea } = Input;
const { Text, Title, Paragraph } = Typography;

interface AIEditPromptProps {
  visible: boolean;
  section: OutlineEditSection;
  targetId?: string;
  outline: GeneratedOutline;
  onConfirm: (result: AIEditResult) => void;
  onCancel: () => void;
}

const AIEditPrompt: React.FC<AIEditPromptProps> = ({
  visible,
  section,
  targetId,
  outline,
  onConfirm,
  onCancel,
}) => {
  const { token } = theme.useToken();
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<AIEditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sectionLabels: Record<OutlineEditSection, string> = {
    [OutlineEditSection.STORYLINE]: '故事主线',
    [OutlineEditSection.CHARACTERS]: '角色关系',
    [OutlineEditSection.WORLD]: '世界观设定',
    [OutlineEditSection.CHAPTERS]: '章节大纲',
  };

  const handleEdit = async (_mode: 'optimize' | 'edit' | 'continue') => {
    if (!instruction.trim()) {
      setError('请输入编辑意图');
      return;
    }

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      let result: AIEditResult;

      switch (section) {
        case OutlineEditSection.STORYLINE:
          result = await aiEditService.editStoryline(outline, instruction);
          break;
        case OutlineEditSection.CHARACTERS:
          result = await aiEditService.editCharacterRelations(outline, instruction);
          break;
        case OutlineEditSection.WORLD:
          result = await aiEditService.editWorldSetting(outline, instruction);
          break;
        case OutlineEditSection.CHAPTERS:
          if (targetId) {
            result = await aiEditService.optimizeChapter(outline, parseInt(targetId), instruction);
          } else {
            result = await aiEditService.editStoryline(outline, instruction);
          }
          break;
        default:
          result = { success: false, error: '不支持的编辑区域' };
      }

      if (result.success) {
        setPreview(result);
      } else {
        setError(result.error || 'AI编辑失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI编辑失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (preview) {
      onConfirm(preview);
      resetState();
    }
  };

  const resetState = () => {
    setInstruction('');
    setPreview(null);
    setError(null);
    setLoading(false);
  };

  const handleCancel = () => {
    resetState();
    onCancel();
  };

  const getActionButtonLabel = () => {
    switch (section) {
      case OutlineEditSection.STORYLINE:
        return 'AI辅助修改';
      case OutlineEditSection.CHARACTERS:
        return 'AI辅助优化';
      case OutlineEditSection.WORLD:
        return 'AI辅助优化';
      case OutlineEditSection.CHAPTERS:
        return targetId ? 'AI优化章节' : 'AI辅助修改';
      default:
        return 'AI辅助修改';
    }
  };

  const renderContextPreview = () => {
    switch (section) {
      case OutlineEditSection.STORYLINE:
        return (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary">当前故事主线：</Text>
            <div style={{ marginTop: 8 }}>
              <Text strong>核心冲突：</Text>
              <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 4 }}>
                {outline.storyLine.coreConflict}
              </Paragraph>
              <Text strong>主题：</Text>
              <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 4 }}>
                {outline.storyLine.theme}
              </Paragraph>
            </div>
          </Card>
        );
      case OutlineEditSection.CHARACTERS:
        return (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary">当前角色数量：</Text>
            <Tag style={{ marginLeft: 8 }}>{outline.characterRelationships.length} 个角色</Tag>
          </Card>
        );
      case OutlineEditSection.WORLD:
        return (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Text type="secondary">当前世界观分类：</Text>
            <div style={{ marginTop: 8 }}>
              {outline.worldbuildingNotes.map((note, idx) => (
                <Tag key={idx} style={{ marginBottom: 4 }}>
                  {note.category}
                </Tag>
              ))}
            </div>
          </Card>
        );
      case OutlineEditSection.CHAPTERS:
        const chapter = outline.chapters.find((ch) => ch.index.toString() === targetId);
        if (chapter) {
          return (
            <Card size="small" style={{ marginBottom: 16 }}>
              <Text type="secondary">当前章节：</Text>
              <Title level={5} style={{ margin: '8px 0 4px 0' }}>
                第{chapter.index}章 {chapter.title}
              </Title>
              <Paragraph ellipsis={{ rows: 3 }} type="secondary">
                {chapter.summary}
              </Paragraph>
            </Card>
          );
        }
        return null;
      default:
        return null;
    }
  };

  const renderPreview = () => {
    if (!preview?.content && !preview?.changes && !preview?.suggestions?.length) {
      return null;
    }

    return (
      <div style={{ marginTop: 16 }}>
        <Divider />
        <Title level={5}>
          <RobotOutlined /> AI编辑预览
        </Title>
        {preview.content && (
          <Card size="small" style={{ marginBottom: 12, background: token.colorFillAlter }}>
            <Paragraph>{preview.content}</Paragraph>
          </Card>
        )}
        {preview.suggestions && preview.suggestions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text strong>AI建议：</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              {preview.suggestions.map((suggestion, idx) => (
                <li key={idx}>
                  <Text>{suggestion}</Text>
                </li>
              ))}
            </ul>
          </div>
        )}
        {preview.changes && (
          <Card size="small">
            <Text strong>变更内容：</Text>
            <pre style={{ marginTop: 8, background: token.colorBgContainerDisabled, padding: 8, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>
              {JSON.stringify(preview.changes, null, 2)}
            </pre>
          </Card>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={700}
      destroyOnClose
      title={
        <Space>
          <RobotOutlined style={{ color: token.colorPrimary }} />
          <span>{getActionButtonLabel()}</span>
          <Tag>{sectionLabels[section]}</Tag>
        </Space>
      }
    >
      <Spin spinning={loading}>
        {renderContextPreview()}

        {error && (
          <Alert
            message="编辑失败"
            description={error}
            type="error"
            showIcon
            closable
            style={{ marginBottom: 16 }}
          />
        )}

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ marginBottom: 8, display: 'block' }}>
            请描述您的编辑意图：
          </Text>
          <TextArea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：让主角的性格更加果断，增加一些幽默元素；或者：优化第二章的节奏，增加悬念感..."
            rows={4}
            maxLength={1000}
            showCount
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Space wrap>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => handleEdit('optimize')}
              disabled={loading || !instruction.trim()}
            >
              AI优化
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={() => handleEdit('edit')}
              disabled={loading || !instruction.trim()}
            >
              AI修改
            </Button>
            <Button
              icon={<ArrowRightOutlined />}
              onClick={() => handleEdit('continue')}
              disabled={loading || !instruction.trim()}
            >
              AI续写
            </Button>
            {loading && (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={() => {
                  aiEditService.cancel();
                  setLoading(false);
                }}
              >
                取消
              </Button>
            )}
          </Space>
        </div>

        {renderPreview()}

        {preview && (
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={handleCancel}>放弃</Button>
              <Button type="primary" onClick={handleApply} icon={<ThunderboltOutlined />}>
                应用AI建议
              </Button>
            </Space>
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default AIEditPrompt;
