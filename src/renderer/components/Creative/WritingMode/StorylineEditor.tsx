import React, { useState, useEffect } from 'react';
import { Form, Input, Typography, Space, Button, message, theme } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined, RobotOutlined } from '@ant-design/icons';
import { GeneratedOutline, StoryLine } from '../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { analyzeStorylineChange, ImpactDetail, getAffectedChapterDetails } from '../../../utils/ImpactAnalyzer';
import ChangeConfirmationModal from './ChangeConfirmationModal';

const { TextArea } = Input;
const { Title, Text } = Typography;

interface StorylineEditorProps {
  storyLine: StoryLine;
  onChange: (storyLine: StoryLine) => void;
  projectId: string;
  onAIEdit?: () => void;
}

const StorylineEditor: React.FC<StorylineEditorProps> = ({
  storyLine,
  onChange,
  projectId: _projectId,
  onAIEdit,
}) => {
  const { token } = theme.useToken();
  const [isEditing, setIsEditing] = useState(false);
  const [editedStoryLine, setEditedStoryLine] = useState<StoryLine>(storyLine);
  const [originalStoryLine, setOriginalStoryLine] = useState<StoryLine>(storyLine);
  const [modalVisible, setModalVisible] = useState(false);

  const [impactAnalysis, setImpactAnalysis] = useState<any>(null);
  const [affectedDetails, setAffectedDetails] = useState<ImpactDetail[]>([]);

  useEffect(() => {
    setEditedStoryLine(storyLine);
    setOriginalStoryLine(storyLine);
  }, [storyLine]);

  const executeSave = async (action: 'save_only' | 'save_and_mark') => {
    try {
      const { outline, setOutline, addVersion } = useWritingModeStore.getState();
      if (!outline) return;

      addVersion(outline, 'auto_save', '故事主线修改');

      const updatedOutline: GeneratedOutline = {
        ...outline,
        storyLine: editedStoryLine,
      };

      onChange(editedStoryLine);
      setOutline(updatedOutline);

      const { updateProject, getCurrentProject } = useWritingProjectStore.getState();
      const project = getCurrentProject();
      if (project) {
        await updateProject(project.id, {
          outline: updatedOutline,
          outlineRaw: JSON.stringify(updatedOutline, null, 2),
        });
      }

      setOriginalStoryLine(editedStoryLine);
      setIsEditing(false);

      if (action === 'save_and_mark') {
        message.success('故事主线已保存，受影响章节已标记');
      } else {
        message.success('故事主线已保存');
      }
    } catch (error) {
      message.error('保存失败');
    }
  };

  const handleSave = async () => {
    const { outline } = useWritingModeStore.getState();
    if (!outline) return;

    const impact = analyzeStorylineChange(originalStoryLine, editedStoryLine, outline);

    if (impact.affectedChapters.length > 0 && impact.severity !== 'low') {
      const details = getAffectedChapterDetails(outline, impact.affectedChapters);
      const impactDetails: ImpactDetail[] = details.map(d => ({
        chapterIndex: d.index,
        chapterTitle: d.title,
        affectedField: d.affectedFields.join(', '),
        reason: impact.description,
        suggestion: '建议检查章节内容是否与新的故事主线一致',
      }));

      setImpactAnalysis(impact);
      setAffectedDetails(impactDetails);
      setModalVisible(true);
    } else {
      await executeSave('save_only');
    }
  };

  const handleModalConfirm = async (action: 'save_only' | 'save_and_mark') => {
    setModalVisible(false);
    await executeSave(action);
  };

  const handleModalCancel = () => {
    setModalVisible(false);
  };

  const handleCancel = () => {
    setEditedStoryLine(storyLine);
    setIsEditing(false);
  };

  const updateField = (field: keyof StoryLine, value: any) => {
    setEditedStoryLine((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateStoryArc = (field: keyof StoryLine['storyArc'], value: string) => {
    setEditedStoryLine((prev) => ({
      ...prev,
      storyArc: {
        ...prev.storyArc,
        [field]: value,
      },
    }));
  };

  return (
    <div style={{ padding: '16px 0' }}>
      {!isEditing ? (
        <>
          <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Title level={5} style={{ margin: 0 }}>核心冲突</Title>
            <Space>
              {onAIEdit && (
                <Button
                  icon={<RobotOutlined />}
                  size="small"
                  onClick={onAIEdit}
                  style={{ color: token.colorPrimary }}
                >
                  AI辅助修改
                </Button>
              )}
              <Button
                icon={<EditOutlined />}
                size="small"
                onClick={() => setIsEditing(true)}
              >
                编辑
              </Button>
            </Space>
          </div>
          <Text>{storyLine.coreConflict}</Text>

          <div style={{ marginBottom: 24, marginTop: 24 }}>
            <Title level={5}>故事弧光</Title>
            <div style={{ marginTop: 8 }}>
              <Text strong>起：</Text>
              <Text>{storyLine.storyArc.beginning}</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text strong>承：</Text>
              <Text>{storyLine.storyArc.development}</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text strong>转：</Text>
              <Text>{storyLine.storyArc.climax}</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text strong>合：</Text>
              <Text>{storyLine.storyArc.resolution}</Text>
            </div>
          </div>

          <div style={{ marginBottom: 24, marginTop: 24 }}>
            <Title level={5}>主题</Title>
            <Text>{storyLine.theme}</Text>
          </div>
        </>
      ) : (
        <Form layout="vertical">
          <Form.Item label="核心冲突">
            <TextArea
              value={editedStoryLine.coreConflict}
              onChange={(e) => updateField('coreConflict', e.target.value)}
              rows={4}
              placeholder="描述故事的核心冲突"
            />
          </Form.Item>

          <Form.Item label="故事弧光">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>起：</Text>
                <Input
                  value={editedStoryLine.storyArc.beginning}
                  onChange={(e) => updateStoryArc('beginning', e.target.value)}
                  placeholder="故事开始"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text strong>承：</Text>
                <Input
                  value={editedStoryLine.storyArc.development}
                  onChange={(e) => updateStoryArc('development', e.target.value)}
                  placeholder="故事发展"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text strong>转：</Text>
                <Input
                  value={editedStoryLine.storyArc.climax}
                  onChange={(e) => updateStoryArc('climax', e.target.value)}
                  placeholder="故事高潮"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text strong>合：</Text>
                <Input
                  value={editedStoryLine.storyArc.resolution}
                  onChange={(e) => updateStoryArc('resolution', e.target.value)}
                  placeholder="故事结局"
                  style={{ marginTop: 4 }}
                />
              </div>
            </Space>
          </Form.Item>

          <Form.Item label="主题">
            <TextArea
              value={editedStoryLine.theme}
              onChange={(e) => updateField('theme', e.target.value)}
              rows={3}
              placeholder="故事的主题"
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
              >
                保存
              </Button>
              <Button
                icon={<CloseOutlined />}
                onClick={handleCancel}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      )}

      <ChangeConfirmationModal
        visible={modalVisible}
        impact={impactAnalysis}
        affectedDetails={affectedDetails}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />
    </div>
  );
};

export default StorylineEditor;
