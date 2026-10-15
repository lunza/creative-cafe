/**
 * debug 机制全局初始化（vitest globalSetup，主进程一次性执行）
 *
 * 在全部测试文件之前初始化 debug 报告（清空章节目录 + 写入引擎摘要头）。
 * 各测试文件的 afterAll 写自己的章节文件并重建完整报告——与文件执行顺序无关。
 *
 * 注意：本文件运行在 vitest 主进程，不能导入任何会触发 `import from 'electron'`
 * 的模块（storageService/AIService 链路），否则 CJS 互操作崩溃。
 * 引擎摘要通过直读 settings.json 获得。
 */
import fs from 'fs';
import path from 'path';
import { initDebugReport } from './src/main/debug/debugReport';

export default async function setup(): Promise<void> {
  let summary = '(无法读取 settings.json)';
  try {
    const settingsPath = path.join(process.env.APPDATA || '', 'creative-cafe', 'data', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const engines: any[] = settings?.aiEngines || [];
    const envId = process.env.DEBUG_ENGINE_ID;
    const engine = (envId && engines.find(e => e.id === envId)) || engines.find(e => e.id === settings?.activeEngineId) || engines[0];
    if (engine) {
      summary = `${engine.name}（${engine.api_url} / ${engine.model_name}）${envId && engine.id === envId ? '，DEBUG_ENGINE_ID 覆盖' : '，活跃引擎'}`;
    }
  } catch (error) {
    console.warn(`[debug-global-setup] 读取 settings.json 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`[debug-global-setup] AI 引擎: ${summary}`);
  initDebugReport(summary);
}
