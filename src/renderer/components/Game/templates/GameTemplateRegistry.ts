/**
 * 游戏模板注册中心（渲染进程）
 *
 * 用于管理各游戏类型对应的 GameTypeTemplate 实例，提供注册 / 查询 / 列举 / 清空能力。
 * 新增游戏类型时只需：
 *   1. 实现一个 GameTypeTemplate 对象
 *   2. 调用 GameTemplateRegistry.register(GameType.XXX, template)
 *
 * 设计说明：
 * - 单例模式（导出 GameTemplateRegistry 实例），保证全应用共享同一注册表
 * - 内部使用 Map<GameType, GameTypeTemplate> 存储，key 唯一
 * - 重复注册仅打印警告并覆盖，不抛错（便于热重载 / 测试覆盖）
 */

import type { GameType, GameTypeTemplate } from '../../../../shared/types/game.types';

class GameTemplateRegistryImpl {
  private templates = new Map<GameType, GameTypeTemplate>();

  /**
   * 注册游戏类型模板
   *
   * @param type      游戏类型枚举值
   * @param template  模板实例
   *
   * 如该 type 已存在模板，打印警告并覆盖（不抛错）。
   */
  register(type: GameType, template: GameTypeTemplate): void {
    if (this.templates.has(type)) {
      console.warn(
        `[GameTemplateRegistry] Template for ${type} already registered, overwriting`
      );
    }
    this.templates.set(type, template);
  }

  /**
   * 获取指定类型的模板
   *
   * @param type  游戏类型枚举值
   * @returns     模板实例，未注册时返回 undefined
   */
  get(type: GameType): GameTypeTemplate | undefined {
    return this.templates.get(type);
  }

  /**
   * 列出所有已注册模板
   *
   * @returns  模板数组（顺序按 Map 插入顺序）
   */
  list(): GameTypeTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 判断指定类型是否已注册
   *
   * @param type  游戏类型枚举值
   * @returns     已注册返回 true
   */
  has(type: GameType): boolean {
    return this.templates.has(type);
  }

  /**
   * 清空所有已注册模板
   *
   * 主要用于测试场景重置 registry 状态。
   */
  clear(): void {
    this.templates.clear();
  }
}

/**
 * 游戏模板注册中心单例
 *
 * 全应用唯一，导入即共享状态。
 */
export const GameTemplateRegistry = new GameTemplateRegistryImpl();
