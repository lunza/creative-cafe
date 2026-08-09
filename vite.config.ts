import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { builtinModules } from 'module';
import path from 'path';
import fs from 'fs';

/** 复制 builtin-skills 目录到 dist/main/ 的 Vite 插件 */
function copyBuiltinSkills() {
  return {
    name: 'copy-builtin-skills',
    closeBundle() {
      const src = path.resolve(__dirname, 'src/main/services/agent/skills/builtin-skills');
      const dest = path.resolve(__dirname, 'dist/main/builtin-skills');
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
        console.log(`[copyBuiltinSkills] Copied ${src} -> ${dest}`);
      }
    },
  };
}

export default defineConfig(async (): Promise<UserConfig> => {
  // 动态导入以兼容 rollup-plugin-visualizer@7 的 ESM-only 包
  // （项目未启用 "type": "module"，静态 import 会被 esbuild 当作 CJS require 加载而失败）
  const { visualizer } = await import('rollup-plugin-visualizer');

  return {
  plugins: [
    react(),
    electron([
      {
        // Main process - do NOT bundle @xenova/transformers and native modules
        entry: 'src/main/index.ts',
        vite: {
          plugins: [copyBuiltinSkills()],
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, './src/shared')
            }
          },
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: [
                'electron',
                '@xenova/transformers',
                'onnxruntime-node',
                'onnxruntime-common',
                'better-sqlite3',
                'sqlite-vec',
                ...builtinModules
              ],
              treeshake: false
            },
            commonjsOptions: {
              transformMixedEsModules: true,
              include: [/node_modules/],
              ignore: ['@xenova/transformers', 'onnxruntime-node', 'onnxruntime-common']
            }
          }
        }
      },
      {
        // Preload script
        entry: 'src/main/preload.ts',
        vite: {
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: ['electron'],
              treeshake: false
            },
            commonjsOptions: {
              transformMixedEsModules: true,
              include: [/node_modules/]
            }
          }
        }
      }
    ]),
    // Spec: optimize-system-rendering-performance / Task 1
    // Bundle 分析插件 — 仅作用于 renderer build（顶层 plugins 不影响 electron([...]) 内的 main/preload build）
    // 注：emitFile:true 时 filename 相对 rollup outDir（即 'dist'），
    // 故 filename 应为 'stats.html'（早期误写 'dist/stats.html' 会生成 dist/dist/stats.html）。
    visualizer({
      filename: 'stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      emitFile: true,
      open: !!(process.env.VITE_DEV_SERVER_URL), // open in dev only
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  },
  server: {
    port: 5174,
    strictPort: true,
    // 注：vite 5 的 WatchOptions 类型未导出 include/exclude 字段，但运行时仍支持
    // （源自 Rollup watch 配置），故用 as any 绕过类型检查。
    watch: {
      include: ['src/**', 'index.html'],
      exclude: ['sillytavern-source/**']
    } as any
  },
  root: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      },
      output: {
        // Spec: optimize-system-rendering-performance / Task 2
        // 厂商分块：将大型依赖拆分为独立 chunk，降低首屏入口体积 ≥30%
        // 注意：顺序敏感 — markdown/antd/milkdown/ai 必须在 react 之前判断，
        // 否则 react-markdown 等会被 react 通配匹配错误归并。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // 1. markdown 生态（含 react-markdown，须先于 react 判断）
          if (
            id.includes('react-markdown') ||
            id.includes('rehype') ||
            id.includes('remark') ||
            id.includes('unified') ||
            id.includes('hast-') ||
            id.includes('mdast') ||
            id.includes('unist-') ||
            id.includes('micromark')
          ) {
            return 'vendor-markdown';
          }
          // 2. antd 生态
          if (id.includes('antd') || id.includes('rc-') || id.includes('@ant-design')) {
            return 'vendor-antd';
          }
          // 3. milkdown 编辑器
          if (id.includes('@milkdown')) {
            return 'vendor-milkdown';
          }
          // 4. AI / 向量化（须先于 react 判断，因为路径中可能含 'react' 子串）
          if (
            id.includes('@ai-sdk') ||
            id.includes('/ai/') ||
            id.includes('@xenova') ||
            id.includes('onnxruntime')
          ) {
            return 'vendor-ai';
          }
          // 5. react 核心兜底（放最后，避免误吞 markdown 等）
          if (
            id.includes('react-dom') ||
            id.includes('/react/') ||
            id.includes('react/') ||
            id.includes('scheduler')
          ) {
            return 'vendor-react';
          }
          return undefined;
        }
      }
    }
  }
  };
});
