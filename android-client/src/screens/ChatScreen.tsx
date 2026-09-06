/**
 * 对话页（Spec: add-android-chat-client / R5 + fix-android-chat-feature-parity / Task 7-9）
 *
 * 历史加载、SSE 流式逐字更新、情绪立绘切换（失败回退头像）、清空上下文、失败重试；
 * V2 新增：会话配置弹层、图片气泡（生成/重生成/历史切换/全屏）、记忆表格查看、table 事件提示；
 * V3 新增：思考内容三态渲染（不显示/仅保留/折叠查看 + 流式思考面板）、
 *         辅助模式推荐选项（点击填入输入框，可编辑后发送）、亮暗主题适配；
 * V5（fix-android-chat-interaction-parity）：气泡样式对齐 PC 端 CSS 基准
 *         （圆角 18/小角 4/内边距 16,12/名字行+情绪标签+序号徽章/文本可选中）、
 *         头像点击全屏查看（AvatarViewer 捏合缩放）、消息操作按钮行
 *         （复制/重新生成/卷回到输入框，服务端 rollback 接口截断历史）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Platform,
  Image,
  Text as RNText,
  Keyboard,
  useWindowDimensions,
  Pressable,
  Animated,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import {
  Appbar,
  TextInput,
  IconButton,
  ActivityIndicator,
  Button,
  Dialog,
  Portal,
  Text,
  Snackbar,
} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  assetUrl,
  clearChat,
  fetchChatHistory,
  fetchExpressions,
  fetchPersonas,
  generateImage,
  getSessionConfig,
  rollbackChat,
} from '../api/client';
import { sendMessageStream, type StreamHandle } from '../api/sse';
import { useAppStore } from '../store';
import { themeOf, type Palette } from '../theme';
import type { ChatMessage, ExpressionEntry, ImageAttachment } from '../types';
import { emotionLabel } from '../types';
import { SessionConfigSheet } from '../components/SessionConfigSheet';
import { MemoryTableSheet } from '../components/MemoryTableSheet';
import { ImageBubble } from '../components/ImageBubble';
import { AvatarViewer } from '../components/AvatarViewer';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

let localIdSeed = 0;
function localId(prefix: string): string {
  localIdSeed += 1;
  return `local-${prefix}-${Date.now()}-${localIdSeed}`;
}

/** 思考标签拆分：从内容中提取全部 <think> 块（合并）并返回剥离后正文 */
const THINK_TAG_REGEX = /<think>([\s\S]*?)<\/think>/gi;
export function splitThink(content: string): { reasoning: string; body: string } {
  let reasoning = '';
  const body = content.replace(THINK_TAG_REGEX, (_m: string, inner: string) => {
    reasoning += (reasoning ? '\n' : '') + inner;
    return '';
  });
  return { reasoning: reasoning.trim(), body: body.trim() };
}

/** 思考折叠面板：流式期间默认展开并滚动显示，完成后收起，可点击切换 */
function ThinkingPanel({
  text,
  streamingThink,
  palette,
  styles,
}: {
  text: string;
  streamingThink: boolean;
  palette: Palette;
  styles: ReturnType<typeof createStyles>;
}) {
  const [expanded, setExpanded] = useState(streamingThink);
  useEffect(() => {
    if (!streamingThink) setExpanded(false);
  }, [streamingThink]);
  return (
    <View style={styles.thinkWrap}>
      <Pressable style={styles.thinkHeader} onPress={() => setExpanded(v => !v)}>
        <RNText style={styles.thinkToggle}>{expanded ? '▾' : '▸'}</RNText>
        <RNText style={styles.thinkLabel}>
          思考过程{streamingThink ? '（思考中…）' : ''}
        </RNText>
        {streamingThink && (
          <ActivityIndicator animating size="small" color={palette.primary} />
        )}
      </Pressable>
      {expanded && text.length > 0 && (
        <RNText style={styles.thinkBody} selectable>
          {text}
        </RNText>
      )}
    </View>
  );
}

