/**
 * 跨章审查设置区（展示组件）：审查范围（起始章+章数）+ 细粒度三参数 + 开始/停止按钮 + 自定义提示词
 * Spec: add-cross-chapter-coherence-review（从 V2CrossCheckPanel 拆出，保持单组件 ≤400 行）
 */
import React from 'react';
import {
  Button,
  InputNumber,
  Select,
  Slider,
  Switch,
  theme,
  Typography,
} from 'antd';
import { AimOutlined, StopOutlined } from '@ant-design/icons';
import {
  CROSS_CHECK_DEFAULTS,
  type CrossCheckStrictness,
} from '../../../../../shared/types/cross-chapter-review.types';
import CustomPromptPopover from '../shared/CustomPromptPopover';

export interface CrossCheckPersistedParams {
  distance: number;
  similarityThreshold: number;
  aiStrictness: CrossCheckStrictness;
  enableAiReview: boolean;
}

interface V2CrossCheckSettingsProps {
  chapterOptions: { value: number; label: string }[];
  startPos: number;
  count: number;
  persisted: CrossCheckPersistedParams;
  running: boolean;
  promptStorageKey: string;
  onStartPositionChange: (v: number) => void;
  onCountChange: (v: number) => void;
  onPersistedChange: (updater: (p: CrossCheckPersistedParams) => CrossCheckPersistedParams) => void;
  onReview: () => void;
  onStop: () => void;
}

const V2CrossCheckSettings: React.FC<V2CrossCheckSettingsProps> = ({
  chapterOptions,
  startPos,
  count,
  persisted,
  running,
  promptStorageKey,
  onStartPositionChange,
  onCountChange,
  onPersistedChange,
  onReview,
  onStop,
}) => {
  const { token } = theme.useToken();
  return (
    <>
      {/* 审查范围 */}
      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          <AimOutlined style={{ marginRight: 6 }} />
          审查范围
        </Typography.Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            size="small"
            style={{ flex: 1, minWidth: 140 }}
            value={startPos}
            onChange={onStartPositionChange}
            options={chapterOptions}
            disabled={running}
          />
          <InputNumber
            size="small"
            min={2}
            max={CROSS_CHECK_DEFAULTS.maxCount}
            value={count}
            onChange={(v) => onCountChange(Math.min(CROSS_CHECK_DEFAULTS.maxCount, Math.max(2, v ?? 2)))}
            addonAfter="章"
            disabled={running}
          />
          <Button size="small" type="primary" icon={<AimOutlined />} onClick={onReview} loading={running}>
            开始审查
          </Button>
          {running && (
            <Button size="small" danger icon={<StopOutlined />} onClick={onStop}>
              停止
            </Button>
          )}
          <CustomPromptPopover
            storageKey={promptStorageKey}
            title="跨章审查 - 自定义提示词"
            disabled={running}
          />
        </div>
      </div>

      {/* 审查参数（细粒度，按项目持久化） */}
      <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 10 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text style={{ fontSize: 12 }}>章节距离</Typography.Text>
            <InputNumber
              size="small"
              min={CROSS_CHECK_DEFAULTS.distanceMin}
              max={CROSS_CHECK_DEFAULTS.distanceMax}
              value={persisted.distance}
              onChange={(v) => onPersistedChange((p) => ({ ...p, distance: v ?? p.distance }))}
              disabled={running}
              style={{ width: 60 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text style={{ fontSize: 12 }}>AI 严格度</Typography.Text>
            <Select
              size="small"
              value={persisted.aiStrictness}
              onChange={(v) => onPersistedChange((p) => ({ ...p, aiStrictness: v as CrossCheckStrictness }))}
              disabled={running}
              style={{ width: 80 }}
              options={[
                { value: 'strict', label: '严格' },
                { value: 'standard', label: '标准' },
                { value: 'lenient', label: '宽松' },
              ]}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text style={{ fontSize: 12 }}>AI 语义审查</Typography.Text>
            <Switch
              size="small"
              checked={persisted.enableAiReview}
              onChange={(v) => onPersistedChange((p) => ({ ...p, enableAiReview: v }))}
              disabled={running}
            />
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            文本相似度阈值 {persisted.similarityThreshold.toFixed(2)}
          </Typography.Text>
          <Slider
            style={{ flex: 1, margin: 0 }}
            min={CROSS_CHECK_DEFAULTS.similarityMin}
            max={CROSS_CHECK_DEFAULTS.similarityMax}
            step={0.05}
            value={persisted.similarityThreshold}
            onChange={(v) => onPersistedChange((p) => ({ ...p, similarityThreshold: v as number }))}
            disabled={running}
          />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
          距离/阈值作用于本地文本扫描；严格度作用于 AI 判据。参数按项目保存。
        </Typography.Text>
      </div>
    </>
  );
};

export default V2CrossCheckSettings;
