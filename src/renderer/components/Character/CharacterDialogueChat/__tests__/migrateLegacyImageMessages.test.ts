/**
 * migrateLegacyImageMessages 单元测试
 *
 * 验证目标（Spec: enhance-conversation-image-bubble / Task 2）：
 * 1. 正常迁移：[assistant 文本消息, 图片消息] → [assistant 文本消息(含 imageAttachment)]
 * 2. 无前驱消息兜底：[图片消息] → [图片消息]（不变，migrated=false）
 * 3. 连续多个图片消息：[文本, 图片1, 图片2] → 图片1 迁移到文本的 imageAttachment，
 *    图片2 的前一条（原列表）是图片1（非 assistant 文本）→ 保留图片2 原样
 * 4. 幂等：已含 imageAttachment 的消息列表（无 isImageMessage 消息）→ 不变，migrated=false；
 *    另测 [文本(已含 imageAttachment), 图片] → 幂等移除图片消息
 * 5. 空数组：[] → [], migrated=false
 * 6. 图片消息前是 user 消息：[user 消息, 图片消息] → 跳过迁移保留原样
 *
 * 额外验证：
 * - 纯函数不修改原数组（输入 messages 的元素与字段保持不变）
 * - imageAttachment 字段值正确（currentAssetId / emotion / createdAt / history / currentIndex / status）
 *
 * Spec: enhance-conversation-image-bubble / Task 2.1 / 2.2 / 2.4
 */

import { describe, it, expect } from 'vitest';
import { migrateLegacyImageMessages } from '../CharacterDialogueChat.hooks';
import { ChatMessage, ImageAttachment } from '../CharacterDialogueChat.types';

