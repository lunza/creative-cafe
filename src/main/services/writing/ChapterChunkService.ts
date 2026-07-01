import {
  ChapterOutline,
  ChapterChunk,
  ChunkGenerationConfig
} from '../../../shared/types/writing.types';

/**
 * 章节分片生成服务
 * 负责将长章节拆分为多个分片，依次生成并拼接
 * 注意：本服务不直接依赖 ContentGenerator，避免循环依赖
 */
export class ChapterChunkService {
  /**
   * 根据目标字数和模型限制计算分片策略
   * @param targetWords 目标总字数
   * @param modelLimit 模型单次输出字数限制（maxTokens）
   */
  calculateChunkStrategy(targetWords: number, modelLimit: number): ChunkGenerationConfig {
    // 安全边距：模型限制保留 10% 余量，避免输出被硬截断
    const effectiveLimit = Math.floor(modelLimit * 0.9);

    // 单个分片大小：取模型限制的 70%，留出上下文空间
    const chunkSize = Math.floor(effectiveLimit * 0.7);

    // 计算分片数量：向上取整，但至少 1 片
    const maxChunks = Math.max(1, Math.ceil(targetWords / chunkSize));

    // 上下文窗口：用于传递前序分片摘要的 token 预算（字符数）
    // 预留 2000 字符给系统提示和章节大纲
    const contextWindowSize = Math.max(2000, effectiveLimit - chunkSize - 2000);

    return {
      targetTotalWords: targetWords,
      chunkSize,
      maxChunks,
      contextWindowSize,
      modelOutputLimit: effectiveLimit
    };
  }

  /**
   * 构建带上下文的分片生成 prompt（滑动窗口上下文管理）
   * 策略：最近 2 个分片保留完整 checkpoint + summary，更早的分片只保留 summary
   * @param outline 章节大纲
   * @param previousChunks 已完成的分片列表
   * @param currentIndex 当前要生成的分片索引
   * @param contextWindowSize 上下文窗口大小（字符数），可选
   */
  generateChunkPrompt(
    outline: ChapterOutline,
    previousChunks: ChapterChunk[],
    currentIndex: number,
    _contextWindowSize?: number
  ): string {
    const parts: string[] = [];

    // 1. 章节整体信息
    parts.push(`# 章节信息`);
    parts.push(`章节标题：${outline.title}`);
    parts.push(`章节概要：${outline.summary}`);
    if (outline.keyPlotPoints && outline.keyPlotPoints.length > 0) {
      parts.push(`关键剧情点：`);
      outline.keyPlotPoints.forEach((point, i) => {
        parts.push(`  ${i + 1}. ${point}`);
      });
    }
    if (outline.characters && outline.characters.length > 0) {
      parts.push(`出场角色：${outline.characters.join('、')}`);
    }
    if (outline.scenes && outline.scenes.length > 0) {
      parts.push(`场景设定：${outline.scenes.join('、')}`);
    }

    // 2. 前序分片上下文（滑动窗口策略）
    if (previousChunks.length > 0) {
      parts.push(`\n# 前文衔接`);
      parts.push(`本章节采用分片方式生成，以下是之前已生成的内容摘要，请确保剧情连贯衔接：`);

      // 滑动窗口：最近 2 个分片保留完整信息（summary + checkpoint），更早的只保留 summary
      const RECENT_WINDOW = 2;
      const recentStartIndex = Math.max(0, previousChunks.length - RECENT_WINDOW);

      for (let i = 0; i < previousChunks.length; i++) {
        const chunk = previousChunks[i];
        const isRecent = i >= recentStartIndex;

        parts.push(`\n## 分片 ${chunk.index + 1}${isRecent ? '（近期）' : '（早期）'}`);
        if (chunk.summary) {
          parts.push(chunk.summary);
        }
        // 只有最近的分片才保留 checkpoint（最后一段内容），用于精确衔接
        if (isRecent && chunk.checkpoint) {
          parts.push(`检查点（最后一段内容）：${chunk.checkpoint}`);
        }
      }
    }

    // 3. 当前分片的具体要求
    parts.push(`\n# 当前任务`);
    parts.push(`这是本章节的第 ${currentIndex + 1} 个分片。`);

    if (currentIndex === 0) {
      parts.push(`作为章节开头，请：`);
      parts.push(`- 自然引入场景和角色`);
      parts.push(`- 建立本章的基调和氛围`);
      parts.push(`- 按照章节概要展开第一个剧情点`);
    } else {
      parts.push(`请紧接前文内容继续创作，确保：`);
      parts.push(`- 与前文结尾自然衔接，不要重复已有内容`);
      parts.push(`- 保持角色行为和语气的连贯性`);
      parts.push(`- 推进剧情向章节概要中描述的方向发展`);
    }

    // 4. 如果有 generationGuidance，附加进去
    if (outline.generationGuidance) {
      parts.push(`\n# 创作指导`);
      parts.push(outline.generationGuidance);
    }

    return parts.join('\n');
  }

