/**
 * modelFileValidator 单元测试（GGUF 版本）
 *
 * 【重点标记·transformers.js → node-llama-cpp 迁移】
 * 原 ONNX 多文件校验测试已重写为 GGUF 单文件校验测试。
 *
 * 覆盖 validateModelFiles 函数的文件完整性校验逻辑：
 *  1. 存在非空 GGUF 文件
 *  2. 缺失 GGUF 文件
 *  3. 空 GGUF 文件检测
 *  4. 目录不存在
 *  5. 多个 GGUF 文件时匹配第一个
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateModelFiles } from '../modelFileValidator';

// ==================== 测试工具 ====================

let testDir: string;

/** 创建唯一临时目录 */
function createTestDir(): string {
  const dir = path.join(os.tmpdir(), `model-validator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 写入非空文件 */
function writeFile(dir: string, relativePath: string, content: string): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

/** 创建空文件（size === 0） */
function writeEmptyFile(dir: string, relativePath: string): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, '', 'utf-8');
}

// ==================== 测试用例 ====================

describe('validateModelFiles (GGUF)', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ---------- 完整文件场景 ----------

  it('存在非空 GGUF 文件应校验通过', () => {
    writeFile(testDir, 'Qwen3-Embedding-0.6B-Q8_0.gguf', 'fake-gguf-content');

    const result = validateModelFiles(testDir);

    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.ggufFile).toBe('Qwen3-Embedding-0.6B-Q8_0.gguf');
  });

  it('存在不同名称的 GGUF 文件也应校验通过', () => {
    writeFile(testDir, 'model-Q4_K_M.gguf', 'fake-gguf-content');

    const result = validateModelFiles(testDir);

    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.ggufFile).toBe('model-Q4_K_M.gguf');
  });

  // ---------- 缺失文件场景 ----------

  it('目录中无 GGUF 文件应校验失败', () => {
    // 写入一些非 GGUF 文件
    writeFile(testDir, 'config.json', '{"model_type":"qwen3"}');
    writeFile(testDir, 'README.md', '# model');

    const result = validateModelFiles(testDir);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('*.gguf');
    expect(result.ggufFile).toBeUndefined();
  });

  // ---------- 空文件检测 ----------

  it('GGUF 文件存在但为空（size===0）应视为缺失', () => {
    writeEmptyFile(testDir, 'Qwen3-Embedding-0.6B-Q8_0.gguf');

    const result = validateModelFiles(testDir);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('*.gguf');
    expect(result.ggufFile).toBeUndefined();
  });

  // ---------- 目录不存在 ----------

  it('目录不存在时应返回缺失', () => {
    const nonExistentPath = path.join(os.tmpdir(), `nonexistent-${Date.now()}`);

    const result = validateModelFiles(nonExistentPath);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('*.gguf');
  });

  // ---------- 多 GGUF 文件 ----------

  it('存在多个 GGUF 文件时应匹配第一个非空文件', () => {
    writeFile(testDir, 'model-Q8_0.gguf', 'q8-content');
    writeFile(testDir, 'model-Q4_K_M.gguf', 'q4-content');

    const result = validateModelFiles(testDir);

    expect(result.valid).toBe(true);
    expect(result.ggufFile).toBeDefined();
    // 匹配到的应该是第一个非空 GGUF 文件
    expect(['model-Q8_0.gguf', 'model-Q4_K_M.gguf']).toContain(result.ggufFile);
  });

  it('空 GGUF 文件与非空 GGUF 文件并存时应匹配非空文件', () => {
    writeEmptyFile(testDir, 'empty.gguf');
    writeFile(testDir, 'valid.gguf', 'valid-content');

    const result = validateModelFiles(testDir);

    expect(result.valid).toBe(true);
    expect(result.ggufFile).toBe('valid.gguf');
  });
});
