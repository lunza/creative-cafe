/**
 * 服务端 headless 对话管线（Spec: add-android-chat-client / Task 3）
 *
 * 在 Electron 主进程中提供与桌面端核心路径一致的角色对话处理：
 *   加载角色卡 → 组装系统提示词（角色上下文 + 对话任务模板 + 表情约束）
 *   → 加载/拼接历史消息（含 first_mes 问候，复用 chatStorageService 同一存储）
 *   → 使用服务端当前启用的 AI 引擎配置流式调用 OpenAI 兼容接口
 *   → 增量剥离 <think> 标签与 <<<EXPRESSION>>> 情绪标记
 *   → 完成后解析情绪并持久化 user+assistant 两条消息
 *
 * 复用说明：
 * - 提示词纯逻辑直接 import 渲染进程 PromptBuilder（纯 TS 模块，仅类型依赖，可安全打包进主进程）
 * - AI 请求体构造逻辑对齐渲染进程 ChatEngine.sendMessage（URL 拼接 / 温度 / 停止序列 / 密钥注入）
 * - 超时策略对齐主进程 aiHandlers（连接超时 120s / 请求超时 300s，均读引擎级配置）
 */

import path from 'path';
import { characterService } from '../characterService';
import { chatStorageService } from '../ChatStorageService';
import { expressionService } from '../expressionService';
import { getStorageService } from '../storageService';
import {
  buildPromptCore,
  buildExpressionPrompt,
  buildLengthGuidancePrompt,
  buildLanguagePrompt,
  buildAsyncTableOrganizeInstructions,
  buildAssistModePrompt,
  parseExpressionFromContent,
  buildStopSequences,
  type CharacterInfoForPrompt,
} from '../../../renderer/components/Character/CharacterDialogueChat/PromptBuilder';
import type { UserPersona } from '../../../renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types';
import { sessionConfigStore } from './sessionConfigStore';
import { findPersonaById } from './personas';
import { contextManager } from '../ContextManager';
import { chatVectorizationService } from '../ChatVectorizationService';
import { chatLogService } from '../memory/chatLogService';
import { tableEditParser } from '../memory/tableEditParser';

// ==================== 类型定义 ====================

export interface DialogueStreamHandlers {
  /** 推送一段可显示的增量文本（已剥离 think/表情标记，尽力而为；done.content 为权威内容） */
  onChunk: (delta: string) => void;
  /** 推送一段思考增量（仅 think_tag_mode=fold 流式期间；Spec: fix-android-chat-parity-v3） */
  onReasoning?: (delta: string) => void;
  /** 解析出情绪键（完成阶段，至多一次；可能不触发） */
  onEmotion: (emotion: string) => void;
  /** 记忆表格编辑指令已执行（Spec: fix-android-chat-feature-parity / Task 4；至多一次，可能不触发） */
  onTable?: (result: { executed: number; errors: string[] }) => void;
  /** 辅助模式推荐选项解析结果（Spec: fix-android-chat-parity-v3；至多一次，可能不触发） */
  onOptions?: (options: string[]) => void;
  /** 本轮对话成功完成（content 为剥离标记后的权威全文；userMessageId 供客户端同步服务端消息 id） */
  onDone: (result: { messageId: string; userMessageId?: string; emotion: string | null; content: string; timestamp: number }) => void;
  /** 失败（此时不写入任何消息） */
  onError: (err: { code: string; message: string }) => void;
}

interface LanChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  emotion?: string;
  [key: string]: unknown;
}

// ==================== 对话任务提示词模板 ====================
// 与渲染进程 PromptBuilder.buildDialoguePrompt 的硬编码回退模板保持一致
// （桌面端优先走 prompt 模板系统，回退模板与模板默认值内容同源；
//  headless V1 直接采用回退模板，保证两端核心行为一致）
// Spec fix-android-chat-feature-parity / Task 2：userName 由人设名驱动，
// 人设段复用 buildPromptCore（内含 buildPersonaSection）
// Spec reduce-dialogue-ai-flavor-and-repetition / Phase 2：同步精简为 3 条核心规则
function buildDialogueTaskPrompt(
  characterInfo: CharacterInfoForPrompt,
  persona?: UserPersona,
  userName: string = 'User'
): string {
  const { characterContext, personaSection, charName } = buildPromptCore(characterInfo, persona);

  return `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 {{char}} 这个角色，与 ${userName} 进行角色扮演对话。
在提示词中，{{char}} 代表 ${charName}，${userName} 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。

【对话方式】
1. 你就是 ${charName}，以你的身份思考、说话、行动——不是助手，不是系统
2. 像真人一样交流：句子有长有短，会犹豫、会开玩笑、会跑题；不必回应每一个问题，也不必刻意展示设定；情绪不同，说话的节奏也不同
3. 对话内容用英文双引号（" "）包裹；动作、神态、心理描写用星号（* *）包裹，两者可自然交替

【角色信息】
${characterContext}
${personaSection}`;
}

