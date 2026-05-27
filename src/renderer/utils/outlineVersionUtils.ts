import { GeneratedOutline, OutlineVersion } from '../../shared/types/writing.types';

export interface OutlineDiff {
  storyline: { changed: boolean; differences: { field: string; old: string; new: string }[] };
  chapters: { added: number[]; removed: number[]; modified: { index: number; changes: { field: string; old: string; new: string }[] }[] };
  characters: { changed: boolean; differences: any[] };
  worldbuilding: { changed: boolean; differences: any[] };
}

const SOURCE_LABEL_MAP: Record<string, string> = {
  auto_save: '自动保存',
  manual_save: '手动保存',
  ai_generation: 'AI生成',
  ai_edit: 'AI编辑',
  restore: '版本恢复',
};

const SOURCE_COLOR_MAP: Record<string, string> = {
  auto_save: 'blue',
  manual_save: 'green',
  ai_generation: 'purple',
  ai_edit: 'orange',
  restore: 'cyan',
};

export function createSnapshot(
  outline: GeneratedOutline,
  source: OutlineVersion['source'],
  note?: string
): Omit<OutlineVersion, 'id' | 'isCurrent'> {
  return {
    outline,
    timestamp: Date.now(),
    note,
    source,
  };
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key]));
  }

  return false;
}

function diffText(oldStr: string, newStr: string): { field: string; old: string; new: string }[] {
  if (oldStr === newStr) return [];
  return [{ field: 'content', old: oldStr, new: newStr }];
}

export function compareOutlines(
  old: GeneratedOutline,
  newOutline: GeneratedOutline
): OutlineDiff {
  const storylineDiffs: { field: string; old: string; new: string }[] = [];

  storylineDiffs.push(...diffText(
    old.storyLine.coreConflict,
    newOutline.storyLine.coreConflict
  ));
  storylineDiffs.push(...diffText(
    old.storyLine.storyArc.beginning,
    newOutline.storyLine.storyArc.beginning
  ));
  storylineDiffs.push(...diffText(
    old.storyLine.storyArc.development,
    newOutline.storyLine.storyArc.development
  ));
  storylineDiffs.push(...diffText(
    old.storyLine.storyArc.climax,
    newOutline.storyLine.storyArc.climax
  ));
  storylineDiffs.push(...diffText(
    old.storyLine.storyArc.resolution,
    newOutline.storyLine.storyArc.resolution
  ));
  storylineDiffs.push(...diffText(
    old.storyLine.theme,
    newOutline.storyLine.theme
  ));

  const oldChapterIndices = new Set(old.chapters.map((c: { index: number }) => c.index));
  const newChapterIndices = new Set(newOutline.chapters.map((c: { index: number }) => c.index));

  const added: number[] = [];
  const removed: number[] = [];

  newChapterIndices.forEach((idx: number) => {
    if (!oldChapterIndices.has(idx)) added.push(idx);
  });
  oldChapterIndices.forEach((idx: number) => {
    if (!newChapterIndices.has(idx)) removed.push(idx);
  });

  const modified: { index: number; changes: { field: string; old: string; new: string }[] }[] = [];

  old.chapters.forEach((oldChapter: { index: number; title: string; summary: string; keyPlotPoints: string[]; characters: string[]; scenes: string[] }) => {
    const newChapter = newOutline.chapters.find((c: { index: number }) => c.index === oldChapter.index);
    if (!newChapter) return;

    const changes: { field: string; old: string; new: string }[] = [];

    if (oldChapter.title !== newChapter.title) {
      changes.push({ field: 'title', old: oldChapter.title, new: newChapter.title });
    }
    if (oldChapter.summary !== newChapter.summary) {
      changes.push({ field: 'summary', old: oldChapter.summary, new: newChapter.summary });
    }
    if (!deepEqual(oldChapter.keyPlotPoints, newChapter.keyPlotPoints)) {
      changes.push({
        field: 'keyPlotPoints',
        old: JSON.stringify(oldChapter.keyPlotPoints),
        new: JSON.stringify(newChapter.keyPlotPoints)
      });
    }
    if (!deepEqual(oldChapter.characters, newChapter.characters)) {
      changes.push({
        field: 'characters',
        old: JSON.stringify(oldChapter.characters),
        new: JSON.stringify(newChapter.characters)
      });
    }
    if (!deepEqual(oldChapter.scenes, newChapter.scenes)) {
      changes.push({
        field: 'scenes',
        old: JSON.stringify(oldChapter.scenes),
        new: JSON.stringify(newChapter.scenes)
      });
    }

    if (changes.length > 0) {
      modified.push({ index: oldChapter.index, changes });
    }
  });

  const charactersChanged = !deepEqual(
    old.characterRelationships,
    newOutline.characterRelationships
  );
  const worldbuildingChanged = !deepEqual(
    old.worldbuildingNotes,
    newOutline.worldbuildingNotes
  );

  return {
    storyline: { changed: storylineDiffs.length > 0, differences: storylineDiffs },
    chapters: { added, removed, modified },
    characters: { changed: charactersChanged, differences: [] },
    worldbuilding: { changed: worldbuildingChanged, differences: [] },
  };
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function getSourceLabel(source: string): string {
  return SOURCE_LABEL_MAP[source] || source;
}

export function getSourceColor(source: string): string {
  return SOURCE_COLOR_MAP[source] || 'default';
}
