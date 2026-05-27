import React, { useState, useEffect } from 'react';
import { Collapse, Form, Input, Button, Space, message, Typography, theme } from 'antd';
import { EditOutlined, SaveOutlined, PlusOutlined, DeleteOutlined, RobotOutlined } from '@ant-design/icons';
import { WorldbuildingNotes, GeneratedOutline } from '../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { analyzeWorldSettingChange, ImpactDetail, getAffectedChapterDetails } from '../../../utils/ImpactAnalyzer';
import ChangeConfirmationModal from './ChangeConfirmationModal';

const { Text, Title } = Typography;

interface WorldSettingEditorProps {
  worldbuildingNotes: WorldbuildingNotes[];
  onChange: (notes: WorldbuildingNotes[]) => void;
  onAIEdit?: () => void;
}

const WorldSettingEditor: React.FC<WorldSettingEditorProps> = ({
  worldbuildingNotes,
  onChange,
  onAIEdit,
}) => {
  const { token } = theme.useToken();
  const [editingCategory, setEditingCategory] = useState<number | null>(null);
  const [editingPoint, setEditingPoint] = useState<{ categoryIdx: number; pointIdx: number } | null>(null);
  const [editForm] = Form.useForm();
  const [pointForm] = Form.useForm();
  const [newPointForm] = Form.useForm();
  const [originalNotes, setOriginalNotes] = useState<WorldbuildingNotes[]>(worldbuildingNotes);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingNotes, setPendingNotes] = useState<WorldbuildingNotes[] | null>(null);
  const [impactAnalysis, setImpactAnalysis] = useState<any>(null);
  const [affectedDetails, setAffectedDetails] = useState<ImpactDetail[]>([]);

  useEffect(() => {
    setOriginalNotes(worldbuildingNotes);
  }, [worldbuildingNotes]);

  const executeSave = async (updatedNotes: WorldbuildingNotes[], action: 'save_only' | 'save_and_mark') => {
    onChange(updatedNotes);

    const { outline, setOutline } = useWritingModeStore.getState();
    if (!outline) return;

    const updatedOutline: GeneratedOutline = {
      ...outline,
      worldbuildingNotes: updatedNotes,
    };

    setOutline(updatedOutline);

    const { updateProject, getCurrentProject } = useWritingProjectStore.getState();
    const project = getCurrentProject();
    if (project) {
      await updateProject(project.id, {
        outline: updatedOutline,
        outlineRaw: JSON.stringify(updatedOutline, null, 2),
      });
    }

    setOriginalNotes(updatedNotes);
    setEditingCategory(null);
    setEditingPoint(null);

    if (action === 'save_and_mark') {
      message.success('世界观设定已保存，受影响章节已标记');
    } else {
      message.success('世界观设定已保存');
    }
  };

  const checkImpactAndSave = async (updatedNotes: WorldbuildingNotes[]) => {
    const { outline } = useWritingModeStore.getState();
    if (!outline) {
      await executeSave(updatedNotes, 'save_only');
      return;
    }

    const impact = analyzeWorldSettingChange(originalNotes, updatedNotes, outline);

    if (impact.affectedChapters.length > 0 && impact.severity !== 'low') {
      const details = getAffectedChapterDetails(outline, impact.affectedChapters);
      const impactDetails: ImpactDetail[] = details.map(d => ({
        chapterIndex: d.index,
        chapterTitle: d.title,
        affectedField: d.affectedFields.join(', '),
        reason: impact.description,
        suggestion: '建议检查章节场景和摘要是否与新的世界观设定一致',
      }));

      setImpactAnalysis(impact);
      setAffectedDetails(impactDetails);
      setPendingNotes(updatedNotes);
      setModalVisible(true);
    } else {
      await executeSave(updatedNotes, 'save_only');
    }
  };

  const handleModalConfirm = async (action: 'save_only' | 'save_and_mark') => {
    setModalVisible(false);
    if (pendingNotes) {
      await executeSave(pendingNotes, action);
      setPendingNotes(null);
    }
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    setPendingNotes(null);
  };

  const handleEditCategory = (index: number) => {
    const category = worldbuildingNotes[index];
    editForm.setFieldsValue({
      category: category.category,
    });
    setEditingCategory(index);
  };

  const handleSaveCategory = async () => {
    const values = await editForm.validateFields();
    const updatedNotes = [...worldbuildingNotes];
    updatedNotes[editingCategory!] = {
      ...updatedNotes[editingCategory!],
      category: values.category,
    };

    await checkImpactAndSave(updatedNotes);
  };

  const handleEditPoint = (categoryIdx: number, pointIdx: number) => {
    const point = worldbuildingNotes[categoryIdx].points[pointIdx];
    pointForm.setFieldsValue({
      point,
    });
    setEditingPoint({ categoryIdx, pointIdx });
  };

  const handleSavePoint = async () => {
    const values = await pointForm.validateFields();
    const updatedNotes = [...worldbuildingNotes];
    const { categoryIdx, pointIdx } = editingPoint!;
    updatedNotes[categoryIdx].points[pointIdx] = values.point;

    await checkImpactAndSave(updatedNotes);
  };

  const handleAddPoint = async (categoryIdx: number) => {
    const values = await newPointForm.validateFields();
    const updatedNotes = [...worldbuildingNotes];
    updatedNotes[categoryIdx].points.push(values.point);

    await checkImpactAndSave(updatedNotes);
    newPointForm.resetFields();
  };

  const handleDeletePoint = async (categoryIdx: number, pointIdx: number) => {
    const updatedNotes = [...worldbuildingNotes];
    updatedNotes[categoryIdx].points.splice(pointIdx, 1);

    await checkImpactAndSave(updatedNotes);
  };

  return (
    <div style={{ padding: '16px 0' }}>
      {onAIEdit && (
        <div style={{ marginBottom: 16 }}>
          <Button
            icon={<RobotOutlined />}
            onClick={onAIEdit}
            style={{ color: token.colorPrimary }}
          >
            AI辅助优化
          </Button>
        </div>
      )}
      <Collapse
        defaultActiveKey={worldbuildingNotes.map((_, index) => index.toString())}
        accordion={false}
      >
        {worldbuildingNotes.map((note, categoryIdx) => (
          <Collapse.Panel
            key={categoryIdx}
            header={
              editingCategory === categoryIdx ? (
                <Form form={editForm} layout="inline">
                  <Form.Item name="category" style={{ marginBottom: 0 }}>
                    <Input placeholder="分类名称" />
                  </Form.Item>
                </Form>
              ) : (
                <Title level={5} style={{ margin: 0 }}>{note.category}</Title>
              )
            }
            extra={
              editingCategory === categoryIdx ? (
                <Space>
                  <Button
                    type="primary"
                    size="small"
                    icon={<SaveOutlined />}
                    onClick={handleSaveCategory}
                  >
                    保存
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setEditingCategory(null)}
                  >
                    取消
                  </Button>
                </Space>
              ) : (
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleEditCategory(categoryIdx)}
                >
                  编辑
                </Button>
              )
            }
          >
            <div style={{ marginBottom: 16 }}>
              {note.points.map((point, pointIdx) => (
                <div
                  key={pointIdx}
                  style={{
                    marginBottom: 12,
                    padding: 8,
                    background: token.colorBgContainerDisabled,
                    borderRadius: 4,
                  }}
                >
                  {editingPoint?.categoryIdx === categoryIdx && editingPoint?.pointIdx === pointIdx ? (
                    <Form form={pointForm} layout="vertical">
                      <Form.Item name="point" style={{ marginBottom: 8 }}>
                        <Input.TextArea rows={3} placeholder="要点内容" />
                      </Form.Item>
                      <Space>
                        <Button
                          type="primary"
                          size="small"
                          icon={<SaveOutlined />}
                          onClick={handleSavePoint}
                        >
                          保存
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setEditingPoint(null)}
                        >
                          取消
                        </Button>
                      </Space>
                    </Form>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <Text>• {point}</Text>
                      </div>
                      <Space>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => handleEditPoint(categoryIdx, pointIdx)}
                        />
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeletePoint(categoryIdx, pointIdx)}
                        />
                      </Space>
                    </div>
                  )}
                </div>
              ))}

              <Form form={newPointForm} layout="vertical" style={{ marginTop: 16 }}>
                <Form.Item name="point" style={{ marginBottom: 8 }}>
                  <Input.TextArea rows={2} placeholder="添加新的要点" />
                </Form.Item>
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => handleAddPoint(categoryIdx)}
                  style={{ width: '100%' }}
                >
                  添加要点
                </Button>
              </Form>
            </div>
          </Collapse.Panel>
        ))}
      </Collapse>

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

export default WorldSettingEditor;
