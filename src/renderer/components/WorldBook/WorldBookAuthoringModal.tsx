/**
 * WorldBookAuthoringModal —— 世界书编写智能体编排模态框
 *
 * 来源：spec §二 Task 6.2 / 6.3 / 6.4（implement-worldbook-authoring-agent）
 *
 * 对标参考：`src/renderer/components/Creative/WritingMode/WritingAgentModal.tsx`
 *
 * 三态视图（spec §交付物清单 §2 交互流程文档）：
 *  1. 配置态（config）：初始提示输入 + 世界书路径展示 + 质量门槛配置 + 开始按钮
 *  2. 运行态（running）：进度条 + 当前活动 + 事件日志 + 澄清问题交互区 + 取消按钮
 *  3. 完成态（completed）：审计报告摘要（三维度通过率）+ 偏离条目 + 自动修复记录
 *     + 待审阅区入口 + 重新开始按钮
 *
 * 状态机：
 *  - config → (start) → running
 *  - running → (clarify interaction / cancel) → running / completed
 *  - completed → (restart) → config
 *
 * Agent 模式 gating（spec §Requirement: Agent 模式硬约束）：
 *  本 Modal 假定已在 Agent 模式下打开（Task 7 处理 gating）；
 *  若运行时 Agent 模式被关闭，run/cancel/resume 会返回 AGENT_MODE_DISABLED，
 *  Modal 内通过 message 提示并回退到配置态。
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  Button,
  Progress,
  Input,
  Slider,
  Tag,
  Space,
  Divider,
  Alert,
  Typography,
  List,
  Empty,
  Steps,
  Tooltip,
  Switch,
  Select,
  Badge,
  message,
} from 'antd';
import {
  RobotOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  FileSearchOutlined,
  ToolOutlined,
  WarningOutlined,
  QuestionCircleOutlined,
  ForwardOutlined,
  GlobalOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type {
  AuthoringProgressEvent,
  AuditReport,
  AuditAutoFix,
  DeviatedEntry,
} from '../../../shared/types/worldbook-authoring.types';
import { useWorldBookAuthoring } from './hooks/useWorldBookAuthoring';
// Spec: add-agent-web-search-tool / Task 11 — 读取全局 webSearch.enabled 控制 Switch 显示
import { useSettingStore } from '../../stores/settingStore';
import { useWorldBookStore } from '../../stores/worldBookStore';

const { Text, Paragraph } = Typography;

// ==================== Phase 类型 ====================

/**
 * Modal 三态视图状态。
 *
 * - config：配置态（初始提示输入 + 选项配置）
 * - running：运行态（进度条 + 事件流 + 澄清交互）
 * - completed：完成态（审计报告 + 重新开始）
 *
 * 派生规则（参考 WritingAgentModal.tsx 的 phase 推导）：
 *  - state.running=true → running
 *  - state.result 存在 → completed
 *  - 否则 → config
 */
type ModalPhase = 'config' | 'running' | 'completed';

// ==================== 事件元数据（运行态事件日志渲染） ====================

/**
 * 进度事件 phase 的渲染元数据。
 *
 * 参考 WritingAgentModal.tsx 的 EVENT_META 模式：
 *  - icon：事件图标
 *  - color：事件颜色
 *  - label：事件标签（显示在事件日志左侧）
 */
interface ProgressEventMeta {
  icon: React.ReactNode;
  color: string;
  label: string;
}

const EVENT_META: Record<AuthoringProgressEvent['phase'], ProgressEventMeta> = {
  planning_analyzing: { icon: <LoadingOutlined />, color: '#1890ff', label: '分析提示' },
  // Spec: add-agent-web-search-tool — PLANNING 阶段网络搜索补充上下文
  planning_researching: { icon: <FileSearchOutlined />, color: '#13c2c2', label: '搜索资料' },
  planning_clarifying: { icon: <QuestionCircleOutlined />, color: '#faad14', label: '等待澄清' },
  planning_building: { icon: <ToolOutlined />, color: '#1890ff', label: '构建计划' },
  authoring_generating: { icon: <PlayCircleOutlined />, color: '#1890ff', label: '生成条目' },
  authoring_mini_audit: { icon: <FileSearchOutlined />, color: '#faad14', label: '微型审计' },
  authoring_fixing: { icon: <ToolOutlined />, color: '#faad14', label: '自我修正' },
  auditing_full: { icon: <FileSearchOutlined />, color: '#722ed1', label: '完整审计' },
  auditing_fixing: { icon: <ToolOutlined />, color: '#faad14', label: '自动修复' },
  awaiting_review: { icon: <CheckCircleOutlined />, color: '#52c41a', label: '待审阅' },
  complete: { icon: <CheckCircleOutlined />, color: '#52c41a', label: '完成' },
  cancelled: { icon: <StopOutlined />, color: '#ff4d4f', label: '取消' },
  error: { icon: <CloseCircleOutlined />, color: '#ff4d4f', label: '错误' },
};

