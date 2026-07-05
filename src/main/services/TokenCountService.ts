/**
 * TokenCountService
 *
 * 精确 Token 计数服务（主进程单例）。
 *
 * 设计要点：
 * - 使用 `gpt-tokenizer/encoding/cl100k_base`（纯 JS、同步、无 WASM 依赖），
 *   与 OpenAI tiktoken cl100k_base 编码器对齐，覆盖 GPT-3.5 / GPT-4 系列模型。
 * - 懒加载：首次调用 countTokens 时才动态 import 编码器模块，避免拖慢启动。
 * - 失败回退：若加载失败（如打包/平台异常），永久降级到字节估算
 *   `Math.ceil(byteLength / 3.35)`，保证调用方永远拿到一个数字。
 * - 单例：通过 `getTokenCountService()` 获取共享实例。
 *
 * Spec: optimize-chat-ai-intelligence / Task 1
 */

const BYTES_PER_TOKEN_FALLBACK = 3.35;

interface Cl100kEncoder {
  encode: (text: string) => number[];
  countTokens?: (text: string) => number;
}

class TokenCountService {
  private encoder: Cl100kEncoder | null = null;
  private loadAttempted = false;
  private loadFailed = false;
  private loadPromise: Promise<Cl100kEncoder | null> | null = null;

  /**
   * 懒加载 cl100k_base 编码器。
   * 多次调用共享同一个加载 Promise（避免重复加载）。
   * 加载失败会被永久标记，后续直接返回 null 走 fallback。
   */
  private async loadEncoder(): Promise<Cl100kEncoder | null> {
    if (this.encoder) return this.encoder;
    if (this.loadFailed) return null;
    if (this.loadAttempted && this.loadPromise) return this.loadPromise;

    this.loadAttempted = true;
    this.loadPromise = (async () => {
      try {
        // 优先 cl100k_base（GPT-3.5 / GPT-4 系列编码，中文场景已验证）
        // gpt-tokenizer 的子路径模块为纯 JS + 同步 API，无 WASM 依赖。
        const mod = await import('gpt-tokenizer/encoding/cl100k_base');
        const encoder: Cl100kEncoder = {
          encode: (text: string) => mod.encode(text),
          countTokens: typeof mod.countTokens === 'function'
            ? (text: string) => mod.countTokens(text)
            : undefined,
        };
        this.encoder = encoder;
        console.log('[TokenCountService] cl100k_base encoder loaded successfully');
        return encoder;
      } catch (err) {
        // 加载失败（罕见，纯 JS 模块通常不会失败）：永久降级到字节估算
        this.loadFailed = true;
        console.warn(
          '[TokenCountService] Failed to load cl100k_base encoder, falling back to byte estimation. ' +
          `error: ${(err as Error).message}`
        );
        return null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * 同步 fallback：字节估算（仅在编码器未就绪时使用）。
   * 与原 TokenCounter.estimateTokens 行为一致：UTF-8 字节 / 3.35。
   * 使用 TextEncoder（浏览器 + Node 通用），避免对 Buffer 全局的依赖。
   */
  private fallbackCount(text: string): number {
    if (!text) return 0;
    const byteLength = new TextEncoder().encode(text).length;
    return Math.ceil(byteLength / BYTES_PER_TOKEN_FALLBACK);
  }

  /**
   * 精确计数：优先使用 cl100k_base，未加载完成或加载失败时回退字节估算。
   *
   * 注意：首次调用会触发异步 import；但本方法本身是同步的：
   * - 若编码器已就绪 -> 走 cl100k_base 同步 encode
   * - 若尚未就绪 -> 立即返回字节估算（不阻塞），并在后台继续加载
   *
   * 因此建议在请求前预热（调用 `warmup()`），以最大化精确计数命中率。
   */
  countTokens(text: string): number {
    if (!text || text.length === 0) return 0;

    if (this.encoder) {
      try {
        // countTokens 在某些版本可能未导出，统一走 encode 路径
        if (this.encoder.countTokens) {
          return this.encoder.countTokens(text);
        }
        return this.encoder.encode(text).length;
      } catch (err) {
        console.warn('[TokenCountService] encode error, using fallback:', err);
        return this.fallbackCount(text);
      }
    }

    // 编码器尚未就绪 - 后台触发加载（不阻塞当前同步调用），本次走 fallback
    void this.loadEncoder();
    return this.fallbackCount(text);
  }

  /**
   * 批量计数：单次 IPC 调用减少跨进程开销。
   */
  countTokensBatch(texts: string[]): number[] {
    if (!texts || texts.length === 0) return [];
    return texts.map((t) => this.countTokens(t));
  }

  /**
   * 预热：在请求前调用，触发编码器异步加载。
   * 调用方可 `await service.warmup()` 确保后续 countTokens 命中精确路径。
   */
  async warmup(): Promise<void> {
    await this.loadEncoder();
  }

  /**
   * 是否已成功加载精确编码器（用于测试与调试）。
   */
  isReady(): boolean {
    return this.encoder !== null;
  }

  /**
   * 是否处于永久 fallback 状态（编码器加载失败）。
   */
  isFallbackMode(): boolean {
    return this.loadFailed;
  }
}

// ============== 单例 ==============
let singleton: TokenCountService | null = null;

export function getTokenCountService(): TokenCountService {
  if (!singleton) {
    singleton = new TokenCountService();
  }
  return singleton;
}

export { TokenCountService };
