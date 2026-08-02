import * as fs from 'fs';
import * as path from 'path';

/**
 * 模型文件校验结果（GGUF 版本）。
 *
 * 【重点标记·transformers.js → node-llama-cpp 迁移】
 * 原 ONNX 校验逻辑（多文件 + tokenizer + 量化标志）已简化为单 GGUF 文件校验。
 * node-llama-cpp 使用单个 .gguf 文件加载模型，无需 tokenizer/config 等辅助文件。
 */
export interface ModelFileValidationResult {
  valid: boolean;      // missing.length === 0
  missing: string[];   // 缺失/空文件的描述列表
  ggufFile?: string;   // 匹配到的 GGUF 文件名（如 'Qwen3-Embedding-0.6B-Q8_0.gguf'）
}

/**
 * 校验 node-llama-cpp 本地模型目录的文件完整性（GGUF 版本）。
 *
 * 校验规则：
 * 在 modelPath 目录中查找 .gguf 文件，找到且非空则 valid: true。
 * 若目录不存在或无 .gguf 文件或文件为空，返回 valid: false。
 *
 * @param modelPath 模型目录绝对路径
 * @returns 校验结果，`valid` 为 true 表示存在非空 GGUF 文件
 */
export function validateModelFiles(modelPath: string): ModelFileValidationResult {
  const missing: string[] = [];

  if (!fs.existsSync(modelPath)) {
    return { valid: false, missing: ['*.gguf'] };
  }

  // 在目录中查找 .gguf 文件，优先选择 Q8_0 量化版本（体积更小、性能更优）
  let ggufFile: string | undefined;
  try {
    const entries = fs.readdirSync(modelPath);
    const ggufFiles: { name: string; size: number; priority: number }[] = [];
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith('.gguf')) {
        const filePath = path.join(modelPath, entry);
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          // Q8_0 优先级最高（量化均衡），其次 Q4_K_M，最后 f16/其他
          let priority = 0;
          if (entry.includes('Q8_0') || entry.includes('q8_0')) priority = 3;
          else if (entry.includes('Q4_K_M') || entry.includes('q4_k_m')) priority = 2;
          else if (entry.includes('f16') || entry.includes('F16')) priority = 1;
          ggufFiles.push({ name: entry, size: stat.size, priority });
        }
      }
    }
    if (ggufFiles.length > 0) {
      ggufFiles.sort((a, b) => b.priority - a.priority);
      ggufFile = ggufFiles[0].name;
    }
  } catch {
    // 读取目录失败，视为缺失
  }

  if (!ggufFile) {
    missing.push('*.gguf');
  }

  return { valid: missing.length === 0, missing, ggufFile };
}
