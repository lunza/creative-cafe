import { slashCommandRegistry } from './SlashCommandRegistry';

// 系统指令回调接口（由 AgentDialogueModal / useAgentDialogue 注入实际实现）
// 每个回调返回 Promise<string>，结果以 assistant 消息形式展示在对话流中
export interface SystemCommandCallbacks {
  /** /世界书 — 列出所有世界书，返回格式化的 Markdown 列表 */
  onListWorldbooks?: () => Promise<string>;
  /** /角色卡 — 列出所有角色卡，返回格式化的 Markdown 列表 */
  onListCharacters?: () => Promise<string>;
  /** /编写 <名称> — 启动世界书编写流程，返回进度/结果消息 */
  onWriteWorldbook?: (name: string) => Promise<string>;
  /** /审核 <名称> — 启动世界书审核流程，返回审核结果 */
  onAuditWorldbook?: (name: string) => Promise<string>;
}

let callbacksRef: SystemCommandCallbacks = {};

export function setSystemCommandCallbacks(callbacks: SystemCommandCallbacks) {
  callbacksRef = callbacks;
}

/** 所有系统指令名（不含 / 前缀） */
const SYSTEM_COMMAND_NAMES = ['世界书', '角色卡', '编写', '审核', '帮助'] as const;

/** 获取所有系统指令名列表 */
export function getSystemCommandNames(): string[] {
  return [...SYSTEM_COMMAND_NAMES];
}

/** 判断消息内容是否匹配系统指令 */
export function isSystemCommand(content: string): boolean {
  if (!content.startsWith('/')) return false;
  const cmdName = content.slice(1).split(/\s+/)[0];
  return (SYSTEM_COMMAND_NAMES as readonly string[]).includes(cmdName);
}

/** 解析系统指令，返回指令名和参数 */
export function parseSystemCommand(content: string): { name: string; args: string } | null {
  if (!content.startsWith('/')) return null;
  const trimmed = content.slice(1).trim();
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  if (!(SYSTEM_COMMAND_NAMES as readonly string[]).includes(name)) return null;
  return { name, args };
}

/**
 * 注册系统指令到斜杠命令注册中心。
 *
 * 系统指令使用中文名称，与 builtinCommands 中的英文指令互补。
 * 注册后可通过 slashCommandRegistry.get('世界书') 等方式查询。
 *
 * 注意：handler 中的回调返回值不在此处处理——实际的指令执行和结果展示
 * 由 useAgentDialogue.ts 中的 sendMessage 逻辑统一管理。
 */
export function registerSystemCommands() {
  slashCommandRegistry.register({
    name: '世界书',
    description: '列出系统中所有世界书',
    handler: async () => {
      await callbacksRef.onListWorldbooks?.();
    },
  });

  slashCommandRegistry.register({
    name: '角色卡',
    description: '列出系统中所有角色卡',
    handler: async () => {
      await callbacksRef.onListCharacters?.();
    },
  });

  slashCommandRegistry.register({
    name: '编写',
    description: '启动指定世界书的编写流程',
    argDescription: '<世界书名称>',
    handler: async (args) => {
      const name = args.trim();
      if (!name) {
        await callbacksRef.onWriteWorldbook?.('');
        return;
      }
      await callbacksRef.onWriteWorldbook?.(name);
    },
  });

  slashCommandRegistry.register({
    name: '审核',
    description: '启动指定世界书的审核流程',
    argDescription: '<世界书名称>',
    handler: async (args) => {
      const name = args.trim();
      if (!name) {
        await callbacksRef.onAuditWorldbook?.('');
        return;
      }
      await callbacksRef.onAuditWorldbook?.(name);
    },
  });

  slashCommandRegistry.register({
    name: '帮助',
    description: '显示所有可用系统指令',
    aliases: ['help'],
    handler: async () => {
      // 帮助信息由 useAgentDialogue 处理展示
    },
  });
}
