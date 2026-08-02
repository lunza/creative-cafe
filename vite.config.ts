import { defineConfig } from 'vite';
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

export default defineConfig({
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
    ])
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
    watch: {
      include: ['src/**', 'index.html'],
      exclude: ['sillytavern-source/**']
    }
  },
  root: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  }
});
