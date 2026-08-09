/**
 * 模块化提示词构建系统 — PromptComposer
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 基于 Provider 注册机制的提示词构建系统，替换当前硬编码的提示词拼接流程。
 * 按 section（header/context/instruction/suffix）分组，组内按 priority 排序，
 * 依次调用 isActive 过滤和 async build 构建，最终拼接为完整的 system prompt。
 */

import type {
  PromptProvider,
  PromptSection,
  DialoguePipelineContext,
} from './pipeline.types';

/**
 * section 分区排列顺序。
 * header → context → instruction → suffix，与 spec 定义一致。
 */
const SECTION_ORDER: PromptSection[] = ['header', 'context', 'instruction', 'suffix'];

export class PromptComposer {
  /** 已注册的 Provider 列表 */
  private providers: PromptProvider[] = [];

  /**
   * 注册一个 PromptProvider。
   * 同名 Provider 会被覆盖（后注册者替换先注册者）。
   *
   * @param provider 待注册的 Provider 实例
   */
  registerProvider(provider: PromptProvider): void {
    const idx = this.providers.findIndex(p => p.name === provider.name);
    if (idx >= 0) {
      this.providers[idx] = provider;
    } else {
      this.providers.push(provider);
    }
  }

  /**
   * 组装完整的 system prompt。
   *
   * 流程：
   * 1. 按 section 分组（header → context → instruction → suffix）
   * 2. 每组内按 priority 升序排列（数值越小越先注入）
   * 3. 依次调用 isActive 过滤不活跃的 Provider
   * 4. 异步调用 build 获取提示词文本
   * 5. 将所有非空段拼接为最终字符串
   *
   * @param context 管线上下文
   * @returns 拼接后的完整 system prompt
   */
  async compose(context: DialoguePipelineContext): Promise<string> {
    const sections: string[] = [];

    for (const section of SECTION_ORDER) {
      // 筛选当前 section 的 Provider 并按 priority 排序
      const sectionProviders = this.providers
        .filter(p => p.section === section)
        .sort((a, b) => a.priority - b.priority);

      const sectionParts: string[] = [];

      for (const provider of sectionProviders) {
        // isActive 同步判断，过滤不活跃的 Provider
        if (!provider.isActive(context)) continue;

        try {
          const text = await provider.build(context);
          if (text && text.trim()) {
            sectionParts.push(text.trim());
          }
        } catch (e) {
          // 单个 Provider 构建失败不中断整体流程，记录到 context.errors
          console.error(`[PromptComposer] Provider "${provider.name}" 构建失败:`, e);
          context.errors.push({
            stage: 'PromptComposer',
            message: `Provider "${provider.name}" 构建失败: ${e instanceof Error ? e.message : String(e)}`,
            stack: e instanceof Error ? e.stack : undefined,
            isFatal: false,
          });
        }
      }

      if (sectionParts.length > 0) {
        sections.push(sectionParts.join('\n\n'));
      }
    }

    return sections.join('\n\n');
  }
}
