import * as fsSync from 'fs';

/**
 * SDGenerationService —— Stable Diffusion WebUI API 客户端服务（主进程）
 *
 * Spec: add-ai-expression-generation / Task 1
 *
 * 通过本地 SD WebUI（Forge Neo，默认 http://localhost:7860）的 `/sdapi/v1/img2img`
 * 端点调用图生图能力，以角色卡 PNG 中提取的基底图片为输入，配合情绪提示词与
 * ADetailer 面部一致性修复，自动生成角色卡表情包。
 *
 * 设计说明：
 * - 使用 Node.js 内置 `fetch`（Node 18+ 原生支持，本项目运行于 Node 24），不引入 axios 等额外依赖
 * - 单例模式，与 expressionService / avatarService 风格一致
 * - 所有公共方法返回结构化结果对象 `{ success, error?, ... }`，绝不抛出异常给调用方
 * - img2img 单次请求超时 120 秒（SDXL 28 步 + ADetailer 较慢）
 *
 * 错误处理覆盖：
 * - 连接被拒绝（SD WebUI 未启动 / 端口错误）
 * - 请求超时（120s）
 * - HTTP 非 2xx 错误
 * - 响应体为空 / images 数组为空
 */

// ==================== Types ====================

// SD 模型类型
export type SDModelType = 'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2';

// 模型类型推荐参数
export interface SDModelTypePreset {
  endpoint: 'img2img' | 'txt2img';
  denoising: number;
  steps: number;
  cfgScale: number;
  sampler: string;
  adetailerEnabled: boolean;
  width: number;
  height: number;
}

export const MODEL_TYPE_PRESETS: Record<SDModelType, SDModelTypePreset> = {
  'sdxl': {
    endpoint: 'img2img',
    denoising: 0.55,
    steps: 28,
    cfgScale: 7,
    sampler: 'DPM++ 2M Karras',
    adetailerEnabled: true,
    width: 512,
    height: 512,
  },
  'qwen-image': {
    endpoint: 'txt2img',
    denoising: 1.0,
    steps: 28,
    cfgScale: 7,
    sampler: 'Euler',
    adetailerEnabled: false,
    width: 1024,
    height: 1024,
  },
  'qwen-image-edit': {
    endpoint: 'img2img',
    denoising: 0.95,
    steps: 28,
    cfgScale: 7,
    sampler: 'Euler',
    adetailerEnabled: false,
    width: 512,
    height: 512,
  },
  'flux2': {
    endpoint: 'txt2img',
    denoising: 0.8,
    steps: 28,
    cfgScale: 7,
    sampler: 'Euler',
    adetailerEnabled: false,
    width: 1024,
    height: 1024,
  },
};

// 根据模型文件名自动检测模型类型
export function detectModelType(modelName: string): SDModelType {
  const lower = modelName.toLowerCase();
  if (lower.includes('qwen') && lower.includes('edit')) {
    return 'qwen-image-edit';
  }
  if (lower.includes('qwen')) {
    return 'qwen-image';
  }
  if (lower.includes('klein') || lower.includes('flux.2')) {
    return 'flux2';
  }
  return 'sdxl';
}

/**
 * SD 图生图生成选项
 */
export interface SDGenerationOptions {
  /** SD WebUI API 端点，默认 http://localhost:7860 */
  endpoint?: string;
  /** 去噪强度（0=不变，1=完全重绘），默认 0.55 */
  denoisingStrength?: number;
  /** 采样步数，默认 28（SDXL 推荐） */
  steps?: number;
  /** 提示词遵循度，默认 7 */
  cfgScale?: number;
  /** 输出宽度，默认 512 */
  width?: number;
  /** 输出高度，默认 512 */
  height?: number;
  /** txt2img 输出宽度，默认 1024（Spec: integrate-nl-driven-sd-models / Task 3） */
  txt2imgWidth?: number;
  /** txt2img 输出高度，默认 1024（Spec: integrate-nl-driven-sd-models / Task 3） */
  txt2imgHeight?: number;
  /** 采样器名称，默认 "DPM++ 2M Karras" */
  sampler?: string;
  /** 是否启用 ADetailer 面部修复，默认 true */
  adetailerEnabled?: boolean;
  /** 负面提示词，默认空字符串 */
  negativePrompt?: string;
  /** 覆盖当前模型（可选，传入则先切换模型再生成） */
  model?: string;
  /** SD 模型类型（可选，未提供时可根据模型文件名自动检测） */
  modelType?: SDModelType;

