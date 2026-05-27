import {
  GeneratedOutline,
  AIEditIntent,
  AIEditResult,
  OutlineImpactAnalysis,
  OutlineEditSection,
  ChapterOutline,
} from '../../shared/types/writing.types';

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}

export class AIEditService {
  private isLoading = false;
  private abortController: AbortController | null = null;

  getIsLoading(): boolean {
    return this.isLoading;
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.isLoading = false;
  }

  async editStoryline(
    outline: GeneratedOutline,
    instruction: string,
  ): Promise<AIEditResult> {
    return this.executeEdit({
      type: 'storyline',
      instruction,
      targetSection: OutlineEditSection.STORYLINE,
      context: {
        currentStoryLine: outline.storyLine,
        workInfo: outline.workInfo,
      },
    });
  }

  async optimizeChapter(
    outline: GeneratedOutline,
    chapterIndex: number,
    instruction: string,
  ): Promise<AIEditResult> {
    const chapter = outline.chapters.find((ch: ChapterOutline) => ch.index === chapterIndex);
    if (!chapter) {
      return {
        success: false,
        error: `章节 ${chapterIndex} 不存在`,
      };
    }

    return this.executeEdit({
      type: 'chapter',
      instruction,
      targetSection: OutlineEditSection.CHAPTERS,
      targetId: chapterIndex.toString(),
      context: {
        chapter,
        previousChapter: outline.chapters.find((ch: ChapterOutline) => ch.index === chapterIndex - 1),
        nextChapter: outline.chapters.find((ch: ChapterOutline) => ch.index === chapterIndex + 1),
      },
    });
  }

  async editCharacterRelations(
    outline: GeneratedOutline,
    instruction: string,
  ): Promise<AIEditResult> {
    return this.executeEdit({
      type: 'character',
      instruction,
      targetSection: OutlineEditSection.CHARACTERS,
      context: {
        currentCharacters: outline.characterRelationships,
        workInfo: outline.workInfo,
      },
    });
  }

  async editWorldSetting(
    outline: GeneratedOutline,
    instruction: string,
  ): Promise<AIEditResult> {
    return this.executeEdit({
      type: 'world',
      instruction,
      targetSection: OutlineEditSection.WORLD,
      context: {
        currentWorldSettings: outline.worldbuildingNotes,
        workInfo: outline.workInfo,
      },
    });
  }

  async continueOutline(
    outline: GeneratedOutline,
    chapterCount: number,
    instructions: string,
  ): Promise<ChapterOutline[]> {
    try {
      this.isLoading = true;
      this.abortController = new AbortController();

      const result = await window.electronAPI.invoke('writing:continueOutline', {
        outline,
        chapterCount,
        instructions,
      });

      if (!result?.success) {
        throw new Error(result?.error || '大纲续写失败');
      }

      return result.data?.chapters || [];
    } catch (error) {
      console.error('Continue outline failed:', error);
      throw error instanceof Error ? error : new Error('大纲续写失败，请重试');
    } finally {
      this.isLoading = false;
    }
  }

  async analyzeImpact(
    outline: GeneratedOutline,
    changes: any,
  ): Promise<OutlineImpactAnalysis> {
    try {
      this.isLoading = true;
      this.abortController = new AbortController();

      const result = await window.electronAPI.invoke('ai:analyze-impact', {
        outline,
        changes,
      });

      if (!result?.success) {
        return this.getDefaultImpactAnalysis(changes);
      }

      return result.data;
    } catch (error) {
      console.error('Failed to analyze impact:', error);
      return this.getDefaultImpactAnalysis(changes);
    } finally {
      this.isLoading = false;
    }
  }

  private async executeEdit(intent: AIEditIntent): Promise<AIEditResult> {
    try {
      this.isLoading = true;
      this.abortController = new AbortController();

      const result = await window.electronAPI.invoke('ai:edit-outline', {
        intent,
      });

      if (!result?.success) {
        return {
          success: false,
          error: result?.error || 'AI编辑失败',
        };
      }

      return result.data;
    } catch (error) {
      console.error('AI edit failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI编辑失败，请重试',
      };
    } finally {
      this.isLoading = false;
    }
  }

  private getDefaultImpactAnalysis(_changes: any): OutlineImpactAnalysis {
    return {
      affectedChapters: [],
      affectedCharacters: [],
      affectedWorldSettings: [],
      severity: 'medium',
      description: '无法分析变更影响，请手动检查相关内容',
    };
  }
}

export const aiEditService = new AIEditService();
