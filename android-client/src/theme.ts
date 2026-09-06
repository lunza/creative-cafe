/**
 * 主题系统（Spec: redesign-mobile-chat-ui / Task 1）
 *
 * 亮/暗两套中性暖色调色板 + 对应 Paper Theme。
 * 从紫色体系迁移到中性暖色体系，新增玻璃态语义色。
 * 渐变效果通过纯色+阴影+半透层+圆角模拟，不引入额外依赖。
 * 主题模式存于本地 AsyncStorage（纯界面外观偏好，不属于功能配置，与服务端无关）。
 * 所有自绘样式（RN View/Text 背景前景色）应从 palette 取色，Paper 组件自动跟随 PaperProvider theme。
 */

import { MD3LightTheme, MD3DarkTheme, type MD3Theme } from 'react-native-paper';

/** 自绘样式取色调色板（与 Paper theme.colors 同源扩展） */
export interface Palette {
  /** 页面背景 */
  background: string;
  /** 卡片/弹层表面 */
  surface: string;
  /** 次级表面（chip 背景、激活行底色等） */
  surfaceVariant: string;
  /** 玻璃态卡片表面（半透，用于气泡/弹层） */
  glassBg: string;
  /** 表面描边 */
  outline: string;
  /** 主色（按钮/链接/强调） */
  primary: string;
  /** 主色上的文字 */
  onPrimary: string;
  /** 标准前景文字 */
  onSurface: string;
  /** 次级前景文字（描述/提示） */
  onSurfaceVariant: string;
  /** 骨架屏占位色 */
  skeleton: string;
  /** 错误红 */
  error: string;
  /** 成功绿 */
  success: string;
  /** 用户气泡背景 */
  userBubble: string;
  /** 用户气泡文字 */
  userBubbleText: string;
  /** AI 气泡背景 */
  aiBubble: string;
  /** AI 气泡文字 */
  aiBubbleText: string;
  /** AI 气泡描边（对齐 PC rgba(255,255,255,0.06)） */
  aiBubbleBorder: string;
  /** 名字行-用户名颜色（对齐 PC #818cf8） */
  nameUser: string;
  /** 名字行-角色名颜色（对齐 PC #a78bfa） */
  nameAI: string;
  /** 气泡左侧情绪色点缀条 */
  accentBar: string;
  /** 思考面板背景 */
  reasoningBg: string;
  /** 思考面板文字 */
  reasoningText: string;
  /** 遮罩层（弹层/对话框半透明背景） */
  scrim: string;
  /** 顶栏背景 */
  appbar: string;
  /** 顶栏文字 */
  onAppbar: string;
}

// ==================== 亮色 ====================

export const lightPalette: Palette = {
  background: '#FAF6F1',       // 暖白背景
  surface: '#FFFFFF',          // 纯白卡面
  surfaceVariant: '#EDE4DC',   // 暖灰次级
  glassBg: 'rgba(255,255,255,0.78)', // 半透玻璃白
  outline: '#D4CBC3',          // 暖灰描边
  primary: '#8B6F5A',          // 暖棕主色
  onPrimary: '#FFFFFF',
  onSurface: '#2C221C',        // 深暖灰文字
  onSurfaceVariant: '#6B6058', // 中介暖灰
  skeleton: '#E0D8D0',         // 骨架屏
  error: '#B33A2E',            // 暖红
  success: '#3E7A4A',          // 暖绿
  userBubble: '#7768F2',       // 用户气泡（PC 渐变 #6366f1→#8b5cf6 的中值近似纯色）
  userBubbleText: '#FFFFFF',
  aiBubble: 'rgba(255,255,255,0.88)', // AI 气泡浅色玻璃（亮色可读）
  aiBubbleText: '#2C221C',
  aiBubbleBorder: 'rgba(0,0,0,0.06)',
  nameUser: '#6D62D6',         // 用户名（PC #818cf8 的亮底加深版，保对比度）
  nameAI: '#8B76C9',           // 角色名（PC #a78bfa 的亮底加深版，保对比度）
  accentBar: '#C4A88E',        // 浅暖棕点缀条
  reasoningBg: '#F0EBE5',      // 暖灰思考
  reasoningText: '#5C524A',
  scrim: 'rgba(0,0,0,0.32)',  // 半透遮罩
  appbar: '#FFFFFF',           // 亮色顶栏白
  onAppbar: '#2C221C',
};

// ==================== 暗色 ====================

export const darkPalette: Palette = {
  background: '#141110',       // 暖黑
  surface: '#26211E',          // 暖深灰
  surfaceVariant: '#36302B',   // 暖灰次级
  glassBg: 'rgba(38,33,30,0.85)', // 半透玻璃深色
  outline: '#4A443E',          // 深暖灰描边
  primary: '#D4B8A8',          // 浅暖色主色
  onPrimary: '#2C1F14',
  onSurface: '#E6E0DA',        // 浅暖灰文字
  onSurfaceVariant: '#B0A89E', // 中介暖灰
  skeleton: '#3D3630',         // 暗骨架屏
  error: '#E5735A',            // 暖红
  success: '#6BBF7A',          // 暖绿
  userBubble: '#7768F2',       // 用户气泡（与亮色一致：PC 用户气泡不随主题变化）
  userBubbleText: '#FFFFFF',
  aiBubble: 'rgba(30,30,46,0.8)', // AI 气泡（PC 原值 rgba(30,30,46,0.8)）
  aiBubbleText: '#E2E8F0',     // AI 气泡文字（PC 原值）
  aiBubbleBorder: 'rgba(255,255,255,0.06)', // PC 原值
  nameUser: '#818CF8',         // 用户名（PC 原值）
  nameAI: '#A78BFA',           // 角色名（PC 原值）
  accentBar: '#8B7355',        // 暖棕点缀条
  reasoningBg: '#1F1B18',      // 暖深灰思考
  reasoningText: '#B0A89E',
  scrim: 'rgba(0,0,0,0.55)',  // 深遮罩
  appbar: '#1F1B18',           // 暗色顶栏
  onAppbar: '#E6E0DA',
};

// ==================== Paper 主题构建 ====================

function buildPaperTheme(
  base: typeof MD3LightTheme | typeof MD3DarkTheme,
  palette: Palette,
  isDark: boolean,
): MD3Theme {
  return {
    ...base,
    dark: isDark,
    colors: {
      ...base.colors,
      primary: palette.primary,
      onPrimary: palette.onPrimary,
      primaryContainer: palette.surfaceVariant,
      onPrimaryContainer: isDark ? '#EADDD0' : '#3D2E20',
      background: palette.background,
      onBackground: palette.onSurface,
      surface: palette.surface,
      onSurface: palette.onSurface,
      surfaceVariant: palette.surfaceVariant,
      onSurfaceVariant: palette.onSurfaceVariant,
      outline: palette.outline,
      error: palette.error,
    },
  };
}

export const paperLightTheme: MD3Theme = buildPaperTheme(MD3LightTheme, lightPalette, false);
export const paperDarkTheme: MD3Theme = buildPaperTheme(MD3DarkTheme, darkPalette, true);

export type ThemeMode = 'light' | 'dark';

/** 由主题模式取 Paper 主题与调色板 */
export function themeOf(mode: ThemeMode): { theme: MD3Theme; palette: Palette } {
  return mode === 'dark'
    ? { theme: paperDarkTheme, palette: darkPalette }
    : { theme: paperLightTheme, palette: lightPalette };
}