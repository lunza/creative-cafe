/**
 * AI 辅助角色特征生成服务（主进程）
 *
 * Spec: add-asset-and-trait-management / Task 12
 *
 * 用途：
 *  - 基于角色卡的 description / personality / scenario 字段，
 *    调用现有 AI 引擎（OpenAI 兼容 /v1/chat/completions 端点）自动提取视觉特征 tag 列表
 *  - 输出的 tag 列表（如 `["white fur", "dog girl", "blue eyes", "black shirt"]`）
 *    可直接写入 characterTraitService 持久化，供 SD 生成时携带以保证角色一致性
 *
 * 复用基础设施：
 *  - AIConfigProvider（src/main/services/ai/AIConfigProvider.ts）：读取激活引擎的
 *    baseUrl / apiKey / apiKeyTransmission / systemPrompt / modelName
 *  - 与 DescriptionPolisher / OutlineGenerator 一致的 fetch + /v1/chat/completions 调用模式
 *  - 采用非流式调用（特征提取任务输出短，无需流式）
 *
 * 与 characterTraitService 的关系：
 *  - 本服务只负责「生成」特征 tag，不负责持久化
 *  - 持久化由 characterTraitService.saveTraits 负责，前端拿到 traits 后自行调用
 *  - 解耦使本服务可独立测试与复用（例如未来可接入批量生成）
 *
 * 错误处理约定（SubTask 12.4）：
 *  - 任何步骤失败返回 `{ success: false, error: 友好信息 }`，不抛异常
 *  - AI 引擎未配置：返回「AI 引擎未配置，请先在设置中配置 API」
 *  - 调用失败（网络/超时/HTTP 错误）：返回「AI 调用失败：<具体原因>」
 *  - 返回格式异常（空内容/无法解析）：返回「AI 返回内容无法解析为 tag 列表」
 *  - 日志前缀 `[CharacterTraitAI]`，与 characterTraitService 的 `[CharacterTraitService]` 区分
 */

import * as fsSync from 'fs';
import { aiConfigProvider } from './ai/AIConfigProvider';
import { getStorageService } from './storageService';
import type { ChatMessage } from './AIService';
import { categoryDictionaryService } from './categoryDictionaryService';
// RAG 标签库（Spec: rag-tag-library-for-ai-trait-generation / Task 9）
// 注入「标签库参考」段落，引导 LLM 使用 Danbooru/e621 标签库内的有效 tag
// 注意：tagRagService.buildRagReferenceSection 内部已做降级处理
//       （enabled=false / 未向量化 / 检索失败 → 返回空字符串），不阻塞本服务主流程
import { tagRagService } from './tagRagService';
// 用户自定义同义词映射表（Spec: add-ai-fallback-tag-audit）
// AI 兜底命中后立即调 addMapping 持久化，下次同词 L0 首轮命中（与人工审核持久化机制一致）
import { userSynonymMapService } from './userSynonymMapService';
import {
  SYSTEM_TRAIT_CATEGORIES,
  UNCATEGORIZED_CATEGORY_ID,
  type CategorizedTrait,
  type TraitCategory,
} from '../../shared/types/characterTrait.types';

/**
 * 标签自动替换的最低相似度阈值。
 *
 * invalid tag 的 top1 suggestion.score >= 此值时，自动用 suggestion 替换 trait.text。
 * 低于此值则保留原 tag（仅展示建议），避免误替换成不相关标签。
 * 经验值：同义词（light grey hair → grey_hair）通常 > 0.5；近义词（slender → slim）≈ 0.3-0.5。
 */
const REPLACE_MIN_SCORE = 0.3;

/**
 * AI 兜底单次批量处理的最大未匹配 tag 数（Spec: add-ai-fallback-tag-audit）。
 *
 * 超出此值时跳过 AI 兜底（保留 ✏ 手动入口），避免 LLM 上下文过大导致响应慢/截断。
 * 典型场景：8-15 个特征经 L0-L4 后仅 1-3 个未命中；10 上限覆盖所有现实场景。
 */
const AI_FALLBACK_MAX_TAGS = 10;

/**
 * AI 兜底专用系统提示词（Spec: add-ai-fallback-tag-audit）。
 *
 * 与 CHARACTER_TRAIT_SYSTEM_PROMPT / IMAGE_TRAIT_SYSTEM_PROMPT 的区别：
 *  - 任务不是「提取特征」，而是「为未匹配 tag 生成候选同义词/拆分词」
 *  - 输出格式为 `<original_tag> | candidate1, candidate2`（便于 parseAiFallbackResponse 按 `|` 切分）
 *  - 候选词需符合 Danbooru/e621 标签库风格（下划线分隔、英文）
 *  - 覆盖 6 类候选词生成策略：同义词替换 / 下划线规范化 / 复合词拆分 / 别名转正名 / 描述性词转标签 / 颜色复合拆分
 */
const AI_FALLBACK_SYSTEM_PROMPT = `你是一个 Stable Diffusion 标签同义词生成助手。Stable Diffusion 图像生成使用 Danbooru/e621 风格的下划线格式英文标签（如 grey_hair、blue_eyes、medium_breasts、long_hair），但用户提供的部分标签不在标准标签库中。

任务：对每个未匹配的原始标签，结合角色描述/图片上下文，给出 2-4 个候选同义词或拆分词，优先使用 Danbooru/e621 标签库中的常用标签（下划线分隔）。

候选词生成策略：
1. 同义词替换：如 "B-cup" → "medium_breasts, small_breasts, breasts"
2. 下划线规范化：如 "long black hair" → "long_hair, black_hair"
3. 复合词拆分：如 "white fur dog" → "white_fur, dog, dog_girl"
4. 别名/俗语转正名：如 "khaki pants" → "khaki_trousers, brown_pants, trousers"
5. 描述性词转标签：如 "tall girl" → "tall_female, tall"
6. 颜色复合拆分：如 "light gray drooping ears" → "grey_ears, drooping_ears"

候选词要求：
- 必须是英文，下划线分隔，逗号分隔
- 优先 Danbooru/e621 标签库常用词，避免生造词
- 每个原始标签输出 2-4 个候选词，按可能性从高到低排序
- 候选词需在角色上下文中语义合理（不要输出与角色无关的标签）
- 不要复述原始 tag 本身作为候选词

输出格式（必须严格遵守，每个原始标签占一行，不要输出任何额外说明、标题、序号）：
<original_tag> | candidate1, candidate2, candidate3
<original_tag> | candidate1, candidate2

示例输入：
B-cup
brimless cap
cybernetic arms

示例输出：
B-cup | medium_breasts, small_breasts, large_breasts
brimless cap | hat, cap, baseball_cap
cybernetic arms | mechanical_arms, prosthetic_arms, robotic_arms

请按上述格式输出，不要输出任何额外说明。`;

/**
 * 角色特征生成入参。
 * - characterCardId：角色卡 ID（即角色卡 PNG 文件路径，用于日志关联；当 includeImage=true 时也用于读取图片）
 * - description：角色描述（必填，LLM 主要依据）
 * - personality：角色性格（可选，补充上下文）
 * - scenario：角色场景（可选，补充上下文）
 * - includeImage：是否将角色卡 PNG 图片一并发送给多模态模型（仅当 AI 引擎 supportsVision=true 时有效）
 */
export interface GenerateCharacterTraitsParams {
  characterCardId: string;
  description: string;
  personality?: string;
  scenario?: string;
  /** 是否附带角色卡图片（多模态模型综合文本+图片提取特征） */
  includeImage?: boolean;
}

/**
 * 角色特征生成返回值。
 * - success=true 时 traits 为去重后的「带分类」特征项数组（可能为空数组，表示 LLM 未提取到任何特征）
 * - success=false 时 error 为友好错误信息（非堆栈）
 *
 * 【重点标记 - AI 自动归类增强】traits 由 `string[]` 升级为 `CategorizedTrait[]`
 *  - 原 Spec「AI 集成适配」规定 AI 返回 `string[]`、新特征落入「未分类」
 *  - 本次增强：AI 输出 `分类:tag` 形式，解析后携带 categoryId 透传到 store
 *  - store `setTraits` 据此将特征放入对应系统分类，无需用户手动归类
 *  - 兼容性：AI 未输出分类前缀时 categoryId 兜底为 `UNCATEGORIZED_CATEGORY_ID`，行为等价于原 Spec
 */
export interface GenerateCharacterTraitsResult {
  success: boolean;
  traits?: CategorizedTrait[];
  /** 角色外观描述（中文自然语言，2-4 句话，描述体型/发色/瞳色/服饰/配饰/种族等） */
  appearanceDescription?: string;
  error?: string;
  /**
   * RAG 标签库质检报告（仅 generateCharacterTraits 返回）。
   * - enabled=false：RAG 未启用，retrievedTags/tagValidation 为空
   * - enabled=true & status≠ready：索引未就绪，retrievedTags 为空
   * - enabled=true & status=ready：含检索到的参考标签 + 生成标签的验证结果
   */
  ragDebug?: {
    enabled: boolean;
    status: string;
    /** RAG 检索到的参考标签（注入到 system prompt 的 top-K 标签） */
    retrievedTags: Array<{ name: string; category: number; count: number; score: number }>;
    /** AI 生成的每条 tag 是否在标签库中的验证结果（含纠错建议） */
    tagValidation: Array<{
      tag: string;
      isValid: boolean;
      canonicalName?: string;
      category?: number;
      count?: number;
      /** invalid tag 跳过原因：'rating'=评级词不纠错；'no_suggestion'=无相似标签 */
      skipReason?: 'rating' | 'no_suggestion';
      /** invalid tag 的语义相似替换建议（top-3，按 score 降序） */
      suggestions: Array<{ name: string; category: number; count: number; score: number }>;
      /** 自动替换后对应的库内标签名（前端据此展示替换关系 + 撤销） */
      replacedBy?: string;
      /**
       * L3 颜色拆分信息（透传 tagRagService.validateTagsAgainstLibrary 的 splitTags）。
       * - 仅当 colorPartTag 与 feature 都命中标签库时设置
       * - 调用方据此将一个 trait 拆成两个：原 trait 替换为 featureTag，新增 colorPartTag trait
       * - 前端据此显示「🔄 已拆分」徽标 + 拆分撤销按钮
       */
      splitTags?: { colorPartTag: string; featureTag: string };
      /**
       * 命中轮次标识（Spec: add-multi-round-tag-audit / add-ai-fallback-tag-audit）。
       * 透传 tagRagService.validateTagsAgainstLibrary 的 source 字段，或由 AI 兜底环节写入 'ai-fallback'。
       * - 'user-map'       L0 自定义映射命中
       * - 'name'           L1 name 精确匹配
       * - 'alias'          L2 alias 精确匹配
       * - 'color-split'    L3 颜色拆分命中
       * - 'negation-strip' L3b 否定性修饰词剥离命中
       * - 'knn'            L4 语义 KNN suggestion 命中
       * - 'ai-fallback'    L5 AI 兜底命中（characterTraitAIService.applyAiFallback 写入，
       *                    非 validateTagsAgainstLibrary 返回；标识 LLM 生成候选词重跑 L0-L4 后命中）
       */
      source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn' | 'ai-fallback';
      /**
       * 末轮人工审核替换标记（Spec: add-multi-round-tag-audit）。
       * true 表示该 tag 已被用户手动指定替换词；前端显示紫色 🟣 徽标 + 撤销按钮。
       * 由前端 AssetManagerModal.handleManualReplace 写入，非 main 进程设置。
       */
      manuallyReplaced?: boolean;
      /** 人工指定的替换词（撤销时还原 trait.text 为 originalTag） */
      manualReplacement?: string;
      /**
       * AI 兜底尝试标记（Spec: add-ai-fallback-tag-audit）。
       * - true：已对当前 tag 调过 LLM 生成候选词（无论命中与否）
       * - undefined：未触发 AI 兜底（L0-L4 已命中/评级词/超出批量上限/主调用失败）
       * 前端据此区分「未尝试」与「尝试失败」两种 invalid 状态。
       */
      aiFallbackAttempted?: boolean;
      /**
       * AI 兜底返回的候选词数组（Spec: add-ai-fallback-tag-audit）。
       * - 命中时：包含命中的候选词（首个 valid 项）
       * - 未命中时：包含全部候选词，前端展示供用户参考
       * - 未尝试时：undefined
       */
      aiFallbackCandidates?: string[];
    }>;
  };
}

/**
 * 图片识别特征提取入参（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
 * - characterCardPath：角色卡 PNG 图片路径（必填，读取后转 base64 data URI 发送给多模态模型）
 * - characterName：角色名（可选，注入 user message 提供上下文）
 */
export interface RecognizeImageTraitsParams {
  characterCardPath: string;
  characterName?: string;
}

/**
 * 提示词生成入参（Spec: add-prompt-generation-in-asset-modal）。
 *
 * 与 `GenerateCharacterTraitsParams` 的区别：
 *  - 不需要 `characterCardId`（不读取角色卡图片，纯文本提示词驱动）
 *  - 不需要 `personality` / `scenario`（用户输入的是自由文本提示词，不是角色卡字段）
 *  - `prompt` 是用户自由输入的提示词（如 "red hair, blue dress, forest background"）
 *  - `baseTraits` 是当前已有特征文本（逗号分隔，作为上下文避免重复生成）
 *
 * 设计动机：
 *  - 用户在 AI 素材生成弹窗中需要快速生成额外的特征 tag，无需回到角色特征页签
 *  - 复用 `buildDynamicTraitSystemPrompt` + `applyTagAudit` + RAG 基础设施
 *  - 生成的 trait 携带 categoryId / translation / originalText，可直接追加到 editedTraits
 */
export interface GenerateTraitPromptsParams {
  /** 用户输入的提示词（如 "red hair, blue dress, forest background"） */
  prompt: string;
  /** 当前已有特征文本（逗号分隔，作为上下文避免重复生成） */
  baseTraits?: string;
}

/**
 * 提示词生成返回值。
 *
 * - success=true 时 traits 为分类后的特征项数组（含 translation / originalText）
 * - success=false 时 error 为友好错误信息
 * - ragDebug 与 `GenerateCharacterTraitsResult.ragDebug` 结构完全兼容
 */
export interface GenerateTraitPromptsResult {
  success: boolean;
  /** 生成的分类特征数组（含 translation + originalText，可直接追加到 editedTraits） */
  traits?: CategorizedTrait[];
  error?: string;
  /** RAG 标签库质检报告（与 GenerateCharacterTraitsResult.ragDebug 结构兼容） */
  ragDebug?: {
    enabled: boolean;
    status: string;
    retrievedTags: Array<{ name: string; category: number; count: number; score: number }>;
    tagValidation: Array<{
      tag: string;
      isValid: boolean;
      canonicalName?: string;
      category?: number;
      count?: number;
      skipReason?: 'rating' | 'no_suggestion';
      suggestions: Array<{ name: string; category: number; count: number; score: number }>;
      replacedBy?: string;
      splitTags?: { colorPartTag: string; featureTag: string };
      source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn' | 'ai-fallback';
      manuallyReplaced?: boolean;
      manualReplacement?: string;
      aiFallbackAttempted?: boolean;
      aiFallbackCandidates?: string[];
    }>;
  };
}

/**
 * AI 标签优化入参（Spec: add-ai-trait-optimization-for-image-gen）
 */
export interface OptimizeTraitsParams {
  /** 当前已启用的角色特征标签列表 */
  traits: Array<{ text: string; weight?: number; categoryId?: string }>;
  /** 当前对话上下文（用户与角色的完整对话文本） */
  conversationContext: string;
}

/**
 * AI 标签优化返回结果（Spec: add-ai-trait-optimization-for-image-gen）
 */
export interface OptimizeTraitsResult {
  success: boolean;
  /** AI 建议删除的标签列表（含原因） */
  tagsToRemove?: Array<{ text: string; reason?: string }>;
  /**
   * AI 删除标签后评估补充的标签列表（Spec: add-ai-tag-supplement-after-removal）。
   *
   * 与 tagsToRemove 对称：AI 在删除矛盾标签的同时，基于对话上下文评估需要补充的标签
   * （如删除 pants 后下身暴露，需补充 nude_lower_body / no_pants 等暴露特征标签）。
   *
   * - text: 被补充的标签文本
   * - reason: AI 给出的补充原因（可选）
   * - weight: 标签权重（可选，与 OptimizeTraitsParams.traits 项保持一致）
   * - categoryId: 分类 ID（可选，用于将补充标签归入对应系统分类）
   */
  tagsToAdd?: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }>;
  error?: string;
}

