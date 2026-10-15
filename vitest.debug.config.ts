import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * 四阶段功能 debug 机制专用配置（npm run test:debug）
 *
 * 与主测试套件（vitest.config.ts / npm test）隔离：
 * - 仅运行 *.debug.test.ts（真实 AI 调用，非 mock，消耗已配置引擎的 API 配额）
 * - fileParallelism: false 串行执行（保证 debug 报告按 Phase 顺序追加、引擎调用不并发）
 * - testTimeout 放宽到 10 分钟（真实 AI 调用，本地引擎可能较慢）
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/debug/**/*.debug.test.ts'],
    fileParallelism: false,
    // 报告初始化放在 globalSetup（主进程一次性执行），避免各测试文件覆盖写报告的竞态
    globalSetup: './vitest.debug.setup.ts',
    testTimeout: 600000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
