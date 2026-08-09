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
 *  - 每条 tag 前缀系统分类标签（basic / head / body / clothing / background / pose / expression）
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
- clothing：衣物配饰（服装、配饰、眼镜、缎带、首饰等）
- background：背景环境（场景元素、背景物件）
- pose：人物姿势（身体姿态、动作）
- expression：人物表情（面部表情、情绪状态）

分类建议（参考，按特征语义归入最合适的分类）：
- 物种/种族（如 dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral）→ basic
- 性别（如 female, male, 1girl, 1boy）→ basic
- 内容分级（如 sfw, nsfw）→ basic
- 毛色（如 white fur, black fur）→ body
- 发色（如 black hair, blonde hair）→ head
- 瞳色（如 blue eyes, red eyes）→ head
- 服饰（如 black shirt, school uniform, dress）→ clothing
- 配饰（如 glasses, ribbon, hat）→ clothing
- 动物耳朵（如 animal ears, dog ears）→ head
- 尾巴/翅膀（如 tail, wings）→ body

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
basic:dog girl|犬耳少女, basic:female|女性, head:white hair|白发, head:blue eyes|蓝眼睛|1.3, body:white fur|白色毛发, clothing:black shirt|黑色衬衫, head:animal ears|动物耳朵
---DESCRIPTION---
一位犬耳少女，拥有洁白的毛发和蓝色的眼睛。身穿黑色衬衫，头上有一对毛茸茸的犬耳。体型娇小，整体风格偏可爱。`;

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
 * 【重点标记 - AI 不生成自定义分类 tag 的 bug 修复】Spec: fix-asset-trait-and-scene-defects / Task 5
 *  - 与 CHARACTER_TRAIT_SYSTEM_PROMPT 同步改为动态构建：
 *    `recognizeImageTraits` 调用 `buildDynamicImageTraitSystemPrompt(globalCategories)`
 *  - 本常量保留作为基线参考（文档化 prompt 结构），不再直接用于生产调用
 */
export const IMAGE_TRAIT_SYSTEM_PROMPT = `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated "category:tag" pairs for Stable Diffusion. Each tag MUST be prefixed with one of these category labels:
- basic: species/race (e.g. lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf), gender (e.g. female, male, 1girl, 1boy), content rating (e.g. sfw, nsfw), and other foundational character attributes
- head: hair color, hair style, eye color, animal ears, hat, facial decorations
- body: body type, skin tone, fur color, tail, wings, height (excluding species and gender)
- clothing: clothes, accessories, glasses, ribbon, jewelry
- background: scene elements, background objects
- pose: body posture, action
- expression: facial expression, emotion

Category guidance:
- Species/race (e.g. dog girl, cat boy, human, elf, lucario, pokemon, furry, anthro, feral) → basic
- Gender (e.g. female, male, 1girl, 1boy) → basic
- Content rating (e.g. sfw, nsfw) → basic
- Fur color (e.g. white fur, black fur) → body
- Hair color (e.g. black hair, blonde hair) → head
- Eye color (e.g. blue eyes, red eyes) → head
- Clothing (e.g. black shirt, school uniform, dress) → clothing
- Accessories (e.g. glasses, ribbon, hat) → clothing
- Animal ears (e.g. animal ears, dog ears) → head
- Tail/wings (e.g. tail, wings) → body

