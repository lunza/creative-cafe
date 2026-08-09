/**
 * RagQualityReport — RAG 标签库质检报告面板
 *
 * AI 生成特征后展示，直观对比「RAG 检索到的参考标签」与「AI 生成的标签是否在标签库中」。
 *
 * 面板结构：
 *  1. 折叠头部：RAG 状态 + 质检统计摘要（X/Y 标签在库中）
 *  2. 展开后：
 *     - RAG 检索参考区：按相似度降序展示 top-K 标签（含 score/count）
 *     - 生成标签质检区：每条 tag 附 ✅（在库中）/ ❌（不在库中）徽标
 *
 * 数据来源：characterTraitAIService.generateCharacterTraits 返回的 ragDebug 字段
 */

import React, { useState } from 'react';
import { Tag, Tooltip, Progress, Input } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DownOutlined,
  UpOutlined,
  DatabaseOutlined,
  WarningFilled,
  UndoOutlined,
  SwapOutlined,
  MinusCircleFilled,
  EditOutlined,
  RobotOutlined,
} from '@ant-design/icons';

interface RagDebugData {
  enabled: boolean;
  status: string;
  retrievedTags: Array<{ name: string; category: number; count: number; score: number }>;
  tagValidation: Array<{
    tag: string;
    isValid: boolean;
    canonicalName?: string;
    category?: number;
    count?: number;
    skipReason?: 'rating' | 'no_suggestion';
    suggestions: Array<{ name: string; category: number; count: number; score: number }>;
    replacedBy?: string;
    /**
     * L3 颜色拆分信息（仅当 colorPartTag 与 feature 都命中标签库时设置）。
     * 前端据此显示「🔄 已拆分」徽标 + 拆分撤销按钮（撤销时传 colorPartTag 给父组件）。
     */
    splitTags?: { colorPartTag: string; featureTag: string };
    /**
     * 命中轮次标识（Spec: add-multi-round-tag-audit / add-ai-fallback-tag-audit）。
     * - 'user-map'       L0 自定义映射命中
     * - 'name'           L1 name 精确匹配
     * - 'alias'          L2 alias 精确匹配
     * - 'color-split'    L3 颜色拆分命中
     * - 'negation-strip' L3b 否定性修饰词剥离命中
     * - 'knn'            L4 语义 KNN suggestion 命中
     * - 'ai-fallback'    L5 AI 兜底命中（characterTraitAIService.applyAiFallback 写入）
     * tooltip 中展示命中轮次，辅助用户判断匹配来源。
     */
    source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn' | 'ai-fallback';
    /**
     * 末轮人工审核替换标记（Spec: add-multi-round-tag-audit / Task 3.1）。
     * true 表示该 tag 已被用户手动指定替换词；前端显示紫色 🟣 徽标 + 撤销按钮。
     */
    manuallyReplaced?: boolean;
    /**
     * 人工指定的替换词（Spec: add-multi-round-tag-audit / Task 3.1）。
     * 撤销时还原 trait.text 为 originalTag（即 item.tag）。
     */
    manualReplacement?: string;
    /**
     * AI 兜底尝试标记（Spec: add-ai-fallback-tag-audit）。
     * - true：已对当前 tag 调过 LLM 生成候选词（无论命中与否）
     * - undefined：未触发 AI 兜底（L0-L4 已命中/评级词/超出批量上限/主调用失败）
     * 前端据此区分「未尝试」与「尝试失败」两种 invalid 状态。
     */
    aiFallbackAttempted?: boolean;
    /**
     * AI 兜底返回的候选词数组（Spec: add-ai-fallback-tag-audit）。
     * - 命中时：含命中的候选词
     * - 未命中时：含全部候选词，前端展示供用户参考
     */
    aiFallbackCandidates?: string[];
  }>;
}

