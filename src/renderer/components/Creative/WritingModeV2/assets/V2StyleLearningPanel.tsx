import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Empty,
  List,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Tag,
  Upload,
  theme,
  message,
} from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  StopOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import type {
  WritingStyleResource,
  V2StyleErrorEvent,
} from '../../../../../shared/types/writing-v2.types';
import { WritingStyleStatus } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';

/** 轮询间隔（风格学习无细粒度进度事件，经 list + getActiveTasks 轮询） */
const POLL_INTERVAL_MS = 3000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * V2 风格学习面板（Phase 3 / P2 扩展能力）
 *
 * 复用 writing:style:* 通道：上传 txt → 后台学习任务（错误经 style.onError 事件）→
 * 轮询 list/getActiveTasks 刷新状态 → 列表展示（状态/进度/查看报告/删除/取消）。
 */
const V2StyleLearningPanel: React.FC = () => {
  const { token } = theme.useToken();
  const [styles, setStyles] = useState<WritingStyleResource[]>([]);
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportStyle, setReportStyle] = useState<WritingStyleResource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const api = getWritingV2API();

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const [listRes, taskRes] = await Promise.all([api.style.list(), api.style.getActiveTasks()]);
      setStyles(listRes.success ? listRes.styles : []);
      setActiveTaskIds(taskRes.success ? taskRes.activeTaskIds : []);
    } catch {
      // 轮询中的单次失败静默，下轮重试
    } finally {
      setLoading(false);
    }
  }, [api]);

  // 初始加载
  useEffect(() => {
    reload();
  }, [reload]);

  // 学习任务失败事件
  useEffect(() => {
    if (!api) return;
    const off = api.style.onError((data: V2StyleErrorEvent) => {
      message.error(`风格学习任务失败：${data.error}`);
      reload();
    });
    return off;
  }, [api, reload]);

  // 有活跃任务时轮询
  useEffect(() => {
    if (activeTaskIds.length === 0) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    pollTimerRef.current = setInterval(reload, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeTaskIds.length, reload]);

  const handleUpload = async (file: File) => {
    if (!api) return;
    if (!file.name.endsWith('.txt')) {
      message.error('仅支持 .txt 格式文件');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error('文件大小不能超过 50MB');
      return;
    }
    // Electron 渲染进程 File 对象携带绝对路径
    const filePath = (file as unknown as { path?: string }).path ?? '';
    if (!filePath) {
      message.error('无法获取文件路径，请重试');
      return;
    }
    const result = await api.style.upload({ filePath, fileName: file.name, fileSize: file.size });
    if (result.success && result.taskId) {
      message.success('开始文风学习，后台完成后自动刷新');
      reload();
    } else {
      message.error(result.error || '上传失败');
    }
  };

  const handleCancel = async (taskId: string) => {
    if (!api) return;
    const res = await api.style.cancel(taskId);
    if (res.success) {
      message.success('已取消学习任务');
      reload();
    } else {
      message.error(res.error || '取消失败');
    }
  };

  const handleDelete = async (resourceId: string) => {
    if (!api) return;
    const res = await api.style.remove(resourceId);
    if (res.success) {
      message.success('已删除写作风格');
      reload();
    } else {
      message.error(res.error || '删除失败');
    }
  };

  const statusColor = (s: WritingStyleResource): string => {
    if (s.status === WritingStyleStatus.COMPLETED) return 'green';
    if (s.status === WritingStyleStatus.FAILED || s.status === WritingStyleStatus.CANCELLED) return 'red';
    return 'blue';
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', height: '100%' }}>
      <Space size={8}>
        <Upload
          accept=".txt"
          showUploadList={false}
          beforeUpload={(file) => {
            void handleUpload(file);
            return false; // 阻止 antd 自动上传
          }}
        >
          <Button icon={<UploadOutlined />} size="small">
            上传 txt 学习文风
          </Button>
        </Upload>
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
        {activeTaskIds.length > 0 && (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => handleCancel(activeTaskIds[0])}>
            取消学习（{activeTaskIds.length}）
          </Button>
        )}
      </Space>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: token.colorTextTertiary, fontSize: 12 }}>
          加载中…
        </div>
      ) : styles.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有学习过的写作风格，上传一段 txt 文本开始学习"
        />
      ) : (
        <List
          size="small"
          bordered
          dataSource={styles}
          renderItem={(s) => {
            const inProgress =
              (s.status === WritingStyleStatus.LEARNING ||
                s.status === WritingStyleStatus.PROCESSING ||
                s.status === WritingStyleStatus.ANALYZING ||
                s.status === WritingStyleStatus.INTEGRATING) &&
              s.progress?.totalChunks > 0;
            const percent =
              s.progress?.totalChunks > 0
                ? Math.round((s.progress.currentChunk / s.progress.totalChunks) * 100)
                : 0;
            return (
              <List.Item
                actions={[
                  <Button
                    key="view"
                    type="link"
                    size="small"
                    icon={<FileTextOutlined />}
                    disabled={!s.analysis}
                    onClick={() => setReportStyle(s)}
                  >
                    报告
                  </Button>,
                  <Popconfirm
                    key="del"
                    title="确认删除该写作风格？"
                    onConfirm={() => handleDelete(s.id)}
                    okText="删除"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8}>
                      {s.name}
                      <Tag color={statusColor(s)}>{s.status}</Tag>
                    </Space>
                  }
                  description={
                    <span style={{ fontSize: 12 }}>
                      {inProgress && s.progress?.message
                        ? s.progress.message
                        : s.analysis
                          ? '学习完成，可作为素材绑定到项目'
                          : '等待学习…'}
                    </span>
                  }
                />
                {inProgress && (
                  <div style={{ width: '100%', marginTop: 4 }}>
                    <Progress percent={percent} size="small" />
                  </div>
                )}
              </List.Item>
            );
          }}
        />
      )}

      {/* 风格分析报告 */}
      <Modal
        title={`风格报告：${reportStyle?.name ?? ''}`}
        open={!!reportStyle}
        onCancel={() => setReportStyle(null)}
        footer={<Button onClick={() => setReportStyle(null)}>关闭</Button>}
        width={720}
      >
        <div style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {reportStyle?.analysis?.fullReport || '暂无报告内容'}
        </div>
      </Modal>
    </div>
  );
};

export default V2StyleLearningPanel;
