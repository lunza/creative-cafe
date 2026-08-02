/**
 * useAgentDialogue —— 智能体对话 React Hook
 *
 * 职责：
 *  1. 管理 dialogue 模式下的消息列表（user / assistant）与流式状态
 *  2. 通过 window.electronAPI.agent.run 发起流式对话，订阅 onToken / onDone
 *  3. 提供 sendMessage / cancel / reset 供 UI 调用
 *
 * 放置于 src/renderer/components/AgentCenter/hooks/（AgentCenter 专用）。
 *
 * 对标参考：src/renderer/components/AgentCenter/hooks/useAgentConfigs.ts
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { message } from 'antd';
import type { AgentConfig } from '../../../../shared/types/agent-center.types';
import { useSettingStore } from '../../../stores/settingStore';
import { isSystemCommand, parseSystemCommand } from '../../Common/SlashCommand/systemCommands';
import {
  recognizeIntent, formatIntentThought, injectIntentIntoSystemPrompt,
  type IntentRecognitionResult,
} from './intentRecognizer';
import type { AgentParams, AssistModeIntensity } from './useAgentParams';
/**
 * 构建辅助模式提示词段落。
 *
 * 根据 intensity 控制选项生成的主动性程度。
 * 使用 <<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>> 纯文本标记格式。
 */
function buildAssistModePrompt(intensity: AssistModeIntensity): string {
  const intensityGuide = intensity === 'low'
    ? '选项应贴合当前话题，倾向于延续现有对话方向，引导性较弱。不主动引入新话题或新元素。'
    : intensity === 'high'
    ? '选项应大胆创新，主动引入新元素或全新话题分支，积极引导对话方向转变。可以提出意想不到的选项。'
    : '选项应适度转换角度，保持对话张力。一个选项稳妥推进，一个平衡探索，一个适度创新。';

  return `

## 辅助模式
在回复正文结束后，请生成 3 个推荐选项供用户选择下一步对话方向。

**要求：**
1. 每个选项用 \`()\` 包裹动作描写，用 \`""\` 包裹对话内容
2. 三个选项各有侧重：稳妥推进、平衡探索、发散创新
3. ${intensityGuide}

**输出格式（严格遵循）：**
<<<SUGGESTED_OPTIONS>>>
1. (动作描写)"对话内容"
2. (动作描写)"对话内容"
3. (动作描写)"对话内容"
<<<END_OPTIONS>>>`;
}

/**
 * 从 AI 回复内容中解析辅助模式选项，并从内容中剥离选项块。
 *
 * @returns { content, suggestedOptions } — 剥离后的正文和选项数组
 */
function parseAssistModeOptions(content: string): { content: string; suggestedOptions?: string[] } {
  const patterns: { regex: RegExp; name: string }[] = [
    { regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)<<<END_OPTIONS>>>/i, name: 'text-marker' },
    { regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)$/i, name: 'text-marker-unclosed' },
    { regex: /<!--\s*<suggestedOptions>([\s\S]*?)<\/suggestedOptions>\s*-->/i, name: 'html-comment' },
    { regex: /<suggestedOptions>([\s\S]*?)<\/suggestedOptions>/i, name: 'plain-tag' },
    { regex: /<suggestedOptions>([\s\S]*?)$/i, name: 'plain-tag-unclosed' },
    { regex: /\[suggested_options\]\s*([\s\S]*?)\[\/suggested_options\]/i, name: 'bracket-tag' },
  ];

  for (const { regex } of patterns) {
    const match = content.match(regex);
    if (!match) continue;

    const fullMatch = match[0];
    const optionsText = match[1];

    const options = optionsText
      .split('\n')
      .map(line => line
        .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
        .replace(/^\d+[\.\)、\)]\s*/, '')
        .replace(/^[-\*]\s*/, '')
        .replace(/^\(\d+\)\s*/, '')
        .trim()
      )
      .filter(line => line.length > 0 && !/^<<<|^<!--|^<suggestedOptions|^<\/suggestedOptions|^\[\/?suggested/i.test(line))
      .slice(0, 3);

    if (options.length > 0) {
      const cleanedContent = content.replace(fullMatch, '').trim();
      return { content: cleanedContent, suggestedOptions: options };
    }
  }

  return { content };
}

