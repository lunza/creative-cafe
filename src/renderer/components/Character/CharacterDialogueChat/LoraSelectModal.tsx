/**
 * LoRA 模型选择弹窗（Spec: add-lora-model-selection / Task 4）
 *
 * 职责：
 * - 打开时调用 `window.electronAPI.lora.list(endpoint)` 获取可用 LoRA 列表
 * - 搜索框 + 分类筛选 前端过滤 LoRA 列表
 * - 网格布局展示 LoRA 卡片（预览图 + 模型名），点击切换选中
 * - 已选区域：Tag + 权重 Slider（Popover） + 移除按钮
 * - 确认按钮回调 `onConfirm(localSelected)`
 *
 * 性能优化：
 * - 预览图懒加载（`<img loading="lazy">`）
 * - loraList 缓存于 ref，endpoint 未变化时不重复请求
 * - useMemo 计算过滤后列表（搜索 + 分类）
 *
 * UI 风格：暗色主题 + inline styles + 项目 CSS 变量，参照 ExpressionGenerateModal / AssetManagerModal。
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, Input, Select, Tag, Tooltip, Spin, Slider, Button, Popover } from 'antd';
import { PictureOutlined, CloseOutlined, SearchOutlined } from '@ant-design/icons';

// ==================== 类型定义 ====================

/** LoRA 模型信息（与 electron.d.ts 中 lora.list 返回类型一致） */
interface LoraModel {
  name: string;
  alias: string;
  path: string;
  previewUrl: string;
  description: string;
  activationText: string;
  preferredWeight: number;
  sdVersion: string;
  notes: string;
  category: string;
}

interface LoraSelectModalProps {
  open: boolean;
  endpoint: string;
  selectedLoras: Array<{ name: string; weight: number }>;
  onConfirm: (loras: Array<{ name: string; weight: number }>) => void;
  onCancel: () => void;
}

// ==================== 常量 ====================

/** 默认权重（新增 LoRA 选中时使用） */
const DEFAULT_WEIGHT = 0.7;
/** 「全部」分类常量（selectedCategory === ALL_CATEGORY 时不做分类过滤） */
const ALL_CATEGORY = '全部';

// ==================== 组件实现 ====================

