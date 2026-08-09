/**
 * 视角镜头选择组件（2026-08-06 新增，2026-08-06 重构为 4 独立下拉）
 *
 * 用于 SD 图片生成弹窗（AssetGenerateModal），提供 SDXL/Pony 系列模型支持的
 * 视角与镜头标签选择。选中后通过 {camera} 占位符注入到正面提示词模板
 * （由 sdGenerationService.applyTraitsAndLora 统一替换）。
 *
 * 【设计决策 - 4 独立下拉】
 * 视角描述由 4 个独立维度组合而成，每张图的完整视角 = 距离 + 角度 + 方向 +（可选）特殊构图。
 * - 不同类别之间可自由组合（如 full_body + from_above + front_view = 全身俯视正面）
 * - 同一类别内大多互斥（full_body vs close-up 冲突；from_above vs from_below 矛盾）
 * 故采用 4 个独立单选下拉，天然避免同类互斥，又支持跨类组合。
 * 选中的非空 tag 按顺序拼接为逗号分隔字符串，整体注入 {camera} 占位符。
 *
 * 【状态管理 - 完全受控】
 * 组件无内部 state，完全派生自 props.value（逗号分隔字符串）。
 * - parseValue(value) → 拆解为 4 个类别的选中 tag
 * - handleCategoryChange(category, newTag) → 替换该类别的旧 tag，重新拼接，调用 props.onChange
 * 这样弹窗关闭重置（value=''）能立即同步，无 useEffect 循环更新风险。
 *
 * 【2026-08-06 标签库审计修正】
 * 对比 Danbooru/e621 merged 标签库（2026-03-01 版，317,600 tags）验证所有预设 tag：
 * - 删除 9 个不在标签库中的电影术语 tag（extreme long shot / medium shot / eye-level shot 等）
 * - 替换 5 个名称不匹配的 tag（from front → front_view, high angle shot → high-angle_view 等）
 * - 全部改为下划线版本（Danbooru 标准格式，与训练数据一致）
 * - 补充 selfie（自拍视角，count=45005）
 * 修正后 24 个 tag 全部在标签库中确认有效。
 *
 * 标签来源：Danbooru/e621 训练标签（NoobAI / Pony / SDXL anime 系列模型的语义基础）
 *
 * 约束：
 * - 仅 illustration / general 模板含 {camera} 占位符（由 PromptBuilder.buildAssetPromptTemplate 控制）
 * - three-view 模板不含 {camera}（固定 front/side/back view，避免与视角冲突）
 * - 表情模板（buildExpressionGenerationPrompt）默认含 {camera}（默认值 portrait, looking_at_viewer）
 */
import React, { useMemo } from 'react';
import { Select, Tooltip, Tag } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';

// ==================== Props 接口 ====================

interface CameraAngleSelectorProps {
  /**
   * 当前选中的视角镜头 tag 拼接字符串（逗号分隔，如 "full_body, from_above, front_view"）。
   * 空字符串表示全部未选择，{camera} 占位符替换为空串。
   */
  value: string;
  /** 选择变更回调（传入拼接后的逗号分隔字符串，空字符串表示全部清除） */
  onChange: (combined: string) => void;
  /** 是否禁用（生成中应禁用，避免切换） */
  disabled?: boolean;
}

// ==================== 预置标签常量 ====================

interface CameraAnglePreset {
  /** 中文标签 */
  label: string;
  /** SD tag（英文，Danbooru 标准下划线格式） */
  tag: string;
  /** 适用说明（Tooltip 展示） */
  desc: string;
}

/** 类别 key 类型 */
type CategoryKey = 'shotScale' | 'verticalAngle' | 'direction' | 'special';

/**
 * 镜头距离 / 取景范围（Shot Scale）
 * 控制主体在画面中的大小与距离。同一类别内互斥（主体大小确定）。
 * 【标签库审计】删除了 extreme long shot / medium wide shot / medium shot / medium close-up
 * （电影术语，Danbooru 不使用）；剩余 8 个全部在标签库中确认有效。
 */