  /**
   * 角色视觉特征 tag 列表（Spec: add-asset-and-trait-management / Task 4）
   *
   * 【重点标记 - 特征携带机制】
   * 用于在 SD 生成任何素材时自动携带角色特征，保证角色一致性。
   * 例如 `['white fur', 'dog girl']` 会被拼接为 `white fur, dog girl`，
   * 替换提示词模板中的 `{traits}` 占位符。
   *
   * 行为说明：
   * - 若为空数组或 undefined，`{traits}` 占位符替换为空字符串（并清理多余逗号与空格）
   * - 若模板不含 `{traits}` 占位符，本字段不生效（由 PromptBuilder 兜底追加，见 Task 5）
   * - ADetailer 的 `ad_prompt` 同步使用已注入特征的最终 prompt，保证面部修复也携带特征
   */
  characterTraits?: string[];

  /**
   * ADetailer 高级参数（Spec: add-ai-expression-generation / Task 6 扩展，2026-07-27）
   *
   * 【重点标记 - ADetailer-Neo 兼容性】
   * ADetailer-Neo（sd-webui-forge-neo 默认扩展）的 `ADetailerArgs` pydantic 模型使用
   * `ConfigDict(extra="forbid")`，禁止任何未定义字段。字段名必须严格对齐
   * `extensions/ADetailer-Neo/lib_adetailer/args.py` 中的 `ADetailerArgs` 定义，
   * 否则会抛 `pydantic_core.ValidationError: Extra inputs are not permitted`。
   *
   * 关键字段名修正历史：
   * - `ad_inpaint_full_res`（原版 ADetailer 有）→ Neo 已移除，改用 `ad_use_inpaint_width_height` + `ad_inpaint_width/height`
   * - `ad_dilation`（错误拼写）→ Neo 正确字段名为 `ad_dilate_erode`
   */
  /** ADetailer 检测模型，默认 "face_yolov8n.pt" */
  adModel?: string;
  /** 检测置信度阈值（0.0-1.0），默认 0.3 */
  adConfidence?: number;
  /** ADetailer 面部修复去噪强度（0.0-1.0），默认 0.4 */
  adDenoisingStrength?: number;
  /** mask 边缘模糊（像素，0-20），默认 4 */
  adMaskBlur?: number;
  /** mask 膨胀/腐蚀（像素，正值膨胀/负值腐蚀），默认 4 */
  adDilateErode?: number;
  /** 仅修复 mask 区域（True=局部高分辨率修复，False=全图重绘），默认 true */
  adInpaintOnlyMasked?: boolean;
  /** mask padding（像素，仅 ad_inpaint_only_masked=true 时生效），默认 32 */
  adInpaintOnlyMaskedPadding?: number;
  /** 使用独立的修复尺寸（开启后 ad_inpaint_width/height 生效），默认 false */
  adUseInpaintWidthHeight?: boolean;
  /** ADetailer 修复宽度（像素），默认 512 */
  adInpaintWidth?: number;
  /** ADetailer 修复高度（像素），默认 512 */
  adInpaintHeight?: number;
  /** 使用独立的步数（开启后 ad_steps 生效），默认 false */
  adUseSteps?: boolean;
  /** ADetailer 独立步数（1-150），默认 20 */
  adSteps?: number;
  /** 使用独立的 CFG（开启后 ad_cfg_scale 生效），默认 false */
  adUseCfgScale?: boolean;
  /** ADetailer 独立 CFG（1.0-24.0），默认 4.0 */
  adCfgScale?: number;
  /** 使用独立的采样器（开启后 ad_sampler 生效），默认 false */
  adUseSampler?: boolean;
  /** ADetailer 独立采样器名称，默认 "Use same sampler"（沿用主采样器） */
  adSampler?: string;

  /** 选中的 LoRA 模型列表，生成时注入 <lora:name:weight> 到 prompt 前部 */
  selectedLoras?: Array<{ name: string; weight: number }>;
}

/**
 * SD 生成结果
 */
export interface SDGenerationResult {
  /** 是否成功 */
  success: boolean;
  /** 生成图像的 base64 字符串（不含 data:image/png;base64, 前缀） */
  imageBase64?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 警告信息（成功时可能附带，例如参数推荐提示） */
  warning?: string;
}

/**
 * SD WebUI 状态检查结果
 */
export interface SDStatusResult {
  /** API 是否可用 */
  available: boolean;
  /** 当前加载的模型 checkpoint 名称 */
  currentModel?: string;
  /** ADetailer 扩展是否可用（通过 /sdapi/v1/script-info 检测） */
  adetailerAvailable?: boolean;
  /** 错误信息（不可用时） */
  error?: string;
}

/**
 * SD WebUI 模型信息
 */
export interface SDModel {
  /** 模型标题（含路径，例如 "sd_xl_base_1.0.safetensors [hash]"） */
  title: string;
  /** 模型名（不含路径与 hash） */
  model_name: string;
  /** 模型 hash（可选） */
  hash?: string;
}

/**
 * img2img 生成参数（外部调用方传入）
 */
