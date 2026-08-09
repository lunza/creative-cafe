/**
 * 扩展注册表 — ExtensionRegistry
 *
 * Spec: redesign-dialogue-pipeline-architecture / ExtensionRegistry
 *
 * 统一管理管线扩展组件的注册与获取，支持通过注册方式接入新的
 * PromptProvider、PostProcessPlugin、LogicTask、RenderComponent 和 IntentHandler。
 * 采用单例模式，通过 getInstance() 获取全局实例。
 */

import type React from 'react';
import type {
  AIIntentType,
  PromptProvider,
  PostProcessPlugin,
  LogicTask,
  IntentHandler,
} from './pipeline.types';

/** 渲染组件类型 */
type RenderComponent = React.ComponentType<Record<string, unknown>>;

export class ExtensionRegistry {
  /** 全局单例 */
  private static instance: ExtensionRegistry | null = null;

  /** 提示词 Provider 列表 */
  private promptProviders: PromptProvider[] = [];
  /** 后处理插件列表 */
  private postProcessPlugins: PostProcessPlugin[] = [];
  /** 逻辑任务列表 */
  private logicTasks: LogicTask[] = [];
  /** 渲染组件映射（tag → 组件） */
  private renderComponents: Map<string, RenderComponent> = new Map();
  /** AI 意图处理器映射（意图类型 → 处理器） */
  private intentHandlers: Map<AIIntentType, IntentHandler> = new Map();

  /** 私有构造函数（单例模式） */
  private constructor() {}

  /**
   * 获取全局单例实例。
   */
  static getInstance(): ExtensionRegistry {
    if (ExtensionRegistry.instance === null) {
      ExtensionRegistry.instance = new ExtensionRegistry();
    }
    return ExtensionRegistry.instance;
  }

  // ===== 提示词 Provider =====

  /**
   * 注册提示词 Provider。
   */
  registerPromptProvider(provider: PromptProvider): void {
    this.promptProviders.push(provider);
  }

  /**
   * 获取所有已注册的提示词 Provider。
   */
  getPromptProviders(): PromptProvider[] {
    return this.promptProviders;
  }

  // ===== 后处理插件 =====

  /**
   * 注册后处理插件。
   */
  registerPostProcessPlugin(plugin: PostProcessPlugin): void {
    this.postProcessPlugins.push(plugin);
  }

  /**
   * 获取所有已注册的后处理插件。
   */
  getPostProcessPlugins(): PostProcessPlugin[] {
    return this.postProcessPlugins;
  }

  // ===== 逻辑任务 =====

  /**
   * 注册逻辑任务。
   */
  registerLogicTask(task: LogicTask): void {
    this.logicTasks.push(task);
  }

  /**
   * 获取所有已注册的逻辑任务。
   */
  getLogicTasks(): LogicTask[] {
    return this.logicTasks;
  }

  // ===== 渲染组件 =====

  /**
   * 注册自定义渲染组件。
   * @param tag 标签名（如 'em'、'blockquote'）
   * @param component React 组件
   */
  registerRenderComponent(tag: string, component: RenderComponent): void {
    this.renderComponents.set(tag, component);
  }

  /**
   * 获取所有已注册的渲染组件映射。
   */
  getRenderComponents(): Map<string, RenderComponent> {
    return this.renderComponents;
  }

  // ===== AI 意图处理器 =====

  /**
   * 注册 AI 意图处理器。
   * @param type 意图类型
   * @param handler 处理器
   */
  registerIntentHandler(type: AIIntentType, handler: IntentHandler): void {
    this.intentHandlers.set(type, handler);
  }

  /**
   * 获取指定类型的 AI 意图处理器。
   * @returns 处理器，未注册时返回 null
   */
  getIntentHandler(type: AIIntentType): IntentHandler | null {
    return this.intentHandlers.get(type) ?? null;
  }
}
