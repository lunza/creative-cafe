import React, { useState, useEffect } from 'react';
import { List, Card, Tag, Typography, Button, Space, Modal, Form, Input, message, theme } from 'antd';
import { EditOutlined, SaveOutlined, DeleteOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { CharacterRelationship, GeneratedOutline } from '../../../../shared/types/writing.types';
import { useWritingModeStore } from '../../../stores/writingModeStore';
import { useWritingProjectStore } from '../../../stores/writingProjectStore';
import { analyzeCharacterChange, ImpactDetail, getAffectedChapterDetails } from '../../../utils/ImpactAnalyzer';
import ChangeConfirmationModal from './ChangeConfirmationModal';

const { Text, Title } = Typography;

interface CharacterRelationEditorProps {
  characterRelationships: CharacterRelationship[];
  onChange: (characters: CharacterRelationship[]) => void;
  onAIEdit?: () => void;
}

const CharacterRelationEditor: React.FC<CharacterRelationEditorProps> = ({
  characterRelationships,
  onChange,
  onAIEdit,
}) => {
  const { token } = theme.useToken();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingRelationIndex, setEditingRelationIndex] = useState<{ charIdx: number; relIdx: number } | null>(null);
  const [editForm] = Form.useForm();
  const [relationForm] = Form.useForm();
  const [originalCharacters, setOriginalCharacters] = useState<CharacterRelationship[]>(characterRelationships);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingCharacters, setPendingCharacters] = useState<CharacterRelationship[] | null>(null);
  const [impactAnalysis, setImpactAnalysis] = useState<any>(null);
  const [affectedDetails, setAffectedDetails] = useState<ImpactDetail[]>([]);

  useEffect(() => {
    setOriginalCharacters(characterRelationships);
  }, [characterRelationships]);

  const roleColorMap: Record<string, string> = {
    '主角': 'blue',
    '配角': 'green',
    '反派': 'red',
    '导师': 'purple',
    '伙伴': 'orange',
    '恋人': 'pink',
  };

  const executeSave = async (updatedCharacters: CharacterRelationship[], action: 'save_only' | 'save_and_mark') => {
    onChange(updatedCharacters);

    const { outline, setOutline } = useWritingModeStore.getState();
    if (!outline) return;

    const updatedOutline: GeneratedOutline = {
      ...outline,
      characterRelationships: updatedCharacters,
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

    setOriginalCharacters(updatedCharacters);
    setEditingIndex(null);
    setEditingRelationIndex(null);

    if (action === 'save_and_mark') {
      message.success('角色已保存，受影响章节已标记');
    } else {
      message.success('角色已保存');
    }
  };

  const checkImpactAndSave = async (updatedCharacters: CharacterRelationship[]) => {
    const { outline } = useWritingModeStore.getState();
    if (!outline) {
      await executeSave(updatedCharacters, 'save_only');
      return;
    }

    const impact = analyzeCharacterChange(originalCharacters, updatedCharacters, outline);

    if (impact.affectedChapters.length > 0 && impact.severity !== 'low') {
      const details = getAffectedChapterDetails(outline, impact.affectedChapters);
      const impactDetails: ImpactDetail[] = details.map(d => ({
        chapterIndex: d.index,
        chapterTitle: d.title,
        affectedField: d.affectedFields.join(', '),
        reason: impact.description,
        suggestion: '建议检查章节角色列表和相关内容是否与新设定一致',
      }));

      setImpactAnalysis(impact);
      setAffectedDetails(impactDetails);
      setPendingCharacters(updatedCharacters);
      setModalVisible(true);
    } else {
      await executeSave(updatedCharacters, 'save_only');
    }
  };

  const handleModalConfirm = async (action: 'save_only' | 'save_and_mark') => {
    setModalVisible(false);
    if (pendingCharacters) {
      await executeSave(pendingCharacters, action);
      setPendingCharacters(null);
    }
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    setPendingCharacters(null);
  };

  const handleEditCharacter = (index: number) => {
    const character = characterRelationships[index];
    editForm.setFieldsValue({
      name: character.name,
      role: character.role,
    });
    setEditingIndex(index);
  };

  const handleSaveCharacter = async () => {
    const values = await editForm.validateFields();
    const updatedCharacters = [...characterRelationships];
    updatedCharacters[editingIndex!] = {
      ...updatedCharacters[editingIndex!],
      name: values.name,
      role: values.role,
    };

    await checkImpactAndSave(updatedCharacters);
  };

  const handleEditRelation = (charIdx: number, relIdx: number) => {
    const relation = characterRelationships[charIdx].relationships[relIdx];
    relationForm.setFieldsValue({
      targetCharacter: relation.targetCharacter,
      relationshipType: relation.relationshipType,
      description: relation.description,
    });
    setEditingRelationIndex({ charIdx, relIdx });
  };

  const handleSaveRelation = async () => {
    const values = await relationForm.validateFields();
    const updatedCharacters = [...characterRelationships];
    const { charIdx, relIdx } = editingRelationIndex!;
    updatedCharacters[charIdx].relationships[relIdx] = {
      targetCharacter: values.targetCharacter,
      relationshipType: values.relationshipType,
      description: values.description,
    };

    await checkImpactAndSave(updatedCharacters);
  };

  const handleDeleteRelation = async (charIdx: number, relIdx: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个关系吗？',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        const updatedCharacters = [...characterRelationships];
        updatedCharacters[charIdx].relationships.splice(relIdx, 1);
        await checkImpactAndSave(updatedCharacters);
      },
    });
  };

  const handleAddRelation = async (charIdx: number) => {
    Modal.confirm({
      title: '添加关系',
      content: (
        <Form form={relationForm} layout="vertical">
          <Form.Item name="targetCharacter" label="目标角色" rules={[{ required: true }]}>
            <Input placeholder="输入目标角色名称" />
          </Form.Item>
          <Form.Item name="relationshipType" label="关系类型" rules={[{ required: true }]}>
            <Input placeholder="如：父子、师徒、朋友" />
          </Form.Item>
          <Form.Item name="description" label="关系描述">
            <Input.TextArea rows={3} placeholder="描述这段关系" />
          </Form.Item>
        </Form>
      ),
      okText: '添加',
      cancelText: '取消',
      width: 600,
      onOk: async () => {
        const values = await relationForm.validateFields();
        const updatedCharacters = [...characterRelationships];
        if (!updatedCharacters[charIdx].relationships) {
          updatedCharacters[charIdx].relationships = [];
        }
        updatedCharacters[charIdx].relationships.push({
          targetCharacter: values.targetCharacter,
          relationshipType: values.relationshipType,
          description: values.description,
        });
        await checkImpactAndSave(updatedCharacters);
        relationForm.resetFields();
      },
    });
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
      <List
        dataSource={characterRelationships}
        renderItem={(character, charIdx) => (
          <List.Item style={{ display: 'block' }}>
            <Card
              size="small"
              style={{ marginBottom: 16 }}
              title={
                <Space>
                  {editingIndex === charIdx ? (
                    <Form form={editForm} layout="inline">
                      <Form.Item name="name" style={{ marginBottom: 0 }}>
                        <Input placeholder="角色名称" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item name="role" style={{ marginBottom: 0 }}>
                        <Input placeholder="角色定位" style={{ width: 100 }} />
                      </Form.Item>
                    </Form>
                  ) : (
                    <>
                      <Text strong>{character.name}</Text>
                      <Tag color={roleColorMap[character.role] || 'default'}>
                        {character.role}
                      </Tag>
                    </>
                  )}
                </Space>
              }
              extra={
                editingIndex === charIdx ? (
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      icon={<SaveOutlined />}
                      onClick={handleSaveCharacter}
                    >
                      保存
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setEditingIndex(null)}
                    >
                      取消
                    </Button>
                  </Space>
                ) : (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEditCharacter(charIdx)}
                  >
                    编辑
                  </Button>
                )
              }
            >
              <div style={{ marginBottom: 12 }}>
                <Title level={5} style={{ margin: '0 0 8px 0' }}>关系网络</Title>
                {character.relationships.map((relation, relIdx) => (
                  <div
                    key={relIdx}
                    style={{
                      marginBottom: 8,
                      padding: 8,
                      background: token.colorBgContainerDisabled,
                      borderRadius: 4,
                    }}
                  >
                    {editingRelationIndex?.charIdx === charIdx && editingRelationIndex?.relIdx === relIdx ? (
                      <Form form={relationForm} layout="vertical" style={{ marginTop: 8 }}>
                        <Form.Item name="targetCharacter" style={{ marginBottom: 8 }}>
                          <Input placeholder="目标角色" />
                        </Form.Item>
                        <Form.Item name="relationshipType" style={{ marginBottom: 8 }}>
                          <Input placeholder="关系类型" />
                        </Form.Item>
                        <Form.Item name="description" style={{ marginBottom: 8 }}>
                          <Input.TextArea rows={2} placeholder="关系描述" />
                        </Form.Item>
                        <Space>
                          <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={handleSaveRelation}
                          >
                            保存
                          </Button>
                          <Button
                            size="small"
                            onClick={() => setEditingRelationIndex(null)}
                          >
                            取消
                          </Button>
                        </Space>
                      </Form>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <Text strong>→ {relation.targetCharacter}</Text>
                          <Tag style={{ marginLeft: 8 }}>{relation.relationshipType}</Tag>
                          <div style={{ marginTop: 4 }}>
                            <Text type="secondary">{relation.description}</Text>
                          </div>
                        </div>
                        <Space>
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditRelation(charIdx, relIdx)}
                          />
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleDeleteRelation(charIdx, relIdx)}
                          />
                        </Space>
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => handleAddRelation(charIdx)}
                  style={{ width: '100%', marginTop: 8 }}
                >
                  添加关系
                </Button>
              </div>
            </Card>
          </List.Item>
        )}
      />

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

export default CharacterRelationEditor;
