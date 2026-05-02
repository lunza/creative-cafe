import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    include: ['src/renderer/components/Common/**/*.test.ts', 'src/renderer/components/Common/**/*.test.tsx', 'src/renderer/components/Character/CharacterTestChat/**/*.test.ts', 'src/renderer/components/Character/CharacterTestChat/**/*.test.tsx', 'src/renderer/components/WorldBook/**/*.test.ts', 'src/renderer/components/WorldBook/**/*.test.tsx', 'src/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
