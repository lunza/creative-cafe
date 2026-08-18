import React, { useState, useEffect } from 'react';
import { Button, Switch, Select, Tooltip, Checkbox, Modal, Input, InputNumber, Slider, Tag, Popover, Collapse, Space } from 'antd';
import { SaveOutlined, PictureOutlined, QuestionCircleOutlined, DownOutlined, RightOutlined, EditOutlined, UndoOutlined, PlusOutlined, CheckOutlined, CloseOutlined, SplitCellsOutlined } from '@ant-design/icons';
import PersonaPanel from './PersonaPanel';
import ParameterPanel from './ParameterPanel';
import VectorizationPanel from './VectorizationPanel';
import MemoryTablePanel from './MemoryTablePanel';
import TokenManagementPanel from './TokenManagementPanel';
// 【Spec: enhance-conversation-interaction-prompt-recognition】TagAutocomplete 提供标签库实时推荐，
// 降级开关关闭时内部回退为普通 Input（onPressEnter / onKeyDown 已透传），安全使用
import TagAutocomplete from '../../Common/TagAutocomplete';
import { UserPersona, AIParameterConfig, EffectiveAIParams, ThinkTagMode } from './CharacterDialogueChat.types';
import { EngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import { SIZE_PRESETS } from './SizeSelector';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
// 【Spec: enhance-conversation-image-auditability / Task 8】订阅 sessionTraits 与 5 个 actions
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { SYSTEM_TRAIT_CATEGORIES, UNCATEGORIZED_CATEGORY } from '@shared/types';
import type { CharacterTraitItem, TraitCategory } from '@shared/types';
import './ConfigPanel.css';

interface TokenManagementConfig {
  maxContextTokens?: number;
  reservedForResponse?: number;
  minMessagesToKeep?: number;
  maxMessagesToKeep?: number;
}

interface ConfigPanelProps {
  characterCardId: string;
  characterCardName: string;
  selectedPersonaId: string | undefined;
  effectiveParams: EffectiveAIParams;
  customParameters: AIParameterConfig | undefined;
  personas: UserPersona[];
  personasLoading: boolean;
  boundKnowledgeBaseIds: string[];
  memoryTableEnabled: boolean;
  memoryTableAutoOrganize: boolean;
  memoryTableOrganizeMode: 'sync' | 'async';
  memoryTableTemplateId: string | null;
  memoryTableTemplateName: string;
  tokenManagementConfig: TokenManagementConfig;
  // 自定义停止序列（Spec: optimize-chat-ai-intelligence / Task 3.4）
  customStopSequencesEnabled?: boolean;
  customStopSequences?: string[];
  // 开启表情（Spec: add-character-expression-system）
  expressionDisplay?: boolean;
  onExpressionDisplayToggle?: (enabled: boolean) => void;
  // Think 标签处理三态选择
  thinkTagMode?: ThinkTagMode;
  onThinkTagModeChange?: (mode: ThinkTagMode) => void;
  // 辅助模式开关（Spec: add-assist-mode-options）
  assistMode?: boolean;
  onAssistModeToggle?: (enabled: boolean) => void;
  // 语言要求
  language?: 'zh' | 'en' | 'ja';
  onLanguageChange?: (language: 'zh' | 'en' | 'ja') => void;
  // 图片生成设置（Spec: add-conversation-image-generation）
  imageGenEnabled?: boolean;
  imageGenWidth?: number;
  imageGenHeight?: number;
  onImageGenToggle?: (enabled: boolean) => void;
  onImageGenSizeChange?: (width: number, height: number) => void;
  // 互动标签权重提升（Spec: enhance-conversation-interaction-prompt-recognition）
  // 互动标签拼接位置靠后，角色特征较多时容易被图像模型忽略，通过分类级权重提升加强
  interactionWeight?: number;
  onInteractionWeightChange?: (weight: number) => void;
  // 允许 AI 优化特征标签（试验性功能）（Spec: add-ai-trait-optimization-for-image-gen）
  // 开启后图片生成前 AI 会分析角色特征与对话上下文的矛盾，自动删除不再适用的标签
  aiOptimizeTraits?: boolean;
  onAiOptimizeTraitsToggle?: (enabled: boolean) => void;
  /**
   * 后端能力探测结果（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）。
   * 透传给 ParameterPanel，决定 repetition_penalty 滑块与 DRY 采样折叠区的显隐。
   */
  engineCapabilities?: EngineCapabilities;
  onPersonaChange: (personaId: string) => void;
  onParameterChange: (params: Partial<AIParameterConfig>) => void;
  onResetParameters: () => void;
  onCustomStopSequencesToggle?: (enabled: boolean) => void;
  onCustomStopSequencesChange?: (stops: string[]) => void;
  onBindKnowledgeBase: (documentId: string) => void;
  onUnbindKnowledgeBase: (documentId: string) => void;
  onMemoryTableToggle: (enabled: boolean) => void;
  onMemoryTableAutoOrganizeToggle: (enabled: boolean) => void;
  onMemoryTableOrganizeModeChange: (mode: 'sync' | 'async') => void;
  onMemoryTableTemplateAssociate: (templateId: string, templateName: string) => void;
  onTokenManagementConfigChange: (config: Partial<TokenManagementConfig>) => void;
  onSaveConfig: () => void;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({
  characterCardId,
  characterCardName,
  selectedPersonaId,
  effectiveParams,
  customParameters,
  personas,
  personasLoading,
  boundKnowledgeBaseIds,
  memoryTableEnabled,
  memoryTableAutoOrganize,
  memoryTableOrganizeMode,
  memoryTableTemplateId,
  memoryTableTemplateName,
  tokenManagementConfig,
  customStopSequencesEnabled,
  customStopSequences,
  expressionDisplay,
  onExpressionDisplayToggle,
  thinkTagMode,
  onThinkTagModeChange,
  assistMode,
  onAssistModeToggle,
  language,
  onLanguageChange,
  imageGenEnabled,
  imageGenWidth,
  imageGenHeight,
  onImageGenToggle,
  onImageGenSizeChange,
  interactionWeight,
  onInteractionWeightChange,
  aiOptimizeTraits,
  onAiOptimizeTraitsToggle,
  engineCapabilities,
  onPersonaChange,
  onParameterChange,
  onResetParameters,
  onCustomStopSequencesToggle,
  onCustomStopSequencesChange,
  onBindKnowledgeBase,
  onUnbindKnowledgeBase,
  onMemoryTableToggle,
  onMemoryTableAutoOrganizeToggle,
  onMemoryTableOrganizeModeChange,
  onMemoryTableTemplateAssociate,
  onTokenManagementConfigChange,
  onSaveConfig,
}) => {
  const [imageGenCollapsed, setImageGenCollapsed] = useState(() => {
    return localStorage.getItem('image-gen-panel-collapsed') !== 'false';
  });

  useEffect(() => {
    localStorage.setItem('image-gen-panel-collapsed', String(imageGenCollapsed));
  }, [imageGenCollapsed]);

  // 角色特征分类列表（Spec: fix-conversation-image-generation-bugs / Bug 3）
  const characterTraits = useCharacterTraitStore(s => s.traits);
  const traitStoreCardId = useCharacterTraitStore(s => s.currentCharacterCardId);
  const loadTraits = useCharacterTraitStore(s => s.loadTraits);
  const globalCategories = useCharacterTraitStore(s => s.globalCategories);

  // 【Spec: enhance-conversation-image-auditability / Task 8.1】订阅 sessionTraits 与 5 个 actions。
  // sessionTraits 是对话级临时特征覆盖，存在时 ConfigPanel 进入「临时编辑模式」，
  // 所有编辑操作（toggle / 编辑文本 / 编辑权重 / 新增 / 删除 / 分类批量切换）均通过
  // setSessionTraits / updateSessionTrait / addSessionTrait / removeSessionTrait 写入 sessionTraits，
  // 绝不调用 characterTraitStore.saveTraits 或 setTraits（保证会话隔离，不影响角色卡 manifest）。
  // lazy initialization：当 sessionTraits 为 undefined 时，首次编辑由 store actions 自动从
  // characterTraitStore.traits 深拷贝初始化；本组件在 setSessionTraits 批量场景手动计算
  // 新数组并传入（首次传入即触发 lazy init 等价语义 —— 全量替换）。
  const sessionTraits = useCharacterChatStore(state => state.currentTestChat?.sessionTraits);
  const setSessionTraits = useCharacterChatStore(state => state.setSessionTraits);
  const updateSessionTrait = useCharacterChatStore(state => state.updateSessionTrait);
  const addSessionTrait = useCharacterChatStore(state => state.addSessionTrait);
  const removeSessionTrait = useCharacterChatStore(state => state.removeSessionTrait);
  const resetSessionTraits = useCharacterChatStore(state => state.resetSessionTraits);

  // 【Spec: enhance-conversation-image-auditability / Task 8.5 / 8.6】行内编辑本地状态。
  // - editingTraitId / editingText：点击 EditOutlined 图标进入文本编辑态（Input + ✓/✗ 按钮）
  // 权重编辑通过 Popover + handleUpdateTraitWeight 实时写入 store，无需本地编辑态。
  const [editingTraitId, setEditingTraitId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // 【Spec: enhance-conversation-interaction-prompt-recognition】新增临时标签内联输入状态。
  // 原 handleAddTrait 使用 window.prompt（Electron 不支持，导致「添加」按钮不生效），
  // 改为内联 TagAutocomplete + ✓/✗ 按钮（与 AssetGenerateModal「携带角色特征」面板设计一致）。
  // - addingCategoryId：当前处于新增模式的分类 id（null = 无分类在新增模式）
  // - addingText：Input 暂存的文本（Enter 提交 / Esc 取消）
  const [addingCategoryId, setAddingCategoryId] = useState<string | null>(null);
  const [addingText, setAddingText] = useState('');

  // 加载角色特征
  useEffect(() => {
    if (characterCardId && traitStoreCardId !== characterCardId) {
      loadTraits(characterCardId);
    }
  }, [characterCardId, traitStoreCardId, loadTraits]);

  // 【Spec: enhance-conversation-image-auditability / Task 8.2】派生 effectiveTraits。
  // sessionTraits 存在时（用户已触发任意编辑，store lazy-init 写入）优先使用，
  // 否则回退到 characterTraitStore.traits（角色卡原始数据，只读视图）。
  // 任何对 sessionTraits 的写入都会让本组件重新渲染并切到「临时编辑模式」UI。
  const effectiveTraits: CharacterTraitItem[] = sessionTraits ?? characterTraits;

  // 构建分类列表（系统分类 + 自定义分类 + 未分类）
  const traitCategories = React.useMemo<TraitCategory[]>(() => {
    return [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories, UNCATEGORIZED_CATEGORY];
  }, [globalCategories]);

  // 按分类分组特征（基于 effectiveTraits，自动跟随 sessionTraits 变化）
  const traitsByCategory = React.useMemo(() => {
    const map: Record<string, CharacterTraitItem[]> = {};
    for (const cat of traitCategories) {
      map[cat.id] = effectiveTraits.filter(t => t.categoryId === cat.id);
    }
    return map;
  }, [effectiveTraits, traitCategories]);

  // 【Spec: enhance-conversation-image-auditability / Task 8.2 / 8.8】处理分类启用/禁用。
  // 关键变更：不再调用 characterTraitStore.toggleTraitEnabled + saveTraits（会写 manifest），
  // 改为本地计算新数组后调 setSessionTraits 全量替换（首次调用 lazy-init sessionTraits）。
  // sessionTraits 不存在时，baseTraits 即 characterTraits（角色卡只读副本），map 后产生
  // 新数组传入 setSessionTraits，store 内部深拷贝隔离，sessionTraits 随之初始化。
  // 使用 setSessionTraits 而非循环 updateSessionTrait：批量场景全量替换更高效（单次 IPC），
  // 且语义更清晰（「将该分类所有特征置为 checked」是数组级操作）。
  const handleCategoryToggle = React.useCallback((categoryId: string, checked: boolean) => {
    const baseTraits = sessionTraits ?? characterTraits;
    const updated = baseTraits.map(t =>
      t.categoryId === categoryId ? { ...t, enabled: checked } : t
    );
    setSessionTraits(updated);
  }, [sessionTraits, characterTraits, setSessionTraits]);

  // 【Spec: enhance-conversation-image-auditability / Task 8.4】单个 tag 点击切换 enabled。
  // 调 updateSessionTrait（单 item 更新，store 内部 lazy-init sessionTraits 后合并 updates）。
  // newEnabled 由调用方从 trait.enabled 计算（render scope 中 trait 可见），避免此处再查表。
  const handleToggleTrait = React.useCallback((traitId: string, newEnabled: boolean) => {
    updateSessionTrait(traitId, { enabled: newEnabled });
  }, [updateSessionTrait]);

  // 【Spec: enhance-conversation-image-auditability / Task 8.4】删除单个 tag。
  // 【重点标记 - lazy-init 兼容】store 的 removeSessionTrait 在 sessionTraits 不存在时 no-op
  // （Task 7 设计：removeSessionTrait 不做 lazy-init，与 updateSessionTrait/addSessionTrait 不同）。
  // 但本面板的删除按钮（×）对所有 tag 始终渲染，用户可能以「删除」作为首个编辑操作。
  // 此时 sessionTraits 尚未初始化，直接调 removeSessionTrait 会 no-op，删除无效。
  // 解决方案：sessionTraits 已存在时调 removeSessionTrait（单 item 操作，语义清晰）；
  // sessionTraits 不存在时回退到 setSessionTraits 全量过滤（首次调用 lazy-init sessionTraits），
  // 与 toggle / 文本编辑 / 权重编辑的 lazy-init 语义保持一致。
  const handleRemoveTrait = React.useCallback((traitId: string) => {
    if (sessionTraits) {
      removeSessionTrait(traitId);
    } else {
      // lazy-init：从 characterTraits 过滤后全量替换，首次调用初始化 sessionTraits
      setSessionTraits(characterTraits.filter(t => t.id !== traitId));
    }
  }, [sessionTraits, characterTraits, removeSessionTrait, setSessionTraits]);

  // 【Spec: enhance-conversation-image-auditability / Task 8.5】确认文本编辑。
  // trim 后非空才写入；同步清空 originalText（与 AssetGenerateModal.handleConfirmEditTrait 一致：
  // 编辑后的标签不再是「L3 颜色拆分生成」，避免前端继续显示拆分图标）。
  // 调 updateSessionTrait（单 item 更新，store lazy-init 后合并 updates）。
  // 注意：不清空 translation（本面板不展示翻译，且 ConfigPanel 编辑场景以快速调整为主，
  // 保留 translation 不影响 SD 生成；如需清空可后续追加）。
  const handleConfirmTextEdit = React.useCallback(() => {
    if (!editingTraitId) return;
    const trimmed = editingText.trim();
    if (trimmed) {
      updateSessionTrait(editingTraitId, { text: trimmed, originalText: undefined });
    }
    setEditingTraitId(null);
    setEditingText('');
  }, [editingTraitId, editingText, updateSessionTrait]);

  // 【Spec: enhance-conversation-interaction-prompt-recognition】文本编辑取消。
  const handleCancelTextEdit = React.useCallback(() => {
    setEditingTraitId(null);
    setEditingText('');
  }, []);

  // 【Spec: enhance-conversation-interaction-prompt-recognition】权重实时更新（Slider/InputNumber onChange）。
  // 与 AssetGenerateModal 设计一致：Popover 内 Slider + InputNumber 联动，onChange 实时写入 store。
  const handleUpdateTraitWeight = React.useCallback((traitId: string, weight: number) => {
    // 兜底范围校验：0.1-10.0（与 CharacterTraitItem.weight 约定一致），保留 1 位小数
    const clamped = Math.min(10.0, Math.max(0.1, Math.round(weight * 10) / 10));
    updateSessionTrait(traitId, { weight: clamped });
  }, [updateSessionTrait]);

  // 【Spec: enhance-conversation-interaction-prompt-recognition】添加新特征（内联输入，替换 window.prompt）。
  // 进入新增模式：记录目标分类 id，清空 Input 暂存值。
  const handleStartAddTrait = React.useCallback((categoryId: string) => {
    setAddingCategoryId(categoryId);
    setAddingText('');
  }, []);

  // 确认添加：调 addSessionTrait（store 内部 genTraitId 生成 id + lazy-init sessionTraits）。
  const handleConfirmAddTrait = React.useCallback(() => {
    if (!addingCategoryId) return;
    const trimmed = addingText.trim();
    if (trimmed) {
      addSessionTrait(addingCategoryId, trimmed);
    }
    setAddingText('');
    setAddingCategoryId(null);
  }, [addingCategoryId, addingText, addSessionTrait]);

  // 取消添加：清空新增模式状态。
  const handleCancelAddTrait = React.useCallback(() => {
    setAddingCategoryId(null);
    setAddingText('');
  }, []);

  // TagAutocomplete 选中推荐 tag 后：直接添加到 store 并清空输入框（不退出新增模式，允许连续添加）。
  // onTagSelect 回调接收 TagSearchResult 对象（含 name / category / count 等字段），取 .name 作为 tag 文本。
  const handleTagSelectAdd = React.useCallback((tag: { name: string }) => {
    if (!addingCategoryId) return;
    addSessionTrait(addingCategoryId, tag.name);
    setAddingText('');
  }, [addingCategoryId, addSessionTrait]);

  // 【Spec: enhance-conversation-image-auditability / Task 8.3】重置为角色卡特征。
  // Modal.confirm 二次确认后调 resetSessionTraits（清空 sessionTraits，回退到 characterTraits）。
  const handleResetSessionTraits = React.useCallback(() => {
    Modal.confirm({
      title: '重置为角色卡特征',
      content: '确定放弃当前对话的临时特征编辑，恢复为角色卡原始特征？此操作不影响角色卡数据。',
      okText: '确认重置',
      cancelText: '取消',
      onOk: () => resetSessionTraits(),
    });
  }, [resetSessionTraits]);

  return (
    <div className="config-panel">
      <PersonaPanel
        personas={personas}
        selectedPersonaId={selectedPersonaId}
        loading={personasLoading}
        onPersonaChange={onPersonaChange}
      />
      <div className="config-panel-divider" />
      <ParameterPanel
        effectiveParams={effectiveParams}
        customParameters={customParameters}
        onParameterChange={onParameterChange}
        onResetParameters={onResetParameters}
        customStopSequencesEnabled={customStopSequencesEnabled}
        customStopSequences={customStopSequences}
        onCustomStopSequencesToggle={onCustomStopSequencesToggle}
        onCustomStopSequencesChange={onCustomStopSequencesChange}
        expressionDisplay={expressionDisplay}
        onExpressionDisplayToggle={onExpressionDisplayToggle}
        thinkTagMode={thinkTagMode}
        onThinkTagModeChange={onThinkTagModeChange}
        assistMode={assistMode}
        onAssistModeToggle={onAssistModeToggle}
        language={language}
        onLanguageChange={onLanguageChange}
        engineCapabilities={engineCapabilities}
      />
      <div className="config-panel-divider" />
      <div className="image-gen-panel">
        <div className="image-gen-panel-header" onClick={() => setImageGenCollapsed(!imageGenCollapsed)} style={{ cursor: 'pointer' }}>
          <div className="image-gen-panel-title">
            <div className="image-gen-collapse-icon">
              {imageGenCollapsed ? <RightOutlined /> : <DownOutlined />}
            </div>
            <PictureOutlined className="image-gen-icon" />
            <span>图片生成设置</span>
            <Tooltip title="在对话中一键基于上下文生成场景图片">
              <QuestionCircleOutlined className="image-gen-tooltip-icon" />
            </Tooltip>
          </div>
        </div>
        <div className={`image-gen-panel-content ${imageGenCollapsed ? 'collapsed' : ''}`}>
          <div className="image-gen-panel-inner">
            {/* 是否开启图片生成 */}
            <div className="image-gen-config-row">
              <span className="image-gen-config-label">是否开启图片生成</span>
              <Switch
                size="small"
                checked={imageGenEnabled ?? false}
                onChange={onImageGenToggle}
              />
            </div>
            {/* 图片大小选择 */}
            <div className="image-gen-config-row">
              <span className="image-gen-config-label">图片大小</span>
              <Select
                size="small"
                style={{ width: 160 }}
                value={imageGenWidth && imageGenHeight ? `${imageGenWidth}x${imageGenHeight}` : '1024x1024'}
                onChange={(value: string) => {
                  const [w, h] = value.split('x').map(Number);
                  onImageGenSizeChange?.(w, h);
                }}
                options={SIZE_PRESETS.map(p => ({
                  value: `${p.width}x${p.height}`,
                  label: `${p.label} (${p.width}×${p.height})`,
                }))}
                disabled={!imageGenEnabled}
              />
            </div>
            {/* 互动标签权重提升（Spec: enhance-conversation-interaction-prompt-recognition）
                互动标签（disembodied_hand / hugging_another 等）拼接位置靠后，
                角色特征较多时容易被图像模型忽略，通过分类级权重提升加强 */}
            <div className="image-gen-config-row image-gen-interaction-weight-row">
              <span className="image-gen-config-label">
                互动标签权重
                <Tooltip title="互动标签（触摸/拥抱/亲吻等交互动作）在 prompt 中位置靠后，角色特征较多时容易被图像模型忽略。提升权重可加强互动元素的表现力。默认 1.2，范围 1.0-2.0，1.0 = 不提升。最终权重 = 标签自身权重 × 此值。">
                  <QuestionCircleOutlined className="image-gen-tooltip-icon" />
                </Tooltip>
              </span>
              <div className="image-gen-interaction-weight-control">
                <Slider
                  min={1.0}
                  max={2.0}
                  step={0.1}
                  value={interactionWeight ?? 1.2}
                  onChange={(v) => onInteractionWeightChange?.(v)}
                  disabled={!imageGenEnabled}
                  style={{ width: 100, margin: '0 8px' }}
                  tooltip={{ formatter: (v) => v?.toFixed(1) }}
                />
                <span className="image-gen-interaction-weight-value">
                  {(interactionWeight ?? 1.2).toFixed(1)}
                </span>
              </div>
            </div>
            {/* 允许 AI 优化特征标签（试验性功能）（Spec: add-ai-trait-optimization-for-image-gen）
                开启后图片生成前 AI 会分析角色特征与对话上下文的矛盾，自动删除不再适用的标签。
                ⚠️ 试验性功能：AI 可能会误删重要标签，建议谨慎使用。 */}
            <div className="image-gen-config-row image-gen-ai-optimize-row">
              <span className="image-gen-config-label">
                允许 AI 优化特征标签
                <Tooltip title="开启后，图片生成前 AI 会根据对话上下文自动分析并删除矛盾的角色特征标签（如对话中角色脱下裤子时移除 pants 标签）。此为试验性功能，AI 可能会误删重要标签。">
                  <QuestionCircleOutlined className="image-gen-tooltip-icon" />
                </Tooltip>
              </span>
              <Switch
                size="small"
                checked={aiOptimizeTraits ?? false}
                onChange={onAiOptimizeTraitsToggle}
                disabled={!imageGenEnabled}
              />
            </div>
            <div className="image-gen-experimental-warning">
              ⚠ 试验性功能：AI 可能会删除重要标签，建议谨慎使用
            </div>
            <div className="image-gen-config-hint">
              在对话中一键生成场景图片
            </div>
            {/* 角色特征分类列表（Spec: fix-conversation-image-generation-bugs / Bug 3）
                【Spec: enhance-conversation-interaction-prompt-recognition】按 AssetGenerateModal
                「携带角色特征」面板设计重构：Collapse 折叠面板 + antd Tag + Tooltip + EditOutlined
                + Popover 权重编辑器 + TagAutocomplete 内联添加。保留分类级启用/禁用 Checkbox。
                - 所有分类均显示（含空分类），用户可向空分类（如 interaction）添加标签
                - Tag 点击切换 enabled / EditOutlined 编辑文本 / closable 删除 / Popover 编辑权重
                - TagAutocomplete 提供标签库实时推荐（替换原 window.prompt，Electron 不支持） */}
            <div className="image-gen-trait-section">
              <div className="image-gen-trait-section-title">
                <span>角色特征分类</span>
                {sessionTraits && (
                  <>
                    <Tooltip title="当前特征为对话临时编辑，仅对此对话生效，不影响角色卡数据">
                      <span className="image-gen-session-badge">
                        <EditOutlined /> 临时编辑中
                      </span>
                    </Tooltip>
                    <Button
                      size="small"
                      className="image-gen-reset-btn"
                      icon={<UndoOutlined />}
                      onClick={handleResetSessionTraits}
                    >
                      重置
                    </Button>
                  </>
                )}
                <Tooltip title="点击 Tag 切换启用/禁用；点击 ✏ 编辑文本；点击权重徽标调整权重；× 删除；分类下方可新增标签。所有修改仅影响当前对话。">
                  <Tag color="blue" className="image-gen-trait-help-tag">可临时编辑</Tag>
                </Tooltip>
              </div>
              {effectiveTraits.length === 0 ? (
                <div className="image-gen-trait-empty">
                  当前角色暂无特征数据，请先在素材管理中生成角色特征
                </div>
              ) : (
                <Collapse
                  size="small"
                  className="image-gen-trait-collapse"
                  defaultActiveKey={traitCategories
                    .filter(cat => (traitsByCategory[cat.id] || []).length > 0)
                    .map(cat => cat.id)}
                >
                  {traitCategories.map(cat => {
                    const catTraits = traitsByCategory[cat.id] || [];
                    const enabledInCat = catTraits.filter(t => t.enabled).length;
                    return (
                      <Collapse.Panel
                        key={cat.id}
                        header={
                          <div
                            className="image-gen-trait-category-header"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={catTraits.length > 0 && enabledInCat === catTraits.length}
                              indeterminate={enabledInCat > 0 && enabledInCat < catTraits.length}
                              onChange={(e) => handleCategoryToggle(cat.id, e.target.checked)}
                              disabled={catTraits.length === 0}
                            />
                            <span className="image-gen-trait-category-name">{cat.name}</span>
                            {catTraits.length > 0 && (
                              <span className="image-gen-trait-count">
                                {enabledInCat}/{catTraits.length}
                              </span>
                            )}
                          </div>
                        }
                      >
                        <Space size={[4, 4]} wrap className="image-gen-trait-tags">
                          {catTraits.map(trait => {
                            // 文本编辑态：渲染 Input + ✓/✗ 按钮（回车确认 / Esc 取消）
                            if (editingTraitId === trait.id) {
                              return (
                                <span key={trait.id} className="image-gen-trait-edit-inline">
                                  <Input
                                    size="small"
                                    autoFocus
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    onPressEnter={handleConfirmTextEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        handleCancelTextEdit();
                                      }
                                    }}
                                    style={{ width: 140, fontSize: 11 }}
                                  />
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<CheckOutlined />}
                                    onClick={handleConfirmTextEdit}
                                    style={{ color: '#22c55e', fontSize: 11 }}
                                  />
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<CloseOutlined />}
                                    onClick={handleCancelTextEdit}
                                    style={{ color: '#ef4444', fontSize: 11 }}
                                  />
                                </span>
                              );
                            }
                            const weightValue = trait.weight ?? 1.0;
                            const isDefaultWeight = trait.weight === undefined || trait.weight === 1.0;
                            return (
                              <span key={trait.id} className="image-gen-trait-tag-wrapper">
                                <Tooltip
                                  title={
                                    trait.originalText || trait.translation
                                      ? (
                                        <div style={{ lineHeight: 1.6 }}>
                                          {trait.originalText && <div>原标签：{trait.originalText}</div>}
                                          {trait.originalText && <div>拆分为：{trait.text}</div>}
                                          {trait.translation && <div>翻译：{trait.translation}</div>}
                                          <div style={{ color: isDefaultWeight ? 'var(--text-secondary, #94a3b8)' : weightValue > 1.0 ? '#fa8c16' : '#1677ff' }}>
                                            权重：{weightValue.toFixed(1)}
                                          </div>
                                        </div>
                                      )
                                      : `权重：${weightValue.toFixed(1)}`
                                  }
                                >
                                  <Tag
                                    color={trait.enabled ? 'blue' : 'default'}
                                    closable
                                    onClose={(e) => {
                                      e.preventDefault();
                                      handleRemoveTrait(trait.id);
                                    }}
                                    onClick={() => handleToggleTrait(trait.id, !trait.enabled)}
                                    style={{
                                      margin: 0,
                                      opacity: trait.enabled ? 1 : 0.45,
                                      cursor: 'pointer',
                                      userSelect: 'none',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 2,
                                      fontSize: 11,
                                    }}
                                  >
                                    {trait.originalText && (
                                      <SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />
                                    )}
                                    {trait.text}
                                    <EditOutlined
                                      style={{ fontSize: 10, marginLeft: 2, opacity: 0.7 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingTraitId(trait.id);
                                        setEditingText(trait.text);
                                      }}
                                    />
                                  </Tag>
                                </Tooltip>
                                <Popover
                                  trigger="click"
                                  placement="top"
                                  title={`权重编辑（${trait.text}）`}
                                  content={
                                    <div className="image-gen-weight-popover">
                                      <div className="image-gen-weight-slider-row">
                                        <Slider
                                          min={0.1}
                                          max={2.0}
                                          step={0.1}
                                          value={weightValue}
                                          onChange={(v) => handleUpdateTraitWeight(trait.id, v)}
                                          style={{ width: 120, margin: '0 8px 0 0' }}
                                          tooltip={{ formatter: (v) => v?.toFixed(1) }}
                                        />
                                        <InputNumber
                                          size="small"
                                          min={0.1}
                                          max={10.0}
                                          step={0.1}
                                          value={weightValue}
                                          onChange={(v) => handleUpdateTraitWeight(trait.id, v ?? 1.0)}
                                          style={{ width: 70 }}
                                        />
                                      </div>
                                      <div className="image-gen-weight-presets">
                                        <Button size="small" onClick={() => handleUpdateTraitWeight(trait.id, 1.0)}>重置 1.0</Button>
                                        <Button size="small" onClick={() => handleUpdateTraitWeight(trait.id, 1.2)}>1.2</Button>
                                        <Button size="small" onClick={() => handleUpdateTraitWeight(trait.id, 1.5)}>1.5</Button>
                                      </div>
                                    </div>
                                  }
                                >
                                  <span
                                    className={`image-gen-trait-weight-badge ${isDefaultWeight ? 'default' : weightValue > 1.0 ? 'boost' : 'reduce'}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    ×{weightValue.toFixed(1)}
                                  </span>
                                </Popover>
                              </span>
                            );
                          })}
                          {/* 新增临时标签入口 */}
                          {addingCategoryId === cat.id ? (
                            <span className="image-gen-trait-add-inline">
                              <TagAutocomplete
                                size="small"
                                autoFocus
                                placeholder="输入标签"
                                value={addingText}
                                onChange={setAddingText}
                                onTagSelect={handleTagSelectAdd}
                                onPressEnter={handleConfirmAddTrait}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    handleCancelAddTrait();
                                  }
                                }}
                                showSortButton={false}
                                style={{ width: 140, fontSize: 11 }}
                              />
                              <Button
                                size="small"
                                type="text"
                                icon={<CheckOutlined />}
                                onClick={handleConfirmAddTrait}
                                style={{ color: '#22c55e', fontSize: 11 }}
                              />
                              <Button
                                size="small"
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={handleCancelAddTrait}
                                style={{ color: '#ef4444', fontSize: 11 }}
                              />
                            </span>
                          ) : (
                            <Tag
                              onClick={() => handleStartAddTrait(cat.id)}
                              className="image-gen-trait-add-tag"
                            >
                              <PlusOutlined style={{ fontSize: 10 }} /> 新增
                            </Tag>
                          )}
                        </Space>
                      </Collapse.Panel>
                    );
                  })}
                </Collapse>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="config-panel-divider" />
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--config-panel-sub-title-color)', marginBottom: 8 }}>
          记忆与上下文增强
        </div>
        <VectorizationPanel
          characterCardId={characterCardId}
          boundKnowledgeBaseIds={boundKnowledgeBaseIds}
          onBindKnowledgeBase={onBindKnowledgeBase}
          onUnbindKnowledgeBase={onUnbindKnowledgeBase}
        />
        <div style={{ fontSize: '12px', color: 'var(--config-panel-sub-text-color, #94a3b8)', marginTop: 4 }}>
          从文档中检索相关知识注入上下文
        </div>
      </div>
      <div className="config-panel-divider" />
      <div>
        <MemoryTablePanel
          enabled={memoryTableEnabled}
          autoOrganize={memoryTableAutoOrganize}
          organizeMode={memoryTableOrganizeMode}
          associatedTemplateId={memoryTableTemplateId}
          associatedTemplateName={memoryTableTemplateName}
          characterCardName={characterCardName}
          onToggle={onMemoryTableToggle}
          onAutoOrganizeToggle={onMemoryTableAutoOrganizeToggle}
          onOrganizeModeChange={onMemoryTableOrganizeModeChange}
          onTemplateAssociate={onMemoryTableTemplateAssociate}
        />
        <div style={{ fontSize: '12px', color: 'var(--config-panel-sub-text-color, #94a3b8)', marginTop: 4 }}>
          AI 自动整理对话中的关键信息到表格
        </div>
      </div>
      <div className="config-panel-divider" />
      <TokenManagementPanel
        config={tokenManagementConfig}
        onConfigChange={onTokenManagementConfigChange}
      />
      <div className="config-panel-divider" />
      <div className="config-panel-actions">
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={onSaveConfig}
          className="config-save-btn"
          block
        >
          保存设置
        </Button>
      </div>
    </div>
  );
};

export default ConfigPanel;