/**
 * 从用户输入的参数中提取世界书名称和附加上下文。
 *
 * 用户可能输入 `/编写 神秘别墅.json，有任何疑问随时问我`，
 * 此时文件名是 `神秘别墅.json`，附加指令是 `有任何疑问随时问我`。
 *
 * 提取策略：
 *  1. 尝试匹配 `.json` / `.json5` / `.tags.json` 扩展名，扩展名后的内容视为附加指令
 *  2. 若无扩展名，按中文标点（，。！？、；）分割，第一段为名称
 *  3. 若无中文标点，按空格分割，第一段为名称
 *  4. 兜底：整个 args 作为名称
 */
function extractWorldbookNameAndExtra(args: string): { name: string; extra: string } {
  const trimmed = args.trim();
  if (!trimmed) return { name: '', extra: '' };

  // 策略 1：匹配文件扩展名（.json / .json5 / .tags.json）
  // 匹配到扩展名后，后续内容（可能有中文标点或空格分隔）作为 extra
  const extMatch = trimmed.match(/^(.+?\.(?:tags\.json|json5?))(?:[，。！？、；\s,;.!?](.*))?$/s);
  if (extMatch) {
    return { name: extMatch[1].trim(), extra: (extMatch[2] || '').trim() };
  }

  // 策略 2：按中文标点分割
  const punctSplit = trimmed.split(/[，。！？、；]/);
  if (punctSplit.length > 1) {
    return { name: punctSplit[0].trim(), extra: punctSplit.slice(1).join('，').trim() };
  }

  // 策略 3：按空格分割
  const spaceSplit = trimmed.split(/\s+/);
  if (spaceSplit.length > 1) {
    return { name: spaceSplit[0].trim(), extra: spaceSplit.slice(1).join(' ').trim() };
  }

  // 兜底：整个 args 作为名称
  return { name: trimmed, extra: '' };
}

/** 对话消息 */
export interface DialogueMessage {
  role: 'user' | 'assistant';
  content: string;
  /** true 表示正在流式接收中 */
  streaming?: boolean;
  /** 辅助模式推荐选项（解析后从 content 中剥离） */
  suggestedOptions?: string[];
  /** 进度面板消息标识（内部使用，用于实时更新单条消息） */
  _progressPanelId?: string;
}

/** useAgentDialogue 返回值 */
export interface UseAgentDialogueReturn {
  messages: DialogueMessage[];
  /** 是否正在等待 agent 响应 */
  streaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  /** 优化输入文本，返回优化后的文本 */
  optimizeInput: (originalText: string) => Promise<string>;
  /** 是否正在优化输入 */
  isOptimizing: boolean;
  /** 取消正在进行的优化 */
  cancelOptimize: () => void;
  /** 是否正在识别意图 */
  isRecognizingIntent: boolean;
  /** 最近一次意图识别结果（null 表示未识别或识别失败） */
  lastIntent: IntentRecognitionResult | null;
}

/**
 * 从 AgentConfig 构建系统提示词。
 *
 * 格式：`[全局system_prompt\n\n]你是「{name}」。{description}\n\n你的类型是：{type}，运行模式是：{mode}。请以你的身份和职责与用户进行对话。`
 * 如果有 identity.emoji，在智能体提示词开头加上 emoji。
 * 如果设置面板中配置了全局 system_prompt，则前置到最前方（与普通对话行为一致）。
 */
function buildSystemPrompt(agent: AgentConfig, globalSystemPrompt?: string, params?: AgentParams): string {
  const emoji = agent.identity?.emoji ? `${agent.identity.emoji} ` : '';
  const agentPrompt = `${emoji}你是「${agent.name}」。${agent.description}\n\n你的类型是：${agent.type}，运行模式是：${agent.mode}。请以你的身份和职责与用户进行对话。`;

  // 系统智能体能力强化段落
  const capabilityEnhancement = agent.isSystem ? `

## 能力与行为准则

### 角色定位
你是 Creative Cafe 的系统智能体，具备代码开发、问题解答、任务规划、世界书编写与审核等综合能力。你可以处理各类用户需求，包括但不限于创作辅助、设定分析、内容审核和系统操作。

### 思考框架
面对复杂问题时，请遵循以下思考流程：
1. **理解意图**：准确识别用户的核心需求和隐含期望
2. **分解任务**：将复杂需求拆解为可执行的子步骤
3. **逐步执行**：按计划依次完成每个子步骤，给出中间结论
4. **汇总结果**：整合各步骤结果，给出结构化的最终回答

### 工具使用
你拥有工具调用能力。遇到需要数据支撑的场景（如查询世界书、搜索记忆、更新状态表等），应主动调用相关工具获取信息，而非凭空推测。工具调用失败时，说明情况并提供替代方案。

### 多步推理
对于多步骤任务：
- 先明确列出执行计划，让用户了解你的思路
- 逐步执行，每步完成后给出简要的中间结论
- 如发现计划需要调整，及时说明原因并修正
- 最终汇总各步结果，给出完整回答

### 回答规范
- 回答结构化、逻辑清晰
- 复杂分析使用分点列表或表格
- 代码使用代码块包裹，注明语言
- 对不确定的信息明确标注"不确定"或"需要验证"
- 保持专业但友好的语气` : '';

  // 人格风格段落（仅影响交互风格，不影响身份职责）
  const personalityStyle = params?.customPersonality?.trim() ? `

## 人格风格
${params.customPersonality.trim()}

注意：以上人格风格仅影响你的回复语气和表达方式，不改变你的身份和职责。` : '';

  // 辅助模式段落
  const assistModePrompt = params?.assistMode ? buildAssistModePrompt(params.assistModeIntensity) : '';

  const fullPrompt = `${agentPrompt}${capabilityEnhancement}${personalityStyle}${assistModePrompt}`;
  const trimmedGlobal = globalSystemPrompt?.trim();
  return trimmedGlobal ? `${trimmedGlobal}\n\n${fullPrompt}` : fullPrompt;
}

