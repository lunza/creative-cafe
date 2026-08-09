/**
 * UserSynonymMapService 单元测试
 *
 * Spec: add-multi-round-tag-audit / Task 5 / SubTask 5.2
 *
 * 验证目标：
 *   1. load()：文件不存在返回空 Map；正常 JSON 解析为 Map；损坏 JSON 返回空 Map；非对象 JSON 返回空 Map
 *   2. addMapping(original, replacement)：写入内存 + 落盘；key 大小写不敏感；空入参跳过
 *   3. lookup(tag)：命中返回 replacement；未命中返回 null；大小写不敏感
 *   4. removeMapping(original)：删除映射 + 落盘；不存在的 key 幂等；空入参跳过
 *   5. getMap()：返回 Record 形式（IPC 序列化友好）
 *
 * 测试策略：
 *   - mock fs（existsSync/readFileSync/writeFileSync/mkdirSync）+ mock ../../utils/appPath
 *   - 参考项目中 PromptTemplateService.test.ts 的 mock 模式（vi.mock fs + vi.mock appPath）
 *   - 用 vi.resetModules() + 动态 import 在每个测试重建服务单例，避免单例状态污染
 *   - 验证 fs.writeFileSync 的调用参数（确认持久化内容正确）+ 内存 Map 状态（确认逻辑正确）
 *
 * ⚠️ 真实持久化依赖 Electron 集成测试：
 *   - fs mock 验证逻辑（调用参数、内存状态），真实文件 IO 待集成测试
 *   - 跨会话保留（应用重启后 load 仍能读回）依赖真实 userData 路径与 fs 实际读写
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ============ Mock fs ============
// 仅 mock 需要的 API，其他保留真实实现
const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  ...fsMocks,
  default: { ...fsMocks },
}));

// ============ Mock ../../utils/appPath ============
// 避免 electron 依赖，返回固定路径（与 PromptTemplateService.test.ts 一致）
vi.mock('../../utils/appPath', () => ({
  getUserDataPath: vi.fn(() => '/fake/userdata'),
}));

// 静音 console（UserSynonymMapService 构造与各方法均有 console.log/warn/error）
vi.spyOn(console, 'log').mockImplementation(() => undefined);
vi.spyOn(console, 'warn').mockImplementation(() => undefined);
vi.spyOn(console, 'error').mockImplementation(() => undefined);

describe('UserSynonymMapService - 单元测试（Spec: add-multi-round-tag-audit / Task 1）', () => {
  // service 单例（动态 import 获取，避免跨测试单例状态污染）
  // 使用 any 类型：UserSynonymMapService 类未导出，无法直接引用类型
  let service: any;

  beforeEach(async () => {
    // 重置模块缓存 → 重建单例（UserSynonymMapService 构造时会调 ensureDirectoryExists）
    vi.resetModules();
    vi.clearAllMocks();

    // 重置 fs mock 默认行为
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readFileSync.mockReturnValue('{}');
    fsMocks.writeFileSync.mockClear();
    fsMocks.mkdirSync.mockClear();

    // 动态 import 获取新鲜单例（每次测试独立 cache + loaded 状态）
    const mod = await import('../userSynonymMapService');
    service = mod.userSynonymMapService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== load() ====================

  describe('load()', () => {
    it('文件不存在 → 返回空 Map（不抛异常、不写日志告警）', () => {
      fsMocks.existsSync.mockReturnValue(false);

      const map = service.load();

      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
      // readFileSync 不应被调用（existsSync 已返回 false）
      expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    });

    it('正常 JSON → 解析为 Map（key 小写、value 原样）', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          'b-cup': 'medium_breasts',
          'slender': 'slim',
          'light_gray_hair': 'grey_hair',
        })
      );

      const map = service.load();

      expect(map.size).toBe(3);
      expect(map.get('b-cup')).toBe('medium_breasts');
      expect(map.get('slender')).toBe('slim');
      expect(map.get('light_gray_hair')).toBe('grey_hair');
    });

    it('损坏 JSON → 返回空 Map（不覆盖磁盘文件）', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue('not valid json {{{');

      const map = service.load();

      expect(map.size).toBe(0);
      // 不应覆盖磁盘文件（writeFileSync 不应被调用）
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('JSON 是数组（非对象）→ 返回空 Map', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue('["b-cup", "medium_breasts"]');

      const map = service.load();

      expect(map.size).toBe(0);
    });

    it('JSON 是原始类型（非对象）→ 返回空 Map', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue('"just a string"');

      const map = service.load();

      expect(map.size).toBe(0);
    });

    it('JSON 含非字符串 value → 跳过该项（不污染内存）', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({
          'b-cup': 'medium_breasts',
          'invalid-num': 12345,
          'invalid-obj': { nested: true },
          'invalid-null': null,
          'empty-str': '',
        })
      );

      const map = service.load();

      // 仅 'b-cup' 是有效映射，其余 4 项被跳过
      expect(map.size).toBe(1);
      expect(map.get('b-cup')).toBe('medium_breasts');
    });

    it('重复 load 幂等：覆盖旧 cache', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ 'tag1': 'replacement1' }));
      const map1 = service.load();
      expect(map1.size).toBe(1);

      // 第二次 load：内容不同
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ 'tag2': 'replacement2' }));
      const map2 = service.load();

      expect(map2.size).toBe(1);
      expect(map2.has('tag1')).toBe(false);
      expect(map2.get('tag2')).toBe('replacement2');
    });
  });

  // ==================== addMapping() + lookup() ====================

  describe('addMapping() + lookup()', () => {
    it('addMapping 写入内存 + 落盘（writeFileSync 被调用且内容正确）', () => {
      service.addMapping('B-cup', 'medium_breasts');

      // 内存：lookup 命中
      expect(service.lookup('B-cup')).toBe('medium_breasts');
      // 落盘：writeFileSync 被调用
      expect(fsMocks.writeFileSync).toHaveBeenCalled();
      const writeCallArgs = fsMocks.writeFileSync.mock.calls[0];
      // 第二参数是 JSON 字符串内容（key 应为小写）
      const writtenContent = JSON.parse(writeCallArgs[1]);
      expect(writtenContent).toEqual({ 'b-cup': 'medium_breasts' });
    });

    it('lookup 大小写不敏感：B-cup 写入后，B-CUP / b-cup / b-Cup 均命中', () => {
      service.addMapping('B-cup', 'medium_breasts');

      expect(service.lookup('B-CUP')).toBe('medium_breasts');
      expect(service.lookup('b-cup')).toBe('medium_breasts');
      expect(service.lookup('b-Cup')).toBe('medium_breasts');
      expect(service.lookup('B-cup')).toBe('medium_breasts');
    });

    it('lookup 未命中返回 null', () => {
      service.addMapping('B-cup', 'medium_breasts');

      expect(service.lookup('nonexistent')).toBeNull();
    });

    it('lookup 空串入参返回 null', () => {
      expect(service.lookup('')).toBeNull();
    });

    it('lookup 纯空白入参返回 null', () => {
      expect(service.lookup('   ')).toBeNull();
    });

    it('addMapping 空 original → 跳过（不写入、不落盘）', () => {
      service.addMapping('', 'medium_breasts');

      expect(service.lookup('')).toBeNull();
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('addMapping 空 replacement → 跳过（无意义映射）', () => {
      service.addMapping('B-cup', '');

      expect(service.lookup('B-cup')).toBeNull();
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('addMapping 纯空白入参 → trim 后跳过', () => {
      service.addMapping('   ', 'medium_breasts');
      service.addMapping('B-cup', '   ');

      expect(service.lookup('B-cup')).toBeNull();
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('addMapping 同 key 已存在 → 覆盖（用户重新指定 = 更新映射）', () => {
      service.addMapping('B-cup', 'medium_breasts');
      expect(service.lookup('B-cup')).toBe('medium_breasts');

      // 覆盖为 small_breasts
      service.addMapping('B-cup', 'small_breasts');

      expect(service.lookup('B-cup')).toBe('small_breasts');
      // 落盘两次（两次 addMapping 都触发 save）
      expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(2);
      const lastWriteContent = JSON.parse(
        fsMocks.writeFileSync.mock.calls[1][1]
      );
      expect(lastWriteContent).toEqual({ 'b-cup': 'small_breasts' });
    });

    it('addMapping 多条映射 → 全部命中 + 落盘内容含全部映射', () => {
      service.addMapping('B-cup', 'medium_breasts');
      service.addMapping('slender', 'slim');
      service.addMapping('light_gray_hair', 'grey_hair');

      expect(service.lookup('B-cup')).toBe('medium_breasts');
      expect(service.lookup('slender')).toBe('slim');
      expect(service.lookup('light_gray_hair')).toBe('grey_hair');

      // 最后一次落盘内容应含全部 3 条映射
      const lastWriteContent = JSON.parse(
        fsMocks.writeFileSync.mock.calls[fsMocks.writeFileSync.mock.calls.length - 1][1]
      );
      expect(Object.keys(lastWriteContent)).toHaveLength(3);
      expect(lastWriteContent).toEqual({
        'b-cup': 'medium_breasts',
        'slender': 'slim',
        'light_gray_hair': 'grey_hair',
      });
    });
  });

  // ==================== removeMapping() ====================

  describe('removeMapping()', () => {
    it('removeMapping 删除已存在映射 + 落盘', () => {
      service.addMapping('B-cup', 'medium_breasts');
      expect(service.lookup('B-cup')).toBe('medium_breasts');

      // 记录 addMapping 后的 writeFileSync 调用次数
      const callsAfterAdd = fsMocks.writeFileSync.mock.calls.length;

      service.removeMapping('B-cup');

      // 已删除
      expect(service.lookup('B-cup')).toBeNull();
      // 落盘被调用（removeMapping 触发 save）
      expect(fsMocks.writeFileSync.mock.calls.length).toBeGreaterThan(callsAfterAdd);
      // 落盘内容应为空对象（最后一条映射被删除后 cache 为空）
      const lastWriteContent = JSON.parse(
        fsMocks.writeFileSync.mock.calls[fsMocks.writeFileSync.mock.calls.length - 1][1]
      );
      expect(lastWriteContent).toEqual({});
    });

    it('removeMapping 大小写不敏感：B-CUP 能删除 B-cup 的映射', () => {
      service.addMapping('B-cup', 'medium_breasts');

      service.removeMapping('B-CUP');

      expect(service.lookup('B-cup')).toBeNull();
    });

    it('removeMapping 不存在的 key → 幂等（不抛异常、不落盘）', () => {
      // cache 为空（未 addMapping）
      service.removeMapping('nonexistent');

      // 不抛异常、不落盘（cache 不含 key 时直接 return，不调 save）
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('removeMapping 空入参 → 跳过', () => {
      service.removeMapping('');

      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('removeMapping 纯空白入参 → trim 后跳过', () => {
      service.removeMapping('   ');

      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('removeMapping 删除一条后其余映射保留', () => {
      service.addMapping('B-cup', 'medium_breasts');
      service.addMapping('slender', 'slim');

      service.removeMapping('B-cup');

      // B-cup 已删除，slender 保留
      expect(service.lookup('B-cup')).toBeNull();
      expect(service.lookup('slender')).toBe('slim');
      // 落盘内容应仅含 slender
      const lastWriteContent = JSON.parse(
        fsMocks.writeFileSync.mock.calls[fsMocks.writeFileSync.mock.calls.length - 1][1]
      );
      expect(lastWriteContent).toEqual({ 'slender': 'slim' });
    });
  });

  // ==================== getMap() ====================

  describe('getMap()', () => {
    it('空映射表 → 返回空对象', () => {
      const result = service.getMap();
      expect(result).toEqual({});
    });

    it('含映射 → 返回 Record 形式（IPC 序列化友好）', () => {
      service.addMapping('B-cup', 'medium_breasts');
      service.addMapping('slender', 'slim');

      const result = service.getMap();

      expect(result).toEqual({
        'b-cup': 'medium_breasts',
        'slender': 'slim',
      });
    });

    it('getMap 返回浅拷贝（修改返回值不影响内部 cache）', () => {
      service.addMapping('B-cup', 'medium_breasts');

      const result = service.getMap();
      // 修改返回值
      result['b-cup'] = 'tampered';
      result['new-key'] = 'injected';

      // 内部 cache 不受影响
      expect(service.lookup('B-cup')).toBe('medium_breasts');
      expect(service.lookup('new-key')).toBeNull();
    });
  });

  // ==================== 持久化闭环验证 ====================

  describe('持久化闭环（addMapping → 落盘 → load 读回）', () => {
    it('addMapping 落盘后 load 能读回（模拟应用重启场景）', async () => {
      // 第一次：addMapping 写入
      service.addMapping('B-cup', 'medium_breasts');
      service.addMapping('slender', 'slim');

      // 捕获最后一次落盘内容
      const persistedContent = fsMocks.writeFileSync.mock.calls[
        fsMocks.writeFileSync.mock.calls.length - 1
      ][1] as string;

      // 模拟应用重启：重新加载模块（vi.resetModules）+ 让 readFileSync 返回落盘内容
      vi.resetModules();
      vi.clearAllMocks();
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(persistedContent);

      const reloaded = await import('../userSynonymMapService');
      const newService = reloaded.userSynonymMapService;

      // 显式 load（模拟 tagRagService.initialize 中的 load 调用）
      const map = newService.load();
      expect(map.size).toBe(2);
      expect(newService.lookup('B-cup')).toBe('medium_breasts');
      expect(newService.lookup('slender')).toBe('slim');
    });

    it('removeMapping 落盘后 load 不再读回已删除映射', async () => {
      // 第一次：add + remove
      service.addMapping('B-cup', 'medium_breasts');
      service.addMapping('slender', 'slim');
      service.removeMapping('B-cup');

      // 捕获最后一次落盘内容（remove 后）
      const persistedContent = fsMocks.writeFileSync.mock.calls[
        fsMocks.writeFileSync.mock.calls.length - 1
      ][1] as string;

      // 模拟应用重启
      vi.resetModules();
      vi.clearAllMocks();
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(persistedContent);

      const reloaded = await import('../userSynonymMapService');
      const newService = reloaded.userSynonymMapService;

      newService.load();
      expect(newService.lookup('B-cup')).toBeNull();
      expect(newService.lookup('slender')).toBe('slim');
    });
  });
});
