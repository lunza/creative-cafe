/**
 * WritingAgentModal —— 写作智能体编排模态框
 *
 * 来源：spec §二 Task 15.2（前端"智能体写作"按钮 + 进度流 + 断点续跑）
 *
 * 三态视图：
 *  1. 配置态（idle）：章节范围 + 编排选项 + 启动/续跑按钮
 *  2. 运行态（running）：进度条 + 当前章节 + 事件流 + 取消按钮
 *  3. 完成态（completed）：结果摘要 + 关闭按钮
 *
 * 进度流：通过 useWritingAgent hook 订阅 writing-agent:progress 事件，
 *         实时更新事件列表与进度百分比。
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  Button,
  Progress,
  Switch,
  Select,
  InputNumber,
  Tooltip,
  Tag,
  Space,
  Divider,
  Alert,
  Typography,
} from 'antd';
import {
  RobotOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  EditOutlined,
  FileSearchOutlined,
  ToolOutlined,
  TableOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { AgentWritingOptions } from '../../../../shared/types/writing-agent.types';
import type { AgentWritingEventType } from '../../../../shared/types/writing-agent.types';
import type { GeneratedOutline } from '../../../../shared/types/writing.types';
import { useWritingAgent } from './hooks/useWritingAgent';

const { Text, Paragraph } = Typography;

// ==================== 事件类型元数据 ====================

interface EventMeta {
  icon: React.ReactNode;
  color: string;
  label: string;
}

const EVENT_META: Record<AgentWritingEventType, EventMeta> = {
  started: { icon: <RobotOutlined />, color: '#1890ff', label: '开始' },
  chapter_started: { icon: <PlayCircleOutlined />, color: '#1890ff', label: '章节开始' },
  chapter_writing: { icon: <EditOutlined />, color: '#1890ff', label: '写作中' },
  chapter_written: { icon: <EditOutlined />, color: '#52c41a', label: '写作完成' },
  chapter_checking: { icon: <FileSearchOutlined />, color: '#faad14', label: '检查中' },
  chapter_checked: { icon: <FileSearchOutlined />, color: '#52c41a', label: '检查完成' },
  chapter_fixing: { icon: <ToolOutlined />, color: '#faad14', label: '修复中' },
  chapter_fixed: { icon: <ToolOutlined />, color: '#52c41a', label: '修复完成' },
  chapter_organizing: { icon: <TableOutlined />, color: '#722ed1', label: '整理表格中' },
  chapter_organized: { icon: <TableOutlined />, color: '#52c41a', label: '表格整理完成' },
  chapter_completed: { icon: <CheckCircleOutlined />, color: '#52c41a', label: '章节完成' },
  chapter_skipped: { icon: <MinusCircleOutlined />, color: 'var(--text-secondary)', label: '跳过' },
  chapter_failed: { icon: <CloseCircleOutlined />, color: '#ff4d4f', label: '失败' },
  progress: { icon: <LoadingOutlined />, color: '#1890ff', label: '进度' },
  completed: { icon: <CheckCircleOutlined />, color: '#52c41a', label: '完成' },
  cancelled: { icon: <StopOutlined />, color: '#ff4d4f', label: '取消' },
  error: { icon: <CloseCircleOutlined />, color: '#ff4d4f', label: '错误' },
};

// ==================== 默认选项 ====================

const DEFAULT_OPTIONS: Required<AgentWritingOptions> = {
  enablePlotCheck: true,
  enableAutoFix: true,
  enableTableOrganize: true,
  autoFixMinSeverity: 'high',
  maxRetriesPerChapter: 2,
  skipExistingChapters: true,
};

// ==================== 组件 Props ====================

interface WritingAgentModalProps {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  outline: GeneratedOutline | null;
  /** 编排完成后回调（用于刷新章节列表） */
  onCompleted?: () => void;
}

// ==================== 组件实现 ====================