/**
 * 根据智能体的 type 和 mode 生成开场白。
 *
 * 开场白引导用户了解接下来如何与该智能体对话，
 * 不同类型的智能体有不同的引导方向。
 */
function buildGreeting(agent: AgentConfig): string {
  const emoji = agent.identity?.emoji ? `${agent.identity.emoji} ` : '';
  const name = agent.name || '智能体';
  const desc = agent.description ? `${agent.description}\n\n` : '';

  const guideMap: Record<string, string> = {
    dialogue: '你可以直接和我聊天，我会根据你的话题进行对话。有什么想聊的吗？',
    writing: '告诉我你想写什么内容、风格和篇幅，我来帮你创作或润色。',
    worldbook: '描述你想要构建的世界观或主题，我来帮你编写世界书条目。',
    game: '告诉我你想玩什么类型的游戏，我来担任游戏主持人。',
    custom: '告诉我你的需求，我会尽力帮助你。',
  };

  const guide = guideMap[agent.mode] || guideMap[agent.type] || guideMap.custom;

  // 系统智能体（isSystem）追加指令列表
  const commandList = agent.isSystem
    ? `\n\n**可用指令：**\n- \`/世界书\` — 列出所有世界书\n- \`/角色卡\` — 列出所有角色卡\n- \`/编写 <名称>\` — 启动世界书编写\n- \`/审核 <名称>\` — 审核世界书\n- \`/帮助\` — 显示指令列表`
    : '';

  return `${emoji}你好！我是「${name}」。\n\n${desc}${guide}${commandList}`;
}

