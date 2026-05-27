import React, { useState } from 'react';
import { Modal, Form, Input, InputNumber, Button, Space, Typography, theme, Spin, Alert, Card, Tag, Divider, message } from 'antd';
import { PlusOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, BookOutlined } from '@ant-design/icons';
import { GeneratedOutline, ChapterOutline } from '../../../../shared/types/writing.types';
import { aiEditService } from '../../../services/AIEditService';

const { TextArea } = Input;
const { Text, Paragraph, Title } = Typography;

interface OutlineContinuationProps {
  visible: boolean;
  outline: GeneratedOutline | null;
  onConfirm: (newChapters: ChapterOutline[]) => void;
  onCancel: () => void;
  projectId: string;
}

const OutlineContinuation: React.FC<OutlineContinuationProps> = ({
  visible,
  outline,
  onConfirm,
  onCancel,
  projectId: _projectId,
}) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedChapters, setGeneratedChapters] = useState<ChapterOutline[] | null>(null);
  const [contextChaptersCount] = useState(3);

  const handleGenerate = async (values: { chapterCount: number; instructions: string }) => {
    if (!outline) {
      message.error('大纲数据不存在');
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedChapters(null);

    try {
      const newChapters = await aiEditService.continueOutline(
        outline,
        values.chapterCount,
        values.instructions,
      );

      if (!newChapters || newChapters.length === 0) {
        setError('AI 未能生成章节，请重试');
        return;
      }

      setGeneratedChapters(newChapters);
      message.success(`已生成 ${newChapters.length} 个章节`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    if (generatedChapters && generatedChapters.length > 0) {
      onConfirm(generatedChapters);
      resetState();
    }
  };

  const handleRegenerate = () => {
    setGeneratedChapters(null);
    const values = form.getFieldsValue();
    handleGenerate(values);
  };

  const handleCancel = () => {
    resetState();
    onCancel();
  };

  const resetState = () => {
    form.resetFields();
    setGeneratedChapters(null);
    setError(null);
    setLoading(false);
  };

  const getContextChapters = (): ChapterOutline[] => {
    if (!outline || outline.chapters.length === 0) return [];
    const startIdx = Math.max(0, outline.chapters.length - contextChaptersCount);
    return outline.chapters.slice(startIdx);
  };

  const getLastChapterIndex = (): number => {
    if (!outline || outline.chapters.length === 0) return 0;
    return Math.max(...outline.chapters.map(ch => ch.index));
  };

  const renderContextChapters = () => {
    const contextChapters = getContextChapters();
    if (contextChapters.length === 0) return null;

    return (
      <Card size="small" title="参考上下文（最近章节）" style={{ marginBottom: 16, background: token.colorFillAlter }}>
        {contextChapters.map(chapter => (
          <div key={chapter.index} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <Text strong>第 {chapter.index} 章：{chapter.title}</Text>
            <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
              {chapter.summary}
            </Paragraph>
          </div>
        ))}
      </Card>
    );
  };

  const renderGeneratedPreview = () => {
    if (!generatedChapters || generatedChapters.length === 0) return null;

    return (
      <div style={{ marginTop: 16 }}>
        <Divider />
        <Title level={5}>
          <BookOutlined style={{ color: token.colorSuccess }} />
          <span style={{ marginLeft: 8 }}>生成的章节预览</span>
          <Tag color="success" style={{ marginLeft: 8 }}>{generatedChapters.length} 章</Tag>
        </Title>
        {generatedChapters.map(chapter => (
          <Card
            key={chapter.index}
            size="small"
            style={{ marginBottom: 12, borderLeft: `3px solid ${token.colorPrimary}` }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 16 }}>第 {chapter.index} 章：{chapter.title}</Text>
              <Tag>{chapter.targetWordCount} 字</Tag>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">摘要：</Text>
              <Paragraph style={{ marginTop: 4 }}>{chapter.summary}</Paragraph>
            </div>
            {chapter.keyPlotPoints && chapter.keyPlotPoints.length > 0 && (
              <div>
                <Text type="secondary">关键情节：</Text>
                <ul style={{ marginTop: 4, paddingLeft: 20, marginBottom: 0 }}>
                  {chapter.keyPlotPoints.map((point, idx) => (
                    <li key={idx}>
                      <Text>{point}</Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {chapter.characters && chapter.characters.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">登场角色：</Text>
                <div style={{ marginTop: 4 }}>
                  {chapter.characters.map((char, idx) => (
                    <Tag key={idx} style={{ marginBottom: 4 }}>{char}</Tag>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  };

  return (
    <Modal
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={800}
      destroyOnClose
      title={
        <Space>
          <BookOutlined style={{ color: token.colorPrimary }} />
          <span>大纲续写</span>
        </Space>
      }
    >
      <Spin spinning={loading}>
        {!generatedChapters && (
          <>
            {outline && outline.chapters.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Text>当前已有 <Tag color="blue">{outline.chapters.length}</Tag> 个章节，最后章节索引为 <Tag>{getLastChapterIndex()}</Tag></Text>
              </div>
            )}
            {renderContextChapters()}

            {error && (
              <Alert
                message="生成失败"
                description={error}
                type="error"
                showIcon
                closable
                style={{ marginBottom: 16 }}
              />
            )}

            <Form
              form={form}
              layout="vertical"
              onFinish={handleGenerate}
              initialValues={{ chapterCount: 1 }}
            >
              <Form.Item
                label="续写章节数量"
                name="chapterCount"
                rules={[{ required: true, message: '请输入章节数量' }]}
              >
                <InputNumber
                  min={1}
                  max={10}
                  style={{ width: '100%' }}
                  placeholder="1-10"
                />
              </Form.Item>

              <Form.Item
                label="续写指令（可选）"
                name="instructions"
              >
                <TextArea
                  rows={4}
                  maxLength={2000}
                  showCount
                  placeholder="例如：主角发现了新的线索，剧情开始反转；或者：增加一些悬疑元素，让读者猜测幕后黑手..."
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                <Space>
                  <Button onClick={handleCancel}>取消</Button>
                  <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={loading}>
                    生成章节
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </>
        )}

        {renderGeneratedPreview()}

        {generatedChapters && generatedChapters.length > 0 && (
          <div style={{ marginTop: 24, textAlign: 'right', paddingTop: 16, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <Space>
              <Button onClick={handleCancel} icon={<CloseOutlined />}>
                取消
              </Button>
              <Button onClick={handleRegenerate} icon={<ReloadOutlined />} loading={loading}>
                重新生成
              </Button>
              <Button type="primary" onClick={handleAccept} icon={<CheckOutlined />}>
                接受并添加
              </Button>
            </Space>
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default OutlineContinuation;
