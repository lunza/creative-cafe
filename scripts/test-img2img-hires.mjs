/**
 * img2img 高清修复方案对比测试脚本
 *
 * 用途：通过两种方案各生成一张表情图片，供视觉对比效果后决定采用哪种方案。
 *
 * 方案 A（直接高分辨率）：img2img 直接在 1024 长边分辨率下生成 + ADetailer 768×768 面部修复
 * 方案 B（两步放大）：    先 768 生成 → 再 1024 img2img 放大修复 + ADetailer 768×768
 *
 * 运行方式：
 *   node scripts/test-img2img-hires.mjs <角色卡PNG路径>
 *   node scripts/test-img2img-hires.mjs "G:\AI\creative-cafe\characters\Alice.png"
 *
 * 输出：scripts/test-output/ 目录下生成 4 个文件：
 *   - planA_1024_direct.png      （方案A 结果）
 *   - planB_step1_768.png        （方案B 第一步 768 中间结果）
 *   - planB_step2_1024_upscale.png（方案B 第二步 1024 最终结果）
 *   - comparison_log.txt          （生成参数与耗时日志）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

// ==================== 配置 ====================

const SD_ENDPOINT = 'http://localhost:7860';

// 生成参数（与项目 sdGenerationService 默认值一致）
const STEPS = 28;
const CFG_SCALE = 7;
const SAMPLER = 'DPM++ 2M Karras';
const DENOISING_STRENGTH = 0.55;
const NEGATIVE_PROMPT =
  'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';

// 表情生成 prompt（模拟 happy 表情）
const PROMPT =
  'portrait, 1girl, smiling, looking at viewer, simple background, high quality, best quality, masterpiece, detailed face';

// ADetailer 配置（与优化后的参数一致）
const ADETAILER_ARGS = {
  ad_model: 'face_yolov8n.pt',
  ad_prompt: PROMPT,
  ad_negative_prompt: NEGATIVE_PROMPT,
  ad_confidence: 0.3,
  ad_denoising_strength: 0.3,
  ad_mask_blur: 8,
  ad_dilate_erode: 8,
  ad_inpaint_only_masked: true,
  ad_inpaint_only_masked_padding: 32,
  ad_use_inpaint_width_height: true,
  ad_inpaint_width: 768,
  ad_inpaint_height: 768,
};

// ==================== 工具函数 ====================

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'test-output');

/**
 * 从 PNG 文件提取 base64 编码的图片数据。
 */
function pngToBase64(filePath) {
  const buffer = readFileSync(filePath);
  return buffer.toString('base64');
}

/**
 * 从 PNG buffer 解析 IHDR chunk 获取原始尺寸。
 */
function getPngDimensions(filePath) {
  const buffer = readFileSync(filePath);
  // PNG 签名 8 字节 → IHDR length 4 字节 → "IHDR" 4 字节 → width 4 字节 + height 4 字节
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * 按宽高比计算目标尺寸（长边对齐到 64 的倍数）。
 */
function calculateDimensions(origW, origH, longSideTarget) {
  const longSide = Math.max(origW, origH);
  const scale = longSideTarget / longSide;
  let width = Math.round((origW * scale) / 64) * 64;
  let height = Math.round((origH * scale) / 64) * 64;
  width = Math.max(64, width);
  height = Math.max(64, height);
  return { width, height };
}

/**
 * 调用 Forge Neo img2img API。
 */
async function img2img(base64Image, width, height, denoisingStrength, label) {
  const body = {
    init_images: [base64Image],
    prompt: PROMPT,
    negative_prompt: NEGATIVE_PROMPT,
    denoising_strength: denoisingStrength,
    steps: STEPS,
    cfg_scale: CFG_SCALE,
    width,
    height,
    sampler_name: SAMPLER,
    batch_size: 1,
    n_iter: 1,
    override_settings: {
      img2img_fix_steps: false,
    },
    alwayson_scripts: {
      ADetailer: {
        args: [true, ADETAILER_ARGS],
      },
    },
  };

  console.log(`  [${label}] POST /sdapi/v1/img2img  ${width}×${height}  denoising=${denoisingStrength}  steps=${STEPS}`);

  const startTime = Date.now();
  const response = await fetch(`${SD_ENDPOINT}/sdapi/v1/img2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`img2img API 返回 HTTP ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const data = await response.json();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!data.images || data.images.length === 0) {
    throw new Error(`img2img API 未返回图片`);
  }

  console.log(`  [${label}] 完成，耗时 ${elapsed}s`);
  return { imageBase64: data.images[0], elapsed };
}

/**
 * 保存 base64 图片到文件。
 */
function saveImage(base64Data, filename) {
  const buffer = Buffer.from(base64Data, 'base64');
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, buffer);
  console.log(`  已保存: ${filepath}`);
  return filepath;
}

// ==================== 主流程 ====================