// ==================== 流式内容清洗器 ====================
// 增量剥离 <think>...</think> 与 <<<EXPRESSION>>>...<<<END_EXPRESSION>>> 标记
// 策略：对可能是标记起始的 '<' 片段暂扣（holdback），确认后再放行或丢弃

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const HOLD_MAX = 64; // 超过此长度仍未匹配任何标记起始 → 视为普通文本放行
const MARKER_STARTS = ['<<<EXPRESSION>>>', '<expression>'];

class StreamSanitizer {
  private buffer = '';
  private inThink = false;
  private fullAfterThink = ''; // think 剥离后全文（含表情标记，供最终解析）
  private rawFull = '';        // 原始全文（含 <think>，strip_render/fold 模式存储保留）

  constructor(
    /** 思考内容处理三态（Spec: fix-android-chat-parity-v3，对齐桌面端 ThinkTagMode） */
    private thinkMode: 'strip' | 'strip_render' | 'fold' = 'strip',
    /** fold 模式：思考增量推送回调（流式实时显示思考过程） */
    private onReasoning?: (delta: string) => void,
  ) {}

  /** 喂入一段原始增量，返回可放行显示的文本 */
  push(delta: string): string {
    this.buffer += delta;
    this.rawFull += delta;
    let out = '';

    while (this.buffer.length > 0) {
      if (this.inThink) {
        const closeIdx = this.buffer.indexOf(THINK_CLOSE);
        if (closeIdx >= 0) {
          // 思考结束：closeIdx 之前的内容均为思考增量（fold 模式推送）
          if (this.thinkMode === 'fold' && closeIdx > 0) this.onReasoning?.(this.buffer.slice(0, closeIdx));
          this.buffer = this.buffer.slice(closeIdx + THINK_CLOSE.length);
          this.inThink = false;
          continue;
        }
        // 仍在思考中：保留可能是关闭标记尾巴的部分，其余丢弃/推送
        const keep = Math.min(this.buffer.length, THINK_CLOSE.length - 1);
        const emitLen = this.buffer.length - keep;
        if (this.thinkMode === 'fold' && emitLen > 0) this.onReasoning?.(this.buffer.slice(0, emitLen));
        this.buffer = keep > 0 ? this.buffer.slice(-keep) : '';
        return out;
      }

      const lt = this.buffer.indexOf('<');
      if (lt < 0) {
        out += this.buffer;
        this.fullAfterThink += this.buffer;
        this.buffer = '';
        break;
      }

      // 放行 '<' 之前的文本
      if (lt > 0) {
        out += this.buffer.slice(0, lt);
        this.fullAfterThink += this.buffer.slice(0, lt);
        this.buffer = this.buffer.slice(lt);
      }

      // 此时 buffer 以 '<' 开头，判断标记类型
      if (this.buffer.startsWith(THINK_OPEN)) {
        this.buffer = this.buffer.slice(THINK_OPEN.length);
        this.inThink = true;
        continue;
      }

      const marker = MARKER_STARTS.find(m => this.buffer.startsWith(m));
      if (marker) {
        // 表情标记：吞掉直到 '>>>' / '</expression>' 结束（含换行残余）
        const endIdx = this.buffer.indexOf(marker === '<expression>' ? '</expression>' : '>>>');
        if (endIdx >= 0) {
          this.buffer = this.buffer.slice(endIdx + (marker === '<expression>' ? '</expression>'.length : 3));
        } else {
          this.buffer = ''; // 未闭合：标记会由最终 parse 兜底（流内丢弃）
        }
        continue;
      }

      // 可能是残缺标记起始：暂扣，等下一段数据
      if (this.buffer.length < HOLD_MAX && MARKER_STARTS.some(m => m.startsWith(this.buffer) || this.buffer.startsWith(m.slice(0, Math.min(m.length, this.buffer.length))))) {
        break; // 留在 buffer
      }
      if (THINK_OPEN.startsWith(this.buffer) || this.buffer.length < THINK_OPEN.length) {
        break; // 可能是 <think 的前缀
      }

      // 超长仍不匹配 → 普通文本，放行（保留尾部可能的 '<' 前缀）
      let emitLen = this.buffer.length;
      const tailLt = this.buffer.lastIndexOf('<');
      if (tailLt > 0 && this.buffer.length - tailLt < HOLD_MAX) {
        emitLen = tailLt;
      }
      out += this.buffer.slice(0, emitLen);
      this.fullAfterThink += this.buffer.slice(0, emitLen);
      this.buffer = this.buffer.slice(emitLen);
    }

    return out;
  }

  /** 流结束：返回剩余可放行文本（标记残余全部丢弃，权威内容以 fullAfterThink 解析为准） */
  flush(): string {
    if (!this.inThink) {
      // 尾部残余若不含完整标记则放行
      const remaining = this.buffer;
      this.buffer = '';
      this.fullAfterThink += remaining;
      return remaining;
    }
    this.buffer = '';
    return '';
  }

  /** think 剥离后的全文（含表情标记），供最终 parseExpressionFromContent */
  getFullText(): string {
    return this.fullAfterThink;
  }