const SHOT_SCALE_PRESETS: CameraAnglePreset[] = [
  { label: '远景/全景', tag: 'wide_shot', desc: '全身入镜，留有环境空间（count≈21K）' },
  { label: '全景/全身', tag: 'full_body', desc: '主体充满画面，立绘常用（count≈1.1M）' },
  { label: '牛仔镜头', tag: 'cowboy_shot', desc: '大腿以上，西部片常用（count≈749K）' },
  { label: '上半身', tag: 'upper_body', desc: '上半身为主（count≈1.0M）' },
  { label: '特写', tag: 'close-up', desc: '头肩为主（count≈95K）' },
  { label: '头像', tag: 'portrait', desc: '面部为主，表情生成常用（count≈362K）' },
  { label: '极佳写', tag: 'extreme_close-up', desc: '局部细节如眼/唇（count≈111，低频）' },
  { label: '下半身', tag: 'lower_body', desc: '下半身为主（count≈7K）' },
];

/**
 * 摄像机垂直角度（Camera Angle - 高低）
 * 控制镜头相对主体的垂直高度。同一类别内互斥（镜头垂直位置固定）。
 * 【标签库审计】删除了 eye-level shot / ground level shot（不存在）和 top-down view（count=55 极低频）；
 * high angle shot → high-angle_view、low angle shot → low-angle_view（Danbooru 标准名称）。
 */
const VERTICAL_ANGLE_PRESETS: CameraAnglePreset[] = [
  { label: '高角度俯拍', tag: 'high-angle_view', desc: '略高于主体，主体显小（count≈31K）' },
  { label: '低角度仰拍', tag: 'low-angle_view', desc: '略低于主体，主体显威严（count≈67K）' },
  { label: '俯视', tag: 'from_above', desc: '从上往下看，自然形成上目视感（count≈128K）' },
  { label: '仰视', tag: 'from_below', desc: '从下往上看，压迫感/帅气（count≈105K）' },
  { label: '鸟瞰', tag: "bird's-eye_view", desc: '极高处俯瞰，强空间感（count≈7K）' },
  { label: '虫瞰', tag: "worm's-eye_view", desc: '地面视角仰望（count≈14K）' },
];

/**
 * 水平方向视角（Direction）
 * 控制主体相对镜头的朝向。同一类别内互斥（主体朝向固定）。
 * 【标签库审计】from front → front_view（Danbooru 标准名称）；3/4 view → three-quarter_view。
 */
const DIRECTION_PRESETS: CameraAnglePreset[] = [
  { label: '正面', tag: 'front_view', desc: '主体正对镜头（count≈193K）' },
  { label: '侧面', tag: 'from_side', desc: '侧身朝向镜头（count≈292K）' },
  { label: '侧脸', tag: 'profile', desc: '强调侧脸轮廓（count≈165K）' },
  { label: '3/4 视角', tag: 'three-quarter_view', desc: '斜 45°，最具立体感（count≈55K）' },
  { label: '背面', tag: 'from_behind', desc: '后背朝向镜头（count≈295K）' },
];

/**
 * 特殊构图 / 镜头风格（Special）
 * 营造特殊视觉效果。部分标签为独立维度（dutch_angle / fisheye / looking_at_viewer），
 * 理论上可与其它类别叠加；但为简化交互，本类别仍单选。
 * 用户若需多特殊构图叠加，可在正面提示词文本框手动补充。
 * 【标签库审计】删除了 dynamic angle / over-the-shoulder shot（不存在）；补充 selfie（count≈45K）。
 */
const SPECIAL_PRESETS: CameraAnglePreset[] = [
  { label: '荷兰角/倾斜', tag: 'dutch_angle', desc: '画面倾斜，营造不安/动感（count≈156K）' },
  { label: '第一人称视角', tag: 'pov', desc: '观者视角代入（count≈172K）' },
  { label: '鱼眼镜头', tag: 'fisheye', desc: '广角畸变效果（count≈6K）' },
  { label: '看向镜头', tag: 'looking_at_viewer', desc: '视线对接，极高频（count≈5.4M）' },
  { label: '自拍视角', tag: 'selfie', desc: '手持相机感，休闲/社交场景（count≈45K）' },
];

/** 类别配置表（用于渲染 + parseValue 反查） */
const CATEGORY_CONFIG: Array<{
  key: CategoryKey;
  title: string;
  presets: CameraAnglePreset[];
}> = [
  { key: 'shotScale', title: '镜头距离', presets: SHOT_SCALE_PRESETS },
  { key: 'verticalAngle', title: '垂直角度', presets: VERTICAL_ANGLE_PRESETS },
  { key: 'direction', title: '水平视角', presets: DIRECTION_PRESETS },
  { key: 'special', title: '特殊构图', presets: SPECIAL_PRESETS },
];

/** 类别 key 顺序（拼接时按此顺序，保证 prompt 稳定） */
const CATEGORY_ORDER: CategoryKey[] = ['shotScale', 'verticalAngle', 'direction', 'special'];

