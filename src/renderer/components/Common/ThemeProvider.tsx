/**
 * 主题提供者组件 —— 管理主题模式（light/dark/auto）
 *
 * 来源：参考 openclaw 主题系统设计
 * 决策：基于现有 uiStore + ui-variables.css，新增 auto 模式支持
 *
 * 职责：
 *  1. 读取 uiStore 中的 theme 模式
 *  2. auto 模式下监听 prefers-color-scheme 媒体查询
 *  3. 在 document.body 上切换 .dark / .light class
 *  4. 配置 antd ConfigProvider 的算法
 *
 * 用法：
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { useUIStore } from '../../stores/uiStore';
import { resolveTheme, type ThemeMode } from '../../styles/themeTokens';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeMode = useUIStore(s => s.theme);
  const [systemDark, setSystemDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // 监听系统主题变化（auto 模式用）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const effectiveTheme = resolveTheme(themeMode as ThemeMode, systemDark);

  // 切换 body class
  useEffect(() => {
    document.body.classList.remove('dark', 'light');
    document.body.classList.add(effectiveTheme);
  }, [effectiveTheme]);

  // ⚠️ 同步全局主题供 antd 静态方法（message / notification / Modal.confirm 等）消费。
  // 静态方法会在 document.body 上独立挂载 React root，不消费 React 树内的 ConfigProvider，
  // 因此暗色模式下 message.success / Modal.confirm 等会以默认亮色主题渲染 → 与应用主题不符。
  // 通过 ConfigProvider.config 注入与当前主题一致的 algorithm + token，让所有静态弹出框自动跟随主题。
  useEffect(() => {
    ConfigProvider.config({
      theme: {
        algorithm: effectiveTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#1890ff', borderRadius: 6 },
      },
    });
  }, [effectiveTheme]);

  return (
    <ConfigProvider
      theme={{
        algorithm: effectiveTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      {children}
    </ConfigProvider>
  );
}