interface RagQualityReportProps {
  ragDebug: RagDebugData;
  visible: boolean;
  onToggle: () => void;
  /**
   * 撤销标签自动替换：把 replacedBy 还原为原始 tag（originalTag）。
   * - 规范化撤销 / 语义替换撤销：仅传 originalTag + replacedBy
   * - 颜色拆分撤销：额外传 splitColorTag（= colorPartTag），父组件据此删除新增的颜色 trait
   */
  onRevertTrait?: (originalTag: string, replacedBy: string, splitColorTag?: string) => void;
  /**
   * 末轮人工审核：手动替换未匹配标签（Spec: add-multi-round-tag-audit / Task 3.4）。
   * 父组件 AssetManagerModal 据此：
   *  1. 找到 text === originalTag 的 trait 调 updateTrait(trait.id, replacement)
   *  2. 调 IPC tagRag.addUserSynonymMapping(originalTag, replacement) 持久化到映射表
   *  3. 更新 ragDebug 对应项 manuallyReplaced=true, manualReplacement=replacement
   * 下次 AI 生成同词时 L0 首轮命中。
   */
  onManualReplace?: (originalTag: string, replacement: string) => void;
  /**
   * 撤销手动替换（Spec: add-multi-round-tag-audit / Task 3.4）。
   * 父组件 AssetManagerModal 据此：
   *  1. 找到 text === replacement 的 trait 调 updateTrait(trait.id, originalTag) 还原
   *  2. 调 IPC tagRag.removeUserSynonymMapping(originalTag) 删除映射记录
   *  3. 清除 ragDebug 对应项 manuallyReplaced/manualReplacement
   */
  onRevertManualReplace?: (originalTag: string, replacement: string) => void;
  /**
   * 撤销 AI 兜底替换（Spec: add-ai-fallback-tag-audit）。
   * 父组件 AssetManagerModal 据此：
   *  1. 找到 text === replacement 的 trait 调 updateTrait(trait.id, originalTag) 还原
   *  2. 调 IPC tagRag.removeUserSynonymMapping(originalTag) 删除 AI 兜底持久化的映射
   *     —— AI 兜底命中时已 addMapping 持久化，撤销 = 用户认为映射不正确，避免下次 L0 命中
   *  3. 清除 ragDebug 对应项 replacedBy/source='ai-fallback'/aiFallbackCandidates
   *     （保留 aiFallbackAttempted=true，UI 显示「已撤销，请手动编辑」）
   */
  onRevertAiFallback?: (originalTag: string, replacement: string) => void;
}

/** Danbooru category id → 中文名映射（用于展示参考标签的分类） */
const CATEGORY_NAMES: Record<number, string> = {
  0: '通用',
  1: '画师',
  3: '版权',
  4: '角色',
  5: '元',
  6: '稀缺',
  7: '偏激',
  8: 'AI生成',
  9: 'e621',
};

/** 颜色方案：深色主题友好 */
const COLORS = {
  valid: '#22c55e',
  invalid: '#ef4444',
  ragRef: '#3b82f6',
  warning: '#f59e0b',
  replaced: '#3b82f6',
  manual: '#a855f7', // 紫色：人工审核手动替换（Spec: add-multi-round-tag-audit / Task 3.3）
  aiFallback: '#f97316', // 橙色：AI 兜底命中/失败（Spec: add-ai-fallback-tag-audit）
  border: 'rgba(255,255,255,0.1)',
  bg: 'rgba(59, 130, 246, 0.05)',
  textSecondary: 'rgba(255,255,255,0.65)',
};

/**
 * source 字段 → 中文命中轮次文案（Spec: add-multi-round-tag-audit / Task 3.5 + add-ai-fallback-tag-audit）。
 * 用于 tooltip 展示，辅助用户判断匹配来源。
 */
const SOURCE_LABELS: Record<string, string> = {
  'user-map': 'L0 自定义映射',
  'name': 'L1 name 精确',
  'alias': 'L2 alias 精确',
  'color-split': 'L3 颜色拆分',
  'negation-strip': 'L3b 否定性修饰词剥离',
  'knn': 'L4 语义 KNN',
  'ai-fallback': 'L5 AI 兜底',
};

