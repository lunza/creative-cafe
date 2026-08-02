import { slashCommandRegistry } from './SlashCommandRegistry';
import type { SlashCommandContext } from './SlashCommandRegistry';

// 命令回调接口（由 ChatInputBar 注入实际实现）
export interface SlashCommandCallbacks {
  onReset?: () => void;
  onRetry?: () => void;
  onContinue?: () => void;
  onPolish?: () => void;
  onAIReply?: () => void;
  onClear?: () => void;
  onModelChange?: (model: string) => void;
  onHelp?: () => void;
}

let callbacksRef: SlashCommandCallbacks = {};

export function setSlashCommandCallbacks(callbacks: SlashCommandCallbacks) {
  callbacksRef = callbacks;
}

export function registerBuiltinCommands() {
  slashCommandRegistry.register({
    name: 'help',
    description: '显示可用命令列表',
    handler: () => callbacksRef.onHelp?.(),
  });

  slashCommandRegistry.register({
    name: 'reset',
    description: '重置当前对话（清空所有消息）',
    requireConfirm: true,
    handler: () => callbacksRef.onReset?.(),
  });

  slashCommandRegistry.register({
    name: 'retry',
    description: '重新生成上一条 AI 回复',
    handler: () => callbacksRef.onRetry?.(),
  });

  slashCommandRegistry.register({
    name: 'continue',
    description: '继续生成上一条 AI 回复',
    handler: () => callbacksRef.onContinue?.(),
  });

  slashCommandRegistry.register({
    name: 'polish',
    description: '润色当前输入框文本',
    handler: () => callbacksRef.onPolish?.(),
  });

  slashCommandRegistry.register({
    name: 'ai-reply',
    description: '以当前用户人设生成对话回复',
    aliases: ['ai', 'reply'],
    handler: () => callbacksRef.onAIReply?.(),
  });

  slashCommandRegistry.register({
    name: 'model',
    description: '切换 AI 模型',
    argDescription: '<provider/model>',
    argSuggestions: async (ctx: SlashCommandContext) => {
      if (ctx.getAvailableModels) {
        return await ctx.getAvailableModels();
      }
      return [];
    },
    handler: (args) => {
      if (args.trim()) {
        callbacksRef.onModelChange?.(args.trim());
      }
    },
  });

  slashCommandRegistry.register({
    name: 'clear',
    description: '清空当前对话',
    requireConfirm: true,
    handler: () => callbacksRef.onClear?.(),
  });
}
