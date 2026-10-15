/**
 * Humanizer 文本转写服务（独立接口，仅适配 jialinyyzz/humanizer 模型）
 *
 * HF: https://huggingface.co/jialinyyzz/humanizer
 * 模型规范（按官方 README 逐字节复现，已用官方自测值验证）：
 * 1. **Text completion，不是 chat**——无 system prompt、无 chat template、无轮次标记；
 *    端点必须用 /v1/completions（用 /v1/chat/completions 会被套 chat template，输出全错）
 * 2. prompt = INSTR + "\n\n" + draft.strip() + "\n\n### Rewritten:\n\n"
 *    官方自测：draft="X" 时该 prompt 的 sha256 前 16 hex 必须为 cc51d66b4c593fbe（本仓库已本地验证通过）
 * 3. 采样参数（不得增删）：temperature 1.0、top_p 0.95、top_k -1（关闭）、min_p 0、repetition_penalty 1.0
 * 4. 只按 EOS 停止——不设 stop strings（尤其禁止用 "###" 当 stop）
 * 5. 上下文 8192 tokens（指令+原文+改写共用）——长文按段落边界切分逐块改写
 * 6. 输出直接 strip()；模型被要求保留全部数字/单位/日期/人名/引文、不添加内容
 */
import { getStorageService } from '../storageService';
// Spec: settings-feature-optimization-report / H-5（默认值单一来源）
import { DEFAULT_ENGINE_PARAMS } from '../../../shared/settingDefaults';
import { addLog } from '../memory/chatLogService';

/** 指令串（prompt_format.json 的 instr，逐字节；不得增删空白） */
export const HUMANIZER_INSTR =
  'Rewrite the text below so it reads like a person wrote it, not a language model.\n\n' +
  'Reorganize it as you see fit. Vary sentence length on purpose. Cut hedging,\n' +
  'throat-clearing, and any sentence that only announces what comes next.\n' +
  'Prefer the concrete word over the abstract one. It is fine to sound uneven.\n\n' +
  'Every fact, number, unit, date, name and quotation must survive unchanged.';

/** 分隔串（prompt_format.json 的 sep，逐字节） */
export const HUMANIZER_SEP = '\n\n### Rewritten:\n\n';

/** 上下文窗口（tokens）：指令 + 原文 + 改写共用 8192 */
const CONTEXT_TOKENS = 8192;
/** 单块原文上限（字符）。中文约 1 字/token，4000 字 ≈ 4000 tokens，留足改写空间 */
const MAX_CHUNK_CHARS = 4000;

/** 拼装单块 prompt（字节级格式，勿改） */
export function buildHumanizerPrompt(draft: string): string {
  return HUMANIZER_INSTR + '\n\n' + draft.trim() + HUMANIZER_SEP;
}