export interface SDGenerateParams {
  /** SD WebUI API 端点 */
  endpoint: string;
  /** 基底图片 base64（不含 data: 前缀） */
  baseImageBase64: string;
  /** 正面提示词 */
  prompt: string;
  /** 负面提示词 */
  negativePrompt: string;
  /** 生成选项 */
  options?: SDGenerationOptions;
}

/**
 * SD 文生图（txt2img）生成参数
 */
export interface SDTxt2ImgParams {
  /** SD WebUI API 端点 */
  endpoint: string;
  /** 正面提示词（自然语言） */
  prompt: string;
  /** 负面提示词 */
  negativePrompt?: string;
  /** 生成选项 */
  options?: SDGenerationOptions;
}

// ==================== Defaults ====================

/** 默认 SD WebUI API 端点 */
const DEFAULT_ENDPOINT = 'http://localhost:7860';

/** 默认生成参数（与 Spec 关键参数表一致） */
const DEFAULT_DENOISING_STRENGTH = 0.55;
const DEFAULT_STEPS = 28;
const DEFAULT_CFG_SCALE = 7;
const DEFAULT_WIDTH = 512;
const DEFAULT_HEIGHT = 512;
const DEFAULT_SAMPLER = 'DPM++ 2M Karras';

/** img2img 请求超时（毫秒），SDXL + ADetailer 较慢，给足 120 秒 */
const GENERATION_TIMEOUT_MS = 120_000;

/** 普通状态/模型查询请求超时（毫秒） */
const SHORT_TIMEOUT_MS = 10_000;

/** ADetailer 默认配置（与 ADetailer-Neo `ADetailerArgs` 默认值对齐）*/
const ADETAILER_MODEL = 'face_yolov8n.pt';
const ADETAILER_CONFIDENCE = 0.3;
const ADETAILER_DENOISING_STRENGTH = 0.4;
const ADETAILER_MASK_BLUR = 4;
const ADETAILER_DILATE_ERODE = 4;
const ADETAILER_INPAINT_ONLY_MASKED = true;
const ADETAILER_INPAINT_ONLY_MASKED_PADDING = 32;

// ==================== Service ====================

class SDGenerationService {
  constructor() {
    console.log('[SDGenerationService] Initialized. Default endpoint:', DEFAULT_ENDPOINT);
  }

  /**
   * 规范化端点 URL：去除末尾斜杠，避免 `${endpoint}/sdapi/v1/...` 出现双斜杠。
   */
  private normalizeEndpoint(endpoint: string): string {
    const ep = (endpoint || '').trim();
    if (!ep) {
      return DEFAULT_ENDPOINT;
    }
    return ep.replace(/\/+$/, '');
  }

