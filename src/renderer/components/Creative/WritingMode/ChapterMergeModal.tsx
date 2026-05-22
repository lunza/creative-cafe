import React, { useState, useEffect } from 'react';
import { Modal, Form, Radio, Button, Select, Space, List, Typography, Input, InputNumber, Alert, message } from 'antd';
import { AIMergeSuggestion, ChapterOutline } from '../../../../shared/types/writing.types';
const { Text } = Typography;
const { TextArea } = Input;

interface ChapterMergeModalProps {
  visible: boolean;
  chapters: ChapterOutline[];
  chapterContents: Record<number, string>;
  outline: any;
  onCancel: () => void;
  onConfirm: (mode: 'simple' | 'ai', selectedIndices: number[], suggestion?: AIMergeSuggestion) => void;
  projectId: string;
}

const ChapterMergeModal: React.FC<ChapterMergeModalProps> = ({
  visible,
  chapters,
  chapterContents,
  outline,
  onCancel,
  onConfirm,
  projectId
}) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [mode, setMode] = useState<'simple' | 'ai'>('simple');
  const [aiSuggestion, setAiSuggestion] = useState<AIMergeSuggestion | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editableSuggestion, setEditableSuggestion] = useState<AIMergeSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelectedIndices([]);
      setAiSuggestion(null);
      setEditableSuggestion(null);
      setError(null);
      setMode('simple');
    }
  }, [visible]);

  const selectedChapters = chapters.filter(ch => selectedIndices.includes(ch.index));

  const isConsecutive = selectedIndices.length >= 2 && (() => {
    const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
    const arrayPositions = sortedIndices.map(idx =>
      chapters.findIndex(ch => ch.index === idx)
    );
    for (let i = 1; i < arrayPositions.length; i++) {
      if (arrayPositions[i] !== arrayPositions[i - 1] + 1) return false;
    }
    return true;
  })();

  const handleAIMerge = async () => {
    if (!outline || selectedIndices.length < 2) return;

    setIsGenerating(true);
    setError(null);

    try {
      const result = await (window as any).electronAPI.writing.aiSuggestMerge({
        chapters: selectedChapters,
        chapterContents,
        outline
      });

      if (result.success) {
        const suggestion = { ...result.data, chapterIndices: selectedIndices };
        setAiSuggestion(suggestion);
        setEditableSuggestion({ ...suggestion });
        message.success('AI合并方案生成成功');
      } else {
        setError(result.error?.message || 'AI合并失败');
        message.error(result.error?.message || 'AI合并失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'AI合并请求失败';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirm = () => {
    if (!isConsecutive) {
      message.warning('只能合并连续的章节，请调整选择');
      return;
    }
    if (mode === 'ai' && editableSuggestion) {
      onConfirm('ai', selectedIndices, editableSuggestion);
    } else {
      onConfirm('simple', selectedIndices);
    }
  };

  const isConfirmDisabled = selectedIndices.length < 2 || (mode === 'ai' && !editableSuggestion);

  return (
    <Modal
      title="合并章节"
      open={visible}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
          >
            确认合并（{selectedIndices.length} 个章节）
          </Button>
        </Space>
      }
      width={800}
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item label="选择待合并章节（至少2个）">
          <Select
            mode="multiple"
            placeholder="请选择要合并的章节"
            value={selectedIndices}
            onChange={(values) => {
              setSelectedIndices(values);
              setAiSuggestion(null);
              setEditableSuggestion(null);
            }}
            optionFilterProp="children"
            maxTagCount="responsive"
          >
            {chapters.map(ch => (
              <Select.Option key={ch.index} value={ch.index}>
                <div>
                  <div>{ch.title}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {ch.summary?.substring(0, 50) || '（无摘要）'}...
                  </Text>
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        {selectedChapters.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>已选择 {selectedChapters.length} 个章节：</Text>
            <List
              size="small"
              dataSource={selectedChapters}
              renderItem={(ch) => (
                <List.Item>
                  <div>
                    <Text strong>{ch.title}</Text> - {(chapterContents[ch.index] || '').length} 字
                  </div>
                </List.Item>
              )}
            />
          </div>
        )}

        {selectedIndices.length >= 2 && (
          <Form.Item label="合并模式">
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio.Button value="simple">简单合并（拼接内容）</Radio.Button>
              <Radio.Button value="ai">AI智能合并</Radio.Button>
            </Radio.Group>
          </Form.Item>
        )}

        {mode === 'ai' && selectedIndices.length >= 2 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              onClick={handleAIMerge}
              loading={isGenerating}
              type="primary"
              block
            >
              {isGenerating ? 'AI生成中...' : '请求AI生成合并方案'}
            </Button>

            {error && (
              <Alert
                message="错误"
                description={error}
                type="error"
                showIcon
                closable
                onClose={() => setError(null)}
              />
            )}

            {editableSuggestion && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Form.Item label="合并后标题">
                  <Input
                    value={editableSuggestion.mergedTitle}
                    onChange={(e) =>
                      setEditableSuggestion({ ...editableSuggestion, mergedTitle: e.target.value })
                    }
                  />
                </Form.Item>
                <Form.Item label="合并后摘要">
                  <TextArea
                    value={editableSuggestion.mergedSummary || ''}
                    onChange={(e) =>
                      setEditableSuggestion({ ...editableSuggestion, mergedSummary: e.target.value })
                    }
                    rows={4}
                  />
                </Form.Item>
                <Form.Item label="目标字数">
                  <InputNumber
                    value={editableSuggestion.mergedTargetWordCount || 6000}
                    onChange={(val) =>
                      setEditableSuggestion({ ...editableSuggestion, mergedTargetWordCount: val || 6000 })
                    }
                    min={1000}
                    max={100000}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item label="关键情节">
                  <TextArea
                    value={(editableSuggestion.mergedKeyPlotPoints || []).join('\n')}
                    onChange={(e) =>
                      setEditableSuggestion({
                        ...editableSuggestion,
                        mergedKeyPlotPoints: e.target.value.split('\n').filter(Boolean)
                      })
                    }
                    rows={3}
                    placeholder="每行一个关键情节"
                  />
                </Form.Item>
              </Space>
            )}

            {aiSuggestion && (
              <Alert
                message={`AI信心度：${Math.round(aiSuggestion.confidence * 100)}%`}
                type="info"
                showIcon
              />
            )}
          </Space>
        )}

        {mode === 'simple' && selectedIndices.length >= 2 && (
          <Alert
            message="说明"
            description="简单合并模式将把所选章节的内容按顺序拼接为一个新章节。合并后的章节将继承第一个章节的索引位置。"
            type="info"
            showIcon
          />
        )}
      </Form>
    </Modal>
  );
};

export default ChapterMergeModal;