export function ChatScreen() {
  const baseUrl = useAppStore(s => s.baseUrl)!;
  const character = useAppStore(s => s.activeCharacter)!;
  const backToList = useAppStore(s => s.backToList);
  const themeMode = useAppStore(s => s.themeMode);
  const { palette } = themeOf(themeMode);

  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [emotion, setEmotion] = useState<string>('default');
  const [expressionFailed, setExpressionFailed] = useState(false);
  const [clearDialogVisible, setClearDialogVisible] = useState(false);
  const [clearing, setClearing] = useState(false);

  // V2：会话配置入口 / 表格查看 / 提示条
  const [configSheetVisible, setConfigSheetVisible] = useState(false);
  const [tableSheetVisible, setTableSheetVisible] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [imageGenEnabled, setImageGenEnabled] = useState(false);
  /** 正在生成图片的消息 id 集合（客户端 pending 态） */
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());

  // V3：思考内容处理模式（从服务端会话配置读取；渲染时按模式剥离/折叠 <think>）
  const [thinkTagMode, setThinkTagMode] = useState<'strip' | 'strip_render' | 'fold'>('strip');

  // V5：persona（用户名显示 + 用户头像）；头像全屏查看器
  const [personaName, setPersonaName] = useState<string>('User');
  const [personaAvatar, setPersonaAvatar] = useState<string | null>(null);
  const [avatarViewerUrl, setAvatarViewerUrl] = useState<string | null>(null);

  // L2：edge-to-edge 下手动键盘避让（RN 0.87 默认开启 edge-to-edge，adjustResize 失效）
  const [kbHeight, setKbHeight] = useState(0);

  const streamRef = useRef<StreamHandle | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 表情清单（判断情绪是否有对应立绘）
  const expressionKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', e =>
      setKbHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // L4：滚动到底节流（200ms），流式逐字输出不再高频跳动
  // L7（滚动强制跟底修复）：onContentSizeChange 在任何内容尺寸变化时触发
  // （图片加载、键盘避让重布局、FlatList windowing 单元挂载/卸载等），
  // 若无条件 scrollToBottom 会把正在上滑查看历史的用户强行拉回底部。
  // 对策（三层防护）：
  //   1) onContentSizeChange 仅在流式输出期间跟随（静态浏览历史时不滚）；
  //   2) isNearBottomRef：用户上滑离开底部（>80px）即暂停跟随，滚回底部恢复；
  //      注：Android Fabric 上 onScroll 的 contentSize.height 可能为 0（平台差异），
  //      用 lastContentHRef 缓存最近一次有效内容高度作回退；
  //   3) 主动调用（发送消息/历史加载完成）用 immediate=true 强制恢复跟随。
  const isNearBottomRef = useRef(true);
  const lastContentHRef = useRef(0);
  const NEAR_BOTTOM_THRESHOLD = 80;

  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const contentH = contentSize?.height || lastContentHRef.current;
    if (contentH > 0) lastContentHRef.current = contentH;
    if (contentH <= 0 || layoutMeasurement.height <= 0) return;
    const distanceFromBottom = contentH - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
  }, []);

  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToBottom = useCallback(
    (immediate = false) => {
      if (immediate) {
        // 主动调用（发送消息/历史加载完成）：强制跟随并恢复底部状态
        isNearBottomRef.current = true;
        if (scrollTimer.current) {
          clearTimeout(scrollTimer.current);
          scrollTimer.current = null;
        }
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
        return;
      }
      // 内容变化触发的跟随：仅当流式期间用户仍在底部附近时执行
      if (!isNearBottomRef.current) return;
      if (scrollTimer.current) return;
      scrollTimer.current = setTimeout(() => {
        scrollTimer.current = null;
        if (!isNearBottomRef.current) return;
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      }, 200);
    },
    [],
  );

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [msgs, exprs] = await Promise.all([
        fetchChatHistory(baseUrl, character.id),
        fetchExpressions(baseUrl, character.id).catch(() => [] as ExpressionEntry[]),
      ]);
      expressionKeys.current = new Set(exprs.map(e => e.key));
      // 回放最后一条带情绪的 AI 消息
      const lastEmotion = [...msgs].reverse().find(m => m.role === 'assistant' && m.emotion);
      setEmotion(lastEmotion?.emotion || 'default');
      setExpressionFailed(false);
      setMessages(msgs);
      // L7：历史加载完成后主动定位到底部（immediate 强制恢复跟随状态）
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setLoadError(e ? e.message : `历史加载失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, character.id, scrollToBottom]);

  useEffect(() => {
    loadHistory();
    // 读取会话配置（图片生成入口可见性 + 思考内容处理模式 + persona）
    getSessionConfig(baseUrl, character.id)
      .then(async c => {
        setImageGenEnabled(c.customParameters?.image_gen_enabled === true);
        const mode = c.customParameters?.think_tag_mode;
        if (mode === 'strip_render' || mode === 'fold' || mode === 'strip') {
          setThinkTagMode(mode);
        }
        // V5：解析当前 persona（用户名 + 头像）
        if (c.selectedPersonaId) {
          try {
            const personas = await fetchPersonas(baseUrl);
            const hit = personas.find(p => p.id === c.selectedPersonaId);
            if (hit) {
              setPersonaName(hit.name || 'User');
              setPersonaAvatar(hit.avatarUrl ? assetUrl(baseUrl, hit.avatarUrl) : null);
            }
          } catch {
            /* persona 加载失败不阻塞对话 */
          }
        }
      })
      .catch(() => setImageGenEnabled(false));
    return () => {
      streamRef.current?.cancel();
    };
  }, [loadHistory, baseUrl, character.id]);

  // 当前立绘 URL：优先情绪立绘，失败或无立绘时回退角色头像
  const portraitUrl = useMemo(() => {
    if (emotion !== 'default' && !expressionFailed && expressionKeys.current.has(emotion)) {
      return assetUrl(
        baseUrl,
        `/api/characters/${encodeURIComponent(character.id)}/expressions/${emotion}`
      );
    }
    return assetUrl(baseUrl, character.avatarUrl);
  }, [baseUrl, character.id, character.avatarUrl, emotion, expressionFailed]);

  // V4：AI 头像呼吸动画（流式输出期间 opacity 脉冲）
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const breatheLoop = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (streaming) {
      breatheLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, { toValue: 0.6, duration: 600, useNativeDriver: true }),
          Animated.timing(breatheAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      breatheLoop.current.start();
    } else {
      breatheLoop.current?.stop();
      breatheAnim.setValue(1);
    }
    return () => breatheLoop.current?.stop();
  }, [streaming, breatheAnim]);

  /** 头像尺寸按屏宽分档（窄屏更小释放消息区） */
  const avatarSize = isLandscape ? 36 : screenW < 380 ? 34 : 40;
  /** 气泡内容可用宽度（含图片限宽用） */
  const bubbleContentWidth = useMemo(() => {
    if (screenW < 380) return screenW * 0.82;
    if (screenW < 600) return screenW * 0.78;
    return screenW * 0.5; // 横屏/平板收窄
  }, [screenW]);

  const doSend = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || streaming) return;

      const now = Date.now();
      const userId = localId('user');
      const assistantLocalId = localId('assistant');
      setMessages(prev => [
        ...prev,
        { id: userId, role: 'user', content: trimmed, timestamp: now },
        { id: assistantLocalId, role: 'assistant', content: '', timestamp: now, streaming: true },
      ]);
      setInput('');
      setStreaming(true);
      scrollToBottom(true);

      const patchAssistant = (patch: Partial<ChatMessage>) => {
        setMessages(prev =>
          prev.map(m => (m.id === assistantLocalId ? { ...m, ...patch } : m))
        );
      };
      const appendDelta = (delta: string) => {
        setMessages(prev =>
          prev.map(m => (m.id === assistantLocalId ? { ...m, content: m.content + delta } : m))
        );
      };
      // V3：流式思考增量（think_tag_mode=fold 时服务端经 reasoning 事件推送）
      const appendReasoning = (delta: string) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantLocalId ? { ...m, reasoning: (m.reasoning || '') + delta } : m
          )
        );
      };

      streamRef.current = sendMessageStream(baseUrl, character.id, trimmed, {
        onChunk: delta => {
          appendDelta(delta);
          scrollToBottom();
        },
        onReasoning: delta => {
          appendReasoning(delta);
          scrollToBottom();
        },
        onEmotion: emo => {
          setExpressionFailed(false);
          setEmotion(emo);
        },
        onTable: result => {
          setSnack(`记忆表格已更新（执行 ${result.executed} 条指令）`);
        },
        onOptions: options => {
          // 辅助模式推荐选项（done 之前到达；渲染在气泡下方）
          patchAssistant({ suggestedOptions: options });
        },
        onDone: result => {
          // V5：同步 user 消息服务端 id（本地 localId 与服务端 genMessageId 不一致，
          // 卷回/重新生成按 id 定位必须用服务端 id）
          if (result.userMessageId) {
            setMessages(prev =>
              prev.map(m => (m.id === userId ? { ...m, id: result.userMessageId! } : m))
            );
          }
          patchAssistant({
            id: result.messageId || assistantLocalId,
            content: result.content,
            timestamp: result.timestamp || now,
            emotion: result.emotion || undefined,
            streaming: false,
            failed: false,
            // 完成后清理流式思考字段（fold 模式改为从 content 中提取统一渲染）
            reasoning: undefined,
          });
          setStreaming(false);
          if (result.emotion) {
            setExpressionFailed(false);
            setEmotion(result.emotion);
          }
          streamRef.current = null;
        },
        onError: err => {
          patchAssistant({ streaming: false, failed: true });
          setStreaming(false);
          streamRef.current = null;
          console.warn('[Chat] SSE error:', err.code, err.message);
          scrollToBottom();
        },
      });
    },
    [baseUrl, character.id, streaming, scrollToBottom]
  );

  const retryLast = useCallback(() => {
    // 找到最后一条失败气泡对应的用户消息，移除失败气泡后重发
    const failedIdx = [...messages].reverse().findIndex(m => m.failed);
    if (failedIdx < 0) return;
    const realIdx = messages.length - 1 - failedIdx;
    // 向前找最近的 user 消息
    let userIdx = realIdx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const content = messages[userIdx].content;
    setMessages(prev => prev.filter((_, i) => i !== realIdx && i !== userIdx));
    // 等待 setState 生效后再发送（streaming 闸门在同一渲染周期外）
    setTimeout(() => doSend(content), 50);
  }, [messages, doSend]);

  const doClear = useCallback(async () => {
    setClearing(true);
    try {
      await clearChat(baseUrl, character.id);
      setClearDialogVisible(false);
      await loadHistory();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setClearDialogVisible(false);
      console.warn('[Chat] clear failed:', e?.message || err);
      await loadHistory();
    } finally {
      setClearing(false);
    }
  }, [baseUrl, character.id, loadHistory]);

  // ==================== 图片生成（Spec: fix-android-chat-feature-parity / Task 8） ====================

  const runImageGeneration = useCallback(
    async (messageId: string, regenerate: boolean) => {
      if (generatingImageIds.has(messageId)) return;
      setGeneratingImageIds(prev => new Set(prev).add(messageId));
      const applyAttachment = (attachment: ImageAttachment) => {
        setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, imageAttachment: attachment } : m)));
      };
      try {
        const result = await generateImage(baseUrl, character.id, messageId, regenerate);
        applyAttachment(result.imageAttachment);
        if (result.warnings?.length) setSnack(result.warnings[0]);
      } catch (err) {
        if (err instanceof ApiError) {
          // 服务端结构化错误：err.attachment 为错误态 imageAttachment（保留旧 history）
          if (err.attachment) {
            applyAttachment(err.attachment as ImageAttachment);
          }
          setSnack(`图片生成失败：${err.message}`);
        } else {
          setSnack(`图片生成失败：${String(err)}`);
        }
      } finally {
        setGeneratingImageIds(prev => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [baseUrl, character.id, generatingImageIds],
  );

  const handleGenerateImage = useCallback(
    (messageId: string) => runImageGeneration(messageId, false),
    [runImageGeneration],
  );
  const handleRegenerateImage = useCallback(
    (messageId: string) => runImageGeneration(messageId, true),
    [runImageGeneration],
  );

  // ==================== 卷回 / 重新生成 / 复制（Spec: fix-android-chat-interaction-parity / Task 7） ====================

  /** 用户消息卷回到输入框：服务端截断该消息及之后 → 本地同步截断 → 内容填入输入框 */
  const handleRollback = useCallback(
    async (messageId: string) => {
      if (streaming) return;
      try {
        const result = await rollbackChat(baseUrl, character.id, messageId);
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === messageId);
          return idx === -1 ? prev : prev.slice(0, idx);
        });
        setInput(result.content);
        setSnack('已卷回到输入框');
      } catch (err) {
        setSnack(`卷回失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [baseUrl, character.id, streaming],
  );

  /** AI 消息重新生成：回退其前置 user 消息（含删除）→ 相同内容重发（对齐 PC retryMessage 效果） */
  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (streaming) return;
      const idx = messages.findIndex(m => m.id === messageId);
      if (idx < 0) return;
      let userIdx = idx - 1;
      while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx -= 1;
      if (userIdx < 0) {
        setSnack('未找到对应的用户消息，无法重新生成');
        return;
      }
      const userMsg = messages[userIdx];
      try {
        await rollbackChat(baseUrl, character.id, userMsg.id);
        setMessages(prev => prev.slice(0, userIdx));
        // 等待 setState 生效后再发送（与 retryLast 相同模式）
        setTimeout(() => doSend(userMsg.content), 50);
      } catch (err) {
        setSnack(`重新生成失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [baseUrl, character.id, messages, streaming, doSend],
  );

  /** 复制 AI 消息正文（剥离 <think> 后的可见内容） */
  const handleCopy = useCallback((content: string) => {
    Clipboard.setString(content);
    setSnack('已复制');
  }, []);

  /** 打开头像/立绘全屏查看器 */
  const openAvatarViewer = useCallback((url: string) => {
    setAvatarViewerUrl(url);
  }, []);

  // ==================== 渲染 ====================

  // V3：主题化样式（亮/暗调色板驱动，Paper 组件由 PaperProvider 自动跟随）
  const styles = useMemo(() => createStyles(palette), [palette]);

  // L5：气泡最大宽度按屏宽分档（窄屏占比较大保可读、横屏/平板收窄）
  const bubbleMaxWidth = useMemo(() => {
    if (screenW < 380) return '88%';
    if (screenW < 600) return '82%';
    return '56%';
  }, [screenW]);

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isUser = item.role === 'user';
    const canGenerateImage =
      !isUser && imageGenEnabled && !item.streaming && !item.failed && !item.imageAttachment;
    // V3：思考内容三态渲染
    const { reasoning: thinkFromContent, body: bodyWithoutThink } = splitThink(item.content);
    const showFoldedThink =
      !isUser && thinkTagMode === 'fold' && (thinkFromContent.length > 0 || (item.streaming && !!item.reasoning));
    const visibleThink = item.streaming ? item.reasoning || thinkFromContent : thinkFromContent;
    const displayBody = bodyWithoutThink;
    // V5：AI 序号（对齐 PC：之前 assistant 消息数 + 1）
    const aiSeq =
      !isUser ? messages.slice(0, index).filter(m => m.role === 'assistant').length + 1 : 0;
    // 气泡下方操作行与选项的左缩进（AI 侧对齐气泡起点 = 头像宽 + 间距）
    const belowIndent = !isUser ? avatarSize + 8 : 0;
    return (
      <View style={styles.msgRow}>
        <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser, { maxWidth: bubbleMaxWidth }]}>
          {/* AI 气泡行：头像（点击全屏查看）+ 内容列 */}
          {!isUser && (
            <Pressable onPress={() => openAvatarViewer(portraitUrl)} hitSlop={6}>
              <Animated.View
                style={[styles.avatarWrap, { opacity: breatheAnim, width: avatarSize, height: avatarSize }]}
              >
                <Image
                  source={{ uri: portraitUrl }}
                  style={[styles.avatarImage, { width: avatarSize, height: avatarSize }]}
                  onError={() => { /* 回退到角色头像，portraitUrl 已处理 */ }}
                />
              </Animated.View>
            </Pressable>
          )}
          <View style={[styles.contentCol, isUser ? styles.contentColUser : styles.contentColAI]}>
            {/* V5：名字行（对齐 PC：用户名/角色名 + 情绪标签 + AI 序号徽章） */}
            <View style={[styles.nameRow, isUser && styles.nameRowUser]}>
              <RNText
                style={[styles.nameText, { color: isUser ? palette.nameUser : palette.nameAI }]}
                numberOfLines={1}
              >
                {isUser ? personaName : character.name || character.fileName}
              </RNText>
              {!isUser && item.emotion && (
                <RNText style={styles.emotionTag} numberOfLines={1}>
                  ({emotionLabel(item.emotion)})
                </RNText>
              )}
              {!isUser && aiSeq > 0 && (
                <View style={styles.seqBadge}>
                  <RNText style={styles.seqText}>#{aiSeq}</RNText>
                </View>
              )}
            </View>
            <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
              {/* V3：fold 模式思考折叠面板 */}
              {showFoldedThink && (
                <ThinkingPanel
                  text={visibleThink}
                  streamingThink={!!item.streaming && !!item.reasoning}
                  palette={palette}
                  styles={styles}
                />
              )}
              <RNText
                style={[styles.bubbleText, isUser ? styles.bubbleUserText : styles.bubbleAIText]}
                textBreakStrategy={Platform.OS === 'android' ? 'highQuality' : undefined}
                selectable
              >
                {displayBody || (item.streaming ? '' : '（空回复）')}
              </RNText>
              {item.streaming && item.content === '' && !item.reasoning && (
                <ActivityIndicator animating size="small" color={palette.primary} style={styles.thinking} />
              )}

              {/* 图片气泡 */}
              {!isUser && (item.imageAttachment || generatingImageIds.has(item.id)) && (
                <ImageBubble
                  baseUrl={baseUrl}
                  characterId={character.id}
                  messageId={item.id}
                  attachment={item.imageAttachment}
                  generating={generatingImageIds.has(item.id)}
                  maxImageWidth={bubbleContentWidth - (isLandscape ? 60 : 50)}
                  onRegenerate={handleRegenerateImage}
                  onRetry={handleGenerateImage}
                />
              )}

              <RNText style={[styles.time, isUser ? styles.timeUser : styles.timeAI]}>
                {formatTime(item.timestamp)}
                {item.failed ? ' · 发送失败' : ''}
              </RNText>
            </View>
          </View>
          {/* 用户气泡行：内容列 + 头像（persona 头像，点击全屏查看） */}
          {isUser && (
            <Pressable
              style={[styles.avatarWrap, styles.userAvatarWrap, { width: avatarSize, height: avatarSize }]}
              onPress={() =>
                personaAvatar ? openAvatarViewer(personaAvatar) : setSnack('当前人设未设置头像')
              }
              hitSlop={6}
            >
              {personaAvatar ? (
                <Image
                  source={{ uri: personaAvatar }}
                  style={[styles.avatarImage, { width: avatarSize, height: avatarSize }]}
                />
              ) : (
                <View style={[styles.userAvatarCircle, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
                  <RNText style={styles.userAvatarText}>{personaName.charAt(0).toUpperCase()}</RNText>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {/* V5：消息操作按钮行（AI：复制/重新生成/生成图片；对齐 PC 消息操作区） */}
        {!isUser && !item.streaming && !item.failed && (
          <View style={[styles.actionRow, { marginLeft: belowIndent }]}>
            <Pressable
              style={styles.actionBtn}
              onPress={() => handleCopy(displayBody)}
              disabled={streaming}
              android_ripple={{ color: palette.surfaceVariant, borderless: false }}
            >
              <IconButton
                icon="content-copy"
                size={15}
                iconColor={palette.onSurfaceVariant}
                style={styles.actionIcon}
              />
              <RNText style={styles.actionText}>复制</RNText>
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={() => handleRegenerate(item.id)}
              disabled={streaming}
              android_ripple={{ color: palette.surfaceVariant, borderless: false }}
            >
              <IconButton
                icon="refresh"
                size={15}
                iconColor={palette.onSurfaceVariant}
                style={styles.actionIcon}
              />
              <RNText style={styles.actionText}>重新生成</RNText>
            </Pressable>
            {canGenerateImage && !generatingImageIds.has(item.id) && (
              <Pressable
                style={styles.actionBtn}
                onPress={() => handleGenerateImage(item.id)}
                android_ripple={{ color: palette.surfaceVariant, borderless: false }}
              >
                <IconButton
                  icon="image-plus"
                  size={15}
                  iconColor={palette.primary}
                  style={styles.actionIcon}
                />
                <RNText style={[styles.actionText, { color: palette.primary }]}>生成图片</RNText>
              </Pressable>
            )}
          </View>
        )}

        {/* V5：用户消息「卷回到输入框」（对齐 PC userEditButton） */}
        {isUser && (
          <View style={[styles.actionRow, styles.actionRowUser]}>
            <Pressable
              style={styles.actionBtn}
              onPress={() => handleRollback(item.id)}
              disabled={streaming}
              android_ripple={{ color: palette.surfaceVariant, borderless: false }}
            >
              <IconButton
                icon="undo-variant"
                size={15}
                iconColor={palette.onSurfaceVariant}
                style={styles.actionIcon}
              />
              <RNText style={styles.actionText}>卷回到输入框</RNText>
            </Pressable>
          </View>
        )}

        {/* V3：辅助模式推荐选项（V5：点击填入输入框，可编辑后发送——对齐 PC） */}
        {!isUser && !item.streaming && !item.failed && (item.suggestedOptions?.length ?? 0) > 0 && (
          <View style={[styles.optionsWrap, { marginLeft: belowIndent }]}>
            {item.suggestedOptions!.map((opt, i) => (
              <Pressable
                key={`${item.id}-opt-${i}`}
                style={styles.optionChip}
                onPress={() => {
                  setInput(opt);
                  setSnack('已填入输入框，可编辑后发送');
                }}
                disabled={streaming}
                android_ripple={{ color: palette.surfaceVariant, borderless: false }}
              >
                <RNText style={styles.optionText} numberOfLines={2}>
                  {opt}
                </RNText>
              </Pressable>
            ))}
          </View>
        )}

        {item.failed && (
          <View style={[styles.actionRow, { marginLeft: belowIndent }]}>
            <Button
              mode="text"
              compact
              onPress={retryLast}
              labelStyle={styles.retryLabel}
              style={styles.retryBtn}
              icon="refresh"
            >
              重试
            </Button>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.BackAction onPress={backToList} color={palette.onAppbar} />
        <Appbar.Content title={character.name || character.fileName} titleStyle={styles.appbarTitle} />
        <Appbar.Action
          icon="table-of-contents"
          color={palette.onAppbar}
          onPress={() => setTableSheetVisible(true)}
        />
        <Appbar.Action icon="cog" color={palette.onAppbar} onPress={() => setConfigSheetVisible(true)} />
        <Appbar.Action
          icon="delete-sweep"
          color={palette.onAppbar}
          disabled={streaming}
          onPress={() => setClearDialogVisible(true)}
        />
      </Appbar.Header>

      {/* L2：Android edge-to-edge 下手动键盘避让（键盘高度作为列表底部留白） */}
      <View style={[styles.flex, { paddingBottom: Platform.OS === 'android' ? kbHeight : 0 }]}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator animating size="large" />
            <Text style={styles.centerText}>正在加载对话历史…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button mode="contained-tonal" onPress={loadHistory}>
              重新加载
            </Button>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            onScroll={onListScroll}
            scrollEventThrottle={16}
            onContentSizeChange={(_, contentH) => {
              // L7：缓存内容高度（Fabric 上 onScroll 的 contentSize.height 可能为 0，
              // 此处参数是可靠来源），保证 isNearBottomRef 的距离计算始终有据可依
              if (contentH > 0) lastContentHRef.current = contentH;
              // 仅流式输出期间自动跟随底部；静态浏览历史时任何
              // 内容尺寸变化（图片加载/windowing 重布局）都不再强制滚底
              if (streaming) scrollToBottom();
            }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.centerText}>开始和 {character.name || '角色'} 聊天吧</Text>
              </View>
            }
          />
        )}

        {/* 输入区 */}
        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={streaming ? '对方正在回复…' : '输入消息…'}
            mode="outlined"
            multiline
            dense
            disabled={streaming}
            style={styles.input}
            contentStyle={styles.inputContent}
          />
          <IconButton
            icon="send"
            mode="contained"
            containerColor={input.trim() && !streaming ? palette.primary : palette.outline}
            iconColor={palette.onPrimary}
            size={24}
            disabled={!input.trim() || streaming}
            onPress={() => doSend(input)}
          />
        </View>
      </View>

      <Portal>
        <Dialog visible={clearDialogVisible} onDismiss={() => setClearDialogVisible(false)}>
          <Dialog.Title>清空上下文</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">将删除该角色在本机的对话记录并开始新对话（与桌面端共享同一存储），确定吗？</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setClearDialogVisible(false)}>取消</Button>
            <Button onPress={doClear} loading={clearing} textColor={palette.error}>
              清空
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* V2：会话配置 / 记忆表格弹层 */}
      <SessionConfigSheet
        visible={configSheetVisible}
        onDismiss={() => setConfigSheetVisible(false)}
        baseUrl={baseUrl}
        characterId={character.id}
        onSaved={config => {
          setImageGenEnabled(config.customParameters?.image_gen_enabled === true);
          setSnack('配置已保存');
        }}
      />
      <MemoryTableSheet
        visible={tableSheetVisible}
        onDismiss={() => setTableSheetVisible(false)}
        baseUrl={baseUrl}
        characterId={character.id}
      />

      {/* V5：头像/立绘全屏查看器（捏合缩放/双击/单击关闭） */}
      <AvatarViewer
        visible={avatarViewerUrl !== null}
        url={avatarViewerUrl}
        onDismiss={() => setAvatarViewerUrl(null)}
      />

      <Snackbar visible={snack !== null} onDismiss={() => setSnack(null)} duration={2500}>
        {snack || ''}
      </Snackbar>
    </SafeAreaView>
  );
}

/** V4：主题化样式工厂（palette 驱动，亮暗两套；玻璃态/大圆角/阴影分层） */
function createStyles(p: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: p.background },
    flex: { flex: 1 },
    appbar: {
      backgroundColor: p.appbar,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    appbarTitle: { color: p.onAppbar, fontWeight: '700' },

    // V4：圆形头像（AI 左 / 用户右）
    avatarWrap: {
      borderRadius: 999,
      borderWidth: 2,
      borderColor: p.glassBg,
      overflow: 'hidden',
      backgroundColor: p.surfaceVariant,
      marginRight: 8,
      alignSelf: 'flex-start',
      marginTop: 2,
    },
    avatarImage: { borderRadius: 999 },
    userAvatarWrap: { marginRight: 0, marginLeft: 8, borderColor: 'transparent' },
    userAvatarCircle: { backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' },
    userAvatarText: { color: p.onPrimary, fontSize: 12, fontWeight: '700' },

    // V5：消息外层容器（气泡行 + 操作行 + 选项区）
    msgRow: { marginBottom: 2 },
    // V5：内容列（名字行 + 气泡，flexShrink 保证长文本折行）
    contentCol: { flexShrink: 1, minWidth: 0 },
    contentColUser: { alignItems: 'flex-end' },
    contentColAI: { alignItems: 'flex-start' },
    // V5：名字行（对齐 PC：名字 + 情绪标签 + AI 序号徽章）
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    nameRowUser: { justifyContent: 'flex-end' },
    nameText: { fontSize: 12, fontWeight: '700' },
    emotionTag: { color: p.onSurfaceVariant, fontSize: 11 },
    seqBadge: {
      backgroundColor: p.glassBg,
      borderRadius: 8,
      paddingHorizontal: 5,
      paddingVertical: 1,
      minWidth: 24,
      alignItems: 'center',
    },
    seqText: { color: p.onSurfaceVariant, fontSize: 9, fontWeight: '600' },

    list: { padding: 12, paddingBottom: 8 },
    bubbleRow: {
      marginBottom: 10,
      flexDirection: 'row',
      // V5（D2 修复）：头像与名字行顶对齐（对齐 PC .chat-msg-inner 默认顶对齐；
      // 之前 flex-end 导致长 AI 消息头像沉到消息底部甚至滚出屏幕）
      alignItems: 'flex-start',
    },
    // V5（D3 修复）：用户消息整体右对齐（对齐 PC .chat-msg-wrapper.is-user 的 justify-content: flex-end）
    bubbleRowUser: { justifyContent: 'flex-end' },
    // V5：气泡几何对齐 PC CSS 基准（圆角 18、小角 4 位于底角、内边距 16/12）
    bubble: {
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    bubbleUser: {
      backgroundColor: p.userBubble,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomRightRadius: 4,
      borderBottomLeftRadius: 18,
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    bubbleAI: {
      backgroundColor: p.aiBubble,
      borderWidth: 1,
      borderColor: p.aiBubbleBorder,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomRightRadius: 18,
      borderBottomLeftRadius: 4,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    // L3：文本约束换行（flexShrink + 最小宽 0），连续长串/URL 不再横向溢出
    bubbleText: { fontSize: 15, lineHeight: 22, flexShrink: 1, minWidth: 0 },
    bubbleUserText: { color: p.userBubbleText },
    bubbleAIText: { color: p.aiBubbleText },
    thinking: { marginVertical: 4 },
    time: { fontSize: 10, marginTop: 4, opacity: 0.7, alignSelf: 'flex-end' },
    timeUser: { color: p.userBubbleText },
    timeAI: { color: p.onSurfaceVariant },
    retryBtn: { marginTop: 2 },
    retryLabel: { color: p.error, fontSize: 12 },

    // V3：思考折叠面板（think_tag_mode=fold）
    thinkWrap: {
      backgroundColor: p.reasoningBg,
      borderRadius: 12,
      padding: 8,
      marginBottom: 6,
    },
    thinkHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    thinkToggle: { color: p.primary, fontSize: 13, width: 14 },
    thinkLabel: { color: p.reasoningText, fontSize: 12, fontWeight: '600', flex: 1 },
    thinkBody: {
      color: p.reasoningText,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 6,
    },

    // V3：辅助模式推荐选项 chips（玻璃态）
    optionsWrap: { gap: 6, marginTop: 6, marginLeft: 48, alignSelf: 'stretch' },
    optionChip: {
      backgroundColor: p.glassBg,
      borderColor: p.outline,
      borderWidth: 1,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    optionText: { color: p.primary, fontSize: 13, lineHeight: 18 },

    // V5：消息操作按钮行（AI：复制/重新生成/生成图片；用户：卷回到输入框）
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginTop: 2,
      marginBottom: 8,
      alignSelf: 'flex-start',
    },
    actionRowUser: { alignSelf: 'flex-end' },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 14,
      paddingHorizontal: 2,
    },
    actionIcon: { margin: 0 },
    actionText: { color: p.onSurfaceVariant, fontSize: 12, marginRight: 6 },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
    centerText: { color: p.onSurfaceVariant },
    errorText: { color: p.error, textAlign: 'center', lineHeight: 20 },

    // V4：输入区圆角胶囊容器
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      padding: 10,
      paddingBottom: 10,
      backgroundColor: p.background,
      borderTopWidth: 1,
      borderTopColor: 'rgba(0,0,0,0.05)',
    },
    input: {
      flex: 1,
      backgroundColor: p.glassBg,
      maxHeight: 120,
      borderRadius: 24,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    inputContent: { paddingTop: 8, paddingBottom: 8, paddingHorizontal: 4 },
  });
}
