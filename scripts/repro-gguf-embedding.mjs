// GGUF 版嵌入模型验证脚本
// 验证 node-llama-cpp 能否加载 Qwen3-Embedding-0.6B-Q8_0.gguf 并生成 1024 维向量
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const modelDir = path.join(__dirname, '..', 'models');
const modelName = 'Qwen/Qwen3-Embedding-0.6B-GGUF';
const modelPath = path.join(modelDir, modelName);

// 查找 .gguf 文件，优先 Q8_0 量化版本（与 modelFileValidator.ts 逻辑一致）
let ggufFile = null;
if (fs.existsSync(modelPath)) {
  const entries = fs.readdirSync(modelPath);
  const candidates = [];
  for (const entry of entries) {
    if (entry.toLowerCase().endsWith('.gguf')) {
      const stat = fs.statSync(path.join(modelPath, entry));
      if (stat.size > 0) {
        let priority = 0;
        if (entry.includes('Q8_0') || entry.includes('q8_0')) priority = 3;
        else if (entry.includes('Q4_K_M') || entry.includes('q4_k_m')) priority = 2;
        else if (entry.includes('f16') || entry.includes('F16')) priority = 1;
        candidates.push({ name: entry, priority });
      }
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.priority - a.priority);
    ggufFile = candidates[0].name;
  }
}

if (!ggufFile) {
  console.error('[REPRO-GGUF] No .gguf file found in', modelPath);
  process.exit(1);
}

const ggufFilePath = path.join(modelPath, ggufFile);
console.log('[REPRO-GGUF] Model:', modelName);
console.log('[REPRO-GGUF] GGUF file:', ggufFilePath);
console.log('[REPRO-GGUF] File size:', (fs.statSync(ggufFilePath).size / 1024 / 1024).toFixed(1), 'MB');

try {
  console.log('[REPRO-GGUF] Importing node-llama-cpp...');
  const { getLlama } = await import('node-llama-cpp');

  console.log('[REPRO-GGUF] Initializing llama...');
  const llama = await getLlama();
  console.log('[REPRO-GGUF] llama initialized');

  console.log('[REPRO-GGUF] Loading model...');
  const model = await llama.loadModel({ modelPath: ggufFilePath });
  console.log('[REPRO-GGUF] Model loaded');

  console.log('[REPRO-GGUF] Creating embedding context...');
  const context = await model.createEmbeddingContext();
  console.log('[REPRO-GGUF] Embedding context created');

  const testText = '测试本地嵌入模型连接';
  console.log('[REPRO-GGUF] Generating embedding for:', testText);
  const embedding = await context.getEmbeddingFor(testText);
  const vector = Array.from(embedding.vector);

  console.log('[REPRO-GGUF] Dimension:', vector.length);
  console.log('[REPRO-GGUF] First 5 values (raw):', vector.slice(0, 5));

  // L2 norm check (raw)
  const l2NormRaw = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  console.log('[REPRO-GGUF] L2 norm (raw):', l2NormRaw.toFixed(6));

  // L2 normalize (matching EmbeddingWorkerService.generateEmbedding)
  const norm = l2NormRaw;
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }
  const l2NormNormalized = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  console.log('[REPRO-GGUF] L2 norm (normalized):', l2NormNormalized.toFixed(6));
  console.log('[REPRO-GGUF] First 5 values (normalized):', vector.slice(0, 5));

  if (vector.length === 1024) {
    console.log('[REPRO-GGUF] ✅ SUCCESS: dimension is 1024, matches existing cache');
  } else {
    console.log('[REPRO-GGUF] ⚠️ WARNING: dimension is', vector.length, '(expected 1024)');
  }

  // Cleanup
  await context.dispose();
  await model.dispose();

  console.log('[REPRO-GGUF] Done');
  process.exit(0);
} catch (error) {
  console.error('[REPRO-GGUF] ❌ FAILED:', error);
  process.exit(1);
}
