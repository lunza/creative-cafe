/**
 * 工具类型契约 —— 适配 openclaw src/tools/types.ts
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\src\tools\types.ts
 * 决策：适配（spec §三）。ToolDescriptor/ToolAvailabilityExpression 直接用；
 *       ToolOwnerRef 简化（本项目无 channel/mcp 所有者，仅 core/plugin）。
 *
 * 职责：
 *  1. 定义工具描述符（ToolDescriptor）—— 工具的元数据契约
 *  2. 定义声明式可用性表达式（ToolAvailabilityExpression）—— 工具何时可见
 *  3. 定义工具所有者引用（ToolOwnerRef）—— 工具的责任归属
 *
 * 设计约束（参考 openclaw AGENTS.md）：
 *  - 工具描述（description）是 prompt：返回模型下一步需要的信息，而非简单 ack
 *  - 工具描述不静态引用其他工具集（gating 控制，避免幻觉）
 *  - 可用性表达式声明式定义：always / auth / config / env / context / allOf / anyOf
 */

// ==================== JSON 类型 ====================

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

// ==================== 工具所有者 ====================

/**
 * 工具所有者引用（简化版）。
 *
 * openclaw 原版支持 core / plugin / channel / mcp 四种所有者；
 * 本项目首期仅 core（内置工具）和 plugin（未来插件系统），简化为两种。
 */
export type ToolOwnerRef =
  | { readonly kind: 'core' }
  | { readonly kind: 'plugin'; readonly pluginId: string };

/**
 * 工具执行器引用（运行时调度目标）。
 */
export type ToolExecutorRef =
  | { readonly kind: 'core'; readonly executorId: string }
  | { readonly kind: 'plugin'; readonly pluginId: string; readonly toolName: string };

// ==================== 声明式可用性表达式 ====================

/**
 * 原子可用性信号（决定工具是否对模型/用户可见）。
 *
 * 适配 openclaw ToolAvailabilitySignal，简化：
 *  - always: 永远可用
 *  - config: 配置项存在/非空时可用
 *  - env: 环境变量存在时可用
 *  - context: 上下文键匹配时可用（如 mode='dialogue'）
 *  - capability: 模型能力支持时可用（如 supportsToolCalling）
 *
 * 去除 auth（本项目无 provider 认证门控）、plugin-enabled（首期无插件系统）。
 */
export type ToolAvailabilitySignal =
  | { readonly kind: 'always' }
  | {
      readonly kind: 'config';
      readonly path: readonly string[];
      readonly check?: 'exists' | 'non-empty' | 'available';
    }
  | { readonly kind: 'env'; readonly name: string }
  | { readonly kind: 'context'; readonly key: string; readonly equals?: JsonPrimitive }
  | { readonly kind: 'capability'; readonly name: string };

/**
 * 布尔表达式（支持 allOf / anyOf 组合）。
 *
 * 用法示例：
 *   { kind: 'always' }  // 永远可用
 *   { allOf: [{ kind: 'context', key: 'mode', equals: 'dialogue' }, { kind: 'capability', name: 'supportsToolCalling' }] }
 *   { anyOf: [{ kind: 'context', key: 'mode', equals: 'writing' }, { kind: 'context', key: 'mode', equals: 'game' }] }
 */
export type ToolAvailabilityExpression =
  | ToolAvailabilitySignal
  | { readonly allOf: readonly ToolAvailabilityExpression[] }
  | { readonly anyOf: readonly ToolAvailabilityExpression[] };

// ==================== 工具描述符 ====================

/**
 * 工具描述符（公开契约）。
 *
 * 生产者（工具注册方）与消费者（agentLoop / prompt 注入）共享此结构。
 * 参考 openclaw AGENTS.md：
 *  - description 是 prompt：描述工具能力，不引用其他工具集
 *  - inputSchema：JSON Schema 格式的参数定义（注入 OpenAI tools 字段）
 *  - availability：声明式可用性（gating，而非运行时试错）
 */
export interface ToolDescriptor {
  /** 工具名（唯一，2-3 词，可 grep） */
  readonly name: string;
  /** 工具标题（UI 展示，可选） */
  readonly title?: string;
  /** 工具描述（模型可见，prompt 文本） */
  readonly description: string;
  /** 输入参数 JSON Schema */
  readonly inputSchema: JsonObject;
  /** 输出结果 JSON Schema（可选） */
  readonly outputSchema?: JsonObject;
  /** 所有者 */
  readonly owner: ToolOwnerRef;
  /** 执行器引用 */
  readonly executor?: ToolExecutorRef;
  /** 声明式可用性 */
  readonly availability?: ToolAvailabilityExpression;
  /** 注解（UI/排序用元数据） */
  readonly annotations?: JsonObject;
  /** 排序键 */
  readonly sortKey?: string;
}

// ==================== 可用性求值 ====================

/**
 * 可用性求值上下文。
 */
export interface AvailabilityContext {
  /** 配置项读取函数 */
  getConfig?: (path: readonly string[]) => unknown;
  /** 环境变量读取函数 */
  getEnv?: (name: string) => string | undefined;
  /** 上下文变量（如 mode, characterId, sessionId） */
  context?: Record<string, JsonPrimitive>;
  /** 模型能力 */
  capabilities?: Record<string, boolean>;
}

/**
 * 求值可用性表达式。
 *
 * @param expr 可用性表达式
 * @param ctx 求值上下文
 * @returns true 表示工具可用
 */
export function evaluateAvailability(
  expr: ToolAvailabilityExpression,
  ctx: AvailabilityContext
): boolean {
  if ('kind' in expr) {
    // 原子信号
    switch (expr.kind) {
      case 'always':
        return true;
      case 'config': {
        if (!ctx.getConfig) return false;
        const value = ctx.getConfig(expr.path);
        if (expr.check === 'exists') return value !== undefined;
        if (expr.check === 'non-empty') {
          return value !== undefined && value !== null && value !== '';
        }
        // 'available' or undefined: 存在且非 falsy
        return Boolean(value);
      }
      case 'env':
        return ctx.getEnv?.(expr.name) !== undefined;
      case 'context': {
        const val = expr.key ? ctx.context?.[expr.key] : undefined;
        if (expr.equals === undefined) return val !== undefined;
        return val === expr.equals;
      }
      case 'capability':
        return ctx.capabilities?.[expr.name] === true;
      default:
        return false;
    }
  }
  if ('allOf' in expr) {
    return expr.allOf.every(sub => evaluateAvailability(sub, ctx));
  }
  if ('anyOf' in expr) {
    return expr.anyOf.some(sub => evaluateAvailability(sub, ctx));
  }
  return false;
}
