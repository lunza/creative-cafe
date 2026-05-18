import { NovelType, NarrativePerspective, WritingStyle } from '../types/writing.types';

export const NOVEL_TYPE_LABELS: Record<NovelType, string> = {
  [NovelType.WEB_NOVEL]: '网文',
  [NovelType.ROMANCE]: '言情',
  [NovelType.MARTIAL_ARTS]: '武侠',
  [NovelType.FANTASY]: '玄幻',
  [NovelType.FANTASY_MAGIC]: '奇幻',
  [NovelType.MYSTERY]: '悬疑',
  [NovelType.SCI_FI]: '科幻',
  [NovelType.HISTORICAL]: '历史',
  [NovelType.URBAN]: '都市',
  [NovelType.OTHER]: '其他'
};

export const NOVEL_TYPE_OPTIONS = Object.entries(NOVEL_TYPE_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const NARRATIVE_PERSPECTIVE_LABELS: Record<NarrativePerspective, string> = {
  [NarrativePerspective.FIRST_PERSON]: '第一人称',
  [NarrativePerspective.THIRD_PERSON]: '第三人称',
  [NarrativePerspective.OMNISCIENT]: '全知视角'
};

export const NARRATIVE_PERSPECTIVE_OPTIONS = Object.entries(NARRATIVE_PERSPECTIVE_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const WRITING_STYLE_LABELS: Record<WritingStyle, string> = {
  [WritingStyle.RELAXED]: '轻松',
  [WritingStyle.SERIOUS]: '严肃',
  [WritingStyle.HUMOROUS]: '幽默',
  [WritingStyle.SUSPENSEFUL]: '悬疑',
  [WritingStyle.ROMANTIC]: '浪漫',
  [WritingStyle.EPIC]: '史诗'
};

export const WRITING_STYLE_OPTIONS = Object.entries(WRITING_STYLE_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const DEFAULT_WRITING_CONFIG = {
  novelType: NovelType.WEB_NOVEL,
  narrativePerspective: NarrativePerspective.THIRD_PERSON,
  targetWordCount: 10000,
  chapterCount: 10,
  temperature: 0.8,
  maxTokens: 8000,
  model: 'gpt-4o'
};

export const MIN_TARGET_WORD_COUNT = 1000;
export const MAX_TARGET_WORD_COUNT = 1000000;
export const MIN_CHAPTER_COUNT = 1;
export const MAX_CHAPTER_COUNT = 200;
export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 2000;