  /** 原始全文（含 <think>），strip_render / fold 模式的存储内容来源 */
  getRawFull(): string {
    return this.rawFull;
  }
}

// ==================== 记忆表格编辑指令提取与剥离（Spec: fix-android-chat-feature-parity / Task 4） ====================
// 正则对齐桌面端 hooks.ts 的多格式匹配；不含桌面端末两个宽松前缀格式
// （tableEdit: / 命令:）——headless 模式无人工确认环节，宽松前缀易误伤正文，故收紧。

const TABLE_EDIT_PATTERNS: RegExp[] = [
  /<!--\s*<tableEdit>([\s\S]*?)<\/tableEdit>\s*-->/i,
  /<tableEdit>([\s\S]*?)<\/tableEdit>/i,
  /<!--\s*tableEdit\s*-->([\s\S]*?)<!--\s*\/tableEdit\s*-->/i,
  /\[tableEdit\]([\s\S]*?)\[\/tableEdit\]/i,
  /【tableEdit】([\s\S]*?)【\/tableEdit】/i,
];

function stripTableEditTags(content: string): string {
  return content
    .replace(/<!--\s*<tableEdit>[\s\S]*?<\/tableEdit>\s*-->/gi, '')
    .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
    .replace(/<!--\s*tableEdit\s*-->[\s\S]*?<!--\s*\/tableEdit\s*-->/gi, '')
    .replace(/<\s*tableEdit\s*>[\s\S]*?<\s*\/\s*tableEdit\s*>/gi, '')
    .replace(/\[tableEdit\][\s\S]*?\[\/tableEdit\]/gi, '')
    .replace(/【tableEdit】[\s\S]*?【\/tableEdit】/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/g, '')
    .trim();
}

/** 从 AI 回复中提取 tableEdit 指令（matched=false 表示不含指令） */
function extractTableEdit(content: string): { matched: boolean; raw: string; cleaned: string } {
  for (const pattern of TABLE_EDIT_PATTERNS) {
    const m = pattern.exec(content);
    if (m) {
      return { matched: true, raw: m[1] || '', cleaned: stripTableEditTags(content) };
    }
  }
  return { matched: false, raw: '', cleaned: content };
}

// ==================== 辅助模式推荐选项提取与剥离（Spec: fix-android-chat-parity-v3） ====================
// 多格式容错匹配对齐桌面端 hooks.ts（含跨 chunk 损坏标记兜底与半截块容错）

const OPTION_PATTERNS: Array<{ regex: RegExp }> = [
  // 主格式：<<<SUGGESTED_OPTIONS>>> ... <<<END_OPTIONS>>>
  { regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)<<<END_OPTIONS>>>/i },
  // 容错：仅有开始标记到文本末尾（AI 遗漏结束标记或被截断）
  { regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)$/i },
  // 兜底：含 OPTIONS 关键字的损坏 <<<...>>> 标记（SSE 跨 chunk 损坏防御）
  { regex: /<<<[^>]*OPTIONS[^>]*>>>\s*([\s\S]*?)<<<[^>]*END[^>]*OPTIONS[^>]*>>>/i },
  { regex: /<<<[^>]*OPTIONS[^>]*>>>\s*([\s\S]*?)$/i },
  // 兼容旧格式：<!-- <suggestedOptions> ... </suggestedOptions> -->
  { regex: /<!--\s*<suggestedOptions>([\s\S]*?)<\/suggestedOptions>\s*-->/i },
  { regex: /<suggestedOptions>([\s\S]*?)$/i },
  { regex: /<suggestedOptions>([\s\S]*?)<\/suggestedOptions>/i },
  { regex: /\[suggested_options\]\s*([\s\S]*?)\[\/suggested_options\]/i },
];

/** 从内容中提取推荐选项块：剥离选项块后的正文 + 选项列表（matched=false 表示无选项块） */
function extractSuggestedOptions(content: string): { matched: boolean; options: string[]; cleaned: string } {
  for (const pattern of OPTION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const m = content.match(pattern.regex);
    if (m) {
      const options = m[1]
        ? m[1]
            .split('\n')
            .map(line => line
              .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
              .replace(/^\d+[\.\)、\)]\s*/, '')
              .replace(/^[-\*]\s*/, '')
              .replace(/^\(\d+\)\s*/, '')
              .trim())
            .filter(line => line.length > 0)
            .slice(0, 3)
        : [];
      if (options.length === 0) continue; // 空块：尝试下一格式
      const cleaned = content.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim();
      return { matched: true, options, cleaned };
    }
  }
  return { matched: false, options: [], cleaned: content };
}

