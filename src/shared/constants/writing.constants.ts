import { NovelType, NarrativePerspective, WritingStyle, ChapterType, ImportanceLevel, ProjectStatus } from '../types/writing.types';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [ProjectStatus.DRAFT]: '草稿',
  [ProjectStatus.IN_PROGRESS]: '进行中',
  [ProjectStatus.WRITING]: '创作中',
  [ProjectStatus.REVIEWING]: '审阅中',
  [ProjectStatus.COMPLETED]: '已完成',
  [ProjectStatus.ARCHIVED]: '已归档'
};

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
  [NovelType.DOCUMENTARY]: '纪实',
  [NovelType.EROTIC]: '色情文学',
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
  [WritingStyle.EPIC]: '史诗',
  [WritingStyle.DETAILED]: '细节'
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
  temperature: undefined,
  maxTokens: undefined,
  model: undefined
};

export const MIN_TARGET_WORD_COUNT = 1000;
export const MAX_TARGET_WORD_COUNT = 1000000;
export const MIN_CHAPTER_COUNT = 1;
export const MAX_CHAPTER_COUNT = 200;
export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 100000;

export const CHAPTER_TYPE_LABELS: Record<ChapterType, string> = {
  [ChapterType.MAIN_PLOT]: '主线剧情',
  [ChapterType.SUB_PLOT]: '支线剧情',
  [ChapterType.TRANSITION]: '过渡章节',
  [ChapterType.CLIMAX]: '高潮章节',
  [ChapterType.ENDING]: '结尾章节'
};

export const CHAPTER_TYPE_OPTIONS = Object.entries(CHAPTER_TYPE_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const IMPORTANCE_LEVEL_LABELS: Record<ImportanceLevel, string> = {
  [ImportanceLevel.LOW]: '低',
  [ImportanceLevel.MEDIUM]: '中',
  [ImportanceLevel.HIGH]: '高',
  [ImportanceLevel.CRITICAL]: '关键'
};

export const IMPORTANCE_LEVEL_OPTIONS = Object.entries(IMPORTANCE_LEVEL_LABELS).map(([value, label]) => ({
  value,
  label
}));

export const IMPORTANCE_COLORS: Record<ImportanceLevel, string> = {
  [ImportanceLevel.LOW]: '#52c41a',
  [ImportanceLevel.MEDIUM]: '#faad14',
  [ImportanceLevel.HIGH]: '#f5222d',
  [ImportanceLevel.CRITICAL]: '#722ed1'
};

export const MAX_CHAPTER_TITLE_LENGTH = 100;
export const MAX_CHAPTER_SUMMARY_LENGTH = 2000;
export const MIN_CHAPTER_WORD_COUNT = 100;
export const MAX_CHAPTER_WORD_COUNT = 50000;
export const MAX_UNDO_HISTORY = 20;
export const AUTO_SAVE_DELAY = 500;

export const MAX_AI_SUGGESTION_HISTORY = 20;
export const AI_SPLIT_TIMEOUT = 30000;
export const AI_MERGE_TIMEOUT = 30000;
export const AI_CHECK_TIMEOUT = 120000;
