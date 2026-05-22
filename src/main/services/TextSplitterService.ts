/**
 * 文本分割服务
 * 用于将长文本智能分割为适合AI分析的文本块
 */

export interface TextChunk {
  id: number;
  content: string;
  startIndex: number;
  endIndex: number;
  overlapContent: string;
}

const MAX_CHUNK_SIZE = 100000;
const OVERLAP_SIZE = 800;
const TOKENS_PER_CHAR_ESTIMATE = 0.25;
const MIN_CHUNK_SIZE = 10000;
const DEFAULT_CHUNK_SIZE = 80000;

export class TextSplitterService {
  /**
   * 分割文本为多个文本块
   * @param text 待分割的文本
   * @returns 文本块数组
   */
  splitText(text: string): TextChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const optimalChunkSize = this.calculateOptimalChunkSize(text);
    const effectiveChunkSize = Math.min(optimalChunkSize, MAX_CHUNK_SIZE);

    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let currentStartIndex = 0;
    let chunkId = 0;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      const paraStartIndex = text.indexOf(trimmedPara, currentStartIndex);
      const paraEndIndex = paraStartIndex + trimmedPara.length;

      if (trimmedPara.length > effectiveChunkSize) {
        if (currentChunk) {
          chunks.push(this.createChunk(
            chunkId++,
            currentChunk.trim(),
            currentStartIndex,
            text.lastIndexOf('\n', text.indexOf(currentChunk.trim()) + currentChunk.trim().length) + 1,
            chunks.length > 0 ? chunks[chunks.length - 1].content.slice(-OVERLAP_SIZE) : ''
          ));
          currentChunk = '';
        }

        const subChunks = this.splitLargeParagraph(trimmedPara, effectiveChunkSize, paraStartIndex);
        for (const subChunk of subChunks) {
          chunks.push(this.createChunk(
            chunkId++,
            subChunk.content,
            subChunk.startIndex,
            subChunk.endIndex,
            chunks.length > 0 ? chunks[chunks.length - 1].content.slice(-OVERLAP_SIZE) : ''
          ));
        }
        currentChunk = '';
        currentStartIndex = paraEndIndex;
      } else {
        if (currentChunk.length + trimmedPara.length + 2 > effectiveChunkSize && currentChunk) {
          chunks.push(this.createChunk(
            chunkId++,
            currentChunk.trim(),
            currentStartIndex,
            text.indexOf(currentChunk.trim(), currentStartIndex) + currentChunk.trim().length,
            chunks.length > 0 ? chunks[chunks.length - 1].content.slice(-OVERLAP_SIZE) : ''
          ));
          currentChunk = trimmedPara;
          currentStartIndex = paraStartIndex;
        } else {
          if (!currentChunk) {
            currentStartIndex = paraStartIndex;
          }
          currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
        }
      }
    }

    if (currentChunk.trim()) {
      const finalStartIndex = text.indexOf(currentChunk.trim(), currentStartIndex);
      chunks.push(this.createChunk(
        chunkId++,
        currentChunk.trim(),
        finalStartIndex,
        finalStartIndex + currentChunk.trim().length,
        chunks.length > 0 ? chunks[chunks.length - 1].content.slice(-OVERLAP_SIZE) : ''
      ));
    }

    console.log(`[TextSplitterService] 文本分割完成: 总字符数=${text.length}, 文本块数=${chunks.length}`);
    return chunks;
  }

  /**
   * 估算文本的token数量
   * @param text 文本内容
   * @returns 估算的token数量
   */
  estimateTokenCount(text: string): number {
    if (!text) {
      return 0;
    }
    return Math.ceil(text.length * TOKENS_PER_CHAR_ESTIMATE);
  }

  /**
   * 查找下一个段落边界
   * @param text 文本内容
   * @param startPos 起始位置
   * @param maxEndPos 最大结束位置
   * @returns 边界位置
   */
  findParagraphBoundary(text: string, startPos: number, maxEndPos: number): number {
    if (startPos >= maxEndPos || startPos >= text.length) {
      return Math.min(startPos, text.length);
    }

    const searchEnd = Math.min(maxEndPos, text.length);
    const searchSegment = text.slice(startPos, searchEnd);

    const paragraphBreakMatch = searchSegment.match(/\n\s*\n/);
    if (paragraphBreakMatch && paragraphBreakMatch.index !== undefined) {
      return startPos + paragraphBreakMatch.index + paragraphBreakMatch[0].length;
    }

    const newlineMatch = searchSegment.lastIndexOf('\n');
    if (newlineMatch !== -1) {
      return startPos + newlineMatch + 1;
    }

    return searchEnd;
  }

  /**
   * 计算最佳文本块大小
   * @param text 文本内容
   * @returns 最佳块大小
   */
  calculateOptimalChunkSize(text: string): number {
    if (!text || text.length === 0) {
      return DEFAULT_CHUNK_SIZE;
    }

    const textLength = text.length;
    const estimatedTokens = this.estimateTokenCount(textLength);

    if (estimatedTokens <= 128000) {
      return Math.max(MIN_CHUNK_SIZE, textLength);
    }

    const chunkCount = Math.ceil(estimatedTokens / 128000);
    const optimalSize = Math.floor(textLength / chunkCount);

    return Math.max(MIN_CHUNK_SIZE, Math.min(optimalSize, DEFAULT_CHUNK_SIZE));
  }

  private createChunk(
    id: number,
    content: string,
    startIndex: number,
    endIndex: number,
    overlapContent: string
  ): TextChunk {
    return {
      id,
      content,
      startIndex,
      endIndex,
      overlapContent: overlapContent || ''
    };
  }

  private splitLargeParagraph(para: string, maxChunkSize: number, paraStartIndex: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    let remaining = para;
    let currentIndex = paraStartIndex;
    let chunkId = 0;

    while (remaining.length > 0) {
      if (remaining.length <= maxChunkSize) {
        chunks.push({
          id: chunkId++,
          content: remaining,
          startIndex: currentIndex,
          endIndex: currentIndex + remaining.length,
          overlapContent: chunks.length > 0 ? chunks[chunks.length - 1].content.slice(-OVERLAP_SIZE) : ''
        });
        break;
      }

      const splitPoint = this.findParagraphBoundary(remaining, maxChunkSize * 0.8, maxChunkSize);
      const actualSplitPoint = splitPoint > maxChunkSize ? maxChunkSize : splitPoint;

      const chunkContent = remaining.slice(0, actualSplitPoint).trim();
      chunks.push({
        id: chunkId++,
        content: chunkContent,
        startIndex: currentIndex,
        endIndex: currentIndex + chunkContent.length,
        overlapContent: chunks.length > 0 ? chunks[chunks.length - 1].content.slice(-OVERLAP_SIZE) : ''
      });

      currentIndex += actualSplitPoint;
      const overlapStart = Math.max(0, actualSplitPoint - OVERLAP_SIZE);
      remaining = remaining.slice(overlapStart).trimStart();
    }

    return chunks;
  }
}

export const textSplitterService = new TextSplitterService();