describe('migrateLegacyImageMessages（Spec: enhance-conversation-image-bubble / Task 2）', () => {
  // ==================== 测试数据构造器 ====================

  const createAssistantTextMessage = (
    id: string,
    content: string,
    overrides: Partial<ChatMessage> = {}
  ): ChatMessage => ({
    id,
    role: 'assistant',
    content,
    timestamp: 1000,
    status: 'sent',
    speakerName: '角色',
    ...overrides,
  });

  const createUserMessage = (id: string, content: string): ChatMessage => ({
    id,
    role: 'user',
    content,
    timestamp: 1000,
    status: 'sent',
  });

  const createImageMessage = (
    id: string,
    assetId: string,
    timestamp: number = 2000
  ): ChatMessage => ({
    id,
    role: 'assistant',
    content: '[生成图片]',
    timestamp,
    status: 'sent',
    speakerName: '角色',
    isImageMessage: true,
    generatedImage: assetId,
  });

  // ==================== 用例 1：正常迁移 ====================

  describe('用例 1：正常迁移 [assistant 文本, 图片] → [assistant 文本(含 imageAttachment)]', () => {
    it('将独立图片消息迁移为父文本消息的 imageAttachment', () => {
      const textMsg = createAssistantTextMessage('t1', '你好', { emotion: 'happy', timestamp: 1000 });
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [textMsg, imageMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(true);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('t1');
      expect(messages[0].content).toBe('你好');
      // 独立图片消息已从列表移除
      expect(messages.find(m => m.isImageMessage)).toBeUndefined();
    });

    it('imageAttachment 字段值正确（currentAssetId / emotion / createdAt / history / currentIndex / status）', () => {
      const textMsg = createAssistantTextMessage('t1', '你好', { emotion: 'happy', timestamp: 1000 });
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [textMsg, imageMsg];

      const { messages } = migrateLegacyImageMessages(input);

      const attachment = messages[0].imageAttachment;
      expect(attachment).toBeDefined();
      expect(attachment!.currentAssetId).toBe('conv_asset_111');
      expect(attachment!.emotion).toBe('happy');
      expect(attachment!.createdAt).toBe(2000);
      expect(attachment!.currentIndex).toBe(0);
      expect(attachment!.status).toBe('idle');
      expect(attachment!.history).toEqual([{ assetId: 'conv_asset_111', createdAt: 2000 }]);
    });

    it('父消息 emotion 缺失时回退为 default', () => {
      const textMsg = createAssistantTextMessage('t1', '你好', { timestamp: 1000 }); // 无 emotion
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [textMsg, imageMsg];

      const { messages } = migrateLegacyImageMessages(input);

      expect(messages[0].imageAttachment!.emotion).toBe('default');
    });

    it('不修改原数组（输入元素与字段保持不变）', () => {
      const textMsg = createAssistantTextMessage('t1', '你好', { emotion: 'happy', timestamp: 1000 });
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [textMsg, imageMsg];

      migrateLegacyImageMessages(input);

      // 原数组长度不变
      expect(input).toHaveLength(2);
      // 原文本消息未被写入 imageAttachment（纯函数不修改输入）
      expect(textMsg.imageAttachment).toBeUndefined();
      expect(textMsg.content).toBe('你好');
      // 原图片消息字段保持
      expect(imageMsg.isImageMessage).toBe(true);
      expect(imageMsg.generatedImage).toBe('conv_asset_111');
    });
  });

  // ==================== 用例 2：无前驱消息兜底 ====================

  describe('用例 2：无前驱消息兜底 [图片] → [图片]（不变）', () => {
    it('列表第一条即图片消息时跳过迁移，保留原样', () => {
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [imageMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(false);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('img1');
      expect(messages[0].isImageMessage).toBe(true);
      expect(messages[0].generatedImage).toBe('conv_asset_111');
    });
  });

  // ==================== 用例 3：连续多个图片消息 ====================

  describe('用例 3：连续多个图片消息 [文本, 图片1, 图片2]', () => {
    it('图片1 迁移到文本的 imageAttachment，图片2 前一条（原列表）是图片消息 → 保留图片2 原样', () => {
      const textMsg = createAssistantTextMessage('t1', '你好', { emotion: 'calm', timestamp: 1000 });
      const image1 = createImageMessage('img1', 'conv_asset_a', 2000);
      const image2 = createImageMessage('img2', 'conv_asset_b', 3000);
      const input: ChatMessage[] = [textMsg, image1, image2];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(true);
      // 文本消息保留 + 图片2 保留 = 2 条；图片1 被迁移移除
      expect(messages).toHaveLength(2);
      // 第一条：文本消息，已含 imageAttachment（来自图片1）
      expect(messages[0].id).toBe('t1');
      expect(messages[0].imageAttachment).toBeDefined();
      expect(messages[0].imageAttachment!.currentAssetId).toBe('conv_asset_a');
      // 第二条：图片2 保留原样（前一条原列表消息是图片1，非 assistant 文本）
      expect(messages[1].id).toBe('img2');
      expect(messages[1].isImageMessage).toBe(true);
      expect(messages[1].generatedImage).toBe('conv_asset_b');
      // 文本的 imageAttachment 不会被图片2 覆盖（仍是 conv_asset_a）
      expect(messages[0].imageAttachment!.currentAssetId).toBe('conv_asset_a');
    });
  });

  // ==================== 用例 4：幂等 ====================

  describe('用例 4：幂等场景', () => {
    it('已含 imageAttachment 的消息列表（无 isImageMessage 消息）→ 不变，migrated=false', () => {
      const existingAttachment: ImageAttachment = {
        currentAssetId: 'conv_existing',
        emotion: 'happy',
        createdAt: 5000,
        history: [{ assetId: 'conv_existing', createdAt: 5000 }],
        currentIndex: 0,
        status: 'idle',
      };
      const textMsg = createAssistantTextMessage('t1', '你好', {
        emotion: 'happy',
        imageAttachment: existingAttachment,
      });
      const input: ChatMessage[] = [textMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(false);
      expect(messages).toHaveLength(1);
      expect(messages[0].imageAttachment).toEqual(existingAttachment);
    });

    it('[文本(已含 imageAttachment), 图片] → 幂等移除图片消息，不重复写入', () => {
      const existingAttachment: ImageAttachment = {
        currentAssetId: 'conv_existing',
        emotion: 'happy',
        createdAt: 5000,
        history: [{ assetId: 'conv_existing', createdAt: 5000 }],
        currentIndex: 0,
        status: 'idle',
      };
      const textMsg = createAssistantTextMessage('t1', '你好', {
        emotion: 'happy',
        imageAttachment: existingAttachment,
      });
      const imageMsg = createImageMessage('img1', 'conv_new', 6000);
      const input: ChatMessage[] = [textMsg, imageMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(true);
      // 图片消息被移除（幂等：父消息已有 imageAttachment，不重复写入）
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('t1');
      // imageAttachment 不被覆盖（保留原 existing）
      expect(messages[0].imageAttachment!.currentAssetId).toBe('conv_existing');
      expect(messages[0].imageAttachment!.history).toHaveLength(1);
      expect(messages[0].imageAttachment!.history[0].assetId).toBe('conv_existing');
    });
  });

  // ==================== 用例 5：空数组 ====================

  describe('用例 5：空数组', () => {
    it('[] → [], migrated=false', () => {
      const input: ChatMessage[] = [];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(false);
      expect(messages).toEqual([]);
    });
  });

  // ==================== 用例 6：图片消息前是 user 消息 ====================

  describe('用例 6：图片消息前是 user 消息 → 跳过迁移保留原样', () => {
    it('[user, 图片] → 保留图片消息（前一条非 assistant）', () => {
      const userMsg = createUserMessage('u1', '在吗');
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [userMsg, imageMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(false);
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('u1');
      expect(messages[1].id).toBe('img1');
      expect(messages[1].isImageMessage).toBe(true);
      expect(messages[0].imageAttachment).toBeUndefined();
    });

    it('图片消息前是 system 消息 → 同样跳过迁移', () => {
      const systemMsg: ChatMessage = {
        id: 's1',
        role: 'system',
        content: '系统提示',
        timestamp: 1000,
        status: 'sent',
      };
      const imageMsg = createImageMessage('img1', 'conv_asset_111', 2000);
      const input: ChatMessage[] = [systemMsg, imageMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(false);
      expect(messages).toHaveLength(2);
      expect(messages[1].isImageMessage).toBe(true);
    });
  });

  // ==================== 综合场景 ====================

  describe('综合场景', () => {
    it('多轮对话混合迁移：[user, assistant文本, 图片, user, assistant文本, 图片] → 两条文本各含 imageAttachment', () => {
      const u1 = createUserMessage('u1', '画一只猫');
      const a1 = createAssistantTextMessage('a1', '好的', { emotion: 'happy', timestamp: 1000 });
      const img1 = createImageMessage('img1', 'conv_cat', 2000);
      const u2 = createUserMessage('u2', '再来一只狗');
      const a2 = createAssistantTextMessage('a2', '没问题', { emotion: 'excited', timestamp: 3000 });
      const img2 = createImageMessage('img2', 'conv_dog', 4000);
      const input: ChatMessage[] = [u1, a1, img1, u2, a2, img2];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(true);
      // 6 - 2（两条图片消息被迁移移除）= 4
      expect(messages).toHaveLength(4);
      expect(messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
      // a1 含 img1 的 imageAttachment
      expect(messages[1].imageAttachment!.currentAssetId).toBe('conv_cat');
      expect(messages[1].imageAttachment!.emotion).toBe('happy');
      expect(messages[1].imageAttachment!.createdAt).toBe(2000);
      // a2 含 img2 的 imageAttachment
      expect(messages[3].imageAttachment!.currentAssetId).toBe('conv_dog');
      expect(messages[3].imageAttachment!.emotion).toBe('excited');
      expect(messages[3].imageAttachment!.createdAt).toBe(4000);
    });

    it('generatedImage 缺失时 imageAttachment.currentAssetId 为空串（不抛错）', () => {
      const textMsg = createAssistantTextMessage('t1', '你好', { timestamp: 1000 });
      const imageMsg: ChatMessage = {
        id: 'img1',
        role: 'assistant',
        content: '[生成图片]',
        timestamp: 2000,
        status: 'sent',
        isImageMessage: true,
        // generatedImage 缺失
      };
      const input: ChatMessage[] = [textMsg, imageMsg];

      const { messages, migrated } = migrateLegacyImageMessages(input);

      expect(migrated).toBe(true);
      expect(messages).toHaveLength(1);
      expect(messages[0].imageAttachment!.currentAssetId).toBe('');
      expect(messages[0].imageAttachment!.history).toEqual([{ assetId: '', createdAt: 2000 }]);
    });
  });
});