  /**
   * 构建滑动窗口上下文：从已完成的分片中提取用于下一个分片生成的上下文内容
   * 策略：
   *   - 最近 1 个分片：保留完整内容（截取末尾 N 字符）作为直接衔接
   *   - 更早的分片：只保留摘要
   * @param previousChunks 已完成的分片列表
   * @param contextWindowSize 上下文窗口大小（字符数）
   * @returns 拼接后的上下文字符串
   */
  buildSlidingWindowContext(
    previousChunks: ChapterChunk[],
    contextWindowSize: number = 4000
  ): string {
    if (!previousChunks || previousChunks.length === 0) {
      return '';
    }

    const parts: string[] = [];
    let usedChars = 0;

    // 从最近的分片开始，逆序处理
    // 最近 1 个分片：保留末尾内容（最多 1500 字符）用于精确衔接
    const lastChunk = previousChunks[previousChunks.length - 1];
    if (lastChunk) {
      const tailContent = lastChunk.content
        ? lastChunk.content.substring(Math.max(0, lastChunk.content.length - 1500))
        : '';
      if (tailContent) {
        parts.unshift(`[前一分片末尾内容]\n${tailContent}`);
        usedChars += tailContent.length;
      }
    }

    // 更早的分片：只保留摘要，从近到远
    for (let i = previousChunks.length - 2; i >= 0; i--) {
      const chunk = previousChunks[i];
      if (chunk.summary) {
        const summaryText = `[分片 ${chunk.index + 1} 摘要]\n${chunk.summary}`;
        if (usedChars + summaryText.length <= contextWindowSize) {
          parts.unshift(summaryText);
          usedChars += summaryText.length;
        } else {
          break; // 超出上下文窗口，不再添加更早的摘要
        }
      }
    }

    return parts.join('\n\n');
  }

  /**
   * 为已完成分片生成摘要（调用 AI 生成 200-300 字摘要）
   * @param content 分片完整内容
   * @param aiCallFn 外部注入的 AI 调用函数，接收 prompt 返回生成文本
   */
  async generateSummary(
    content: string,
    aiCallFn?: (prompt: string) => Promise<string>
  ): Promise<string> {
    if (!content || content.trim().length === 0) {
      return '';
    }

    // 截取内容前 3000 字符作为摘要输入，避免 prompt 过长
    const contentForSummary = content.length > 3000
      ? content.substring(0, 3000) + '...'
      : content;

    const summaryPrompt = `请为以下小说片段生成一段 200-300 字的摘要，概括主要情节发展、角色行为和关键事件。摘要将用于后续片段的衔接参考。

要求：
1. 简洁明了，突出关键信息
2. 包含角色名称和重要行动
3. 标注剧情转折点
4. 不要添加原文没有的内容

片段内容：
${contentForSummary}`;

    try {
      if (aiCallFn) {
        const summary = await aiCallFn(summaryPrompt);
        return summary;
      }
      // 降级：返回内容前 200 字作为简单摘要
      return content.substring(0, 200).replace(/\n/g, ' ') + '...';
    } catch (error) {
      console.error('[ChapterChunkService] 生成摘要失败:', error);
      // 降级：返回内容前 200 字作为简单摘要
      return content.substring(0, 200).replace(/\n/g, ' ') + '...';
    }
  }

  /**
   * 检测内容是否在句子中间被截断
   * @param content 待检测内容
   * @returns 是否被截断，以及最后一个完整句子的结束位置
   */
  detectTruncation(content: string): { isTruncated: boolean; lastSentenceEnd: number } {
    if (!content || content.trim().length === 0) {
      return { isTruncated: false, lastSentenceEnd: 0 };
    }

    const trimmed = content.trimEnd();

    // 中文句子结束标志
    const sentenceEndings = ['。', '！', '？', '…', '.', '!', '?'];
    // 对话结束标志（引号结尾）
    const dialogueEndings = ['"', '"', '」', '』'];

    const lastChar = trimmed[trimmed.length - 1];

    // 检查最后一个字符是否是句子结束标志
    const isEndOfSentence =
      sentenceEndings.includes(lastChar) ||
      dialogueEndings.includes(lastChar);

    if (isEndOfSentence) {
      return { isTruncated: false, lastSentenceEnd: trimmed.length };
    }

    // 内容被截断，向前查找最后一个完整的句子结束位置
    let lastSentenceEnd = -1;
    for (let i = trimmed.length - 1; i >= Math.max(0, trimmed.length - 500); i--) {
      const char = trimmed[i];
      if (sentenceEndings.includes(char) || dialogueEndings.includes(char)) {
        lastSentenceEnd = i + 1;
        break;
      }
    }

    return {
      isTruncated: true,
      lastSentenceEnd: lastSentenceEnd >= 0 ? lastSentenceEnd : 0
    };
  }
}

export const chapterChunkService = new ChapterChunkService();