/** 读取记忆表格并格式化为 Markdown（对齐桌面端 ContextAssembler.fetchMemoryTable） */
function buildMemoryTableMarkdown(tableResult: {
  sheets?: string[];
  headers?: Record<string, string[]>;
  data?: Record<string, Array<Record<string, unknown>>>;
}): string {
  if (!tableResult?.sheets?.length || !tableResult?.data) return '';
  let md = '# 记忆表格数据\n\n';
  for (const sheetName of tableResult.sheets) {
    const sheetHeaders: string[] = tableResult.headers?.[sheetName] ?? [];
    const sheetRows: Array<Record<string, unknown>> = tableResult.data?.[sheetName] ?? [];
    md += `## 表格: ${sheetName}\n\n`;
    if (sheetHeaders.length > 0) {
      md += '| ' + sheetHeaders.join(' | ') + ' |\n';
      md += '| ' + sheetHeaders.map(() => '---').join(' | ') + ' |\n';
    }
    for (const row of sheetRows) {
      const cells = sheetHeaders.map((_h, columnIndex) => {
        const val = row[columnIndex.toString()];
        return val !== undefined && val !== null ? String(val) : '';
      });
      md += '| ' + cells.join(' | ') + ' |\n';
    }
    md += '\n';
  }
  return md;
}

// ==================== 工具函数 ====================

function genMessageId(role: string): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 从 SSE data: 行中增量提取 delta.content（与主进程 aiHandlers 的解析策略一致，含容错） */
function extractDeltaFromSSELine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return '';
  const jsonStr = trimmed.substring(6).trim();
  if (!jsonStr || jsonStr === '[DONE]') return '';
  try {
    const parsed = JSON.parse(jsonStr);
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) return delta;
    const message = parsed?.choices?.[0]?.message?.content;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // 单行 JSON 解析失败：忽略（与桌面端容错策略一致）
  }
  return '';
}

// ==================== 主流程 ====================

/**
 * 执行一轮对话：发送用户消息 → 流式生成 AI 回复 → 持久化。
 * 任何失败路径都不会写入消息存储（spec：AI 失败不写入 assistant 消息）。
 */
