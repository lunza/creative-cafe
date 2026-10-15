/**
 * 四阶段功能 debug 机制 —— 共享测试装置（harness）
 *
 * 用途：脱离 Electron 应用，直接使用项目已配置的 AI 引擎（settings.json 的 activeEngineId）
 * 对 Phase 1-4 已开发功能做真实调用验证，并生成 Markdown debug 报告。
 *
 * 引擎选择：
 * - 默认使用 settings.json 中的 activeEngineId 对应引擎
 * - 环境变量 DEBUG_ENGINE_ID 可覆盖（按引擎 id 匹配，非破坏性：仅 patch 全局唯一
 *   实例 aiConfigProvider 的 getActiveEngine，afterAll 恢复，不写 settings.json）
 *
 * 报告输出：.trae/documents/phase-debug-report.md（globalSetup 初始化，各阶段文件写章节后重建）
 *
 * 运行方式：npm run test:debug（vitest --config vitest.debug.config.ts，串行执行）
 *
 * 【M-14/S-11】原 patch 目标是 AIService 内嵌 AIConfigProvider.getInstance()；
 * 内嵌类删除后改为 patch ai/AIConfigProvider.ts 的全局单例（所有 AI 调用链共用）。
 */
import { aiConfigProvider } from '../services/ai/AIConfigProvider';
import { getStorageService } from '../services/storageService';

export interface DebugCheckResult {
  /** 所属阶段（如 'Phase 4 / L4'） */
  phase: string;
  /** 检查项编号（如 'P4-C1'） */
  id: string;
  /** 检查项名称 */
  name: string;
  status: 'pass' | 'fail';
  durationMs: number;
  /** 通过时的验证细节 */
  detail: string;
  /** 失败时的错误信息 */
  error?: string;
}

// 报告生成拆分为纯 fs 模块（debugReport.ts），供 globalSetup 主进程安全导入；
// 此处重导出保持测试文件 import 不变
export { initDebugReport, appendDebugReport } from './debugReport';

let originalGetActiveEngine: (() => any) | null = null;

/**
 * 选择 debug 引擎。默认用 activeEngineId；DEBUG_ENGINE_ID 环境变量覆盖（非破坏性 patch）。
 * @returns 引擎摘要（apiKey 脱敏）
 */
export function selectDebugEngine(): { id: string; name: string; baseUrl: string; model: string; overridden: boolean } {
  const settings = getStorageService().getSettings();
  const engines: any[] = settings?.aiEngines || [];
  let engine = engines.find(e => e.id === settings?.activeEngineId) || engines[0];
  let overridden = false;

  const envId = process.env.DEBUG_ENGINE_ID;
  if (envId) {
    const target = engines.find(e => e.id === envId);
    if (target) {
      const provider = aiConfigProvider;
      originalGetActiveEngine = provider.getActiveEngine.bind(provider);
      provider.getActiveEngine = () => target;
      engine = target;
      overridden = true;
    } else {
      console.warn(`[debug-harness] DEBUG_ENGINE_ID=${envId} 未匹配到任何引擎，回退到活跃引擎`);
    }
  }

  return {
    id: engine?.id || '(none)',
    name: engine?.name || '(none)',
    baseUrl: engine?.api_url || '(none)',
    model: engine?.model_name || '(none)',
    overridden,
  };
}

/** 恢复引擎选择（afterAll 调用） */
export function restoreDebugEngine(): void {
  if (originalGetActiveEngine) {
    aiConfigProvider.getActiveEngine = originalGetActiveEngine;
    originalGetActiveEngine = null;
  }
}

/**
 * 执行一个 debug 检查项，收集结果（不抛错，由调用方断言）。
 */
export async function runCheck(
  phase: string,
  id: string,
  name: string,
  run: () => Promise<string>
): Promise<DebugCheckResult> {
  const start = Date.now();
  try {
    const detail = await run();
    return { phase, id, name, status: 'pass', durationMs: Date.now() - start, detail };
  } catch (error) {
    return {
      phase,
      id,
      name,
      status: 'fail',
      durationMs: Date.now() - start,
      detail: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 控制台打印检查结果（vitest 输出可见） */
export function logResult(result: DebugCheckResult): void {
  const mark = result.status === 'pass' ? '[PASS]' : '[FAIL]';
  console.log(`${mark} [${result.id}] ${result.name} (${result.durationMs}ms)`);
  if (result.status === 'pass') {
    console.log(`    ${result.detail}`);
  } else {
    console.log(`    错误: ${result.error}`);
  }
}


