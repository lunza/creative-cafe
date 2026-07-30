/**
 * skills/ 模块单元测试（Task 14 验证）
 *
 * 覆盖：
 *  1. skillContract: frontmatter 解析 / SkillEntry 构造 / formatSkillsForPrompt
 *  2. skillAvailability: 可见性过滤 / requires.env 校验 / skillFilter 白名单 / skillOverrides
 *  3. skillSnapshot: buildSkillSnapshot / resolveSkillSnapshot 缓存 / shouldRefreshSnapshot
 *  4. skillRegistry: register/get/list/buildSnapshot/invoke
 *  5. skillLoader: loadBuiltinSkillsSync 加载内置 SKILL.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractFrontmatter,
  parseSkillMd,
  resolveSkillCommandSpec,
  formatSkillsForPrompt,
  truncateSkillBody,
  resolveSkillKey,
  normalizeSkillName,
} from '../agent/skills/skillContract';
import {
  evaluateSkillAvailability,
  isSkillPromptVisible,
  isSkillUserInvocable,
  isSkillRuntimeVisible,
  filterPromptVisibleSkills,
  filterUserInvocableSkills,
  matchesSkillFilter,
} from '../agent/skills/skillAvailability';
import {
  buildSkillSnapshot,
  resolveSkillSnapshot,
  shouldRefreshSnapshot,
  clearSkillSnapshotCache,
  getSkillSnapshotCacheSize,
} from '../agent/skills/skillSnapshot';
import {
  SkillRegistry,
  resetSkillRegistry,
} from '../agent/skills/skillRegistry';
import { loadBuiltinSkillsSync } from '../agent/skills/skillLoader';
import type { SkillEntry } from '../agent/skills/types';

// ==================== 测试数据 ====================

const SAMPLE_SKILL_MD = `---
name: test-skill
description: "A test skill for unit testing"
emoji: 🧪
user-invocable: true
disable-model-invocation: false
always: false
skill-key: test-alias
command-name: /test
command-tool: testTool
---

# Test Skill

This is the body of the test skill.

## Usage

Use this skill when testing.
`;

const SAMPLE_SKILL_MD_NO_OPTIONAL = `---
name: minimal-skill
description: Minimal skill with only required fields
---

# Minimal Skill

Body content.
`;

function makeSampleEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  const entry = parseSkillMd(SAMPLE_SKILL_MD, '/path/to/SKILL.md', 'builtin');
  if (!entry) throw new Error('Failed to parse sample skill');
  return { ...entry, ...overrides };
}

// ==================== skillContract 测试 ====================

describe('skillContract: frontmatter 解析', () => {
  it('extractFrontmatter: 标准 frontmatter + body', () => {
    const { frontmatter, body } = extractFrontmatter(SAMPLE_SKILL_MD);
    expect(frontmatter['name']).toBe('test-skill');
    expect(frontmatter['description']).toBe('A test skill for unit testing');
    expect(frontmatter['emoji']).toBe('🧪');
    expect(frontmatter['user-invocable']).toBe('true');
    expect(body).toContain('# Test Skill');
    expect(body).toContain('Use this skill when testing.');
  });

  it('extractFrontmatter: 无 frontmatter 时整体作为 body', () => {
    const content = '# No Frontmatter\n\nJust body.';
    const { frontmatter, body } = extractFrontmatter(content);
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toContain('# No Frontmatter');
  });

  it('extractFrontmatter: 引号字符串去除引号', () => {
    const content = `---
name: quoted
description: "带引号的描述"
---

Body`;
    const { frontmatter } = extractFrontmatter(content);
    expect(frontmatter['description']).toBe('带引号的描述');
  });

  it('extractFrontmatter: 列表值解析', () => {
    const content = `---
name: list-skill
description: test
requires-env:
  - API_KEY
  - DB_URL
---

Body`;
    const { frontmatter } = extractFrontmatter(content);
    expect(frontmatter['requires-env']).toBe('API_KEY\nDB_URL');
  });

  it('extractFrontmatter: BOM 处理', () => {
    const content = '\uFEFF' + SAMPLE_SKILL_MD;
    const { frontmatter } = extractFrontmatter(content);
    expect(frontmatter['name']).toBe('test-skill');
  });
});

describe('skillContract: parseSkillMd', () => {
  it('完整字段解析', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD, '/path/SKILL.md', 'builtin');
    expect(entry).toBeDefined();
    expect(entry!.skill.name).toBe('test-skill');
    expect(entry!.skill.description).toBe('A test skill for unit testing');
    expect(entry!.skill.filePath).toBe('/path/SKILL.md');
    expect(entry!.skill.source).toBe('builtin');
    expect(entry!.skill.body).toContain('# Test Skill');
    expect(entry!.metadata?.emoji).toBe('🧪');
    expect(entry!.metadata?.skillKey).toBe('test-alias');
    expect(entry!.metadata?.always).toBe(false);
    expect(entry!.invocation?.userInvocable).toBe(true);
    expect(entry!.invocation?.disableModelInvocation).toBe(false);
    expect(entry!.exposure?.includeInRuntimeRegistry).toBe(true);
    expect(entry!.exposure?.includeInAvailableSkillsPrompt).toBe(true);
    expect(entry!.exposure?.userInvocable).toBe(true);
  });

  it('仅必填字段解析（无可选字段）', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path/SKILL.md', 'workspace');
    expect(entry).toBeDefined();
    expect(entry!.skill.name).toBe('minimal-skill');
    expect(entry!.skill.source).toBe('workspace');
    expect(entry!.metadata).toBeUndefined();
    expect(entry!.invocation?.userInvocable).toBe(true);
    expect(entry!.invocation?.disableModelInvocation).toBe(false);
  });

  it('缺少 name 时返回 undefined', () => {
    const content = `---
description: missing name
---

Body`;
    expect(parseSkillMd(content, '/path', 'builtin')).toBeUndefined();
  });

  it('缺少 description 时返回 undefined', () => {
    const content = `---
name: no-desc
---

Body`;
    expect(parseSkillMd(content, '/path', 'builtin')).toBeUndefined();
  });

  it('disable-model-invocation=true 时 prompt 不可见', () => {
    const content = `---
name: hidden-skill
description: test
disable-model-invocation: true
---

Body`;
    const entry = parseSkillMd(content, '/path', 'builtin');
    expect(entry!.exposure?.includeInAvailableSkillsPrompt).toBe(false);
    expect(entry!.invocation?.disableModelInvocation).toBe(true);
  });

  it('requires-env 解析为列表', () => {
    const content = `---
name: env-skill
description: test
requires-env:
  - API_KEY
  - SECRET
---

Body`;
    const entry = parseSkillMd(content, '/path', 'builtin');
    expect(entry!.metadata?.requires?.env).toEqual(['API_KEY', 'SECRET']);
  });
});

describe('skillContract: resolveSkillCommandSpec', () => {
  it('有 command-name + command-tool 时返回完整 spec', () => {
    const entry = makeSampleEntry();
    const spec = resolveSkillCommandSpec(entry);
    expect(spec).toBeDefined();
    expect(spec!.name).toBe('/test');
    expect(spec!.skillName).toBe('test-skill');
    expect(spec!.dispatch?.kind).toBe('tool');
    expect(spec!.dispatch?.toolName).toBe('testTool');
  });

  it('无 command-name 时返回 undefined', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(resolveSkillCommandSpec(entry)).toBeUndefined();
  });
});

describe('skillContract: formatSkillsForPrompt', () => {
  it('空列表返回空字符串', () => {
    expect(formatSkillsForPrompt([])).toBe('');
  });

  it('非空列表返回 XML 块', () => {
    const entry = makeSampleEntry();
    const prompt = formatSkillsForPrompt([entry.skill]);
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('</available_skills>');
    expect(prompt).toContain('<name>test-skill</name>');
    expect(prompt).toContain('<description>A test skill for unit testing</description>');
    expect(prompt).toContain('<location>/path/to/SKILL.md</location>');
    expect(prompt).toContain('<version>1</version>');
  });

  it('XML 特殊字符转义', () => {
    const entry = makeSampleEntry({
      skill: {
        ...makeSampleEntry().skill,
        name: 'a<b>&c',
        description: 'd"e\'f',
      },
    });
    const prompt = formatSkillsForPrompt([entry.skill]);
    expect(prompt).toContain('&lt;');
    expect(prompt).toContain('&amp;');
    expect(prompt).toContain('&quot;');
    expect(prompt).toContain('&apos;');
  });
});

describe('skillContract: truncateSkillBody', () => {
  it('短 body 不截断', () => {
    const body = 'short body';
    expect(truncateSkillBody(body, 100)).toBe(body);
  });

  it('长 body 截断并追加提示', () => {
    const body = 'a'.repeat(200);
    const truncated = truncateSkillBody(body, 100);
    expect(truncated.length).toBeLessThan(body.length);
    expect(truncated).toContain('[truncated]');
  });
});

describe('skillContract: resolveSkillKey / normalizeSkillName', () => {
  it('resolveSkillKey: 优先使用 metadata.skillKey', () => {
    const entry = makeSampleEntry();
    expect(resolveSkillKey(entry)).toBe('test-alias');
  });

  it('resolveSkillKey: 无 skillKey 时 fallback 到 name', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(resolveSkillKey(entry)).toBe('minimal-skill');
  });

  it('normalizeSkillName: 转小写 + 连字符化', () => {
    expect(normalizeSkillName('Plot Check')).toBe('plot-check');
    expect(normalizeSkillName('plot_check')).toBe('plot-check');
    expect(normalizeSkillName('plotCheck')).toBe('plotcheck');
    expect(normalizeSkillName('  Plot / Check  ')).toBe('plot-check');
  });
});

// ==================== skillAvailability 测试 ====================

describe('skillAvailability: 可见性判断', () => {
  it('isSkillPromptVisible: 默认 true', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(isSkillPromptVisible(entry)).toBe(true);
  });

  it('isSkillPromptVisible: disable-model-invocation=true 时 false', () => {
    const entry = parseSkillMd(
      `---
name: hidden
description: test
disable-model-invocation: true
---
Body`,
      '/path',
      'builtin'
    )!;
    expect(isSkillPromptVisible(entry)).toBe(false);
  });

  it('isSkillUserInvocable: 默认 true', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(isSkillUserInvocable(entry)).toBe(true);
  });

  it('isSkillUserInvocable: user-invocable=false 时 false', () => {
    const entry = parseSkillMd(
      `---
name: no-user
description: test
user-invocable: false
---
Body`,
      '/path',
      'builtin'
    )!;
    expect(isSkillUserInvocable(entry)).toBe(false);
  });

  it('isSkillRuntimeVisible: 默认 true', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(isSkillRuntimeVisible(entry)).toBe(true);
  });
});

describe('skillAvailability: 过滤函数', () => {
  const visibleEntry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
  const hiddenEntry = parseSkillMd(
    `---
name: hidden
description: test
disable-model-invocation: true
---
Body`,
    '/path',
    'builtin'
  )!;

  it('filterPromptVisibleSkills: 过滤掉 disable-model-invocation', () => {
    const result = filterPromptVisibleSkills([visibleEntry, hiddenEntry]);
    expect(result).toHaveLength(1);
    expect(result[0].skill.name).toBe('minimal-skill');
  });

  it('filterUserInvocableSkills: 过滤掉 user-invocable=false', () => {
    const noUserEntry = parseSkillMd(
      `---
name: no-user
description: test
user-invocable: false
---
Body`,
      '/path',
      'builtin'
    )!;
    const result = filterUserInvocableSkills([visibleEntry, noUserEntry]);
    expect(result).toHaveLength(1);
    expect(result[0].skill.name).toBe('minimal-skill');
  });
});

describe('skillAvailability: evaluateSkillAvailability', () => {
  it('无 requires 时默认可用', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(evaluateSkillAvailability(entry, {})).toBe(true);
  });

  it('requires.env 满足时可用', () => {
    const entry = parseSkillMd(
      `---
name: env-skill
description: test
requires-env:
  - API_KEY
---
Body`,
      '/path',
      'builtin'
    )!;
    expect(
      evaluateSkillAvailability(entry, {
        getEnv: (name) => (name === 'API_KEY' ? 'value' : undefined),
      })
    ).toBe(true);
  });

  it('requires.env 不满足时不可用', () => {
    const entry = parseSkillMd(
      `---
name: env-skill
description: test
requires-env:
  - API_KEY
---
Body`,
      '/path',
      'builtin'
    )!;
    expect(
      evaluateSkillAvailability(entry, {
        getEnv: () => undefined,
      })
    ).toBe(false);
  });

  it('skillFilter 白名单匹配 name 时可用', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(
      evaluateSkillAvailability(entry, {
        skillFilter: ['minimal-skill'],
      })
    ).toBe(true);
  });

  it('skillFilter 白名单不匹配时不可用', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(
      evaluateSkillAvailability(entry, {
        skillFilter: ['other-skill'],
      })
    ).toBe(false);
  });

  it('skillOverrides 按 name 覆盖', () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    expect(
      evaluateSkillAvailability(entry, {
        skillOverrides: { 'minimal-skill': false },
      })
    ).toBe(false);
  });

  it('skillOverrides 按 skillKey 覆盖优先于 name', () => {
    const entry = makeSampleEntry(); // skillKey = 'test-alias'
    expect(
      evaluateSkillAvailability(entry, {
        skillOverrides: { 'test-alias': false, 'test-skill': true },
      })
    ).toBe(false);
  });

  it('includeInRuntimeRegistry=false 时不可用', () => {
    const entry = parseSkillMd(
      `---
name: no-runtime
description: test
include-in-runtime-registry: false
---
Body`,
      '/path',
      'builtin'
    )!;
    expect(evaluateSkillAvailability(entry, {})).toBe(false);
  });
});

describe('skillAvailability: matchesSkillFilter', () => {
  it('均为 undefined 时一致', () => {
    expect(matchesSkillFilter(undefined, undefined)).toBe(true);
  });

  it('一方 undefined 时不一致', () => {
    expect(matchesSkillFilter(['a'], undefined)).toBe(false);
    expect(matchesSkillFilter(undefined, ['a'])).toBe(false);
  });

  it('相同元素（顺序不同）一致', () => {
    expect(matchesSkillFilter(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('不同元素不一致', () => {
    expect(matchesSkillFilter(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  it('大小写归一化后一致', () => {
    expect(matchesSkillFilter(['Plot-Check'], ['plot-check'])).toBe(true);
  });
});

// ==================== skillSnapshot 测试 ====================

describe('skillSnapshot: buildSkillSnapshot', () => {
  beforeEach(() => {
    clearSkillSnapshotCache();
  });

  it('空技能列表生成空 prompt', () => {
    const snapshot = buildSkillSnapshot([]);
    expect(snapshot.prompt).toBe('');
    expect(snapshot.skills).toHaveLength(0);
  });

  it('单个技能生成含 XML 块的 prompt', () => {
    const entry = makeSampleEntry();
    const snapshot = buildSkillSnapshot([entry]);
    expect(snapshot.prompt).toContain('<available_skills>');
    expect(snapshot.prompt).toContain('test-skill');
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].name).toBe('test-skill');
    expect(snapshot.skills[0].skillKey).toBe('test-alias');
  });

  it('disable-model-invocation 的技能不注入 prompt', () => {
    const visible = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    const hidden = parseSkillMd(
      `---
name: hidden
description: test
disable-model-invocation: true
---
Body`,
      '/path',
      'builtin'
    )!;
    const snapshot = buildSkillSnapshot([visible, hidden]);
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].name).toBe('minimal-skill');
  });

  it('skillFilter 过滤后仅包含白名单技能', () => {
    const entry1 = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    const entry2 = makeSampleEntry();
    const snapshot = buildSkillSnapshot([entry1, entry2], {
      skillFilter: ['minimal-skill'],
    });
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0].name).toBe('minimal-skill');
  });

  it('requires.env 不满足的技能不注入 prompt', () => {
    const entry = parseSkillMd(
      `---
name: env-skill
description: test
requires-env:
  - MISSING_VAR
---
Body`,
      '/path',
      'builtin'
    )!;
    const snapshot = buildSkillSnapshot([entry], {
      getEnv: () => undefined,
    });
    expect(snapshot.skills).toHaveLength(0);
  });

  it('promptFormatVersion 与 SKILL_PROMPT_FORMAT_VERSION 一致', () => {
    const snapshot = buildSkillSnapshot([makeSampleEntry()]);
    expect(snapshot.promptFormatVersion).toBe(1);
  });
});

describe('skillSnapshot: resolveSkillSnapshot 缓存', () => {
  beforeEach(() => {
    clearSkillSnapshotCache();
  });

  it('相同参数命中缓存', () => {
    const entry = makeSampleEntry();
    const snap1 = resolveSkillSnapshot([entry], {});
    const snap2 = resolveSkillSnapshot([entry], {});
    expect(getSkillSnapshotCacheSize()).toBe(1);
    // 缓存命中时返回同一对象引用（或内容一致）
    expect(snap1.prompt).toBe(snap2.prompt);
  });

  it('不同 skillFilter 不命中缓存', () => {
    const entry = makeSampleEntry();
    resolveSkillSnapshot([entry], { skillFilter: ['a'] });
    resolveSkillSnapshot([entry], { skillFilter: ['b'] });
    expect(getSkillSnapshotCacheSize()).toBe(2);
  });

  it('clearSkillSnapshotCache 清空缓存', () => {
    const entry = makeSampleEntry();
    resolveSkillSnapshot([entry], {});
    expect(getSkillSnapshotCacheSize()).toBe(1);
    clearSkillSnapshotCache();
    expect(getSkillSnapshotCacheSize()).toBe(0);
  });

  it('LRU 淘汰：超过 10 条时淘汰最旧', () => {
    const entry = makeSampleEntry();
    for (let i = 0; i < 12; i++) {
      resolveSkillSnapshot([entry], { skillFilter: [`skill-${i}`] });
    }
    expect(getSkillSnapshotCacheSize()).toBe(10);
  });
});

describe('skillSnapshot: shouldRefreshSnapshot', () => {
  it('existing 为 undefined 时需刷新', () => {
    expect(shouldRefreshSnapshot(undefined, undefined)).toBe(true);
  });

  it('promptFormatVersion 变化时需刷新', () => {
    const snapshot = {
      prompt: '',
      skills: [],
      promptFormatVersion: 999, // 旧版本
    };
    expect(shouldRefreshSnapshot(snapshot, undefined)).toBe(true);
  });

  it('skillFilter 变化时需刷新', () => {
    const snapshot = {
      prompt: '',
      skills: [],
      promptFormatVersion: 1,
      skillFilter: ['a'],
    };
    expect(shouldRefreshSnapshot(snapshot, ['b'])).toBe(true);
  });

  it('参数一致时无需刷新', () => {
    const snapshot = {
      prompt: '',
      skills: [],
      promptFormatVersion: 1,
      skillFilter: ['a'],
    };
    expect(shouldRefreshSnapshot(snapshot, ['a'])).toBe(false);
  });
});

// ==================== skillRegistry 测试 ====================

describe('skillRegistry: register/get/list', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    resetSkillRegistry();
    registry = new SkillRegistry();
  });

  it('register + get 正常工作', () => {
    const entry = makeSampleEntry();
    registry.register(entry);
    expect(registry.get('test-skill')).toBe(entry);
    expect(registry.size()).toBe(1);
  });

  it('重复注册同名技能抛出错误', () => {
    const entry = makeSampleEntry();
    registry.register(entry);
    expect(() => registry.register(entry)).toThrow('already registered');
  });

  it('unregister 后 get 返回 undefined', () => {
    const entry = makeSampleEntry();
    registry.register(entry);
    registry.unregister('test-skill');
    expect(registry.get('test-skill')).toBeUndefined();
    expect(registry.size()).toBe(0);
  });

  it('list 返回所有已注册技能', () => {
    const entry1 = makeSampleEntry();
    const entry2 = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    registry.register(entry1);
    registry.register(entry2);
    expect(registry.list()).toHaveLength(2);
  });

  it('getBySkillKey 按 skillKey 查找', () => {
    const entry = makeSampleEntry(); // skillKey = 'test-alias'
    registry.register(entry);
    expect(registry.getBySkillKey('test-alias')).toBe(entry);
    expect(registry.getBySkillKey('nonexistent')).toBeUndefined();
  });

  it('registerAll 批量注册', () => {
    const entry1 = makeSampleEntry();
    const entry2 = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    registry.registerAll([entry1, entry2]);
    expect(registry.size()).toBe(2);
  });

  it('clear 清空所有技能', () => {
    registry.register(makeSampleEntry());
    registry.clear();
    expect(registry.size()).toBe(0);
  });
});

describe('skillRegistry: buildSnapshot', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    resetSkillRegistry();
    clearSkillSnapshotCache();
    registry = new SkillRegistry();
  });

  it('空注册中心生成空 prompt', () => {
    expect(registry.buildSnapshot()).toBe('');
  });

  it('注册技能后生成含技能的 prompt', () => {
    registry.register(makeSampleEntry());
    const prompt = registry.buildSnapshot();
    expect(prompt).toContain('test-skill');
    expect(prompt).toContain('<available_skills>');
  });

  it('buildSnapshot(filter) 按白名单过滤', () => {
    registry.register(makeSampleEntry());
    const entry2 = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    registry.register(entry2);
    const prompt = registry.buildSnapshot(['minimal-skill']);
    expect(prompt).toContain('minimal-skill');
    expect(prompt).not.toContain('test-skill');
  });
});

describe('skillRegistry: invoke', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    resetSkillRegistry();
    registry = new SkillRegistry();
  });

  it('未注册的技能返回错误', async () => {
    const result = await registry.invoke('nonexistent', {}, undefined);
    expect(result.success).toBe(false);
    expect(result.content).toContain('Skill not found');
  });

  it('未设置 toolProvider 时返回错误', async () => {
    registry.register(makeSampleEntry());
    const result = await registry.invoke('test-skill', {}, undefined);
    expect(result.success).toBe(false);
    expect(result.content).toContain('no tool provider');
  });

  it('无 command-name 配置的技能返回错误', async () => {
    const entry = parseSkillMd(SAMPLE_SKILL_MD_NO_OPTIONAL, '/path', 'builtin')!;
    registry.register(entry);
    registry.setToolProvider({
      listTools: () => [],
      getToolDefinitions: () => [],
      executeTool: async () => ({ success: true, content: '' }),
      isToolAvailable: () => true,
    });
    const result = await registry.invoke('minimal-skill', {}, undefined);
    expect(result.success).toBe(false);
    expect(result.content).toContain('no command dispatch');
  });

  it('有 command-tool 的技能委托给 toolProvider', async () => {
    registry.register(makeSampleEntry()); // command-tool: testTool
    registry.setToolProvider({
      listTools: () => [],
      getToolDefinitions: () => [],
      executeTool: async (name, args) => ({
        success: true,
        content: `Executed ${name} with ${JSON.stringify(args)}`,
      }),
      isToolAvailable: () => true,
    });
    const result = await registry.invoke('test-skill', { key: 'value' }, undefined);
    expect(result.success).toBe(true);
    expect(result.content).toContain('testTool');
    expect(result.content).toContain('value');
  });

  it('toolProvider.isToolAvailable=false 时返回错误', async () => {
    registry.register(makeSampleEntry());
    registry.setToolProvider({
      listTools: () => [],
      getToolDefinitions: () => [],
      executeTool: async () => ({ success: true, content: '' }),
      isToolAvailable: () => false,
    });
    const result = await registry.invoke('test-skill', {}, undefined);
    expect(result.success).toBe(false);
    expect(result.content).toContain('not available');
  });
});

// ==================== skillLoader 集成测试 ====================

describe('skillLoader: 加载内置 SKILL.md', () => {
  it('loadBuiltinSkillsSync 加载 5 个写作组技能', () => {
    const entries = loadBuiltinSkillsSync();
    expect(entries.length).toBeGreaterThanOrEqual(5);

    const names = entries.map(e => e.skill.name);
    expect(names).toContain('plot-check');
    expect(names).toContain('outline-generate');
    expect(names).toContain('chapter-write');
    expect(names).toContain('description-polish');
    expect(names).toContain('table-organize');
  });

  it('内置技能均为 builtin 来源', () => {
    const entries = loadBuiltinSkillsSync();
    for (const entry of entries) {
      expect(entry.skill.source).toBe('builtin');
    }
  });

  it('内置技能均有 command-name + command-tool 配置', () => {
    const entries = loadBuiltinSkillsSync();
    for (const entry of entries) {
      const spec = resolveSkillCommandSpec(entry);
      expect(spec).toBeDefined();
      expect(spec!.dispatch?.kind).toBe('tool');
      expect(spec!.dispatch?.toolName).toBeDefined();
    }
  });

  it('table-organize 技能引用 updateStateTable 工具', () => {
    const entries = loadBuiltinSkillsSync();
    const tableOrganize = entries.find(e => e.skill.name === 'table-organize');
    expect(tableOrganize).toBeDefined();
    const spec = resolveSkillCommandSpec(tableOrganize!);
    expect(spec!.dispatch?.toolName).toBe('updateStateTable');
  });

  it('内置技能可注册到 SkillRegistry 并构建快照', () => {
    const entries = loadBuiltinSkillsSync();
    resetSkillRegistry();
    clearSkillSnapshotCache();
    const registry = new SkillRegistry();
    registry.registerAll(entries);

    const prompt = registry.buildSnapshot();
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('plot-check');
    expect(prompt).toContain('chapter-write');
    expect(prompt).toContain('table-organize');
  });
});