async function main() {
  const cardPath = process.argv[2];

  if (!cardPath) {
    console.error('用法: node scripts/test-img2img-hires.mjs <角色卡PNG路径>');
    console.error('示例: node scripts/test-img2img-hires.mjs "G:\\AI\\creative-cafe\\characters\\Alice.png"');
    process.exit(1);
  }

  const resolvedPath = resolve(cardPath);
  console.log(`\n=== img2img 高清修复方案对比测试 ===`);
  console.log(`角色卡: ${resolvedPath}`);
  console.log(`SD 端点: ${SD_ENDPOINT}`);
  console.log(`Prompt: ${PROMPT}`);
  console.log(`Steps: ${STEPS}  |  CFG: ${CFG_SCALE}  |  Sampler: ${SAMPLER}  |  Denoising: ${DENOISING_STRENGTH}`);
  console.log(`ADetailer: ${ADETAILER_ARGS.ad_model}  |  inpaint ${ADETAILER_ARGS.ad_inpaint_width}×${ADETAILER_ARGS.ad_inpaint_height}  |  denoising ${ADETAILER_ARGS.ad_denoising_strength}\n`);

  // 创建输出目录
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 读取角色卡 PNG
  const base64Image = pngToBase64(resolvedPath);
  const origDims = getPngDimensions(resolvedPath);
  console.log(`原图尺寸: ${origDims.width}×${origDims.height}\n`);

  const logLines = [];
  logLines.push(`=== img2img 高清修复方案对比测试 ===`);
  logLines.push(`时间: ${new Date().toISOString()}`);
  logLines.push(`角色卡: ${resolvedPath}`);
  logLines.push(`原图尺寸: ${origDims.width}×${origDims.height}`);
  logLines.push(`Prompt: ${PROMPT}`);
  logLines.push(`Steps: ${STEPS} | CFG: ${CFG_SCALE} | Sampler: ${SAMPLER} | Denoising: ${DENOISING_STRENGTH}`);
  logLines.push(`ADetailer: ${ADETAILER_ARGS.ad_model} | inpaint ${ADETAILER_ARGS.ad_inpaint_width}×${ADETAILER_ARGS.ad_inpaint_height} | denoising ${ADETAILER_ARGS.ad_denoising_strength}`);
  logLines.push('');

  try {
    // ========== 方案 A：直接 1024 高分辨率 ==========
    console.log(`--- 方案 A：直接 1024 高分辨率 img2img ---`);
    const dimsA = calculateDimensions(origDims.width, origDims.height, 1024);
    logLines.push(`--- 方案 A：直接 1024 ---`);
    logLines.push(`目标尺寸: ${dimsA.width}×${dimsA.height}`);
    logLines.push(`denoising_strength: ${DENOISING_STRENGTH}`);

    const resultA = await img2img(base64Image, dimsA.width, dimsA.height, DENOISING_STRENGTH, 'PlanA');
    const fileA = saveImage(resultA.imageBase64, 'planA_1024_direct.png');
    logLines.push(`耗时: ${resultA.elapsed}s`);
    logLines.push(`输出: ${fileA}`);
    logLines.push('');

    // ========== 方案 B：两步放大（768 → 1024） ==========
    console.log(`\n--- 方案 B：两步放大（768 → 1024） ---`);

    // 第一步：768 分辨率生成
    const dimsB1 = calculateDimensions(origDims.width, origDims.height, 768);
    logLines.push(`--- 方案 B：两步放大 ---`);
    logLines.push(`步骤 1: ${dimsB1.width}×${dimsB1.height}  denoising=${DENOISING_STRENGTH}`);

    const resultB1 = await img2img(base64Image, dimsB1.width, dimsB1.height, DENOISING_STRENGTH, 'PlanB-Step1');
    const fileB1 = saveImage(resultB1.imageBase64, 'planB_step1_768.png');
    logLines.push(`步骤 1 耗时: ${resultB1.elapsed}s`);
    logLines.push(`步骤 1 输出: ${fileB1}`);

    // 第二步：将第一步结果放大到 1024，使用较低 denoising_strength 保留细节
    const dimsB2 = calculateDimensions(origDims.width, origDims.height, 1024);
    const DENOISING_STEP2 = 0.35; // 第二步降噪较低，保留第一步的细节
    logLines.push(`步骤 2: ${dimsB2.width}×${dimsB2.height}  denoising=${DENOISING_STEP2}`);

    const resultB2 = await img2img(resultB1.imageBase64, dimsB2.width, dimsB2.height, DENOISING_STEP2, 'PlanB-Step2');
    const fileB2 = saveImage(resultB2.imageBase64, 'planB_step2_1024_upscale.png');
    logLines.push(`步骤 2 耗时: ${resultB2.elapsed}s`);
    logLines.push(`步骤 2 输出: ${fileB2}`);
    logLines.push(`方案 B 总耗时: ${(parseFloat(resultB1.elapsed) + parseFloat(resultB2.elapsed)).toFixed(1)}s`);
    logLines.push('');

    // 写日志
    const logPath = join(OUTPUT_DIR, 'comparison_log.txt');
    writeFileSync(logPath, logLines.join('\n'), 'utf-8');

    console.log(`\n=== 测试完成 ===`);
    console.log(`输出目录: ${OUTPUT_DIR}`);
    console.log(`  方案 A 结果:       planA_1024_direct.png`);
    console.log(`  方案 B 第一步(768): planB_step1_768.png`);
    console.log(`  方案 B 最终(1024):  planB_step2_1024_upscale.png`);
    console.log(`  参数日志:           comparison_log.txt`);
    console.log(`\n请查看图片对比效果后决定采用哪种方案。`);

  } catch (error) {
    console.error(`\n=== 测试失败 ===`);
    console.error(error.message || error);
    logLines.push(`错误: ${error.message || error}`);
    writeFileSync(join(OUTPUT_DIR, 'comparison_log.txt'), logLines.join('\n'), 'utf-8');
    process.exit(1);
  }
}

main();