Output format requirements:
1. First, output ONE line of "category:tag" pairs separated by commas, no numbering, no explanations. Example: basic:cat girl, basic:female, head:white hair, head:red eyes, clothing:school uniform, head:cat ears
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including species, gender, body type, hair color/style, eye color, clothing, accessories, etc.
4. Optional weight segment (Spec: add-sdxl-prompt-weight-support): each tag MAY append a third "|"-separated weight segment after the translation, in the format "category:tag|chinese_translation|weight":
   - The weight segment is OPTIONAL; omit it to use the default 1.0 (no weighting)
   - Range: 0.1-10.0 (one decimal place, e.g. 0.5 / 1.3 / 2.0)
   - Purpose: SDXL prompt weight strengthening/weakening (e.g. strengthen \`head:blue_eyes|蓝眼睛|1.5\` to make blue eyes more prominent, weaken \`background:simple_background|简洁背景|0.5\` to make the background simpler)
   - Only output a weight when the user description explicitly emphasizes a feature's intensity (e.g. "very blue eyes" → 1.3, "faint smile" → 0.7). Do NOT output a weight segment for ordinary features
   - When the weight is 1.0, omit the weight segment to keep the output concise (do NOT output "|1.0")

Output example:
basic:cat girl, basic:female, head:white hair, head:red eyes|1.3, clothing:school uniform, head:cat ears
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
        console.warn('[CharacterTraitAI] AI 引擎未配置 apiKey');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
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
        console.warn('[CharacterTraitAI] recognizeImageTraits: AI 引擎未配置 apiKey');
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
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
    const systemCategoryDescriptions: Record<string, string> = {
      basic:
        '基本特征（种族/物种如 lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf；性别如 female, male, 1girl, 1boy；内容分级如 sfw, nsfw；以及其他描述角色基本属性的基底特征，作为整个角色的基底）',
      head: '头部特征（发色、发型、瞳色、动物耳朵、帽子、面部装饰等头部相关）',
      body: '身体特征（体型、肤色、毛色、尾巴、翅膀、身高等身体相关，不含物种与性别）',
      clothing: '衣物配饰（服装、配饰、眼镜、缎带、首饰等）',
      background: '背景环境（场景元素、背景物件）',
      pose: '人物姿势（身体姿态、动作）',
      expression: '人物表情（面部表情、情绪状态）',
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
      '- 服饰（如 black shirt, school uniform, dress）→ clothing',
      '- 配饰（如 glasses, ribbon, hat）→ clothing',
      '- 动物耳朵（如 animal ears, dog ears）→ head',
      '- 尾巴/翅膀（如 tail, wings）→ body',
    ];
    const customGuidance = globalCategories.map((c) => `- ${c.name} → ${c.id}`);
    const categoryGuidance = [...systemGuidance, ...customGuidance].join('\n');

    return `你是一个角色视觉特征提取助手。请从给定的角色描述中提取角色的视觉外观特征，并为每个特征分配一个分类标签，输出为逗号分隔的「分类:tag|中文翻译」列表，用于 Stable Diffusion 图像生成，并同时输出一段中文角色外观描述。

分类体系（必须使用以下英文分类标签作为前缀，与「分类:tag|中文翻译」中的「分类」对应）：
${categoryLines}

分类建议（参考，按特征语义归入最合适的分类）：
${categoryGuidance}

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
basic:dog girl|犬耳少女, basic:female|女性, head:white hair|白发, head:blue eyes|蓝眼睛|1.3, body:white fur|白色毛发, clothing:black shirt|黑色衬衫, head:animal ears|动物耳朵
---DESCRIPTION---
一位犬耳少女，拥有洁白的毛发和蓝色的眼睛。身穿黑色衬衫，头上有一对毛茸茸的犬耳。体型娇小，整体风格偏可爱。`;
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
    const systemCategoryDescriptions: Record<string, string> = {
      basic:
        'species/race (e.g. lucario, pokemon, furry, anthro, feral, human, dog girl, cat boy, elf), gender (e.g. female, male, 1girl, 1boy), content rating (e.g. sfw, nsfw), and other foundational character attributes',
      head: 'hair color, hair style, eye color, animal ears, hat, facial decorations',
      body: 'body type, skin tone, fur color, tail, wings, height (excluding species and gender)',
      clothing: 'clothes, accessories, glasses, ribbon, jewelry',
      background: 'scene elements, background objects',
      pose: 'body posture, action',
      expression: 'facial expression, emotion',
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
      '- Clothing (e.g. black shirt, school uniform, dress) → clothing',
      '- Accessories (e.g. glasses, ribbon, hat) → clothing',
      '- Animal ears (e.g. animal ears, dog ears) → head',
      '- Tail/wings (e.g. tail, wings) → body',
    ];
    const customGuidance = globalCategories.map((c) => `- ${c.name} → ${c.id}`);
    const categoryGuidance = [...systemGuidance, ...customGuidance].join('\n');

    return `You are a visual character analyst. Analyze the character image and extract visual features as English comma-separated "category:tag|chinese_translation" pairs for Stable Diffusion. Each tag MUST be prefixed with one of these category labels, and followed by a short Chinese translation after a pipe ("|") separator:
${categoryLines}

Category guidance:
${categoryGuidance}

Output format requirements:
1. First, output ONE line of "category:tag|chinese_translation" pairs separated by commas, no numbering, no explanations. The Chinese translation after "|" should be a short translation of the tag (2-8 Chinese characters, e.g. "白发", "蓝眼睛", "黑色衬衫"). Every tag MUST come with a translation. Example: basic:cat girl|猫耳少女, basic:female|女性, head:white hair|白发, head:red eyes|红眼睛, clothing:school uniform|学校制服, head:cat ears|猫耳
2. Then output a line "---DESCRIPTION---" as a separator.
3. Finally, output a Chinese character appearance description (2-4 sentences) describing the overall visual appearance, including species, gender, body type, hair color/style, eye color, clothing, accessories, etc.
4. Optional weight segment (Spec: add-sdxl-prompt-weight-support): each tag MAY append a third "|"-separated weight segment after the translation, in the format "category:tag|chinese_translation|weight":
   - The weight segment is OPTIONAL; omit it to use the default 1.0 (no weighting)
   - Range: 0.1-10.0 (one decimal place, e.g. 0.5 / 1.3 / 2.0)
   - Purpose: SDXL prompt weight strengthening/weakening (e.g. strengthen \`head:blue_eyes|蓝眼睛|1.5\` to make blue eyes more prominent, weaken \`background:simple_background|简洁背景|0.5\` to make the background simpler)
   - Only output a weight when the user description explicitly emphasizes a feature's intensity (e.g. "very blue eyes" → 1.3, "faint smile" → 0.7). Do NOT output a weight segment for ordinary features
   - When the weight is 1.0, omit the weight segment to keep the output concise (do NOT output "|1.0")

Output example:
basic:cat girl|猫耳少女, basic:female|女性, head:white hair|白发, head:red eyes|红眼睛|1.3, clothing:school uniform|学校制服, head:cat ears|猫耳
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
      if (!baseUrl || !apiKey || !modelName) {
        return {
          success: false,
          error: 'AI 引擎未配置，请先在设置中配置 API',
        };
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

      // 7. 构建 user message
      const userMessage = this.buildTraitPromptUserMessage(prompt, baseTraits);

      // 8. 构建 messages + 注入引擎级 system prompt
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'system', content: systemPromptWithRag },
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
      if (apiKeyTransmission === 'header') {
        headers['Authorization'] = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      } else {
        requestBody.api_key = apiKey;
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
}

/**
 * 单例导出。与 characterTraitService / assetService / expressionService 单例模式一致。
 */
export const characterTraitAIService = new CharacterTraitAIService();
