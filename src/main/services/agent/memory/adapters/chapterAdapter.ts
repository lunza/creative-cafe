/**
 * Chapter 记忆适配器 —— 桥接 WritingProjectRepository 到 IMemoryAdapter
 *
 * 来源：spec §二 Task 8.3（adapters/chapterAdapter）
 * 决策：适配（spec §三）。现有 WritingProjectRepository 管理写作章节，
 *       本适配器将章节内容转换为 MemoryEntry 格式，供 MemoryStore 检索。
 *
 * 职责：
 *  1. 桥接 WritingProjectRepository → MemoryEntry[]（章节内容检索）
 *  2. 支持按 projectId 过滤
 *  3. 关键词匹配检索相关章节段落
 *
 * 设计约束（spec §5.1 双轨并行）：
 *  - 不修改 WritingProjectRepository 源码
 *  - 适配器失败不中断 MemoryStore.search
 */

import type { MemoryEntry, MemoryQuery, MemoryType } from '../../contracts';
import type { IMemoryAdapter } from '../memoryStore';

// ==================== Chapter 适配器 ====================

/**
 * Writing 项目仓库接口（WritingProjectRepository 的子集，用于解耦）。
 */
export interface IWritingProjectRepository {
  /** 列出项目的章节 */
  listChapters(projectId: string): Promise<Array<{
    id: string;
    title: string;
    order?: number;
    wordCount?: number;
  }>>;
  /** 读取章节内容 */
  readChapter(projectId: string, chapterId: string): Promise<{
    id: string;
    title: string;
    content: string;
    order?: number;
    updatedAt?: number;
  } | null>;
}

/**
 * Chapter 记忆适配器。
 *
 * 将写作章节转换为 MemoryEntry 格式。
 * type='chapter'（写作章节）。
 *
 * 检索策略：按章节标题/内容关键词匹配。
 */
export class ChapterAdapter implements IMemoryAdapter {
  readonly type: MemoryType = 'chapter';

  constructor(
    private readonly projectRepository: IWritingProjectRepository,
    /** 默认 projectId（从配置注入） */
    private readonly defaultProjectId?: string
  ) {}

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    const projectId = query.sessionId ?? this.defaultProjectId;
    if (!projectId) return [];

    try {
      const chapters = await this.projectRepository.listChapters(projectId);
      const limit = query.limit ?? 5;
      const results: MemoryEntry[] = [];

      for (const chapter of chapters) {
        const detail = await this.projectRepository.readChapter(projectId, chapter.id);
        if (!detail) continue;

        // 关键词匹配（在 title + content 中搜索）
        const searchText = `${detail.title} ${detail.content}`.toLowerCase();
        const score = query.query
          ? this.computeScore(searchText, query.query.toLowerCase())
          : 1;

        if (score <= 0) continue;

        // 截断超长章节内容（防止 prompt 溢出）
        const maxChars = 1000;
        const truncatedContent = detail.content.length > maxChars
          ? detail.content.slice(0, maxChars) + '...'
          : detail.content;

        results.push({
          id: `chapter_${chapter.id}`,
          type: 'chapter',
          content: `Title: ${detail.title}\n${truncatedContent}`,
          source: `chapter:${projectId}:${chapter.id}`,
          score,
          metadata: {
            title: detail.title,
            order: detail.order,
            wordCount: chapter.wordCount,
          },
          sessionId: projectId,
          timestamp: detail.updatedAt ?? Date.now(),
        });

        if (results.length >= limit) break;
      }

      return results;
    } catch (err) {
      console.warn('[ChapterAdapter] search failed:', err);
      return [];
    }
  }

  async read(source: string): Promise<MemoryEntry | null> {
    try {
      // source 格式：chapter:<projectId>:<chapterId>
      const parts = source.split(':');
      if (parts.length < 3) return null;
      const [, projectId, chapterId] = parts;
      const detail = await this.projectRepository.readChapter(projectId, chapterId);
      if (!detail) return null;

      return {
        id: `chapter_${chapterId}`,
        type: 'chapter',
        content: `Title: ${detail.title}\n${detail.content}`,
        source,
        sessionId: projectId,
        timestamp: detail.updatedAt ?? Date.now(),
      };
    } catch (err) {
      console.warn('[ChapterAdapter] read failed:', err);
      return null;
    }
  }

  /**
   * 计算关键词匹配分数。
   */
  private computeScore(text: string, query: string): number {
    if (!query) return 1;
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length === 0) return 1;
    let matched = 0;
    for (const word of queryWords) {
      if (text.includes(word)) matched += 1;
    }
    return matched / queryWords.length;
  }
}