/**
 * 专用系统提示词（SubTask 12.2）。
 *
 * 设计要点：
 *  - 明确角色（角色视觉特征提取助手）与目标（输出 SD 提示词格式 tag）
 *  - 列出提取范围（物种/毛色发色/瞳色/服饰/配饰/其他显著特征）保证覆盖面
 *  - 4 条硬性要求：英文 tag / 逗号分隔 / 简洁 / 不臆测
 *  - 提供输出示例，降低 LLM 输出自然语言句子的概率
 *  - 与用户消息分开放置：system 中只放指令，description/personality/scenario 由调用方拼入 user 消息
 *
 * 【重点标记 - AI 自动归类增强】原提示词输出扁平 `tag` 列表，本次升级为「分类:tag」格式：
 *  - 每条 tag 前缀系统分类标签（basic / head / body / top / bottom / accessories / underwear / background / pose / expression）
 *  - LLM 据语义自行判断每条特征所属分类，由主进程 parseTraitsFromContent 解析剥离前缀
 *  - 兼容性：LLM 偶发不输出前缀时，parseTraitsFromContent 兜底归入 uncategorized
 *
 * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5
 *  - 本常量硬编码 7 个系统分类，LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），
 *    导致 AI 不会为这些分类生成 `tattoo:dragon tattoo` 等带前缀的 tag
 *  - 现已改为动态构建：`generateCharacterTraits` 调用 `buildDynamicTraitSystemPrompt(globalCategories)`
 *    将系统分类 + 全局字典自定义分类合并注入提示词
 *  - 本常量保留作为基线参考（文档化 prompt 结构），不再直接用于生产调用
 */
export const CHARACTER_TRAIT_SYSTEM_PROMPT = `你是一个角色视觉特征提取助手。请从给定的角色描述中提取角色的视觉外观特征，并为每个特征分配一个分类标签，输出为逗号分隔的「分类:tag|中文翻译」列表，用于 Stable Diffusion 图像生成，并同时输出一段中文角色外观描述。

分类体系（必须使用以下英文分类标签作为前缀，与「分类:tag|中文翻译」中的「分类」对应）：
- basic：基本特征（种族/物种如 lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf；性别如 female, male, 1girl, 1boy；内容分级如 sfw, nsfw；以及其他描述角色基本属性的基底特征，作为整个角色的基底）
- head：头部特征（发色、发型、瞳色、动物耳朵、帽子、面部装饰等头部相关）
- body：身体特征（体型、肤色、毛色、尾巴、翅膀、身高等身体相关，不含物种与性别）
- top：上装（上衣、衬衫、外套、连衣裙、校服等上身衣物；dress/school uniform 等连体衣物归入上装）
- bottom：下装（裤子、裙子、短裤等下身衣物）
- accessories：配饰（眼镜、缎带、首饰、帽子、围巾等装饰物）
- underwear：内衣（胸罩、内裤、内衣套装等贴身衣物）
- background：背景环境（场景元素、背景物件）
- pose：人物姿势（身体姿态、动作）
- expression：人物表情（面部表情、情绪状态）
- interaction：互动元素（用户与角色之间的身体接触、肢体动作等交互场景，含两种模式：A) POV 脱离身体风格如 disembodied_hand / hand_on_breast / disembodied_tongue / licking；B) 双角色互动风格如 hugging_another / holding_hands / hand_on_another's_head / grabbing_another's_breast / sitting_on_another。用于引导 SD 生成包含交互性质的图片）

分类建议（参考，按特征语义归入最合适的分类）：
- 物种/种族（如 dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral）→ basic
- 性别（如 female, male, 1girl, 1boy）→ basic
- 内容分级（如 sfw, nsfw）→ basic
- 毛色（如 white fur, black fur）→ body
- 发色（如 black hair, blonde hair）→ head
- 瞳色（如 blue eyes, red eyes）→ head
- 上装（如 black shirt, school uniform, dress, coat）→ top
- 下装（如 jeans, skirt, shorts, pants）→ bottom
- 配饰（如 glasses, ribbon, hat, necklace）→ accessories
- 内衣（如 bra, underwear, panties）→ underwear
- 动物耳朵（如 animal ears, dog ears）→ head
- 尾巴/翅膀（如 tail, wings）→ body
- 用户与角色的动作互动（触摸身体 → disembodied_hand + hand_on_breast/hand_on_butt/hand_on_hip/hand_on_leg；舔 → disembodied_tongue + licking/face_lick/breast_lick/foot_lick；亲吻 → kissing；拥抱 → hugging_another/hug；牵手 → holding_hands；手放在他人身上 → hand_on_another's_head/shoulder/face/cheek/chin/back/arm/chest/thigh/waist；抓握 → grabbing_another's_breast/ass/arm/hair；坐/抱 → sitting_on_another/carrying_another）→ interaction

【互动元素识别要求（重要）】
当对话上下文描述了用户与角色的动作互动（如"用手触摸她的身体"、"舔她的手"、"亲吻她"、"拥抱她"等）时，必须提取对应的 Danbooru 互动标签，使用 interaction 分类前缀输出。互动标签分两种模式：

■ 模式 A — POV/脱离身体风格（用户不完整出现在画面中，仅出现交互的身体部位）：
- 身体接触类（手触摸角色）：
  · disembodied_hand（脱离身体的手 — 表示画面中出现一只不属于任何完整角色的手）
  · 配合具体部位：hand_on_breast（手放在胸部）/ hand_on_butt（手放在臀部）/ hand_on_hip（手放在腰间）/ hand_on_leg（手放在腿上）/ hand_on_own_face 等
- 舔舐类（舌头接触角色）：
  · disembodied_tongue（脱离身体的舌头）
  · 配合具体部位：licking（舔）/ face_lick（舔脸）/ breast_lick（舔胸）/ foot_lick（舔脚）等
- 其他部位：disembodied_penis / disembodied_foot / disembodied_mouth 等脱离身体的部位
- 其他行为类：vaginal_fingering / breast_sucking / nipple_play / anal_penetration 等性相关行为

■ 模式 B — 双角色互动风格（用户作为"another"完整出现在画面中，与角色互动）：
- 拥抱/牵手：hugging_another（拥抱他人）/ hug / holding_hands（牵手）
- 手放在他人身上：hand_on_another's_head（手放在他人头上）/ hand_on_another's_shoulder（肩）/ hand_on_another's_face（脸）/ hand_on_another's_cheek（脸颊）/ hand_on_another's_chin（下巴）/ hand_on_another's_back（背）/ hand_on_another's_arm（手臂）/ hand_on_another's_chest（胸）/ hand_on_another's_thigh（腿）/ hand_on_another's_waist（腰）
- 抓握他人：grabbing_another's_breast（抓胸）/ grabbing_another's_ass（抓臀）/ grabbing_another's_arm（抓手臂）/ grabbing_another's_hair（抓头发）/ grabbing_another's_wrist（抓手腕）
- 持握他人：holding_another's_wrist（握手腕）/ holding_another's_hair（握头发）/ holding_another's_arm（握手臂）/ hand_in_another's_hair（手插入他人头发）
- 其他互动：sitting_on_another（坐在他人身上）/ carrying_another（抱着他人）/ facing_another（面向他人）/ smiling_at_another（对他人微笑）/ kissing（亲吻）

关键原则：
1. 互动元素独立于角色的完整形象 — 即使用户设定了完整形象，也必须添加 disembodied_* 标签（脱离身体的部位+动作），而非试图生成用户的完整角色
2. 互动标签必须成对出现：disembodied_hand 配合 hand_on_*，disembodied_tongue 配合 *_lick/licking_*
3. 仅当对话明确描述互动动作时才输出互动标签；角色独自站立/坐着的描述不输出互动标签
4. 互动标签使用 interaction 分类前缀，如 interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部, interaction:hugging_another|拥抱他人
5. 根据对话语境选择模式：例如（"我用手触摸…"）倾向模式 A（disembodied_*）;用手指插入阴道（vaginal_fingering）倾向模式A；描述两个角色互动倾向模式 B（*_another）

要求：
1. 首先输出一行「分类:tag|中文翻译」列表，逗号分隔，每个 tag 前缀一个分类标签，格式为 \`分类:tag|中文翻译\`（如 \`basic:dog girl|犬耳少女, basic:female|女性, head:white hair|白发\`）。其中 \`|\` 后是该 tag 的简短中文翻译（2-8 个字，如「白发」「蓝眼睛」「黑色衬衫」），每条 tag 必须带翻译。不要编号、不要自然语言句子、不要解释
2. 然后输出一行 "---DESCRIPTION---" 作为分隔符
3. 最后输出一段中文角色外观描述（2-4 句话），描述角色的整体视觉外观，包括物种、性别、体型、发色发型、瞳色、服饰、配饰等
4. 可选权重段（Spec: add-sdxl-prompt-weight-support）：每条 tag 可在翻译后追加第三个 \`|\` 分隔的权重段，格式为 \`分类:tag|中文翻译|权重\`：
   - 权重段可选，不写则默认 1.0（不加权）
   - 范围 0.1-10.0（保留 1 位小数，如 0.5 / 1.3 / 2.0）
   - 用途：用于 SDXL 提示词加权/弱化（如强化 \`head:blue_eyes|蓝眼睛|1.5\` 让蓝色眼睛更突出，弱化 \`background:simple_background|简洁背景|0.5\` 让背景更简洁）
   - 仅在用户描述明确强调某特征强度时才输出权重（如「非常蓝的眼睛」→ 1.3，「淡淡的微笑」→ 0.7），常规特征不需要输出权重段
   - 1.0 时省略权重段以保持输出简洁（不要输出 \`|1.0\`）
5. 输出示例：
basic:dog girl|犬耳少女, basic:female|女性, head:white hair|白发, head:blue eyes|蓝眼睛|1.3, body:white fur|白色毛发, top:black shirt|黑色衬衫, accessories:glasses|眼镜, head:animal ears|动物耳朵
---DESCRIPTION---
一位犬耳少女，拥有洁白的毛发和蓝色的眼睛。身穿黑色衬衫，戴着眼镜，头上有一对毛茸茸的犬耳。体型娇小，整体风格偏可爱。`;

/**
 * 图片识别专用系统提示词（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
 *
 * 与 CHARACTER_TRAIT_SYSTEM_PROMPT 的区别：
 *  - 面向多模态视觉模型，输入是角色卡 PNG 图片而非文本描述
 *  - 英文指令（视觉模型英文覆盖更广）
 *  - 提取范围更广：含 body type / skin tone / ethnicity / species，覆盖图片可见的全部视觉特征
 *  - 输出仍为英文逗号分隔 SD tag，复用 parseTraitsFromContent 解析
 *
 * 【重点标记 - AI 自动归类增强】与 CHARACTER_TRAIT_SYSTEM_PROMPT 同步升级为「category:tag」格式，
 * 便于多模态识别结果同样携带分类信息进入 store
 *
 * 【重点标记 - 衣物分类拆分】原 `clothing` 分类已拆分为 `top`/`bottom`/`accessories`/`underwear`，
 * 本常量同步更新分类列表与 guidance 示例。
 *
 * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5
 *  - 与 CHARACTER_TRAIT_SYSTEM_PROMPT 同步改为动态构建：
 *    `recognizeImageTraits` 调用 `buildDynamicImageTraitSystemPrompt(globalCategories)`
 *  - 本常量保留作为基线参考（文档化 prompt 结构），不再直接用于生产调用
 */
export const IMAGE_TRAIT_SYSTEM_PROMPT = `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated "category:tag" pairs for Stable Diffusion. Each tag MUST be prefixed with one of these category labels:
- basic: species/race (e.g. lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf), gender (e.g. female, male, 1girl, 1boy), content rating (e.g. sfw, nsfw), and other foundational character attributes
- head: hair color, hair style, eye color, animal ears, hat, facial decorations
- body: body type, skin tone, fur color, tail, wings, height (excluding species and gender)
- top: upper-body clothes (e.g. shirt, coat, dress, school uniform; one-piece garments like dress/school uniform go to top)
- bottom: lower-body clothes (e.g. jeans, skirt, shorts, pants)
- accessories: decorations (e.g. glasses, ribbon, hat, necklace, jewelry)
- underwear: undergarments (e.g. bra, underwear, panties)
- background: scene elements, background objects
- pose: body posture, action
- expression: facial expression, emotion
- interaction: interaction elements between user and character (e.g. disembodied_hand, hand_on_breast, hugging_another, holding_hands; typically NOT extracted from a single character card image, only triggered by conversation context describing physical interactions)

Category guidance:
- Species/race (e.g. dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral) → basic
- Gender (e.g. female, male, 1girl, 1boy) → basic
- Content rating (e.g. sfw, nsfw) → basic
- Fur color (e.g. white fur, black fur) → body
- Hair color (e.g. black hair, blonde hair) → head
- Eye color (e.g. blue eyes, red eyes) → head
- Upper-body clothes (e.g. black shirt, school uniform, dress, coat) → top
- Lower-body clothes (e.g. jeans, skirt, shorts, pants) → bottom
- Accessories (e.g. glasses, ribbon, hat, necklace) → accessories
- Underwear (e.g. bra, underwear, panties) → underwear
- Animal ears (e.g. animal ears, dog ears) → head
- Tail/wings (e.g. tail, wings) → body
- Interaction between user and character (disembodied_hand + hand_on_*, disembodied_tongue + *_lick, hugging_another, holding_hands, hand_on_another's_*, grabbing_another's_*) → interaction (typically NOT applicable to single character image analysis)

Output format requirements:
1. First, output ONE line of "category:tag" pairs separated by commas, no numbering, no explanations. Example: basic:cat girl, basic:female, head:white hair, head:red eyes, top:school uniform, head:cat ears
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including species, gender, body type, hair color/style, eye color, clothing, accessories, etc.
4. Optional weight segment (Spec: add-sdxl-prompt-weight-support): each tag MAY append a third "|"-separated weight segment after the translation, in the format "category:tag|chinese_translation|weight":
   - The weight segment is OPTIONAL; omit it to use the default 1.0 (no weighting)
   - Range: 0.1-10.0 (one decimal place, e.g. 0.5 / 1.3 / 2.0)
   - Purpose: SDXL prompt weight strengthening/weakening (e.g. strengthen \`head:blue_eyes|蓝眼睛|1.5\` to make blue eyes more prominent, weaken \`background:simple_background|简洁背景|0.5\` to make the background simpler)
   - Only output a weight when the user description explicitly emphasizes a feature's intensity (e.g. "very blue eyes" → 1.3, "faint smile" → 0.7). Do NOT output a weight segment for ordinary features
   - When the weight is 1.0, omit the weight segment to keep the output concise (do NOT output "|1.0")

Output example:
basic:cat girl, basic:female, head:white hair, head:red eyes|1.3, top:school uniform, head:cat ears
---DESCRIPTION---
一位猫耳少女，拥有白色长发和红色的眼睛。身穿学校制服，头上有一对白色的猫耳。体型纤细，整体风格偏清纯。`;

/**
 * AI 辅助角色特征生成服务。
 *
 * 设计原则：
 *  - 无状态：每次调用实时读取 AI 引擎配置，不缓存
 *  - 永不抛异常：所有错误转为 `{ success: false, error }` 返回
 *  - 复用 aiConfigProvider：与 writing/* 服务共享配置入口
 *  - 非流式调用：特征 tag 输出短，无需流式
 */
class CharacterTraitAIService {
  /**
   * 服装状态 RAG 检索关键词（Spec: add-costume-state-prompt-directives）。
   * 用于在 generateTraitPrompts 中额外检索 RAG 标签库，获取服装状态相关标签作为参考。
   * 关键词与 buildCostumeStateGuidance 中的标签示例保持一致。
   */
  private static readonly COSTUME_STATE_RAG_KEYWORDS: string = [
    'open_clothes', 'open_jacket', 'open_shirt', 'unbuttoned', 'unzipped', 'zipper_open',
    'panties_aside', 'shorts_aside', 'bra_lift', 'shirt_lift', 'skirt_lift',
    'shorts_around_one_leg', 'clothes_pull',
    'one_breast_out', 'both_breasts_out', 'off_shoulder', 'bare_shoulders',
    'cleavage', 'underboob', 'sideboob', 'navel', 'midriff',
  ].join(' ');

