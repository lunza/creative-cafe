/**
 * 自定义提示词作用域回退链单元测试（2026-10-08 配置分层：章节 > 项目 > 全局）
 *
 * 验证 readScopedCustomPrompt 的三级回退链与 scopedPromptKey 拼接：
 * 作用域 `${baseKey}:${scope}` → 中间层 fallbackKey → 全局 baseKey。
 * 章节生成/检查 AI 味/剧情检查均依赖该链实现"章节覆盖项目、项目覆盖全局"。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  scopedPromptKey,
  readCustomPrompt,
  readScopedCustomPrompt,
} from '../CustomPromptPopover';

/** node 环境无 localStorage：安装内存 mock（与浏览器行为一致的子集） */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
  return mock;
}

const BASE = 'v2chapter_auto_gen_custom_prompt';
const PROJECT_ID = 'proj_123';
const PROJECT_KEY = `${BASE}:${PROJECT_ID}`;
const CH1_SCOPE = `${PROJECT_ID}:0`;
const CH2_SCOPE = `${PROJECT_ID}:1`;

describe('scopedPromptKey', () => {
  it('拼接为 `${baseKey}:${scope}`', () => {
    expect(scopedPromptKey(BASE, CH1_SCOPE)).toBe(`${BASE}:${PROJECT_ID}:0`);
  });
});

describe('readScopedCustomPrompt 三级回退链', () => {
  let ls: ReturnType<typeof installLocalStorageMock>;
  beforeEach(() => {
    ls = installLocalStorageMock();
  });

  it('章节已配置 → 返回章节配置（覆盖项目与全局）', () => {
    ls.setItem(scopedPromptKey(BASE, CH1_SCOPE), '章节专属要求');
    ls.setItem(PROJECT_KEY, '项目级要求');
    ls.setItem(BASE, '全局要求');
    expect(readScopedCustomPrompt(BASE, CH1_SCOPE, PROJECT_KEY)).toBe('章节专属要求');
  });

  it('章节未配置、项目已配置 → 回退项目级', () => {
    ls.setItem(PROJECT_KEY, '项目级要求');
    ls.setItem(BASE, '全局要求');
    expect(readScopedCustomPrompt(BASE, CH1_SCOPE, PROJECT_KEY)).toBe('项目级要求');
  });

  it('章节与项目均未配置、全局已配置 → 回退全局', () => {
    ls.setItem(BASE, '全局要求');
    expect(readScopedCustomPrompt(BASE, CH1_SCOPE, PROJECT_KEY)).toBe('全局要求');
  });

  it('三级全空 → 返回空串', () => {
    expect(readScopedCustomPrompt(BASE, CH1_SCOPE, PROJECT_KEY)).toBe('');
  });

  it('不同章节互不串扰（第 1 章配置不影响第 2 章）', () => {
    ls.setItem(scopedPromptKey(BASE, CH1_SCOPE), '第1章要求');
    expect(readScopedCustomPrompt(BASE, CH2_SCOPE, PROJECT_KEY)).toBe('');
    expect(readScopedCustomPrompt(BASE, CH1_SCOPE, PROJECT_KEY)).toBe('第1章要求');
  });

  it('scope 缺省 + fallbackKey 有值 → 返回中间层（项目级 Popover 的读取路径）', () => {
    ls.setItem(PROJECT_KEY, '项目级要求');
    ls.setItem(BASE, '全局要求');
    expect(readScopedCustomPrompt(BASE, undefined, PROJECT_KEY)).toBe('项目级要求');
  });

  it('scope 缺省 + fallbackKey 空 → 回退全局', () => {
    ls.setItem(BASE, '全局要求');
    expect(readScopedCustomPrompt(BASE, undefined, PROJECT_KEY)).toBe('全局要求');
  });

  it('漫画场景（无 fallbackKey 中间层）：作用域 → 直接回退全局（向后兼容原两级链）', () => {
    ls.setItem(BASE, '全局默认');
    expect(readScopedCustomPrompt(BASE, 'D:\\manga\\foo')).toBe('全局默认');
    ls.setItem(scopedPromptKey(BASE, 'D:\\manga\\foo'), '漫画专属');
    expect(readScopedCustomPrompt(BASE, 'D:\\manga\\foo')).toBe('漫画专属');
  });
});

describe('readCustomPrompt 基础读取', () => {
  let ls: ReturnType<typeof installLocalStorageMock>;
  beforeEach(() => {
    ls = installLocalStorageMock();
  });

  it('已存值返回原值；未存返回空串', () => {
    expect(readCustomPrompt(BASE)).toBe('');
    ls.setItem(BASE, '全局要求');
    expect(readCustomPrompt(BASE)).toBe('全局要求');
  });
});
