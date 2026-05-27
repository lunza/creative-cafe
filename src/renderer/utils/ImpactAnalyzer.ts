import {
  StoryLine,
  EnhancedStoryLine,
  CharacterRelationship,
  WorldbuildingNotes,
  GeneratedOutline,
  ChapterOutline,
  OutlineImpactAnalysis,
} from '../../shared/types/writing.types';

export interface ImpactDetail {
  chapterIndex: number;
  chapterTitle: string;
  affectedField: string;
  reason: string;
  suggestion: string;
}

export interface ChangeImpact {
  severity: 'low' | 'medium' | 'high';
  affectedChapters: number[];
  affectedFields: string[];
  details: ImpactDetail[];
  summary: string;
}

function extractKeywords(text: string): string[] {
  if (!text) return [];
  const words = text.split(/[\s,，;；.。!！?？、\n\r]+/);
  return words
    .map(w => w.trim())
    .filter(w => w.length > 1)
    .map(w => w.toLowerCase());
}

function findAffectedChapters(
  outline: GeneratedOutline,
  keywords: string[],
  fieldsToCheck: (keyof ChapterOutline)[],
): number[] {
  const affected = new Set<number>();
  outline.chapters.forEach((chapter, idx) => {
    fieldsToCheck.forEach(field => {
      const value = chapter[field];
      if (typeof value === 'string' && keywords.some(kw => value.toLowerCase().includes(kw))) {
        affected.add(idx);
      } else if (Array.isArray(value) && value.some(v => keywords.some(kw => String(v).toLowerCase().includes(kw)))) {
        affected.add(idx);
      }
    });
  });
  return Array.from(affected).sort((a, b) => a - b);
}

export function analyzeStorylineChange(
  oldStoryline: StoryLine | EnhancedStoryLine,
  newStoryline: StoryLine | EnhancedStoryLine,
  outline: GeneratedOutline,
): OutlineImpactAnalysis {
  const affectedChapters: number[] = [];
  const affectedCharacters: string[] = [];
  const affectedWorldSettings: string[] = [];
  let severity: 'low' | 'medium' | 'high' = 'low';
  const descriptions: string[] = [];

  if (oldStoryline.coreConflict !== newStoryline.coreConflict) {
    const oldKeywords = extractKeywords(oldStoryline.coreConflict);
    const newKeywords = extractKeywords(newStoryline.coreConflict);
    const changedKeywords = newKeywords.filter(kw => !oldKeywords.includes(kw));

    if (changedKeywords.length > 0) {
      const affected = findAffectedChapters(outline, changedKeywords, ['summary', 'keyPlotPoints']);
      if (affected.length > 0) {
        affectedChapters.push(...affected);
        descriptions.push(`核心冲突变更可能影响 ${affected.length} 个章节的摘要和情节要点`);
        severity = 'high';
      }
    }
  }

  if (JSON.stringify(oldStoryline.storyArc) !== JSON.stringify(newStoryline.storyArc)) {
    const oldArcText = Object.values(oldStoryline.storyArc).join(' ');
    const newArcText = Object.values(newStoryline.storyArc).join(' ');
    const oldKeywords = extractKeywords(oldArcText);
    const newKeywords = extractKeywords(newArcText);
    const changedKeywords = newKeywords.filter(kw => !oldKeywords.includes(kw));

    if (changedKeywords.length > 0) {
      const affected = findAffectedChapters(outline, changedKeywords, ['summary', 'keyPlotPoints']);
      if (affected.length > 0) {
        affectedChapters.push(...affected);
        descriptions.push(`故事弧光变更可能影响 ${affected.length} 个章节`);
        if (severity === 'low') severity = 'medium';
      }
    }
  }

  if (oldStoryline.theme !== newStoryline.theme) {
    const oldKeywords = extractKeywords(oldStoryline.theme);
    const newKeywords = extractKeywords(newStoryline.theme);
    const changedKeywords = newKeywords.filter(kw => !oldKeywords.includes(kw));

    if (changedKeywords.length > 0) {
      const affected = findAffectedChapters(outline, changedKeywords, ['summary']);
      if (affected.length > 0) {
        affectedChapters.push(...affected);
        descriptions.push(`主题变更可能影响 ${affected.length} 个章节的摘要`);
        if (severity === 'low') severity = 'medium';
      }
    }
  }

  if ('subplots' in newStoryline && newStoryline.subplots) {
    const oldSubplots = 'subplots' in oldStoryline ? oldStoryline.subplots : [];
    const newSubplotNames = newStoryline.subplots.map(s => s.name);
    const oldSubplotNames = (oldSubplots || []).map(s => s.name);
    const addedSubplots = newSubplotNames.filter(n => !oldSubplotNames.includes(n));

    if (addedSubplots.length > 0) {
      addedSubplots.forEach(subplotName => {
        const subplot = newStoryline.subplots!.find(s => s.name === subplotName);
        if (subplot && subplot.relatedChapters) {
          subplot.relatedChapters.forEach(chIdx => {
            if (!affectedChapters.includes(chIdx)) {
              affectedChapters.push(chIdx);
            }
          });
        }
      });
      descriptions.push(`新增 ${addedSubplots.length} 条副线`);
    }
  }

  const uniqueAffectedChapters = Array.from(new Set(affectedChapters)).sort((a, b) => a - b);

  return {
    affectedChapters: uniqueAffectedChapters,
    affectedCharacters,
    affectedWorldSettings,
    severity,
    description: descriptions.length > 0
      ? descriptions.join('；')
      : '故事主线变更未检测到对章节的直接影响',
  };
}

