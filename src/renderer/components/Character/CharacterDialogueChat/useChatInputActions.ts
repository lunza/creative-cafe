/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】输入框动作 Hook（God Component 拆分）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中与输入框相关的回调：
 * - handleGenerateUserReply：AI 生成用户回复（结果暂存 generatedReplyText，由 ChatInputBar 消费）
 * - handleGeneratedReplyTextConsumed：ChatInputBar 消费后清空暂存
 * - handleSelectOption：辅助模式推荐选项填入输入框
 * - handlePolishInput：润色输入（复用 generatedReplyText 机制 + polishFlashKey 高亮动画）
 * - handleRollback：用户消息卷回到输入框
 * - handleUserReplyPersonChange：人称选择器持久化
 */
import { useCallback } from 'react';
import { message } from 'antd';
import { useChatUIStore } from './stores/useChatUIStore';
import type { ChatHook } from './CharacterDialogueChat.hooks';

export function useChatInputActions(chat: ChatHook) {
  const setGeneratedReplyText = useChatUIStore(s => s.setGeneratedReplyText);
  const incrementPolishFlashKey = useChatUIStore(s => s.incrementPolishFlashKey);

  // AI 用户回复生成回调（Spec: add-ai-user-reply-button / Task 4.3）
  // 调用 hook 的 generateUserReply，成功后暂存文本到 generatedReplyText，由 ChatInputBar 通过 prop 消费
  // currentInput: 输入框中的内容，作为用户指令引导 AI 生成回复（可选，为空时保持原有行为）
  const handleGenerateUserReply = useCallback(async (currentInput?: string) => {
    try {
      const text = await chat.generateUserReply(currentInput);
      if (text && text.length > 0) {
        setGeneratedReplyText(text);
      }
    } catch (error) {
      // 错误已在 hook 内通过 message.error 处理，此处无需重复
      console.error('[CharacterDialogueChat] handleGenerateUserReply error:', error);
    }
  }, [chat, setGeneratedReplyText]);

  // ChatInputBar 消费完 generatedReplyText 后回调清空暂存（Spec: add-ai-user-reply-button / Task 4.4）
  const handleGeneratedReplyTextConsumed = useCallback(() => {
    setGeneratedReplyText('');
  }, [setGeneratedReplyText]);

  // 辅助模式：点击推荐选项，填入输入框（Spec: add-assist-mode-options）
  const handleSelectOption = useCallback((optionText: string) => {
    setGeneratedReplyText(optionText);
  }, [setGeneratedReplyText]);

  // 润色输入回调（Spec: refine-user-input-text / Task 4.3）
  // 调用 hook 的 polishInput 函数，成功时复用 generatedReplyText 机制填充输入框，
  // 并触发 polishFlashKey 变化以播放 textarea 边框高亮动画
  const handlePolishInput = useCallback(async (text: string) => {
    try {
      const polishedText = await chat.polishInput(text);
      if (polishedText) {
        // 复用 generatedReplyText 机制填充输入框（与 AI回复 按钮共享）
        setGeneratedReplyText(polishedText);
        // 触发 textarea 边框青色高亮动画
        incrementPolishFlashKey();
        message.success('已润色');
      }
    } catch {
      // hook 内 message.error 已处理错误提示，此处无需重复
    }
  }, [chat, setGeneratedReplyText, incrementPolishFlashKey]);

  // 用户消息卷回回调（Spec: rollback-user-message / Task 3.2）
  // 调用 hook 的 rollbackToMessage，成功后通过 generatedReplyText 机制填入输入框
  const handleRollback = useCallback(async (messageId: string) => {
    const content = await chat.rollbackToMessage(messageId);
    if (content) {
      setGeneratedReplyText(content);
      message.success('已卷回到输入框');
    } else {
      message.warning('卷回失败：未找到目标消息');
    }
  }, [chat, setGeneratedReplyText]);

  // 人称选择器切换回调（Spec: add-person-attribute-to-ai-reply / Task 4.1）
  // 持久化到 character-session-<cardId> localStorage 的 userReplyPerson 字段
  const handleUserReplyPersonChange = useCallback((person: 'first' | 'second' | 'third') => {
    chat.updateConfig({ userReplyPerson: person });
  }, [chat]);

  return {
    handleGenerateUserReply,
    handleGeneratedReplyTextConsumed,
    handleSelectOption,
    handlePolishInput,
    handleRollback,
    handleUserReplyPersonChange,
  };
}

export type ChatInputActions = ReturnType<typeof useChatInputActions>;
