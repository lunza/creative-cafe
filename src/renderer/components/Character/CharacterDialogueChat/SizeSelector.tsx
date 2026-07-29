/**
 * 图片尺寸选择组件（2026-07-29 新增）
 *
 * 用于所有 SD 图片生成弹窗（AssetGenerateModal / ExpressionGenerateModal），
 * 提供预设尺寸下拉 + 自定义宽高输入，每次生成独立应用（不写入全局设置）。
 *
 * 功能：
 * - 预设尺寸：7 个常用分辨率，标注适用场景
 * - 自定义尺寸：手动输入宽高（64-2048），实时校验
 * - 选择变更即时生效（onChange 直接触发，无需确认）
 *
 * 约束：
 * - 尺寸上限 2048×2048，超出范围显示错误提示
 * - 默认值由父组件传入（来自设置 sdConfig.txt2imgWidth/Height，默认 1024×1024）
 * - 组件本身不持久化状态，每次打开弹窗由父组件重置为默认值
 */
import React, { useMemo } from 'react';
import { Select, InputNumber, Tooltip, Tag } from 'antd';
import { ColumnHeightOutlined } from '@ant-design/icons';

// ==================== Props 接口 ====================

interface SizeSelectorProps {
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
}

// ==================== 预设尺寸常量 ====================

interface SizePreset {
  label: string;
  width: number;
  height: number;
  scene: string;
}

/** 预设尺寸列表，每项含尺寸 + 适用场景说明 */
const SIZE_PRESETS: SizePreset[] = [
  { label: '头像/表情', width: 512, height: 512, scene: '适合头像和表情图片' },
  { label: '全身立绘', width: 512, height: 768, scene: '适合全身立绘场景' },
  { label: '竖版高清', width: 768, height: 1024, scene: '适合高清立绘/半身像' },
  { label: '方图高清', width: 1024, height: 1024, scene: '适合高质量方图（默认）' },
  { label: '竖版超清', width: 1024, height: 1536, scene: '适合超清全身立绘' },
  { label: '横版高清', width: 1536, height: 1024, scene: '适合横构图/宽幅场景' },
];

/** 自定义选项的 value 标识 */
const CUSTOM_VALUE = '__custom__';

/** 尺寸范围约束 */
const MIN_SIZE = 64;
const MAX_SIZE = 2048;

// ==================== 组件实现 ====================

const SizeSelector: React.FC<SizeSelectorProps> = ({ width, height, onChange }) => {
  // 判断当前是否匹配某个预设
  const matchedPreset = useMemo(() => {
    return SIZE_PRESETS.find((p) => p.width === width && p.height === height);
  }, [width, height]);

  // Select 当前值：匹配预设则用预设 value，否则为自定义
  const selectValue = matchedPreset
    ? `${matchedPreset.width}x${matchedPreset.height}`
    : CUSTOM_VALUE;

  // 自定义输入是否超出范围
  const widthError = width < MIN_SIZE || width > MAX_SIZE;
  const heightError = height < MIN_SIZE || height > MAX_SIZE;

  // 自定义尺寸变更
  const handleCustomChange = (dimension: 'width' | 'height', value: number | null) => {
    const val = value ?? MIN_SIZE;
    if (dimension === 'width') {
      onChange(val, height);
    } else {
      onChange(width, val);
    }
  };

  // 预设选择
  const handlePresetChange = (value: string) => {
    if (value === CUSTOM_VALUE) {
      // 切换到自定义模式，保留当前宽高
      return;
    }
    const preset = SIZE_PRESETS.find((p) => `${p.width}x${p.height}` === value);
    if (preset) {
      onChange(preset.width, preset.height);
    }
  };

  return (
    <div
      style={{
        background: '#0f0f1a',
        borderRadius: 8,
        padding: '12px 16px',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: selectValue === CUSTOM_VALUE ? 12 : 0,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ColumnHeightOutlined style={{ color: 'var(--primary-color, #6366f1)', fontSize: 16 }} />
          <span
            style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 13, fontWeight: 600 }}
          >
            输出尺寸
          </span>
        </div>

        <Select
          value={selectValue}
          onChange={handlePresetChange}
          size="small"
          style={{ width: 220 }}
          popupMatchSelectWidth={280}
          options={[
            ...SIZE_PRESETS.map((p) => ({
              value: `${p.width}x${p.height}`,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <strong>{p.label}</strong>{' '}
                    <span style={{ color: '#94a3b8' }}>
                      {p.width}×{p.height}
                    </span>
                  </span>
                </div>
              ),
              title: p.scene,
            })),
            {
              value: CUSTOM_VALUE,
              label: (
                <span>
                  <strong>自定义</strong>{' '}
                  <span style={{ color: '#94a3b8' }}>手动输入宽高</span>
                </span>
              ),
            },
          ]}
        />

        {/* 匹配预设时显示场景说明 */}
        {matchedPreset && (
          <Tooltip title={matchedPreset.scene}>
            <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>
              {matchedPreset.scene}
            </span>
          </Tooltip>
        )}

        {/* 当前尺寸摘要（始终显示） */}
        <Tag
          color={widthError || heightError ? 'red' : 'blue'}
          style={{ margin: 0, fontSize: 12 }}
        >
          {width}×{height}
        </Tag>
      </div>

      {/* 自定义输入区域 */}
      {selectValue === CUSTOM_VALUE && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>宽度：</span>
          <InputNumber
            size="small"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={64}
            value={width}
            onChange={(v) => handleCustomChange('width', v)}
            status={widthError ? 'error' : undefined}
            style={{ width: 100 }}
          />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>高度：</span>
          <InputNumber
            size="small"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={64}
            value={height}
            onChange={(v) => handleCustomChange('height', v)}
            status={heightError ? 'error' : undefined}
            style={{ width: 100 }}
          />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11 }}>
            范围 {MIN_SIZE}-{MAX_SIZE}，步进 64
          </span>
          {(widthError || heightError) && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>
              尺寸超出范围（{MIN_SIZE}-{MAX_SIZE}），请调整后再生成
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default SizeSelector;
