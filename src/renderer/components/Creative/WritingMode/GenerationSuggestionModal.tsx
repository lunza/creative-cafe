import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Space } from 'antd';

const { TextArea } = Input;

interface GenerationSuggestionModalProps {
  visible: boolean;
  onSubmit: (suggestion: string) => void;
  onCancel: () => void;
}

const GenerationSuggestionModal: React.FC<GenerationSuggestionModalProps> = ({
  visible,
  onSubmit,
  onCancel
}) => {
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    if (visible) {
      setSuggestion('');
    }
  }, [visible]);

  const handleSubmit = () => {
    onSubmit(suggestion);
  };

  return (
    <Modal
      title="生成建议"
      open={visible}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
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