export function analyzeCharacterChange(
  oldChars: CharacterRelationship[],
  newChars: CharacterRelationship[],
  outline: GeneratedOutline,
): OutlineImpactAnalysis {
  const affectedChapters: number[] = [];
  const affectedCharacters: string[] = [];
  const affectedWorldSettings: string[] = [];
  let severity: 'low' | 'medium' | 'high' = 'low';
  const descriptions: string[] = [];

  const oldNames = new Set(oldChars.map(c => c.name.toLowerCase()));
  const newNames = new Set(newChars.map(c => c.name.toLowerCase()));

  const removedNames = [...oldNames].filter(name => !newNames.has(name));
  const addedNames = [...newNames].filter(name => !oldNames.has(name));

  if (removedNames.length > 0) {
    affectedCharacters.push(...removedNames);
    const affected = outline.chapters
      .map((ch, idx) => ({ idx, chapter: ch }))
      .filter(({ chapter }) =>
        chapter.characters.some(char => removedNames.includes(char.toLowerCase())),
      )
      .map(({ idx }) => idx);

    if (affected.length > 0) {
      affectedChapters.push(...affected);
      descriptions.push(`${removedNames.length} 个角色被移除，可能影响 ${affected.length} 个章节的角色列表`);
      severity = 'high';
    }
  }

  if (addedNames.length > 0) {
    affectedCharacters.push(...addedNames);
    descriptions.push(`新增 ${addedNames.length} 个角色: ${addedNames.join('、')}`);
    if (severity === 'low') severity = 'medium';
  }

  oldChars.forEach(oldChar => {
    const newChar = newChars.find(c => c.name.toLowerCase() === oldChar.name.toLowerCase());
    if (newChar) {
      if (JSON.stringify(oldChar.relationships) !== JSON.stringify(newChar.relationships)) {
        const oldRelTargets = oldChar.relationships.map(r => r.targetCharacter.toLowerCase());
        const newRelTargets = newChar.relationships.map(r => r.targetCharacter.toLowerCase());
        const changedRels = newRelTargets.filter(t => !oldRelTargets.includes(t));

        if (changedRels.length > 0) {
          const affected = outline.chapters
            .map((ch, idx) => ({ idx, chapter: ch }))
            .filter(({ chapter }) =>
              chapter.characters.some(char =>
                char.toLowerCase() === oldChar.name.toLowerCase() ||
                changedRels.some(rel => char.toLowerCase().includes(rel)),
              ),
            )
            .map(({ idx }) => idx);

          if (affected.length > 0) {
            affectedChapters.push(...affected);
            descriptions.push(`角色 "${oldChar.name}" 的关系变更可能影响 ${affected.length} 个章节`);
            if (severity === 'low') severity = 'medium';
          }
        }
      }
    }
  });

  const uniqueAffectedChapters = Array.from(new Set(affectedChapters)).sort((a, b) => a - b);

  return {
    affectedChapters: uniqueAffectedChapters,
    affectedCharacters: [...new Set(affectedCharacters)],
    affectedWorldSettings,
    severity,
    description: descriptions.length > 0
      ? descriptions.join('；')
      : '角色关系变更未检测到对章节的直接影响',
  };
}

