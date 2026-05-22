import React, { useState, useEffect } from 'react';
import { Modal, Form, InputNumber, Radio, Button, Space, Typography, Collapse, Input, message, Alert } from 'antd';
import { AISplitSuggestion, ChapterOutline } from '../../../../shared/types/writing.types';
const { Text } = Typography;
const { TextArea } = Input;

interface ChapterSplitModalProps {
  visible: boolean;
  chapter: ChapterOutline | null;
  chapterContent: string;
  outline: any;
  splitCount: number;
  onSplitCountChange: (count: number) => void;
  onCancel: () => void;
  onConfirm: (mode: 'content' | 'ai', suggestion?: AISplitSuggestion) => void;
  projectId: string;
}

const ChapterSplitModal: React.FC<ChapterSplitModalProps> = ({
  visible,
  chapter,
  chapterContent,
  outline,
  splitCount,
  onSplitCountChange,
  onCancel,
  onConfirm,
  projectId
}) => {
  const [mode, setMode] = useState<'content' | 'ai'>('content');
  const [aiSuggestion, setAiSuggestion] = useState<AISplitSuggestion | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editableSuggestion, setEditableSuggestion] = useState<AISplitSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setAiSuggestion(null);
      setEditableSuggestion(null);
      setError(null);
      setMode('content');
    }
  }, [visible]);

  const handleAISplit = async () => {
    if (!chapter || !outline) return;

    setIsGenerating(true);
    setError(null);

    try {
      const result = await (window as any).electronAPI.writing.aiSuggestSplit({
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary,
        chapterContent: chapterContent || '',
        splitCount,
        outline
      });

      if (result.success) {
        setAiSuggestion(result.data);
        setEditableSuggestion({ ...result.data });
        message.success('AI拆分方案生成成功');
      } else {
        setError(result.error?.message || 'AI拆分失败');
        message.error(result.error?.message || 'AI拆分失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'AI拆分请求失败';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirm = () => {
    if (mode === 'ai' && editableSuggestion) {
      onConfirm('ai', editableSuggestion);
    } else {
      onConfirm('content');
    }
  };

  const isConfirmDisabled = mode === 'ai' && !editableSuggestion;

  return (
    <Modal
      title="分解章节"
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
            确认拆分
          </Button>
        </Space>
      }
      width={800}
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item label="当前章节">
          <div>
            <Text strong>标题：</Text>{chapter?.title}<br />
            <Text strong>摘要：</Text>{chapter?.summary || '（无摘要）'}<br />
            <Text strong>字数：</Text>{chapterContent?.length || 0} 字
          </div>
        </Form.Item>

        <Form.Item label="拆分数量">
          <InputNumber
            min={2}
            max={10}
            value={splitCount}
            onChange={(val) => onSplitCountChange(val || 2)}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="拆分模式">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="content">按内容均分</Radio.Button>
            <Radio.Button value="ai">AI智能拆分</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {mode === 'ai' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              onClick={handleAISplit}
              loading={isGenerating}
              type="primary"
              block
            >
              {isGenerating ? 'AI生成中...' : '请求AI生成拆分方案'}
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
              <Collapse accordion>
                {editableSuggestion.titles.map((title, i) => (
                  <Collapse.Panel header={`${i + 1}. ${title}`} key={i}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Form.Item label="标题">
                        <Input
                          value={editableSuggestion.titles[i]}
                          onChange={(e) => {
                            const newTitles = [...editableSuggestion.titles];
                            newTitles[i] = e.target.value;
                            setEditableSuggestion({ ...editableSuggestion, titles: newTitles });
                          }}
                        />
                      </Form.Item>
                      <Form.Item label="摘要">
                        <TextArea
                          value={editableSuggestion.summaries[i] || ''}
                          onChange={(e) => {
                            const newSummaries = [...editableSuggestion.summaries];
                            newSummaries[i] = e.target.value;
                            setEditableSuggestion({ ...editableSuggestion, summaries: newSummaries });
                          }}
                          rows={3}
                        />
                      </Form.Item>
                      <Form.Item label="目标字数">
                        <InputNumber
                          value={editableSuggestion.targetWordCounts[i] || 3000}
                          onChange={(val) => {
                            const newCounts = [...editableSuggestion.targetWordCounts];
                            newCounts[i] = val || 3000;
                            setEditableSuggestion({ ...editableSuggestion, targetWordCounts: newCounts });
                          }}
                          min={500}
                          max={50000}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item label="关键情节">
                        <TextArea
                          value={(editableSuggestion.keyPlotPoints[i] || []).join('\n')}
                          onChange={(e) => {
                            const newPoints = [...editableSuggestion.keyPlotPoints];
                            newPoints[i] = e.target.value.split('\n').filter(Boolean);
                            setEditableSuggestion({ ...editableSuggestion, keyPlotPoints: newPoints });
                          }}
                          rows={2}
                          placeholder="每行一个关键情节"
                        />
                      </Form.Item>
                    </Space>
                  </Collapse.Panel>
                ))}
              </Collapse>
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

        {mode === 'content' && (
          <Alert
            message="说明"
            description="按内容均分模式将根据字数平均拆分章节，每个子章节的内容将按比例分配。拆分后您可以手动编辑每个子章节的内容和属性。"
            type="info"
            showIcon
          />
        )}
      </Form>
    </Modal>
  );
};

export default ChapterSplitModal;