export function useAgentDialogue(agent: AgentConfig, params?: AgentParams): UseAgentDialogueReturn {
  const [messages, setMessages] = useState<DialogueMessage[]>(() => [
    { role: 'assistant', content: buildGreeting(agent) },
  ]);
  const [streaming, setStreaming] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const optimizeAbortRef = useRef(false);
  // 跟踪 optimize 的实际运行状态（区别于 React state，防止 cancelOptimize 后重入竞态）
  const optimizeRunningRef = useRef(false);

  // 意图识别状态
  const [isRecognizingIntent, setIsRecognizingIntent] = useState(false);
  const [lastIntent, setLastIntent] = useState<IntentRecognitionResult | null>(null);
  // 同步跟踪意图识别运行状态（防止 agent.run activeRuns 竞态）
  const recognizingIntentRef = useRef(false);

  // onToken / onDone 的取消订阅函数
  const unsubscribeTokenRef = useRef<(() => void) | null>(null);
  const unsubscribeDoneRef = useRef<(() => void) | null>(null);
  // 是否正在运行 agent run（同步跟踪，避免闭包陷阱）
  const runningRef = useRef(false);
  // 累积的 token 内容（用于判断 token 流是否为空）
  const accumulatedContentRef = useRef('');
  // messages 的最新值镜像（供 sendMessage 同步读取，避免闭包陷阱）
  const messagesRef = useRef<DialogueMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** 追加 assistant 消息到对话流 */
  const appendAssistantMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { role: 'assistant', content }]);
  }, []);

  /** 处理 /世界书 指令 */
  const handleListWorldbooks = useCallback(async (): Promise<string> => {
    try {
      const books = await window.electronAPI.worldBook.list();
      if (!books || books.length === 0) {
        return '当前没有可用的世界书。';
      }
      const lines = books.map((b: any, i: number) =>
        `${i + 1}. **${b.name}** — ${b.size ? `${(b.size / 1024).toFixed(1)}KB` : '未知大小'}${b.modified ? `，更新于 ${new Date(b.modified).toLocaleDateString('zh-CN')}` : ''}`
      );
      return `📚 **世界书列表**（共 ${books.length} 本）\n\n${lines.join('\n')}`;
    } catch (err) {
      return `获取世界书列表失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }, []);

  /** 处理 /角色卡 指令 */
  const handleListCharacters = useCallback(async (): Promise<string> => {
    try {
      const characters = await window.electronAPI.character.list();
      if (!characters || characters.length === 0) {
        return '当前没有可用的角色卡。';
      }
      const lines = characters.map((c: any, i: number) => {
        const name = c.data?.name || c.characterName || c.name || '未命名';
        const desc = c.data?.description ? c.data.description.slice(0, 50) + '...' : '';
        return `${i + 1}. **${name}**${desc ? ` — ${desc}` : ''}`;
      });
      return `🎭 **角色卡列表**（共 ${characters.length} 张）\n\n${lines.join('\n')}`;
    } catch (err) {
      return `获取角色卡列表失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }, []);

  /** 处理 /编写 指令 — 走 agent.run 流式对话路径 */
  const handleWriteWorldbook = useCallback(async (rawArgs: string): Promise<void> => {
    const { name, extra } = extractWorldbookNameAndExtra(rawArgs);
    if (!name) {
      appendAssistantMessage('请指定世界书名称，格式：`/编写 <世界书名称>`\n使用 `/世界书` 查看可用列表。');
      return;
    }
    try {
      const books = await window.electronAPI.worldBook.list();
      const matched = books.find((b: any) =>
        b.name === name || b.name === `${name}.json` || b.name === `${name}.json5` || b.name.replace(/\.(json5?|tags\.json)$/, '') === name
      );
      if (!matched) {
        appendAssistantMessage(`未找到名为「${name}」的世界书。请使用 \`/世界书\` 查看可用列表。`);
        return;
      }

      const displayName = matched.name.replace(/\.(json5?|tags\.json)$/, '');
      const worldBookPath = matched.path;

      // 构建编写请求消息 — 将世界书路径和附加上下文作为用户消息内容
      const writePrompt = extra
        ? `请为世界书「${displayName}」编写内容。文件路径：${worldBookPath}。用户附加说明：${extra}`
        : `请为世界书「${displayName}」编写内容。文件路径：${worldBookPath}`;

      // 追加 user 消息
      setMessages(prev => [...prev, { role: 'user', content: writePrompt }]);

      // 获取技能提示词片段
      let skillSnippet = '';
      try {
        const snippetResult = await window.electronAPI.skill.getPromptSnippet();
        if (snippetResult?.success && snippetResult.snippet) {
          skillSnippet = snippetResult.snippet;
        }
      } catch {
        // 静默降级
      }

      // 构建 systemPrompt
      const { setting } = useSettingStore.getState();
      const activeEngine = setting?.aiEngines?.find(e => e.id === setting.activeEngineId) ?? setting?.aiEngines?.[0];
      const globalSystemPrompt = activeEngine?.system_prompt;
      const baseSystemPrompt = buildSystemPrompt(agent, globalSystemPrompt, params);
      const effectiveSystemPrompt = skillSnippet
        ? `${baseSystemPrompt}\n\n${skillSnippet}`
        : baseSystemPrompt;

      // 创建 assistant 占位消息（streaming=true）
      const assistantPlaceholder: DialogueMessage = { role: 'assistant', content: '', streaming: true };
      setMessages(prev => [...prev, assistantPlaceholder]);
      setStreaming(true);
      runningRef.current = true;
      accumulatedContentRef.current = '';

      // 订阅 token 流
      unsubscribeTokenRef.current = window.electronAPI.agent.onToken((data) => {
        accumulatedContentRef.current += data.chunk || '';
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: accumulatedContentRef.current }];
          }
          return prev;
        });
      });

      unsubscribeDoneRef.current = window.electronAPI.agent.onDone((data) => {
        console.log('[useAgentDialogue] agent:done', data?.finishReason);
      });

      try {
        const result = await window.electronAPI.agent.run({
          systemPrompt: effectiveSystemPrompt,
          messages: [{ role: 'user', content: writePrompt }],
          context: {
            mode: 'worldbook',
            characterId: undefined,
            sessionId: undefined,
            allowedWorldBookPaths: [worldBookPath],
          },
          maxIterations: 30,
          timeoutMs: 600000,
        });

        // agent.run 返回后：标记 assistant 消息 streaming=false
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role === 'assistant' && last.streaming) {
            // 如果 token 流为空，用 result.result.content 填充
            const finalContent = accumulatedContentRef.current || result?.result?.content || '';
            const suggestedOptions = parseAssistModeOptions(finalContent).suggestedOptions;
            return [...prev.slice(0, -1), { ...last, content: finalContent, streaming: false, suggestedOptions }];
          }
          return prev;
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role === 'assistant' && last.streaming) {
            const newContent = `${last.content}\n\n[错误] ${errMsg}`.trim();
            return [...prev.slice(0, -1), { ...last, content: newContent, streaming: false }];
          }
          return prev;
        });
      } finally {
        setStreaming(false);
        runningRef.current = false;
        unsubscribeTokenRef.current?.();
        unsubscribeTokenRef.current = null;
        unsubscribeDoneRef.current?.();
        unsubscribeDoneRef.current = null;
      }
    } catch (err) {
      appendAssistantMessage(`启动世界书编写失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [agent, params, appendAssistantMessage]);

  /** 处理 /审核 指令 */
  const handleAuditWorldbook = useCallback(async (rawArgs: string): Promise<string> => {
    const { name, extra } = extractWorldbookNameAndExtra(rawArgs);
    if (!name) {
      return '请指定世界书名称，格式：`/审核 <世界书名称>`\n使用 `/世界书` 查看可用列表。';
    }
    try {
      const books = await window.electronAPI.worldBook.list();
      const matched = books.find((b: any) =>
        b.name === name || b.name === `${name}.json` || b.name === `${name}.json5` || b.name.replace(/\.(json5?|tags\.json)$/, '') === name
      );
      if (!matched) {
        return `未找到名为「${name}」的世界书。请使用 \`/世界书\` 查看可用列表。`;
      }

      const displayName = matched.name.replace(/\.(json5?|tags\.json)$/, '');

      setMessages(prev => [...prev, { role: 'assistant', content: `正在审核世界书「${displayName}」…` }]);

      // 读取世界书内容
      const worldbookData = await window.electronAPI.worldBook.read(matched.path);
      if (!worldbookData) {
        return `读取世界书「${displayName}」失败。`;
      }

      // 使用 agent.run 执行审核
      const entries = worldbookData.entries || {};
      const entryList = Object.values(entries) as any[];
      const entryCount = entryList.length;

      const auditPrompt = `你是一个世界书审核专家。请审核以下世界书内容，从三个维度进行评估：

1. **完整性**：必填字段（key/content）是否齐全，维度覆盖是否充分
2. **一致性**：关键词是否存在冲突，设定是否矛盾
3. **符合度**：条目内容是否与世界书主题一致

世界书名称：${displayName}
条目数量：${entryCount}

条目摘要（前10条）：
${entryList.slice(0, 10).map((e: any, i: number) => `${i+1}. key: ${JSON.stringify(e.key || [])}, content: ${(e.content || '').slice(0, 100)}...`).join('\n')}

请给出三维评分（0-100）和主要问题列表。`;

      const { setting } = useSettingStore.getState();
      const activeEngine = setting?.aiEngines?.find(e => e.id === setting.activeEngineId) ?? setting?.aiEngines?.[0];
      const globalSystemPrompt = activeEngine?.system_prompt;
      const systemPrompt = buildSystemPrompt(agent, globalSystemPrompt);

      // 获取技能提示词片段并注入
      let effectiveAuditSystemPrompt = systemPrompt;
      try {
        const snippetResult = await window.electronAPI.skill.getPromptSnippet();
        if (snippetResult?.success && snippetResult?.prompt) {
          effectiveAuditSystemPrompt = `${systemPrompt}\n\n${snippetResult.prompt}`;
        }
      } catch {
        // 技能 prompt 获取失败时不阻塞审核
      }

      const userMessage = extra
        ? `请审核世界书「${displayName}」。用户补充说明：${extra}`
        : `请审核世界书「${displayName}」`;

      const result = await window.electronAPI.agent.run({
        systemPrompt: `${effectiveAuditSystemPrompt}\n\n${auditPrompt}`,
        messages: [{ role: 'user', content: userMessage }],
        context: { mode: agent.mode },
        maxIterations: 4,
        timeoutMs: 120000,
      });

      if (result?.success && result?.result?.content) {
        return `🔍 **世界书「${displayName}」审核结果**\n\n${result.result.content}`;
      } else {
        return `❌ 审核失败：${result?.error || '未知错误'}`;
      }
    } catch (err) {
      return `审核世界书失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }, [agent]);

  /** 处理 /帮助 指令 */
  const handleHelp = useCallback(async (): Promise<string> => {
    return `**可用系统指令：**\n\n` +
      `| 指令 | 说明 |\n` +
      `|------|------|\n` +
      `| \`/世界书\` | 列出所有世界书 |\n` +
      `| \`/角色卡\` | 列出所有角色卡 |\n` +
      `| \`/编写 <名称>\` | 启动世界书编写流程 |\n` +
      `| \`/审核 <名称>\` | 审核指定世界书 |\n` +
      `| \`/帮助\` | 显示本指令列表 |\n\n` +
      `也可以直接输入消息与我对话。`;
  }, []);

  /** 优化输入文本 */
  const optimizeInput = useCallback(async (originalText: string): Promise<string> => {
    if (!originalText || !originalText.trim()) {
      message.warning('请先输入需要优化的文本');
      return '';
    }
    // 使用 ref 而非 React state 检查，防止 cancelOptimize 后 isOptimizing=false 但 agent.run 仍未释放 activeRuns 锁的竞态
    if (optimizeRunningRef.current) {
      message.warning('上一次优化仍在进行中，请稍候');
      return '';
    }

    optimizeRunningRef.current = true;
    setIsOptimizing(true);
    optimizeAbortRef.current = false;

    try {
      const { setting } = useSettingStore.getState();
      const activeEngine = setting?.aiEngines?.find(e => e.id === setting.activeEngineId) ?? setting?.aiEngines?.[0];
      const globalSystemPrompt = activeEngine?.system_prompt;

      const optimizeSystemPrompt = `${globalSystemPrompt ? globalSystemPrompt + '\n\n' : ''}你是一个文本优化助手。请对用户输入的文本进行智能优化：

1. **提升表述清晰度**：使语句更加通顺、表达更加准确
2. **增强指令完整性**：如果是指令或请求，补充必要的上下文和细节
3. **修正语法错误**：纠正拼写、标点、语法问题
4. **保持原意不变**：优化过程必须保持用户的原始意图

**重要**：直接输出优化后的文本，不要添加任何解释、前缀或后缀。`;

      const result = await window.electronAPI.agent.run({
        systemPrompt: optimizeSystemPrompt,
        messages: [{ role: 'user', content: originalText }],
        context: { mode: 'dialogue' },
        maxIterations: 1,
        timeoutMs: 30000,
      });

      if (optimizeAbortRef.current) {
        return originalText;
      }

      if (result?.success && result?.result?.content) {
        return result.result.content.trim();
      } else {
        message.warning('优化失败，请稍后重试');
        return originalText;
      }
    } catch (err) {
      console.error('[useAgentDialogue] optimizeInput error:', err);
      return originalText;
    } finally {
      optimizeRunningRef.current = false;
      setIsOptimizing(false);
      optimizeAbortRef.current = false;
    }
  }, []);

  /** 取消优化 */
  const cancelOptimize = useCallback(() => {
    optimizeAbortRef.current = true;
    setIsOptimizing(false);
    // 实际取消运行中的 agent.run，释放 activeRuns 单实例锁
    void window.electronAPI.agent.cancel();
  }, []);

  /**
   * 发送消息。
   *
   * 流程：
   *  1. 空内容 / streaming 时阻止提交
   *  2. 追加 user 消息 + 空 assistant 占位消息（streaming=true）
   *  3. 订阅 onToken（累加到最后一条 assistant 消息） / onDone（仅日志）
   *  4. 调用 agent.run（阻塞，返回 { success, result?, error? }）
   *  5. 返回后标记 assistant streaming=false；token 流为空时用 result.result.content 填充
   *  6. 失败时追加 error 信息到 assistant 消息内容
   *  7. finally 取消订阅
   */
  const sendMessage = useCallback(async (content: string) => {
    // 空内容阻止提交
    if (!content || !content.trim()) {
      message.warning('请输入内容');
      return;
    }
    // 正在流式响应时阻止重复提交
    if (runningRef.current) {
      message.warning('正在等待回复，请稍候');
      return;
    }
    // 意图识别进行中也阻止重复提交（agent.run 共享 activeRuns 单实例锁）
    if (recognizingIntentRef.current) {
      message.warning('正在分析意图，请稍候');
      return;
    }

    // === 系统指令检测 ===
    if (isSystemCommand(content.trim())) {
      const parsed = parseSystemCommand(content.trim());
      if (parsed) {
        // 追加 user 消息
        setMessages(prev => [...prev, { role: 'user', content }]);

        const { name, args } = parsed;
        let resultContent: string;

        switch (name) {
          case '世界书':
            resultContent = await handleListWorldbooks();
            break;
          case '角色卡':
            resultContent = await handleListCharacters();
            break;
          case '编写':
            await handleWriteWorldbook(args);
            return;  // handleWriteWorldbook 自己管理消息追加和流式输出
          case '审核':
            resultContent = await handleAuditWorldbook(args);
            break;
          case '帮助':
            resultContent = await handleHelp();
            break;
          default:
            resultContent = `未知指令：/${name}。输入 /帮助 查看可用指令列表。`;
        }

        appendAssistantMessage(resultContent);
        return;
      }
    }

    // === 无效 / 指令检测 ===
    const trimmed = content.trim();
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      const cmdName = trimmed.slice(1).split(/\s+/)[0];
      setMessages(prev => [...prev,
        { role: 'user', content },
        { role: 'assistant', content: `未知指令：/${cmdName}。输入 /帮助 查看可用指令列表。` }
      ]);
      return;
    }

    // === 意图识别前置处理 ===
    // 在发送给执行智能体之前，先用轻量级 LLM 调用识别用户意图
    // 识别失败时静默降级，不阻断正常对话
    recognizingIntentRef.current = true;
    setIsRecognizingIntent(true);
    setLastIntent(null);

    const { setting: settingForIntent } = useSettingStore.getState();
    const activeEngineForIntent = settingForIntent?.aiEngines?.find(e => e.id === settingForIntent.activeEngineId) ?? settingForIntent?.aiEngines?.[0];
    const globalSystemPromptForIntent = activeEngineForIntent?.system_prompt;

    let intentResult: IntentRecognitionResult | null = null;
    try {
      intentResult = await recognizeIntent(
        content,
        {
          name: agent.name,
          description: agent.description,
          mode: agent.mode,
          isSystem: agent.isSystem,
        },
        globalSystemPromptForIntent,
      );

      if (intentResult) {
        setLastIntent(intentResult);
        // 将意图识别结果以「思考过程」展示给用户
        const thoughtText = formatIntentThought(intentResult);
        setMessages(prev => [...prev, { role: 'assistant', content: thoughtText }]);
      }
    } catch {
      // 意图识别失败时静默降级
    } finally {
      recognizingIntentRef.current = false;
      setIsRecognizingIntent(false);
    }

    // 从设置中获取当前激活引擎的全局 system_prompt
    const { setting } = useSettingStore.getState();
    const activeEngine = setting?.aiEngines?.find(e => e.id === setting.activeEngineId) ?? setting?.aiEngines?.[0];
    const globalSystemPrompt = activeEngine?.system_prompt;

    const systemPrompt = buildSystemPrompt(agent, globalSystemPrompt, params);

    // 将意图识别结果注入 systemPrompt
    const effectiveSystemPromptWithIntent = intentResult
      ? injectIntentIntoSystemPrompt(systemPrompt, intentResult)
      : systemPrompt;

    // 获取技能提示词片段并注入（<available_skills> XML 块）
    let effectiveSystemPrompt = effectiveSystemPromptWithIntent;
    try {
      const snippetResult = await window.electronAPI.skill.getPromptSnippet();
      if (snippetResult?.success && snippetResult?.prompt) {
        effectiveSystemPrompt = `${systemPrompt}\n\n${snippetResult.prompt}`;
      }
    } catch {
      // 技能 prompt 获取失败时不阻塞对话
    }

    // 追加 user 消息 + 空 assistant 占位消息（streaming=true）
    const userMessage: DialogueMessage = { role: 'user', content };
    const assistantPlaceholder: DialogueMessage = { role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMessage, assistantPlaceholder]);
    setStreaming(true);
    runningRef.current = true;
    accumulatedContentRef.current = '';

    // 订阅 token 流 —— 每个 chunk 累加到最后一条 assistant 消息的 content
    // 使用函数式 setState 更新 messages，避免闭包陷阱
    unsubscribeTokenRef.current = window.electronAPI.agent.onToken((data) => {
      accumulatedContentRef.current += data.chunk;
      setMessages(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, content: last.content + data.chunk }];
      });
    });

    // 订阅完成事件 —— 仅用于日志
    unsubscribeDoneRef.current = window.electronAPI.agent.onDone((data) => {
      console.log('[useAgentDialogue] agent done:', data);
    });

    try {
      // 构建 messages 参数：当前所有消息（含新增 user + assistant 占位），
      // 但 assistant 占位内容为空时排除
      const allMessages = [...messagesRef.current, userMessage, assistantPlaceholder];
      const payloadMessages = allMessages
        .filter(m => !(m.role === 'assistant' && m.content === ''))
        .map(m => ({ role: m.role, content: m.content }));

      const result = await window.electronAPI.agent.run({
        systemPrompt: effectiveSystemPrompt,
        messages: payloadMessages,
        context: { mode: agent.mode },
        maxIterations: 8,
        timeoutMs: 300000,
      });

      // agent.run 返回后：标记 assistant 消息 streaming=false
      // 如果成功且 token 流为空（accumulatedContent 为空），则用 result.result.content 填充
      // 失败时追加 error 信息到 assistant 消息内容
      // 辅助模式开启时：解析并剥离 <<<SUGGESTED_OPTIONS>>> 选项块
      setMessages(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== 'assistant') return prev;

        let newContent = last.content;
        let suggestedOptions: string[] | undefined;

        if (result.success && result.result?.content && !accumulatedContentRef.current) {
          newContent = result.result.content;
        }
        if (!result.success && result.error) {
          newContent = `${last.content}\n\n[错误] ${result.error}`.trim();
        }

        // 辅助模式选项解析
        if (params?.assistMode && result.success) {
          const parsed = parseAssistModeOptions(newContent);
          newContent = parsed.content;
          suggestedOptions = parsed.suggestedOptions;
        }

        return [...prev.slice(0, -1), { ...last, content: newContent, streaming: false, suggestedOptions }];
      });

      if (!result.success) {
        message.error(result.error || '智能体运行失败');
      }
    } catch (err) {
      // 异常时：标记 streaming=false，追加 error 信息到 assistant 消息内容
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== 'assistant') return prev;
        const newContent = `${last.content}\n\n[错误] ${errMsg}`.trim();
        return [...prev.slice(0, -1), { ...last, content: newContent, streaming: false }];
      });
      message.error(errMsg);
    } finally {
      setStreaming(false);
      runningRef.current = false;
      // 取消订阅 onToken / onDone
      unsubscribeTokenRef.current?.();
      unsubscribeTokenRef.current = null;
      unsubscribeDoneRef.current?.();
      unsubscribeDoneRef.current = null;
    }
  }, [agent, params, appendAssistantMessage, handleListWorldbooks, handleListCharacters, handleWriteWorldbook, handleAuditWorldbook, handleHelp]);

  /**
   * 取消进行中的 agent run。
   */
  const cancel = useCallback(async () => {
    await window.electronAPI.agent.cancel();
    runningRef.current = false;
    setStreaming(false);
    // 标记当前 streaming 的 assistant 消息为 streaming=false
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'assistant' && last.streaming) {
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      }
      return prev;
    });
  }, []);

  /**
   * 重置对话。
   *
   * 取消任何进行中的 agent run，并清空消息列表。
   */
  const reset = useCallback(() => {
    // 取消任何进行中的 agent run
    if (runningRef.current) {
      window.electronAPI.agent.cancel();
    }
    runningRef.current = false;
    setStreaming(false);
    recognizingIntentRef.current = false;
    setIsRecognizingIntent(false);
    setLastIntent(null);
    // 取消订阅
    unsubscribeTokenRef.current?.();
    unsubscribeTokenRef.current = null;
    unsubscribeDoneRef.current?.();
    unsubscribeDoneRef.current = null;
    // 清空 messages 列表，恢复开场白
    setMessages([{ role: 'assistant', content: buildGreeting(agent) }]);
  }, [agent]);

  // 组件卸载时取消订阅 onToken / onDone 并取消进行中的 agent run
  useEffect(() => {
    return () => {
      unsubscribeTokenRef.current?.();
      unsubscribeDoneRef.current?.();
      if (runningRef.current) {
        window.electronAPI.agent.cancel();
      }
    };
  }, []);

  return { messages, streaming, sendMessage, cancel, reset, optimizeInput, isOptimizing, cancelOptimize, isRecognizingIntent, lastIntent };
}

export default useAgentDialogue;
