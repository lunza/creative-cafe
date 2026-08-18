import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Modal, message, Tooltip, Button, Popconfirm } from 'antd';
import { DownloadOutlined, CopyOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import ChatHeader from './ChatHeader';
import ChatMessageBubble from './ChatMessageBubble';
import ChatInputBar from './ChatInputBar';
import ChatTypingIndicator from './ChatTypingIndicator';
import { ChatMessageList } from '../../Common/ChatMessageList/ChatMessageList';
import ConfigPanel from './ConfigPanel';
import CharacterSelectorPanel from './CharacterSelectorPanel';
import AssetManagerModal from './AssetManagerModal';
import { CommandPalette, CommandPaletteItem } from '../../Common/CommandPalette';
import { useCharacterDialogueChat } from './CharacterDialogueChat.hooks';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { useExpressionStore } from '../../../stores/expressionStore';
import { exportConversation } from './CharacterDialogueChat.utils';
import { CharacterInfo, AIParameterConfig, deriveThinkTagMode, ChatMessage, ImageHistoryItem } from './CharacterDialogueChat.types';
import { buildAssetPromptTemplate, EMOTION_PROMPT_MAP } from './PromptBuilder';
import { buildSdOptionsFromConfig } from './buildSdOptions';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
import { useCharacterLoraStore } from '../../../stores/characterLoraStore';
// 【Spec: enhance-conversation-image-auditability / Task 10】读取会话级临时特征 sessionTraits
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { getDefaultEngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import './CharacterDialogueChat.css';

interface CharacterSelectorItem {
  name: string;
  path: string;
  size: number;
  modified: Date;
  characterName?: string;
  version?: string;
  creator?: string;
  tags?: string[];
  cardVersion?: 'v1' | 'v2' | 'v3';
}

interface CharacterDialogueChatProps {
  characterInfo: CharacterInfo;
  open: boolean;
  onClose: () => void;
  avatarPath?: string;
  characters?: CharacterSelectorItem[];
  onCharacterSelect?: (character: CharacterSelectorItem) => void;
}

const EXPORT_MENU_ITEMS = [
  { key: 'copy', label: '复制到剪贴板' },
  { key: 'save', label: '保存为文件' },
];

const CharacterDialogueChat: React.FC<CharacterDialogueChatProps> = ({
  characterInfo,
  open,
  onClose,
  avatarPath,
  characters,
  onCharacterSelect,
}) => {
  const {
    state,
    stateWithVersionInfo,
    sendMessage,
    continueConversation,
    generateUserReply,
    isGeneratingUserReply,
    polishInput,
    isPolishingInput,
    retryMessage,
    retryMessageFromVersion,
    editMessage,
    rollbackToMessage,
    // 图片附件管理（Spec: enhance-conversation-image-bubble / Task 10）
    // - updateImageAttachment：Task 9 阶段状态更新调用
    // - deleteImageAttachment / navigateImageHistory：Task 11 接线（ChatMessageBubble onDeleteImage/onNavigateImage）
    updateImageAttachment,
    deleteImageAttachment,
    navigateImageHistory,
    clearChat,
    clearError,
    cancelRequest,
    selectedPersona,
    personas,
    personasLoading,
    characterConfig,
    updateConfig,
    saveConfig,
    resetParameters,
    getEffectiveParams,
    bindKnowledgeBase,
    unbindKnowledgeBase,
    memoryTableEnabled,
    memoryTableAutoOrganize,
    memoryTableOrganizeMode,
    memoryTableTemplateId,
    memoryTableTemplateName,
    isOrganizing,
    fetchMemoryTableData,
    handleMemoryTableToggle,
    handleMemoryTableAutoOrganizeToggle,
    handleMemoryTableOrganizeModeChange,
    handleMemoryTableTemplateAssociate,
    tokenManagementConfig,
    handleTokenManagementConfigChange,
    handleStopOrganizing,
    getActiveEngineConfig,
    tokenUsage,
    compressContext,
    isCompressing,
  } = useCharacterDialogueChat(characterInfo);
  
  const toggleFavorite = useFavoritesStore(s => s.toggleFavorite);
  const isFavorite = useFavoritesStore(s => s.isFavorite);
  const getFavoritePaths = useFavoritesStore(s => s.getFavoritePaths);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [generatedReplyText, setGeneratedReplyText] = useState('');
  const [polishFlashKey, setPolishFlashKey] = useState(0);
  const [expressionManagerOpen, setExpressionManagerOpen] = useState(false);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  // 当前生成中的 messageId（Spec: enhance-conversation-image-bubble / Task 9.7）
  // 供 onTraitPromptProgress 回调定位需更新 phase 的消息
  const generatingMessageIdRef = useRef<string | null>(null);
  const favoritePaths = getFavoritePaths();

  // 表情系统订阅（Spec: add-character-expression-system / Task 10.3 + 12.1）
  // resolveExpressionImage：emotionKey → 表情图像路径解析器（store 内通过 get() 读取 imageCache）
  // imageCache：作为订阅依赖，缓存变化时触发消息列表重渲染，确保加载完成后表情图像立即生效
  // loadExpressions：进入对话时预加载该角色卡所有已上传表情
  const resolveExpressionImage = useExpressionStore((s) => s.resolveExpressionImage);
  const imageCache = useExpressionStore((s) => s.imageCache);
  const loadExpressions = useExpressionStore((s) => s.loadExpressions);

  // 角色特征 Store（Spec: add-conversation-image-generation）
  const characterTraits = useCharacterTraitStore(s => s.traits);
  const traitStoreCardId = useCharacterTraitStore(s => s.currentCharacterCardId);
  const loadStoreTraits = useCharacterTraitStore(s => s.loadTraits);

  // 角色 LoRA Store（Spec: add-conversation-image-generation）
  const loadCharacterLoras = useCharacterLoraStore(s => s.loadLoras);

  // 预加载当前角色卡的表情包（Spec: add-character-expression-system / Task 12.1）
  // 表情系统默认永久开启，characterCardId 变化时自动加载
  useEffect(() => {
    if (characterInfo.characterCardId) {
      loadExpressions(characterInfo.characterCardId);
    }
  }, [characterInfo.characterCardId, loadExpressions]);

  useEffect(() => {
    if (stateWithVersionInfo.messages.length > 0 || stateWithVersionInfo.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [stateWithVersionInfo.messages, stateWithVersionInfo.isStreaming]);

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Ctrl+K 命令面板快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteVisible(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 订阅 imageCache 引用变化以触发消息列表重渲染（Spec: Task 10.3）
  // resolveExpressionImage 通过 zustand get() 读取最新缓存，但需要订阅引用变化
  // 确保表情加载/更新完成后气泡头像立即切换
  useEffect(() => {
    // no-op: 仅订阅 imageCache 引用变化
  }, [imageCache]);

  // 订阅 AI 标签提示词生成阶段进度事件（Spec: enhance-conversation-image-bubble / Task 9.7）
  // 主进程在 generateTraitPrompts 期间推送 phase 变更（tag-generating → tag-auditing），
  // 渲染进程据此更新对应消息 imageAttachment.phase，驱动占位区域文案切换。
  // 注意：preload 的 onTraitPromptProgress 返回 IpcRenderer 实例而非 unsubscribe 函数，
  // 清理需调用 offTraitPromptProgress()（与 sd.onGenerationProgress 模式一致，Task 3 preload 实现）。
  useEffect(() => {
    window.electronAPI.ai.onTraitPromptProgress((data) => {
      const msgId = generatingMessageIdRef.current;
      if (msgId && data.phase) {
        updateImageAttachment(msgId, (prev) => prev ? { ...prev, phase: data.phase } : prev);
      }
    });
    return () => {
      window.electronAPI.ai.offTraitPromptProgress();
    };
  }, [updateImageAttachment]);

  const effectiveParams = useMemo(() => {
    return getEffectiveParams();
  }, [getEffectiveParams]);

  const imageGenEnabled = characterConfig?.customParameters?.image_gen_enabled === true;

  // 后端能力探测（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）
  // 优先使用引擎显式 capabilities 配置，缺省时按 api_mode 推断默认值。
  // 透传给 ParameterPanel 决定 repetition_penalty 滑块与 DRY 采样折叠区的显隐。
  const engineCapabilities = useMemo(() => {
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) return undefined;
    return activeEngine.capabilities || getDefaultEngineCapabilities();
  }, [getActiveEngineConfig]);

  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight > 200;
      setShowScrollButton(isNearBottom);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleSaveExport = useCallback(async (content: string) => {
    try {
      const dir = await window.electronAPI.file.selectDirectory();
      if (!dir) return;
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const fileName = `${characterInfo.characterCardName}_对话_${stamp}.md`;
      const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : (dir.includes('\\') ? '\\' : '/');
      const fullPath = `${dir}${sep}${fileName}`;
      const result = await window.electronAPI.file.write(fullPath, content);
      if (result.success) {
        message.success('对话已保存');
      } else {
        message.error(result.error || '保存失败');
      }
    } catch {
      message.error('保存失败');
    }
  }, [characterInfo.characterCardName]);

  const handleExportMenuClick = useCallback((key: string) => {
    if (stateWithVersionInfo.messages.length === 0) {
      message.warning('暂无消息可导出');
      return;
    }
    const content = exportConversation(stateWithVersionInfo.messages, characterInfo.characterCardName);
    if (key === 'copy') {
      navigator.clipboard.writeText(content).then(
        () => message.success('已复制到剪贴板'),
        () => message.error('复制失败')
      );
    } else if (key === 'save') {
      handleSaveExport(content);
    }
  }, [stateWithVersionInfo.messages, characterInfo.characterCardName, handleSaveExport]);

  const handleClearChat = useCallback(() => {
    clearChat();
  }, [clearChat]);

  const handleContinueConversation = useCallback(() => {
    continueConversation();
  }, [continueConversation]);

  const handlePersonaChange = useCallback((personaId: string) => {
    updateConfig({ selectedPersonaId: personaId });
  }, [updateConfig]);

  const handleParameterChange = useCallback((params: Partial<AIParameterConfig>) => {
    updateConfig((prev: any) => {
      const mergedCustomParams = { ...(prev?.customParameters || {}), ...params };
      return { customParameters: mergedCustomParams };
    });
  }, [updateConfig]);

  const handleResetParameters = useCallback(() => {
    resetParameters();
  }, [resetParameters]);

  // 自定义停止序列处理（Spec: optimize-chat-ai-intelligence / Task 3.4）
  // 持久化到 character-session-<cardId> localStorage 的 customStopSequencesEnabled / customStopSequences 字段
  const handleCustomStopSequencesToggle = useCallback((enabled: boolean) => {
    updateConfig({ customStopSequencesEnabled: enabled });
  }, [updateConfig]);

  const handleCustomStopSequencesChange = useCallback((stops: string[]) => {
    updateConfig({ customStopSequences: stops });
  }, [updateConfig]);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(characterInfo.characterCardId);
  }, [toggleFavorite, characterInfo.characterCardId]);

  const handleCharacterSelectWithFavorite = useCallback((character: CharacterSelectorItem) => {
    onCharacterSelect?.(character);
  }, [onCharacterSelect]);

  const handleQuickSwitchCharacter = useCallback((path: string) => {
    const target = characters?.find(c => c.path === path);
    if (target) {
      onCharacterSelect?.(target);
    }
  }, [characters, onCharacterSelect]);

  // AI 用户回复生成回调（Spec: add-ai-user-reply-button / Task 4.3）
  // 调用 hook 的 generateUserReply，成功后暂存文本到 generatedReplyText，由 ChatInputBar 通过 prop 消费
  // currentInput: 输入框中的内容，作为用户指令引导 AI 生成回复（可选，为空时保持原有行为）
  const handleGenerateUserReply = useCallback(async (currentInput?: string) => {
    try {
      const text = await generateUserReply(currentInput);
      if (text && text.length > 0) {
        setGeneratedReplyText(text);
      }
    } catch (error) {
      // 错误已在 hook 内通过 message.error 处理，此处无需重复
      console.error('[CharacterDialogueChat] handleGenerateUserReply error:', error);
    }
  }, [generateUserReply]);

  // ChatInputBar 消费完 generatedReplyText 后回调清空暂存（Spec: add-ai-user-reply-button / Task 4.4）
  const handleGeneratedReplyTextConsumed = useCallback(() => {
    setGeneratedReplyText('');
  }, []);

  // 辅助模式：点击推荐选项，填入输入框（Spec: add-assist-mode-options）
  const handleSelectOption = useCallback((optionText: string) => {
    setGeneratedReplyText(optionText);
  }, []);

  // 润色输入回调（Spec: refine-user-input-text / Task 4.3）
  // 调用 hook 的 polishInput 函数，成功时复用 generatedReplyText 机制填充输入框，
  // 并触发 polishFlashKey 变化以播放 textarea 边框高亮动画
  const handlePolishInput = useCallback(async (text: string) => {
    try {
      const polishedText = await polishInput(text);
      if (polishedText) {
        // 复用 generatedReplyText 机制填充输入框（与 AI回复 按钮共享）
        setGeneratedReplyText(polishedText);
        // 触发 textarea 边框青色高亮动画
        setPolishFlashKey(k => k + 1);
        message.success('已润色');
      }
    } catch {
      // hook 内 message.error 已处理错误提示，此处无需重复
    }
  }, [polishInput]);

  // 用户消息卷回回调（Spec: rollback-user-message / Task 3.2）
  // 调用 hook 的 rollbackToMessage，成功后通过 generatedReplyText 机制填入输入框
  const handleRollback = useCallback(async (messageId: string) => {
    const content = await rollbackToMessage(messageId);
    if (content) {
      setGeneratedReplyText(content);
      message.success('已卷回到输入框');
    } else {
      message.warning('卷回失败：未找到目标消息');
    }
  }, [rollbackToMessage]);

  // 人称选择器切换回调（Spec: add-person-attribute-to-ai-reply / Task 4.1）
  // 持久化到 character-session-<cardId> localStorage 的 userReplyPerson 字段
  const handleUserReplyPersonChange = useCallback((person: 'first' | 'second' | 'third') => {
    updateConfig({ userReplyPerson: person });
  }, [updateConfig]);

  // 图片生成共享核心逻辑（Spec: enhance-conversation-image-bubble / Task 9.1-9.6）
  // 首次生成与重新生成共用此函数，通过 isRegenerate 区分占位创建 vs 复用已有 imageAttachment。
  // 阶段状态机：tag-generating（默认）→ tag-auditing（IPC 事件驱动，见 onTraitPromptProgress useEffect）
  //            → image-generating（显式设置）→ idle/error。
  // 注意：executeImageGeneration 必须在 handleGenerateImage / handleRegenerateImage 之前定义（后者依赖前者）。
  const executeImageGeneration = useCallback(async (messageId: string, isRegenerate: boolean) => {
    setIsGeneratingImage(true);

    // 获取父消息和情绪快照（Spec: Task 9.6 情绪继承 — 生成时 imageAttachment.emotion = 父消息.emotion || 'default'）
    const parentMsg = stateWithVersionInfo.messages.find(m => m.id === messageId);
    if (!parentMsg) {
      message.error('找不到目标消息');
      setIsGeneratingImage(false);
      return;
    }
    const emotionSnapshot = parentMsg.emotion || 'default';

    // 首次生成：创建 imageAttachment 占位（status='generating', phase='tag-generating'）
    // 重新生成：复用已有 imageAttachment，更新情绪快照并重置为 generating 状态（Task 9.3 / 9.4）
    if (!isRegenerate) {
      await updateImageAttachment(messageId, () => ({
        currentAssetId: '', // 占位，生成完成后填入
        emotion: emotionSnapshot,
        createdAt: Date.now(),
        history: [],
        currentIndex: -1,
        status: 'generating',
        phase: 'tag-generating',
      }));
    } else {
      await updateImageAttachment(messageId, (prev) => prev ? {
        ...prev,
        emotion: emotionSnapshot, // 更新情绪快照（父消息 emotion 可能在对话过程中变化）
        status: 'generating',
        phase: 'tag-generating',
        errorMessage: undefined,
      } : prev);
    }

    // 记录当前生成中的 messageId（供 onTraitPromptProgress 回调使用，Task 9.7）
    generatingMessageIdRef.current = messageId;

    try {
      // === 阶段 1: 标签生成（phase 已是 tag-generating，IPC 事件会推送 tag-auditing）===
      // 1. 构建对话上下文 prompt
      const currentMessages = stateWithVersionInfo.messages.filter(m => m.status === 'sent');
      const conversationContext = currentMessages
        .map(m => `${m.role === 'user' ? '用户' : characterInfo.characterCardName}: ${m.content}`)
        .join('\n\n');

      if (!conversationContext.trim()) {
        message.warning('对话上下文为空，无法生成图片');
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: '对话上下文为空'
        } : prev);
        return;
      }

      // 2. 确保角色特征已加载
      if (traitStoreCardId !== characterInfo.characterCardId) {
        await loadStoreTraits(characterInfo.characterCardId);
      }
      // 确保角色 LoRA 已加载
      await loadCharacterLoras(characterInfo.characterCardId);

      // 3. 从 store 获取已启用的角色特征 tag
      // 【Spec: enhance-conversation-image-auditability / Task 10】特征源优先 sessionTraits（会话隔离临时编辑）
      // - sessionTraits 存在时（用户在 ConfigPanel 临时编辑过特征），从此读取，不污染角色卡 manifest
      // - sessionTraits 为 undefined 时，回退到角色卡特征 store（默认行为）
      const sessionTraits = useCharacterChatStore.getState().currentTestChat?.sessionTraits;
      const currentTraits = sessionTraits ?? useCharacterTraitStore.getState().traits;
      console.log(`[executeImageGeneration] 特征来源: ${sessionTraits ? 'sessionTraits (临时编辑)' : 'characterTraitStore (角色卡)'}`);
      let enabledTraitTexts: Array<{ text: string; weight?: number; categoryId?: string }> = currentTraits
        .filter(t => t.enabled)
        .map(t => ({ text: t.text, weight: t.weight, categoryId: t.categoryId }))
        .filter((item, _index, arr) => {
          const key = item.text.trim().toLowerCase();
          return arr.findIndex(t => t.text.trim().toLowerCase() === key) === _index;
        });

      // 【Bug 修复 - 对话图片表情与父对话气泡不一致】
      // 问题：enabledTraitTexts 包含 expression 分类的固定标签（如 smile），但对话过程中
      // 父消息的 emotion 已变化（如 annoyance），图片生成仍用固定 smile，导致图片表情与
      // 父对话气泡立绘不一致。
      // 修复：用 emotionSnapshot 从 EMOTION_PROMPT_MAP 获取动态表情 prompt，替换 expression
      // 分类的固定标签。过滤背景+全身姿势类 tag（与 background/pose 分类冲突），保留面部表情+
      // 动作+符号 tag。
      const EXPRESSION_PROMPT_EXCLUDE_TAGS = new Set([
        // 背景类
        'simple_background', 'white_background', 'gradient_background', 'dark_background',
        'grey_background', 'pink_background', 'colorful_background', 'red_background',
        'pastel_background', 'blurred_background',
        // 光效/氛围
        'sunny', 'blue_sky', 'bokeh', 'soft_lighting', 'ambient_lighting', 'dim_lighting',
        'spotlight', 'light_rays', 'shining', 'depth_of_field', 'vignette', 'motion_blur',
        'speed_lines', 'shadow', 'dark_aura', 'light_particles', 'sunlight',
        // 背景装饰
        'petals', 'confetti', 'rain', 'flower', 'sun', 'light_bulb', 'steam', 'fire', 'lightning',
        // 全身姿势（与 pose 分类冲突）
        'standing', 'arms_at_sides', 'sitting', 'kneeling', 'jumping', 'cowering',
        'self_hug', 'curled_up', 'slouching', 'bowing', 'waving', 'arms_up',
        'v_sign', 'v', 'pointing', 'nodding', 'thumbs_up',
        // 视线方向（可能与对话图片视角冲突）
        'looking_at_viewer', 'looking_away', 'looking_down', 'looking_up', 'looking_sideways',
      ]);
      // 步骤 1：移除 expression 分类的固定标签
      const hasExpressionTraits = enabledTraitTexts.some(t => t.categoryId === 'expression');
      if (hasExpressionTraits) {
        enabledTraitTexts = enabledTraitTexts.filter(t => t.categoryId !== 'expression');
      }
      // 步骤 2：从 EMOTION_PROMPT_MAP 获取动态表情 prompt，过滤后注入
      const emotionPreset = EMOTION_PROMPT_MAP[emotionSnapshot];
      if (emotionPreset && emotionPreset.positive) {
        const emotionTags = emotionPreset.positive
          .split(',')
          .map(t => t.trim())
          .filter(t => t && !EXPRESSION_PROMPT_EXCLUDE_TAGS.has(t));
        for (const tag of emotionTags) {
          // 去重：跳过已存在的 tag（大小写不敏感）
          const tagLower = tag.toLowerCase();
          if (!enabledTraitTexts.some(t => t.text.trim().toLowerCase() === tagLower)) {
            enabledTraitTexts.push({ text: tag, categoryId: 'expression' });
          }
        }
        console.log(`[executeImageGeneration] 表情标签动态替换: emotion="${emotionSnapshot}" → 注入 ${emotionTags.length} 个面部表情 tag（已过滤背景+全身姿势）`);
      } else {
        // emotionSnapshot 不在 EMOTION_PROMPT_MAP 中（自定义情绪或 default），保留移除的固定标签
        if (hasExpressionTraits) {
          console.log(`[executeImageGeneration] emotion="${emotionSnapshot}" 无预置映射，恢复原 expression 分类标签`);
          const expressionTraits = currentTraits
            .filter(t => t.enabled && t.categoryId === 'expression')
            .map(t => ({ text: t.text, weight: t.weight, categoryId: t.categoryId }));
          enabledTraitTexts.push(...expressionTraits);
        }
      }

      // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化（试验性功能）
      // 变量声明提前：aiOptimizationStatus / aiOptimizationError / removedTags / addedTags 在合并后使用。
      // 【执行顺序修复】原设计在 generateTraitPrompts 之前执行 AI 优化，只看到角色特征标签，
      // 看不到动态生成的上下文互动标签（如 disembodied_hand），导致无法删除矛盾的互动标签。
      // 现移至 mergedTraits 形成后执行，AI 能看到完整标签列表（角色特征 + 上下文生成）。
      let removedTags: Array<{ text: string; reason?: string }> = [];
      // 【Spec: add-ai-tag-supplement-after-removal / Task 3】补充标签快照，与 removedTags 对称
      let addedTags: Array<{ text: string; reason?: string }> = [];
      let aiOptimizationStatus: 'success' | 'no-removal' | 'failed' = 'no-removal';
      let aiOptimizationError: string | undefined = undefined;
      const aiOptimizeEnabled = characterConfig?.customParameters?.ai_optimize_traits === true;

      // 4. 调用 AI 生成上下文 tag（复用 generateTraitPrompts IPC，含 L0-L5 审计）
      //    期间 onTraitPromptProgress 事件会推送 phase='tag-auditing'，由 useEffect 回调自动更新 imageAttachment.phase
      const baseTraitsStr = enabledTraitTexts.map(t => t.text).join(', ');
      let contextTraits: Array<{ text: string; weight?: number; categoryId?: string }> = [];
      try {
        const result = await window.electronAPI.ai.generateTraitPrompts({
          prompt: conversationContext,
          baseTraits: baseTraitsStr,
        });
        if (result?.success && result.traits) {
          // 【Spec: enhance-conversation-interaction-prompt-recognition】保留 categoryId，
          // 用于后续互动标签分类级权重提升（interaction 分类标签拼接位置靠后需加强）
          contextTraits = result.traits.map((t: { text: string; weight?: number; categoryId?: string }) => ({
            text: t.text,
            weight: t.weight,
            categoryId: t.categoryId,
          }));
        }
      } catch (e) {
        console.warn('[CharacterDialogueChat] 生成上下文 tag 失败，仅使用角色特征:', e);
      }

      // 5. 合并上下文 tag 与角色特征 tag（去重）
      const mergedTraits: Array<{ text: string; weight?: number; categoryId?: string }> = [...enabledTraitTexts];
      for (const ct of contextTraits) {
        const key = ct.text.trim().toLowerCase();
        if (!mergedTraits.some(t => t.text.trim().toLowerCase() === key)) {
          mergedTraits.push(ct);
        }
      }

      // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化（试验性功能）
      // 【执行顺序修复 2026-08-09】原设计在 generateTraitPrompts 之前执行，只看到角色特征标签，
      // 看不到动态生成的上下文互动标签（disembodied_hand / hand_on_vulva 等），导致对话中角色
      // 「抽回手」时无法删除这些互动标签。现移至 mergedTraits 形成后执行，AI 能看到完整标签列表。
      // 防御性设计：AI 调用失败/超时/返回非法数据时降级为不优化，不中断图片生成流程。
      console.log(`[executeImageGeneration] AI 标签优化: ${aiOptimizeEnabled ? '已启用' : '已禁用'}（合并后 ${mergedTraits.length} 个标签）`);
      if (aiOptimizeEnabled && mergedTraits.length > 0) {
        try {
          const optimizeResult = await window.electronAPI.ai.optimizeTraitsForContext({
            traits: mergedTraits,
            conversationContext,
          });
          if (optimizeResult?.success && Array.isArray(optimizeResult.tagsToRemove)) {
            const suggested = optimizeResult.tagsToRemove;
            console.log(`[executeImageGeneration] AI 建议删除: [${suggested.map(t => t.text).join(', ')}]`);

            // 存在性过滤：仅移除 mergedTraits 中实际存在的标签（大小写不敏感）
            const mergedTextsLower = new Set(mergedTraits.map(t => t.text.trim().toLowerCase()));
            const validRemovals = suggested.filter(s => mergedTextsLower.has(s.text.trim().toLowerCase()));

            // 过度删除防护：AI 返回删除列表覆盖 >80% 标签时拒绝执行
            const removalRatio = validRemovals.length / mergedTraits.length;
            if (removalRatio > 0.8) {
              console.warn(`[executeImageGeneration] AI 优化返回过度删除（${validRemovals.length}/${mergedTraits.length}），已跳过`);
              aiOptimizationStatus = 'no-removal';
            } else if (validRemovals.length > 0) {
              // 执行过滤：从 mergedTraits 中移除被删除的标签（保留 categoryId 等字段不丢失）
              const removalTextsLower = new Set(validRemovals.map(r => r.text.trim().toLowerCase()));
              const filteredTraits = mergedTraits.filter(t => !removalTextsLower.has(t.text.trim().toLowerCase()));
              console.log(`[executeImageGeneration] 实际过滤: [${validRemovals.map(t => t.text).join(', ')}]，剩余 ${filteredTraits.length}/${mergedTraits.length} 标签`);
              mergedTraits.splice(0, mergedTraits.length, ...filteredTraits);
              removedTags = validRemovals;
              aiOptimizationStatus = 'success';
            } else {
              // AI 返回空列表或建议标签均不在合并列表中（存在性过滤后为空）
              aiOptimizationStatus = 'no-removal';
            }
          } else if (optimizeResult && !optimizeResult.success) {
            console.warn(`[executeImageGeneration] AI 标签优化失败: ${optimizeResult.error}，跳过优化`);
            aiOptimizationStatus = 'failed';
            aiOptimizationError = optimizeResult.error;
          }

          // 【Spec: add-ai-tag-supplement-after-removal / Task 3】AI 标签补充处理
          // 在 tagsToRemove 处理之后执行，将 AI 建议补充的标签合并到 mergedTraits。
          // 防御性设计：去重 + 冲突检查（不补充刚删除的标签）+ 过度补充防护（>50% 拒绝）。
          // 注意：此时 mergedTraits 已经被 splice 过（删除已执行），所以是删除后的状态。
          if (optimizeResult?.success && Array.isArray(optimizeResult.tagsToAdd) && optimizeResult.tagsToAdd.length > 0) {
            console.log(`[executeImageGeneration] AI 建议补充: [${optimizeResult.tagsToAdd.map(t => t.text).join(', ')}]`);

            // SubTask 3.1: 去重检查 — 跳过已存在于 mergedTraits 中的标签（大小写不敏感）
            const existingTextsLower = new Set(mergedTraits.map(t => t.text.trim().toLowerCase()));
            // SubTask 3.2: 冲突检查 — 跳过在 tagsToRemove（刚被删除）中的标签
            // 兜底执行 service 层 IMPORTANT RULES 第 7 条（AI 偶发不遵守规则时的安全网）
            const removedTextsLower = new Set(removedTags.map(r => r.text.trim().toLowerCase()));

            const validAdditions = optimizeResult.tagsToAdd.filter(s => {
              const textLower = s.text.trim().toLowerCase();
              if (existingTextsLower.has(textLower)) {
                console.log(`[executeImageGeneration] 补充标签 ${s.text} 已存在，跳过`);
                return false;
              }
              if (removedTextsLower.has(textLower)) {
                console.warn(`[executeImageGeneration] 补充标签 ${s.text} 与刚删除的标签冲突，拒绝添加`);
                return false;
              }
              return s.text.trim().length > 0;
            });

            // SubTask 3.3: 过度补充防护 — 补充标签数 > 50% mergedTraits 时拒绝执行
            if (validAdditions.length > 0) {
              const additionRatio = validAdditions.length / mergedTraits.length;
              if (additionRatio > 0.5) {
                console.warn(`[executeImageGeneration] AI 优化返回过度补充（${validAdditions.length}/${mergedTraits.length}），已跳过补充`);
              } else {
                // SubTask 3.4: 将有效补充标签加入 mergedTraits（保留 weight / categoryId 供后续权重提升使用）
                const additionsToMerge = validAdditions.map(s => ({
                  text: s.text.trim(),
                  weight: s.weight,
                  categoryId: s.categoryId,
                }));
                mergedTraits.push(...additionsToMerge);

                // SubTask 3.5: 构建 addedTags 快照（用于 ImageHistoryItem 持久化与 UI 展示）
                addedTags = validAdditions.map(s => ({
                  text: s.text.trim(),
                  reason: s.reason,
                }));

                // 有实际补充操作时，将状态提升为 success（覆盖 no-removal；failed 不会进入此分支）
                aiOptimizationStatus = 'success';

                console.log(`[executeImageGeneration] 实际补充: [${addedTags.map(t => t.text).join(', ')}]，补充后 ${mergedTraits.length} 个标签`);
              }
            }
          }
        } catch (e) {
          console.warn('[executeImageGeneration] AI 标签优化调用异常，降级为不优化:', e);
          aiOptimizationStatus = 'failed';
          aiOptimizationError = e instanceof Error ? e.message : String(e);
        }
      }

      // 【Spec: enhance-conversation-interaction-prompt-recognition】互动标签分类级权重提升
      // 互动标签（disembodied_hand / hugging_another 等）拼接位置靠后，角色特征标签较多时
      // 容易被图像模型忽略。对 categoryId === 'interaction' 的 trait 应用分类级权重提升：
      //   最终 weight = (per-tag weight ?? 1.0) × interaction_weight
      // 默认 1.2（用户可在 ConfigPanel 调整，范围 1.0-2.0），1.0 = 不提升。
      // 在渲染进程完成权重计算，applyTraitsAndLora（主进程）只看到最终 { text, weight }。
      const interactionWeight = characterConfig?.customParameters?.interaction_weight ?? 1.2;
      const finalTraits: Array<{ text: string; weight?: number }> = mergedTraits.map(t => {
        if (t.categoryId === 'interaction' && interactionWeight !== 1.0) {
          const baseWeight = t.weight ?? 1.0;
          const boostedWeight = Math.round(baseWeight * interactionWeight * 10) / 10;
          return { text: t.text, weight: boostedWeight };
        }
        return { text: t.text, weight: t.weight };
      });

      // === 阶段 3: 图片生成（切换 phase 为 image-generating，Task 9.2）===
      await updateImageAttachment(messageId, (prev) => prev ? { ...prev, phase: 'image-generating' } : prev);

      // 6. 加载 SD 配置
      let sdConfig: any = {};
      try {
        const settingResult = await window.electronAPI.setting.load();
        if (settingResult?.success && settingResult.setting?.sdWebui) {
          sdConfig = settingResult.setting.sdWebui;
        }
      } catch (e) {
        console.warn('[CharacterDialogueChat] 加载 SD 设置失败:', e);
      }

      const endpoint = sdConfig.endpoint || '';
      if (!endpoint) {
        message.error('SD WebUI 未配置，请先在设置中配置端点');
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: 'SD WebUI 未配置'
        } : prev);
        return;
      }

      // 7. 检测 SD WebUI 状态
      try {
        const statusResult = await window.electronAPI.sd.checkStatus(endpoint);
        if (!statusResult?.available) {
          message.error('SD WebUI 未连接，请检查服务状态');
          await updateImageAttachment(messageId, (prev) => prev ? {
            ...prev, status: 'error', phase: 'error', errorMessage: 'SD WebUI 未连接'
          } : prev);
          return;
        }
      } catch {
        message.error('SD WebUI 连接失败，请检查服务状态');
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: 'SD WebUI 连接失败'
        } : prev);
        return;
      }

      // 8. 构建提示词模板（复用 general 模式模板）
      const promptTemplate = buildAssetPromptTemplate('general', null);
      const negativePrompt = sdConfig.negativePrompt || 'deformed, ugly, bad_anatomy, bad_hands, missing_fingers, extra_digits, low_quality, worst_quality, normal_quality, jpeg_artifacts, blurry, watermark';

      // 9. 构建图片尺寸（从配置读取，默认 1024×1024）
      const imgWidth = characterConfig?.customParameters?.image_gen_width || 1024;
      const imgHeight = characterConfig?.customParameters?.image_gen_height || 1024;

      // 10. 构建 SD options（复用共享函数，Spec: fix-conversation-image-generation-bugs / Bug 5）
      const currentLoras = useCharacterLoraStore.getState().loras;
      const sdOptions = buildSdOptionsFromConfig({
        sdConfig,
        // 【Spec: enhance-conversation-interaction-prompt-recognition】
        // 传 finalTraits（已对 interaction 分类应用分类级权重提升），而非 mergedTraits
        enabledTraitTexts: finalTraits,
        // 【Spec: enhance-conversation-image-auditability / Task 10.3】
        // effectiveTraits 跟随 currentTraits（已优先 sessionTraits），保证临时编辑生效到 SD 生成
        effectiveTraits: currentTraits,
        characterLoras: currentLoras,
        selectedSize: { width: imgWidth, height: imgHeight },
        selectedCameraAngle: undefined,
      });

      // 【Spec: enhance-conversation-image-auditability / Task 3】来源标识，落盘日志可据此关联对话消息
      sdOptions.sourceContext = {
        source: 'conversation',
        messageId,
        characterCardId: characterInfo.characterCardId,
        round: (parentMsg.imageAttachment?.history?.length || 0) + 1,
      };

      // 11. 调用 SD 生成
      const sdResult = await window.electronAPI.sd.generateTxt2Img({
        endpoint,
        prompt: promptTemplate,
        negativePrompt,
        options: sdOptions,
      });

      if (sdResult?.success && sdResult.imageBase64) {
        const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';
        const dataUrl = sdResult.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
          ? sdResult.imageBase64
          : PNG_DATA_URI_PREFIX + sdResult.imageBase64;

        // 保存图片到磁盘（复用原 addImageMessage 中的 asset:save 逻辑，Spec: fix-conversation-image-generation-bugs / Bug 4）
        const assetId = `conv_${Date.now()}`;
        let savedAssetId = assetId;
        try {
          const saveResult = await window.electronAPI.asset.save({
            characterCardId: characterInfo.characterCardId,
            assetType: 'general',
            assetId,
            imageBase64: dataUrl,
          });
          if (!saveResult?.success) {
            // 保存失败，回退用 dataUrl 作为 assetId（仅当前会话可用，无法持久化历史）
            savedAssetId = dataUrl;
          }
        } catch (e) {
          savedAssetId = dataUrl;
        }

        // 更新 imageAttachment：追加 history，更新 currentIndex 和 currentAssetId，status='idle'（Task 9.3 / 9.4）
        await updateImageAttachment(messageId, (prev) => {
          if (!prev) return prev;
          // 【Spec: enhance-conversation-image-auditability / Task 4】快照本次生成使用的标签与提示词
          // - usedTags：合并去重后的完整 traits 数组（角色特征 + 上下文 tag）
          // - usedPrompt：主进程 applyTraitsAndLora 处理后的最终 prompt 字符串
          // - usedNegativePrompt：本次使用的负面提示词
          // - usedLoras：本次使用的 LoRA 列表（仅保留 name/weight，避免持久化冗余字段）
          const newHistoryItem: ImageHistoryItem = {
            assetId: savedAssetId,
            createdAt: Date.now(),
            // 【Spec: enhance-conversation-interaction-prompt-recognition】
            // usedTags 快照使用 finalTraits（含互动标签权重提升后的值），与 usedPrompt 保持一致
            usedTags: finalTraits,
            usedPrompt: sdResult?.finalPrompt,
            usedNegativePrompt: negativePrompt,
            usedLoras: currentLoras.map(l => ({ name: l.name, weight: l.weight })),
            // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化删除的标签列表
            removedTags: removedTags.length > 0 ? removedTags : undefined,
            // 【Spec: add-ai-tag-supplement-after-removal / Task 3】AI 标签优化补充的标签列表
            // 与 removedTags 对称：仅当 AI 实际补充了标签时存在，供标签快照面板展示「AI 已补充」分区
            addedTags: addedTags.length > 0 ? addedTags : undefined,
            // 【Spec: add-ai-trait-optimization-for-image-gen / 反馈可见性修复】
            // AI 优化执行状态元数据：仅当本次生成启用了 ai_optimize_traits 时写入，
            // 记录 success/no-removal/failed 三态，供标签快照面板无论是否删除标签都给出明确反馈。
            // 未启用 AI 优化时为 undefined（不渲染分区，与原行为一致）。
            // 【Spec: add-ai-tag-supplement-after-removal / Task 3】新增 addedCount（与 removedCount 对称）
            aiOptimization: aiOptimizeEnabled ? {
              status: aiOptimizationStatus,
              removedCount: removedTags.length,
              addedCount: addedTags.length,
              error: aiOptimizationError,
            } : undefined,
          };
          const newHistory = [...prev.history, newHistoryItem];
          return {
            ...prev,
            currentAssetId: savedAssetId,
            history: newHistory,
            currentIndex: newHistory.length - 1,
            status: 'idle',
            phase: undefined,
            errorMessage: undefined,
          };
        });
        message.success(isRegenerate ? '图片重新生成成功' : '图片生成成功');
      } else {
        // 生成失败（Task 9.5：设 status='error', errorMessage，保留占位供重试）
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: sdResult?.error || '图片生成失败'
        } : prev);
        message.error(sdResult?.error || '图片生成失败');
      }
    } catch (e) {
      console.error('[CharacterDialogueChat] executeImageGeneration error:', e);
      await updateImageAttachment(messageId, (prev) => prev ? {
        ...prev, status: 'error', phase: 'error', errorMessage: e instanceof Error ? e.message : '生成失败'
      } : prev);
      message.error(e instanceof Error ? e.message : '图片生成失败');
    } finally {
      setIsGeneratingImage(false);
      generatingMessageIdRef.current = null;
    }
  }, [stateWithVersionInfo.messages, characterInfo.characterCardName, characterInfo.characterCardId, traitStoreCardId, loadStoreTraits, loadCharacterLoras, characterConfig, updateImageAttachment]);

  // 首次生成（文本气泡「生成图片」按钮调用）（Spec: enhance-conversation-image-bubble / Task 9.1）
  const handleGenerateImage = useCallback(async (messageId: string) => {
    if (isGeneratingImage) return;
    await executeImageGeneration(messageId, false);
  }, [isGeneratingImage, executeImageGeneration]);

  // 重新生成（图片区域「重新生成」按钮调用）（Spec: enhance-conversation-image-bubble / Task 9.1）
  // 导出供 Task 11 接线（ChatMessageBubble onRegenerateImage prop）
  const handleRegenerateImage = useCallback(async (messageId: string) => {
    if (isGeneratingImage) return;
    await executeImageGeneration(messageId, true);
  }, [isGeneratingImage, executeImageGeneration]);

  // 图片生成开关切换（Spec: add-conversation-image-generation）
  const handleImageGenToggle = useCallback((enabled: boolean) => {
    handleParameterChange({ image_gen_enabled: enabled });
  }, [handleParameterChange]);

  // 图片大小变更（Spec: add-conversation-image-generation）
  const handleImageGenSizeChange = useCallback((width: number, height: number) => {
    handleParameterChange({ image_gen_width: width, image_gen_height: height });
  }, [handleParameterChange]);

  // 互动标签权重变更（Spec: enhance-conversation-interaction-prompt-recognition）
  // 互动标签（disembodied_hand / hugging_another 等）拼接位置靠后，角色特征较多时容易被图像模型忽略，
  // 通过分类级权重提升加强。默认 1.2，范围 1.0-2.0，1.0 = 不提升。
  const handleInteractionWeightChange = useCallback((weight: number) => {
    // 兜底范围校验：限制在 1.0-2.0，保留 1 位小数
    const clamped = Math.min(2.0, Math.max(1.0, Math.round(weight * 10) / 10));
    handleParameterChange({ interaction_weight: clamped });
  }, [handleParameterChange]);

  // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化试验性功能开关
  // 开启后图片生成前 AI 会分析角色特征与对话上下文的矛盾，自动删除不再适用的标签
  const handleAiOptimizeTraitsToggle = useCallback((enabled: boolean) => {
    handleParameterChange({ ai_optimize_traits: enabled });
  }, [handleParameterChange]);

  // 命令面板命令列表
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [];

    // 导航类
    items.push({
      key: 'nav-clear',
      label: '清空对话',
      description: '清除所有消息',
      category: 'navigation',
      shortcut: '',
      onExecute: () => clearChat(),
    });
    items.push({
      key: 'nav-fullscreen',
      label: isFullscreen ? '退出全屏' : '进入全屏',
      category: 'navigation',
      onExecute: () => setIsFullscreen(prev => !prev),
    });
    items.push({
      key: 'nav-export-copy',
      label: '导出对话 - 复制到剪贴板',
      category: 'navigation',
      onExecute: () => handleExportMenuClick('copy'),
    });
    items.push({
      key: 'nav-export-save',
      label: '导出对话 - 保存为文件',
      category: 'navigation',
      onExecute: () => handleExportMenuClick('save'),
    });

    // 操作类
    items.push({
      key: 'action-retry',
      label: '重新生成',
      description: '重试上一条 AI 回复',
      category: 'actions',
      onExecute: () => {
        const lastAssistantMsg = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistantMsg) {
          retryMessage(lastAssistantMsg.id);
        }
      },
    });
    items.push({
      key: 'action-continue',
      label: '继续生成',
      description: '续写上一条 AI 回复',
      category: 'actions',
      onExecute: () => continueConversation(),
    });
    items.push({
      key: 'action-polish',
      label: '润色输入',
      description: '润色当前输入框文本',
      category: 'actions',
      onExecute: () => {
        message.info('请在输入框中输入文本后点击润色按钮');
      },
    });
    items.push({
      key: 'action-ai-reply',
      label: 'AI 回复',
      description: '以当前用户人设生成对话回复',
      category: 'actions',
      onExecute: () => handleGenerateUserReply(),
    });

    // 设置类
    items.push({
      key: 'settings-params',
      label: '参数设置',
      description: '打开参数面板',
      category: 'settings',
      onExecute: () => {
        const panel = document.querySelector('[data-config-panel]') as HTMLElement;
        if (panel) panel.scrollIntoView({ behavior: 'smooth' });
      },
    });

    return items;
  }, [clearChat, isFullscreen, handleExportMenuClick, retryMessage, continueConversation, handleGenerateUserReply, stateWithVersionInfo.messages]);

  if (!open && !isFullscreen) return null;

  const fullscreenStyles = isFullscreen ? {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 9999,
    margin: 0,
    borderRadius: 0,
  } : {};

  const showSelectorPanel = characters && characters.length > 0 && onCharacterSelect;

  // 消息气泡渲染函数（复用 ChatMessageList 的 renderMessage 回调）
  const renderMessageBubble = (msg: any, index: number) => {
    // 计算 AI 回复序号：在当前消息之前所有 role=assistant 且非图片消息的数量 + 1
    const aiSequenceNumber = msg.role === 'assistant' && !msg.isImageMessage
      ? stateWithVersionInfo.messages.slice(0, index).filter(m => m.role === 'assistant' && !m.isImageMessage).length + 1
      : 0;
    return (
      <ChatMessageBubble
        key={msg.id}
        message={msg}
        characterName={characterInfo.characterCardName}
        userName={selectedPersona?.name || 'User'}
        avatarPath={avatarPath}
        expressionImage={
          msg.role === 'assistant' &&
          !(stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1)
            ? resolveExpressionImage(msg.emotion || 'default') ?? undefined
            : undefined
        }
        onRetry={retryMessage}
        onRetryFromVersion={retryMessageFromVersion}
        onContinue={handleContinueConversation}
        onEdit={editMessage}
        onRollback={handleRollback}
        isLastMessage={index === stateWithVersionInfo.messages.length - 1}
        isStreaming={stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant'}
        isGenerating={stateWithVersionInfo.isLoading && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant' && msg.status === 'sending'}
        onSelectOption={handleSelectOption}
        aiSequenceNumber={aiSequenceNumber}
        showThinking={deriveThinkTagMode(characterConfig?.customParameters) === 'fold'}
        imageGenEnabled={imageGenEnabled}
        isGeneratingImage={isGeneratingImage}
        onGenerateImage={handleGenerateImage}
        characterCardId={characterInfo.characterCardId}
        // 图片附件管理回调（Spec: enhance-conversation-image-bubble / Task 11.2 接线）
        // - onRegenerateImage：图片区域「重新生成」按钮（Task 9.1 handleRegenerateImage）
        // - onDeleteImage：图片区域「删除」按钮（Task 10.3 deleteImageAttachment）
        // - onNavigateImage：历史导航「上一张/下一张」（Task 10.4 navigateImageHistory）
        // - resolveExpressionImage：按 emotion 解析立绘（Task 11.2 接线）
        //   包装原因：store 签名 (string|null|undefined)=>string|null 与 prop 签名 (string)=>string|undefined 不兼容，
        //   故用 (emotion) => resolveExpressionImage(emotion) ?? undefined 将 null 转为 undefined。
        //   【重点标记 - 反复修复】原实现仅在 message.imageAttachment 存在时传递（条件传递），
        //   导致无图片附件的纯文本 AI 消息无法通过 resolveExpressionImage prop 解析 emotion。
        //   虽有 expressionImage prop 兜底，但始终传递 resolveExpressionImage 更可靠，
        //   确保 ChatMessageBubble 内 effectiveExpressionImage useMemo 可直接调用 store 解析器。
        //   详见 docs/FIX_RECORDS.md §7.26
        onRegenerateImage={handleRegenerateImage}
        onDeleteImage={deleteImageAttachment}
        onNavigateImage={navigateImageHistory}
        resolveExpressionImage={(emotion: string) => resolveExpressionImage(emotion) ?? undefined}
      />
    );
  };

  return (
    <Modal
      open={open && !isFullscreen}
      onCancel={onClose}
      footer={null}
      width={isFullscreen ? '100vw' : (showSelectorPanel ? 1800 : 1600)}
      centered={!isFullscreen}
      closable={false}
      styles={{
        body: {
          padding: 0,
          height: isFullscreen ? '100vh' : '85vh',
          minHeight: '600px',
          display: 'flex',
          flexDirection: 'row',
          borderRadius: isFullscreen ? 0 : '16px',
          overflow: 'hidden',
          background: 'var(--chat-dialog-bg-gradient, linear-gradient(135deg, #1e1e2e 0%, #2d2b42 50%, #1e1e2e 100%))',
          transition: 'background 0.3s ease',
          ...fullscreenStyles,
        },
        mask: {
          backdropFilter: 'blur(8px)',
          background: 'rgba(0, 0, 0, 0.6)',
        },
        header: {
          padding: 0,
        },
        wrapper: isFullscreen ? { padding: 0, maxWidth: '100%' } : {},
      }}
    >

      {showSelectorPanel && (
        <CharacterSelectorPanel
          characters={characters}
          selectedCharacterPath={characterInfo.characterCardId}
          onSelect={handleCharacterSelectWithFavorite}
          favoritePaths={favoritePaths}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <div className="chat-area" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: isFullscreen ? (showSelectorPanel ? '65%' : '70%') : undefined,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div className="chat-area-bg">
          <div className="chat-bg-orb" />
          <div className="chat-bg-orb" />
          <div className="chat-bg-orb" />
        </div>
        <div className="chat-bg-grid" />
        <ChatHeader
          characterName={characterInfo.characterCardName}
          characterCardContent={characterInfo.characterCardContent}
          messageCount={stateWithVersionInfo.messages.length}
          onClear={handleClearChat}
          onClose={isFullscreen ? handleToggleFullscreen : onClose}
          exportMenu={EXPORT_MENU_ITEMS}
          onExportMenuClick={handleExportMenuClick}
          characters={characters}
          onQuickSwitchCharacter={handleQuickSwitchCharacter}
          avatarPath={avatarPath}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          selectedPersona={selectedPersona}
          isFavorite={isFavorite(characterInfo.characterCardId)}
          onToggleFavorite={handleToggleFavorite}
          onOpenExpressionManager={() => setExpressionManagerOpen(true)}
        />

        <div
          ref={chatContainerRef}
          className="chat-messages"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: isFullscreen ? '32px 40px' : '20px',
            position: 'relative',
          }}
          onScroll={handleScroll}
        >
          {stateWithVersionInfo.messages.length === 0 && !stateWithVersionInfo.isStreaming && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--chat-empty-text-secondary, #9ca3af)',
              textAlign: 'center',
            }}>
              <div style={{
                width: isFullscreen ? '120px' : '80px',
                height: isFullscreen ? '120px' : '80px',
                borderRadius: '50%',
                background: 'var(--chat-empty-icon-bg, linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px',
                boxShadow: 'var(--chat-empty-shadow, 0 8px 32px rgba(139, 92, 246, 0.4))',
              }}>
                <span style={{ fontSize: isFullscreen ? '48px' : '36px', color: '#fff', fontWeight: 'bold' }}>
                  {characterInfo.characterCardName.charAt(0).toUpperCase()}
                </span>
              </div>
              <h3 style={{
                margin: '0 0 12px 0',
                fontSize: isFullscreen ? '24px' : '20px',
                fontWeight: 600,
                color: 'var(--chat-empty-text-primary, #1a1a2e)',
              }}>
                开始与 {characterInfo.characterCardName} 对话
              </h3>
              <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6 }}>
                发送消息开始对话，<br />
                AI 将根据角色设定进行回复。
              </p>
            </div>
          )}

          <ChatMessageList
            mode="character"
            enableVirtualization={true}
            messages={stateWithVersionInfo.messages}
            scrollElementRef={chatContainerRef}
            renderMessage={renderMessageBubble}
          />

          {stateWithVersionInfo.isStreaming && stateWithVersionInfo.messages[stateWithVersionInfo.messages.length - 1]?.role === 'user' && (
            <ChatTypingIndicator
              characterName={characterInfo.characterCardName}
              avatarPath={avatarPath}
            />
          )}

          {state.error && (
            <div style={{
              textAlign: 'center',
              padding: '12px',
              marginBottom: '16px',
              background: 'var(--chat-error-bg, rgba(239, 68, 68, 0.1))',
              border: '1px solid var(--chat-error-border, rgba(239, 68, 68, 0.3))',
              borderRadius: '8px',
              color: 'var(--chat-error-color, #ef4444)',
              fontSize: '13px',
            }}>
              {state.error}
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8 }}>
                {/* Task 21: 错误恢复 UI —— 重试上一条用户消息 */}
                {(() => {
                  const lastUserMsg = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'user');
                  const lastAssistantMsg = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
                  if (lastAssistantMsg) {
                    return (
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => {
                          clearError();
                          retryMessage(lastAssistantMsg.id);
                        }}
                      >
                        重试
                      </Button>
                    );
                  }
                  if (lastUserMsg) {
                    return (
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => {
                          clearError();
                          sendMessage(lastUserMsg.content);
                        }}
                      >
                        重试
                      </Button>
                    );
                  }
                  return null;
                })()}
                {/* Task 21: 错误恢复 UI —— 关闭错误提示 */}
                <Button size="small" onClick={clearError}>关闭</Button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />

          {showScrollButton && (
            <Tooltip title="滚动到底部">
              <Button
                type="primary"
                size="small"
                shape="circle"
                icon={<span style={{ fontSize: '12px' }}>↓</span>}
                onClick={scrollToBottom}
                style={{
                  position: 'absolute',
                  bottom: '16px',
                  right: '16px',
                  background: 'var(--chat-bubble-user-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))',
                  border: 'none',
                  boxShadow: 'var(--chat-bubble-user-shadow, 0 4px 12px rgba(99, 102, 241, 0.4))',
                  animation: 'pulse 2s infinite',
                }}
              />
            </Tooltip>
          )}
        </div>

        {isOrganizing && (
          <div style={{
            padding: '8px 16px',
            background: 'var(--chat-organizing-bg, linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.1) 100%))',
            borderBottom: '1px solid var(--chat-organizing-border, rgba(251, 191, 36, 0.3))',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--chat-organizing-color, #fbbf24)',
          }}>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--chat-organizing-dot, #fbbf24)',
              animation: 'pulse 1.5s infinite',
            }} />
            <span>正在整理记忆表格，请稍候...</span>
          </div>
        )}

        <ChatInputBar
          onSend={sendMessage}
          onCancel={cancelRequest}
          onStopOrganizing={handleStopOrganizing}
          disabled={isOrganizing}
          isStreaming={state.isStreaming}
          isOrganizing={isOrganizing}
          placeholder={isOrganizing ? '表格整理中，请稍后...' : `Message ${characterInfo.characterCardName}...`}
          onGenerateUserReply={handleGenerateUserReply}
          isGeneratingUserReply={isGeneratingUserReply}
          generatedReplyText={generatedReplyText}
          onGeneratedReplyTextConsumed={handleGeneratedReplyTextConsumed}
          userReplyPerson={characterConfig?.userReplyPerson}
          onUserReplyPersonChange={handleUserReplyPersonChange}
          onPolishInput={handlePolishInput}
          isPolishingInput={isPolishingInput}
          polishFlashKey={polishFlashKey}
          onRetry={() => {
            const lastAssistant = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
            if (lastAssistant) retryMessage(lastAssistant.id);
          }}
          onContinue={continueConversation}
          onClear={clearChat}
          onReset={clearChat}
          quickActionItems={{
            dialogueActions: [
              {
                key: 'qa-retry',
                label: '重新生成',
                shortcut: '',
                disabled: isGeneratingUserReply || isPolishingInput,
                onClick: () => {
                  const lastAssistant = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
                  if (lastAssistant) retryMessage(lastAssistant.id);
                },
              },
              {
                key: 'qa-continue',
                label: '继续生成',
                shortcut: '',
                disabled: isGeneratingUserReply || isPolishingInput,
                onClick: continueConversation,
              },
              {
                key: 'qa-ai-reply',
                label: 'AI 回复',
                shortcut: '',
                disabled: isGeneratingUserReply || isPolishingInput,
                onClick: () => handleGenerateUserReply(),
              },
            ],
            contentActions: [
              {
                key: 'qa-polish',
                label: '润色输入',
                shortcut: '',
                disabled: isGeneratingUserReply || isPolishingInput,
                onClick: () => handlePolishInput(''),
              },
              {
                key: 'qa-compress',
                label: '上下文压缩',
                shortcut: '',
                disabled: isCompressing,
                onClick: compressContext,
              },
              {
                key: 'qa-export',
                label: '导出对话',
                shortcut: '',
                onClick: () => handleExportMenuClick('copy'),
              },
            ],
            settingActions: [
              {
                key: 'qa-fullscreen',
                label: isFullscreen ? '退出全屏' : '全屏',
                shortcut: '',
                onClick: () => setIsFullscreen(prev => !prev),
              },
              {
                key: 'qa-clear',
                label: '清空对话',
                shortcut: '',
                onClick: clearChat,
              },
            ],
          }}
          tokenUsage={tokenUsage}
          onCompressContext={compressContext}
          isCompressing={isCompressing}
        />
      </div>

      <ConfigPanel
        characterCardId={characterInfo.characterCardId}
        characterCardName={characterInfo.characterCardName}
        selectedPersonaId={characterConfig?.selectedPersonaId}
        effectiveParams={effectiveParams}
        customParameters={characterConfig?.customParameters}
        personas={personas}
        personasLoading={personasLoading}
        boundKnowledgeBaseIds={characterConfig?.boundKnowledgeBaseIds || []}
        memoryTableEnabled={memoryTableEnabled}
        memoryTableAutoOrganize={memoryTableAutoOrganize}
        memoryTableOrganizeMode={memoryTableOrganizeMode}
        memoryTableTemplateId={memoryTableTemplateId}
        memoryTableTemplateName={memoryTableTemplateName}
        tokenManagementConfig={tokenManagementConfig}
        customStopSequencesEnabled={characterConfig?.customStopSequencesEnabled ?? false}
        customStopSequences={characterConfig?.customStopSequences}
        thinkTagMode={deriveThinkTagMode(characterConfig?.customParameters)}
        onThinkTagModeChange={(mode) => handleParameterChange({ think_tag_mode: mode })}
        assistMode={characterConfig?.customParameters?.assist_mode === true}
        onAssistModeToggle={(enabled) => handleParameterChange({ assist_mode: enabled })}
        language={characterConfig?.customParameters?.language ?? 'zh'}
        onLanguageChange={(lang) => handleParameterChange({ language: lang })}
        engineCapabilities={engineCapabilities}
        onPersonaChange={handlePersonaChange}
        onParameterChange={handleParameterChange}
        onResetParameters={handleResetParameters}
        onCustomStopSequencesToggle={handleCustomStopSequencesToggle}
        onCustomStopSequencesChange={handleCustomStopSequencesChange}
        onBindKnowledgeBase={bindKnowledgeBase}
        onUnbindKnowledgeBase={unbindKnowledgeBase}
        onMemoryTableToggle={handleMemoryTableToggle}
        onMemoryTableAutoOrganizeToggle={handleMemoryTableAutoOrganizeToggle}
        onMemoryTableOrganizeModeChange={handleMemoryTableOrganizeModeChange}
        onMemoryTableTemplateAssociate={handleMemoryTableTemplateAssociate}
        onTokenManagementConfigChange={handleTokenManagementConfigChange}
        onSaveConfig={saveConfig}
        imageGenEnabled={imageGenEnabled}
        imageGenWidth={characterConfig?.customParameters?.image_gen_width}
        imageGenHeight={characterConfig?.customParameters?.image_gen_height}
        onImageGenToggle={handleImageGenToggle}
        onImageGenSizeChange={handleImageGenSizeChange}
        // 【Spec: enhance-conversation-interaction-prompt-recognition】互动标签权重提升
        interactionWeight={characterConfig?.customParameters?.interaction_weight ?? 1.2}
        onInteractionWeightChange={handleInteractionWeightChange}
        // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化试验性功能
        aiOptimizeTraits={characterConfig?.customParameters?.ai_optimize_traits === true}
        onAiOptimizeTraitsToggle={handleAiOptimizeTraitsToggle}
      />

      {/* 素材管理弹窗（Spec: add-asset-and-trait-management / Task 11） */}
      {/* 【重点标记 - BREAKING UI 变更】原 ExpressionManagerModal 替换为 AssetManagerModal，
          支持表情/立绘/一般图像/三视图/角色特征多 Tab 管理。
          characterDescription 传 characterCardContent（即角色卡 description 字段）。 */}
      <AssetManagerModal
        open={expressionManagerOpen}
        characterCardId={characterInfo.characterCardId}
        characterName={characterInfo.characterCardName}
        characterDescription={characterInfo.characterCardContent || ''}
        characterPersonality={characterInfo.personality}
        characterScenario={characterInfo.scenario}
        avatarPath={avatarPath}
        onClose={() => setExpressionManagerOpen(false)}
      />

      {/* 命令面板（Ctrl+K） */}
      <CommandPalette
        visible={commandPaletteVisible}
        onClose={() => setCommandPaletteVisible(false)}
        items={commandPaletteItems}
      />
    </Modal>
  );
};

export default CharacterDialogueChat;
