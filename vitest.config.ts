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
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
