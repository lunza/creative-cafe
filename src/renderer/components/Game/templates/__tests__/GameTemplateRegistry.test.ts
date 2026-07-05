/**
 * GameTemplateRegistry 单元测试
 *
 * 覆盖：
 * - register + get：注册后可获取
 * - register 重复覆盖（warn 但不报错）
 * - list：返回所有已注册模板
 * - has：判断是否已注册
 * - clear：清空
 * - 4 个占位模板的字段完整性（type / meta / panels / tableSchema / Component 都存在）
 *
 * 测试风格参考 src/shared/types/__tests__/game.types.test.ts。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lazy } from 'react';
import type { ComponentType } from 'react';
import {
  GameType,
  GameStatus,
  type GameTypeTemplate,
  type GameTemplateProps
} from '../../../../../shared/types/game.types';
import { DEFAULT_GAME_TABLE_SCHEMA } from '../../../../../shared/constants/game.constants';
import { GameTemplateRegistry } from '../GameTemplateRegistry';
import { MysteryTemplate } from '../MysteryTemplate';
import { DatingSimTemplate } from '../DatingSimTemplate';
import { WerewolfTemplate } from '../WerewolfTemplate';
import { TextRpgTemplate } from '../TextRpgTemplate';

// ==================== Mock 工具 ====================

/**
 * 占位函数组件，用于构造 mock 模板的 Component 字段。
 *
 * 注意：lazy(() => import('./PlaceholderGameMain')) 在测试中不会被实际渲染，
 * 此处直接用 async 工厂返回一个 null 渲染组件即可生成合法的 LazyExoticComponent。
 */
const StubComponent: ComponentType<GameTemplateProps> = () => null;
const StubLazyComponent = lazy(async () => ({ default: StubComponent }));

/**
 * 创建一个最小可用的 mock 模板，仅用于 registry 行为测试。
 */
function createMockTemplate(type: GameType): GameTypeTemplate {
  return {
    type,
    meta: {
      title: `Mock ${type}`,
      subtitle: 'mock subtitle',
      description: 'mock description',
      gameplay: 'mock gameplay',
      developer: 'mock dev',
      version: '0.0.0',
      status: GameStatus.PLANNED,
      tags: ['mock']
    },
    panels: [],
    tableSchema: DEFAULT_GAME_TABLE_SCHEMA,
    Component: StubLazyComponent
  };
}

// ==================== Registry 行为测试 ====================

