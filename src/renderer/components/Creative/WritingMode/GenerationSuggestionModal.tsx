import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Space, Popconfirm } from 'antd';

const { TextArea } = Input;

interface GenerationSuggestionModalProps {
  visible: boolean;
  onSubmit: (suggestion: string) => void;
  onCancel: () => void;
  savedGuidance?: string;
  onClearGuidance?: () => void;
}

const GenerationSuggestionModal: React.FC<GenerationSuggestionModalProps> = ({
  visible,
  onSubmit,
  onCancel,
  savedGuidance,
  onClearGuidance
}) => {
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    if (visible) {
      setSuggestion(savedGuidance || '');
    }
  }, [visible, savedGuidance]);

  const handleSubmit = () => {
    onSubmit(suggestion);
  };

  const handleClear = () => {
    setSuggestion('');
    onClearGuidance?.();
  };

  return (
    <Modal
      title="生成建议"
      open={visible}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          {savedGuidance && (
            <Popconfirm
              title="确认清空"
              description="清空后已保存的创作指导将被删除，是否继续？"
              onConfirm={handleClear}
              okText="确认清空"
              cancelText="取消"
            >
              <Button danger>清空指导</Button>
            </Popconfirm>
          )}
          <Button type="primary" onClick={handleSubmit}>
            开始生成
          </Button>
        </Space>
      }
    >
      <TextArea
        value={suggestion}
        onChange={(e) => setSuggestion(e.target.value)}
        placeholder="请输入您对生成内容的建议或要求（可选，留空将使用默认提示词）"
        rows={6}
        maxLength={2000}
        showCount
      />
    </Modal>
  );
};

export default GenerationSuggestionModal;
