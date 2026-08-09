/**
 * TagAutocompleteService 单元测试 —— aliasMap 构建 + getTagByAlias
 *
 * Spec: enhance-tag-synonym-matching / Task 3 / SubTask 3.1
 *
 * 测试目的：
 *   验证 tagAutocompleteService 的 alias 反向索引构建逻辑与 getTagByAlias 查询行为，
 *   覆盖同义词命中、大小写不敏感、冲突时保留 count 高的 tag、reload 清空重建等场景。
 *
 * 测试策略：
 *   - 不 mock tagAutocompleteService 本身（测试真实单例的内存索引逻辑）
 *   - 用 os.tmpdir() + fs.writeFileSync 创建临时小型 CSV，调用 reload(tempCsvPath) 触发真实加载
 *   - 测试结束后清理临时文件，避免污染系统临时目录
 *   - 不依赖真实 8MB CSV 文件（31.7 万条），仅用数行小型 CSV 验证索引构建逻辑
 *
 * ⚠️ 真实行为依赖 Electron 集成测试（Native Module Test Gap Convention）：
 *   - 本测试用真实 CSV 但仅验证内存索引逻辑（tagMap / aliasMap 构建 + 查询）
 *   - 不涉及原生模块（sqlite-vec / better-sqlite3），无需 Electron 运行时
 *   - 生产环境加载 8MB CSV 的流式解析性能、readline 内存占用未在此验证
 *   - tagCsvEmitter 事件链路（→ TagRagService stale 标记）未在此验证
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 静音 logger（真实 logger 会输出到控制台/文件，测试中无需噪声）
vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { tagAutocompleteService } from '../tagAutocompleteService';

describe('tagAutocompleteService - aliasMap 构建与 getTagByAlias（Spec: enhance-tag-synonym-matching / Task 3）', () => {
  // 记录所有临时文件路径，afterEach 统一清理
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        // 忽略：文件可能已被删除或不存在
      }
    }
    tempFiles.length = 0;
  });

  /**
   * 辅助函数：将 CSV 行写入临时文件并 reload tagAutocompleteService。
   * 每次调用创建独立临时文件，避免单例状态残留影响断言。
   */
  async function loadCsvLines(lines: string[]): Promise<void> {
    const tempPath = path.join(
      os.tmpdir(),
      `tag-alias-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`
    );
    fs.writeFileSync(tempPath, lines.join('\n'), 'utf-8');
    tempFiles.push(tempPath);
    const result = await tagAutocompleteService.reload(tempPath);
    expect(result.success).toBe(true);
  }

  // ==================== getTagByAlias 基本行为 ====================

  it('getTagByAlias 命中同义词：reload 含 slender 别名后返回 slim 的 TagInfo', async () => {
    await loadCsvLines([
      'slim,7,41092,"lanky,lithe,slender,thin"',
    ]);

    const result = tagAutocompleteService.getTagByAlias('slender');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('slim');
    expect(result?.category).toBe(7);
    expect(result?.count).toBe(41092);
  });

  it('getTagByAlias 大小写不敏感：SLENDER 同样命中 slim', async () => {
    await loadCsvLines([
      'slim,7,41092,"lanky,lithe,slender,thin"',
    ]);

    const result = tagAutocompleteService.getTagByAlias('SLENDER');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('slim');
  });

  it('getTagByAlias 未命中返回 null：nonexistent_alias 不在索引中', async () => {
    await loadCsvLines([
      'slim,7,41092,"lanky,lithe,slender,thin"',
    ]);

    const result = tagAutocompleteService.getTagByAlias('nonexistent_alias');
    expect(result).toBeNull();
  });

  it('getTagByAlias 空串入参返回 null', async () => {
    await loadCsvLines([
      'slim,7,41092,"lanky,lithe,slender,thin"',
    ]);

    expect(tagAutocompleteService.getTagByAlias('')).toBeNull();
  });

  // ==================== 冲突策略：保留 count 更高的 tag ====================

  it('冲突策略保留 count 更高的 tag：foo 同时是 tag_a(100) 与 tag_b(500) 的别名，应返回 tag_b', async () => {
    // 两行都将 foo 作为别名，tag_b 的 count 更高（500 > 100）
    // 注意：CSV 解析顺序不影响结果（loadInternal 对每行都执行 count 比对）
    await loadCsvLines([
      'tag_a,0,100,foo',
      'tag_b,0,500,foo',
    ]);

    const result = tagAutocompleteService.getTagByAlias('foo');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('tag_b');
    expect(result?.count).toBe(500);
  });

  it('冲突策略保留 count 更高的 tag（反向写入顺序）：foo 仍应返回 count 更高的 tag_b', async () => {
    // 反向写入：count 高的 tag_b 在前，低的 tag_a 在后
    // 验证冲突策略在两种写入顺序下一致（保留 count 高的）
    await loadCsvLines([
      'tag_b,0,500,foo',
      'tag_a,0,100,foo',
    ]);

    const result = tagAutocompleteService.getTagByAlias('foo');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('tag_b');
    expect(result?.count).toBe(500);
  });

  // ==================== reload 清空重建 aliasMap ====================

  it('reload 清空重建：第一次 reload 含别名 slender，第二次 reload 不含，第二次后 getTagByAlias 返回 null', async () => {
    // 第一次 reload：包含 slender 别名
    await loadCsvLines([
      'slim,7,41092,"lanky,lithe,slender,thin"',
    ]);
    expect(tagAutocompleteService.getTagByAlias('slender')?.name).toBe('slim');

    // 第二次 reload：不含 slender 别名（仅含其他 tag）
    await loadCsvLines([
      'grey_hair,0,984236,"dark_grey_hair,gray_hair,light_gray_hair"',
    ]);

    // 第二次 reload 后 aliasMap 已清空重建，slender 不再存在
    expect(tagAutocompleteService.getTagByAlias('slender')).toBeNull();
    // 新的别名仍然可用（证明 aliasMap 正常重建）
    expect(tagAutocompleteService.getTagByAlias('light_gray_hair')?.name).toBe('grey_hair');
  });

  // ==================== 回归：getTagByName 行为不变 ====================

  it('回归验证：getTagByName 命中 slim（行为不受 aliasMap 影响）', async () => {
    await loadCsvLines([
      'slim,7,41092,"lanky,lithe,slender,thin"',
    ]);

    const result = tagAutocompleteService.getTagByName('slim');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('slim');
    expect(result?.category).toBe(7);
  });

  it('回归验证：getTagByName 大小写不敏感', async () => {
    await loadCsvLines([
      'grey_hair,0,984236,"dark_grey_hair,gray_hair,light_gray_hair"',
    ]);

    expect(tagAutocompleteService.getTagByName('GREY_HAIR')?.name).toBe('grey_hair');
  });

  // ==================== 别名引号格式兼容 ====================

  it('别名引号格式兼容：带引号与不带引号的别名均正确解析', async () => {
    // 混合格式：带引号（多别名逗号分隔）+ 不带引号（单别名）
    await loadCsvLines([
      'eyelashes,0,590607,"black_eyelashes,eye_lashes,eyelash"',
      'shirt,0,2937876,shirts',
    ]);

    // 带引号格式的别名
    expect(tagAutocompleteService.getTagByAlias('black_eyelashes')?.name).toBe('eyelashes');
    expect(tagAutocompleteService.getTagByAlias('eyelash')?.name).toBe('eyelashes');
    // 不带引号格式的别名
    expect(tagAutocompleteService.getTagByAlias('shirts')?.name).toBe('shirt');
  });
});
