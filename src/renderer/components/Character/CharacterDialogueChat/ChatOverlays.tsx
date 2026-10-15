/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】浮层组件（God Component 拆分 U1-5）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的全部浮层：
 * - AssetManagerModal：素材管理（表情/立绘/三视图/角色特征）
 * - CommandPalette：Ctrl+K 命令面板（命令列表由 useChatCommandPalette 构建）
 * - ExportDialog：M5 多格式导出对话框
 * - VersionHistoryModal：M6 消息版本历史与全局快照
 *
 * 显隐瞬态全部从 useChatUIStore 内部订阅，调用方仅传数据与动作。
 */
import React, { Suspense, lazy } from 'react';
import ExportDialog from './ExportDialog';
import VersionHistoryModal from './VersionHistoryModal';
import DialogueQualityCheckPanel from './DialogueQualityCheckPanel';
import { useChatUIStore } from './stores/useChatUIStore';
import type { ChatHook } from './CharacterDialogueChat.hooks';
import type { ChatExportActions } from './useChatExport';
import type { CharacterInfo } from './CharacterDialogueChat.types';
import type { CommandPaletteItem } from '../../Common/CommandPalette';

// 【Phase 2 / M7】重组件懒加载（首屏包体优化），独立 chunk
const LazyAssetManagerModal = lazy(() => import('./AssetManagerModal'));
const LazyCommandPalette = lazy(() => import('../../Common/CommandPalette').then(m => ({ default: m.CommandPalette })));
const LazyFallback = <div style={{ padding: 24, color: '#888', fontSize: 12 }}>加载中...</div>;

interface ChatOverlaysProps {
  chat: ChatHook;
  characterInfo: CharacterInfo;
  avatarPath?: string;
  exportActions: ChatExportActions;
  commandPaletteItems: CommandPaletteItem[];
}

const ChatOverlays: React.FC<ChatOverlaysProps> = ({ chat, characterInfo, avatarPath, exportActions, commandPaletteItems }) => {
  const expressionManagerOpen = useChatUIStore(s => s.expressionManagerOpen);
  const setExpressionManagerOpen = useChatUIStore(s => s.setExpressionManagerOpen);
  const commandPaletteVisible = useChatUIStore(s => s.commandPaletteVisible);
  const setCommandPaletteVisible = useChatUIStore(s => s.setCommandPaletteVisible);
  const exportDialogVisible = useChatUIStore(s => s.exportDialogVisible);
  const setExportDialogVisible = useChatUIStore(s => s.setExportDialogVisible);
  const versionHistoryVisible = useChatUIStore(s => s.versionHistoryVisible);
  const setVersionHistoryVisible = useChatUIStore(s => s.setVersionHistoryVisible);
  const qualityCheckVisible = useChatUIStore(s => s.qualityCheckVisible);
  const setQualityCheckVisible = useChatUIStore(s => s.setQualityCheckVisible);

  return (
    <>
      {/* 素材管理弹窗（Spec: add-asset-and-trait-management / Task 11） */}
      {/* 【重点标记 - BREAKING UI 变更】原 ExpressionManagerModal 替换为 AssetManagerModal，
          支持表情/立绘/一般图像/三视图/角色特征多 Tab 管理。
          characterDescription 传 characterCardContent（即角色卡 description 字段）。 */}
      <Suspense fallback={LazyFallback}>
        <LazyAssetManagerModal
          open={expressionManagerOpen}
          characterCardId={characterInfo.characterCardId}
          characterName={characterInfo.characterCardName}
          characterDescription={characterInfo.characterCardContent || ''}
          characterPersonality={characterInfo.personality}
          characterScenario={characterInfo.scenario}
          avatarPath={avatarPath}
          // 【Phase 4 / L5】传递当前对话历史，供「风格学习」Tab 基于对话历史学习角色风格
          dialogueMessages={chat.stateWithVersionInfo.messages}
          onClose={() => setExpressionManagerOpen(false)}
        />
      </Suspense>

      {/* 命令面板（Ctrl+K） */}
      <Suspense fallback={LazyFallback}>
        <LazyCommandPalette
          visible={commandPaletteVisible}
          onClose={() => setCommandPaletteVisible(false)}
          items={commandPaletteItems}
        />
      </Suspense>

      {/* 【Phase 2 / M5】多格式导出对话框（TXT/Markdown/HTML + 消息多选，N3） */}
      <ExportDialog
        open={exportDialogVisible}
        onClose={() => setExportDialogVisible(false)}
        messages={chat.stateWithVersionInfo.messages}
        characterName={characterInfo.characterCardName}
        onSave={async (content, format) => {
          await exportActions.handleSaveExport(content, format);
          setExportDialogVisible(false);
        }}
      />

      {/* 【Phase 2 / M6】消息版本历史与全局快照（N1：手动快照 + 历史列表 + 恢复） */}
      <VersionHistoryModal
        open={versionHistoryVisible}
        onClose={() => setVersionHistoryVisible(false)}
        characterCardName={characterInfo.characterCardName}
        currentMessages={chat.stateWithVersionInfo.messages}
        onRestore={exportActions.handleRestoreVersion}
      />

      {/* 【Phase 4 / L4】对话质量检查与人设一致性检查（N2：三维度评分 + 问题清单 + 自动修正 + 评分趋势） */}
      <DialogueQualityCheckPanel
        open={qualityCheckVisible}
        onClose={() => setQualityCheckVisible(false)}
        characterInfo={characterInfo}
        messages={chat.stateWithVersionInfo.messages}
        onApplyFix={(messageId, newContent) => chat.editMessage(messageId, newContent)}
      />
    </>
  );
};

export default ChatOverlays;
