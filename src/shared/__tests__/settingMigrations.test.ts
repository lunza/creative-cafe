/**
 * settingMigrations + settingsFileIO 单测（Spec: settings-feature-optimization-report / H-12 + H-2 + H-4）
 *
 * 覆盖：v1→v2 迁移（n / encrypt_api_key 剥离）、版本键补写、未来版本防御、
 * 原子写、损坏恢复（坏文件备份 + 重写空对象）、统一读取入口。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateSettings, SETTING_SCHEMA_VERSION, SETTING_SCHEMA_KEY } from '../settingMigrations';
import { atomicWriteJsonSync, readSettingsFile, readSettingsFileAsync } from '../../main/services/settingsFileIO';

let tmpDir: string;
let settingsPath: string;
const silentLog = () => {};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setting-migration-test-'));
  settingsPath = path.join(tmpDir, 'settings.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrateSettings（H-12 schema 迁移链）', () => {
  it('v1 文件：剥离 aiEngines[].n 与 encrypt_api_key，补写版本键，needsWriteBack=true', () => {
    const raw = {
      preset_name: 'Default',
      aiEngines: [
        { id: 'e1', n: 3, encrypt_api_key: true, api_key: 'sk-test' },
        { id: 'e2', n: 1, temperature: 0.7 }
      ]
    };
    const { setting, changes, needsWriteBack } = migrateSettings(raw);

    expect(setting.aiEngines[0]).not.toHaveProperty('n');
    expect(setting.aiEngines[0]).not.toHaveProperty('encrypt_api_key');
    expect(setting.aiEngines[0].api_key).toBe('sk-test');
    expect(setting.aiEngines[1]).not.toHaveProperty('n');
    expect(setting[SETTING_SCHEMA_KEY]).toBe(SETTING_SCHEMA_VERSION);
    expect(needsWriteBack).toBe(true);
    expect(changes).toHaveLength(3);
    expect(changes[0]).toContain('aiEngines[0]');
    expect(changes[0]).toContain('n');
  });

  it('已是当前版本的干净文件：不迁移、不产生变更、needsWriteBack=false', () => {
    const raw = {
      preset_name: 'Default',
      aiEngines: [{ id: 'e1', temperature: 0.7 }],
      [SETTING_SCHEMA_KEY]: SETTING_SCHEMA_VERSION
    };
    const { setting, changes, needsWriteBack } = migrateSettings(raw);
    expect(setting).toEqual(raw);
    expect(changes).toEqual([]);
    expect(needsWriteBack).toBe(false);
  });

  it('v1 文件无可删字段：仅补写版本键，changes 为空但 needsWriteBack=true', () => {
    const raw = { preset_name: 'Default', aiEngines: [{ id: 'e1' }] };
    const { setting, changes, needsWriteBack } = migrateSettings(raw);
    expect(setting[SETTING_SCHEMA_KEY]).toBe(SETTING_SCHEMA_VERSION);
    expect(changes).toEqual([]);
    expect(needsWriteBack).toBe(true);
  });

  it('未来版本（代码未升级）：原样透传，不迁移不补写', () => {
    const raw = { preset_name: 'Default', [SETTING_SCHEMA_KEY]: SETTING_SCHEMA_VERSION + 1 };
    const { setting, changes, needsWriteBack } = migrateSettings(raw);
    expect(setting).toBe(raw);
    expect(changes).toEqual([]);
    expect(needsWriteBack).toBe(false);
  });

  it('null / 非对象输入：原样透传', () => {
    expect(migrateSettings(null).setting).toBeNull();
    expect(migrateSettings('garbage').setting).toBe('garbage');
    expect(migrateSettings(null).needsWriteBack).toBe(false);
  });

  it('无 aiEngines 数组的 v1 文件：补写版本键不报错', () => {
    const { setting, needsWriteBack } = migrateSettings({ preset_name: 'Default' });
    expect(setting[SETTING_SCHEMA_KEY]).toBe(SETTING_SCHEMA_VERSION);
    expect(needsWriteBack).toBe(true);
  });

  // ===== v2 → v3（M-15/S-5/S-8/S-9/S-10 孤儿键批量剥离）=====

  it('v2 文件：剥离 aiEngines[] 孤儿采样/提示词键，保留真实消费字段，版本升 3.0.0', () => {
    const raw = {
      preset_name: 'Default',
      aiEngines: [{
        id: 'e1',
        // 孤儿键（应剥离）
        tfs: 1, mirostat_mode: 0, genamt: 350, max_length: 8192, sampler_priority: ['a'],
        impersonation_prompt: 'x', wi_format: '{0}', use_sysprompt: false, seed: -1,
        novelai_api_key: 'k', ai_horde_model: 'm', auto_connect: true, proxy_url: 'p',
        prompt_template: 't', stop_words: 's',
        // 真实消费字段（应保留）
        temperature: 0.7, max_tokens: 10240, top_p: 0.9, top_k: 40, min_p: 0.1,
        rep_pen: 1, dry_multiplier: 0, dry_base: 1.75, dry_allowed_length: 2,
        no_repeat_ngram_size: 0, frequency_penalty: 0, presence_penalty: 0,
        system_prompt: 'sp', continue_nudge_prompt: 'nudge', useAgent: false,
        connection_timeout: 120000, request_timeout: 300000, api_key_transmission: 'header',
      }],
      [SETTING_SCHEMA_KEY]: '2.0.0',
    };
    const { setting, changes, needsWriteBack } = migrateSettings(raw);

    // 孤儿键剥离
    for (const key of ['tfs', 'mirostat_mode', 'genamt', 'max_length', 'sampler_priority',
      'impersonation_prompt', 'wi_format', 'use_sysprompt', 'seed', 'novelai_api_key',
      'ai_horde_model', 'auto_connect', 'proxy_url', 'prompt_template', 'stop_words']) {
      expect(setting.aiEngines[0]).not.toHaveProperty(key);
    }
    // 真实消费字段保留
    expect(setting.aiEngines[0].temperature).toBe(0.7);
    expect(setting.aiEngines[0].dry_multiplier).toBe(0);
    expect(setting.aiEngines[0].continue_nudge_prompt).toBe('nudge');
    expect(setting.aiEngines[0].api_key_transmission).toBe('header');
    expect(setting[SETTING_SCHEMA_KEY]).toBe('3.0.0');
    expect(needsWriteBack).toBe(true);
    expect(changes.some((c: string) => c.includes('aiEngines[0]') && c.includes('S-5'))).toBe(true);
  });

  it('v2 文件：剥离顶层孤儿键 + vector 四孤儿子键 + tagAutocomplete.csvPath', () => {
    const raw = {
      preset_name: 'Default',
      autoOptimize: true, optimizeLevel: 'fast', backupBeforeOptimize: true,
      sillyTavernRoot: 'C:\\st', pluginPath: 'C:\\st\\plugins',
      vector: {
        embeddingMode: 'remote', remoteModel: 'text-embedding-3-small',
        vectorStoreMode: 'sqlite-vec', autoRetrieveContext: true,
        contextTopK: 8, contextMinScore: 0.5, dimension: 4096,
      },
      tagAutocomplete: { enabled: true, csvPath: 'C:\\tags.csv', sortBy: 'relevance' },
      [SETTING_SCHEMA_KEY]: '2.0.0',
    };
    const { setting, needsWriteBack } = migrateSettings(raw);

    for (const key of ['autoOptimize', 'optimizeLevel', 'backupBeforeOptimize', 'sillyTavernRoot', 'pluginPath']) {
      expect(setting).not.toHaveProperty(key);
    }
    expect(setting.vector).not.toHaveProperty('vectorStoreMode');
    expect(setting.vector).not.toHaveProperty('autoRetrieveContext');
    expect(setting.vector).not.toHaveProperty('contextTopK');
    expect(setting.vector).not.toHaveProperty('contextMinScore');
    // vector 合法字段保留
    expect(setting.vector.embeddingMode).toBe('remote');
    expect(setting.vector.dimension).toBe(4096);
    // csvPath 剥离，其余字段保留
    expect(setting.tagAutocomplete).not.toHaveProperty('csvPath');
    expect(setting.tagAutocomplete.enabled).toBe(true);
    expect(setting.tagAutocomplete.sortBy).toBe('relevance');
    expect(needsWriteBack).toBe(true);
  });

  it('v3 干净文件：无孤儿键可剥离，幂等不产生变更', () => {
    const raw = {
      preset_name: 'Default',
      aiEngines: [{ id: 'e1', temperature: 0.7 }],
      vector: { embeddingMode: 'remote', dimension: 4096 },
      [SETTING_SCHEMA_KEY]: SETTING_SCHEMA_VERSION,
    };
    const { setting, changes, needsWriteBack } = migrateSettings(raw);
    expect(setting).toEqual(raw);
    expect(changes).toEqual([]);
    expect(needsWriteBack).toBe(false);
  });
});

describe('atomicWriteJsonSync（H-2 原子写）', () => {
  it('新文件：写入内容可解析且与源对象一致', () => {
    atomicWriteJsonSync(settingsPath, { a: 1, nested: { b: [1, 2, 3] } });
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(parsed).toEqual({ a: 1, nested: { b: [1, 2, 3] } });
    expect(fs.existsSync(`${settingsPath}.tmp`)).toBe(false);
  });

  it('覆盖已存在文件：旧内容被完整替换，无半截 JSON', () => {
    atomicWriteJsonSync(settingsPath, { old: true });
    atomicWriteJsonSync(settingsPath, { fresh: 'content' });
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(parsed).toEqual({ fresh: 'content' });
  });
});

describe('readSettingsFile（H-4 损坏恢复 + H-12 迁移统一读取入口）', () => {
  it('文件不存在：data=null，无恢复无迁移', () => {
    const result = readSettingsFile(settingsPath, silentLog);
    expect(result.data).toBeNull();
    expect(result.corrupted).toBe(false);
    expect(result.needsWriteBack).toBe(false);
  });

  it('损坏文件：触发恢复——坏文件被备份为 .corrupt-*，原文件被原子重写为空对象', () => {
    fs.writeFileSync(settingsPath, '{"aiEngines": [broken', 'utf-8');
    const result = readSettingsFile(settingsPath, silentLog);

    expect(result.corrupted).toBe(true);
    expect(result.data).toEqual({});
    expect(result.needsWriteBack).toBe(true);

    const backups = fs.readdirSync(tmpDir).filter(f => f.startsWith('settings.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, backups[0]), 'utf-8')).toBe('{"aiEngines": [broken');

    const repaired = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(repaired).toEqual({});
  });

  it('合法 v1 文件：返回迁移后对象（剥离 n/encrypt_api_key + 版本键），needsWriteBack=true', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ aiEngines: [{ id: 'e1', n: 2, encrypt_api_key: false }] }), 'utf-8');
    const result = readSettingsFile(settingsPath, silentLog);

    expect(result.corrupted).toBe(false);
    expect(result.data.aiEngines[0]).not.toHaveProperty('n');
    expect(result.data.aiEngines[0]).not.toHaveProperty('encrypt_api_key');
    expect(result.data[SETTING_SCHEMA_KEY]).toBe(SETTING_SCHEMA_VERSION);
    expect(result.migrated).toHaveLength(2);
    expect(result.needsWriteBack).toBe(true);
  });

  it('合法当前版本文件：直接返回，needsWriteBack=false，不产生迁移日志', () => {
    const content = { preset_name: 'Default', aiEngines: [{ id: 'e1' }], [SETTING_SCHEMA_KEY]: SETTING_SCHEMA_VERSION };
    fs.writeFileSync(settingsPath, JSON.stringify(content), 'utf-8');
    const result = readSettingsFile(settingsPath, silentLog);

    expect(result.data).toEqual(content);
    expect(result.migrated).toEqual([]);
    expect(result.needsWriteBack).toBe(false);
  });
});

describe('readSettingsFileAsync（L-4/ST-7 启动期同步 I/O 异步化：行为与同步版一致）', () => {
  it('文件不存在：data=null，无恢复无迁移', async () => {
    const result = await readSettingsFileAsync(settingsPath, silentLog);
    expect(result.data).toBeNull();
    expect(result.corrupted).toBe(false);
    expect(result.needsWriteBack).toBe(false);
  });

  it('损坏文件：触发恢复——坏文件被备份为 .corrupt-*，原文件被原子重写为空对象', async () => {
    fs.writeFileSync(settingsPath, '{"aiEngines": [broken', 'utf-8');
    const result = await readSettingsFileAsync(settingsPath, silentLog);

    expect(result.corrupted).toBe(true);
    expect(result.data).toEqual({});
    expect(result.needsWriteBack).toBe(true);

    const backups = fs.readdirSync(tmpDir).filter(f => f.startsWith('settings.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, backups[0]), 'utf-8')).toBe('{"aiEngines": [broken');

    const repaired = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(repaired).toEqual({});
  });

  it('合法 v1 文件：返回迁移后对象，needsWriteBack=true（与同步版同语义）', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ aiEngines: [{ id: 'e1', n: 2, encrypt_api_key: false }] }), 'utf-8');
    const result = await readSettingsFileAsync(settingsPath, silentLog);

    expect(result.corrupted).toBe(false);
    expect(result.data.aiEngines[0]).not.toHaveProperty('n');
    expect(result.data.aiEngines[0]).not.toHaveProperty('encrypt_api_key');
    expect(result.data[SETTING_SCHEMA_KEY]).toBe(SETTING_SCHEMA_VERSION);
    expect(result.migrated).toHaveLength(2);
    expect(result.needsWriteBack).toBe(true);
  });

  it('合法当前版本文件：直接返回，needsWriteBack=false', async () => {
    const content = { preset_name: 'Default', aiEngines: [{ id: 'e1' }], [SETTING_SCHEMA_KEY]: SETTING_SCHEMA_VERSION };
    fs.writeFileSync(settingsPath, JSON.stringify(content), 'utf-8');
    const result = await readSettingsFileAsync(settingsPath, silentLog);

    expect(result.data).toEqual(content);
    expect(result.migrated).toEqual([]);
    expect(result.needsWriteBack).toBe(false);
  });
});