// ==================== Steps 当前进度推导 ====================

/**
 * 根据 AuthoringState / phase 推导 Steps 组件的 current 索引。
 *
 * Steps 四阶段：PLANNING(0) → AUTHORING(1) → AUDITING(2) → AWAITING_REVIEW(3)
 * （COMPLETE 复用 3，并展示完成态视图）
 */
function deriveStepCurrent(latestEvent: AuthoringProgressEvent | null): number {
  if (!latestEvent) return 0;
  switch (latestEvent.phase) {
    case 'planning_analyzing':
    // Spec: add-agent-web-search-tool — planning_researching 属于 PLANNING 阶段子步骤
    case 'planning_researching':
    case 'planning_clarifying':
    case 'planning_building':
      return 0;
    case 'authoring_generating':
    case 'authoring_mini_audit':
    case 'authoring_fixing':
      return 1;
    case 'auditing_full':
    case 'auditing_fixing':
      return 2;
    case 'awaiting_review':
    case 'complete':
      return 3;
    case 'cancelled':
    case 'error':
    default:
      return 0;
  }
}

// ==================== 思考步骤类型图标映射 ====================

/** ThoughtStep.type 对应的 emoji 图标 */
const STEP_TYPE_ICON: Record<string, string> = {
  llm_call: '🤖',
  parse: '📋',
  decision: '🎯',
  tool_call: '🔧',
};

/**
 * 格式化思考步骤耗时（ms → 简短人类可读）。
 * 与文件底部 formatDuration 不同，此处用于思考步骤徽标，格式更紧凑。
 */
function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ==================== 组件 Props ====================

interface WorldBookAuthoringModalProps {
  /** Modal 是否打开 */
  open: boolean;
  /** 当前选中的世界书文件路径（由 WorldBookManager 透传，作为 agent 写入目标 + 沙盒白名单） */
  worldBookPath: string;
  /** 关闭 Modal 回调（完成态"前往待审阅区"按钮也调用此回调） */
  onClose: () => void;
}

// ==================== 组件实现 ====================