const WritingAgentModal: React.FC<WritingAgentModalProps> = ({
  visible,
  onClose,
  projectId,
  outline,
  onCompleted,
}) => {
  const { state, start, cancel, resume, refreshStatus } = useWritingAgent(projectId);

  // ---- 配置态表单状态 ----
  const [options, setOptions] = useState<Required<AgentWritingOptions>>(DEFAULT_OPTIONS);
  const [startChapter, setStartChapter] = useState<number | undefined>(undefined);
  const [endChapter, setEndChapter] = useState<number | undefined>(undefined);

  // ---- 事件流自动滚动 ----
  const eventListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (eventListRef.current) {
      eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
    }
  }, [state.events]);

  // ---- 关闭时若已完成则触发回调 ----
  const handleClose = () => {
    if (state.result?.success && onCompleted) {
      onCompleted();
    }
    onClose();
  };

  // ---- 打开时刷新状态 ----
  useEffect(() => {
    if (visible) {
      refreshStatus();
    }
  }, [visible, refreshStatus]);

  // ---- 章节总数 ----
  const totalChapters = outline?.chapters?.length || 0;

  // ---- 当前阶段（用于决定显示哪个视图）----
  const phase: 'config' | 'running' | 'result' = state.running
    ? 'running'
    : state.result
      ? 'result'
      : 'config';

  // ---- 启动编排 ----
  const handleStart = async () => {
    if (totalChapters === 0) return;
    const sIdx = startChapter !== undefined ? Math.max(0, Math.min(startChapter, totalChapters - 1)) : undefined;
    const eIdx = endChapter !== undefined ? Math.max(0, Math.min(endChapter, totalChapters - 1)) : undefined;
    await start(options, sIdx, eIdx);
  };

  // ---- 续跑 ----
  const handleResume = async () => {
    await resume(options);
  };

  // ---- 事件流渲染 ----
  const renderEventList = () => {
    if (state.events.length === 0) {
      return (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
          等待编排事件...
        </div>
      );
    }
    return (
      <div
        ref={eventListRef}
        style={{
          maxHeight: 260,
          overflowY: 'auto',
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          borderRadius: 6,
          border: '1px solid var(--border-base)',
          fontSize: 12,
        }}
      >
        {state.events.map((evt, idx) => {
          const meta = EVENT_META[evt.type] || EVENT_META.progress;
          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '3px 0',
                color: meta.color,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
              <span style={{ flexShrink: 0, fontWeight: 500, minWidth: 72 }}>
                {new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              <span style={{ flexShrink: 0, minWidth: 64, fontWeight: 500 }}>{meta.label}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{evt.message}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // ---- 配置态视图 ----
  const renderConfigView = () => {
    const hasCheckpoint = state.hasCheckpoint && state.checkpoint;
    return (
      <div style={{ paddingTop: 8 }}>
        {hasCheckpoint && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`检测到未完成的编排断点：已完成 ${state.checkpoint!.completedChapters} 章，下一章为第 ${state.checkpoint!.nextChapterIndex + 1} 章`}
            description="可以点击「断点续跑」从上次中断处继续，或点击「重新开始」覆盖断点从头编排。"
          />
        )}

        {totalChapters === 0 ? (
          <Alert type="warning" showIcon message="项目大纲为空，请先生成大纲后再启动智能体写作。" />
        ) : (
          <>
            {/* 章节范围 */}
            <div style={{ marginBottom: 16 }}>
              <Text strong>章节范围</Text>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>第</span>
                <InputNumber
                  min={1}
                  max={totalChapters}
                  placeholder="起始"
                  value={startChapter !== undefined ? startChapter + 1 : undefined}
                  onChange={(v) => setStartChapter(v !== null && v !== undefined ? v - 1 : undefined)}
                  style={{ width: 80 }}
                />
                <span>章 至 第</span>
                <InputNumber
                  min={1}
                  max={totalChapters}
                  placeholder="结束"
                  value={endChapter !== undefined ? endChapter + 1 : undefined}
                  onChange={(v) => setEndChapter(v !== null && v !== undefined ? v - 1 : undefined)}
                  style={{ width: 80 }}
                />
                <span>章</span>
                <Tooltip title="留空则默认：起始=第一个未完成章节，结束=大纲最后一章">
                  <Tag color="blue">共 {totalChapters} 章</Tag>
                </Tooltip>
              </div>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            {/* 编排选项 */}
            <div style={{ marginBottom: 16 }}>
              <Text strong>编排选项</Text>
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                <OptionRow
                  label="剧情检查"
                  tooltip="写完每章后自动执行剧情检查"
                  checked={options.enablePlotCheck}
                  onChange={(v) => setOptions((o) => ({ ...o, enablePlotCheck: v }))}
                />
                <OptionRow
                  label="自动修复"
                  tooltip="对 critical/high 问题自动执行快速修复"
                  checked={options.enableAutoFix}
                  onChange={(v) => setOptions((o) => ({ ...o, enableAutoFix: v }))}
                />
                <OptionRow
                  label="表格整理"
                  tooltip="写完每章后自动整理状态表"
                  checked={options.enableTableOrganize}
                  onChange={(v) => setOptions((o) => ({ ...o, enableTableOrganize: v }))}
                />
                <OptionRow
                  label="跳过已写章节"
                  tooltip="已有内容的章节自动跳过"
                  checked={options.skipExistingChapters}
                  onChange={(v) => setOptions((o) => ({ ...o, skipExistingChapters: v }))}
                />
              </div>

              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
                <Space>
                  <Text>修复阈值：</Text>
                  <Select
                    value={options.autoFixMinSeverity}
                    onChange={(v) => setOptions((o) => ({ ...o, autoFixMinSeverity: v }))}
                    style={{ width: 100 }}
                    options={[
                      { value: 'critical', label: 'Critical' },
                      { value: 'high', label: 'High' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'low', label: 'Low' },
                    ]}
                  />
                </Space>
                <Space>
                  <Text>单章重试：</Text>
                  <InputNumber
                    min={0}
                    max={5}
                    value={options.maxRetriesPerChapter}
                    onChange={(v) => setOptions((o) => ({ ...o, maxRetriesPerChapter: v ?? 2 }))}
                    style={{ width: 70 }}
                  />
                  <Text type="secondary">次</Text>
                </Space>
              </div>
            </div>

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="编排流程：读大纲 → 写章 → 剧情检查 → 自动修复 → 表格整理 → 下一章"
              description="单章失败不会中断整体编排。可随时取消，已完成章节会保存断点支持续跑。"
            />
          </>
        )}
      </div>
    );
  };

  // ---- 运行态视图 ----
  const renderRunningView = () => {
    const percent = state.latestEvent?.percent ?? 0;
    const currentChapter = state.latestEvent?.chapterIndex;
    const currentTitle = state.latestEvent?.chapterTitle;
    const completedChapters = state.latestEvent?.completedChapters ?? 0;
    const totalForDisplay = state.latestEvent?.totalChapters ?? 0;

    return (
      <div>
        {/* 进度条 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text strong>
              {currentChapter !== undefined && currentTitle
                ? `第 ${currentChapter + 1} 章「${currentTitle}」`
                : '智能体写作中...'}
            </Text>
            <Text type="secondary">
              {completedChapters} / {totalForDisplay} 章
            </Text>
          </div>
          <Progress
            percent={percent}
            status="active"
            strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
          />
        </div>

        {/* 当前事件提示 */}
        {state.latestEvent?.message && (
          <Alert
            type="info"
            showIcon
            icon={<LoadingOutlined />}
            message={state.latestEvent.message}
            style={{ marginBottom: 12 }}
          />
        )}

        <Divider style={{ margin: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            事件流
          </Text>
        </Divider>

        {renderEventList()}
      </div>
    );
  };

  // ---- 完成态视图 ----
  const renderResultView = () => {
    if (!state.result) return null;
    const r = state.result;
    return (
      <div>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          {r.success ? (
            <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
          ) : r.cancelled ? (
            <StopOutlined style={{ fontSize: 48, color: '#faad14' }} />
          ) : (
            <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
          )}
          <div style={{ marginTop: 12, fontSize: 16, fontWeight: 500 }}>
            {r.success ? '智能体写作完成' : r.cancelled ? '智能体写作已取消' : '智能体写作失败'}
          </div>
          {r.error && (
            <Paragraph type="danger" style={{ marginTop: 8 }}>
              {r.error}
            </Paragraph>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            margin: '16px 0',
          }}
        >
          <StatCard label="成功" value={r.succeededChapters} color="#52c41a" />
          <StatCard label="跳过" value={r.skippedChapters} color="#8c8c8c" />
          <StatCard label="失败" value={r.failedChapters} color="#ff4d4f" />
          <StatCard label="耗时" value={formatDuration(r.totalDurationMs)} color="#1890ff" />
        </div>

        <Divider style={{ margin: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            事件流
          </Text>
        </Divider>
        {renderEventList()}
      </div>
    );
  };

  // ---- 底部按钮 ----
  const renderFooter = () => {
    if (phase === 'running') {
      return (
        <Space>
          <Button danger icon={<StopOutlined />} onClick={cancel}>
            取消编排
          </Button>
        </Space>
      );
    }
    if (phase === 'result') {
      return (
        <Space>
          <Button
            onClick={() => {
              // 重置回配置态
              refreshStatus();
            }}
          >
            查看断点
          </Button>
          <Button type="primary" onClick={handleClose}>
            关闭
          </Button>
        </Space>
      );
    }
    // 配置态
    return (
      <Space>
        <Button onClick={handleClose}>取消</Button>
        {state.hasCheckpoint && (
          <Button icon={<ReloadOutlined />} onClick={handleResume} disabled={totalChapters === 0}>
            断点续跑
          </Button>
        )}
        <Button
          type="primary"
          icon={<RobotOutlined />}
          onClick={handleStart}
          disabled={totalChapters === 0}
        >
          开始智能体写作
        </Button>
      </Space>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: '#1890ff' }} />
          <span>智能体写作</span>
          {state.running && <Tag color="processing">运行中</Tag>}
          {state.hasCheckpoint && !state.running && <Tag color="orange">有断点</Tag>}
        </Space>
      }
      open={visible}
      onCancel={state.running ? undefined : handleClose}
      width={640}
      footer={renderFooter()}
      maskClosable={!state.running}
      closable={!state.running}
      destroyOnClose={false}
    >
      {phase === 'config' && renderConfigView()}
      {phase === 'running' && renderRunningView()}
      {phase === 'result' && renderResultView()}
    </Modal>
  );
};

// ==================== 辅助组件 ====================

const OptionRow: React.FC<{
  label: string;
  tooltip: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, tooltip, checked, onChange }) => (
  <Tooltip title={tooltip}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text>{label}</Text>
      <Switch size="small" checked={checked} onChange={onChange} />
    </div>
  </Tooltip>
);

const StatCard: React.FC<{ label: string; value: React.ReactNode; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div
    style={{
      textAlign: 'center',
      padding: '12px 8px',
      background: 'var(--bg-elevated)',
      borderRadius: 6,
      border: '1px solid var(--border-base)',
    }}
  >
    <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
  </div>
);

// ==================== 工具函数 ====================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}时${remainingMinutes}分`;
}

export default WritingAgentModal;
