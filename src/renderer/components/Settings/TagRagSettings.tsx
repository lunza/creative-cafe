/**
 * TagRagSettings — RAG 标签库配置面板（Spec: rag-tag-library-for-ai-trait-generation / Task 10）
 *
 * 职责：
 *  1. 全局开关（启用 RAG 标签库注入）→ tagRag.enabled
 *  2. 状态卡片：展示当前索引状态（idle/vectorizing/ready/error/stale）+ 向量化进度条
 *  3. 向量化控制：开始向量化 / 强制重新向量化 / 取消向量化 / 清空索引
 *  4. 检索参数：topK / minScore / batchSize / localBatchSize / retry 配置
 *  5. 检索测试区：输入文本 → 调用 tagRag:search → 展示召回的 top-K 相关标签
 *
 * 配置读写方式（与 TagAutocompleteSettings 一致）：
 *  - 读取：useSettingStore 的 setting.tagRag（Zustand store）
 *  - 保存：通过 forwardRef + useImperativeHandle 暴露 getFormValues()，
 *          由 Settings.tsx 的 handleSave 合并到 updatedSetting.tagRag 中保存
 *
 * 关键 IPC：
 *  - window.electronAPI.tagRag.getStatus() → Promise<TagRagState>
 *  - window.electronAPI.tagRag.startVectorization({ force? }) → Promise<TagRagVectorizeResult>
 *  - window.electronAPI.tagRag.cancelVectorization() → Promise<TagRagCancelResult>
 *  - window.electronAPI.tagRag.search({ query, topK?, minScore?, categoryFilter? }) → Promise<TagRagSearchResponse>
 *  - window.electronAPI.tagRag.clearIndex() → Promise<TagRagClearResult>
 *  - window.electronAPI.tagRag.onProgress(callback) → 取消订阅函数
 */
import { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Switch,
  Space,
  Alert,
  Tooltip,
  Typography,
  Progress,
  Tag,
  message,
  Divider,
  List,
} from 'antd';
import {
  DatabaseOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import type { TagRagConfig } from '../../types/setting';

const { Text, Paragraph } = Typography;

/**
 * TagRagSettings 暴露给父组件的 ref 接口。
 * 与 TagAutocompleteSettingsRef 一致：通过 getFormValues() 取出表单值，由 Settings.tsx 合并保存。
 */
export interface TagRagSettingsRef {
  getFormValues: () => TagRagConfig | undefined;
}

/**
 * RAG 标签库默认配置（与 src/shared/settings.ts defaultSetting.tagRag 保持一致）。
 * 当 setting.tagRag 不存在时（旧配置迁移场景）用于初始化表单。
 */
const DEFAULT_TAG_RAG_CONFIG: TagRagConfig = {
  enabled: false,
  topK: 40,
  minScore: 0.15,
  autoRevectorizeOnCsvChange: true,
  autoRevectorizeOnDimensionChange: true,
  batchSize: 500,
  localBatchSize: 32,
  concurrency: 3,
  retryMaxAttempts: 3,
  retryDelayMs: 1000,
};

/** TagRag 状态快照（tagRag:getStatus 返回值的渲染进程类型） */
interface TagRagStateSnapshot {
  status: 'idle' | 'vectorizing' | 'ready' | 'error' | 'stale';
  current: number;
  total: number;
  failedCount: number;
  startedAt?: number;
  finishedAt?: number;
  lastError?: string;
  meta: {
    csvHash: string;
    dimension: number;
    model: string;
    totalTags: number;
    vectorizedCount: number;
    failedCount: number;
    lastVectorizedAt: number;
    durationMs: number;
    status: 'ready' | 'error';
  } | null;
}

/** 进度事件（tagRag:progress 推送的载荷类型） */
interface TagRagProgressSnapshot {
  phase: 'starting' | 'embedding' | 'storing' | 'finalizing' | 'done' | 'error' | 'cancelled';
  current: number;
  total: number;
  percentage: number;
  eta?: number;
  failedCount: number;
  message?: string;
  error?: string;
}

/** 检索结果项 */
interface TagRagSearchResultItemSnapshot {
  name: string;
  category: number;
  count: number;
  aliases: string[];
  score: number;
}

/** Danbooru 分类编号 → 中文名映射（用于检索结果展示） */
const DANBOORU_CATEGORY_LABELS: Record<number, string> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  6: 'deprecated',
  7: 'lore',
  8: 'tier',
};

