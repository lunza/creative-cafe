import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Space, Typography, Collapse } from 'antd';

const { TextArea } = Input;
const { Text } = Typography;

interface RegenerationSuggestionModalProps {
  visible: boolean;
  onSubmit: (suggestion: {
    keepContent: string;
    discardContent: string;
    adjustContent: string;
    addContent: string;
  }) => void;
  onCancel: () => void;
  previousContent?: string;
  savedGuidance?: string;
}

const RegenerationSuggestionModal: React.FC<RegenerationSuggestionModalProps> = ({
  visible,
  onSubmit,
  onCancel,
  previousContent,
  savedGuidance
}) => {
  const [keepContent, setKeepContent] = useState('');
  const [discardContent, setDiscardContent] = useState('');
  const [adjustContent, setAdjustContent] = useState('');
  const [addContent, setAddContent] = useState('');

  useEffect(() => {
    if (visible) {
      setKeepContent('');
      setDiscardContent('');
      setAdjustContent('');
      setAddContent('');
    }
  }, [visible]);

  const handleSubmit = () => {
    onSubmit({ keepContent, discardContent, adjustContent, addContent });
  };

  return (
    <Modal
      title="重新生成建议"
      open={visible}
      onCancel={onCancel}
      width={650}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={handleSubmit}>
            开始重新生成
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 已保存的章节创作指导 */}
        {savedGuidance && (
          <Collapse
            size="small"
            items={[
              {
                key: 'saved-guidance',
                label: <Text type="secondary">已保存的章节创作指导</Text>,
                children: (
                  <TextArea
                    value={savedGuidance}
                    disabled
                    rows={3}
                  />
                ),
              },
            ]}
          />
        )}

        {/* 上次生成内容（参考） */}
        {previousContent && (
          <Collapse
            size="small"
            items={[
              {
                key: 'previous',
                label: <Text type="secondary">上次生成内容（参考）</Text>,
                children: (
                  <TextArea
                    value={previousContent}
                    disabled
                    rows={3}
                  />
                ),
              },
            ]}
          />
        )}

        {/* 四个建议输入框 */}
        <div>
          <Text strong>需保留的优秀部分</Text>
          <TextArea
            value={keepContent}
            onChange={(e) => setKeepContent(e.target.value)}
            placeholder="描述您希望保留的内容特征，例如：角色对话风格、环境描写方式等..."
            rows={3}
            maxLength={2000}
            showCount
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <Text strong>需舍弃的不佳部分</Text>
          <TextArea
            value={discardContent}
            onChange={(e) => setDiscardContent(e.target.value)}
            placeholder="描述您希望去除的内容，例如：冗长的环境描写、不符合设定的角色行为等..."
            rows={3}
            maxLength={2000}
            showCount
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <Text strong>需调整的部分及具体指示</Text>
          <TextArea
            value={adjustContent}
            onChange={(e) => setAdjustContent(e.target.value)}
            placeholder="描述需要修改的内容及调整方向，例如：将第一人称改为第三人称、增加战斗场景描写等..."
            rows={3}
            maxLength={2000}
            showCount
            style={{ marginTop: 8 }}
          />
        </div>

        <div>
          <Text strong>需新增的部分及具体指示</Text>
          <TextArea
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            placeholder="描述需要填充的新内容，例如：增加角色内心独白、添加新的伏笔等..."
            rows={3}
            maxLength={2000}
            showCount
            style={{ marginTop: 8 }}
          />
        </div>
      </Space>
    </Modal>
  );
};

export default RegenerationSuggestionModal;
