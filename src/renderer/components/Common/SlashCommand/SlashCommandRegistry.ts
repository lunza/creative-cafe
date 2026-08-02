// 命令参数建议类型
export type ArgSuggestions = string[] | ((ctx: SlashCommandContext) => string[] | Promise<string[]>);

// 斜杠命令上下文
export interface SlashCommandContext {
  /** 当前输入框文本 */
  input: string;
  /** 当前角色卡ID */
  characterCardId?: string;
  /** 获取可用模型列表 */
  getAvailableModels?: () => Promise<string[]>;
}

// 斜杠命令定义
export interface SlashCommand {
  /** 命令名（不含 / 前缀），如 'help' */
  name: string;
  /** 命令描述 */
  description: string;
  /** 命令别名 */
  aliases?: string[];
  /** 参数建议（静态列表或动态生成函数） */
  argSuggestions?: ArgSuggestions;
  /** 参数说明文本（显示在补全列表中） */
  argDescription?: string;
  /** 命令处理函数 */
  handler: (args: string, ctx: SlashCommandContext) => void | Promise<void>;
  /** 是否需要确认（如 /reset） */
  requireConfirm?: boolean;
}

// 注册中心类
class SlashCommandRegistryImpl {
  private commands = new Map<string, SlashCommand>();

  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
    // 注册别名
    command.aliases?.forEach(alias => {
      this.commands.set(alias, command);
    });
  }

  unregister(name: string): void {
    const cmd = this.commands.get(name);
    if (cmd) {
      this.commands.delete(name);
      cmd.aliases?.forEach(alias => this.commands.delete(alias));
    }
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  getAll(): SlashCommand[] {
    // 去重（别名指向同一命令）
    const seen = new Set<string>();
    const result: SlashCommand[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  /** 模糊搜索命令 */
  search(query: string): SlashCommand[] {
    const all = this.getAll();
    if (!query) return all;
    const lower = query.toLowerCase();
    return all.filter(cmd =>
      cmd.name.toLowerCase().includes(lower) ||
      cmd.description.toLowerCase().includes(lower)
    );
  }
}

export const slashCommandRegistry = new SlashCommandRegistryImpl();
