import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Space, Popconfirm, Form, InputNumber } from 'antd';

const { TextArea } = Input;

interface GenerationSuggestionModalProps {
  visible: boolean;
  onSubmit: (suggestion: string, shardCount: number) => void;
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
  const [shardCount, setShardCount] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setSuggestion(savedGuidance || '');
      setShardCount(1);
      setSubmitting(false);
    }
  }, [visible, savedGuidance]);

  const handleSubmit = () => {
    // 防重复点击：提交期间禁用按钮并显示 loading
    setSubmitting(true);
    onSubmit(suggestion, shardCount);
  };

  const handleClear = () => {
    setSuggestion('');
    onClearGuidance?.();
  };

  // 仅正整数；非法（null、小数、非正）自动回退为 1，超过上限回退到 max
  // 入参放宽为 string | number | null 以兼容 antd InputNumber 的 ValueType 泛型
  const handleShardCountChange = (value: string | number | null) => {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
      setShardCount(1);
      return;
    }
    if (num > 20) {
      setShardCount(20);
      return;
    }
    setShardCount(num);
  };

  return (
    <Modal
      title="生成建议"
      open={visible}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel} disabled={submitting}>取消</Button>
          {savedGuidance && (
            <Popconfirm
              title="确认清空"
              description="清空后已保存的创作指导将被删除，是否继续？"
              onConfirm={handleClear}
              okText="确认清空"
              cancelText="取消"
              disabled={submitting}
            >
              <Button danger disabled={submitting}>清空指导</Button>
            </Popconfirm>
          )}
          <Button type="primary" onClick={handleSubmit} loading={submitting} disabled={submitting}>
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
      <Form.Item
        label="分片数量"
        style={{ marginTop: 16, marginBottom: 0 }}
        help={
          shardCount === 1
            ? '1 表示不分片，将一次性生成完整章节'
            : `将分 ${shardCount} 个分片生成，需先生成分片大纲`
        }
      >
        <InputNumber
          min={1}
          max={20}
          step={1}
          precision={0}
          value={shardCount}
          onChange={handleShardCountChange}
          parser={(input) => (input || '').replace(/[^\d]/g, '')}
          style={{ width: 120 }}
        />
      </Form.Item>
    </Modal>
  );
};

export default GenerationSuggestionModal;