  /**
   * 生成角色视觉特征 tag 列表。
   *
   * 流程：
   *  1. 读取 AI 引擎配置（baseUrl / apiKey / modelName / systemPrompt / apiKeyTransmission）
   *  2. 校验 baseUrl / apiKey / modelName 是否齐备，缺失返回友好错误
   *  3. 读取引擎的 temperature / max_tokens（缺失时使用默认值 0.3 / 512）
   *  4. 构建 system + user 消息，注入引擎 systemPrompt（与 OutlineGenerator 一致）
   *  5. 非流式 POST /v1/chat/completions
   *  6. 解析 data.choices[0].message.content，提取逗号分隔 tag
   *  7. trim 每项，过滤空字符串，去重，保留原顺序
   *
   * @param params 入参，详见 GenerateCharacterTraitsParams
   * @returns 详见 GenerateCharacterTraitsResult
   */
  async generateCharacterTraits(
    params: GenerateCharacterTraitsParams
  ): Promise<GenerateCharacterTraitsResult> {
    const { characterCardId, description, personality, scenario, includeImage } = params;

    try {
      // 入参校验
      if (!characterCardId) {
        return { success: false, error: 'characterCardId 不能为空' };
      }
      if (!description || !description.trim()) {
        return { success: false, error: '角色描述为空，无法提取视觉特征' };
      }

      // 1. 读取 AI 引擎配置
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 2. 配置兜底校验（SubTask 12.4）
      if (!baseUrl) {
        console.warn('[CharacterTraitAI] AI 引擎未配置 baseUrl');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        // 【修复 - Spec: fix-dialogue-worldbook-association-and-tag-output 后续缺陷】
        // 本地 llama-server 等引擎无需 api_key（对话链路 ChatEngine 从不要求 apiKey），
        // 空 key 是合法场景，不应判为"未配置"。远程服务缺 key 会由 HTTP 401 报错。
        console.warn('[CharacterTraitAI] AI 引擎 apiKey 为空（本地引擎合法场景），继续调用');
      }
      if (!modelName) {
        console.warn('[CharacterTraitAI] AI 引擎未配置 modelName');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }

      // 3. 读取引擎运行时参数（temperature / max_tokens）
      // 【重点标记 - 项目最高优先级规则】禁止使用 AI 参数默认值：
      // 缺失时返回友好错误（不抛异常、不静默使用 fallback），与 WritingStyleLearningService
      // 抛 '未配置 AI 温度参数/最大令牌数' 错误的语义一致，符合技术文档
      // 「禁止设置 AI 参数默认值」规则（实施日期 2026-05-24）
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 4. 构建 messages
      // 【重点标记 - 多模态综合特征提取】当 includeImage=true 时，将角色卡 PNG 图片
      // 与文本描述一并发送给多模态模型，综合图片视觉信息 + 文本描述提取更完整的特征 tag。
      //
      // 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5.2
      // 原 messages 直接使用硬编码的 CHARACTER_TRAIT_SYSTEM_PROMPT，仅含 7 个系统分类，
      // LLM 不知道用户创建的自定义分类（如「纹身」「武器装备」），导致不会为这些分类生成 tag。
      // 现改为：先从全局字典加载自定义分类，再调用 buildDynamicTraitSystemPrompt 动态构建提示词。
      const globalCategories = categoryDictionaryService.loadDictionary().categories;
      const dynamicSystemPrompt = this.buildDynamicTraitSystemPrompt(globalCategories);

      // 【RAG 标签库参考注入】Spec: rag-tag-library-for-ai-trait-generation / Task 9
      // 基于 description 检索标签库 top-K 相关 tag，注入到 system prompt 尾部，
      // 引导 LLM 优先使用 Danbooru/e621 标签库内的有效 tag（下划线格式）。
      // 降级保证：tagRag.enabled=false / 索引未就绪 / 检索失败 → 返回空字符串，不影响主流程
      //
      // 【质检报告增强】使用 buildRagReferenceWithDebug 获取检索调试信息，
      // 生成完成后对 AI 输出的 tag 做标签库验证，返回 ragDebug 供 UI 展示质检报告。
      const ragDebugInfo = await this.buildRagReferenceWithDebug(description);
      const ragSection = ragDebugInfo.prompt;
      const systemPromptWithRag = ragSection
        ? `${dynamicSystemPrompt}\n\n${ragSection}`
        : dynamicSystemPrompt;

      const userContent = this.buildUserMessage(description, personality, scenario);

      let messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>;

      if (includeImage) {
        // 读取角色卡 PNG 图片为 base64 data URI
        try {
          const imageBuffer = fsSync.readFileSync(characterCardId);
          const base64Image = imageBuffer.toString('base64');
          const dataUri = `data:image/png;base64,${base64Image}`;
          messages = [
            { role: 'system', content: systemPromptWithRag + '\n\nIn addition to the text description, a character image is provided. Please analyze BOTH the image and the text description to extract comprehensive visual feature tags with category prefixes (format: `category:tag`) AND write a Chinese appearance description. Prioritize features visible in the image, and use the text description to fill in any gaps. Remember to output the categorized tags first, then the "---DESCRIPTION---" separator, then the Chinese description.' },
            {
              role: 'user',
              content: [
                { type: 'text', text: userContent },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ];
          console.log('[CharacterTraitAI] includeImage=true, sending multimodal request with character card image');
        } catch (imgError) {
          console.warn('[CharacterTraitAI] Failed to read character card image, falling back to text-only:', imgError);
          messages = [
            { role: 'system', content: systemPromptWithRag },
            { role: 'user', content: userContent },
          ];
        }
      } else {
        messages = [
          { role: 'system', content: systemPromptWithRag },
          { role: 'user', content: userContent },
        ];
      }
      // 注入引擎级 system prompt（与 OutlineGenerator.enrichSystemPrompt 一致）
      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 5. 构建请求头与请求体
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          headers['Authorization'] = authValue;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[CharacterTraitAI] Calling LLM for characterCardId:', characterCardId, {
        baseUrl,
        modelName,
        apiKeyTransmission,
        temperature,
        maxTokens,
        descriptionLength: description.length,
      });

      // 6. 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[CharacterTraitAI] LLM request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        console.error('[CharacterTraitAI] LLM returned empty content:', data);
        return {
          success: false,
          error: 'AI 返回内容无法解析为 tag 列表',
        };
      }

      // 7. 解析响应：提取逗号分隔的 tag + 角色外观描述
      const { traits, appearanceDescription } = this.parseTraitsAndDescription(content);

      console.log('[CharacterTraitAI] Generated traits:', traits.length, 'tags for characterCardId:', characterCardId, 'hasDescription:', !!appearanceDescription);

      // 【质检报告 + 标签纠错 + AI 兜底】L0-L5 完整审计链（提取为 applyTagAudit 辅助方法）
      // 审计流程：validateTagsAgainstLibrary → 自动替换（L3 拆分/L2-L3 规范化/L4 KNN）→ AI 兜底（L5）
      // traits 会被原地修改（text 字段替换 + L3 拆分 push 新 trait）
      const tagValidation = await this.applyTagAudit(
        traits,
        { characterCardId, description, personality, scenario, includeImage },
        { baseUrl, apiKey, apiKeyTransmission, engineSystemPrompt, modelName },
        { temperature, maxTokens }
      );

      return {
        success: true,
        traits,
        appearanceDescription,
        ragDebug: {
          enabled: ragDebugInfo.enabled,
          status: ragDebugInfo.status,
          retrievedTags: ragDebugInfo.retrievedTags.map((t) => ({
            name: t.name,
            category: t.category,
            count: t.count,
            score: t.score,
          })),
          tagValidation,
        },
      };
    } catch (error) {
      console.error('[CharacterTraitAI] generateCharacterTraits failed:', error);
      // 网络错误 / 超时 / JSON 解析错误 等统一兜底
      const message = error instanceof Error ? error.message : String(error);
      // 友好化常见错误
      if (message.includes('fetch failed') || message.toLowerCase().includes('network')) {
        return {
          success: false,
          error: 'AI 调用失败：无法连接到 AI 服务，请检查网络或 API 地址',
        };
      }
      if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
        return {
          success: false,
          error: 'AI 调用失败：请求超时，请稍后重试',
        };
      }
      return {
        success: false,
        error: `AI 调用失败：${message}`,
      };
    }
  }

  // ============ AI 兜底标签审核（Spec: add-ai-fallback-tag-audit） ============
  // 4 个私有方法：
  //  1. buildAiFallbackUserMessage  — 构建 user 消息（角色上下文 + 未匹配 tag 列表）
  //  2. parseAiFallbackResponse     — 解析 LLM 输出为 Map<originalTag, candidates[]>
  //  3. generateTagSynonymsBatch    — 批量调 LLM 生成候选词（复用主调用配置）
  //  4. applyAiFallback             — 候选词再验证 + 替换 trait + 持久化映射 + 标记 source

  /**
   * 构建 AI 兜底用户消息：未匹配 tag 列表 + 角色上下文（description/personality/scenario）。
   *
   * 设计要点：
   *  - 角色上下文与主调用 buildUserMessage 一致，让 LLM 基于完整角色信息给出语义合理的候选词
   *  - 未匹配 tag 列表用换行分隔，每行一个，避免 LLM 误解析为逗号分隔
   *  - 末尾追加请求行，与 AI_FALLBACK_SYSTEM_PROMPT 的格式约定呼应
   */
  private buildAiFallbackUserMessage(
    unmatchedTags: string[],
    description: string,
    personality?: string,
    scenario?: string
  ): string {
    const parts: string[] = [];
    parts.push('角色描述：');
    parts.push(description.trim());
    if (personality && personality.trim()) {
      parts.push('角色性格：');
      parts.push(personality.trim());
    }
    if (scenario && scenario.trim()) {
      parts.push('角色场景：');
      parts.push(scenario.trim());
    }
    parts.push('未匹配标签列表（每个标签占一行）：');
    parts.push(unmatchedTags.join('\n'));
    parts.push('请按系统提示词的格式输出每个标签的候选同义词或拆分词。');
    return parts.join('\n\n');
  }

  /**
   * 解析 LLM 兜底返回内容为 Map<originalTag, candidates[]>。
   *
   * 期望格式（每行一条）：
   *   <original_tag> | candidate1, candidate2, candidate3
   *
   * 鲁棒性处理：
   *  - 空行/无 `|` 行：跳过
   *  - 候选词两侧空白：trim
   *  - 候选词包含空格：保留原样（验证阶段会做空格/下划线互转）
   *  - LLM 输出原 tag 大小写/前后空白不一致：调用方 unmatchedTags 大小写不敏感匹配
   *  - 候选词去重（按 lowercase）
   *  - 候选词上限 4 个（按 LLM 输出顺序截断，避免过多候选拖慢验证）
   *
   * @param content       LLM 原始返回内容
   * @param unmatchedTags 调用方传入的未匹配 tag 列表（用于大小写不敏感匹配 + 过滤无关行）
   * @returns Map<原始 tag（保持 unmatchedTags 中的原大小写）, 候选词数组>
   */
  private parseAiFallbackResponse(
    content: string,
    unmatchedTags: string[]
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (!content || typeof content !== 'string') return result;

    // 构建 unmatchedTags 的小写→原值映射，用于大小写不敏感匹配 LLM 输出
    const unmatchedLowerToOriginal = new Map<string, string>();
    for (const t of unmatchedTags) {
      unmatchedLowerToOriginal.set(t.toLowerCase().trim(), t);
    }

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 必须含 `|` 分隔符；不含则跳过（避免误解析 LLM 输出的解释性句子）
      const pipeIdx = trimmed.indexOf('|');
      if (pipeIdx <= 0) continue;

      const originalRaw = trimmed.substring(0, pipeIdx).trim();
      const candidatesRaw = trimmed.substring(pipeIdx + 1).trim();
      if (!originalRaw || !candidatesRaw) continue;

      // 大小写不敏感匹配 unmatchedTags，避免 LLM 输出大小写偏差
      const originalKey = unmatchedLowerToOriginal.get(originalRaw.toLowerCase());
      if (!originalKey) continue; // LLM 输出了未在 unmatchedTags 中的 tag → 跳过

      // 解析候选词：按英文逗号/中文逗号切分，trim，过滤空字符串
      const candidates = candidatesRaw
        .split(/[,，]/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      // 候选词去重（按 lowercase）+ 上限 4 个
      const seen = new Set<string>();
      const uniqueCandidates: string[] = [];
      for (const c of candidates) {
        const lower = c.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        uniqueCandidates.push(c);
        if (uniqueCandidates.length >= 4) break;
      }

      if (uniqueCandidates.length > 0) {
        result.set(originalKey, uniqueCandidates);
      }
    }

    return result;
  }

  /**
   * 批量调用 LLM 为未匹配 tag 生成候选同义词/拆分词（Spec: add-ai-fallback-tag-audit）。
   *
   * 复用主调用 generateCharacterTraits 的：
   *  - aiConfig（baseUrl/apiKey/apiKeyTransmission/engineSystemPrompt/modelName）
   *  - runtimeConfig（temperature/maxTokens，遵守「禁止 AI 参数默认值」规则）
   *  - 多模态消息构建（includeImage=true 时读 PNG 为 base64 data URI）
   *  - enrichSystemPrompt 注入引擎级 system prompt
   *
   * 与主调用的差异：
   *  - 系统提示词换为 AI_FALLBACK_SYSTEM_PROMPT
   *  - 用户消息为「未匹配 tag 列表 + 角色上下文」而非「角色描述」
   *  - 不注入 RAG 参考段落（兜底阶段不需要标签库引导，否则 LLM 会复制库内 tag）
   *
   * 失败处理：
   *  - 任何异常（网络/HTTP/空内容）→ 返回空 Map，调用方据此跳过候选词验证
   *  - 不抛异常，与 service「永不抛异常」哲学一致
   *
   * @param unmatchedTags  未匹配 tag 列表
   * @param params         原始 generateCharacterTraits 入参（复用 characterCardId/description/personality/scenario/includeImage）
   * @param aiConfig       已读取的 AI 引擎配置（避免重复读取）
   * @param runtimeConfig  已读取的运行时参数
   * @returns Map<原始 tag, 候选词数组>；失败时返回空 Map
   */
  private async generateTagSynonymsBatch(
    unmatchedTags: string[],
    params: GenerateCharacterTraitsParams,
    aiConfig: {
      baseUrl: string;
      apiKey: string;
      apiKeyTransmission: string;
      engineSystemPrompt: string;
      modelName: string;
    },
    runtimeConfig: { temperature: number; maxTokens: number }
  ): Promise<Map<string, string[]>> {
    const { characterCardId, description, personality, scenario, includeImage } = params;
    const { baseUrl, apiKey, apiKeyTransmission, engineSystemPrompt, modelName } = aiConfig;
    const { temperature, maxTokens } = runtimeConfig;

    try {
      // 构建 user 消息（角色上下文 + 未匹配 tag 列表）
      const userContent = this.buildAiFallbackUserMessage(
        unmatchedTags,
        description,
        personality,
        scenario
      );

      // 构建 messages（含多模态图片，与主调用一致）
      let messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>;

      if (includeImage) {
        try {
          const imageBuffer = fsSync.readFileSync(characterCardId);
          const base64Image = imageBuffer.toString('base64');
          const dataUri = `data:image/png;base64,${base64Image}`;
          messages = [
            {
              role: 'system',
              content:
                AI_FALLBACK_SYSTEM_PROMPT +
                '\n\nIn addition to the text description, a character image is provided. Please use BOTH the image and the text description as context to generate the most semantically appropriate candidate tags.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: userContent },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ];
          console.log('[CharacterTraitAI] AI 兜底: includeImage=true, 发送多模态请求含角色卡图片');
        } catch (imgError) {
          console.warn('[CharacterTraitAI] AI 兜底: 读取角色卡图片失败，降级为纯文本:', imgError);
          messages = [
            { role: 'system', content: AI_FALLBACK_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ];
        }
      } else {
        messages = [
          { role: 'system', content: AI_FALLBACK_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ];
      }

      // 注入引擎级 system prompt（与主调用一致）
      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 构建请求头与请求体
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          headers['Authorization'] = authValue;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[CharacterTraitAI] AI 兜底: 调用 LLM 生成候选词', {
        baseUrl,
        modelName,
        unmatchedCount: unmatchedTags.length,
        includeImage: !!includeImage,
      });

      // 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(
          '[CharacterTraitAI] AI 兜底: LLM 请求失败:',
          response.status,
          response.statusText,
          errorText
        );
        return new Map();
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        console.error('[CharacterTraitAI] AI 兜底: LLM 返回空内容:', data);
        return new Map();
      }

      // 解析 LLM 输出为候选词映射
      const candidatesMap = this.parseAiFallbackResponse(content, unmatchedTags);
      console.log(
        `[CharacterTraitAI] AI 兜底: LLM 返回 ${candidatesMap.size}/${unmatchedTags.length} 个 tag 的候选词`,
        Array.from(candidatesMap.entries()).map(([k, v]) => `${k}→[${v.join(',')}]`)
      );

      return candidatesMap;
    } catch (error) {
      console.error('[CharacterTraitAI] AI 兜底: generateTagSynonymsBatch 异常:', error);
      return new Map();
    }
  }

  /**
   * 应用 AI 兜底：对每个未匹配 tag，验证其候选词数组中是否有命中标签库的，
   * 命中则替换 trait.text + 持久化到 userSynonymMap + 标记 source='ai-fallback'（Spec: add-ai-fallback-tag-audit）。
   *
   * 流程：
   *  1. 扁平化所有候选词（去重），一次性调 tagRagService.validateTagsAgainstLibrary
   *     （避免 N 次串行 embedding，与主链路性能优化一致）
   *  2. 对每个未匹配 tag，按候选词顺序找首个 isValid=true 的候选词
   *  3. 命中：
   *     - 替换 traits 数组中 text === tag 的 trait.text 为 canonicalName
   *     - 在 tagValidation 对应项写入：replacedBy、source='ai-fallback'、
   *       aiFallbackAttempted=true、aiFallbackCandidates=候选词数组
   *     - 调 userSynonymMapService.addMapping(tag, canonicalName) 持久化
   *       （下次 AI 生成同词时 L0 首轮命中）
   *  4. 未命中：tagValidation 对应项写入 aiFallbackAttempted=true、aiFallbackCandidates=候选词数组
   *     （保留 ✏ 手动替换入口）
   *
   * @param aiFallbackTargets  待处理 tagValidation 项（已过滤 isValid=false && skipReason!=='rating' && !replacedBy）
   * @param candidatesMap      LLM 返回的 tag → 候选词数组映射
   * @param traits             当前 traits 数组（mutate .text 字段）
   * @returns 命中数（用于日志统计）
   */
  private async applyAiFallback(
    aiFallbackTargets: Array<NonNullable<GenerateCharacterTraitsResult['ragDebug']>['tagValidation'][number]>,
    candidatesMap: Map<string, string[]>,
    traits: CategorizedTrait[]
  ): Promise<number> {
    // 收集所有候选词，一次性验证（避免 N 次串行 embedding）
    const allCandidates: string[] = [];
    const seenCandidates = new Set<string>();
    for (const candidates of candidatesMap.values()) {
      for (const c of candidates) {
        const lower = c.toLowerCase();
        if (seenCandidates.has(lower)) continue; // 跨 tag 候选词去重，避免重复 embedding
        seenCandidates.add(lower);
        allCandidates.push(c);
      }
    }

    if (allCandidates.length === 0) {
      // 所有 tag 都无候选词 → 全部标记 attempted
      for (const target of aiFallbackTargets) {
        target.aiFallbackAttempted = true;
      }
      return 0;
    }

    // 一次性调 validateTagsAgainstLibrary（内部走 L0-L4 全链路）
    // 注意：候选词本身可能已被 userSynonymMap 持久化（上次 AI 兜底写入），L0 命中
    const candidateValidations = await tagRagService.validateTagsAgainstLibrary(allCandidates);

    // 构建 candidate → validation 映射（大小写不敏感，因 validateTagsAgainstLibrary 返回 tag 是原值）
    const candidateValMap = new Map<string, typeof candidateValidations[number]>();
    for (const cv of candidateValidations) {
      candidateValMap.set(cv.tag.toLowerCase(), cv);
    }

    let hitCount = 0;
    for (const target of aiFallbackTargets) {
      const candidates = candidatesMap.get(target.tag) ?? [];
      // 标记 attempted（无论命中与否，便于前端展示状态）
      target.aiFallbackAttempted = true;
      target.aiFallbackCandidates = candidates;

      // 按候选词顺序找首个 isValid=true 的
      let firstHit: { name: string; canonicalName?: string } | null = null;
      for (const c of candidates) {
        const cv = candidateValMap.get(c.toLowerCase());
        if (cv?.isValid) {
          firstHit = { name: c, canonicalName: cv.canonicalName };
          break;
        }
      }

      if (!firstHit) {
        // 全部候选词未命中 → 保留 ✏ 手动入口（aiFallbackAttempted=true 已设置）
        continue;
      }

      // 命中：替换 trait.text（优先用 canonicalName 走规范化，与主链路场景2 一致）
      const replacement = firstHit.canonicalName || firstHit.name;
      const trait = traits.find((t) => t.text === target.tag);
      if (!trait) {
        console.warn(
          `[CharacterTraitAI] AI 兜底: 未找到 trait.text === "${target.tag}" 的特征项，跳过替换`
        );
        continue;
      }
      // 【Spec: optimize-trait-translation-and-temp-scheme】翻译继承：L5 AI 兜底替换保留源标签翻译
      // （与 L2/L3 规范化替换、L4 KNN 语义替换一致，translation 保持不变，保留 AI 原始翻译供用户参考）
      // 【Spec: add-sdxl-prompt-weight-support / Task 5.3】weight 继承：
      // L5 AI 兜底替换（与 L4 KNN 一致）保留源标签 weight，仅替换 text；
      // replacement 来自 LLM 候选词重跑 L0-L4 命中，语义等价，原权重应继续生效
      trait.text = replacement;

      // 更新 tagValidation 项
      target.replacedBy = replacement;
      target.source = 'ai-fallback';

      // 持久化到 userSynonymMap（下次 AI 生成同词时 L0 首轮命中）
      try {
        userSynonymMapService.addMapping(target.tag, replacement);
      } catch (err) {
        console.warn(
          `[CharacterTraitAI] AI 兜底: 持久化映射 "${target.tag}" → "${replacement}" 失败:`,
          err
        );
        // 持久化失败不阻塞替换（trait 已更新，但下次同词仍需走 AI 兜底）
      }

      hitCount++;
    }

    return hitCount;
  }

  /**
   * 标签审计辅助方法（提取自 generateCharacterTraits）。
   *
   * 封装 L0-L5 完整审计链，供 generateCharacterTraits 复用：
   *  1. validateTagsAgainstLibrary（L0-L4 匹配 + suggestions）
   *  2. 自动替换（L3 颜色拆分 + L2/L3 规范化 + L4 KNN 语义替换）
   *  3. AI 兜底（L5：LLM 生成候选词 → 再走 L0-L4 → 命中替换 + 持久化 userSynonymMap）
   *
   * @param traits 待审计的特征数组（CategorizedTrait[]，**会被原地修改** text 字段；
   *               L3 颜色拆分会 push 新 trait，调用方提取 text 时需遍历完整数组）
   * @param context AI 兜底上下文：
   *                - description（必填）：作为 LLM 生成候选词的语义参考
   *                - personality/scenario（可选）：补充上下文
   *                - characterCardId/includeImage（可选）：多模态图片输入（仅角色特征场景）
   * @param aiConfig AI 引擎配置（baseUrl/apiKey/apiKeyTransmission/engineSystemPrompt/modelName）
   * @param runtimeConfig 运行时参数（temperature/maxTokens）
   * @returns tagValidation 数组（含 isValid/canonicalName/replacedBy/source/aiFallback* 字段）
   */
  private async applyTagAudit(
    traits: CategorizedTrait[],
    context: {
      description: string;
      personality?: string;
      scenario?: string;
      characterCardId?: string;
      includeImage?: boolean;
    },
    aiConfig: {
      baseUrl: string;
      apiKey: string;
      apiKeyTransmission: string;
      engineSystemPrompt: string;
      modelName: string;
    },
    runtimeConfig: { temperature: number; maxTokens: number }
  ) {
    const tagTexts = traits.map((t) => t.text);
    // ⚠️ validateTagsAgainstLibrary 已改为 async（内部 ensureLoaded + suggestion 查询），必须 await
    const tagValidation = await tagRagService.validateTagsAgainstLibrary(tagTexts);

    // 【自动替换】三类场景将 trait.text 替换为库内标签，并记录 replacedBy 供前端展示替换关系 + 撤销：
    //  1. L3 颜色拆分（colorPartTag + feature 都命中）→ 一个 trait 拆成两个
    //  2. valid 但文本与标准名不同（如 slender→slim）→ 规范化为 canonicalName
    //  3. invalid 非评级词 tag，若 top1 suggestion.score >= REPLACE_MIN_SCORE → 语义替换
    let replacedCount = 0;
    let splitCount = 0;
    for (const v of tagValidation) {
      // 场景1：L3 颜色拆分
      if (v.splitTags) {
        const trait = traits.find((t) => t.text === v.tag);
        if (trait) {
          // 【Spec: optimize-trait-translation-and-temp-scheme】翻译继承：源标签翻译分配到两个子标签
          // （featureTag 与 colorPartTag 都继承源标签的 AI 翻译，并记录原始复合标签文本供 UI 展示拆分关系）
          const sourceTranslation = trait.translation;
          const sourceOriginalText = v.tag; // 原始复合标签文本
          // featureTag 继承翻译 + 记录原始标签
          trait.text = v.splitTags.featureTag;
          trait.translation = sourceTranslation; // 继承而非 undefined（保留 AI 原始翻译供用户参考）
          trait.originalText = sourceOriginalText;
          // 【Spec: add-sdxl-prompt-weight-support / Task 5.2】weight 重置：
          // 拆分后语义已变化（如 `light gray drooping ears` → `grey_ears` + `drooping_ears`），
          // 原权重针对复合概念，不适用于拆分后的单一子标签，故两个 trait weight 均重置为 undefined（等价 1.0）
          trait.weight = undefined;
          // colorPartTag 也继承翻译 + 记录原始标签
          traits.push({
            text: v.splitTags.colorPartTag,
            categoryId: trait.categoryId,
            translation: sourceTranslation, // 继承翻译
            originalText: sourceOriginalText, // 记录原始标签
            weight: undefined, // 重置（与 featureTag 一致，拆分后语义变化原权重不适用）
          });
          v.replacedBy = v.splitTags.featureTag;
          splitCount++;
        }
        continue;
      }
      // 场景2：valid + 文本与 canonicalName 不同 → 规范化
      if (v.isValid && v.canonicalName && v.tag !== v.canonicalName) {
        const trait = traits.find((t) => t.text === v.tag);
        if (trait) {
          v.replacedBy = v.canonicalName;
          // 【Spec: optimize-trait-translation-and-temp-scheme】翻译继承：规范化替换保留源标签翻译
          // （translation 已在 trait 上保持不变即可，无需清空，保留 AI 原始翻译供用户参考）
          // 【Spec: add-sdxl-prompt-weight-support / Task 5】weight 继承：
          // 规范化仅替换 text（如 slender→slim），语义未变，原 weight 保持不变（不写入即继承）
          trait.text = v.canonicalName;
          replacedCount++;
        }
        continue;
      }
      // 场景3：invalid 非评级词，有高相似度 suggestion → 语义替换
      if (v.isValid || v.skipReason === 'rating' || !v.suggestions || v.suggestions.length === 0) continue;
      const top1 = v.suggestions[0];
      if (top1.score < REPLACE_MIN_SCORE) continue;
      const trait = traits.find((t) => t.text === v.tag);
      if (trait) {
        v.replacedBy = top1.name;
        // 【Spec: optimize-trait-translation-and-temp-scheme】翻译继承：KNN 语义替换保留源标签翻译
        // （translation 保持不变，继承源标签的 AI 翻译，供用户参考）
        // 【Spec: add-sdxl-prompt-weight-support / Task 5.1】weight 继承：
        // L4 KNN 语义替换（如 slender→slim）保留源标签 weight，仅替换 text；
        // 用户对原 tag 设定的权重强度应传递到语义等价的库内标签，避免替换后权重丢失
        trait.text = top1.name;
        replacedCount++;
      }
    }
    if (splitCount > 0) {
      console.log(`[CharacterTraitAI] 标签纠错: 自动拆分 ${splitCount} 个颜色复合 tag`);
    }
    if (replacedCount > 0) {
      console.log(`[CharacterTraitAI] 标签纠错: 自动替换 ${replacedCount} 个 tag 为库内标签`);
    }

    // 【AI 兜底（L5）】L0-L4 全失败的最后防线
    const aiFallbackTargets = tagValidation.filter(
      (v) => !v.isValid && v.skipReason !== 'rating' && !v.replacedBy
    );
    if (aiFallbackTargets.length > 0 && aiFallbackTargets.length <= AI_FALLBACK_MAX_TAGS) {
      try {
        const unmatchedTags = aiFallbackTargets.map((v) => v.tag);
        console.log(
          `[CharacterTraitAI] AI 兜底: 处理 ${unmatchedTags.length} 个未匹配 tag:`,
          unmatchedTags
        );

        const candidatesMap = await this.generateTagSynonymsBatch(
          unmatchedTags,
          {
            characterCardId: context.characterCardId || '',
            description: context.description,
            personality: context.personality,
            scenario: context.scenario,
            includeImage: context.includeImage ?? false,
          },
          aiConfig,
          runtimeConfig
        );

        if (candidatesMap.size > 0) {
          const aiFallbackCount = await this.applyAiFallback(
            aiFallbackTargets,
            candidatesMap,
            traits
          );
          if (aiFallbackCount > 0) {
            console.log(
              `[CharacterTraitAI] AI 兜底: ${aiFallbackCount}/${aiFallbackTargets.length} 个未匹配 tag 命中候选词`
            );
          } else {
            console.log(
              `[CharacterTraitAI] AI 兜底: ${aiFallbackTargets.length} 个 tag 候选词全部未命中标签库`
            );
          }
        } else {
          for (const target of aiFallbackTargets) {
            target.aiFallbackAttempted = true;
          }
        }
      } catch (err) {
        console.warn('[CharacterTraitAI] AI 兜底异常，降级到手动替换入口:', err);
        for (const target of aiFallbackTargets) {
          target.aiFallbackAttempted = true;
        }
      }
    } else if (aiFallbackTargets.length > AI_FALLBACK_MAX_TAGS) {
      console.warn(
        `[CharacterTraitAI] AI 兜底跳过：未匹配 tag 数 ${aiFallbackTargets.length} 超过上限 ${AI_FALLBACK_MAX_TAGS}`
      );
    }

    return tagValidation;
  }

  /**
   * 通过多模态模型识别角色卡图片，提取视觉特征 tag 列表（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
   *
   * 与 generateCharacterTraits 的区别：
   *  - 输入是角色卡 PNG 图片（base64 data URI），而非文本描述
   *  - 需要模型支持视觉输入（supportsVision=true，由前端判断，本方法不重复检测）
   *  - 使用 IMAGE_TRAIT_SYSTEM_PROMPT（英文指令，覆盖范围更广）
   *  - user message 为多模态 content（text + image_url），复用 ChatMessage 联合类型（Task 1）
   *
   * 流程：
   *  1. 读取 AI 引擎配置（baseUrl / apiKey / modelName / apiKeyTransmission / systemPrompt）
   *  2. 读取引擎运行时参数 temperature / max_tokens（复用 getEngineRuntimeConfig，遵守禁止默认值规则）
   *  3. 读取角色卡 PNG 为 base64，构建 data URI
   *  4. 构建 system + 多模态 user 消息（ChatMessage[]，含 image_url）
   *  5. 非流式 POST /v1/chat/completions
   *  6. 解析 data.choices[0].message.content，复用 parseTraitsFromContent
   *
   * @param params 入参，详见 RecognizeImageTraitsParams
   * @returns 详见 GenerateCharacterTraitsResult（复用同一返回类型）
   */
  async recognizeImageTraits(
    params: RecognizeImageTraitsParams
  ): Promise<GenerateCharacterTraitsResult> {
    const { characterCardPath, characterName } = params;

    try {
      // 入参校验
      if (!characterCardPath) {
        return { success: false, error: 'characterCardPath 不能为空' };
      }

      // 1. 读取 AI 引擎配置
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 2. 配置兜底校验
      if (!baseUrl) {
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎未配置 baseUrl');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        // 【修复】本地引擎无需 api_key，空 key 合法（同 generateCharacterTraits 处理）
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎 apiKey 为空（本地引擎合法场景），继续调用');
      }
      if (!modelName) {
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎未配置 modelName');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }

      // 3. 读取引擎运行时参数（temperature / max_tokens）
      // 【项目最高优先级规则】禁止使用 AI 参数默认值，复用 getEngineRuntimeConfig
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 4. 读取角色卡 PNG 为 base64 data URI
      let dataUri: string;
      try {
        const imageBuffer = fsSync.readFileSync(characterCardPath);
        const base64 = imageBuffer.toString('base64');
        dataUri = `data:image/png;base64,${base64}`;
      } catch (readError) {
        console.error('[CharacterTraitAI] recognizeImageTraits: 读取角色卡图片失败:', readError);
        return {
          success: false,
          error: `读取角色卡图片失败：${readError instanceof Error ? readError.message : String(readError)}`,
        };
      }

      // 5. 构建 messages（多模态）
      // 注入引擎级 system prompt（与 generateCharacterTraits.enrichSystemPrompt 语义一致）
      //
      // 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5.3
      // 原直接使用硬编码的 IMAGE_TRAIT_SYSTEM_PROMPT，仅含 7 个系统分类，
      // 多模态模型同样无法识别用户自定义分类。现改为动态构建：
      // 从全局字典加载自定义分类 → 调用 buildDynamicImageTraitSystemPrompt 注入完整分类列表。
      const globalCategories = categoryDictionaryService.loadDictionary().categories;
      const dynamicImageSystemPrompt = this.buildDynamicImageTraitSystemPrompt(globalCategories);

      // 【RAG 标签库参考注入】Spec: rag-tag-library-for-ai-trait-generation / Task 9
      // 图片识别场景无文本描述，使用 characterName（或 'character' 兜底）作为查询文本。
      // 检索到的相关标签（如犬耳少女 → dog_girl / animal_ears）会引导 LLM 输出标签库内的有效 tag。
      // 降级保证：tagRag.enabled=false / 索引未就绪 / 检索失败 → 返回空字符串，不影响主流程
      const ragQueryText = characterName || 'character';
      const ragSection = await this.buildRagReferenceSection(ragQueryText);
      const dynamicImageSystemPromptWithRag = ragSection
        ? `${dynamicImageSystemPrompt}\n\n${ragSection}`
        : dynamicImageSystemPrompt;

      const systemContent = engineSystemPrompt && engineSystemPrompt.trim()
        ? `${engineSystemPrompt.trim()}\n\n${dynamicImageSystemPromptWithRag}`
        : dynamicImageSystemPromptWithRag;

      const userText = characterName
        ? `Analyze this character image of ${characterName} and extract visual feature tags.`
        : 'Analyze this character image and extract visual feature tags.';

      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ];

      // 6. 构建请求头与请求体
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          headers['Authorization'] = authValue;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[CharacterTraitAI] recognizeImageTraits: Calling multimodal LLM:', {
        baseUrl,
        modelName,
        apiKeyTransmission,
        temperature,
        maxTokens,
        characterCardPath,
        characterName,
      });

      // 7. 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[CharacterTraitAI] recognizeImageTraits: LLM request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        console.error('[CharacterTraitAI] recognizeImageTraits: LLM returned empty content:', data);
        return {
          success: false,
          error: 'AI 返回内容无法解析为 tag 列表',
        };
      }

      // 8. 解析响应：复用 parseTraitsAndDescription 提取 tag + 角色外观描述
      const { traits, appearanceDescription } = this.parseTraitsAndDescription(content);

      console.log('[CharacterTraitAI] recognizeImageTraits: Generated traits:', traits.length, 'tags for:', characterCardPath, 'hasDescription:', !!appearanceDescription);

      return { success: true, traits, appearanceDescription };
    } catch (error) {
      console.error('[CharacterTraitAI] recognizeImageTraits failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('fetch failed') || message.toLowerCase().includes('network')) {
        return {
          success: false,
          error: 'AI 调用失败：无法连接到 AI 服务，请检查网络或 API 地址',
        };
      }
      if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
        return {
          success: false,
          error: 'AI 调用失败：请求超时，请稍后重试',
        };
      }
      return {
        success: false,
        error: `AI 调用失败：${message}`,
      };
    }
  }

  /**
   * 读取激活引擎的 temperature / max_tokens 运行时配置。
   *
   * 【项目最高优先级规则】禁止使用 AI 参数默认值：
   * 任一字段缺失（或类型非 number）即返回 null，由调用方返回友好错误。
   * 与 WritingStyleLearningService.getTemperature / getMaxTokens 抛错语义一致，
   * 仅改为返回 null 以适配本 service「不抛异常」的错误兜底约定。
   *
   * @returns `{ temperature, maxTokens }` 或 null（任一字段缺失时）
   */
  private getEngineRuntimeConfig(): { temperature: number; maxTokens: number } | null {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      if (engines.length === 0) {
        return null;
      }
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
      const temperature = activeEngine?.temperature;
      const maxTokens = activeEngine?.max_tokens;
      if (typeof temperature !== 'number' || typeof maxTokens !== 'number') {
        return null;
      }
      return { temperature, maxTokens };
    } catch (error) {
      console.warn('[CharacterTraitAI] getEngineRuntimeConfig failed:', error);
      return null;
    }
  }

  /**
   * 构建 RAG 标签库参考段落（Spec: rag-tag-library-for-ai-trait-generation / Task 9）。
   *
   * 内部委托 tagRagService.buildRagReferenceSection：
   *  - settings.tagRag.enabled=false → 返回空字符串（完全跳过）
   *  - 索引未就绪 / 检索失败 / 维度不匹配 → 返回空字符串（降级，不阻塞 AI 生成）
   *  - 检索成功 → 返回格式化的「标签库参考」段落（含 top-K 相关标签）
   *
   * 调用方应将返回值追加到 system prompt 尾部，引导 LLM 优先使用标签库内的有效 tag。
   *
   * @param queryText 查询文本（角色描述 / 角色名 / 自然语言指令）
   * @returns RAG 参考段落字符串（可能为空）
   */
  private async buildRagReferenceSection(queryText: string): Promise<string> {
    try {
      if (!queryText || !queryText.trim()) return '';
      return await tagRagService.buildRagReferenceSection(queryText);
    } catch (err) {
      console.warn(
        '[CharacterTraitAI] buildRagReferenceSection 异常，跳过 RAG 注入:',
        err instanceof Error ? err.message : String(err)
      );
      return '';
    }
  }

  /**
   * 构建 RAG 参考段落 + 返回调试信息（质检报告用）。
   *
   * 与 `buildRagReferenceSection` 的区别：返回完整的调试上下文，
   * 供 `generateCharacterTraits` 在响应中携带 `ragDebug` 字段。
   */
  private async buildRagReferenceWithDebug(queryText: string): Promise<{
    prompt: string;
    enabled: boolean;
    status: string;
    retrievedTags: Array<{ name: string; category: number; count: number; score: number; aliases: string[] }>;
  }> {
    try {
      if (!queryText || !queryText.trim()) {
        return { prompt: '', enabled: false, status: 'empty_query', retrievedTags: [] };
      }
      return await tagRagService.buildRagReferenceWithDebug(queryText);
    } catch (err) {
      console.warn(
        '[CharacterTraitAI] buildRagReferenceWithDebug 异常，跳过 RAG 注入:',
        err instanceof Error ? err.message : String(err)
      );
      return { prompt: '', enabled: true, status: 'error', retrievedTags: [] };
    }
  }

  /**
   * 构建用户消息：拼接 description + personality + scenario。
   * 空字段不拼入，避免向 LLM 暴露空段落。
   */
  private buildUserMessage(
    description: string,
    personality?: string,
    scenario?: string
  ): string {
    const parts: string[] = [];
    parts.push(`角色描述：\n${description.trim()}`);
    if (personality && personality.trim()) {
      parts.push(`角色性格：\n${personality.trim()}`);
    }
    if (scenario && scenario.trim()) {
      parts.push(`角色场景：\n${scenario.trim()}`);
    }
    parts.push('请输出视觉特征 tag 列表：');
    return parts.join('\n\n');
  }

  /**
   * 构建服装状态识别指令块（Spec: add-costume-state-prompt-directives）。
   *
   * 与 interactionGuidance（互动元素识别）平行，引导 AI 根据对话上下文中的服装变化描述，
   * 生成 3 类 Danbooru 风格标签：开合状态 / 位置变化 / 身体部位暴露。
   *
   * 设计要点：
   *  - 条件触发：仅当对话上下文描述服装状态变化时才输出对应标签
   *  - 输出格式：使用 interaction 分类前缀（与互动标签一致，不新建分类）
   *  - 扩展接口：本方法为独立方法，后续可平行新增 buildPoseStateGuidance() 等方法
   *
   * @returns 服装状态识别指令块字符串
   */
  private buildCostumeStateGuidance(): string {
    return `【服装状态识别要求（重要）】
当对话上下文描述了角色服装的状态变化（如敞开衣物、拉到一边、掀起等）时，必须提取对应的 Danbooru 服装状态标签，使用 interaction 分类前缀输出。服装状态标签分三类：

■ 类型 A — 服装开合状态（衣物未移除但处于敞开/解开状态）：
- open_clothes（衣物敞开 — 通用开合状态）
- open_jacket（夹克敞开）/ open_shirt（衬衫敞开）/ open_coat（外套敞开）
- unbuttoned_shirt（未扣扣子的衬衫）/ unzipped（拉链拉开）/ zipper_open（拉链拉开）
- 命名规范：open_+ 服装名 / unbuttoned_+ 服装名 / unzipped

■ 类型 B — 服装位置变化（衣物未移除但被拉偏/掀起/移位）：
- panties_aside（内裤拉到一边）/ shorts_aside（短裤拉到一边）
- bra_lift（胸罩掀起）/ shirt_lift（衬衫掀起）/ skirt_lift（裙子掀起）
- shorts_around_one_leg（短裤只穿单腿）/ panties_around_one_ankle（内裤褪到一脚踝）
- clothes_pull（拉扯衣物）/ bottomless_spanked（裤子褪下）
- 命名规范：服装名_aside / 服装名_lift / 服装名_around_one_leg

■ 类型 C — 身体部位暴露（因开合或位移导致的暴露，需与 A/B 类配合使用）：
- one_breast_out（单侧乳房外露）/ both_breasts_out（双侧乳房外露）
- off_shoulder（露肩）/ bare_shoulders（裸露双肩）
- cleavage（乳沟）/ underboob（下乳）/ sideboob（侧乳）
- navel（肚脐）/ midriff（腰腹）— 因 shirt_lift/skirt_lift 导致的腰腹暴露
- 命名规范：身体部位_out / 身体部位暴露的 Danbooru 标准名

关键原则：
1. 服装状态标签描述的是「衣物仍在身上但状态改变」，区别于衣物完全移除（移除用 characterTraitStore 的 top/bottom/underwear 分类标签的删除来处理）
2. 开合/位移标签通常需要配合暴露标签使用：如 open_shirt → 配合 cleavage 或 one_breast_out；panties_aside → 配合 pussy；shirt_lift → 配合 navel 或 midriff
3. 仅当对话明确描述服装状态变化时才输出对应标签；角色穿着完整的描述不输出服装状态标签
4. 服装状态标签使用 interaction 分类前缀，如 interaction:open_clothes|衣物敞开, interaction:panties_aside|内裤拉到一边, interaction:one_breast_out|单侧乳房外露
5. 综合分析上下文中已有的服装类型（上衣/下装/内衣/配饰），确保服装状态标签与服装类型准确对应（如对话提到"夹克"则用 open_jacket 而非 open_shirt）`;
  }

  /**
   * 动态构建特征生成系统提示词（Spec: fix-asset-trait-and-scene-defects / Task 5）。
   *
   * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】
   * 原 `CHARACTER_TRAIT_SYSTEM_PROMPT` 硬编码 7 个系统分类，LLM 不知道用户创建的自定义分类
   * （如「纹身」「武器装备」），导致 AI 不会为这些分类生成 tag。
   * 本方法将系统分类 + 全局字典自定义分类合并为完整的分类列表，注入到提示词中。
   *
   * 设计要点：
   *  - 系统分类保留原 `CHARACTER_TRAIT_SYSTEM_PROMPT` 中的详细描述（物种/性别/发色等示例）
   *  - 自定义分类仅列出 `id：名称（自定义分类）`，因用户创建时未填写描述
   *  - 分类建议同步追加自定义分类的「名称 → id」映射，引导 LLM 将相关特征归入
   *  - 输出格式与原 prompt 完全一致（「分类:tag」列表 + `---DESCRIPTION---` + 中文描述）
   *
   * @param globalCategories 全局字典中的自定义分类（不含系统分类）
   * @returns 完整的系统提示词
   */
  private buildDynamicTraitSystemPrompt(globalCategories: TraitCategory[]): string {
    // 系统分类的详细描述（保留原 CHARACTER_TRAIT_SYSTEM_PROMPT 的细节）
    // 【重点标记 - 衣物分类拆分】原 `clothing` 已拆分为 top/bottom/accessories/underwear 四个细分类
    const systemCategoryDescriptions: Record<string, string> = {
      basic:
        '基本特征（种族/物种如 lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf；性别如 female, male, 1girl, 1boy；内容分级如 sfw, nsfw；以及其他描述角色基本属性的基底特征，作为整个角色的基底）',
      head: '头部特征（发色、发型、瞳色、动物耳朵、帽子、面部装饰等头部相关）',
      body: '身体特征（体型、肤色、毛色、尾巴、翅膀、身高等身体相关，不含物种与性别）',
      top: '上装（上衣、衬衫、外套、连衣裙、校服等上身衣物；dress/school uniform 等连体衣物归入上装）',
      bottom: '下装（裤子、裙子、短裤等下身衣物）',
      accessories: '配饰（眼镜、缎带、首饰、帽子、围巾等装饰物）',
      underwear: '内衣（胸罩、内裤、内衣套装等贴身衣物）',
      background: '背景环境（场景元素、背景物件）',
      pose: '人物姿势（身体姿态、动作）',
      expression: '人物表情（面部表情、情绪状态）',
      // 【Spec: enhance-conversation-interaction-prompt-recognition】
      // 互动元素分类：承载用户与角色之间的动作互动标签，含两种 Danbooru 模式：
      // A) POV 脱离身体风格（disembodied_hand / hand_on_breast / disembodied_tongue / licking）
      // B) 双角色互动风格（hugging_another / holding_hands / hand_on_another's_* / grabbing_another's_*）
      interaction:
        '互动元素（用户与角色之间的身体接触、肢体动作等交互场景，含两种模式：A) POV 脱离身体风格如 disembodied_hand / hand_on_breast / disembodied_tongue / licking；B) 双角色互动风格如 hugging_another / holding_hands / hand_on_another\'s_head / grabbing_another\'s_breast / sitting_on_another。用于引导 SD 生成包含交互性质的图片）',
    };

    // 合并系统分类 + 自定义分类
    const allCategories = [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories];

    // 构建分类列表文本：系统分类保留详细描述，自定义分类标注「自定义分类」
    const categoryLines = allCategories
      .map((c) => {
        if (c.isSystem) {
          return `- ${c.id}：${systemCategoryDescriptions[c.id] || c.name}`;
        }
        return `- ${c.id}：${c.name}（自定义分类）`;
      })
      .join('\n');

    // 构建分类建议文本：系统分类保留原示例，自定义分类追加「名称 → id」
    const systemGuidance = [
      '- 物种/种族（如 dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral）→ basic',
      '- 性别（如 female, male, 1girl, 1boy）→ basic',
      '- 内容分级（如 sfw, nsfw）→ basic',
      '- 毛色（如 white fur, black fur）→ body',
      '- 发色（如 black hair, blonde hair）→ head',
      '- 瞳色（如 blue eyes, red eyes）→ head',
      '- 上装（如 black shirt, school uniform, dress, coat）→ top',
      '- 下装（如 jeans, skirt, shorts, pants）→ bottom',
      '- 配饰（如 glasses, ribbon, hat, necklace）→ accessories',
      '- 内衣（如 bra, underwear, panties）→ underwear',
      '- 动物耳朵（如 animal ears, dog ears）→ head',
      '- 尾巴/翅膀（如 tail, wings）→ body',
      // 【Spec: enhance-conversation-interaction-prompt-recognition】互动元素 guidance
      '- 用户与角色的动作互动（触摸身体 → disembodied_hand + hand_on_breast/hand_on_butt/hand_on_hip/hand_on_leg；舔 → disembodied_tongue + licking/face_lick/breast_lick/foot_lick；亲吻 → kissing；拥抱 → hugging_another/hug；牵手 → holding_hands；手放在他人身上 → hand_on_another\'s_head/shoulder/face/cheek/chin/back/arm/chest/thigh/waist；抓握 → grabbing_another\'s_breast/ass/arm/hair；坐/抱 → sitting_on_another/carrying_another）→ interaction',
    ];
    const customGuidance = globalCategories.map((c) => `- ${c.name} → ${c.id}`);
    const categoryGuidance = [...systemGuidance, ...customGuidance].join('\n');

    // 【Spec: enhance-conversation-interaction-prompt-recognition】
    // 互动元素识别指令块：当对话上下文描述用户与角色的动作互动时，引导 AI 输出 Danbooru 风格互动标签。
    // 含两种模式：A) POV 脱离身体风格（disembodied_* + hand_on_* / *_lick）
    //             B) 双角色互动风格（*_another 系列，如 hugging_another / hand_on_another's_*）
    // 关键原则：互动元素独立于角色完整形象，允许不生成用户完整角色，仅添加 disembodied_* 标签。
    // 条件触发：仅当对话描述互动动作时输出，角色卡描述场景自然不触发（无互动描述则不输出）。
    const interactionGuidance = `【互动元素识别要求（重要）】
当对话上下文描述了用户与角色的动作互动（如"用手触摸她的身体"、"舔她的手"、"亲吻她"、"拥抱她"等）时，必须提取对应的 Danbooru 互动标签，使用 interaction 分类前缀输出。互动标签分两种模式：

■ 模式 A — POV/脱离身体风格（用户不完整出现在画面中，仅出现交互的身体部位）：
- 身体接触类（手触摸角色）：
  · disembodied_hand（脱离身体的手 — 表示画面中出现一只不属于任何完整角色的手）
  · 配合具体部位：hand_on_breast（手放在胸部）/ hand_on_butt（手放在臀部）/ hand_on_hip（手放在腰间）/ hand_on_leg（手放在腿上）/ hand_on_own_face 等
- 舔舐类（舌头接触角色）：
  · disembodied_tongue（脱离身体的舌头）
  · 配合具体部位：licking（舔）/ face_lick（舔脸）/ breast_lick（舔胸）/ foot_lick（舔脚）等
- 其他：disembodied_penis / disembodied_foot / disembodied_mouth 等脱离身体的部位

■ 模式 B — 双角色互动风格（用户作为"another"完整出现在画面中，与角色互动）：
- 拥抱/牵手：hugging_another（拥抱他人）/ hug / holding_hands（牵手）
- 手放在他人身上：hand_on_another's_head（手放在他人头上）/ hand_on_another's_shoulder（肩）/ hand_on_another's_face（脸）/ hand_on_another's_cheek（脸颊）/ hand_on_another's_chin（下巴）/ hand_on_another's_back（背）/ hand_on_another's_arm（手臂）/ hand_on_another's_chest（胸）/ hand_on_another's_thigh（腿）/ hand_on_another's_waist（腰）
- 抓握他人：grabbing_another's_breast（抓胸）/ grabbing_another's_ass（抓臀）/ grabbing_another's_arm（抓手臂）/ grabbing_another's_hair（抓头发）/ grabbing_another's_wrist（抓手腕）
- 持握他人：holding_another's_wrist（握手腕）/ holding_another's_hair（握头发）/ holding_another's_arm（握手臂）/ hand_in_another's_hair（手插入他人头发）
- 其他互动：sitting_on_another（坐在他人身上）/ carrying_another（抱着他人）/ facing_another（面向他人）/ smiling_at_another（对他人微笑）/ kissing（亲吻）

关键原则：
1. 互动元素独立于角色的完整形象 — 即使用户设定了完整形象，也必须添加 disembodied_* 标签（脱离身体的部位+动作），而非试图生成用户的完整角色
2. 互动标签必须成对出现：disembodied_hand 配合 hand_on_*，disembodied_tongue 配合 *_lick/licking_*
3. 仅当对话明确描述互动动作时才输出互动标签；角色独自站立/坐着的描述不输出互动标签
4. 互动标签使用 interaction 分类前缀，如 interaction:disembodied_hand|脱离身体的手, interaction:hand_on_breast|手放在胸部, interaction:hugging_another|拥抱他人
5. 根据对话语境选择模式：第一人称描述（"我用手触摸…"）倾向模式 A（disembodied_*）；第三人称或描述两个角色互动倾向模式 B（*_another）`;

    // 【Spec: add-costume-state-prompt-directives】
    // 服装状态识别指令块：与 interactionGuidance 平行，引导 AI 根据对话上下文中的服装变化
    // 生成 3 类标签（开合状态 / 位置变化 / 身体部位暴露）。
    // 扩展接口：后续可平行新增 buildPoseStateGuidance() 等方法，拼接到此处。
    const costumeStateGuidance = this.buildCostumeStateGuidance();

    return `你是一个角色视觉特征提取助手。请从给定的角色描述中提取角色的视觉外观特征，并为每个特征分配一个分类标签，输出为逗号分隔的「分类:tag|中文翻译」列表，用于 Stable Diffusion 图像生成，并同时输出一段中文角色外观描述。

分类体系（必须使用以下英文分类标签作为前缀，与「分类:tag|中文翻译」中的「分类」对应）：
${categoryLines}

分类建议（参考，按特征语义归入最合适的分类）：
${categoryGuidance}

${interactionGuidance}

${costumeStateGuidance}

要求：
1. 首先输出一行「分类:tag|中文翻译」列表，逗号分隔，每个 tag 前缀一个分类标签，格式为 \`分类:tag|中文翻译\`（如 \`basic:dog girl|犬耳少女, basic:female|女性, head:white hair|白发\`）。其中 \`|\` 后是该 tag 的简短中文翻译（2-8 个字，如「白发」「蓝眼睛」「黑色衬衫」），每条 tag 必须带翻译。不要编号、不要自然语言句子、不要解释
2. 然后输出一行 "---DESCRIPTION---" 作为分隔符
3. 最后输出一段中文角色外观描述（2-4 句话），描述角色的整体视觉外观，包括物种、性别、体型、发色发型、瞳色、服饰、配饰等
4. 可选权重段（Spec: add-sdxl-prompt-weight-support）：每条 tag 可在翻译后追加第三个 \`|\` 分隔的权重段，格式为 \`分类:tag|中文翻译|权重\`：
   - 权重段可选，不写则默认 1.0（不加权）
   - 范围 0.1-10.0（保留 1 位小数，如 0.5 / 1.3 / 2.0）
   - 用途：用于 SDXL 提示词加权/弱化（如强化 \`head:blue_eyes|蓝眼睛|1.5\` 让蓝色眼睛更突出，弱化 \`background:simple_background|简洁背景|0.5\` 让背景更简洁）
   - 仅在用户描述明确强调某特征强度时才输出权重（如「非常蓝的眼睛」→ 1.3，「淡淡的微笑」→ 0.7），常规特征不需要输出权重段
   - 1.0 时省略权重段以保持输出简洁（不要输出 \`|1.0\`）
5. 输出示例：
basic:dog girl|犬耳少女, basic:female|女性, head:white hair|白发, head:blue eyes|蓝眼睛|1.3, body:white fur|白色毛发, top:black shirt|黑色衬衫, accessories:glasses|眼镜, head:animal ears|动物耳朵
---DESCRIPTION---
一位犬耳少女，拥有洁白的毛发和蓝色的眼睛。身穿黑色衬衫，戴着眼镜，头上有一对毛茸茸的犬耳。体型娇小，整体风格偏可爱。`;
  }

  /**
   * 动态构建图片识别系统提示词（Spec: fix-asset-trait-and-scene-defects / Task 5）。
   *
   * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】
   * 与 `buildDynamicTraitSystemPrompt` 对应的英文版本，面向多模态视觉模型。
   * 原 `IMAGE_TRAIT_SYSTEM_PROMPT` 同样硬编码 7 个系统分类，本方法将其改为动态构建。
   *
   * 设计要点：
   *  - 系统分类保留原 `IMAGE_TRAIT_SYSTEM_PROMPT` 中的英文详细描述
   *  - 自定义分类标注 `(custom category)`，与中文版的「（自定义分类）」对应
   *  - 分类建议同步追加自定义分类的「名称 → id」映射
   *  - 输出格式与原 prompt 完全一致
   *
   * @param globalCategories 全局字典中的自定义分类（不含系统分类）
   * @returns 完整的系统提示词（英文指令 + 中文描述输出要求）
   */
  private buildDynamicImageTraitSystemPrompt(globalCategories: TraitCategory[]): string {
    // 系统分类的详细描述（保留原 IMAGE_TRAIT_SYSTEM_PROMPT 的细节）
    // 【重点标记 - 衣物分类拆分】原 `clothing` 已拆分为 top/bottom/accessories/underwear 四个细分类
    const systemCategoryDescriptions: Record<string, string> = {
      basic:
        'species/race (e.g. lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf), gender (e.g. female, male, 1girl, 1boy), content rating (e.g. sfw, nsfw), and other foundational character attributes',
      head: 'hair color, hair style, eye color, animal ears, hat, facial decorations',
      body: 'body type, skin tone, fur color, tail, wings, height (excluding species and gender)',
      top: 'upper-body clothes (e.g. shirt, coat, dress, school uniform; one-piece garments like dress/school uniform go to top)',
      bottom: 'lower-body clothes (e.g. jeans, skirt, shorts, pants)',
      accessories: 'decorations (e.g. glasses, ribbon, hat, necklace, jewelry)',
      underwear: 'undergarments (e.g. bra, underwear, panties)',
      background: 'scene elements, background objects',
      pose: 'body posture, action',
      expression: 'facial expression, emotion',
      // 【Spec: enhance-conversation-interaction-prompt-recognition】
      // 互动元素分类：图片识别场景通常只分析单一角色卡，互动标签（disembodied_* / *_another）
      // 依赖对话上下文，一般不从静态角色卡图片提取。此处补充英文描述以保持 prompt 一致性
      // （SYSTEM_TRAIT_CATEGORIES 已包含 interaction，缺失描述会回退为中文名「互动元素」破坏英文 prompt）。
      interaction:
        "interaction elements between user and character (e.g. disembodied_hand, hand_on_breast, hugging_another, holding_hands; typically NOT extracted from a single character card image, only triggered by conversation context describing physical interactions)",
    };

    // 合并系统分类 + 自定义分类
    const allCategories = [...SYSTEM_TRAIT_CATEGORIES, ...globalCategories];

    // 构建分类列表文本
    const categoryLines = allCategories
      .map((c) => {
        if (c.isSystem) {
          return `- ${c.id}: ${systemCategoryDescriptions[c.id] || c.name}`;
        }
        return `- ${c.id}: ${c.name} (custom category)`;
      })
      .join('\n');

    // 构建分类建议文本
    const systemGuidance = [
      '- Species/race (e.g. dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral) → basic',
      '- Gender (e.g. female, male, 1girl, 1boy) → basic',
      '- Content rating (e.g. sfw, nsfw) → basic',
      '- Fur color (e.g. white fur, black fur) → body',
      '- Hair color (e.g. black hair, blonde hair) → head',
      '- Eye color (e.g. blue eyes, red eyes) → head',
      '- Upper-body clothes (e.g. black shirt, school uniform, dress, coat) → top',
      '- Lower-body clothes (e.g. jeans, skirt, shorts, pants) → bottom',
      '- Accessories (e.g. glasses, ribbon, hat, necklace) → accessories',
      '- Underwear (e.g. bra, underwear, panties) → underwear',
      '- Animal ears (e.g. animal ears, dog ears) → head',
      '- Tail/wings (e.g. tail, wings) → body',
      // 【Spec: enhance-conversation-interaction-prompt-recognition】互动元素 guidance（图片识别场景一般不触发）
      "- Interaction between user and character (disembodied_hand + hand_on_*, disembodied_tongue + *_lick, hugging_another, holding_hands, hand_on_another's_*, grabbing_another's_*) → interaction (typically NOT applicable to single character image analysis)",
    ];
    const customGuidance = globalCategories.map((c) => `- ${c.name} → ${c.id}`);
    const categoryGuidance = [...systemGuidance, ...customGuidance].join('\n');

    return `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated "category:tag|chinese_translation" pairs for Stable Diffusion. Each tag MUST be prefixed with one of these category labels, and followed by a short Chinese translation after a pipe ("|") separator:
${categoryLines}

Category guidance:
${categoryGuidance}

Output format requirements:
1. First, output ONE line of "category:tag|chinese_translation" pairs separated by commas, no numbering, no explanations. The Chinese translation after "|" should be a short translation of the tag (2-8 Chinese characters, e.g. "白发", "蓝眼睛", "黑色衬衫"). Every tag MUST come with a translation. Example: basic:cat girl|猫耳少女, basic:female|女性, head:white hair|白发, head:red eyes|红眼睛, top:school uniform|学校制服, head:cat ears|猫耳
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including species, gender, body type, hair color/style, eye color, clothing, accessories, etc.
4. Optional weight segment (Spec: add-sdxl-prompt-weight-support): each tag MAY append a third "|"-separated weight segment after the translation, in the format "category:tag|chinese_translation|weight":
   - The weight segment is OPTIONAL; omit it to use the default 1.0 (no weighting)
   - Range: 0.1-10.0 (one decimal place, e.g. 0.5 / 1.3 / 2.0)
   - Purpose: SDXL prompt weight strengthening/weakening (e.g. strengthen \`head:blue_eyes|蓝眼睛|1.5\` to make blue eyes more prominent, weaken \`background:simple_background|简洁背景|0.5\` to make the background simpler)
   - Only output a weight when the user description explicitly emphasizes a feature's intensity (e.g. "very blue eyes" → 1.3, "faint smile" → 0.7). Do NOT output a weight segment for ordinary features
   - When the weight is 1.0, omit the weight segment to keep the output concise (do NOT output "|1.0")

Output example:
basic:cat girl|猫耳少女, basic:female|女性, head:white hair|白发, head:red eyes|红眼睛|1.3, top:school uniform|学校制服, head:cat ears|猫耳
---DESCRIPTION---
一位猫耳少女，拥有白色长发和红色的眼睛。身穿学校制服，头上有一对白色的猫耳。体型纤细，整体风格偏清纯。`;
  }

  /**
   * 将引擎级 system prompt 注入到首个 system message 前面。
   * 与 OutlineGenerator.enrichSystemPrompt / AIService.enrichSystemPrompt 行为一致。
   *
   * 【重点标记 - 多模态兼容】content 类型扩展为联合类型以支持多模态消息。
   * 经审计验证：所有调用方（generateCharacterTraits）构建的首条 system message 的 content
   * 始终为 string（CHARACTER_TRAIT_SYSTEM_PROMPT 或其字符串拼接），
   * 多模态 image_url 数组仅出现在 user message 中，因此 index===0 分支的字符串拼接逻辑安全、不受影响。
   * recognizeImageTraits 路径不经过此方法（system prompt 在调用前已内联拼接为字符串）。
   */
  private enrichSystemPrompt(
    messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>,
    engineSystemPrompt: string
  ): Array<{ role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }> {
    if (!engineSystemPrompt || !engineSystemPrompt.trim()) {
      return messages;
    }
    return messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        return {
          role: 'system' as const,
          content: engineSystemPrompt.trim() + '\n\n' + msg.content,
        };
      }
      return msg;
    });
  }

  /**
   * 解析 LLM 返回内容为 tag 数组 + 角色外观描述。
   *
   * 内容结构：tag 行 + "---DESCRIPTION---" 分隔符 + 中文描述段落。
   * - 若存在分隔符：分隔符之前按 tag 解析，分隔符之后为描述（trim）
   * - 若不存在分隔符：整体按 tag 解析，描述为空串（向后兼容旧模型输出）
   *
   * @returns `{ traits, appearanceDescription }`
   */
  private parseTraitsAndDescription(content: string): { traits: CategorizedTrait[]; appearanceDescription: string } {
    const separator = '---DESCRIPTION---';
    const parts = content.split(separator);
    const tagContent = parts[0] || content;
    const descContent = parts.length > 1 ? parts.slice(1).join(separator).trim() : '';
    const traits = this.parseTraitsFromContent(tagContent);
    return { traits, appearanceDescription: descContent };
  }

  /**
   * 解析 LLM 返回内容为「带分类」特征项数组。
   *
   * 处理步骤：
   *  1. 按逗号 / 换行 / 分号切分（兼容中英文标点）
   *  2. trim 每项
   *  3. 过滤空字符串
   *  4. 移除可能的前缀编号（如 "1. " / "- " / "* "）
   *  5. 解析「分类:tag」前缀：仅在 prefix 为已知系统分类 id 时剥离，否则视为无分类（兜底 uncategorized）
   *  6. 解析 `|中文翻译` 与可选 `|权重` 段（Spec: add-sdxl-prompt-weight-support / Task 4.2）
   *     - 格式 `分类:tag|中文翻译|权重`（权重段可选，不写则默认 undefined 等价 1.0）
   *     - 权重解析为浮点数，范围 0.1-10.0，保留 1 位小数，越界/非数值兜底 undefined
   *  7. 去重（按 text 文本，大小写敏感），保留首次出现的顺序与分类
   *
   * 鲁棒性：
   *  - LLM 偶尔会输出多行（每行一个 tag 或一段含逗号的句子），统一按逗号 + 换行切分
   *  - LLM 偶尔会输出编号列表，移除前缀
   *  - LLM 偶尔会输出尾部的句号/分号，trim 掉
   *  - LLM 未输出分类前缀时，整条 tag 作为 text、categoryId 兜底为 uncategorized
   *  - LLM 输出未知分类前缀（如 typo）时，整条 tag 作为 text、categoryId 兜底为 uncategorized
   *  - SD tag 内权重冒号（如 "(white hair:1.3)"）不会被误剥离，因为前缀 "(" 不是已知系统分类
   *  - 旧格式 `分类:tag|中文翻译`（无权重段）解析为 weight=undefined，等价 1.0
   *  - 旧格式 `分类:tag`（无翻译无权重）解析为 translation/weight 均为 undefined
   *
   * 【重点标记 - Bug 修复：tag 数量不符】
   * 原去重键为 `${categoryId}::${text}`（组合键），当 LLM 将同一 tag 归入不同分类时
   * （如 `basic:white fur` 与 `body:white fur`），两条均保留，导致下游 store 出现
   * 同一 text 的重复项，最终 SD 提示词中出现重复 tag。
   * 现改为仅按 `text` 去重，保留首次出现的分类，与 SD tag 语义一致（同一 tag 只应出现一次）。
   *
   * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5.4
   * 原 `validCategoryIds` 仅含 7 个系统分类 id，导致 LLM 返回 `tattoo:dragon tattoo` 等
   * 自定义分类前缀时被误判为「未知前缀」，整条 tag 兜底为 uncategorized，
   * 与 generateCharacterTraits / recognizeImageTraits 注入自定义分类到 prompt 的修复不匹配。
   * 现同步从全局字典加载自定义分类 id，使其成为合法前缀，确保 `tattoo:dragon tattoo` 能被
   * 正确解析为 `{ text: 'dragon tattoo', categoryId: 'tattoo' }`。
   */
  private parseTraitsFromContent(content: string): CategorizedTrait[] {
    // 合法分类 id 集合：系统分类 + 全局字典自定义分类
    const globalCategories = categoryDictionaryService.loadDictionary().categories;
    const validCategoryIds = new Set([
      ...SYSTEM_TRAIT_CATEGORIES.map((c) => c.id),
      ...globalCategories.map((c) => c.id),
    ]);

    // 同时按英文逗号、中文逗号、换行、分号切分
    const tokens = content.split(/[,，\n;；]+/);
    const seen = new Set<string>();
    const result: CategorizedTrait[] = [];
    let duplicateCount = 0;
    for (let raw of tokens) {
      let tag = raw.trim();
      if (!tag) continue;
      // 移除前缀编号：如 "1. " / "1) " / "- " / "* " / "1、"
      tag = tag.replace(/^[\d]+[.)、]\s*/, '').replace(/^[-*]\s*/, '');
      // 移除尾部句号（注意：不再统一移除尾部冒号，避免破坏「分类:tag」前缀；
      // 仅移除尾部多余句号，分号已在切分阶段处理）
      tag = tag.replace(/[.。]+$/, '').trim();
      if (!tag) continue;

      // 【Spec: add-ai-tag-chinese-translation / Task 2.4】解析 `|中文翻译` 后缀：
      // - 按第一个 `|` 切分：`|` 前是 `分类:tag`，`|` 后是中文翻译（trim）
      // - 无 `|` 时 translation=undefined（兼容旧格式 LLM 输出）
      // - `|` 在行首（`|xxx`）视为无 tag → 跳过
      //
      // 【Spec: add-sdxl-prompt-weight-support / Task 4.2】扩展为 3 段切分 `分类:tag|中文翻译|权重`：
      // - 第一个 `|` 之前是 `分类:tag`，第一个 `|` 与第二个 `|` 之间是中文翻译，
      //   第二个 `|` 之后是权重段（可选）
      // - 无 `|` 时 translation/weight 均为 undefined（兼容旧格式 LLM 输出）
      // - 仅一个 `|` 时只有 translation、weight=undefined（兼容 Task 2.4 旧格式）
      // - 权重段解析：parseFloat，范围 0.1-10.0，越界/非数值时兜底 undefined（等价 1.0）
      // - 保留 1 位小数（Math.round(w * 10) / 10）
      // - `|` 在行首（`|xxx`）视为无 tag → 跳过
      let translation: string | undefined;
      let weight: number | undefined;
      const firstPipeIdx = tag.indexOf('|');
      if (firstPipeIdx >= 0) {
        const afterFirstPipe = tag.substring(firstPipeIdx + 1);
        tag = tag.substring(0, firstPipeIdx).trim();
        if (!tag) continue; // `|xxx` 形式无 tag → 跳过
        // 查找第二个 `|`，分离翻译与权重段
        const secondPipeIdx = afterFirstPipe.indexOf('|');
        if (secondPipeIdx >= 0) {
          translation = afterFirstPipe.substring(0, secondPipeIdx).trim();
          const weightStr = afterFirstPipe.substring(secondPipeIdx + 1).trim();
          // 解析权重（范围 0.1-10.0，保留 1 位小数，越界/非数值兜底 undefined）
          const w = parseFloat(weightStr);
          if (!isNaN(w) && w >= 0.1 && w <= 10.0) {
            weight = Math.round(w * 10) / 10;
          }
          // weightStr 无效时 weight 保持 undefined（与默认 1.0 等价，不报错）
        } else {
          // 仅有翻译段，无权重段（旧格式兼容）
          translation = afterFirstPipe.trim();
        }
        if (!translation) translation = undefined; // 空翻译视为 undefined
      }

      // 解析「category:tag」前缀格式
      let categoryId: string = UNCATEGORIZED_CATEGORY_ID;
      let text: string = tag;
      const colonIndex = tag.indexOf(':');
      if (colonIndex > 0) {
        const prefix = tag.substring(0, colonIndex).trim().toLowerCase();
        const remainder = tag.substring(colonIndex + 1).trim();
        // 仅当 prefix 是已知系统分类时才剥离，避免误剥离 SD tag 内的权重冒号（如 "(white hair:1.3)"）
        if (validCategoryIds.has(prefix) && remainder.length > 0) {
          categoryId = prefix;
          text = remainder;
        }
      }
      if (!text) continue;

      // 去重（按 text 文本，大小写敏感，与 SD 提示词语义一致）
      // 【Bug 修复】原为 `${categoryId}::${text}` 组合键，现改为仅 text，避免同 tag 跨分类重复
      if (seen.has(text)) {
        duplicateCount++;
        continue;
      }
      seen.add(text);
      result.push({ text, categoryId, translation, weight });
    }
    if (duplicateCount > 0) {
      console.log(
        '[CharacterTraitAI] parseTraitsFromContent: 去重移除',
        duplicateCount,
        '条同文本跨分类重复 tag，保留',
        result.length,
        '条唯一 tag',
      );
    }
    return result;
  }

  /**
   * 提示词生成：将用户自由文本提示词解析为分类 SD tag（Spec: add-prompt-generation-in-asset-modal）。
   *
   * 与 `generateCharacterTraits` 的区别：
   *  - 不需要 `characterCardId`（不读取角色卡图片）
   *  - 输入是用户自由文本提示词（如 "red hair, blue dress, forest background"），不是角色卡字段
   *  - 不生成 `appearanceDescription`（用户只需要 tag，不需要外观描述）
   *  - 复用 `buildDynamicTraitSystemPrompt` + `applyTagAudit` + RAG 基础设施
   *
   * 审计流程与 generateCharacterTraits 完全一致（L0-L5 完整审计链）：
   *  - validateTagsAgainstLibrary 验证每条 tag
   *  - 自动替换无效 tag（L3 颜色拆分 / L2-L3 规范化 / L4 KNN 语义替换）
   *  - AI 兜底（L5：LLM 生成候选词 → 再走 L0-L4 → 命中替换 + 持久化）
   *
   * @param params 入参，详见 GenerateTraitPromptsParams
   * @returns 详见 GenerateTraitPromptsResult
   */
  async generateTraitPrompts(
    params: GenerateTraitPromptsParams
  ): Promise<GenerateTraitPromptsResult> {
    const { prompt, baseTraits } = params;

    try {
      // 1. 入参校验
      if (!prompt || !prompt.trim()) {
        return { success: false, error: '请输入提示词' };
      }

      // 2. 读取 AI 引擎配置（与 generateCharacterTraits 一致）
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 3. 配置兜底校验
      // 【修复】apiKey 可空（本地 llama-server 等引擎无需密钥，对话链路同语义）；
      // 远程服务缺 key 由 HTTP 401 报错，空 key 不发送 Authorization（见下方 header 守卫）
      if (!baseUrl || !modelName) {
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        console.warn('[TraitPromptAI] AI 引擎 apiKey 为空（本地引擎合法场景），继续调用');
      }

      // 4. 读取引擎运行时参数
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 5. 构建 system prompt（复用 buildDynamicTraitSystemPrompt，含系统分类 + 自定义分类）
      const globalCategories = categoryDictionaryService.loadDictionary().categories;
      const dynamicSystemPrompt = this.buildDynamicTraitSystemPrompt(globalCategories);

      // 6. RAG 标签库参考注入
      const ragDebugInfo = await this.buildRagReferenceWithDebug(prompt);
      const ragSection = ragDebugInfo.prompt;
      const systemPromptWithRag = ragSection
        ? `${dynamicSystemPrompt}\n\n${ragSection}`
        : dynamicSystemPrompt;

      // 【Spec: add-costume-state-prompt-directives】
      // 服装状态 RAG 检索：用服装状态关键词额外检索 RAG 标签库，
      // 将检索到的服装状态相关标签注入 system prompt 作为参考。
      // RAG 未启用/检索失败时静默跳过，不影响主流程。
      const costumeRagDebugInfo = await this.buildRagReferenceWithDebug(
        CharacterTraitAIService.COSTUME_STATE_RAG_KEYWORDS
      );
      const costumeRagSection = costumeRagDebugInfo.prompt;
      const systemPromptWithAllRag = costumeRagSection
        ? `${systemPromptWithRag}\n\n## 服装状态标签参考\n${costumeRagSection}`
        : systemPromptWithRag;

      // 7. 构建 user message
      const userMessage = this.buildTraitPromptUserMessage(prompt, baseTraits);

      // 8. 构建 messages + 注入引擎级 system prompt
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'system', content: systemPromptWithAllRag },
        { role: 'user', content: userMessage },
      ];
      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 9. 构建请求 + 调用 LLM
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      // 【修复】空 apiKey（本地引擎）时不发送 Authorization / api_key 字段，
      // 与 generateCharacterTraits 的 if (apiKey) 守卫对齐，避免 "Bearer " 空头
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          headers['Authorization'] = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[TraitPromptAI] Calling LLM for prompt generation:', {
        baseUrl,
        modelName,
        promptLength: prompt.length,
        hasBaseTraits: !!baseTraits,
      });

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[TraitPromptAI] LLM request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        return { success: false, error: 'AI 返回内容无法解析为 tag 列表' };
      }

      // 10. 解析响应：提取分类特征 tag（忽略 appearanceDescription）
      const { traits } = this.parseTraitsAndDescription(content);

      console.log('[TraitPromptAI] Generated traits:', traits.length, 'tags from prompt');

      // 11. L0-L5 完整审计链（复用 applyTagAudit）
      const tagValidation = await this.applyTagAudit(
        traits,
        { description: prompt, personality: baseTraits },
        { baseUrl, apiKey, apiKeyTransmission, engineSystemPrompt, modelName },
        { temperature, maxTokens }
      );

      return {
        success: true,
        traits,
        ragDebug: {
          enabled: ragDebugInfo.enabled,
          status: ragDebugInfo.status,
          retrievedTags: ragDebugInfo.retrievedTags.map((t) => ({
            name: t.name,
            category: t.category,
            count: t.count,
            score: t.score,
          })),
          tagValidation,
        },
      };
    } catch (error) {
      console.error('[TraitPromptAI] generateTraitPrompts failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
        return { success: false, error: 'AI 调用失败：请求超时，请稍后重试' };
      }
      return { success: false, error: `AI 调用失败：${message}` };
    }
  }

  /**
   * AI 标签优化：根据对话上下文分析角色特征标签的矛盾关系，返回应删除的标签列表 + 删除后应补充的标签列表。
   *
   * Spec: add-ai-trait-optimization-for-image-gen
   * Spec: add-ai-tag-supplement-after-removal（Task 2：prompt 重构为 TWO PARTS + 解析器升级）
   *
   * 流程：
   *  1. 读取 AI 引擎配置（与 generateTraitPrompts 一致）
   *  2. 校验 baseUrl / apiKey / modelName / temperature / max_tokens
   *  3. 构建 system prompt（TWO PARTS：PART 1 - REMOVAL 矛盾识别 + PART 2 - SUPPLEMENT 缺失补充）
   *  4. 构建 user message（对话上下文 + 当前标签列表 + 两部分任务描述）
   *  5. 非流式 POST /v1/chat/completions
   *  6. 解析 JSON 响应 `{ "remove": [{ "text", "reason" }], "add": [{ "text", "reason", "weight"?, "categoryId"? }] }`
   *  7. 返回 tagsToRemove + tagsToAdd 两个数组
   *
   * @param params 入参，详见 OptimizeTraitsParams
   * @returns 详见 OptimizeTraitsResult
   */
  async optimizeTraitsForContext(
    params: OptimizeTraitsParams
  ): Promise<OptimizeTraitsResult> {
    const { traits, conversationContext } = params;

    try {
      // 1. 入参校验
      if (!conversationContext || !conversationContext.trim()) {
        return { success: false, error: '对话上下文为空' };
      }
      if (!traits || traits.length === 0) {
        return { success: true, tagsToRemove: [] };
      }

      // 2. 读取 AI 引擎配置（与 generateTraitPrompts 一致）
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 3. 配置兜底校验
      // 【修复】apiKey 可空（本地引擎合法场景，同 generateTraitPrompts）
      if (!baseUrl || !modelName) {
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
      }
      if (!apiKey) {
        console.warn('[TraitOptimizeAI] AI 引擎 apiKey 为空（本地引擎合法场景），继续调用');
      }

      // 4. 读取引擎运行时参数
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return {
          success: false,
          error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎',
        };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 5. 构建 system prompt
      // 【Spec: add-ai-tag-supplement-after-removal / Task 2】prompt 重构为 TWO PARTS：
      //  PART 1 - REMOVAL：识别与对话上下文矛盾的标签（保留原矛盾模式列表 + Interaction withdrawal）
      //  PART 2 - SUPPLEMENT：删除后评估缺失的关键描述符并补充（如服装移除后的暴露特征）
      const systemPrompt = `You are an expert at analyzing character trait tags for image generation.

Your task has TWO PARTS:

PART 1 - REMOVAL: Identify tags that CONTRADICT the conversation context and should be removed.

Given a list of image generation tags (including character traits AND dynamically generated context tags like interaction tags) and a conversation context, identify which tags CONTRADICT the current conversation context and should be removed before generating an image.

The tag list may include:
- Character trait tags: fixed attributes like "pants", "sitting", "hat", "blonde_hair"
- Context/interaction tags: dynamically generated based on conversation, e.g. "disembodied_hand" (a third-party hand in scene), "hand_on_vulva", "holding_hands", "hugging_another", "hand_on_another"

Common contradiction patterns:
- Clothing removal: If the conversation says the character "took off pants" or "removed skirt" (脱下/脱掉), the corresponding clothing tag should be removed.
- Pose change: If the conversation says the character "stood up", "sat down", or "lay down" (站起来/坐下/躺下), the old pose tag (e.g., "sitting", "standing") should be removed if it contradicts the new pose.
- Location change: If the conversation says the character "left the room" or "went outside" (离开/出去), location-specific tags may need removal.
- State change: If the conversation describes a state change (e.g., "closed eyes", "fell asleep" 闭眼/睡着), contradictory state tags should be removed.
- Clothing opening/closing change: If the conversation says the character "buttoned up", "zipped up", "closed" clothing (扣上/拉上拉链/合上/穿好), remove opening state tags like "open_clothes", "open_jacket", "open_shirt", "unbuttoned_shirt", "unzipped", "zipper_open".
- Clothing position reset: If the conversation says the character "adjusted", "fixed", "put back" clothing (整理/穿好/复位/拉回), remove displacement state tags like "panties_aside", "shorts_aside", "bra_lift", "shirt_lift", "skirt_lift", "shorts_around_one_leg".
- Interaction withdrawal (IMPORTANT): If the conversation describes the character WITHDRAWING or PULLING BACK physical contact — e.g., "抽回手", "缩回手", "withdraw hand", "pulled back", "let go", "released", "推开", "shoved away" — you MUST remove interaction tags that imply ongoing physical contact:
  * "disembodied_hand" / "hand_on_vulva" / "hand_on_breast" / "hand_on_penis" → remove if a hand was withdrawn
  * "holding_hands" → remove if hands were released
  * "hugging_another" / "hugging" → remove if the characters separated
  * "hand_on_another" / "hand_on_head" → remove if the hand was pulled back
  Any tag starting with "disembodied_" or containing "_another" or "hand_on_" implies physical contact that may have ended.

PART 2 - SUPPLEMENT: After identifying removals, evaluate the current visual state and identify any CRITICAL descriptors that are now MISSING and should be added.

Common supplement patterns:
- Exposure after clothing removal: If "pants" is removed and the character's lower body is now exposed, add "pussy" if not already present. If "bra" is removed and breasts are now exposed, add "breasts". If "covered_pussy" is removed, add "pussy".
- Pose transition: If "sitting" is removed because the character stood up, add "standing" if not already present.
- State transition: If "closed_eyes" is removed because the character opened eyes, add "open_eyes" if applicable.
- Opening → exposure: If "open_shirt" or "open_jacket" is present and the character's chest is visible, add "cleavage" or "one_breast_out" (judge single vs. both based on context). If "open_clothes" is present, add the appropriate exposure tag based on what's visible.
- Displacement → exposure: If "panties_aside" is present and not already covered, add "pussy". If "bra_lift" is present, add "breasts" or "one_breast_out".
- Displacement → body part: If "shirt_lift" or "skirt_lift" is present, add "navel" or "midriff" (exposed midriff area). If "shorts_around_one_leg" is present, add "one_leg_out" if applicable.
- Only add tags that are NECESSARY to maintain description accuracy. Do not add tags that are already present.
- Use standard Danbooru/e621 tag names (e.g., "pussy", "breasts", "standing", "nude").

IMPORTANT RULES:
1. Only suggest removing tags that DIRECTLY CONTRADICT the conversation context.
2. Do NOT remove tags that are still applicable or ambiguous.
3. Do NOT remove tags if the conversation doesn't explicitly describe a change.
4. If no tags need removal, return an empty array.
5. Be CONSERVATIVE — when in doubt, do not remove.
6. Pay special attention to interaction tags (disembodied_*, hand_on_*, *_another, holding_*) — these are easily outdated when the conversation moves past the interaction.
7. For the "add" list: only suggest tags that are NOT already in the tag list, and do NOT suggest adding tags that you also suggested removing.

Return your analysis as JSON in this exact format:
\`\`\`json
{
  "remove": [
    { "text": "pants", "reason": "对话中角色脱下了裤子" },
    { "text": "open_shirt", "reason": "对话中角色扣上了衬衫扣子，不再敞开" }
  ],
  "add": [
    { "text": "pussy", "reason": "裤子移除后下身暴露，需要补充暴露特征标签" },
    { "text": "cleavage", "reason": "open_jacket 存在但缺少胸部暴露特征标签" }
  ]
}
\`\`\`

If no tags need removal or supplement, return: \`{ "remove": [], "add": [] }\`

Return ONLY the JSON, no other text.`;

      // 6. 构建 user message
      // 【Spec: add-ai-tag-supplement-after-removal / Task 2】任务描述更新为两部分：
      //  (1) 找出矛盾应删除的标签（含互动标签 withdrawal 识别）
      //  (2) 评估删除后是否有关键特征缺失需要补充（如服装移除后的暴露特征标签）
      const traitsList = traits.map(t => `- ${t.text}`).join('\n');
      const userMessage = `## 当前图片生成标签列表（含角色特征 + 上下文互动标签）
${traitsList}

## 对话上下文
${conversationContext}

## 任务
分析以上对话上下文，完成两部分任务：(1) 找出与当前场景矛盾、应删除的标签（特别注意互动标签 disembodied_* / hand_on_* / *_another 是否因角色抽回手/推开/分离而不再适用）(2) 评估删除后是否有关键特征缺失需要补充（如服装移除后的暴露特征标签）。返回 JSON 格式结果。`;

      // 7. 构建 messages + 注入引擎级 system prompt
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ];
      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 8. 构建请求 + 调用 LLM
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      // 【修复】空 apiKey（本地引擎）时不发送 Authorization / api_key 字段（同上）
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          headers['Authorization'] = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[TraitOptimizeAI] Calling LLM for trait optimization:', {
        baseUrl,
        modelName,
        traitCount: traits.length,
        contextLength: conversationContext.length,
      });

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[TraitOptimizeAI] LLM request failed:', response.status, response.statusText, errorText);
        return {
          success: false,
          error: `AI 调用失败：HTTP ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        return { success: false, error: 'AI 返回内容为空' };
      }

      // 9. 解析 JSON 响应
      // 【Spec: add-ai-tag-supplement-after-removal / Task 2】解析器同时返回 tagsToRemove + tagsToAdd
      const { tagsToRemove, tagsToAdd } = this.parseOptimizeResponse(content);

      console.log('[TraitOptimizeAI] Optimization result:', {
        suggestedRemoval: tagsToRemove.length,
        removedTags: tagsToRemove.map(t => t.text),
        suggestedSupplement: tagsToAdd.length,
        addedTags: tagsToAdd.map(t => t.text),
      });

      return {
        success: true,
        tagsToRemove,
        tagsToAdd,
      };
    } catch (error) {
      console.error('[TraitOptimizeAI] optimizeTraitsForContext failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.toLowerCase().includes('abort') || errorMsg.toLowerCase().includes('timeout')) {
        return { success: false, error: 'AI 调用失败：请求超时，请稍后重试' };
      }
      return { success: false, error: `AI 调用失败：${errorMsg}` };
    }
  }

  /**
   * 解析 AI 标签优化的 JSON 响应。
   * 支持 ```json ... ``` 代码块包裹和裸 JSON 两种格式。
   *
   * 【Spec: add-ai-tag-supplement-after-removal / Task 2】解析器升级：
   *  - 同时解析 `remove` 与 `add` 两个字段，返回 `{ tagsToRemove, tagsToAdd }`
   *  - `add` 项额外支持 `weight` / `categoryId`（与 OptimizeTraitsResult.tagsToAdd 字段对齐）
   *  - 防御性过滤：若 AI 违反 IMPORTANT RULES 第 7 条（建议补充同时建议删除的标签），
   *    在解析层兜底剔除 tagsToAdd 中与 tagsToRemove 同名（大小写不敏感）的项
   *  - 兼容旧格式 `{ remove: [...] }`（无 add 字段时 tagsToAdd 为空数组）
   *  - 兼容裸数组 `[{ text, reason }]`（视为仅 remove 列表，tagsToAdd 为空）
   */
  private parseOptimizeResponse(content: string): {
    tagsToRemove: Array<{ text: string; reason?: string }>;
    tagsToAdd: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }>;
  } {
    const empty: { tagsToRemove: Array<{ text: string; reason?: string }>; tagsToAdd: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }> } = {
      tagsToRemove: [],
      tagsToAdd: [],
    };
    try {
      // 尝试提取 ```json ... ``` 代码块
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

      const parsed = JSON.parse(jsonStr);

      // 解析 remove 列表项（统一处理对象数组 → 标准化 { text, reason }）
      const normalizeRemoveItem = (item: any): { text: string; reason?: string } | null => {
        if (!item || typeof item.text !== 'string' || !item.text.trim()) return null;
        return {
          text: item.text.trim(),
          reason: typeof item.reason === 'string' ? item.reason.trim() : undefined,
        };
      };

      // 解析 add 列表项（含 weight / categoryId，与 OptimizeTraitsResult.tagsToAdd 对齐）
      const normalizeAddItem = (item: any): { text: string; reason?: string; weight?: number; categoryId?: string } | null => {
        const text = String(item?.text || '').trim();
        if (!text) return null;
        return {
          text,
          reason: item.reason ? String(item.reason).trim() : undefined,
          weight: typeof item.weight === 'number' ? item.weight : undefined,
          categoryId: typeof item.categoryId === 'string' ? item.categoryId : undefined,
        };
      };

      // 情况 A：标准结构 { remove: [...], add: [...] }
      if (parsed && (Array.isArray(parsed.remove) || Array.isArray(parsed.add))) {
        const removeList: any[] = Array.isArray(parsed.remove) ? parsed.remove : [];
        const addList: any[] = Array.isArray(parsed.add) ? parsed.add : [];

        const tagsToRemove: Array<{ text: string; reason?: string }> = removeList
          .map(normalizeRemoveItem)
          .filter((t: { text: string; reason?: string } | null): t is { text: string; reason?: string } => t !== null);

        let tagsToAdd: Array<{ text: string; reason?: string; weight?: number; categoryId?: string }> = addList
          .map(normalizeAddItem)
          .filter((t: { text: string; reason?: string; weight?: number; categoryId?: string } | null): t is { text: string; reason?: string; weight?: number; categoryId?: string } => t !== null);

        // 防御性过滤：剔除 tagsToAdd 中与 tagsToRemove 同名（大小写不敏感）的项，
        // 兜底执行 IMPORTANT RULES 第 7 条「do NOT suggest adding tags that you also suggested removing」
        const removeTextsLower = new Set(tagsToRemove.map(t => t.text.toLowerCase()));
        tagsToAdd = tagsToAdd.filter(t => !removeTextsLower.has(t.text.toLowerCase()));

        return { tagsToRemove, tagsToAdd };
      }

      // 情况 B：兼容裸数组格式 [{ text, reason }]（视为仅 remove 列表，tagsToAdd 为空）
      if (Array.isArray(parsed)) {
        const tagsToRemove: Array<{ text: string; reason?: string }> = parsed
          .map(normalizeRemoveItem)
          .filter((t: { text: string; reason?: string } | null): t is { text: string; reason?: string } => t !== null);
        return { tagsToRemove, tagsToAdd: [] };
      }

      console.warn('[TraitOptimizeAI] Unexpected JSON structure:', parsed);
      return empty;
    } catch (e) {
      console.warn('[TraitOptimizeAI] Failed to parse JSON response:', e, 'Content:', content.substring(0, 200));
      return empty;
    }
  }

  /**
   * 构建提示词生成的 user message。
   *
   * 结构：
   *  - 用户提示词行（必填）：用户自由输入的提示词原文
   *  - 当前已有特征上下文（可选）：当 baseTraits 非空时附加以「当前已有特征（避免重复）」段落
   *  - 末尾请求行：要求 LLM 按系统提示词格式输出分类 tag
   */
  private buildTraitPromptUserMessage(prompt: string, baseTraits?: string): string {
    const parts: string[] = [];
    parts.push(`用户提示词：\n${prompt.trim()}`);
    if (baseTraits && baseTraits.trim()) {
      parts.push(`当前已有特征（避免重复生成）：\n${baseTraits.trim()}`);
    }
    parts.push('请根据提示词生成分类特征 tag 列表：');
    return parts.join('\n\n');
  }

  // ==================== 自定义情绪 AI 提示词生成（Spec: enhance-custom-emotion-system）====================

  /**
   * 根据情绪关键词生成 SD 提示词（4 维度 + NL 描述）。
   *
   * 复用 generateCharacterTraits 的 AI 引擎配置 + LLM 调用模式 + applyTagAudit 审计链。
   * 区别：
   *  - 系统提示词不同（要求 4 段分隔符格式：---FACE--- / ---ACTION--- / ---SYMBOL--- / ---BACKGROUND--- / ---NL---）
   *  - 输入仅情绪关键词（无 description / personality / scenario / image）
   *  - 输出为扁平 positive 字符串 + nlPrompt，而非 CategorizedTrait[]
   */
  async generateEmotionPrompts(
    emotionLabel: string,
    existingKeys?: string[]
  ): Promise<{
    success: boolean;
    positive?: string;
    negative?: string;
    nlPrompt?: string;
    emotionKey?: string;
    auditDetails?: any[];
    error?: string;
  }> {
    try {
      if (!emotionLabel || !emotionLabel.trim()) {
        return { success: false, error: '情绪关键词不能为空' };
      }

      // 1. 读取 AI 引擎配置
      const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt || '';
      const modelName = aiConfig.modelName;

      // 【修复】apiKey 可空（本地引擎合法场景）；空 key 不发送 Authorization（header 守卫）
      if (!baseUrl || !modelName) {
        return { success: false, error: 'AI 引擎未配置，请先在设置中配置 API' };
      }
      if (!apiKey) {
        console.warn('[CharacterTraitAI] AI 引擎 apiKey 为空（本地引擎合法场景），继续调用');
      }

      // 2. 读取引擎运行时参数
      const runtimeConfig = this.getEngineRuntimeConfig();
      if (!runtimeConfig) {
        return { success: false, error: 'AI 引擎未配置 temperature 或 max_tokens 参数，请在设置中配置 AI 引擎' };
      }
      const { temperature, maxTokens } = runtimeConfig;

      // 3. 构建系统提示词
      const systemPrompt = `You are an expert SD (Stable Diffusion) prompt engineer specializing in anime character expressions.

Given an emotion keyword (may be Chinese), generate an English emotion key and Danbooru-style tags for an expression image covering 4 dimensions. Output EXACTLY in this format with section separators:

---KEY---
a_single_english_key

---FACE---
tag1, tag2, tag3, ...

---ACTION---
tag1, tag2, ...

---SYMBOL---
tag1, tag2, ...

---BACKGROUND---
tag1, tag2, ...

---NL---
A single natural language sentence describing the expression.

Rules:
- KEY: a single English snake_case key representing the emotion (lowercase letters/digits/underscores only, MUST start with a letter, e.g., "热恋" → "passionate_love", "得意" → "smug", "害羞" → "shy"). Keep it concise (1-3 words).
- All tags MUST use Danbooru standard underscore format (e.g., "open_mouth" not "open mouth", "heart-shaped_eyes" not "heart shaped eyes")
- FACE: facial expression tags (e.g., smile, blush, open_mouth, closed_eyes, tears)
- ACTION: body action tags (e.g., looking_at_viewer, leaning_forward, raised_arms) - can be empty if not applicable
- SYMBOL: symbol/motif tags (e.g., heart, sparkle, star_(symbol), exclamation_point) - can be empty if not applicable
- BACKGROUND: simple background tags (e.g., simple_background, white_background, gradient_background) - at least 1 tag
- NL: one natural language sentence describing the expression (e.g., "an expression of passionate love with blushing cheeks and heart-shaped eyes")
- Keep NSFW semantics if the emotion implies it (e.g., "in heat" → use tags like blush, sweat, heart, saliva, tongue_out)
- Each dimension should have 3-8 tags
- Do not add any text outside the section format`;

      const userContent = `Emotion keyword: ${emotionLabel.trim()}\n\nPlease generate the English KEY and SD tags for this emotion following the format above.${existingKeys && existingKeys.length > 0 ? `\n\nIMPORTANT: The following keys are already taken. Generate a DIFFERENT key that does not conflict: ${existingKeys.join(', ')}` : ''}`;

      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      // 4. 构建 LLM 请求
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          headers['Authorization'] = authValue;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      console.log('[CharacterTraitAI] generateEmotionPrompts: calling LLM for emotion:', emotionLabel);

      // 5. 非流式调用 LLM
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[CharacterTraitAI] generateEmotionPrompts LLM failed:', response.status, response.statusText, errorText);
        return { success: false, error: `AI 调用失败: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;

      if (!content || !content.trim()) {
        return { success: false, error: 'AI 返回内容为空' };
      }

      // 6. 解析 4 维度 + NL
      const parsed = this.parseEmotionPromptResponse(content);
      if (!parsed) {
        return { success: false, error: 'AI 返回内容无法解析为 4 维度提示词' };
      }

      // 7. 标签审计（复用 applyTagAudit 的标签验证逻辑）
      const allTags = [...parsed.face, ...parsed.action, ...parsed.symbol, ...parsed.background];
      let auditDetails: any[] = [];

      if (allTags.length > 0) {
        try {
          const tagValidation = await tagRagService.validateTagsAgainstLibrary(allTags);
          auditDetails = allTags.map((tag, i) => {
            const validation = tagValidation[i];
            return {
              tag,
              isValid: validation?.isValid ?? false,
              replacedBy: validation?.replacedBy,
              source: validation?.source || 'failed',
            };
          });
        } catch (auditError) {
          console.warn('[CharacterTraitAI] generateEmotionPrompts: tag audit failed, skipping:', auditError);
          auditDetails = allTags.map(tag => ({ tag, isValid: true, source: 'skipped' }));
        }
      }

      // 8. 合并 4 维度为 positive 字符串
      const positive = allTags.filter(Boolean).join(', ');

      // 9. 处理英文键：校验格式，兜底生成
      const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
      let emotionKey = parsed.key || '';
      if (!KEY_PATTERN.test(emotionKey)) {
        // 兜底：使用 custom_ + 中文标签 UTF-8 字节短 hash
        const labelBytes = Buffer.from(emotionLabel.trim(), 'utf-8');
        const hashNum = labelBytes.reduce((h: number, b: number) => ((h << 5) - h + b) | 0, 0);
        emotionKey = `custom_${Math.abs(hashNum).toString(16).substring(0, 6)}`;
        console.warn('[CharacterTraitAI] generateEmotionPrompts: AI key invalid, using fallback:', emotionKey);
      }

      console.log('[CharacterTraitAI] generateEmotionPrompts: success, key:', emotionKey, 'tags:', allTags.length, 'nl:', parsed.nl?.substring(0, 50));

      return {
        success: true,
        positive,
        nlPrompt: parsed.nl || `${emotionLabel.trim()} expression`,
        emotionKey,
        auditDetails,
      };
    } catch (error) {
      console.error('[CharacterTraitAI] generateEmotionPrompts failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 解析 LLM 返回的情绪提示词内容为 KEY + 4 维度 + NL。
   *
   * 格式：
   * ---KEY---
   * a_single_english_key
   * ---FACE---
   * tag1, tag2, ...
   * ---ACTION---
   * tag1, ...
   * ---SYMBOL---
   * tag1, ...
   * ---BACKGROUND---
   * tag1, ...
   * ---NL---
   * natural language sentence
   */
  private parseEmotionPromptResponse(content: string): {
    key: string;
    face: string[];
    action: string[];
    symbol: string[];
    background: string[];
    nl: string;
  } | null {
    try {
      const sections = ['---KEY---', '---FACE---', '---ACTION---', '---SYMBOL---', '---BACKGROUND---', '---NL---'];
      const result = {
        key: '',
        face: [] as string[],
        action: [] as string[],
        symbol: [] as string[],
        background: [] as string[],
        nl: '',
      };

      let remaining = content;

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const nextSection = sections[i + 1];

        const startIdx = remaining.indexOf(section);
        if (startIdx === -1) {
          // 段落缺失，容错：跳过
          console.warn(`[CharacterTraitAI] parseEmotionPromptResponse: section ${section} not found`);
          continue;
        }

        const contentStart = startIdx + section.length;
        const contentEnd = nextSection
          ? remaining.indexOf(nextSection, contentStart)
          : remaining.length;
        const sectionContent = (contentEnd === -1 ? remaining.substring(contentStart) : remaining.substring(contentStart, contentEnd)).trim();

        if (section === '---NL---') {
          result.nl = sectionContent;
        } else if (section === '---KEY---') {
          // KEY 段：取第一行，转下划线小写格式
          result.key = sectionContent
            .split('\n')[0]
            .trim()
            .replace(/\s+/g, '_')
            .toLowerCase();
        } else {
          const tags = sectionContent
            .split(/[,\n]/)
            .map(t => t.trim().replace(/\s+/g, '_'))
            .filter(Boolean);
          const key = section.replace(/---/g, '').toLowerCase() as keyof typeof result;
          (result[key] as string[]) = tags;
        }

        if (contentEnd !== -1) {
          remaining = remaining.substring(contentEnd);
        }
      }

      // 兜底：如果所有维度都为空，返回 null
      if (!result.key && result.face.length === 0 && result.action.length === 0 && result.symbol.length === 0 && result.background.length === 0 && !result.nl) {
        return null;
      }

      return result;
    } catch (e) {
      console.error('[CharacterTraitAI] parseEmotionPromptResponse failed:', e);
      return null;
    }
  }
}

/**
 * 单例导出。与 characterTraitService / assetService / expressionService 单例模式一致。
 */
export const characterTraitAIService = new CharacterTraitAIService();
