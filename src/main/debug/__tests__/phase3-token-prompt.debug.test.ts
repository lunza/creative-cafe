/**
 * Phase 3（L1/L2/L3/L7/L8 架构重构）debug 检查 —— 纯逻辑 + 真实 tokenizer
 *
 * - P3-C1 TokenCountService（L7 相关）：warmup 后 cl100k_base 精确计数（非字节估算降级）
 * - P3-C2 ContextTruncator（L7 上下文裁剪）：预算截断 / 消息成对 / 最少保留软下限
 * - P3-C3 buildPromptCore（L1 PromptBuilder 拆分产物）：角色上下文 + 人设段落构建
 *
 * 说明：ContextTruncator 在纯 node 下走 TokenCounter 同步路径（字节估算，±15%），
 * 验证「裁剪行为」足够；精确 token 边界验证由 P3-C1 的真实 cl100k 计数覆盖。
 */
import { it, expect, beforeAll, afterAll } from 'vitest';
import { getTokenCountService } from '../../services/TokenCountService';
import { ContextTruncator } from '../../../renderer/components/Character/CharacterDialogueChat/TokenManagement/ContextTruncator';
import { buildPromptCore } from '../../../renderer/components/Character/CharacterDialogueChat/promptCore';
import type { ChatMessage } from '../../../renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types';
import { appendDebugReport, runCheck, logResult, DebugCheckResult } from '../debugHarness';

const results: DebugCheckResult[] = [];

beforeAll(async () => {
  // cl100k_base 懒加载预热：不预热时 countTokens 走字节估算降级
  await getTokenCountService().warmup();
});

afterAll(() => {
  appendDebugReport('phase3', 'Phase 3（L1/L2/L3/L7/L8）纯逻辑与 tokenizer', results);
});

it('P3-C1 TokenCountService 真实 cl100k_base 计数（L7 表情缓存/上下文管理依赖）', async () => {
  const result = await runCheck('Phase 3 / L7', 'P3-C1', 'TokenCountService cl100k 精确计数', async () => {
    const service = getTokenCountService();
    if (!service.isReady()) throw new Error('warmup 后 isReady() 仍为 false（tokenizer 加载失败）');
    if (service.isFallbackMode()) throw new Error('仍在字节估算降级模式，cl100k_base 未加载');

    const english = service.countTokens('hello world');
    const chinese = service.countTokens('茶馆的午后阳光斜照在木桌上');
    const longText = service.countTokens('茶要慢喝。'.repeat(100));

    // cl100k_base 下 'hello world' 精确为 2 个 token
    if (english !== 2) throw new Error(`'hello world' 计数 ${english} ≠ 2（非 cl100k 精确计数？）`);
    if (chinese <= 0) throw new Error('中文文本计数为 0');
    if (longText <= chinese) throw new Error('长文本计数未随长度增长');

    return `'hello world'=${english}, 中文短句=${chinese}, 长文本(100 轮复诵)=${longText}，fallback=${service.isFallbackMode()}`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

function makeMessages(count: number, contentLen: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    messages.push({
      id: `m${i}`,
      role,
      content: `${role} 消息 ${i}：${'茶'.repeat(Math.max(1, contentLen))}`,
      timestamp: Date.now() - (count - i) * 1000,
    });
  }
  return messages;
}

it('P3-C2 ContextTruncator 预算截断行为（消息成对 + 软下限 + 不丢最新消息）', async () => {
  const result = await runCheck('Phase 3 / L7', 'P3-C2', 'ContextTruncator 预算截断', async () => {
    // Case A：预算充足 → 不截断
    const ample = ContextTruncator.truncateMessages(makeMessages(10, 20), 100, {
      enabled: true,
      maxContextTokens: 100000,
      reservedForResponse: 4096,
      minMessagesToKeep: 3,
      maxMessagesToKeep: 60,
    });
    if (ample.length !== 10) throw new Error(`预算充足时应保留全部 10 条，实际 ${ample.length}`);

    // Case B：预算极小 → 发生截断，且保留的是最新消息、成对、不以 assistant 开头
    const tight = ContextTruncator.truncateMessages(makeMessages(40, 200), 100, {
      enabled: true,
      maxContextTokens: 1500,
      reservedForResponse: 200,
      minMessagesToKeep: 2,
      maxMessagesToKeep: 60,
    });
    if (tight.length >= 40) throw new Error(`预算 1500 时未发生截断（保留 ${tight.length}/40 条）`);
    if (tight.length === 0) throw new Error('截断后消息为空');
    if (tight[0].role === 'assistant') throw new Error('截断结果以 assistant 消息开头（成对保护失效）');
    if (tight[tight.length - 1].id !== 'm39') throw new Error(`最新消息 m39 被丢弃（保留末尾 ${tight[tight.length - 1].id}）`);

    return `充足预算: 10/10 保留；紧张预算: 40 → ${tight.length} 条（末尾保留，成对保护生效）`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P3-C3 buildPromptCore 角色上下文构建（L1 PromptBuilder 拆分产物）', async () => {
  const result = await runCheck('Phase 3 / L1', 'P3-C3', 'buildPromptCore 角色上下文构建', async () => {
    const { characterContext, personaSection, charName } = buildPromptCore(
      {
        characterCardName: '周伯',
        personality: '沉稳、惜字如金',
        characterCardContent: '开了四十年茶馆的老掌柜。',
        scenario: '老茶馆，午后。',
        mes_example: '"茶要慢喝。"',
      },
      { name: '常客小李', description: '每周都来的熟客。' } as any
    );

    if (charName !== '周伯') throw new Error(`charName 错误: ${charName}`);
    if (!characterContext.includes('周伯')) throw new Error('角色上下文未包含角色名');
    if (!characterContext.includes('沉稳')) throw new Error('角色上下文未包含性格');
    if (!characterContext.includes('四十年茶馆')) throw new Error('角色上下文未包含描述');
    if (!personaSection.includes('常客小李')) throw new Error('人设段落未包含用户人设名');

    return `charName=${charName}，角色上下文 ${characterContext.length} 字符，人设段落 ${personaSection.length} 字符`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});
