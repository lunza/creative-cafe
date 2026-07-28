/**
 * LoRA 模型服务（主进程）
 *
 * 通过 SD WebUI API 获取可用 LoRA 模型列表，
 * 并读取本地预览图 URL 和 JSON 元数据文件。
 *
 * 数据源：
 *  - GET {endpoint}/sdapi/v1/loras — 返回 [{name, alias, path, metadata}]
 *  - 预览图 URL：{endpoint}/sd_extra_networks/thumb?filename={encodeURIComponent(path)}
 *  - JSON 元数据：{path_without_extension}.json（本地文件，含 description/activation text 等）
 *  - 分类：从 path 的子目录名提取（如 "画风"/"身体、状态"/"风景"）
 */

import * as fs from 'fs/promises';

/**
 * LoRA 模型信息（经过服务层加工后的完整模型）
 */
export interface LoraModel {
  /** LoRA 名称（文件名不含扩展名） */
  name: string;
  /** 别名（来自 safetensors 元数据的 ss_output_name，无则为 name） */
  alias: string;
  /** LoRA 文件绝对路径 */
  path: string;
  /** 预览图 URL（通过 SD WebUI thumb 端点获取） */
  previewUrl: string;
  /** 描述（来自 JSON 元数据文件） */
  description: string;
  /** 激活文本（来自 JSON 元数据文件） */
  activationText: string;
  /** 推荐权重（来自 JSON 元数据文件，0 表示无推荐） */
  preferredWeight: number;
  /** SD 版本（来自 JSON 元数据文件） */
  sdVersion: string;
  /** 备注（来自 JSON 元数据文件） */
  notes: string;
  /** 分类（从文件路径的子目录名提取，如 "画风"/"风景"） */
  category: string;
}

/**
 * Forge Neo API 返回的原始 LoRA 数据
 */
interface ForgeLoraApiResponse {
  name: string;
  alias: string;
  path: string;
  metadata: Record<string, unknown>;
}

class LoraService {
  /**
   * 获取 LoRA 模型列表
   *
   * 流程：
   *  1. 调用 GET {endpoint}/sdapi/v1/loras 获取原始列表
   *  2. 为每个 LoRA 构建预览图 URL
   *  3. 读取本地 JSON 元数据文件
   *  4. 从 path 提取分类（子目录名）
   *  5. 返回完整的 LoraModel[]
   */
  async fetchLoraList(endpoint: string): Promise<{
    success: boolean;
    loras?: LoraModel[];
    error?: string;
  }> {
    try {
      const baseEndpoint = endpoint.replace(/\/+$/, '');
      const url = `${baseEndpoint}/sdapi/v1/loras`;

      console.log('[LoraService] Fetching LoRA list from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[LoraService] API request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `SD WebUI API 返回错误：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const rawData = (await response.json()) as ForgeLoraApiResponse[];
      if (!Array.isArray(rawData)) {
        console.error('[LoraService] API returned non-array:', typeof rawData);
        return { success: false, error: 'SD WebUI API 返回数据格式异常' };
      }

      console.log('[LoraService] Got', rawData.length, 'LoRA models');

      // 为每个 LoRA 构建完整模型信息
      const loras: LoraModel[] = [];
      for (const item of rawData) {
        const lora = await this.buildLoraModel(item, baseEndpoint);
        loras.push(lora);
      }

      // 按名称排序
      loras.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

      console.log('[LoraService] Processed', loras.length, 'LoRA models');

      return { success: true, loras };
    } catch (error) {
      console.error('[LoraService] fetchLoraList failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('fetch failed') || message.toLowerCase().includes('network')) {
        return {
          success: false,
          error: '无法连接 SD WebUI，请检查连接状态',
        };
      }
      return {
        success: false,
        error: `获取 LoRA 列表失败：${message}`,
      };
    }
  }

  /**
   * 将 API 原始数据构建为完整的 LoraModel
   */
  private async buildLoraModel(item: ForgeLoraApiResponse, baseEndpoint: string): Promise<LoraModel> {
    // 构建预览图 URL（Forge Neo 的 thumb 端点）
    const previewUrl = `${baseEndpoint}/sd_extra_networks/thumb?filename=${encodeURIComponent(item.path)}`;

    // 从 path 提取分类（子目录名）
    const pathParts = item.path.replace(/\\/g, '/').split('/');
    // 倒数第二个部分是子目录名（倒数第一个是文件名）
    const category = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '未分类';

    // 读取本地 JSON 元数据文件
    const { description, activationText, preferredWeight, sdVersion, notes } = await this.readJsonMetadata(item.path);

    return {
      name: item.name || '',
      alias: item.alias || item.name || '',
      path: item.path || '',
      previewUrl,
      description,
      activationText,
      preferredWeight,
      sdVersion,
      notes,
      category,
    };
  }

  /**
   * 读取 LoRA 的本地 JSON 元数据文件
   *
   * JSON 文件路径：{model_path_without_extension}.json
   * 文件结构：{ description, "sd version", "activation text", "preferred weight", "negative text", notes }
   */
  private async readJsonMetadata(loraPath: string): Promise<{
    description: string;
    activationText: string;
    preferredWeight: number;
    sdVersion: string;
    notes: string;
  }> {
    const defaultResult = {
      description: '',
      activationText: '',
      preferredWeight: 0,
      sdVersion: '',
      notes: '',
    };

    try {
      const jsonPath = loraPath.replace(/\.[^.]+$/, '.json');
      const content = await fs.readFile(jsonPath, 'utf8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      return {
        description: typeof parsed['description'] === 'string' ? parsed['description'] : '',
        activationText: typeof parsed['activation text'] === 'string' ? parsed['activation text'] : '',
        preferredWeight: typeof parsed['preferred weight'] === 'number' ? parsed['preferred weight'] : 0,
        sdVersion: typeof parsed['sd version'] === 'string' ? parsed['sd version'] : '',
        notes: typeof parsed['notes'] === 'string' ? parsed['notes'] : '',
      };
    } catch {
      // JSON 文件不存在或解析失败，返回默认值
      return defaultResult;
    }
  }
}

export const loraService = new LoraService();
