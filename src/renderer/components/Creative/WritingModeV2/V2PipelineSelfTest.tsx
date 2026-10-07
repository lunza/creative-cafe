/**
 * 全流程创作流水线 dev-only 自测控制台
 *
 * Spec: add-novel-writing-pipeline-api / Task 7
 * 仅在 import.meta.env.DEV 下由 WritingV2Entry 挂载。
 * 功能：选择规模（冒烟 6000 / 全量 20000）→ 调 runE2E → 实时进度 → 结果（verdict/断言明细/路径）。
 */
import React, { useState } from 'react';
import {
  Alert,
  Button,
  List,
  Modal,
  Progress,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleTwoTone, CloseCircleTwoTone, ExperimentOutlined } from '@ant-design/icons';
import { getPipelineAPI } from '../../../services/writingPipelineService';
import type {
  PipelineE2EReport,
  PipelineProgressEvent,
} from '../../../../shared/types/writing-v2.types';

type Scale = 'smoke' | 'full';

const STAGE_LABELS: Record<string, string> = {
  IDLE: '空闲',
  INIT: '初始化',
  OUTLINE: '大纲生成',
  CHAPTER: '章节创作',
  COMPOSE: '成书导出',
  DONE: '完成',
  ERROR: '错误',
};

const V2PipelineSelfTest: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<Scale>('smoke');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PipelineProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PipelineE2EReport | null>(null);

  const run = async () => {
    const api = getPipelineAPI();
    if (!api) {
      setError('流水线 API 不可用（window.electronAPI.writingV2.pipeline 缺失）');
      return;
    }
    setRunning(true);
    setError(null);
    setReport(null);
    setProgress(null);
    const off = api.onProgress((e: PipelineProgressEvent) => {
      setProgress(e);
    });
    try {
      const res = await api.runE2E({ scale });
      if (res.success && res.data) {
        setReport(res.data.report);
      } else {
        setError(res.error ?? 'E2E 执行失败（未知错误）');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      off();
      setRunning(false);
    }
  };

  const close = () => {
    if (running) return;
    setOpen(false);
  };

  const verdict = report?.verdict;

  return (
    <>
      <Button
        size="small"
        type="text"
        icon={<ExperimentOutlined />}
        onClick={() => setOpen(true)}
        style={{ marginTop: 8, alignSelf: 'flex-start' }}
      >
        流水线自测
      </Button>
      <Modal
        title="全流程创作流水线自测（E2E）"
        open={open}
        onCancel={close}
        footer={
          <Space>
            <Button disabled={running} onClick={close}>
              {running ? '执行中…' : '关闭'}
            </Button>
            <Button type="primary" loading={running} disabled={running} onClick={run}>
              {running ? '执行中' : '开始执行'}
            </Button>
          </Space>
        }
        width={720}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Segmented<Scale>
            value={scale}
            onChange={(v) => !running && setScale(v as Scale)}
            disabled={running}
            options={[
              { label: '冒烟（3 章 × 2000 字）', value: 'smoke' },
              { label: '全量（3 章共 20000 字）', value: 'full' },
            ]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            自动保障素材（角色卡 ≥2 / 世界书 ≥1，不足则创建 e2e- 前缀素材）→ 初始化 → 大纲 →
            逐章分片创作 → 成书导出 → 断言校验，报告写入 exports/e2e-report-*.json。
          </Typography.Text>

          {running && (
            <div>
              <Progress percent={progress?.percent ?? 0} status="active" />
              <Typography.Text style={{ fontSize: 12 }}>
                {progress
                  ? `${STAGE_LABELS[progress.stage] ?? progress.stage} ${progress.current}/${progress.total} — ${progress.message}`
                  : '等待首个进度事件…'}
              </Typography.Text>
            </div>
          )}

          {error && <Alert type="error" showIcon message={error} />}

          {report && (
            <>
              <Alert
                type={verdict === 'PASS' ? 'success' : 'error'}
                showIcon
                message={
                  <Space>
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {verdict === 'PASS' ? 'PASS ✓' : 'FAIL ✗'}
                    </Typography.Text>
                    <Tag>{report.scale === 'smoke' ? '冒烟 6000 字' : '全量 20000 字'}</Tag>
                    <Tag>
                      总字数 {report.wordCount} / 章节 {report.chapterCount}
                    </Tag>
                    <Tag>耗时 {Math.round(report.durationMs / 1000)}s</Tag>
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <div>
                      角色卡：{report.characterNames.join('、')}　世界书：{report.worldBookName}
                    </div>
                    <div>成书文件：{report.exportPath || '—'}</div>
                    <div>
                      报告文件：
                      {(report as unknown as { reportPath?: string }).reportPath ?? '—'}
                    </div>
                    {report.error && (
                      <Alert type="error" style={{ marginTop: 8 }} message={report.error} />
                    )}
                  </div>
                }
              />
              <List
                size="small"
                bordered
                style={{ maxHeight: 240, overflow: 'auto' }}
                dataSource={report.assertions}
                renderItem={(a) => (
                  <List.Item style={{ padding: '4px 12px' }}>
                    <Space size={8}>
                      {a.passed ? (
                        <CheckCircleTwoTone twoToneColor="#52c41a" />
                      ) : (
                        <CloseCircleTwoTone twoToneColor="#ff4d4f" />
                      )}
                      <Typography.Text style={{ fontSize: 12 }}>{a.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {a.detail}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          )}
        </Space>
      </Modal>
    </>
  );
};

export default V2PipelineSelfTest;