/**
 * 状态 → 颜色 / 图标 / 文案映射（用于状态卡片展示）。
 */
function getStatusDisplay(status: TagRagStateSnapshot['status']): {
  color: string;
  icon: React.ReactNode;
  label: string;
  description: string;
} {
  switch (status) {
    case 'idle':
      return {
        color: 'default',
        icon: <DatabaseOutlined />,
        label: '未向量化',
        description: '标签库尚未向量化，AI 生成特征时不会注入 RAG 参考。点击下方「开始向量化」按钮启动（耗时约 1-2.5 小时）',
      };
    case 'vectorizing':
      return {
        color: 'processing',
        icon: <CloudUploadOutlined spin />,
        label: '向量化中',
        description: '正在批量向量化标签库，进度条实时显示。可点击「取消向量化」中止（已写入数据保留）',
      };
    case 'ready':
      return {
        color: 'success',
        icon: <CheckCircleOutlined />,
        label: '就绪',
        description: '索引已就绪，AI 生成特征时会自动注入 RAG 参考段落',
      };
    case 'error':
      return {
        color: 'error',
        icon: <WarningOutlined />,
        label: '失败',
        description: '上次向量化失败，请查看错误信息后重试',
      };
    case 'stale':
      return {
        color: 'warning',
        icon: <WarningOutlined />,
        label: '索引过期',
        description: 'CSV / embedding 维度 / embedding 模型发生变更，需重新向量化以保持索引有效',
      };
  }
}

/**
 * TagRagSettings 面板组件。
 *
 * 父组件通过 ref.current.getFormValues() 在保存时获取表单值，
 * 与 TagAutocompleteSettings 模式一致。
 */
