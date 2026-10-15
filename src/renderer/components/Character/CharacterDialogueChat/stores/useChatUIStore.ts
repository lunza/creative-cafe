/**
 * 对话模式 UI 瞬态 Store（对齐 V2 useV2UIStore 范式）
 *
 * Spec: conversation-mode-optimization-report / Phase 1 / H2
 *
 * 收纳原先散落在 CharacterDialogueChat.tsx（7 个 useState）与
 * useCharacterDialogueChat hook（5 个 useState）中的 UI 瞬态状态，
 * 使组件与 hook 均退化为纯编排层，不再持有本地 UI 状态。
 */

import { create } from 'zustand';

export interface ChatUIStoreState {
  // ===== 模态框 / 布局（原 CharacterDialogueChat.tsx useState） =====
  /** 全屏开关 */
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  /** Ctrl+K 命令面板显隐（支持函数式更新，对齐 useState setter 签名） */
  commandPaletteVisible: boolean;
  setCommandPaletteVisible: (visible: boolean | ((prev: boolean) => boolean)) => void;
  /** 素材管理弹窗显隐 */
  expressionManagerOpen: boolean;
  setExpressionManagerOpen: (open: boolean) => void;
  /** 滚动到底部按钮显隐 */
  showScrollButton: boolean;
  setShowScrollButton: (show: boolean) => void;

  // ===== 图片生成瞬态（原 CharacterDialogueChat.tsx useState） =====
  /** 图片生成中标志（H5 幂等保护的 UI 层防护） */
  isGeneratingImage: boolean;
  setIsGeneratingImage: (generating: boolean) => void;

  // ===== 输入框暂存（原 CharacterDialogueChat.tsx useState） =====
  /** AI 回复 / 润色结果暂存文本，由 ChatInputBar 消费后清空 */
  generatedReplyText: string;
  setGeneratedReplyText: (text: string) => void;
  /** 润色成功后的输入框高亮动画触发器（自增 key） */
  polishFlashKey: number;
  incrementPolishFlashKey: () => void;

  // ===== 表格整理瞬态（原 hook useState） =====
  /** 记忆表格整理中（自动整理） */
  isOrganizing: boolean;
  setIsOrganizing: (organizing: boolean) => void;
  /** 记忆表格整理中（手动整理按钮） */
  manualOrganizing: boolean;
  setManualOrganizing: (organizing: boolean) => void;

  // ===== AI 用户回复 / 润色瞬态（原 hook useState） =====
  isGeneratingUserReply: boolean;
  setIsGeneratingUserReply: (generating: boolean) => void;
  isPolishingInput: boolean;
  setIsPolishingInput: (polishing: boolean) => void;
  /** 上下文压缩中（原 hook useState） */
  isCompressing: boolean;
  setIsCompressing: (compressing: boolean) => void;

  // ===== 【Phase 2 / M5】多格式导出对话框（N3：TXT/Markdown/HTML + 消息多选） =====
  exportDialogVisible: boolean;
  setExportDialogVisible: (visible: boolean) => void;
  // ===== 【Phase 2 / M6】消息版本历史弹窗（N1：全局快照 + 恢复） =====
  versionHistoryVisible: boolean;
  setVersionHistoryVisible: (visible: boolean) => void;
  // ===== 【Phase 4 / L4】对话质量检查面板（N2：人设一致性检查 + 修正建议） =====
  qualityCheckVisible: boolean;
  setQualityCheckVisible: (visible: boolean) => void;
  // ===== 【Phase 2 / M4】响应式三档适配（U4/C2：宽屏 1600 / 中屏 1200 / 窄屏） =====
  /** 窗口宽度（resize 实时更新，驱动三档布局） */
  windowWidth: number;
  setWindowWidth: (width: number) => void;
  /** 中屏：配置区折叠开关；窄屏：抽屉开合（collapsed=true 表示收起/关闭） */
  configPanelCollapsed: boolean;
  setConfigPanelCollapsed: (collapsed: boolean) => void;

  /** 重置全部 UI 瞬态（对话框关闭时调用，避免状态残留到下一次打开） */
  resetUI: () => void;
}

const initialUIState = {
  isFullscreen: false,
  commandPaletteVisible: false,
  expressionManagerOpen: false,
  showScrollButton: false,
  isGeneratingImage: false,
  generatedReplyText: '',
  polishFlashKey: 0,
  isOrganizing: false,
  manualOrganizing: false,
  isGeneratingUserReply: false,
  isPolishingInput: false,
  isCompressing: false,
  exportDialogVisible: false,
  versionHistoryVisible: false,
  qualityCheckVisible: false,
  windowWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
  configPanelCollapsed: false,
};

export const useChatUIStore = create<ChatUIStoreState>((set) => ({
  ...initialUIState,

  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setCommandPaletteVisible: (visible) =>
    set((s) => ({
      commandPaletteVisible: typeof visible === 'function' ? visible(s.commandPaletteVisible) : visible,
    })),
  setExpressionManagerOpen: (expressionManagerOpen) => set({ expressionManagerOpen }),
  setShowScrollButton: (showScrollButton) => set({ showScrollButton }),
  setIsGeneratingImage: (isGeneratingImage) => set({ isGeneratingImage }),
  setGeneratedReplyText: (generatedReplyText) => set({ generatedReplyText }),
  incrementPolishFlashKey: () => set((s) => ({ polishFlashKey: s.polishFlashKey + 1 })),
  setIsOrganizing: (isOrganizing) => set({ isOrganizing }),
  setManualOrganizing: (manualOrganizing) => set({ manualOrganizing }),
  setIsGeneratingUserReply: (isGeneratingUserReply) => set({ isGeneratingUserReply }),
  setIsPolishingInput: (isPolishingInput) => set({ isPolishingInput }),
  setIsCompressing: (isCompressing) => set({ isCompressing }),
  setExportDialogVisible: (exportDialogVisible) => set({ exportDialogVisible }),
  setVersionHistoryVisible: (versionHistoryVisible) => set({ versionHistoryVisible }),
  setQualityCheckVisible: (qualityCheckVisible) => set({ qualityCheckVisible }),
  setWindowWidth: (windowWidth) => set({ windowWidth }),
  setConfigPanelCollapsed: (configPanelCollapsed) => set({ configPanelCollapsed }),

  resetUI: () => set({ ...initialUIState }),
}));