// ==================== 工具函数 ====================

/**
 * 解析拼接字符串为 4 个类别的选中 tag。
 * 反向查找：遍历逗号分隔的 tag，按预设标签表匹配到对应类别。
 * 未匹配到的 tag 丢弃（防止用户手动注入未知 tag 干扰下拉状态）。
 */
function parseValue(value: string): Record<CategoryKey, string> {
  const result: Record<CategoryKey, string> = {
    shotScale: '',
    verticalAngle: '',
    direction: '',
    special: '',
  };
  if (!value || !value.trim()) return result;
  const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
  for (const tag of tags) {
    for (const { key, presets } of CATEGORY_CONFIG) {
      if (presets.some((p) => p.tag === tag)) {
        // 同一类别后出现的覆盖先出现的（互斥语义）；正常情况下不会出现同类多 tag
        result[key] = tag;
        break;
      }
    }
  }
  return result;
}

// ==================== 组件实现 ====================

const CameraAngleSelector: React.FC<CameraAngleSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  // 从 props.value 派生 4 个类别的选中状态（完全受控，无内部 state）
  const parsed = useMemo(() => parseValue(value), [value]);

  // 某个类别选择变更：替换该类别 tag，重新拼接，调用 onChange
  const handleCategoryChange = (category: CategoryKey, newTag: string) => {
    const next: Record<CategoryKey, string> = { ...parsed, [category]: newTag };
    const combined = CATEGORY_ORDER.map((k) => next[k]).filter(Boolean).join(', ');
    onChange(combined);
  };

  // 当前拼接结果（用于底部摘要展示）
  const selectedTags = CATEGORY_ORDER.map((k) => parsed[k]).filter(Boolean);

  // 渲染单个类别的 Select
  const renderCategorySelect = (cfg: { key: CategoryKey; title: string; presets: CameraAnglePreset[] }) => {
    const current = parsed[cfg.key];
    return (
      <div key={cfg.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          style={{
            color: 'var(--text-secondary, #94a3b8)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {cfg.title}
        </span>
        <Select
          size="small"
          disabled={disabled}
          // current 为空时传 undefined 显示 placeholder
          value={current || undefined}
          onChange={(val: string | undefined) => handleCategoryChange(cfg.key, val ?? '')}
          allowClear={!!current}
          onClear={() => handleCategoryChange(cfg.key, '')}
          placeholder="不指定"
          style={{ width: '100%' }}
          popupMatchSelectWidth={280}
        >
          {cfg.presets.map((preset) => (
            <Select.Option key={preset.tag} value={preset.tag} title={preset.desc}>
              <span>
                <strong>{preset.label}</strong>{' '}
                <span style={{ color: '#94a3b8' }}>{preset.tag}</span>
              </span>
            </Select.Option>
          ))}
        </Select>
      </div>
    );
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
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <VideoCameraOutlined style={{ color: 'var(--primary-color, #6366f1)', fontSize: 16 }} />
        <span style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 13, fontWeight: 600 }}>
          视角镜头
        </span>
        <span style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 11 }}>
          （4 类各选 1 个，自由组合）
        </span>
      </div>

      {/* 4 个独立下拉，2x2 网格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px 12px',
        }}
      >
        {CATEGORY_CONFIG.map(renderCategorySelect)}
      </div>

      {/* 当前拼接结果摘要 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          flexWrap: 'wrap',
          minHeight: 22,
        }}
      >
        <span style={{ color: 'var(--text-tertiary, #6b7280)', fontSize: 11 }}>当前:</span>
        {selectedTags.length > 0 ? (
          <Tooltip title="以上 tag 拼接后替换正面提示词模板中的 {camera} 占位符">
            <Tag color="geekblue" style={{ margin: 0, fontSize: 12 }}>
              {selectedTags.join(', ')}
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="未选择时 {camera} 占位符替换为空字符串（由 applyTraitsAndLora 清理多余逗号）">
            <Tag style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary, #6b7280)' }}>
              未指定
            </Tag>
          </Tooltip>
        )}
      </div>

      <div
        style={{
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: 11,
          marginTop: 6,
        }}
      >
        不同类别可自由组合（如 full_body + from_above + front_view）；同类互斥。
        仅立绘 / 一般图像 / 表情模板含 {'{camera}'} 占位符；三视图不含，选择后无副作用。
      </div>
    </div>
  );
};

export default CameraAngleSelector;