  /**
   * 从 base64 编码的 PNG 数据中解析原始图片尺寸。
   *
   * 【重点标记 - 图片变扁修复】
   * img2img 默认将 init_images resize 到 width×height，若角色卡原图非正方形
   * （如 512×768 竖图），强制 resize 到 512×512 会导致图片变扁。
   * 本方法解析 PNG IHDR chunk 获取原始宽高，用于按宽高比计算目标尺寸。
   *
   * PNG 文件结构：
   *   - 字节 0-7：PNG 签名（89 50 4E 47 0D 0A 1A 0A）
   *   - 字节 8-11：IHDR chunk 长度（固定 13）
   *   - 字节 12-15："IHDR"（49 48 44 52）
   *   - 字节 16-19：宽度（4 字节 big-endian）
   *   - 字节 20-23：高度（4 字节 big-endian）
   *
   * @param base64 PNG 图片的 base64 字符串（不含 data: 前缀）
   * @returns `{ width, height }` 或 `null`（非 PNG / 解析失败）
   */
  private getPngDimensionsFromBase64(base64: string): { width: number; height: number } | null {
    try {
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length < 24) return null;
      // 检查 PNG 签名
      if (
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        return null;
      }
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    } catch {
      return null;
    }
  }

  /**
   * 按原始宽高比计算目标生成尺寸（长边 512，短边对齐到 64 的倍数）。
   *
   * 【重点标记 - 图片变扁修复】
   * SD 的 width/height 必须是 8 或 64 的倍数（取决于模型），本方法对齐到 64。
   *
   * @param originalWidth 原始宽度
   * @param originalHeight 原始高度
   * @param longSideTarget 长边目标像素（默认 512）
   * @returns `{ width, height }` 已对齐到 64 的倍数
   */
  private calculateAspectRatioDimensions(
    originalWidth: number,
    originalHeight: number,
    longSideTarget: number = DEFAULT_WIDTH
  ): { width: number; height: number } {
    const longSide = Math.max(originalWidth, originalHeight);
    const scale = longSideTarget / longSide;
    let width = Math.round((originalWidth * scale) / 64) * 64;
    let height = Math.round((originalHeight * scale) / 64) * 64;
    // 确保最小 64
    width = Math.max(64, width);
    height = Math.max(64, height);
    return { width, height };
  }

  /**
   * 格式化 HTTP 错误响应为用户友好的错误消息。
   *
   * 【重点标记 - 404 错误友好提示】
   * SD WebUI Forge Neo 默认不启用 API（`/sdapi/v1/*` 路由不注册），
   * 未添加 `--api` 启动参数时所有 API 请求返回 HTTP 404 `{"detail":"Not Found"}`。
   * 此方法检测 404 并给出可操作的提示，引导用户修改 `webui-user.bat`。
   *
   * @param response fetch Response 对象
   * @param errorText 响应体文本（可选）
   * @returns 用户友好的错误消息
   */
  private formatHttpError(response: Response, errorText: string): string {
    if (response.status === 404) {
      return (
        `SD WebUI API 不可用（HTTP 404）。\n` +
        `请确认 Forge Neo 启动时已添加 --api 参数：\n` +
        `  在 webui-user.bat 中设置 set COMMANDLINE_ARGS=--api\n` +
        `修改后需关闭并重新启动 SD WebUI。\n` +
        `原始响应：${errorText || response.statusText}`
      );
    }
    return `SD WebUI 返回 HTTP ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`;
  }

  /**
   * 带超时的 fetch 封装。
   * 通过 AbortController 实现单次请求超时，超时后抛出可识别的错误。
   *
   * @param url 请求 URL
   * @param init fetch 初始化参数
   * @param timeoutMs 超时毫秒
   * @returns fetch Response
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      // 区分超时与其他网络错误，便于上层给出友好提示
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`请求超时（${timeoutMs / 1000}秒）`);
      }
      // fetch 网络错误（连接被拒绝/DNS 失败等）通常是 TypeError
      if (error instanceof TypeError) {
        throw new Error(
          `无法连接到 SD WebUI（${url}），请确认 Forge Neo 已启动且开启了 --api 参数。原始错误：${error.message}`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 检查 SD WebUI API 状态。
   * Spec: add-ai-expression-generation / Task 1
   *
   * GET `${endpoint}/sdapi/v1/options`，返回当前模型 checkpoint 名称。
   * 同时查询 `/sdapi/v1/script-info` 检测 ADetailer 扩展是否可用。
   *
   * @param endpoint SD WebUI API 端点（如 http://localhost:7860）
   * @returns `{ available: true, currentModel, adetailerAvailable }` 或 `{ available: false, error }`
   */
  async checkStatus(endpoint: string): Promise<SDStatusResult> {
    const ep = this.normalizeEndpoint(endpoint);
    const url = `${ep}/sdapi/v1/options`;

    try {
      console.log('[SDGenerationService] checkStatus: GET', url);
      const response = await this.fetchWithTimeout(url, { method: 'GET' }, SHORT_TIMEOUT_MS);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          available: false,
          error: this.formatHttpError(response, errorText),
        };
      }

      const data = (await response.json()) as { sd_model_checkpoint?: string };

      // 【重点标记 - ADetailer 可用性检测】
      // 查询 /sdapi/v1/script-info 检测 ADetailer 扩展是否安装并可用。
      // 失败时不影响主流程，仅 adetailerAvailable = false。
      let adetailerAvailable = false;
      try {
        const scriptInfoUrl = `${ep}/sdapi/v1/script-info`;
        const scriptResponse = await this.fetchWithTimeout(
          scriptInfoUrl,
          { method: 'GET' },
          SHORT_TIMEOUT_MS
        );
        if (scriptResponse.ok) {
          const scripts = (await scriptResponse.json()) as Array<{ name?: string; is_alwayson?: boolean }>;
          adetailerAvailable = scripts.some(
            (s) => s.name === 'ADetailer' || s.name === 'adetailer'
          );
          console.log('[SDGenerationService] checkStatus: ADetailer available =', adetailerAvailable);
        }
      } catch (scriptError) {
        // script-info 查询失败不影响状态检查主流程
        console.warn('[SDGenerationService] checkStatus: script-info query failed:', scriptError);
      }

      return {
        available: true,
        currentModel: data.sd_model_checkpoint,
        adetailerAvailable,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] checkStatus failed:', message);
      return { available: false, error: message };
    }
  }

  /**
   * 获取 SD WebUI 已加载的模型列表。
   * Spec: add-ai-expression-generation / Task 1
   *
   * GET `${endpoint}/sdapi/v1/sd-models`。
   *
   * @param endpoint SD WebUI API 端点
   * @returns `{ success, models, error? }`
   */
  async getModels(
    endpoint: string
  ): Promise<{ success: boolean; models: SDModel[]; error?: string }> {
    const ep = this.normalizeEndpoint(endpoint);
    const url = `${ep}/sdapi/v1/sd-models`;

    try {
      console.log('[SDGenerationService] getModels: GET', url);
      const response = await this.fetchWithTimeout(url, { method: 'GET' }, SHORT_TIMEOUT_MS);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          models: [],
          error: this.formatHttpError(response, errorText),
        };
      }

      const data = (await response.json()) as SDModel[];
      // 防御性兜底：API 偶尔可能返回 null
      const models = Array.isArray(data) ? data : [];
      return { success: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] getModels failed:', message);
      return { success: false, models: [], error: message };
    }
  }

  /**
   * 从角色卡 PNG 文件提取基底图片（base64）。
   * Spec: add-ai-expression-generation / Task 1
   *
   * 角色卡 PNG 文件本身就是图片（tEXt chunk 中存放 JSON 元数据，但 PNG 图像数据
   * 即为角色基底图片），因此直接读取文件二进制并转 base64 即可，无需解析 PNG chunk。
   *
   * 与 avatarService 读取角色卡的方式一致：使用 `fs.readFileSync` + `Buffer.toString('base64')`。
   * 返回的 base64 不含 `data:image/png;base64,` 前缀，可直接传给 SD WebUI 的 `init_images`。
   *
   * @param characterCardPath 角色卡 PNG 文件绝对路径
   * @returns `{ success, imageBase64?, error? }`
   */
  async extractBaseImage(
    characterCardPath: string
  ): Promise<{ success: boolean; imageBase64?: string; error?: string }> {
    try {
      if (!characterCardPath) {
        return { success: false, error: 'characterCardPath 不能为空' };
      }
      if (!fsSync.existsSync(characterCardPath)) {
        return { success: false, error: `角色卡文件不存在：${characterCardPath}` };
      }

      console.log('[SDGenerationService] extractBaseImage: reading', characterCardPath);
      const buffer = fsSync.readFileSync(characterCardPath);
      const imageBase64 = buffer.toString('base64');
      console.log(
        '[SDGenerationService] extractBaseImage: success, size=',
        buffer.length,
        'bytes'
      );
      return { success: true, imageBase64 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] extractBaseImage failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * 切换 SD WebUI 当前模型。
   * 内部辅助方法，仅在 `options.model` 提供时调用。
   *
   * POST `${endpoint}/sdapi/v1/options` with `{ sd_model_checkpoint: model }`。
   *
   * @param endpoint SD WebUI API 端点
   * @param model 模型 checkpoint 标题（来自 getModels 返回的 title）
   * @returns `{ success, error? }`
   */
  private async switchModel(
    endpoint: string,
    model: string
  ): Promise<{ success: boolean; error?: string }> {
    const ep = this.normalizeEndpoint(endpoint);
    const url = `${ep}/sdapi/v1/options`;

    try {
      console.log('[SDGenerationService] switchModel: switching to', model);
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sd_model_checkpoint: model }),
        },
        SHORT_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: `切换模型失败：${this.formatHttpError(response, errorText)}`,
        };
      }

      console.log('[SDGenerationService] switchModel: success');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] switchModel failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * 通过 img2img 生成表情图片。
   * Spec: add-ai-expression-generation / Task 1
   *
   * POST `${endpoint}/sdapi/v1/img2img`，请求体包含 `init_images` / 提示词 / 采样参数 /
   * ADetailer（通过 `alwayson_scripts` 触发）。
   *
   * 行为说明：
   * - 若 `options.model` 提供，先调用 `/sdapi/v1/options` 切换模型；切换失败则直接返回错误，不进行生成
   * - `options.adetailerEnabled !== false` 时启用 ADetailer（默认启用）
   * - 单次请求超时 120 秒
   * - 成功时返回 `images[0]`（base64，不含 data: 前缀）
   *
   * @param params 生成参数（端点 / 基底图 / 提示词 / 负面提示词 / 选项）
   * @returns `{ success, imageBase64?, error?, warning? }`
   */
  async generateExpression(params: SDGenerateParams): Promise<SDGenerationResult> {
    try {
      let { baseImageBase64, prompt, negativePrompt, options = {} } = params;
      const endpoint = this.normalizeEndpoint(params.endpoint);

      // 【Spec: integrate-nl-driven-sd-models / Task 3】模型类型分流
      const modelType = options.modelType ?? 'sdxl';

      // 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 4）】
      // 读取角色视觉特征 tag，替换提示词模板中的 {traits} 占位符。
      // {emotion} 占位符已在上游 PromptBuilder.buildExpressionGenerationPrompt 中替换，
      // 此处仅处理 {traits}，保证角色一致性特征（如 "white fur, dog girl"）注入到所有 SD 生成。
      //
      // 处理流程：
      // 1. 读取 options.characterTraits，过滤空字符串，拼接为逗号分隔字符串
      // 2. 替换 prompt 中所有 {traits} 占位符（使用函数形式避免 $ 特殊字符干扰）
      // 3. 若 traits 为空，{traits} 替换为空字符串
      // 4. 清理替换后可能产生的多余逗号与空格（连续逗号 / 开头结尾逗号 / 多余空格）
      const traitsRaw = options.characterTraits || [];
      const traitsStr = traitsRaw
        .map((t) => (typeof t === 'string' ? t.trim() : ''))
        .filter((t) => t.length > 0)
        .join(', ');
      prompt = prompt.replace(/\{traits\}/g, () => traitsStr);

      // 清理 {traits} 替换后可能产生的多余逗号与空格
      // 场景：模板 `portrait, {traits}, looking at viewer` + 空 traits → `portrait, , looking at viewer`
      // 循环处理连续逗号（如 `a, , , b` 需多次匹配才能完全收敛）
      let prevPrompt: string;
      do {
        prevPrompt = prompt;
        prompt = prompt.replace(/,\s*,/g, ',');
      } while (prompt !== prevPrompt);
      prompt = prompt.replace(/^\s*,\s*/, ''); // 清理开头逗号
      prompt = prompt.replace(/\s*,\s*$/, ''); // 清理结尾逗号
      prompt = prompt.replace(/\s{2,}/g, ' '); // 清理多余空格
      prompt = prompt.trim();

      // 【LoRA 模型标签注入】将选中的 LoRA 模型转为 <lora:name:weight> 标签，注入到 prompt 前部
      // Forge Neo 的 prompt parser 自动解析 <lora:...> 标签并加载对应 LoRA 文件
      const selectedLoras = options.selectedLoras;
      if (selectedLoras && selectedLoras.length > 0) {
        const loraTags = selectedLoras
          .map(l => `<lora:${l.name}:${l.weight}>`)
          .join(' ');
        if (loraTags) {
          prompt = `${loraTags} ${prompt}`;
          console.log('[sdGenerationService] Injected LoRA tags:', loraTags);
        }
      }

      // 【Spec: integrate-nl-driven-sd-models / Task 3】模型类型分流
      // 在 traits 替换之后分流，保证所有模型类型都携带角色特征
      // qwen-image 走 txt2img；flux2 无基底图片时也走 txt2img
      if (modelType === 'qwen-image' || (modelType === 'flux2' && !baseImageBase64)) {
        return this.generateTxt2Img({
          endpoint,
          prompt,
          negativePrompt,
          options,
        });
      }

      // 参数校验（仅 img2img 模型需要基底图片）
      if (!baseImageBase64) {
        return { success: false, error: 'baseImageBase64 不能为空' };
      }
      if (!prompt) {
        return { success: false, error: 'prompt 不能为空' };
      }

      // 可选：切换模型
      if (options.model) {
        const switchResult = await this.switchModel(endpoint, options.model);
        if (!switchResult.success) {
          return {
            success: false,
            error: switchResult.error || '切换模型失败',
          };
        }
      }

      // 合并默认参数
      const denoisingStrength = options.denoisingStrength ?? DEFAULT_DENOISING_STRENGTH;
      const steps = options.steps ?? DEFAULT_STEPS;
      const cfgScale = options.cfgScale ?? DEFAULT_CFG_SCALE;
      const samplerName = options.sampler ?? DEFAULT_SAMPLER;
      const negativePromptValue = options.negativePrompt ?? negativePrompt ?? '';

      // 【重点标记 - 图片变扁修复】
      // 解析原图尺寸，按宽高比计算目标尺寸（长边 512，短边对齐到 64 的倍数）。
      // 若用户显式指定了 width/height 则覆盖；否则保持原图宽高比。
      // 若 PNG 解析失败（非 PNG 或数据损坏），回退到 512×512。
      let targetWidth = options.width ?? DEFAULT_WIDTH;
      let targetHeight = options.height ?? DEFAULT_HEIGHT;
      if (!options.width && !options.height) {
        const originalDims = this.getPngDimensionsFromBase64(baseImageBase64);
        if (originalDims) {
          const calculated = this.calculateAspectRatioDimensions(
            originalDims.width,
            originalDims.height
          );
          targetWidth = calculated.width;
          targetHeight = calculated.height;
          console.log(
            '[SDGenerationService] generateExpression: original dims =',
            originalDims,
            '→ target dims =',
            { width: targetWidth, height: targetHeight },
            '(aspect ratio preserved)'
          );
        }
      }

      // 构建请求体
      const requestBody: Record<string, unknown> = {
        init_images: [baseImageBase64],
        prompt,
        negative_prompt: negativePromptValue,
        denoising_strength: denoisingStrength,
        steps,
        cfg_scale: cfgScale,
        width: targetWidth,
        height: targetHeight,
        sampler_name: samplerName,
        batch_size: 1,
        n_iter: 1,
      };

      // 【重点标记 - ADetailer-Neo 兼容性修复（2026-07-27）】
      // ADetailer 通过 alwayson_scripts 触发，args[0] 必须为 true（启用标志），
      // args[1] 为参数 dict，会被 `ADetailerArgs(**arg)` 解包验证。
      //
      // ADetailer-Neo 的 `ADetailerArgs` pydantic 模型使用 `ConfigDict(extra="forbid")`，
      // 禁止任何未定义字段。早期实现错误使用了 `ad_inpaint_full_res`（Neo 已移除）和
      // `ad_dilation`（正确字段名为 `ad_dilate_erode`），导致：
      //   pydantic_core._pydantic_core.ValidationError: Extra inputs are not permitted
      //   ad_inpaint_full_res / ad_dilation
      //
      // 修复要点：
      // 1. 移除 `ad_inpaint_full_res`（Neo 用 `ad_use_inpaint_width_height` + `ad_inpaint_width/height` 替代）
      // 2. `ad_dilation` → `ad_dilate_erode`（正确字段名）
      // 3. 添加 `ad_inpaint_only_masked_padding`（Neo 支持，原代码漏了）
      // 4. 字段名严格对齐 `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs`
      //
      // 参考：用户报错堆栈 `scripts/adetailer.py line 154 is_ad_enabled → ADetailerArgs(**arg)`
      // 【Spec: integrate-nl-driven-sd-models / Task 3】仅 SDXL 模型使用 ADetailer，
      // NL 驱动模型（qwen-image-edit / flux2）不需要
      const useAdetailer = modelType === 'sdxl' && options.adetailerEnabled !== false;
      if (useAdetailer) {
        // 读取 ADetailer 高级参数（带默认值兜底）
        const adModel = options.adModel || ADETAILER_MODEL;
        const adConfidence = options.adConfidence ?? ADETAILER_CONFIDENCE;
        const adDenoisingStrength = options.adDenoisingStrength ?? ADETAILER_DENOISING_STRENGTH;
        const adMaskBlur = options.adMaskBlur ?? ADETAILER_MASK_BLUR;
        const adDilateErode = options.adDilateErode ?? ADETAILER_DILATE_ERODE;
        const adInpaintOnlyMasked = options.adInpaintOnlyMasked ?? ADETAILER_INPAINT_ONLY_MASKED;
        const adInpaintOnlyMaskedPadding =
          options.adInpaintOnlyMaskedPadding ?? ADETAILER_INPAINT_ONLY_MASKED_PADDING;

        // 构建 ADetailer args dict（字段名严格对齐 ADetailer-Neo 的 ADetailerArgs）
        const adArgs: Record<string, unknown> = {
          ad_model: adModel,
          // 【重点标记 - 特征携带机制】ad_prompt 使用已注入 {traits} 的最终 prompt，
          // 保证 ADetailer 面部修复时也携带角色特征（与主 prompt 完全一致）
          ad_prompt: prompt,
          ad_negative_prompt: negativePromptValue,
          ad_confidence: adConfidence,
          ad_denoising_strength: adDenoisingStrength,
          ad_mask_blur: adMaskBlur,
          ad_dilate_erode: adDilateErode,
          ad_inpaint_only_masked: adInpaintOnlyMasked,
          ad_inpaint_only_masked_padding: adInpaintOnlyMaskedPadding,
        };

        // 可选：独立修复尺寸（ad_use_inpaint_width_height=true 时 ad_inpaint_width/height 生效）
        if (options.adUseInpaintWidthHeight) {
          adArgs.ad_use_inpaint_width_height = true;
          adArgs.ad_inpaint_width = options.adInpaintWidth ?? 512;
          adArgs.ad_inpaint_height = options.adInpaintHeight ?? 512;
        }
        // 可选：独立步数
        if (options.adUseSteps) {
          adArgs.ad_use_steps = true;
          adArgs.ad_steps = options.adSteps ?? 20;
        }
        // 可选：独立 CFG
        if (options.adUseCfgScale) {
          adArgs.ad_use_cfg_scale = true;
          adArgs.ad_cfg_scale = options.adCfgScale ?? 4.0;
        }
        // 可选：独立采样器
        if (options.adUseSampler && options.adSampler && options.adSampler !== 'Use same sampler') {
          adArgs.ad_use_sampler = true;
          adArgs.ad_sampler = options.adSampler;
        }

        requestBody.alwayson_scripts = {
          ADetailer: {
            args: [
              true, // args[0]: enable = true
              adArgs,
            ],
          },
        };
      }

      // 【Spec: integrate-nl-driven-sd-models / Task 3】qwen-image-edit 低去噪警告
      let warning: string | undefined;
      if (modelType === 'qwen-image-edit' && denoisingStrength < 0.9) {
        warning = 'qwen-image-edit 模型推荐 denoising ≥ 0.9，当前值可能导致编辑效果不佳';
      }

      const url = `${endpoint}/sdapi/v1/img2img`;
      console.log(
        '[SDGenerationService] generateExpression: POST',
        url,
        'steps=',
        steps,
        'denoising=',
        denoisingStrength,
        'adetailer=',
        useAdetailer
      );

      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        GENERATION_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: this.formatHttpError(response, errorText),
        };
      }

      const data = (await response.json()) as { images?: unknown };
      const images = data?.images;

      // 响应体为空 / images 字段缺失 / 非数组 / 空数组
      if (!Array.isArray(images) || images.length === 0) {
        return {
          success: false,
          error: 'SD WebUI 返回的 images 为空，生成失败',
        };
      }

      const firstImage = images[0];
      if (typeof firstImage !== 'string' || !firstImage) {
        return {
          success: false,
          error: 'SD WebUI 返回的图像格式无效（期望 base64 字符串）',
        };
      }

      // SD WebUI 返回的 base64 不含 data: 前缀，直接返回
      console.log(
        '[SDGenerationService] generateExpression: success, imageBase64 length=',
        firstImage.length
      );
      return { success: true, imageBase64: firstImage, warning };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] generateExpression failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * 通过 txt2img 生成图片（文生图，无需基底图片）。
   * Spec: integrate-nl-driven-sd-models / Task 3
   *
   * POST `${endpoint}/sdapi/v1/txt2img`，请求体包含 prompt / negative_prompt / 采样参数，
   * 不包含 init_images / denoising_strength / alwayson_scripts。
   *
   * 行为说明：
   * - 若 `options.model` 提供，先调用 `/sdapi/v1/options` 切换模型；切换失败则直接返回错误
   * - 单次请求超时 120 秒
   * - 成功时返回 `images[0]`（base64，不含 data: 前缀）
   *
   * @param params 生成参数（端点 / 提示词 / 负面提示词 / 选项）
   * @returns `{ success, imageBase64?, error?, warning? }`
   */
  async generateTxt2Img(params: SDTxt2ImgParams): Promise<SDGenerationResult> {
    const { endpoint, prompt, negativePrompt, options = {} } = params;
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);

    try {
      // 可选模型切换
      if (options.model) {
        const switchResult = await this.switchModel(normalizedEndpoint, options.model);
        if (!switchResult.success) {
          return { success: false, error: switchResult.error };
        }
      }

      const body: Record<string, unknown> = {
        prompt,
        negative_prompt: negativePrompt || '',
        steps: options.steps ?? 28,
        cfg_scale: options.cfgScale ?? 7,
        width: options.txt2imgWidth ?? 1024,
        height: options.txt2imgHeight ?? 1024,
        sampler_name: options.sampler ?? 'Euler',
        batch_size: 1,
        n_iter: 1,
      };

      const response = await this.fetchWithTimeout(
        `${normalizedEndpoint}/sdapi/v1/txt2img`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        GENERATION_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return { success: false, error: this.formatHttpError(response, errorText) };
      }

      const data = await response.json();
      if (!data.images || data.images.length === 0) {
        return { success: false, error: 'SD WebUI 返回空图片' };
      }

      const firstImage = data.images[0];
      if (typeof firstImage !== 'string' || !firstImage) {
        return {
          success: false,
          error: 'SD WebUI 返回的图像格式无效（期望 base64 字符串）',
        };
      }

      console.log(
        '[SDGenerationService] generateTxt2Img: success, imageBase64 length=',
        firstImage.length
      );
      return { success: true, imageBase64: firstImage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] generateTxt2Img failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * 取消正在进行的生成任务。
   * Spec: add-ai-expression-generation / Task 1
   *
   * POST `${endpoint}/sdapi/v1/interrupt`，向 SD WebUI 发送中断信号。
   * 注意：这是 SD WebUI 服务端的中断，会停止当前正在进行的 img2img 任务。
   * 由于 HTTP 请求本身无法被外部 abort（除非调用方持有 AbortController），
   * 此方法主要用于停止「队列中」或「服务端正在处理」的任务。
   *
   * @param endpoint SD WebUI API 端点
   * @returns Promise，resolve 表示中断请求已发送（不保证当前任务已停止）
   */
  async cancelGeneration(endpoint: string): Promise<void> {
    const ep = this.normalizeEndpoint(endpoint);
    const url = `${ep}/sdapi/v1/interrupt`;

    try {
      console.log('[SDGenerationService] cancelGeneration: POST', url);
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        SHORT_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(
          '[SDGenerationService] cancelGeneration: HTTP',
          response.status,
          response.statusText,
          errorText
        );
      } else {
        console.log('[SDGenerationService] cancelGeneration: interrupt signal sent');
      }
    } catch (error) {
      // 取消请求失败不应影响调用方主流程，仅记录日志
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SDGenerationService] cancelGeneration failed:', message);
    }
  }
}

export const sdGenerationService = new SDGenerationService();