export async function runDialogueTurn(
  characterFilePath: string,
  userContent: string,
  handlers: DialogueStreamHandlers
): Promise<void> {
  let bufferTail = ''; // AI 原始 SSE 缓冲（跨 chunk 行）
  let streamTimeoutId: NodeJS.Timeout | undefined;
  let connectionTimeoutId: NodeJS.Timeout | undefined;
  let controller: AbortController | undefined;

  const cleanupTimers = () => {
    if (streamTimeoutId) clearTimeout(streamTimeoutId);
    if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
  };

  try {
    // ---- 1. 读取服务端当前启用的 AI 引擎 ----
    const settings = getStorageService().getSettings();
    const engines = Array.isArray(settings?.aiEngines) ? settings.aiEngines : [];
    const engine = (settings?.activeEngineId
      ? engines.find((e: any) => e.id === settings.activeEngineId)
      : undefined) || engines[0];
    if (!engine || !engine.api_url || !engine.model_name) {
      handlers.onError({ code: 'AI_NOT_CONFIGURED', message: '服务端尚未配置 AI 引擎（API 地址或模型名缺失），请先在桌面端设置中配置' });
      return;
    }

    // ---- 2. 加载角色卡 ----
    const card = await characterService.readCharacter(characterFilePath);
    if (!card || !card.data) {
      handlers.onError({ code: 'CHARACTER_NOT_FOUND', message: '角色卡读取失败' });
      return;
    }
    const d = card.data;
    const charName = d.name || path.basename(characterFilePath, path.extname(characterFilePath));

    // ---- 3. 组装系统提示词（与桌面端核心路径一致） ----
    const characterInfo: CharacterInfoForPrompt = {
      characterCardName: charName,
      personality: d.personality || '',
      characterCardContent: d.description || '',
      scenario: d.scenario || '',
      mes_example: d.mes_example || '',
      system_prompt: d.system_prompt || '',
      creator_notes: d.creator_notes || '',
    };
    const manifest = await expressionService.listExpressions(characterFilePath);
    const uploadedEmotionKeys = Object.keys(manifest.expressions || {});

    // ---- 3.5 加载 LAN 会话配置 + 解析选中人设（Spec: fix-android-chat-feature-parity / Task 2） ----
    const sessionConfig = await sessionConfigStore.load(characterFilePath);
    const cp = sessionConfig.customParameters || {};
    const personaRecord = sessionConfig.selectedPersonaId
      ? await findPersonaById(sessionConfig.selectedPersonaId)
      : null;
    if (sessionConfig.selectedPersonaId && !personaRecord) {
      console.warn(`[LanDialogue] 人设 ${sessionConfig.selectedPersonaId} 不存在，回退默认 User`);
    }
    const personaName = personaRecord?.name?.trim() || 'User';
    // 表情开关：LAN 缺省开启（保持安卓 V1 表情立绘行为；显式 false 关闭）
    const expressionEnabled = cp.expression_display !== false;

    // ---- 4. 加载历史 + 拼接本轮消息（同一存储，保证与桌面端历史一致） ----
    const savedChat = await chatStorageService.getTestChat(characterFilePath, characterFilePath);
    const history: LanChatMessage[] = Array.isArray(savedChat?.messages)
      ? (savedChat!.messages as LanChatMessage[])
      : [];

    const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of history) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      if (!msg.content || String(msg.content).trim().length === 0) continue;
      contextMessages.push({ role: msg.role, content: String(msg.content) });
    }

    // 无历史且角色卡有 first_mes：注入问候（对齐桌面端首次打开行为）
    if (contextMessages.length === 0 && d.first_mes && String(d.first_mes).trim()) {
      contextMessages.push({ role: 'assistant', content: String(d.first_mes) });
    }

    contextMessages.push({ role: 'user', content: userContent });

    // 消息数软限制（对齐桌面端 TokenManagement 关闭时的安全网：默认保留最近 60 条）
    const MAX_MESSAGES = 60;
    let messagesToSend = contextMessages;
    if (messagesToSend.length > MAX_MESSAGES) {
      messagesToSend = messagesToSend.slice(-MAX_MESSAGES);
      if (messagesToSend.length > 0 && messagesToSend[0].role === 'assistant') {
        messagesToSend = messagesToSend.slice(1);
      }
    }

    // ---- 4.5 RAG 检索（Spec: fix-android-chat-feature-parity / Task 3，失败不阻塞） ----
    let ragSections = '';
    const lastUserMessage = [...contextMessages].reverse().find(m => m.role === 'user');
    if (lastUserMessage && lastUserMessage.content) {
      // 区域 1：知识库绑定检索（boundKnowledgeBaseIds 非空时）
      if (sessionConfig.boundKnowledgeBaseIds.length > 0) {
        try {
          const kbResult = await contextManager.retrieveContextWithKeywords(
            [...contextMessages.slice(-20), { role: 'user', content: lastUserMessage.content }],
            {
              topK: 5,
              minScore: 0.3,
              sources: ['worldbook', 'knowledge', 'memory'],
              scopeIds: sessionConfig.boundKnowledgeBaseIds,
            },
            true, // 启用关键词匹配
            4,    // 扫描深度：最近 4 条消息
            undefined
          );
          const items = kbResult.allItems || [];
          if (items.length > 0) {
            const section = items
              .map((item, idx) => `[相关上下文 ${idx + 1}] (来源: ${item.source}, 相关性: ${(item.score * 100).toFixed(1)}%)\n${item.content}`)
              .join('\n\n');
            ragSections += `\n\n═══════════════════════════════════════════════════════`
              + `\n【区域 1：相关背景知识】（以下为从知识库检索的相关背景信息，仅供参考，不是对话的一部分）`
              + `\n═══════════════════════════════════════════════════════\n\n${section}`
              + `\n\n═══════════════════════════════════════════════════════`
              + `\n【区域 1 结束 - 以上背景知识仅供参考】`
              + `\n═══════════════════════════════════════════════════════`;
            console.log(`[LanDialogue] 知识库检索命中 ${items.length} 条`);
          }
        } catch (error) {
          console.warn('[LanDialogue] 知识库检索失败（跳过注入，不阻塞对话）:', error);
        }
      }
      // 区域 2：对话历史 RAG（历史条数 > 40 即 20 轮时触发，对齐桌面端阈值/topK/minScore）
      if (contextMessages.length > 40) {
        try {
          const historyItems = await chatVectorizationService.retrieveChatHistory(
            charName,
            lastUserMessage.content,
            3,    // topK
            0.6   // minScore
          );
          if (historyItems.length > 0) {
            const section = historyItems
              .map((item, idx) => `[历史片段 ${idx + 1}] (相关度: ${(item.score * 100).toFixed(1)}%)\n${item.content}`)
              .join('\n\n');
            ragSections += `\n\n═══════════════════════════════════════════════════════`
              + `\n【区域 2：本会话相关历史片段】（以下为从本对话历史向量检索的相关片段，仅供补充上下文参考，不是当前对话的一部分）`
              + `\n═══════════════════════════════════════════════════════\n\n${section}`
              + `\n\n═══════════════════════════════════════════════════════`
              + `\n【区域 2 结束 - 以上历史片段仅供参考】`
              + `\n═══════════════════════════════════════════════════════`;
            console.log(`[LanDialogue] 历史片段检索命中 ${historyItems.length} 条`);
          }
        } catch (error) {
          console.warn('[LanDialogue] 历史片段检索失败（跳过注入，不阻塞对话）:', error);
        }
      }
    }

    // ---- 4.6 组装系统提示词（顺序对齐桌面端：任务 → RAG 区域 → 记忆表格 → 字数 → 语言 → 表情） ----
    let systemPrompt = buildDialogueTaskPrompt(characterInfo, personaRecord?.persona, personaName);
    systemPrompt += ragSections;

    // 记忆表格注入（区域 3 数据 + 区域 4 编辑指令；Spec: fix-android-chat-feature-parity / Task 4）
    if (sessionConfig.memoryTableEnabled) {
      try {
        const tableResult = chatLogService.getTableData(charName);
        const tableMarkdown = buildMemoryTableMarkdown(tableResult);
        if (tableMarkdown) {
          systemPrompt += `\n\n═══════════════════════════════════════════════════════`
            + `\n【区域 3：记忆表格数据】（以下为已记录的记忆表格，仅供参考，不是对话的一部分）`
            + `\n═══════════════════════════════════════════════════════\n\n${tableMarkdown}`
            + `\n\n═══════════════════════════════════════════════════════`
            + `\n【区域 3 结束 - 以上记忆表格数据仅供参考】`
            + `\n═══════════════════════════════════════════════════════`;
        }
        // 区域 4：异步整理指令（复用桌面端构建器，模板获取失败时使用其内置回退）
        const structure = {
          sheets: tableResult?.sheets || [],
          headers: tableResult?.headers || {},
          descriptions: tableResult?.sheetDescriptions || {},
        };
        const instructions = await buildAsyncTableOrganizeInstructions(tableMarkdown, structure);
        systemPrompt += `\n\n═══════════════════════════════════════════════════════`
          + `\n【区域 4：记忆表格异步整理指令】（以下为系统指令，不是对话内容，请严格按照要求执行）`
          + `\n═══════════════════════════════════════════════════════`
          + instructions
          + `\n═══════════════════════════════════════════════════════`
          + `\n【区域 4 结束 - 以上为系统指令】`
          + `\n═══════════════════════════════════════════════════════`;
      } catch (error) {
        console.warn('[LanDialogue] 记忆表格注入失败（跳过，不阻塞对话）:', error);
      }
    }

    // 字数下限约束（对齐桌面端默认 300；<=0 不注入）
    const minResponseChars = cp.min_response_chars ?? 300;
    if (minResponseChars > 0) {
      systemPrompt += buildLengthGuidancePrompt(minResponseChars, false, charName);
    }
    // 语言约束（对齐桌面端默认中文）
    systemPrompt += buildLanguagePrompt(cp.language ?? 'zh');
    if (expressionEnabled) {
      systemPrompt += buildExpressionPrompt(charName, uploadedEmotionKeys);
    }
    // 辅助模式提示词（Spec: fix-android-chat-parity-v3；对齐桌面端 AssistModeProvider）
    const assistModeEnabled = cp.assist_mode === true;
    if (assistModeEnabled) {
      systemPrompt += buildAssistModePrompt(charName);
    }

    // 标签输出提醒（对齐桌面端 hooks：注入到最后一条 user 消息末尾，
    // 推理模型易在生成正文后直接停止而不输出 <<<EXPRESSION>>> / <<<SUGGESTED_OPTIONS>>> 标签；
    // 注意必须在 requestBody 构造之前完成——messages 在字面量创建时立即求值）
    if (messagesToSend.length > 0) {
      const reminderParts: string[] = ['\n\n【系统提醒】请在回复正文末尾严格按格式输出 <<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>> 标签。'];
      if (assistModeEnabled) {
        reminderParts.push('并在表情标签之前输出 <<<SUGGESTED_OPTIONS>>> 选项块（3个选项，含 <<<END_OPTIONS>>> 结束标记）。');
      }
      const tagReminder = reminderParts.join('');
      let lastUserIdx = -1;
      for (let i = messagesToSend.length - 1; i >= 0; i--) {
        if (messagesToSend[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx >= 0) {
        messagesToSend = [...messagesToSend];
        messagesToSend[lastUserIdx] = {
          ...messagesToSend[lastUserIdx],
          content: messagesToSend[lastUserIdx].content + tagReminder,
        };
      }
    }

    // ---- 5. 构造 AI 请求（对齐渲染进程 ChatEngine.sendMessage） ----
    const baseUrl = String(engine.api_url).trim().replace(/\/+$/, '');
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      handlers.onError({ code: 'AI_NOT_CONFIGURED', message: `无效的 API URL: ${engine.api_url}` });
      return;
    }
    const apiUrl = baseUrl.endsWith('/v1/chat/completions') || baseUrl.endsWith('/v1/completions')
      ? baseUrl
      : `${baseUrl}/v1/chat/completions`;

    // temperature / top_p / max_tokens：会话配置值优先，引擎配置回退（Spec Task 2）
    const temperature = Number(cp.temperature ?? engine.temperature ?? 0.8);
    const requestBody: Record<string, unknown> = {
      model: engine.model_name,
      temperature: isNaN(temperature) ? 0.8 : temperature,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messagesToSend.map(m => ({ role: m.role, content: m.content })),
      ],
    };
    const topP = cp.top_p !== undefined ? Number(cp.top_p) : engine.top_p;
    if (topP !== undefined && !isNaN(Number(topP))) {
      requestBody.top_p = Number(topP);
    }
    const maxTokens = cp.max_tokens !== undefined ? cp.max_tokens : engine.max_tokens;
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      requestBody.max_tokens = maxTokens; // 0 = 不限制（对齐桌面端语义）
    }

    // 停止序列防抢话：用户名变体 + 自定义序列合并（对齐桌面端 buildStopSequences(userName, custom)）
    const customStops = sessionConfig.customStopSequencesEnabled === true
      ? sessionConfig.customStopSequences
      : undefined;
    const stopSequences = buildStopSequences(personaName, customStops);
    const supportsStopArray = engine.capabilities?.supportsStopArray !== false;
    if (stopSequences.length > 0) {
      requestBody.stop = supportsStopArray ? stopSequences : stopSequences[0];
    }

    // 防重复采样参数（Spec: fix-android-chat-parity-v3；会话配置值优先，对齐桌面端防重复预设三档写入的参数）
    if (typeof cp.frequency_penalty === 'number') {
      requestBody.frequency_penalty = cp.frequency_penalty;
    }
    if (typeof cp.presence_penalty === 'number') {
      requestBody.presence_penalty = cp.presence_penalty;
    }
    // DRY 采样仅对声明支持的后端注入（对齐桌面端 ParameterPanel 的 supportsDrySampler 门控）
    if (
      typeof cp.dry_multiplier === 'number' &&
      cp.dry_multiplier > 0 &&
      (engine as any).capabilities?.supportsDrySampler === true
    ) {
      requestBody.dry_multiplier = cp.dry_multiplier;
    }

    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (engine.api_key) {
      const trimmedKey = String(engine.api_key).trim();
      if (engine.api_key_transmission === 'body') {
        requestBody.api_key = trimmedKey;
      } else {
        requestHeaders['Authorization'] = trimmedKey.startsWith('Bearer ') ? trimmedKey : `Bearer ${trimmedKey}`;
      }
    }

    // ---- 6. 流式调用（超时策略对齐主进程 aiHandlers） ----
    controller = new AbortController();
    const connectionTimeout = typeof engine.connection_timeout === 'number' ? engine.connection_timeout : 120000;
    const requestTimeout = typeof engine.request_timeout === 'number' ? engine.request_timeout : 300000;
    if (connectionTimeout > 0) {
      connectionTimeoutId = setTimeout(() => controller?.abort(), connectionTimeout);
    }
    if (requestTimeout > 0) {
      streamTimeoutId = setTimeout(() => controller?.abort(), requestTimeout);
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (connectionTimeoutId) { clearTimeout(connectionTimeoutId); connectionTimeoutId = undefined; }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      handlers.onError({
        code: 'AI_REQUEST_FAILED',
        message: `AI 请求失败: HTTP ${response.status} ${response.statusText}${errText ? ` - ${errText.slice(0, 300)}` : ''}`,
      });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      handlers.onError({ code: 'AI_REQUEST_FAILED', message: 'AI 响应无内容（No response body）' });
      return;
    }

    // ---- 7. 增量解析 SSE 并推送清洗后的 chunk ----
    // 思考内容处理三态（Spec: fix-android-chat-parity-v3）：
    //   strip        流式剥离思考、存储剥离（原行为）
    //   strip_render 流式剥离思考、存储保留 <think>（客户端渲染时剥离）
    //   fold         流式经 onReasoning 推送思考增量、存储保留 <think>（客户端折叠展示）
    const thinkMode = cp.think_tag_mode === 'strip_render' || cp.think_tag_mode === 'fold' ? cp.think_tag_mode : 'strip';
    const sanitizer = new StreamSanitizer(thinkMode, delta => {
      if (delta) handlers.onReasoning?.(delta);
    });
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bufferTail += decoder.decode(value, { stream: true });

      // 只处理到最后一个完整行为止（防跨 chunk 行截断）
      const lastNewline = bufferTail.lastIndexOf('\n');
      if (lastNewline < 0) continue;
      const complete = bufferTail.slice(0, lastNewline + 1);
      bufferTail = bufferTail.slice(lastNewline + 1);

      for (const line of complete.split('\n')) {
        const delta = extractDeltaFromSSELine(line);
        if (delta) {
          const visible = sanitizer.push(delta);
          if (visible) handlers.onChunk(visible);
        }
      }
    }

    // 处理尾部残行
    if (bufferTail.trim()) {
      const delta = extractDeltaFromSSELine(bufferTail);
      if (delta) {
        const visible = sanitizer.push(delta);
        if (visible) handlers.onChunk(visible);
      }
    }
    const tailVisible = sanitizer.flush();
    if (tailVisible) handlers.onChunk(tailVisible);

    if (streamTimeoutId) { clearTimeout(streamTimeoutId); streamTimeoutId = undefined; }

    // ---- 8. 最终解析：情绪 + 权威全文 ----
    // expression_display=false 时不解析情绪（仍调用 parse 以剥离模型可能残留的标记）
    const strippedFull = sanitizer.getFullText();
    const { emotion: parsedEmotion, cleanedContent } = parseExpressionFromContent(strippedFull);
    const emotion = expressionEnabled ? parsedEmotion : null;
    // 三态思考模式决定权威全文（Spec: fix-android-chat-parity-v3）：
    //   strip        → 剥离 think 后的正文（原行为）
    //   strip_render / fold → 保留 <think> 原文（存储保留，客户端按模式渲染），
    //                          表情标记同样基于原文剥离（parse 对含 think 文本安全）
    let finalContent =
      thinkMode === 'strip'
        ? cleanedContent.trim() || strippedFull.trim()
        : (() => {
            const { cleanedContent: rawCleaned } = parseExpressionFromContent(sanitizer.getRawFull());
            return rawCleaned.trim() || sanitizer.getRawFull().trim();
          })();

    // ---- 8.4 辅助模式推荐选项：剥离选项块并推送（Spec: fix-android-chat-parity-v3） ----
    let suggestedOptions: string[] | null = null;
    if (assistModeEnabled) {
      const extractedOptions = extractSuggestedOptions(finalContent);
      if (extractedOptions.matched) {
        suggestedOptions = extractedOptions.options;
        finalContent = extractedOptions.cleaned;
      }
    }

    // ---- 8.5 记忆表格编辑指令：剥离 → 解析 → 执行（Spec Task 4；失败忽略不中断） ----
    let tableEditResult: { executed: number; errors: string[] } | null = null;
    if (sessionConfig.memoryTableEnabled) {
      try {
        const extracted = extractTableEdit(finalContent);
        if (extracted.matched) {
          // 指令文本从存储/展示内容中剥离（用户不可见）
          finalContent = extracted.cleaned;
          if (extracted.raw.trim()) {
            // 重新包装为标准格式供解析器处理（对齐桌面端）
            const wrapped = `<tableEdit><!--\n${extracted.raw}\n--></tableEdit>`;
            const parseResult = tableEditParser.parse(wrapped);
            if (Array.isArray(parseResult.commands) && parseResult.commands.length > 0) {
              const execResult = chatLogService.executeTableEditCommands(charName, parseResult.commands);
              tableEditResult = { executed: execResult.executed || 0, errors: execResult.errors || [] };
              console.log(`[LanDialogue] 表格编辑指令已执行 ${tableEditResult.executed} 条`);
            } else if (parseResult.errors?.length) {
              console.warn('[LanDialogue] 表格编辑指令解析失败（忽略）:', parseResult.errors.join('; '));
            }
          }
        }
      } catch (error) {
        console.warn('[LanDialogue] 表格编辑指令处理异常（忽略）:', error);
      }
    }

    if (!finalContent) {
      handlers.onError({ code: 'AI_EMPTY_RESPONSE', message: 'AI 返回内容为空' });
      return;
    }

    // ---- 9. 持久化（user + assistant 一并写入，与桌面端同一存储） ----
    const now = Date.now();
    const userMessage: LanChatMessage = { id: genMessageId('user'), role: 'user', content: userContent, timestamp: now };
    const assistantMessage: LanChatMessage = {
      id: genMessageId('assistant'),
      role: 'assistant',
      content: finalContent,
      timestamp: now,
      ...(emotion ? { emotion } : {}),
      // 辅助模式推荐选项持久化（与 SSE options 事件同源；重新进入对话页加载历史时可见）
      ...(suggestedOptions && suggestedOptions.length > 0 ? { options: suggestedOptions } : {}),
    };

    const greeting = contextMessages[0]?.role === 'assistant' && history.length === 0 && d.first_mes
      ? [{ id: genMessageId('first'), role: 'assistant' as const, content: String(d.first_mes), timestamp: now }]
      : [];
    const messagesToSave = [...history, ...greeting, userMessage, assistantMessage];

    await chatStorageService.saveTestChat({
      id: savedChat?.id || `test-chat-${now}`,
      creativeId: characterFilePath,
      characterCardId: characterFilePath,
      characterCardName: charName,
      messages: messagesToSave as any,
      createdAt: savedChat?.createdAt || now,
      updatedAt: now,
    });

    // ---- 9.5 增量向量化（fire-and-forget，对齐桌面端每 10 条消息触发一次；失败仅日志不阻塞） ----
    if ((contextMessages.length + 1) % 10 === 0) {
      const recentForVectorize = messagesToSave.slice(-10).map(m => ({
        id: m.id,
        role: m.role,
        content: String(m.content),
        timestamp: m.timestamp,
      }));
      chatVectorizationService.vectorizeIncremental(charName, recentForVectorize).catch(err => {
        console.warn('[LanDialogue] 增量向量化失败（忽略）:', err);
      });
    }

    if (emotion) handlers.onEmotion(emotion);
    // SSE 事件序列：chunk* / reasoning* → emotion? → table? → options? → done（Spec MODIFIED Requirement）
    if (tableEditResult) handlers.onTable?.(tableEditResult);
    if (suggestedOptions) handlers.onOptions?.(suggestedOptions);
    handlers.onDone({
      messageId: assistantMessage.id,
      // 用户消息服务端 id（客户端同步本地消息 id，供卷回/重新生成定位；
      // Spec: fix-android-chat-interaction-parity / Task 7）
      userMessageId: userMessage.id,
      emotion,
      content: finalContent,
      timestamp: assistantMessage.timestamp,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    const message = isAbort
      ? 'AI 请求超时（连接或响应超时，可在服务端引擎设置中调整）'
      : error instanceof Error ? error.message : String(error);
    handlers.onError({ code: isAbort ? 'AI_TIMEOUT' : 'AI_REQUEST_FAILED', message });
  } finally {
    cleanupTimers();
    try { controller?.abort(); } catch { /* 已完成/已中止时忽略 */ }
  }
}
