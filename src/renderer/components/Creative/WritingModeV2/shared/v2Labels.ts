/**
 * V2 本地展示标签与配置构建辅助
 *
 * 注意：不 import V1 的 writing.constants.ts 中 PROJECT_STATUS_LABELS
 * （其引用了 ProjectStatus 枚举中不存在的 IN_PROGRESS/REVIEWING/ARCHIVED，
 * 属 V1 存量缺陷，V1 零改动策略下 V2 自行维护正确标签）。
 */
import {
  ProjectStatus,
  NovelType,
  NarrativePerspective,
  WritingStyle,
} from '../../../../../shared/types/writing-v2.types';
import type { WritingConfig } from '../../../../../shared/types/writing-v2.types';

/** 项目状态标签（仅覆盖 ProjectStatus 枚举实际存在的 4 个值） */
export const V2_PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [ProjectStatus.DRAFT]: '草稿',
  [ProjectStatus.OUTLINING]: '大纲中',
  [ProjectStatus.WRITING]: '创作中',
  [ProjectStatus.COMPLETED]: '已完成',
};

export const V2_NOVEL_TYPE_LABELS: Record<NovelType, string> = {
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
  [NovelType.EROTIC]: '成人',
  [NovelType.OTHER]: '其他',
};

export const V2_NOVEL_TYPE_OPTIONS = (
  Object.keys(V2_NOVEL_TYPE_LABELS) as NovelType[]
).map((value) => ({ value, label: V2_NOVEL_TYPE_LABELS[value] }));

export const V2_PERSPECTIVE_LABELS: Record<NarrativePerspective, string> = {
  [NarrativePerspective.FIRST_PERSON]: '第一人称',
  [NarrativePerspective.THIRD_PERSON]: '第三人称',
  [NarrativePerspective.OMNISCIENT]: '全知视角',
};

export const V2_PERSPECTIVE_OPTIONS = (
  Object.keys(V2_PERSPECTIVE_LABELS) as NarrativePerspective[]
).map((value) => ({ value, label: V2_PERSPECTIVE_LABELS[value] }));

export const V2_WRITING_STYLE_LABELS: Record<WritingStyle, string> = {
  [WritingStyle.RELAXED]: '轻松',
  [WritingStyle.SERIOUS]: '严肃',
  [WritingStyle.HUMOROUS]: '幽默',
  [WritingStyle.SUSPENSEFUL]: '悬疑',
  [WritingStyle.ROMANTIC]: '浪漫',
  [WritingStyle.EPIC]: '史诗',
  [WritingStyle.DETAILED]: '细节',
};

export const V2_WRITING_STYLE_OPTIONS = (
  Object.keys(V2_WRITING_STYLE_LABELS) as WritingStyle[]
).map((value) => ({ value, label: V2_WRITING_STYLE_LABELS[value] }));

/** 从设置中的 AI 引擎构建 ModelConfig（与 V1 WritingConfigModal 取值规则一致） */
export function buildModelConfigFromEngine(
  engine: { model_name?: string; model?: string; temperature?: number; max_tokens?: number } | null | undefined,
  overrides: { temperature?: number; maxTokens?: number } = {}
): { model: string; temperature: number; maxTokens: number } {
  return {
    model: engine?.model_name || engine?.model || '',
    temperature: overrides.temperature ?? engine?.temperature ?? 0.7,
    maxTokens: overrides.maxTokens ?? engine?.max_tokens ?? 4096,
  };
}

/** 组装 V2 新建项目的 WritingConfig（P0 不含资源绑定，P2 再补） */
export function buildV2WritingConfig(params: {
  creativeDescription: string;
  novelType: NovelType;
  targetWordCount: number;
  chapterCount: number;
  narrativePerspective: NarrativePerspective;
  writingStyle?: WritingStyle;
  additionalRequirements?: string;
  modelConfig: { model: string; temperature: number; maxTokens: number };
}): WritingConfig {
  return {
    resources: {
      worldBookIds: [],
      characterCardIds: [],
    },
    parameters: {
      creativeDescription: params.creativeDescription,
      novelType: params.novelType,
      targetWordCount: params.targetWordCount,
      chapterCount: params.chapterCount,
      narrativePerspective: params.narrativePerspective,
      writingStyle: params.writingStyle,
      additionalRequirements: params.additionalRequirements,
    },
    modelConfig: params.modelConfig,
  };
}