const WorldBookAuthoringModal: React.FC<WorldBookAuthoringModalProps> = ({
  open,
  worldBookPath,
  onClose,
}) => {
  // 从 store 获取世界书列表，用于目标世界书选择
  const worldBooks = useWorldBookStore(s => s.worldBooks);

  // 内部维护选中的世界书路径，优先使用 props 传入的值
  const [selectedPath, setSelectedPath] = useState<string>(worldBookPath);

  // Modal 打开时同步 props 传入的 worldBookPath
  useEffect(() => {
    if (open) {
      setSelectedPath(worldBookPath);
    }
  }, [open, worldBookPath]);

  const { state, start, cancel, resume, refreshStatus, submitAnswers, reset } =
    useWorldBookAuthoring(selectedPath);

  // Spec: add-agent-web-search-tool / Task 11 — 读取全局 webSearch.enabled
  // 仅当全局开关开启时显示"启用网络搜索"Switch（spec §SubTask 11.3）。
  // useSettingStore 已在应用启动时 fetchSetting，此处直接读取 setting.webSearch.enabled。
  const setting = useSettingStore(s => s.setting);
  const globalWebSearchEnabled = setting?.webSearch?.enabled === true;

  // ---- 配置态表单状态 ----
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [qualityThreshold, setQualityThreshold] = useState<number>(0.8);
  // Spec: add-agent-web-search-tool — 是否启用网络搜索补充上下文
  // 默认 false（对齐 DEFAULT_AUTHORING_CONFIG.enableWebSearch）；
  // 全局开关关闭时强制保持 false（即使 Switch 隐藏，state 也不被污染）。
  const [enableWebSearch, setEnableWebSearch] = useState<boolean>(false);

  // ---- 澄清问题回答草稿（questionId -> answer） ----
  // 设计原因：用户在 TextArea 中输入会触发重渲染，若直接存到 state.clarifyQuestions
  //          会导致与 hook 状态竞争；本地草稿在提交时一次性合并。
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  // ---- 事件流自动滚动 ----
  const eventListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (eventListRef.current) {
      eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
    }
  }, [state.events]);

  // ---- 思考过程面板状态 ----
  const [thoughtPanelExpanded, setThoughtPanelExpanded] = useState(true);
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);
  const thoughtEndRef = useRef<HTMLDivElement>(null);

  // ---- 思考过程面板自动滚动到底部 ----
  useEffect(() => {
    if (thoughtPanelExpanded && thoughtEndRef.current) {
      thoughtEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [state.thoughtSteps, thoughtPanelExpanded]);

  // ---- Modal 打开时若已有 sessionId，自动刷新状态（探活断点续跑） ----
  useEffect(() => {
    if (open && state.sessionId) {
      // 通过 hook 暴露的 refreshStatus 探活后端会话状态，
      // 若会话仍存活则 Modal 可显示"断点续跑"按钮
      refreshStatus(state.sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- 当 clarifyQuestions 变化时，重置草稿 ----
  useEffect(() => {
    setAnswerDrafts({});
    setSkippedIds(new Set());
  }, [state.clarifyQuestions]);

  // ---- 当前阶段（决定显示哪个视图） ----
  const phase: ModalPhase = state.running
    ? 'running'
    : state.result
      ? 'completed'
      : 'config';

  // ---- 启动编排 ----
  // Spec: add-agent-web-search-tool / Task 11 — 传入 enableWebSearch（仅当全局开关开启时生效）
  const handleStart = async () => {
    // 全局开关关闭时强制 false（防御性：即使本地 state 被外部篡改也不透传 true）
    const effectiveEnableWebSearch = globalWebSearchEnabled ? enableWebSearch : false;
    await start(userPrompt, qualityThreshold, effectiveEnableWebSearch);
  };

  // ---- 断点续跑 ----
  const handleResume = async () => {
    await resume();
  };

  // ---- 关闭 Modal ----
  const handleClose = () => {
    if (state.running) {
      // 运行中不允许直接关闭（必须先取消）
      message.warning('请先取消当前编写会话再关闭');
      return;
    }
    onClose();
  };

  // ---- 重新开始（完成态 → 配置态） ----
  const handleRestart = () => {
    reset();
    setUserPrompt('');
    setQualityThreshold(0.8);
    // Spec: add-agent-web-search-tool — 重置时同步还原网络搜索开关
    setEnableWebSearch(false);
    setAnswerDrafts({});
    setSkippedIds(new Set());
  };

  // ---- 前往待审阅区（关闭 Modal，用户回到 WorldBookManager 后点击"待审阅"按钮） ----
  const handleGoToReview = () => {
    onClose();
  };

  // ---- 提交澄清问题回答 ----
  const handleSubmitAnswers = async () => {
    if (state.clarifyQuestions.length === 0) return;
    const answers = state.clarifyQuestions.map((q) => {
      const skipped = skippedIds.has(q.id);
      return {
        questionId: q.id,
        answer: skipped ? undefined : (answerDrafts[q.id] ?? '').trim() || undefined,
        skipped,
      };
    });
    // 校验：未跳过且未填写的回答视为无效（提示用户）
    const unanswered = answers.filter((a) => !a.skipped && !a.answer);
    if (unanswered.length > 0) {
      message.warning(`还有 ${unanswered.length} 个问题未回答，请填写或选择跳过`);
      return;
    }
    await submitAnswers(answers);
  };

  // ---- 跳过单个问题 ----
  const handleSkipSingle = (questionId: string) => {
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
  };

  // ---- 跳过全部问题 ----
  const handleSkipAll = () => {
    setSkippedIds((prev) => {
      const next = new Set(prev);
      state.clarifyQuestions.forEach((q) => next.add(q.id));
      return next;
    });
    message.info('已跳过全部问题，智能体将自主推断默认值');
  };

  // ==================== 配置态视图 ====================

  const renderConfigView = () => {
    const hasSession = !!state.sessionId;
    return (
      <div style={{ paddingTop: 8 }}>
        {hasSession && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="检测到未完成的编写会话"
            description="可以点击「断点续跑」从上次中断处继续，或点击「重新开始」覆盖会话从头编写。"
          />
        )}

        {/* 目标世界书选择 */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>目标世界书</Text>
          <div style={{ marginTop: 8 }}>
            <Select
              value={selectedPath || undefined}
              onChange={setSelectedPath}
              placeholder="请选择目标世界书"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              options={worldBooks.map(wb => ({
                label: wb.name,
                value: wb.path,
              }))}
              notFoundContent={
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  暂无世界书，请先创建或导入世界书
                </span>
              }
            />
          </div>
          {selectedPath && (
            <Tooltip title={selectedPath}>
              <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                <FileSearchOutlined style={{ marginRight: 4 }} />
                {extractFileName(selectedPath)}
              </Text>
            </Tooltip>
          )}
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* 初始提示输入 */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>初始提示</Text>
          <div style={{ marginTop: 8 }}>
            <Input.TextArea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="例如：为一部赛博朋克侦探小说创建世界书，包含地下势力、关键人物、城市地理、科技产物等维度..."
              autoSize={{ minRows: 4, maxRows: 8 }}
              maxLength={2000}
              showCount
            />
          </div>
        </div>

        {/* 质量门槛配置 */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>质量门槛</Text>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={qualityThreshold}
              onChange={setQualityThreshold}
              style={{ flex: 1 }}
              tooltip={{ formatter: (v) => `${((v ?? 0) * 100).toFixed(0)}%` }}
            />
            <Tag color={qualityThreshold >= 0.9 ? 'red' : qualityThreshold >= 0.7 ? 'orange' : 'default'}>
              {(qualityThreshold * 100).toFixed(0)}%
            </Tag>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            审计综合分低于此值时阻止进入待审阅状态。建议 0.7-0.9，过高可能导致频繁返工。
          </Text>
        </div>

        {/* Spec: add-agent-web-search-tool / Task 11 — 启用网络搜索 Switch（gated by 全局 webSearch.enabled） */}
        {globalWebSearchEnabled ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={6}>
                <GlobalOutlined style={{ color: '#13c2c2' }} />
                <Text strong>启用网络搜索</Text>
                <Tooltip title="开启后，智能体在 PLANNING / AUTHORING 阶段会调用网络搜索获取相关资料，作为 LLM 上下文补充。搜索失败时不阻断编写流程。">
                  <QuestionCircleOutlined style={{ color: 'var(--text-secondary)', fontSize: 12 }} />
                </Tooltip>
              </Space>
              <Switch
                checked={enableWebSearch}
                onChange={setEnableWebSearch}
                checkedChildren="开"
                unCheckedChildren="关"
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              智能体将根据用户提示与维度名派生搜索关键词，参考网络资料提升内容事实准确性。可在设置中调整搜索 provider 与参数。
            </Text>
          </div>
        ) : (
          <Alert
            type="info"
            showIcon
            icon={<GlobalOutlined />}
            style={{ marginBottom: 16 }}
            message="网络搜索未启用"
            description={
              <span>
                如需让智能体编写时联网搜索补充资料，请先到
                <Text strong>设置 → 网络搜索</Text>开启全局开关后再回到此处启用。
              </span>
            }
          />
        )}

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="编写流程：规划（分析提示 + 澄清问题）→ 自驱编写（按维度生成条目 + 微型审计）→ 审计闭环（三维度审计 + 自动修复）"
          description="所有智能体生成的条目均进入草稿区（autoGenerated=true），需在待审阅区审批后才转为正式条目。可随时取消，已生成草稿会保留。"
        />
      </div>
    );
  };

  // ==================== 运行态视图 ====================

  const renderRunningView = () => {
    const latest = state.latestEvent;
    const percent = latest?.targetEntries && latest.targetEntries > 0
      ? Math.min(100, Math.round((latest.entriesGenerated / latest.targetEntries) * 100))
      : 0;
    const stepCurrent = deriveStepCurrent(latest);

    return (
      <div>
        {/* 顶部 Steps：展示当前所处阶段 */}
        <Steps
          size="small"
          current={stepCurrent}
          style={{ marginBottom: 16 }}
          items={[
            { title: '规划', description: '分析 + 澄清' },
            { title: '编写', description: '按维度生成' },
            { title: '审计', description: '三维度把控' },
            { title: '待审阅', description: '草稿区' },
          ]}
        />

        {/* 进度条 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text strong>
              {latest?.currentDimension
                ? `正在生成「${latest.currentDimension}」维度`
                : latest?.currentActivity || '智能体编写中...'}
            </Text>
            <Text type="secondary">
              {latest?.entriesGenerated ?? 0} / {latest?.targetEntries ?? 0} 条
              {latest?.totalDimensions && latest.totalDimensions > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {latest.completedDimensions ?? 0} / {latest.totalDimensions} 维度
                </span>
              )}
            </Text>
          </div>
          <Progress
            percent={percent}
            status="active"
            strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
          />
        </div>

        {/* 当前活动提示 */}
        {latest?.message && (
          <Alert
            type="info"
            showIcon
            icon={<LoadingOutlined />}
            message={latest.message}
            style={{ marginBottom: 12 }}
          />
        )}

        {/* 思考过程面板（Spec: add-worldbook-thinking-visualization） */}
        {renderThoughtPanel()}

        {/* 澄清问题交互区（SubTask 6.3） */}
        {state.clarifyQuestions.length > 0 && renderClarifySection()}

        {/* 事件流 */}
        {state.clarifyQuestions.length === 0 && (
          <>
            <Divider style={{ margin: '8px 0' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                事件日志
              </Text>
            </Divider>
            {renderEventList()}
          </>
        )}
      </div>
    );
  };

  // ==================== 澄清问题交互区（SubTask 6.3） ====================

  const renderClarifySection = () => {
    return (
      <div style={{ marginTop: 12 }}>
        <Alert
          type="warning"
          showIcon
          icon={<QuestionCircleOutlined />}
          message={`智能体提出了 ${state.clarifyQuestions.length} 个澄清问题`}
          description="请回答以便智能体生成更贴合需求的世界书；也可选择跳过，由智能体自主推断默认值。"
          style={{ marginBottom: 12 }}
        />

        <List
          dataSource={state.clarifyQuestions}
          renderItem={(q, idx) => {
            const isSkipped = skippedIds.has(q.id);
            return (
              <List.Item key={q.id} style={{ display: 'block', padding: '12px 0' }}>
                <div style={{ marginBottom: 8 }}>
                  <Space>
                    <Tag color="orange">问题 {idx + 1}</Tag>
                    <Text strong>{q.question}</Text>
                  </Space>
                </div>
                <div style={{ marginBottom: 8, paddingLeft: 8, borderLeft: '2px solid #faad14' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <Tooltip title="智能体需要此信息的原因">
                      <QuestionCircleOutlined style={{ marginRight: 4 }} />
                    </Tooltip>
                    {q.why || '智能体未提供说明'}
                  </Text>
                </div>
                {isSkipped ? (
                  <Alert
                    type="info"
                    showIcon
                    message="此问题已跳过，智能体将自主推断默认值"
                    style={{ marginBottom: 8 }}
                  />
                ) : (
                  <Input.TextArea
                    value={answerDrafts[q.id] ?? ''}
                    onChange={(e) =>
                      setAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    placeholder="请输入你的回答..."
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    maxLength={500}
                    showCount
                    disabled={isSkipped}
                  />
                )}
                <div style={{ marginTop: 4, textAlign: 'right' }}>
                  {!isSkipped && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => handleSkipSingle(q.id)}
                    >
                      跳过此问题
                    </Button>
                  )}
                </div>
              </List.Item>
            );
          }}
        />

        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Space>
            <Button onClick={handleSkipAll} icon={<ForwardOutlined />}>
              跳过全部
            </Button>
            <Button
              type="primary"
              onClick={handleSubmitAnswers}
              icon={<CheckCircleOutlined />}
            >
              提交回答
            </Button>
          </Space>
        </div>
      </div>
    );
  };

  // ==================== 完成态视图 ====================

  const renderCompletedView = () => {
    if (!state.result) return null;
    const r = state.result;
    const isCancelled = r.finalState === 'CANCELLED';
    const isError = r.finalState === 'ERROR' || (!r.success && !isCancelled);
    const auditReport = r.auditReport;
    // statusIcon / statusText 根据 success / isCancelled / isError 三态派生
    const statusIcon = r.success ? (
      <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
    ) : isCancelled ? (
      <StopOutlined style={{ fontSize: 48, color: '#faad14' }} />
    ) : (
      <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
    );
    const statusText = r.success
      ? '智能体编写完成'
      : isCancelled
        ? '智能体编写已取消'
        : isError
          ? '智能体编写失败'
          : '智能体编写未完成';

    return (
      <div>
        {/* 顶部状态摘要 */}
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          {statusIcon}
          <div style={{ marginTop: 12, fontSize: 16, fontWeight: 500 }}>
            {statusText}
          </div>
          {r.error && (
            <Paragraph type="danger" style={{ marginTop: 8 }}>
              {r.error}
            </Paragraph>
          )}
        </div>

        {/* 摘要统计卡片 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            margin: '16px 0',
          }}
        >
          <StatCard
            label="生成草稿"
            value={r.generatedEntryIds.length}
            color="#1890ff"
          />
          <StatCard
            label="耗时"
            value={formatDuration(r.totalDurationMs)}
            color="#722ed1"
          />
          <StatCard
            label="审计综合分"
            value={auditReport ? `${(auditReport.overallScore * 100).toFixed(0)}%` : '—'}
            color={auditReport?.overallPassed ? '#52c41a' : '#ff4d4f'}
          />
        </div>

        {/* 审计报告（SubTask 6.4） */}
        {auditReport ? (
          renderAuditReport(auditReport)
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ margin: '12px 0' }}
            message="未生成审计报告"
            description={
              isCancelled
                ? '会话已取消，未执行完整审计。已生成的草稿条目仍保留在待审阅区。'
                : '会话异常终止，未执行审计。'
            }
          />
        )}

        <Divider style={{ margin: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            事件日志
          </Text>
        </Divider>
        {renderEventList()}
      </div>
    );
  };

  // ==================== 审计报告展示（SubTask 6.4） ====================

  /**
   * 渲染审计报告摘要：三维度通过率 + 偏离条目 + 自动修复记录。
   *
   * 容错设计（spec §验证步骤 §4）：
   *  - auditReport 可能为 undefined（取消 / 异常），由调用方判断后才调用本方法
   *  - 各子报告字段缺失时显示"无"而非崩溃
   */
  const renderAuditReport = (report: AuditReport) => {
    const completenessRate = report.completeness
      ? computePassRate(
          report.completeness.passed,
          report.completeness.missingFields.length +
            report.completeness.uncoveredDimensions.length +
            report.completeness.underfilledDimensions.length
        )
      : 0;
    const consistencyRate = report.consistency
      ? computePassRate(report.consistency.passed, report.consistency.issues.length)
      : 0;
    const conformanceRate = report.conformance && report.conformance.totalCount > 0
      ? report.conformance.conformantCount / report.conformance.totalCount
      : report.conformance?.passed
        ? 1
        : 0;

    return (
      <div style={{ margin: '12px 0' }}>
        <Divider style={{ margin: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            审计报告（三维度通过率）
          </Text>
        </Divider>

        {/* 三维度通过率 Progress（颜色区分 green/orange/red） */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <AuditProgressCard
            title="完整性"
            rate={completenessRate}
            passed={report.completeness?.passed ?? false}
            detail={
              report.completeness
                ? `缺失字段 ${report.completeness.missingFields.length} · 未覆盖维度 ${report.completeness.uncoveredDimensions.length} · 未达标维度 ${report.completeness.underfilledDimensions.length}`
                : '无数据'
            }
          />
          <AuditProgressCard
            title="一致性"
            rate={consistencyRate}
            passed={report.consistency?.passed ?? false}
            detail={
              report.consistency
                ? `检测到 ${report.consistency.issues.length} 个问题`
                : '无数据'
            }
          />
          <AuditProgressCard
            title="符合度"
            rate={conformanceRate}
            passed={report.conformance?.passed ?? false}
            detail={
              report.conformance
                ? `${report.conformance.conformantCount} / ${report.conformance.totalCount} 条符合`
                : '无数据'
            }
          />
        </div>

        {/* 综合结论 */}
        <Alert
          type={report.overallPassed ? 'success' : 'warning'}
          showIcon
          icon={report.overallPassed ? <CheckCircleOutlined /> : <WarningOutlined />}
          style={{ marginBottom: 12 }}
          message={
            report.overallPassed
              ? `审计通过：综合分 ${(report.overallScore * 100).toFixed(0)}%`
              : `审计未通过：综合分 ${(report.overallScore * 100).toFixed(0)}%（低于门槛）`
          }
          description={
            report.userDecisions.length > 0
              ? `有 ${report.userDecisions.length} 项需用户决策的问题，请到待审阅区查看详情`
              : '所有问题已自动修复或可忽略'
          }
        />

        {/* 偏离条目列表 */}
        {report.conformance && report.conformance.deviatedEntries.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                偏离设定条目（{report.conformance.deviatedEntries.length}）
              </Text>
            </Divider>
            <DeviatedEntriesList entries={report.conformance.deviatedEntries} />
          </>
        )}

        {/* 自动修复记录 */}
        {report.autoFixes.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                自动修复记录（{report.autoFixes.length}）
              </Text>
            </Divider>
            <AutoFixesList autoFixes={report.autoFixes} />
          </>
        )}
      </div>
    );
  };

  // ==================== 思考过程面板（Spec: add-worldbook-thinking-visualization） ====================

  /**
   * 渲染"思考过程"可折叠面板。
   *
   * 展示 state.thoughtSteps 时间线，每个步骤可点击展开查看输入/输出摘要。
   * 面板默认展开，自动滚动到最新步骤。所有颜色使用 CSS 变量适配主题。
   */
  const renderThoughtPanel = () => {
    return (
      <div
        style={{
          border: '1px solid var(--border-light, #f0f0f0)',
          borderRadius: 8,
          margin: '12px 0',
          background: 'var(--bg-container, #fff)',
        }}
      >
        {/* 面板头部（可点击切换展开/折叠） */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            padding: '8px 12px',
            borderBottom: thoughtPanelExpanded
              ? '1px solid var(--border-light, #f0f0f0)'
              : 'none',
          }}
          onClick={() => setThoughtPanelExpanded(!thoughtPanelExpanded)}
        >
          <Space>
            {thoughtPanelExpanded ? <DownOutlined /> : <RightOutlined />}
            <Text strong>思考过程</Text>
          </Space>
          <Badge count={state.thoughtSteps.length} />
        </div>

        {/* 面板内容（仅展开时渲染） */}
        {thoughtPanelExpanded && (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {state.thoughtSteps.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  等待 AI 思考...
                </Text>
              </div>
            ) : (
              state.thoughtSteps.map((step, idx) => (
                <div key={idx}>
                  {/* 步骤项 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '6px 12px',
                      cursor: 'pointer',
                    }}
                    onClick={() =>
                      setExpandedStepIndex(expandedStepIndex === idx ? null : idx)
                    }
                  >
                    {/* 左侧图标：成功/失败 */}
                    <span style={{ marginRight: 8, flexShrink: 0 }}>
                      {step.success ? (
                        <CheckCircleOutlined
                          style={{ color: 'var(--color-success, #52c41a)' }}
                        />
                      ) : (
                        <CloseCircleOutlined
                          style={{ color: 'var(--color-error, #ff4d4f)' }}
                        />
                      )}
                    </span>

                    {/* 中间：类型图标 + purpose + 时间戳 */}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ marginRight: 4 }}>
                        {STEP_TYPE_ICON[step.type] || '❓'}
                      </span>
                      <Text style={{ fontSize: 12 }}>{step.purpose}</Text>
                      <Text
                        type="secondary"
                        style={{ fontSize: 11, marginLeft: 8 }}
                      >
                        {new Date(step.timestamp).toLocaleTimeString('zh-CN', {
                          hour12: false,
                        })}
                      </Text>
                    </span>

                    {/* 耗时徽标 */}
                    <Tag style={{ fontSize: 11, marginRight: 8 }}>
                      {formatStepDuration(step.durationMs)}
                    </Tag>

                    {/* 右侧：展开/折叠箭头 */}
                    {expandedStepIndex === idx ? (
                      <DownOutlined style={{ fontSize: 10 }} />
                    ) : (
                      <RightOutlined style={{ fontSize: 10 }} />
                    )}
                  </div>

                  {/* 展开时显示详情 */}
                  {expandedStepIndex === idx && (
                    <div style={{ paddingLeft: 28, paddingRight: 12, paddingBottom: 8 }}>
                      {step.inputSummary && (
                        <Text
                          type="secondary"
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: 12,
                            display: 'block',
                          }}
                        >
                          输入：{step.inputSummary}
                        </Text>
                      )}
                      {step.outputSummary && (
                        <Text
                          type="secondary"
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: 12,
                            display: 'block',
                          }}
                        >
                          输出：{step.outputSummary}
                        </Text>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            {/* 滚动锚点 */}
            <div ref={thoughtEndRef} />
          </div>
        )}
      </div>
    );
  };

  // ==================== 事件流渲染 ====================

  const renderEventList = () => {
    if (state.events.length === 0) {
      return (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <Empty description="等待编排事件..." image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
        {/* 时间倒序展示（最新在底部，自动滚动到底部） */}
        {state.events.map((evt, idx) => {
          const meta = EVENT_META[evt.phase] || EVENT_META.planning_analyzing;
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
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
                {evt.message || evt.currentActivity}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // ==================== 底部按钮 ====================

  const renderFooter = () => {
    if (phase === 'running') {
      return (
        <Space>
          <Button
            danger
            icon={<StopOutlined />}
            onClick={cancel}
            disabled={state.clarifyQuestions.length > 0}
          >
            取消编写
          </Button>
        </Space>
      );
    }
    if (phase === 'completed') {
      return (
        <Space>
          <Button onClick={handleRestart} icon={<ReloadOutlined />}>
            重新开始
          </Button>
          <Button type="primary" onClick={handleGoToReview} icon={<FileSearchOutlined />}>
            前往待审阅区
          </Button>
        </Space>
      );
    }
    // 配置态
    return (
      <Space>
        <Button onClick={handleClose}>取消</Button>
        {state.sessionId && (
          <Tooltip title="从上次中断处继续">
            <Button icon={<ReloadOutlined />} onClick={handleResume}>
              断点续跑
            </Button>
          </Tooltip>
        )}
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleStart}
          disabled={!userPrompt.trim() || !selectedPath}
          loading={state.running}
        >
          开始智能体编写
        </Button>
      </Space>
    );
  };

  // ---- 阶段切换防抖：完成态 → 配置态的"重新开始"已通过 reset 清理状态 ----
  // 此处 useMemo 计算 phase，确保三态切换无死锁
  const modalTitle = useMemo(() => {
    if (phase === 'running') return '智能体编写中';
    if (phase === 'completed') return '智能体编写完成';
    return '智能体编写';
  }, [phase]);

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: '#1890ff' }} />
          <span>{modalTitle}</span>
          {state.running && <Tag color="processing">运行中</Tag>}
          {state.sessionId && !state.running && <Tag color="orange">有断点</Tag>}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={720}
      footer={renderFooter()}
      maskClosable={!state.running}
      closable={!state.running}
      destroyOnClose={false}
    >
      {phase === 'config' && renderConfigView()}
      {phase === 'running' && renderRunningView()}
      {phase === 'completed' && renderCompletedView()}
    </Modal>
  );
};

// ==================== 辅助组件 ====================

/**
 * 统计卡片（参考 WritingAgentModal.tsx 的 StatCard 模式）。
 */
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

/**
 * 审计维度卡片：Progress + 通过/失败标签 + 详情说明。
 *
 * 颜色规则（spec §完成态的审计报告展示）：
 *  - 通过（passed=true）→ green
 *  - 通过率 >= 0.8 但 passed=false → orange（接近达标）
 *  - 通过率 < 0.8 且 passed=false → red
 */
const AuditProgressCard: React.FC<{
  title: string;
  rate: number;
  passed: boolean;
  detail: string;
}> = ({ title, rate, passed, detail }) => {
  const percent = Math.round(rate * 100);
  const color = passed ? '#52c41a' : rate >= 0.8 ? '#faad14' : '#ff4d4f';
  const status: 'success' | 'exception' | 'active' = passed
    ? 'success'
    : rate < 0.8
      ? 'exception'
      : 'active';
  return (
    <div
      style={{
        padding: '12px',
        background: 'var(--bg-elevated)',
        borderRadius: 6,
        border: '1px solid var(--border-base)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>{title}</Text>
        <Tag color={passed ? 'green' : rate >= 0.8 ? 'orange' : 'red'}>
          {passed ? '通过' : '未通过'}
        </Tag>
      </div>
      <Progress percent={percent} size="small" strokeColor={color} status={status} />
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{detail}</div>
    </div>
  );
};

/**
 * 偏离条目列表（spec §完成态的审计报告展示）。
 *
 * 显示条目名 + 相似度分数（颜色区分：>=0.6 green / 0.4-0.6 orange / <0.4 red）。
 */
const DeviatedEntriesList: React.FC<{ entries: DeviatedEntry[] }> = ({ entries }) => (
  <List
    size="small"
    dataSource={entries}
    renderItem={(entry, idx) => {
      const score = entry.score;
      const scoreColor = score >= 0.6 ? '#52c41a' : score >= 0.4 ? '#faad14' : '#ff4d4f';
      return (
        <List.Item key={`${entry.entryUid}-${idx}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <Space direction="vertical" size={0} style={{ flex: 1 }}>
              <Text style={{ fontSize: 13 }}>
                {entry.entryName || `条目 ${entry.entryUid}`}
              </Text>
              {entry.reason && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {entry.reason}
                </Text>
              )}
            </Space>
            <Tag color={score >= 0.6 ? 'green' : score >= 0.4 ? 'orange' : 'red'}>
              相似度 {(score * 100).toFixed(0)}%
            </Tag>
            <span style={{ marginLeft: 8, color: scoreColor, fontSize: 12 }}>
              <Tooltip title="与用户初始设定的语义相似度">
                <Progress
                  type="circle"
                  percent={Math.round(score * 100)}
                  size={32}
                  strokeColor={scoreColor}
                />
              </Tooltip>
            </span>
          </div>
        </List.Item>
      );
    }}
  />
);

/**
 * 自动修复记录列表（spec §完成态的审计报告展示）。
 *
 * 显示修复字段 + 修复前/后内容 + 严重级别 + 是否已应用。
 */
const AutoFixesList: React.FC<{ autoFixes: AuditAutoFix[] }> = ({ autoFixes }) => (
  <List
    size="small"
    dataSource={autoFixes}
    renderItem={(fix, idx) => (
      <List.Item key={`${fix.entryUid}-${fix.field}-${idx}`}>
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Space>
              <Tag color="blue">字段：{fix.field}</Tag>
              <Tag color={fix.applied ? 'green' : 'default'}>
                {fix.applied ? '已应用' : '建议未应用'}
              </Tag>
              <Tag color={severityColor(fix.severity)}>{fix.severity}</Tag>
            </Space>
            <Text type="secondary" style={{ fontSize: 11 }}>
              条目 {fix.entryUid}
            </Text>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
            <div style={{ padding: 6, background: 'var(--color-error-light)', borderRadius: 4, fontSize: 11 }}>
              <Text type="secondary" style={{ fontSize: 10 }}>修复前：</Text>
              <div style={{ marginTop: 2, wordBreak: 'break-all', maxHeight: 60, overflow: 'auto' }}>
                {fix.oldValue || <Text type="secondary">（空）</Text>}
              </div>
            </div>
            <ArrowRight />
            <div style={{ padding: 6, background: 'var(--color-success-light)', borderRadius: 4, fontSize: 11 }}>
              <Text type="secondary" style={{ fontSize: 10 }}>修复后：</Text>
              <div style={{ marginTop: 2, wordBreak: 'break-all', maxHeight: 60, overflow: 'auto' }}>
                {fix.newValue || <Text type="secondary">（空）</Text>}
              </div>
            </div>
          </div>
          {fix.reason && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
              原因：{fix.reason}
            </Text>
          )}
        </div>
      </List.Item>
    )}
  />
);

/** 简易右箭头组件（用于修复前→修复后展示） */
const ArrowRight: React.FC = () => (
  <span style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center' }}>→</span>
);

// ==================== 工具函数 ====================

/**
 * 计算通过率。
 *
 * @param passed 是否通过
 * @param issueCount 问题数（通过 = 1.0；未通过时按问题数反推：0 问题 = 0.5，多问题递减）
 * @returns [0, 1] 通过率
 */
function computePassRate(passed: boolean, issueCount: number): number {
  if (passed) return 1;
  if (issueCount === 0) return 0.5;
  // 每个问题降低 0.15，最低 0.1
  return Math.max(0.1, 1 - issueCount * 0.15);
}

/**
 * 严重级别对应的 Tag 颜色。
 */
function severityColor(severity: AuditAutoFix['severity']): string {
  switch (severity) {
    case 'info':
      return 'blue';
    case 'warning':
      return 'orange';
    case 'error':
      return 'red';
    case 'critical':
      return 'magenta';
    default:
      return 'default';
  }
}

/**
 * 从路径中提取文件名（用于世界书路径展示）。
 */
function extractFileName(path: string): string {
  if (!path) return '';
  // 同时处理 / 与 \
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * 格式化耗时（ms → 人类可读）。
 * 参考 WritingAgentModal.tsx 的 formatDuration。
 */
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

export default WorldBookAuthoringModal;