export function analyzeWorldSettingChange(
  oldNotes: WorldbuildingNotes[],
  newNotes: WorldbuildingNotes[],
  outline: GeneratedOutline,
): OutlineImpactAnalysis {
  const affectedChapters: number[] = [];
  const affectedCharacters: string[] = [];
  const affectedWorldSettings: string[] = [];
  let severity: 'low' | 'medium' | 'high' = 'low';
  const descriptions: string[] = [];

  const oldCategories = new Set(oldNotes.map(n => n.category.toLowerCase()));
  const newCategories = new Set(newNotes.map(n => n.category.toLowerCase()));

  const removedCategories = [...oldCategories].filter(cat => !newCategories.has(cat));
  const addedCategories = [...newCategories].filter(cat => !oldCategories.has(cat));

  if (removedCategories.length > 0) {
    affectedWorldSettings.push(...removedCategories);
    descriptions.push(`${removedCategories.length} 个世界观分类被移除`);
    severity = 'high';
  }

  if (addedCategories.length > 0) {
    affectedWorldSettings.push(...addedCategories);
    descriptions.push(`新增 ${addedCategories.length} 个世界观分类: ${addedCategories.join('、')}`);
    if (severity === 'low') severity = 'medium';
  }

  oldNotes.forEach(oldNote => {
    const newNote = newNotes.find(n => n.category.toLowerCase() === oldNote.category.toLowerCase());
    if (newNote) {
      if (JSON.stringify(oldNote.points) !== JSON.stringify(newNote.points)) {
        const oldPoints = oldNote.points.join(' ');
        const newPoints = newNote.points.join(' ');
        const oldKeywords = extractKeywords(oldPoints);
        const newKeywords = extractKeywords(newPoints);
        const changedKeywords = newKeywords.filter(kw => !oldKeywords.includes(kw));

        if (changedKeywords.length > 0) {
          const affected = findAffectedChapters(
            outline,
            changedKeywords,
            ['summary', 'scenes'],
          );

          if (affected.length > 0) {
            affectedChapters.push(...affected);
            descriptions.push(`世界观分类 "${oldNote.category}" 的要点变更可能影响 ${affected.length} 个章节`);
            if (severity === 'low') severity = 'medium';
          }
        }
      }
    }
  });

  const uniqueAffectedChapters = Array.from(new Set(affectedChapters)).sort((a, b) => a - b);

  return {
    affectedChapters: uniqueAffectedChapters,
    affectedCharacters,
    affectedWorldSettings: [...new Set(affectedWorldSettings)],
    severity,
    description: descriptions.length > 0
      ? descriptions.join('；')
      : '世界观设定变更未检测到对章节的直接影响',
  };
}

export function getAffectedChapterDetails(
  outline: GeneratedOutline,
  chapterIndices: number[],
): { index: number; title: string; affectedFields: string[] }[] {
  return chapterIndices
    .map(idx => {
      const chapter = outline.chapters[idx];
      if (!chapter) return null;
      return {
        index: chapter.index,
        title: chapter.title,
        affectedFields: ['summary', 'keyPlotPoints', 'characters', 'scenes'].filter(field => {
          const value = chapter[field as keyof ChapterOutline];
          return value !== undefined && value !== null && (
            (typeof value === 'string' && value.length > 0) ||
            (Array.isArray(value) && value.length > 0)
          );
        }),
      };
    })
    .filter(Boolean) as { index: number; title: string; affectedFields: string[] }[];
}