const LoraSelectModal: React.FC<LoraSelectModalProps> = ({
  open,
  endpoint,
  selectedLoras,
  onConfirm,
  onCancel,
}) => {
  // ====== State ======
  const [loraList, setLoraList] = useState<LoraModel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORY);
  const [localSelected, setLocalSelected] = useState<Array<{ name: string; weight: number }>>([]);
  /** 图片加载失败的 LoRA name 集合（用于显示灰色占位） */
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // ====== Cache ref（endpoint 未变化时不重复请求） ======
  const loraCacheRef = useRef<{ endpoint: string; loras: LoraModel[] } | null>(null);

  // ====== 获取 LoRA 列表 ======
  const fetchLoras = useCallback(async (ep: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.lora.list(ep);
      if (result?.success && Array.isArray(result.loras)) {
        setLoraList(result.loras);
        loraCacheRef.current = { endpoint: ep, loras: result.loras };
      } else {
        setLoraList([]);
        setError(result?.error || '获取 LoRA 列表失败');
      }
    } catch (e) {
      setLoraList([]);
      setError(e instanceof Error ? e.message : '获取 LoRA 列表时发生错误');
    } finally {
      setLoading(false);
    }
  }, []);

  // ====== 打开弹窗时：同步选中 + 拉取列表（带缓存） ======
  useEffect(() => {
    if (open) {
      // 同步外部选中到本地副本
      setLocalSelected(selectedLoras ? [...selectedLoras] : []);
      // 重置筛选与图片失败状态
      setSearchKeyword('');
      setSelectedCategory(ALL_CATEGORY);
      setFailedImages(new Set());

      if (endpoint) {
        const cache = loraCacheRef.current;
        if (cache && cache.endpoint === endpoint) {
          // 缓存命中，直接使用，不重复请求
          setLoraList(cache.loras);
          setError(null);
        } else {
          fetchLoras(endpoint);
        }
      } else {
        // endpoint 为空，无法获取列表
        setLoraList([]);
        setError('未配置 SD WebUI 端点，无法获取 LoRA 列表');
      }
    } else {
      setError(null);
    }
    // selectedLoras 仅在打开时同步，运行中由 localSelected 接管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpoint, fetchLoras]);

  // ====== 分类选项（去重） ======
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    loraList.forEach((l) => {
      if (l.category) set.add(l.category);
    });
    return [ALL_CATEGORY, ...Array.from(set)];
  }, [loraList]);

  // ====== 过滤后列表（搜索 + 分类） ======
  const filteredLoras = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    return loraList.filter((l) => {
      if (selectedCategory !== ALL_CATEGORY && l.category !== selectedCategory) return false;
      if (kw && !l.name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [loraList, searchKeyword, selectedCategory]);

  // ====== 切换选中 ======
  const handleToggleSelect = useCallback((name: string) => {
    setLocalSelected((prev) => {
      if (prev.some((l) => l.name === name)) {
        return prev.filter((l) => l.name !== name);
      }
      return [...prev, { name, weight: DEFAULT_WEIGHT }];
    });
  }, []);

  // ====== 修改权重 ======
  const handleWeightChange = useCallback((name: string, weight: number) => {
    setLocalSelected((prev) => prev.map((l) => (l.name === name ? { ...l, weight } : l)));
  }, []);

  // ====== 移除选中 ======
  const handleRemove = useCallback((name: string) => {
    setLocalSelected((prev) => prev.filter((l) => l.name !== name));
  }, []);

  // ====== 图片加载失败 ======
  const handleImageError = useCallback((name: string) => {
    setFailedImages((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  // ====== 确认 ======
  const handleConfirm = useCallback(() => {
    onConfirm(localSelected);
  }, [localSelected, onConfirm]);

  // ====== 构建 Tooltip 内容 ======
  const buildTooltipContent = (lora: LoraModel): string => {
    const parts: string[] = [];
    if (lora.description) parts.push(`描述: ${lora.description}`);
    if (lora.activationText) parts.push(`激活词: ${lora.activationText}`);
    if (lora.sdVersion) parts.push(`SD版本: ${lora.sdVersion}`);
    if (lora.notes) parts.push(`备注: ${lora.notes}`);
    if (parts.length === 0) return '无额外说明';
    return parts.join('\n');
  };

  // ====== 渲染卡片 ======
  const renderCard = (lora: LoraModel) => {
    const isSelected = localSelected.some((l) => l.name === lora.name);
    const imageFailed = failedImages.has(lora.name);

    return (
      <div
        key={lora.name}
        onClick={() => handleToggleSelect(lora.name)}
        style={{
          border: `2px solid ${isSelected ? 'var(--primary-color, #6366f1)' : 'transparent'}`,
          borderRadius: 6,
          overflow: 'hidden',
          cursor: 'pointer',
          background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
          transition: 'border-color 0.2s',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 预览图 / 占位（不包裹 Tooltip，避免元数据过长遮盖图片导致无法点击） */}
        <div
          style={{
            width: '100%',
            height: 120,
            background: '#0f0f1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {lora.previewUrl && !imageFailed ? (
            <img
              src={lora.previewUrl}
              alt={lora.name}
              loading="lazy"
              onError={() => handleImageError(lora.name)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <PictureOutlined style={{ fontSize: 28, color: 'var(--text-tertiary, #6b7280)' }} />
          )}
        </div>
        {/* 模型名（Tooltip 仅包裹名称，placement=bottom 避免遮盖上方图片；
            maxWidth/maxHeight 限制尺寸，长内容可滚动） */}
        <Tooltip
          title={<span style={{ whiteSpace: 'pre-line' }}>{buildTooltipContent(lora)}</span>}
          placement="bottom"
          overlayStyle={{ maxWidth: 320 }}
          overlayInnerStyle={{ maxHeight: 200, overflowY: 'auto' }}
        >
          <div
            style={{
              padding: '4px 6px',
              fontSize: 11,
              color: 'var(--text-primary, #e2e8f0)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'center',
            }}
            title={lora.name}
          >
            {lora.name}
          </div>
        </Tooltip>
      </div>
    );
  };

  // ====== 渲染已选 Tag（含权重 Slider Popover + 移除按钮） ======
  const renderSelectedTag = (item: { name: string; weight: number }) => (
    <div
      key={item.name}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
    >
      <Popover
        trigger="click"
        placement="bottom"
        content={
          <div style={{ width: 200 }}>
            <div
              style={{
                color: 'var(--text-primary, #e2e8f0)',
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              权重: {item.weight.toFixed(2)}
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={item.weight}
              onChange={(v) => handleWeightChange(item.name, v)}
            />
          </div>
        }
      >
        <Tag
          style={{
            cursor: 'pointer',
            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.8))',
            border: '1px solid var(--primary-color, #6366f1)',
            color: 'var(--text-primary, #e2e8f0)',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 12,
            userSelect: 'none',
            margin: 0,
          }}
        >
          {item.name} ({item.weight.toFixed(2)})
        </Tag>
      </Popover>
      <Button
        size="small"
        type="text"
        danger
        icon={<CloseOutlined />}
        onClick={() => handleRemove(item.name)}
        style={{ padding: '0 4px' }}
      />
    </div>
  );

  return (
    <Modal
      title="选择 LoRA 模型"
      open={open}
      onCancel={onCancel}
      width={800}
      style={{ top: 20 }}
      styles={{
        body: {
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
          paddingRight: 8,
        },
      }}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          onClick={handleConfirm}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            borderColor: 'transparent',
          }}
        >
          确认（{localSelected.length}）
        </Button>,
      ]}
    >
      {/* 错误提示 */}
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* 顶部：搜索 + 分类筛选 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--text-tertiary, #6b7280)' }} />}
          placeholder="搜索 LoRA 模型名称..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            color: 'var(--text-primary, #e2e8f0)',
          }}
        />
        <Select
          value={selectedCategory}
          onChange={setSelectedCategory}
          style={{ width: 160 }}
          options={categoryOptions.map((c) => ({ label: c, value: c }))}
        />
      </div>

      {/* 已选区域 */}
      {localSelected.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 12,
            padding: 8,
            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
            borderRadius: 6,
          }}
        >
          {localSelected.map(renderSelectedTag)}
        </div>
      )}

      {/* 主体内容 */}
      {loading ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 0',
          }}
        >
          <Spin size="large" />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            正在加载 LoRA 列表...
          </span>
        </div>
      ) : filteredLoras.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            color: 'var(--text-secondary, #94a3b8)',
            fontSize: 13,
          }}
        >
          {error ? '' : '未找到匹配的 LoRA 模型'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 10,
            maxHeight: 400,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {filteredLoras.map(renderCard)}
        </div>
      )}
    </Modal>
  );
};

export default LoraSelectModal;