const TagRagSettings = forwardRef<TagRagSettingsRef>((_props, ref) => {
  const [form] = Form.useForm<TagRagConfig>();
  const setting = useSettingStore(s => s.setting);

  // 当前 RAG 状态（用于状态卡片展示）
  const [status, setStatus] = useState<TagRagStateSnapshot | null>(null);
  // 当前向量化进度（由 onProgress 事件推送）
  const [progress, setProgress] = useState<TagRagProgressSnapshot | null>(null);
  // 向量化按钮 loading 态（startVectorization 调用期间）
  const [vectorizing, setVectorizing] = useState(false);
  // 取消按钮 loading 态
  const [canceling, setCanceling] = useState(false);
  // 清空按钮 loading 态
  const [clearing, setClearing] = useState(false);

  // 检索测试区状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TagRagSearchResultItemSnapshot[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 进度事件订阅注销函数（组件卸载时调用）
  const unsubscribeProgressRef = useRef<(() => void) | null>(null);

  // 暴露 getFormValues 给父组件
  useImperativeHandle(ref, () => ({
    getFormValues: () => {
      const values = form.getFieldsValue(true) as Partial<TagRagConfig>;
      // 合并默认值，避免字段缺失
      return {
        ...DEFAULT_TAG_RAG_CONFIG,
        ...values,
      } as TagRagConfig;
    },
  }));

  // 当 setting 加载/变化时，初始化表单值
  useEffect(() => {
    const saved = setting?.tagRag;
    const initialValues: TagRagConfig = {
      ...DEFAULT_TAG_RAG_CONFIG,
      ...(saved || {}),
    };
    form.setFieldsValue(initialValues);
  }, [setting, form]);

  /**
   * 拉取 RAG 当前状态。
   * 在面板挂载 / 向量化完成 / 取消 / 清空后调用。
   */
  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.electronAPI.tagRag.getStatus();
      setStatus(s);
      // vectorizing 期间清除旧的 progress（避免显示过时的进度）
      if (s.status !== 'vectorizing') {
        setProgress(null);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      message.error(`获取 RAG 状态失败：${errorMsg}`);
    }
  }, []);

  // 面板挂载时：拉取状态 + 订阅进度事件
  useEffect(() => {
    refreshStatus();

    // 标记是否已收到首个进度事件（用于触发 status 刷新，确保进度条显示条件满足）
    let firstProgressReceived = false;

    // 订阅 tagRag:progress 事件
    const unsubscribe = window.electronAPI.tagRag.onProgress((event) => {
      setProgress(event);

      // ⚠️ Bug 修复：首个进度事件到达时立即刷新 status，确保 status.status 切换到 'vectorizing'
      // 原因：startVectorization IPC 是长任务（await 直到完成），vectorizing 期间 status 不会自动更新，
      //       导致 isVectorizing=false → 进度条条件 (isVectorizing && progress) 不满足 → 进度条不显示
      if (!firstProgressReceived && (event.phase === 'starting' || event.phase === 'embedding' || event.phase === 'storing')) {
        firstProgressReceived = true;
        refreshStatus();
      }

      // done / error / cancelled 阶段同步刷新状态
      if (event.phase === 'done' || event.phase === 'error' || event.phase === 'cancelled') {
        firstProgressReceived = false;
        // 延迟 200ms 刷新，确保主进程状态已写入
        setTimeout(refreshStatus, 200);
      }
    });
    unsubscribeProgressRef.current = unsubscribe;

    return () => {
      // 组件卸载时取消订阅，避免内存泄漏
      if (unsubscribeProgressRef.current) {
        unsubscribeProgressRef.current();
        unsubscribeProgressRef.current = null;
      }
    };
  }, [refreshStatus]);

  /**
   * 开始向量化按钮回调。
   * - 默认 force=false（指纹匹配则跳过）
   * - 按住 Shift 点击或点击「强制重新向量化」按钮时 force=true
   */
  const handleStartVectorization = useCallback(
    async (force: boolean = false) => {
      setVectorizing(true);
      setProgress(null);
      try {
        const result = await window.electronAPI.tagRag.startVectorization({ force });
        if (result.success) {
          message.success(
            `向量化完成：成功 ${result.vectorized} 条，失败 ${result.failed} 条` +
              (result.durationMs ? `，耗时 ${Math.round(result.durationMs / 1000)}s` : '')
          );
        } else if (result.error && result.error !== '用户取消') {
          message.error(`向量化失败：${result.error}`);
        }
        await refreshStatus();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        message.error(`向量化异常：${errorMsg}`);
      } finally {
        setVectorizing(false);
      }
    },
    [refreshStatus]
  );

  /** 取消向量化按钮回调 */
  const handleCancelVectorization = useCallback(async () => {
    setCanceling(true);
    try {
      const result = await window.electronAPI.tagRag.cancelVectorization();
      if (result.success) {
        message.success(result.message || '取消请求已提交');
      } else {
        message.warning(result.message || '当前无进行中的向量化任务');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      message.error(`取消向量化异常：${errorMsg}`);
    } finally {
      setCanceling(false);
    }
  }, []);

  /** 清空索引按钮回调 */
  const handleClearIndex = useCallback(async () => {
    // 二次确认（避免误操作）
    const confirmed = window.confirm('确认清空 RAG 标签库索引？此操作会删除所有向量数据与 meta 文件，需重新向量化。');
    if (!confirmed) return;

    setClearing(true);
    try {
      const result = await window.electronAPI.tagRag.clearIndex();
      if (result.success) {
        message.success('索引已清空');
      } else {
        message.error(`清空索引失败：${result.error || '未知错误'}`);
      }
      await refreshStatus();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      message.error(`清空索引异常：${errorMsg}`);
    } finally {
      setClearing(false);
    }
  }, [refreshStatus]);

  /** 检索测试按钮回调 */
  const handleSearch = useCallback(async () => {
    const query = (searchQuery || '').trim();
    if (!query) {
      message.warning('请输入查询文本');
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const result = await window.electronAPI.tagRag.search({ query });
      if (result.success) {
        setSearchResults(result.results);
        if (result.results.length === 0) {
          message.info('未检索到相关标签（可能索引未就绪或相似度都低于阈值）');
        }
      } else {
        setSearchError(result.error || '检索失败');
        setSearchResults([]);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setSearchError(errorMsg);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  // 渲染状态卡片
  const renderStatusCard = () => {
    if (!status) return null;
    const display = getStatusDisplay(status.status);
    // ⚠️ 进度条显示条件：status 报告 vectorizing，或按钮处于 vectorizing loading 态，
    // 或 progress 事件处于活跃阶段（starting/embedding/storing/finalizing）
    const isActiveProgress =
      vectorizing ||
      status.status === 'vectorizing' ||
      (progress !== null && ['starting', 'embedding', 'storing', 'finalizing'].includes(progress.phase));
    const isVectorizing = isActiveProgress;
    const isReady = status.status === 'ready';
    const isStale = status.status === 'stale';

    return (
      <Alert
        type={
          isReady ? 'success' : isVectorizing ? 'info' : status.status === 'error' ? 'error' : isStale ? 'warning' : 'info'
        }
        showIcon
        icon={display.icon}
        style={{ marginBottom: 16 }}
        message={
          <Space>
            <strong>RAG 索引状态：</strong>
            <Tag color={display.color}>{display.label}</Tag>
            {status.meta && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                维度 {status.meta.dimension} / 模型 {status.meta.model}
              </Text>
            )}
          </Space>
        }
        description={
          <div>
            <p style={{ margin: 0 }}>{display.description}</p>
            {status.meta && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                <p style={{ margin: 0 }}>
                  <strong>已向量化：</strong>
                  {status.meta.vectorizedCount} / {status.meta.totalTags} 条（失败 {status.meta.failedCount} 条）
                </p>
                <p style={{ margin: '4px 0 0 0' }}>
                  <strong>上次向量化：</strong>
                  {new Date(status.meta.lastVectorizedAt).toLocaleString()}（耗时{' '}
                  {Math.round(status.meta.durationMs / 1000)}s）
                </p>
                <p style={{ margin: '4px 0 0 0' }}>
                  <strong>CSV 指纹：</strong>
                  <code>{status.meta.csvHash}</code>
                </p>
              </div>
            )}
            {status.lastError && (
              <p style={{ margin: '8px 0 0 0', color: 'red', whiteSpace: 'pre-line' }}>
                <strong>错误：</strong>
                {status.lastError}
              </p>
            )}
            {/* 进度条（vectorizing 期间显示，使用 isActiveProgress 兜底确保始终可见） */}
            {isActiveProgress && progress && (
              <div style={{ marginTop: 12 }}>
                <Progress
                  percent={progress.percentage}
                  status="active"
                  format={() => `${progress.current} / ${progress.total}`}
                />
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                  {progress.message}
                  {progress.eta !== undefined && progress.eta > 0 && `（预计剩余 ${progress.eta}s）`}
                  {progress.failedCount > 0 && `（失败 ${progress.failedCount} 条）`}
                </div>
              </div>
            )}
          </div>
        }
      />
    );
  };

  // 渲染向量化控制按钮组
  const renderVectorizationControls = () => {
    // ⚠️ 与 renderStatusCard 一致：用 vectorizing 按钮态 + status + progress phase 综合判断
    const isVectorizing =
      vectorizing ||
      status?.status === 'vectorizing' ||
      (progress !== null && ['starting', 'embedding', 'storing', 'finalizing'].includes(progress.phase));

    return (
      <Form.Item>
        <Space wrap>
          {!isVectorizing ? (
            <>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => handleStartVectorization(false)}
                loading={vectorizing}
              >
                {status?.status === 'ready' ? '增量向量化（仅缺失项）' : '开始向量化'}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => handleStartVectorization(true)}
                loading={vectorizing}
              >
                强制重新向量化
              </Button>
            </>
          ) : (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleCancelVectorization}
              loading={canceling}
            >
              取消向量化
            </Button>
          )}
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleClearIndex}
            loading={clearing}
            disabled={isVectorizing || status?.status === 'idle'}
          >
            清空索引
          </Button>
        </Space>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            向量化是异步长任务（远程 API 并发 3 × 批大小 500 约 20 分钟，本地 ONNX 约 2.5 小时），进度条实时显示。
            <br />
            「增量向量化」：指纹匹配则跳过；「强制重新向量化」：忽略指纹重新建立索引。
            <br />
            <strong>速度优化提示：</strong>增大「远程 API 并发数」可线性提升速度，但需注意 API 的 RPM/TPM 速率限制。
          </Text>
        </div>
      </Form.Item>
    );
  };

  // 渲染检索测试区
  const renderSearchTestSection = () => {
    return (
      <>
        <Divider orientation="left" plain>
          <Space>
            <SearchOutlined />
            <span>检索测试</span>
          </Space>
        </Divider>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          输入角色描述 / 自然语言指令，测试 RAG 检索召回的相关标签。需先完成向量化（状态为「就绪」）。
        </Paragraph>
        <Input.TextArea
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="例：白色毛发的犬耳少女，穿着哥特风黑色连衣裙，蓝色眼睛"
          rows={3}
          style={{ marginBottom: 8 }}
        />
        <Space style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={handleSearch}
            loading={searching}
            disabled={status?.status !== 'ready'}
          >
            检索
          </Button>
          {status?.status !== 'ready' && (
            <Text type="warning" style={{ fontSize: 12 }}>
              索引未就绪（{status?.status || '未知'}），无法检索
            </Text>
          )}
        </Space>

        {searchError && (
          <Alert
            type="error"
            message="检索失败"
            description={searchError}
            showIcon
            closable
            onClose={() => setSearchError(null)}
            style={{ marginBottom: 12 }}
          />
        )}

        {searchResults && searchResults.length > 0 && (
          <List
            size="small"
            bordered
            dataSource={searchResults}
            renderItem={(item, index) => (
              <List.Item>
                <Space>
                  <Text type="secondary">#{index + 1}</Text>
                  <Text strong>{item.name}</Text>
                  <Tag color="blue">{DANBOORU_CATEGORY_LABELS[item.category] || `cat-${item.category}`}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    count: {item.count.toLocaleString()}
                  </Text>
                  <Text type="success" style={{ fontSize: 12 }}>
                    score: {item.score.toFixed(4)}
                  </Text>
                  {item.aliases.length > 0 && (
                    <Tooltip title={`别名: ${item.aliases.slice(0, 5).join(', ')}${item.aliases.length > 5 ? '...' : ''}`}>
                      <Tag style={{ fontSize: 11 }}>别名 ×{item.aliases.length}</Tag>
                    </Tooltip>
                  )}
                </Space>
              </List.Item>
            )}
          />
        )}

        {searchResults && searchResults.length === 0 && !searchError && (
          <Alert
            type="info"
            message="无匹配结果"
            description="所有标签的相似度均低于阈值（minScore），或索引为空。可降低 minScore 后重试。"
            showIcon
          />
        )}
      </>
    );
  };

  return (
    <Card
      title={
        <Space>
          <DatabaseOutlined />
          <span>RAG 标签库</span>
          <Tooltip title="将 31.7 万 Danbooru/e621 标签向量化后语义检索，在 AI 生成特征时注入参考段落，防止生成标签库以外的无效 tag">
            <QuestionCircleOutlined />
          </Tooltip>
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      {/* 顶部说明 */}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: 'rgba(99, 102, 241, 0.08)',
          borderRadius: '8px',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
          RAG（Retrieval-Augmented Generation）标签库：基于向量语义检索，从 31.7 万标签中召回与角色描述最相关的 top-K 标签，
          注入到 AI 生成特征的 system prompt 中，引导 LLM 优先使用标签库内的有效 tag（下划线格式）。
          <br />
          <strong>前置条件：</strong>需在「向量设置」中配置 EmbeddingService（远程 API 或本地 ONNX 模型）。
          <br />
          <strong>资源消耗：</strong>向量化耗时 1-2.5 小时，磁盘空间约 1.9GB（1536 维 × 31.7 万 × 4B）。
        </p>
      </div>

      {/* 状态卡片 */}
      {renderStatusCard()}

      <Form form={form} layout="vertical">
        {/* ==================== 全局开关 ==================== */}
        <Form.Item
          name="enabled"
          label="启用 RAG 标签库注入"
          valuePropName="checked"
          tooltip="开启后，AI 生成特征时会自动检索标签库并注入参考段落；关闭时完全跳过 RAG 检索"
        >
          <Switch />
        </Form.Item>

        {/* ==================== 向量化控制 ==================== */}
        {renderVectorizationControls()}

        {/* ==================== 检索参数 ==================== */}
        <Divider orientation="left" plain>
          检索参数
        </Divider>

        <Form.Item
          name="topK"
          label={
            <Space>
              <span>检索数量（topK）</span>
              <Tooltip title="AI 生成特征时从标签库召回的标签数量。增大可提供更多参考但增加 prompt 长度（默认 40）">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber min={1} max={200} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="minScore"
          label={
            <Space>
              <span>最低相似度阈值（minScore）</span>
              <Tooltip title="cosine similarity 0-1，低于此分数的标签被过滤。降低可召回更多弱相关标签（默认 0.15）">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="batchSize"
          label={
            <Space>
              <span>远程 API 批大小</span>
              <Tooltip title="远程 embedding API 单次请求的文本数量（默认 500，OpenAI 支持最高 2048）。增大可减少 API 调用次数，但单次请求耗时与内存占用增加">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber min={1} max={2048} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="concurrency"
          label={
            <Space>
              <span>远程 API 并发数</span>
              <Tooltip title="同时发送的 embedding API 请求数（默认 3）。增大可显著加快向量化速度（如 317600 条标签从 ~1.7 小时降至 ~20 分钟），但受 API 速率限制（RPM/TPM）约束，过高可能触发 429 错误">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber min={1} max={10} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="localBatchSize"
          label={
            <Space>
              <span>本地 ONNX 批大小</span>
              <Tooltip title="本地 ONNX 模型推理批大小（默认 32，受 CPU/GPU 推理速度影响）">
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
        >
          <InputNumber min={1} max={256} style={{ width: '100%' }} />
        </Form.Item>

        {/* ==================== 自动 stale 配置 ==================== */}
        <Divider orientation="left" plain>
          索引新鲜度
        </Divider>

        <Form.Item
          name="autoRevectorizeOnCsvChange"
          label="CSV 变更时自动标记 stale"
          valuePropName="checked"
          tooltip="标签库 CSV 文件被替换/重载时，自动将索引标记为过期，下次启动后提示重新向量化"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="autoRevectorizeOnDimensionChange"
          label="embedding 维度变更时自动标记 stale"
          valuePropName="checked"
          tooltip="切换 embedding 模型导致维度变化时，自动将索引标记为过期"
        >
          <Switch />
        </Form.Item>

        {/* ==================== 重试参数 ==================== */}
        <Divider orientation="left" plain>
          错误重试
        </Divider>

        <Form.Item
          name="retryMaxAttempts"
          label="单批失败重试次数"
          tooltip="单批 embedding 失败时的重试次数（线性退避：第 N 次延迟 N × retryDelayMs）"
        >
          <InputNumber min={0} max={10} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="retryDelayMs"
          label="重试基础延迟（ms）"
          tooltip="重试间隔基础延迟，实际延迟 = attempt × retryDelayMs"
        >
          <InputNumber min={0} max={10000} step={100} style={{ width: '100%' }} />
        </Form.Item>

        {/* ==================== 检索测试区 ==================== */}
        {renderSearchTestSection()}
      </Form>
    </Card>
  );
});

TagRagSettings.displayName = 'TagRagSettings';

export default TagRagSettings;