export const RagQualityReport: React.FC<RagQualityReportProps> = ({
  ragDebug,
  visible,
  onToggle,
  onRevertTrait,
  onManualReplace,
  onRevertManualReplace,
  onRevertAiFallback,
}) => {
  const { enabled, status, retrievedTags, tagValidation } = ragDebug;

  const validCount = tagValidation.filter((v) => v.isValid).length;
  const totalCount = tagValidation.length;
  const validPercent = totalCount > 0 ? Math.round((validCount / totalCount) * 100) : 0;

  // 末轮人工审核：手动替换 inline 输入框状态（Spec: add-multi-round-tag-audit / Task 3.2）
  // - manualReplaceIdx：当前展开输入框的 item 下标；null 表示无展开
  // - manualReplaceValue：输入框当前值（回车确认时调 onManualReplace）
  const [manualReplaceIdx, setManualReplaceIdx] = useState<number | null>(null);
  const [manualReplaceValue, setManualReplaceValue] = useState<string>('');

  // 头部状态标签
  const statusConfig = (() => {
    if (!enabled) return { color: COLORS.textSecondary, text: 'RAG 未启用', icon: null };
    if (status === 'ready') return { color: COLORS.valid, text: 'RAG 已生效', icon: <DatabaseOutlined /> };
    if (status === 'disabled') return { color: COLORS.textSecondary, text: 'RAG 未启用', icon: null };
    return { color: COLORS.warning, text: `RAG 状态：${status}`, icon: <WarningFilled /> };
  })();

  return (
    <div
      style={{
        marginBottom: 12,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: COLORS.bg,
      }}
    >
      {/* 折叠头部 */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            🔍 RAG 标签质检报告
          </span>
          <Tag color={statusConfig.color} style={{ margin: 0, fontSize: 11 }}>
            {statusConfig.icon} {statusConfig.text}
          </Tag>
          {enabled && status === 'ready' && totalCount > 0 && (
            <span style={{ fontSize: 12, color: validPercent >= 80 ? COLORS.valid : COLORS.warning }}>
              {validCount}/{totalCount} 标签在库中（{validPercent}%）
            </span>
          )}
        </div>
        {visible ? <UpOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
      </div>

      {/* 展开内容 */}
      {visible && (
        <div style={{ padding: '0 14px 14px 14px' }}>
          {/* RAG 未启用时的提示 */}
          {!enabled && (
            <div
              style={{
                padding: '12px',
                background: 'rgba(245, 158, 11, 0.08)',
                border: `1px solid rgba(245, 158, 11, 0.2)`,
                borderRadius: 6,
                fontSize: 12,
                color: COLORS.warning,
                lineHeight: 1.6,
              }}
            >
              ⚠️ RAG 标签库参考未启用。AI 生成的标签未经过标签库引导，可能包含无效标签。
              <br />
              请前往「设置 → 标签库 RAG」开启 RAG 并完成向量化后重试。
            </div>
          )}

          {/* RAG 启用但索引未就绪 */}
          {enabled && status !== 'ready' && (
            <div
              style={{
                padding: '12px',
                background: 'rgba(245, 158, 11, 0.08)',
                border: `1px solid rgba(245, 158, 11, 0.2)`,
                borderRadius: 6,
                fontSize: 12,
                color: COLORS.warning,
              }}
            >
              ⚠️ RAG 索引状态为「{status}」，请先在设置面板完成向量化。
            </div>
          )}

          {/* 质检统计进度条 */}
          {totalCount > 0 && (
            <div style={{ marginBottom: 16, marginTop: 12 }}>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>
                标签库命中率
              </div>
              <Progress
                percent={validPercent}
                size="small"
                strokeColor={validPercent >= 80 ? COLORS.valid : validPercent >= 50 ? COLORS.warning : COLORS.invalid}
                format={() => `${validCount}/${totalCount}（${validPercent}%）`}
              />
            </div>
          )}

          {/* 生成标签质检区 */}
          {tagValidation.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>📋 AI 生成标签验证</span>
                {tagValidation.some((v) => v.replacedBy) && (
                  <span style={{ fontSize: 11, color: COLORS.replaced, fontWeight: 400 }}>
                    蓝色🔄=已拆分/规范化/替换；橙色🤖=AI 兜底命中，点 ↩ 撤销
                  </span>
                )}
                {tagValidation.some((v) => v.aiFallbackAttempted && !v.replacedBy && !v.isValid) && (
                  <span style={{ fontSize: 11, color: COLORS.aiFallback, fontWeight: 400 }}>
                    橙色淡🤖=AI 兜底尝试未命中（候选词见 tooltip，可 ✏ 手动指定）
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tagValidation.map((item, idx) => {
                  const suggestions = item.suggestions || [];
                  // AI 兜底命中：source='ai-fallback' 且 replacedBy 存在（橙色 🤖 + 撤销按钮）
                  // Spec: add-ai-fallback-tag-audit
                  const isAiFallbackHit = item.source === 'ai-fallback' && !!item.replacedBy;
                  // AI 兜底未命中：aiFallbackAttempted=true 且未替换且 isValid=false
                  // （橙色淡 🤖 + 候选词 tooltip，✏ 手动入口仍可用）
                  const isAiFallbackMiss =
                    !!item.aiFallbackAttempted && !item.replacedBy && !item.isValid;
                  // ⚠️ isReplaced 不再依赖 !isValid：valid+replacedBy（规范化/拆分）也走替换分支，
                  //    这样 slender→slim 等同义词/颜色变体规范化后也能展示蓝色徽标 + 撤销按钮
                  // ⚠️ isReplaced 排除 source='ai-fallback'：AI 兜底命中走独立橙色 🤖 分支
                  //    （Spec: add-ai-fallback-tag-audit），避免与蓝色 🔄 自动替换混淆
                  const isReplaced = !!item.replacedBy && !isAiFallbackHit;
                  // splitTags 仅在 L3 颜色拆分两条都命中时设置（场景1：tag → colorPartTag + featureTag）
                  const isSplit = isReplaced && !!item.splitTags;
                  const isRating = !item.isValid && item.skipReason === 'rating';
                  const isNoSuggestion = !item.isValid && item.skipReason === 'no_suggestion';
                  const hasSuggestionOnly =
                    !item.isValid && !item.replacedBy && !item.skipReason && suggestions.length > 0;
                  // 末轮人工审核替换标记（Spec: add-multi-round-tag-audit / Task 3.3）
                  // manuallyReplaced 优先级高于 isReplaced：手动替换是一种独立的替换路径，
                  // 与 L1-L4 自动替换（replacedBy）区分，展示紫色 🟣 而非蓝色 🔄
                  const isManuallyReplaced = !!item.manuallyReplaced && !!item.manualReplacement;
                  // 是否可手动替换：isValid=false（L0-L4 全失败）且非评级词、非已手动替换
                  // 评级词对 SD 有效无需纠错，已手动替换的项展示撤销按钮（不重复入口）
                  // AI 兜底未命中（isAiFallbackMiss）仍保留 ✏ 入口：用户可参考候选词手动指定
                  const canManualReplace =
                    !item.isValid &&
                    !isRating &&
                    !isManuallyReplaced &&
                    !isAiFallbackHit &&
                    !!onManualReplace;

                  let color = COLORS.invalid;
                  let bg = 'rgba(239, 68, 68, 0.08)';
                  let icon: React.ReactNode = <CloseCircleFilled style={{ marginRight: 4 }} />;
                  let tooltip = '❌ 不在标签库中（AI 可能凭空创造了此标签）';
                  // 拆分项的展示文案：tag → colorPartTag + featureTag（取代普通的 → replacedBy）
                  let replacedDisplay: React.ReactNode = item.replacedBy ? (
                    <span style={{ opacity: 0.85, marginLeft: 4 }}>→ {item.replacedBy}</span>
                  ) : null;
                  if (isSplit && item.splitTags) {
                    replacedDisplay = (
                      <span style={{ opacity: 0.85, marginLeft: 4 }}>
                        → {item.splitTags.colorPartTag} + {item.splitTags.featureTag}
                      </span>
                    );
                  }
                  // 手动替换项的展示文案：tag → manualReplacement（紫色，与自动替换区分）
                  if (isManuallyReplaced) {
                    replacedDisplay = (
                      <span style={{ opacity: 0.85, marginLeft: 4 }}>→ {item.manualReplacement}</span>
                    );
                  }

                  // 优先级：手动替换（紫） > AI兜底命中（橙🤖） > 自动替换（蓝🔄） > valid（绿）
                  //        > rating > noSuggestion > hasSuggestionOnly > AI兜底未命中（橙淡🤖） > invalid
                  if (isManuallyReplaced) {
                    // 紫色 🟣：人工审核手动替换（Spec: add-multi-round-tag-audit / Task 3.3）
                    color = COLORS.manual;
                    bg = 'rgba(168, 85, 247, 0.12)';
                    icon = <SwapOutlined style={{ marginRight: 4 }} />;
                    tooltip = `🟣 已手动替换：${item.tag} → ${item.manualReplacement}`;
                  } else if (isAiFallbackHit) {
                    // 橙色 🤖：AI 兜底命中（Spec: add-ai-fallback-tag-audit）
                    // LLM 生成的候选词经 L0-L4 验证后命中标签库，trait.text 已替换为 replacedBy
                    // 持久化到 userSynonymMap，下次同词 L0 命中；点 ↩ 撤销替换 + 删除映射
                    color = COLORS.aiFallback;
                    bg = 'rgba(249, 115, 22, 0.12)';
                    icon = <RobotOutlined style={{ marginRight: 4 }} />;
                    const candidates = item.aiFallbackCandidates || [];
                    tooltip =
                      `🤖 AI 兜底命中：${item.tag} → ${item.replacedBy}` +
                      (candidates.length > 0 ? `（候选词：${candidates.join(', ')}）` : '');
                  } else if (isReplaced) {
                    // isReplaced：valid+replaced（拆分/规范化）和 invalid+replaced（语义替换）统一展示蓝色 🔄
                    color = COLORS.replaced;
                    bg = 'rgba(59, 130, 246, 0.10)';
                    icon = <SwapOutlined style={{ marginRight: 4 }} />;
                    if (isSplit && item.splitTags) {
                      tooltip = `🔄 已拆分：${item.tag} → ${item.splitTags.colorPartTag} + ${item.splitTags.featureTag}`;
                    } else if (item.isValid) {
                      tooltip = `🔄 已规范化为标准名：${item.tag} → ${item.replacedBy}（出现次数：${item.count ?? '?'}）`;
                    } else {
                      tooltip = `🔄 已自动替换：${item.tag} → ${item.replacedBy}` +
                        (suggestions[0] ? `（相似度 ${(suggestions[0].score * 100).toFixed(0)}%）` : '');
                    }
                  } else if (item.isValid) {
                    color = COLORS.valid;
                    bg = 'rgba(34, 197, 94, 0.08)';
                    icon = <CheckCircleFilled style={{ marginRight: 4 }} />;
                    tooltip = `✅ 在标签库中（标准名：${item.canonicalName}，出现次数：${item.count ?? '?'}）`;
                  } else if (isRating) {
                    color = COLORS.textSecondary;
                    bg = 'rgba(255,255,255,0.04)';
                    icon = <MinusCircleFilled style={{ marginRight: 4 }} />;
                    tooltip = '⊘ 评级词（非视觉标签，对 SD 有效，无需纠错）';
                  } else if (isNoSuggestion) {
                    color = COLORS.invalid;
                    bg = 'rgba(239, 68, 68, 0.08)';
                    icon = <CloseCircleFilled style={{ marginRight: 4 }} />;
                    tooltip = '❌ 不在标签库中，且未找到相似标签（建议手动修改）';
                  } else if (hasSuggestionOnly) {
                    color = COLORS.warning;
                    bg = 'rgba(245, 158, 11, 0.08)';
                    icon = <WarningFilled style={{ marginRight: 4 }} />;
                    tooltip =
                      '⚠ 相似度不足未自动替换，建议：' +
                      suggestions.map((s) => `${s.name}(${(s.score * 100).toFixed(0)}%)`).join(', ');
                  } else if (isAiFallbackMiss) {
                    // 橙色淡 🤖：AI 兜底已尝试但未命中（Spec: add-ai-fallback-tag-audit）
                    // LLM 返回的候选词经 L0-L4 全部失败，但候选词对用户手动替换有参考价值
                    // 保留 ✏ 入口：用户可参考候选词手动输入替换词
                    color = COLORS.aiFallback;
                    bg = 'rgba(249, 115, 22, 0.08)';
                    icon = <RobotOutlined style={{ marginRight: 4 }} />;
                    const candidates = item.aiFallbackCandidates || [];
                    tooltip =
                      candidates.length > 0
                        ? `🤖 AI 兜底尝试未命中。候选词：${candidates.join(', ')}（可点 ✏ 手动输入其中一个作为替换词）`
                        : '🤖 AI 兜底尝试未命中（LLM 未返回候选词，请手动输入替换词）';
                  }

                  // 追加命中轮次到 tooltip（Spec: add-multi-round-tag-audit / Task 3.5）
                  // source 字段标识 L0-L4 命中轮次，辅助用户判断匹配来源
                  if (item.source && SOURCE_LABELS[item.source]) {
                    tooltip += `（命中轮次：${SOURCE_LABELS[item.source]}）`;
                  }

                  return (
                    <React.Fragment key={idx}>
                      <Tooltip title={tooltip}>
                        <Tag
                          style={{
                            margin: 0,
                            fontSize: 12,
                            padding: '2px 8px',
                            borderColor: color,
                            color,
                            background: bg,
                          }}
                        >
                          {icon}
                          {item.tag}
                          {replacedDisplay}
                          {/* 自动替换撤销（蓝色 🔄）：调 onRevertTrait */}
                          {isReplaced && !isManuallyReplaced && onRevertTrait && (
                            <UndoOutlined
                              style={{ marginLeft: 6, cursor: 'pointer', fontSize: 11 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                // 拆分撤销传第三个参数 splitColorTag，父组件据此删除新增的颜色 trait
                                onRevertTrait(item.tag, item.replacedBy!, item.splitTags?.colorPartTag);
                              }}
                            />
                          )}
                          {/* 手动替换撤销（紫色 🟣）：调 onRevertManualReplace（Spec: add-multi-round-tag-audit / Task 3.3） */}
                          {isManuallyReplaced && onRevertManualReplace && (
                            <UndoOutlined
                              style={{ marginLeft: 6, cursor: 'pointer', fontSize: 11 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRevertManualReplace(item.tag, item.manualReplacement!);
                              }}
                            />
                          )}
                          {/* AI 兜底命中撤销（橙色 🤖）：调 onRevertAiFallback（Spec: add-ai-fallback-tag-audit） */}
                          {/* 与手动替换撤销语义一致（都涉及 userSynonymMap 映射），但独立回调避免歧义 */}
                          {isAiFallbackHit && onRevertAiFallback && (
                            <UndoOutlined
                              style={{ marginLeft: 6, cursor: 'pointer', fontSize: 11 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRevertAiFallback(item.tag, item.replacedBy!);
                              }}
                            />
                          )}
                          {/* 手动替换入口（✏）：仅 isValid=false 且非评级词/非已手动替换时展示（Task 3.2） */}
                          {canManualReplace && (
                            <EditOutlined
                              style={{ marginLeft: 6, cursor: 'pointer', fontSize: 11 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                // 展开 inline 输入框，初始值为空（用户输入替换词）
                                setManualReplaceIdx(idx);
                                setManualReplaceValue('');
                              }}
                            />
                          )}
                        </Tag>
                      </Tooltip>
                      {/* 末轮人工审核：inline 输入框（Spec: add-multi-round-tag-audit / Task 3.2） */}
                      {manualReplaceIdx === idx && (
                        <Input
                          size="small"
                          autoFocus
                          placeholder="输入替换词，回车确认"
                          value={manualReplaceValue}
                          onChange={(e) => setManualReplaceValue(e.target.value)}
                          onPressEnter={() => {
                            const trimmed = manualReplaceValue.trim();
                            if (!trimmed) {
                              // 空值不确认，保留输入框
                              return;
                            }
                            onManualReplace?.(item.tag, trimmed);
                            // 收起输入框 + 清空值（父组件更新 ragDebug 后该项变 manuallyReplaced=true）
                            setManualReplaceIdx(null);
                            setManualReplaceValue('');
                          }}
                          onKeyDown={(e) => {
                            // Esc 取消输入，收起输入框
                            if (e.key === 'Escape') {
                              setManualReplaceIdx(null);
                              setManualReplaceValue('');
                            }
                          }}
                          onBlur={() => {
                            // 失焦收起输入框（避免输入框常驻）
                            setManualReplaceIdx(null);
                            setManualReplaceValue('');
                          }}
                          style={{ width: 180, fontSize: 12 }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* RAG 检索参考区 */}
          {retrievedTags.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                📚 RAG 检索到的参考标签（注入到 AI 提示词，共 {retrievedTags.length} 条）
              </div>
              <div
                style={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                {retrievedTags.map((tag, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '3px 6px',
                      borderBottom: idx < retrievedTags.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                      fontSize: 12,
                    }}
                  >
                    <span>
                      <span style={{ color: COLORS.ragRef, marginRight: 6 }}>●</span>
                      {tag.name}
                      {tag.category !== undefined && tag.category >= 0 && (
                        <span style={{ color: COLORS.textSecondary, marginLeft: 6, fontSize: 11 }}>
                          [{CATEGORY_NAMES[tag.category] || `cat:${tag.category}`}]
                        </span>
                      )}
                    </span>
                    <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>
                      score: {tag.score.toFixed(3)}
                      {tag.count > 0 && ` | count: ${tag.count}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RagQualityReport;
