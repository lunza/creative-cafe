import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 重点修复（Task 8 发现）：原 include 仅匹配 `*.test.ts`，会静默跳过 `.tsx` 测试文件
    // 导致 GameModeEntry.test.tsx / AnsiTileMap.test.tsx 等组件测试在 `vitest run` 中不执行。
    // 现扩展为同时匹配 `.test.ts` 与 `.test.tsx`，确保所有组件测试都能被 CI 拾取。
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 排除 debug 机制测试（真实 AI 调用，非 mock，消耗引擎配额）：
    // 通过 `npm run test:debug`（vitest.debug.config.ts）单独运行。
    // 注意：自定义 exclude 会覆盖 vitest 默认集，故完整保留默认项 + 追加 debug 模式。
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'src/main/debug/**/*.debug.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