/** 按段落边界切分长文（贪心装箱，单块 ≤ MAX_CHUNK_CHARS；单段落超长时硬切） */
export function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (p.length > MAX_CHUNK_CHARS) {
      // 单段落超长：先落袋当前块，再硬切该段落
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < p.length; i += MAX_CHUNK_CHARS) {
        chunks.push(p.slice(i, i + MAX_CHUNK_CHARS));
      }
      continue;
    }
    if (!current) {
      current = p;
    } else if (current.length + 2 + p.length <= MAX_CHUNK_CHARS) {
      current = current + '\n\n' + p;
    } else {
      chunks.push(current);
      current = p;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

export interface HumanizeResult {
  success: boolean;
  /** 改写后的全文（多块以空行拼接） */
  rewritten?: string;
  /** 实际切分的块数（>1 说明原文超过单块上限，按段落切分处理） */
  chunks?: number;
  error?: string;
}

class HumanizerService {
  async humanizeText(content: string): Promise<HumanizeResult> {
    const trimmed = content.trim();
    if (!trimmed) return { success: false, error: '章节正文为空，无可转写内容' };

    // ===== 目标服务器选择（2026-10-08 修复：humanizer 部署在独立服务器，如 llama-server 8080） =====
    // 不能盲目跟随激活引擎——激活引擎是主写作模型（如 vLLM 5000），humanizer 需要的是它自己的服务器。
    // 选择顺序：
    //   1) 引擎列表中存在 humanizer 专用条目（model_name/api_url/name/id 含 humanizer）→ 用该条目（推荐配置方式）
    //   2) 激活引擎本身就是 humanizer → 用激活引擎
    //   3) 都不是 → 自动探测官方默认端口 http://127.0.0.1:8080（humanizer 官方 README 全部示例均为 llama-server --port 8080）
    const settings = getStorageService().getSettings();
    const engines: any[] = settings?.aiEngines || [];
    const isHumanizerEngine = (e: any) =>
      /humanizer/i.test(`${e?.model_name || ''} ${e?.api_url || ''} ${e?.name || ''} ${e?.id || ''}`);
    const activeEngine = engines.find((e) => e.id === settings?.activeEngineId) || engines[0];
    const dedicatedEngine = engines.find(isHumanizerEngine);
    const activeIsHumanizer = !!activeEngine && isHumanizerEngine(activeEngine);
    const useEngine = dedicatedEngine || (activeIsHumanizer ? activeEngine : undefined);

    let baseUrl: string;
    let model: string;
    let apiKey = '';
    let transmission = 'header';
    if (useEngine) {
      baseUrl = (useEngine.api_url || DEFAULT_ENGINE_PARAMS.apiBaseUrl)
        .replace(/\/v1\/chat\/completions$/, '')
        .replace(/\/v1\/completions$/, '');
      model = useEngine.model_name || '';
      // 宽读取（与 AIConfigProvider.buildApiEndpoint 同源）：本地引擎无 api_key 不报错
      apiKey = useEngine.api_key || settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey || '';
      transmission = useEngine.api_key_transmission || 'header';
      addLog(
        `[Humanizer] 目标服务器（${dedicatedEngine ? 'humanizer 专用引擎条目' : '激活引擎'}）: ${baseUrl}，模型=${model}`,
        'info'
      );
    } else {
      baseUrl = 'http://127.0.0.1:8080';
      model = 'humanizer';
      addLog(
        `[Humanizer] 激活引擎（${activeEngine?.model_name || '无'}）不是 humanizer，自动探测官方默认端口 ${baseUrl}`,
        'info'
      );
    }

    if (!model) return { success: false, error: '未配置 AI 模型名称，请在设置 → AI引擎设置中配置' };

    const chunks = splitIntoChunks(trimmed);
    addLog(`[Humanizer] 开始文本转写：${trimmed.length} 字 → ${chunks.length} 块，模型=${model}，端点=${baseUrl}/v1/completions`, 'info');

    const rewrittenParts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const prompt = buildHumanizerPrompt(chunks[i]);
      // 改写输出预算 = 上下文窗口 - 指令与原文占用（中文按 1 字 1 token 估）- 安全余量
      const maxTokens = Math.max(1024, CONTEXT_TOKENS - prompt.length - 512);

      let text: string;
      try {
        text = await this.requestRewrite(baseUrl, apiKey, transmission, model, prompt, maxTokens);
      } catch (e: any) {
        return { success: false, error: e?.message ? String(e.message) : `Humanizer 请求异常：${e}` };
      }

      let out = text.trim();
      // 防御：模型偶尔会复述分隔头，剥掉
      if (out.startsWith('### Rewritten:')) {
        out = out.replace(/^### Rewritten:\s*/g, '').trim();
      }
      if (!out) return { success: false, error: `第 ${i + 1}/${chunks.length} 块改写结果为空` };
      rewrittenParts.push(out);
      if (chunks.length > 1) {
        addLog(`[Humanizer] 块 ${i + 1}/${chunks.length} 完成（${out.length} 字）`, 'info');
      }
    }

    addLog(`[Humanizer] 文本转写完成：${rewrittenParts.join('\n\n').length} 字`, 'info');
    return { success: true, rewritten: rewrittenParts.join('\n\n'), chunks: chunks.length };
  }

  /**
   * 调用文本补全端点（带回退链，2026-10-08 实测 llama-server 8080 无 /v1/completions 路由）：
   * 1. POST /v1/completions —— OpenAI text completion（vLLM / 新版 llama.cpp / LM Studio 0.3+）
   * 2. 404 时回退 POST /completion —— llama.cpp 原生端点（老版 llama-server 无 /v1/completions；
   *    humanizer 官方文档推荐的调用端点，参数改名 n_predict/repeat_penalty，响应取 .content）
   * 其余 HTTP 错误（401/500 等）不回退直接报错。
   */
  private async requestRewrite(
    baseUrl: string,
    apiKey: string,
    transmission: string,
    model: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey && transmission === 'header') headers['Authorization'] = `Bearer ${apiKey}`;

    // ===== 第一跳：OpenAI text completion（官方采样参数 byte-for-byte，勿动） =====
    const openaiBody: Record<string, unknown> = {
      model,
      prompt,
      temperature: 1.0,
      top_p: 0.95,
      top_k: -1, // vLLM 约定：-1 关闭 top-k（llama.cpp 用 0）
      min_p: 0,
      repetition_penalty: 1.0,
      max_tokens: maxTokens,
    };
    if (apiKey && transmission === 'payload') openaiBody.api_key = apiKey;

    let firstResponse: Response;
    try {
      firstResponse = await fetch(`${baseUrl}/v1/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(openaiBody),
      });
    } catch (e: any) {
      throw new Error(`Humanizer 请求异常：${e?.message || e}`);
    }

    if (firstResponse.ok) {
      const data: any = await firstResponse.json();
      return String(data?.choices?.[0]?.text ?? '');
    }
    const errText = await firstResponse.text().catch(() => '');
    // 仅 404（路由不存在）回退 llama.cpp 原生端点；其余错误（401/500 等）直接报
    if (firstResponse.status !== 404) {
      throw new Error(`Humanizer 请求失败（${firstResponse.status}）：${errText.slice(0, 300)}`);
    }
    addLog(`[Humanizer] /v1/completions 不存在（404），回退 llama.cpp 原生 /completion 端点`, 'info');

    // ===== 第二跳：llama.cpp 原生 /completion（响应 {"content": "..."}） =====
    const llamaBody: Record<string, unknown> = {
      prompt,
      temperature: 1.0,
      top_p: 0.95,
      top_k: 0, // llama.cpp：0 = 关闭 top-k（默认 40 必须显式关闭）
      min_p: 0,
      repeat_penalty: 1.0,
      n_predict: maxTokens,
      cache_prompt: true, // 多块逐次改写时复用指令前缀 KV
    };
    let secondResponse: Response;
    try {
      secondResponse = await fetch(`${baseUrl}/completion`, {
        method: 'POST',
        headers,
        body: JSON.stringify(llamaBody),
      });
    } catch (e: any) {
      throw new Error(`Humanizer 回退请求异常：${e?.message || e}`);
    }
    if (!secondResponse.ok) {
      const err2 = await secondResponse.text().catch(() => '');
      throw new Error(
        `Humanizer 服务器（${baseUrl}）不支持 /v1/completions 与 /completion 端点（${secondResponse.status}）：${err2.slice(0, 300)}——请使用 llama.cpp llama-server（官方推荐运行时）`
      );
    }
    const data2: any = await secondResponse.json();
    return String(data2?.content ?? '');
  }
}

export const humanizerService = new HumanizerService();