describe('GameTemplateRegistry', () => {
  beforeEach(() => {
    // 每个测试前重置 registry 状态，避免相互干扰
    GameTemplateRegistry.clear();
  });

  describe('register + get', () => {
    it('should register and retrieve a template', () => {
      const t = createMockTemplate(GameType.MYSTERY);
      GameTemplateRegistry.register(GameType.MYSTERY, t);
      expect(GameTemplateRegistry.get(GameType.MYSTERY)).toBe(t);
    });

    it('should return undefined for unregistered type', () => {
      expect(GameTemplateRegistry.get(GameType.MYSTERY)).toBeUndefined();
    });

    it('should support retrieving different types independently', () => {
      const t1 = createMockTemplate(GameType.MYSTERY);
      const t2 = createMockTemplate(GameType.WEREWOLF);
      GameTemplateRegistry.register(GameType.MYSTERY, t1);
      GameTemplateRegistry.register(GameType.WEREWOLF, t2);
      expect(GameTemplateRegistry.get(GameType.MYSTERY)).toBe(t1);
      expect(GameTemplateRegistry.get(GameType.WEREWOLF)).toBe(t2);
    });
  });

  describe('register duplicate', () => {
    it('should overwrite and warn without throwing', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        /* swallow */
      });
      const t1 = createMockTemplate(GameType.MYSTERY);
      const t2 = createMockTemplate(GameType.MYSTERY);

      expect(() => {
        GameTemplateRegistry.register(GameType.MYSTERY, t1);
        GameTemplateRegistry.register(GameType.MYSTERY, t2);
      }).not.toThrow();

      expect(GameTemplateRegistry.get(GameType.MYSTERY)).toBe(t2);
      expect(GameTemplateRegistry.get(GameType.MYSTERY)).not.toBe(t1);
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('overwriting');

      warnSpy.mockRestore();
    });
  });

  describe('list', () => {
    it('should return empty array when nothing registered', () => {
      expect(GameTemplateRegistry.list()).toEqual([]);
    });

    it('should return all registered templates', () => {
      const t1 = createMockTemplate(GameType.MYSTERY);
      const t2 = createMockTemplate(GameType.WEREWOLF);
      const t3 = createMockTemplate(GameType.DATING_SIM);
      GameTemplateRegistry.register(GameType.MYSTERY, t1);
      GameTemplateRegistry.register(GameType.WEREWOLF, t2);
      GameTemplateRegistry.register(GameType.DATING_SIM, t3);

      const list = GameTemplateRegistry.list();
      expect(list).toHaveLength(3);
      expect(list).toContain(t1);
      expect(list).toContain(t2);
      expect(list).toContain(t3);
    });

    it('should reflect overwrites in list (no duplicate entries)', () => {
      const t1 = createMockTemplate(GameType.MYSTERY);
      const t2 = createMockTemplate(GameType.MYSTERY);
      GameTemplateRegistry.register(GameType.MYSTERY, t1);
      GameTemplateRegistry.register(GameType.MYSTERY, t2);

      expect(GameTemplateRegistry.list()).toHaveLength(1);
      expect(GameTemplateRegistry.list()[0]).toBe(t2);
    });
  });

  describe('has', () => {
    it('should return false for unregistered type', () => {
      expect(GameTemplateRegistry.has(GameType.MYSTERY)).toBe(false);
    });

    it('should return true for registered type', () => {
      GameTemplateRegistry.register(GameType.MYSTERY, createMockTemplate(GameType.MYSTERY));
      expect(GameTemplateRegistry.has(GameType.MYSTERY)).toBe(true);
    });

    it('should return false after clear', () => {
      GameTemplateRegistry.register(GameType.MYSTERY, createMockTemplate(GameType.MYSTERY));
      GameTemplateRegistry.clear();
      expect(GameTemplateRegistry.has(GameType.MYSTERY)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all registered templates', () => {
      GameTemplateRegistry.register(GameType.MYSTERY, createMockTemplate(GameType.MYSTERY));
      GameTemplateRegistry.register(GameType.WEREWOLF, createMockTemplate(GameType.WEREWOLF));
      GameTemplateRegistry.clear();

      expect(GameTemplateRegistry.list()).toEqual([]);
      expect(GameTemplateRegistry.has(GameType.MYSTERY)).toBe(false);
      expect(GameTemplateRegistry.has(GameType.WEREWOLF)).toBe(false);
      expect(GameTemplateRegistry.get(GameType.MYSTERY)).toBeUndefined();
    });

    it('should be safe to call on empty registry', () => {
      expect(() => GameTemplateRegistry.clear()).not.toThrow();
      expect(GameTemplateRegistry.list()).toEqual([]);
    });
  });
});

// ==================== 占位模板字段完整性测试 ====================

describe('Placeholder templates field integrity', () => {
  const cases: Array<{ name: string; template: GameTypeTemplate; type: GameType }> = [
    { name: 'MysteryTemplate', template: MysteryTemplate, type: GameType.MYSTERY },
    { name: 'DatingSimTemplate', template: DatingSimTemplate, type: GameType.DATING_SIM },
    { name: 'WerewolfTemplate', template: WerewolfTemplate, type: GameType.WEREWOLF },
    { name: 'TextRpgTemplate', template: TextRpgTemplate, type: GameType.TEXT_RPG }
  ];

  for (const { name, template, type } of cases) {
    describe(name, () => {
      it('should have correct type field', () => {
        expect(template.type).toBe(type);
      });

      it('should have complete meta fields', () => {
        const meta = template.meta;
        expect(meta).toBeDefined();
        expect(typeof meta.title).toBe('string');
        expect(meta.title.length).toBeGreaterThan(0);
        expect(typeof meta.subtitle).toBe('string');
        expect(meta.subtitle.length).toBeGreaterThan(0);
        expect(typeof meta.description).toBe('string');
        expect(meta.description.length).toBeGreaterThan(0);
        expect(typeof meta.gameplay).toBe('string');
        expect(meta.gameplay.length).toBeGreaterThan(0);
        expect(typeof meta.developer).toBe('string');
        expect(meta.developer.length).toBeGreaterThan(0);
        expect(typeof meta.version).toBe('string');
        expect(meta.version.length).toBeGreaterThan(0);
        expect(meta.status).toBe(GameStatus.PLANNED);
        expect(Array.isArray(meta.tags)).toBe(true);
        expect(meta.tags.length).toBeGreaterThan(0);
      });

      it('should have empty panels array (placeholder)', () => {
        expect(Array.isArray(template.panels)).toBe(true);
        expect(template.panels).toEqual([]);
      });

      it('should have default (empty) table schema', () => {
        expect(template.tableSchema).toEqual(DEFAULT_GAME_TABLE_SCHEMA);
      });

      it('should have a non-null Component (lazy)', () => {
        expect(template.Component).toBeDefined();
        expect(template.Component).not.toBeNull();
        expect(typeof template.Component).toBe('object');
      });
    });
  }
});
