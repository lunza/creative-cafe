/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】图片生成逻辑 Hook（从 God Component 提取）。
 *
 * 收纳原先内联在 CharacterDialogueChat.tsx 中的 executeImageGeneration（约 476 行）
 * 及其配套：generationId 幂等保护（H5）、traitPromptProgress 订阅（H4 unsubscribe 模式）、
 * 阶段耗时统计（M2）、首次/重新生成入口。tsx 退化为纯编排层（M1 验收：单文件 < 400 行）。
 */
import { useCallback, useEffect, useRef } from 'react';
import { message } from 'antd';
import { CharacterInfo, ChatMessage, ImageHistoryItem } from './CharacterDialogueChat.types';
import { buildAssetPromptTemplate, EMOTION_PROMPT_MAP } from './PromptBuilder';
import { buildSdOptionsFromConfig } from './buildSdOptions';
import { trackPhaseEnter, trackPhaseFinish } from './imagePhaseTracker';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
import { useCharacterLoraStore } from '../../../stores/characterLoraStore';
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { useChatUIStore } from './stores/useChatUIStore';
import {
  ai as aiService,
  sd as sdService,
  asset as assetService,
  type TraitPromptPhase,
} from '../../../services/characterChatService';
// 【Phase 3 / L2 - conversation-mode-optimization-report】共享工具：特征去重 + Base64 图片处理
import { dedupeTraitsByText, mergeTraitsUnique } from '@shared/utils/traitDedup';
import { toPngDataUrl } from '@shared/utils/imageUtils';
import { loadSdWebuiConfig } from '@shared/utils/sdConfigLoader';
import { enqueueSdRequest } from '@shared/utils/sdRequestQueue';

interface UseImageGenerationDeps {
  characterInfo: CharacterInfo;
  /** 含版本信息合并后的消息列表（hook 返回值透传） */
  stateWithVersionInfo: { messages: ChatMessage[] };
  characterConfig: any;
  updateImageAttachment: (messageId: string, updater: (prev: any) => any) => Promise<void>;
}

export function useImageGeneration({
  characterInfo,
  stateWithVersionInfo,
  characterConfig,
  updateImageAttachment,
}: UseImageGenerationDeps) {
  // 图片生成瞬态（H2 范式：从 useChatUIStore 订阅，调用方无需透传）
  const isGeneratingImage = useChatUIStore(s => s.isGeneratingImage);
  const setIsGeneratingImage = useChatUIStore(s => s.setIsGeneratingImage);
  // 角色特征 / LoRA store（原 tsx 中的订阅，随图片生成逻辑一并迁入）
  const traitStoreCardId = useCharacterTraitStore(s => s.currentCharacterCardId);
  const loadStoreTraits = useCharacterTraitStore(s => s.loadTraits);
  const loadCharacterLoras = useCharacterLoraStore(s => s.loadLoras);

  // 当前生成中的 messageId（供 onTraitPromptProgress 回调使用，Task 9.7）
  const generatingMessageIdRef = useRef<string | null>(null);
  // 【Phase 1 / H5】图片生成幂等保护：单调递增的生成序号，finally 块据此判断是否为最新请求
  const imageGenerationIdRef = useRef(0);

  const executeImageGeneration = useCallback(async (messageId: string, isRegenerate: boolean) => {
    // 【Phase 1 / H5 - conversation-mode-optimization-report】幂等保护：
    // 每次生成分配唯一 generationId，finally 块仅在仍为最新请求时重置全局状态，
    // 防止并发/迟到的生成请求互相覆盖 isGeneratingImage / generatingMessageIdRef（S3）。
    const generationId = ++imageGenerationIdRef.current;
    setIsGeneratingImage(true);

    // 获取父消息和情绪快照（Spec: Task 9.6 情绪继承 — 生成时 imageAttachment.emotion = 父消息.emotion || 'default'）
    const parentMsg = stateWithVersionInfo.messages.find(m => m.id === messageId);
    if (!parentMsg) {
      message.error('找不到目标消息');
      if (imageGenerationIdRef.current === generationId) {
        setIsGeneratingImage(false);
      }
      return;
    }
    const emotionSnapshot = parentMsg.emotion || 'default';

    // 首次生成：创建 imageAttachment 占位（status='generating', phase='tag-generating'）
    // 重新生成：复用已有 imageAttachment，更新情绪快照并重置为 generating 状态（Task 9.3 / 9.4）
    if (!isRegenerate) {
      await updateImageAttachment(messageId, () => ({
        currentAssetId: '', // 占位，生成完成后填入
        emotion: emotionSnapshot,
        createdAt: Date.now(),
        history: [],
        currentIndex: -1,
        status: 'generating',
        phase: 'tag-generating',
      }));
    } else {
      await updateImageAttachment(messageId, (prev) => prev ? {
        ...prev,
        emotion: emotionSnapshot, // 更新情绪快照（父消息 emotion 可能在对话过程中变化）
        status: 'generating',
        phase: 'tag-generating',
        errorMessage: undefined,
      } : prev);
    }

    // 记录当前生成中的 messageId（供 onTraitPromptProgress 回调使用，Task 9.7）
    generatingMessageIdRef.current = messageId;
    // 【Phase 2 / M2】开始计时第一阶段（标签生成），供阶段进度条展示预计耗时
    trackPhaseEnter('tag-generating');

    try {
      // === 阶段 1: 标签生成（phase 已是 tag-generating，IPC 事件会推送 tag-auditing）===
      // 1. 构建对话上下文 prompt
      const currentMessages = stateWithVersionInfo.messages.filter(m => m.status === 'sent');
      const conversationContext = currentMessages
        .map(m => `${m.role === 'user' ? '用户' : characterInfo.characterCardName}: ${m.content}`)
        .join('\n\n');

      if (!conversationContext.trim()) {
        message.warning('对话上下文为空，无法生成图片');
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: '对话上下文为空'
        } : prev);
        return;
      }

      // 2. 确保角色特征已加载
      if (traitStoreCardId !== characterInfo.characterCardId) {
        await loadStoreTraits(characterInfo.characterCardId);
      }
      // 确保角色 LoRA 已加载
      await loadCharacterLoras(characterInfo.characterCardId);

      // 3. 从 store 获取已启用的角色特征 tag
      // 【Spec: enhance-conversation-image-auditability / Task 10】特征源优先 sessionTraits（会话隔离临时编辑）
      // - sessionTraits 存在时（用户在 ConfigPanel 临时编辑过特征），从此读取，不污染角色卡 manifest
      // - sessionTraits 为 undefined 时，回退到角色卡特征 store（默认行为）
      const sessionTraits = useCharacterChatStore.getState().currentTestChat?.sessionTraits;
      const currentTraits = sessionTraits ?? useCharacterTraitStore.getState().traits;
      console.log(`[executeImageGeneration] 特征来源: ${sessionTraits ? 'sessionTraits (临时编辑)' : 'characterTraitStore (角色卡)'}`);
      // 【Phase 3 / L2 - conversation-mode-optimization-report】内联去重逻辑改用 shared/utils/traitDedup
      let enabledTraitTexts: Array<{ text: string; weight?: number; categoryId?: string }> = dedupeTraitsByText(
        currentTraits
          .filter(t => t.enabled)
          .map(t => ({ text: t.text, weight: t.weight, categoryId: t.categoryId }))
      );

      // 【Bug 修复 - 对话图片表情与父对话气泡不一致】
      // 问题：enabledTraitTexts 包含 expression 分类的固定标签（如 smile），但对话过程中
      // 父消息的 emotion 已变化（如 annoyance），图片生成仍用固定 smile，导致图片表情与
      // 父对话气泡立绘不一致。
      // 修复：用 emotionSnapshot 从 EMOTION_PROMPT_MAP 获取动态表情 prompt，替换 expression
      // 分类的固定标签。过滤背景+全身姿势类 tag（与 background/pose 分类冲突），保留面部表情+
      // 动作+符号 tag。
      const EXPRESSION_PROMPT_EXCLUDE_TAGS = new Set([
        // 背景类
        'simple_background', 'white_background', 'gradient_background', 'dark_background',
        'grey_background', 'pink_background', 'colorful_background', 'red_background',
        'pastel_background', 'blurred_background',
        // 光效/氛围
        'sunny', 'blue_sky', 'bokeh', 'soft_lighting', 'ambient_lighting', 'dim_lighting',
        'spotlight', 'light_rays', 'shining', 'depth_of_field', 'vignette', 'motion_blur',
        'speed_lines', 'shadow', 'dark_aura', 'light_particles', 'sunlight',
        // 背景装饰
        'petals', 'confetti', 'rain', 'flower', 'sun', 'light_bulb', 'steam', 'fire', 'lightning',
        // 全身姿势（与 pose 分类冲突）
        'standing', 'arms_at_sides', 'sitting', 'kneeling', 'jumping', 'cowering',
        'self_hug', 'curled_up', 'slouching', 'bowing', 'waving', 'arms_up',
        'v_sign', 'v', 'pointing', 'nodding', 'thumbs_up',
        // 视线方向（可能与对话图片视角冲突）
        'looking_at_viewer', 'looking_away', 'looking_down', 'looking_up', 'looking_sideways',
      ]);
      // 步骤 1：移除 expression 分类的固定标签
      const hasExpressionTraits = enabledTraitTexts.some(t => t.categoryId === 'expression');
      if (hasExpressionTraits) {
        enabledTraitTexts = enabledTraitTexts.filter(t => t.categoryId !== 'expression');
      }
      // 步骤 2：从 EMOTION_PROMPT_MAP 获取动态表情 prompt，过滤后注入
      const emotionPreset = EMOTION_PROMPT_MAP[emotionSnapshot];
      if (emotionPreset && emotionPreset.positive) {
        const emotionTags = emotionPreset.positive
          .split(',')
          .map(t => t.trim())
          .filter(t => t && !EXPRESSION_PROMPT_EXCLUDE_TAGS.has(t));
        for (const tag of emotionTags) {
          // 去重：跳过已存在的 tag（大小写不敏感）
          const tagLower = tag.toLowerCase();
          if (!enabledTraitTexts.some(t => t.text.trim().toLowerCase() === tagLower)) {
            enabledTraitTexts.push({ text: tag, categoryId: 'expression' });
          }
        }
        console.log(`[executeImageGeneration] 表情标签动态替换: emotion="${emotionSnapshot}" → 注入 ${emotionTags.length} 个面部表情 tag（已过滤背景+全身姿势）`);
      } else {
        // emotionSnapshot 不在 EMOTION_PROMPT_MAP 中（自定义情绪或 default），保留移除的固定标签
        if (hasExpressionTraits) {
          console.log(`[executeImageGeneration] emotion="${emotionSnapshot}" 无预置映射，恢复原 expression 分类标签`);
          const expressionTraits = currentTraits
            .filter(t => t.enabled && t.categoryId === 'expression')
            .map(t => ({ text: t.text, weight: t.weight, categoryId: t.categoryId }));
          enabledTraitTexts.push(...expressionTraits);
        }
      }

      // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化（试验性功能）
      // 变量声明提前：aiOptimizationStatus / aiOptimizationError / removedTags / addedTags 在合并后使用。
      // 【执行顺序修复】原设计在 generateTraitPrompts 之前执行 AI 优化，只看到角色特征标签，
      // 看不到动态生成的上下文互动标签（如 disembodied_hand），导致无法删除矛盾的互动标签。
      // 现移至 mergedTraits 形成后执行，AI 能看到完整标签列表（角色特征 + 上下文生成）。
      let removedTags: Array<{ text: string; reason?: string }> = [];
      // 【Spec: add-ai-tag-supplement-after-removal / Task 3】补充标签快照，与 removedTags 对称
      let addedTags: Array<{ text: string; reason?: string }> = [];
      let aiOptimizationStatus: 'success' | 'no-removal' | 'failed' = 'no-removal';
      let aiOptimizationError: string | undefined = undefined;
      const aiOptimizeEnabled = characterConfig?.customParameters?.ai_optimize_traits === true;

      // 4. 调用 AI 生成上下文 tag（复用 generateTraitPrompts IPC，含 L0-L5 审计）
      //    期间 onTraitPromptProgress 事件会推送 phase='tag-auditing'，由 useEffect 回调自动更新 imageAttachment.phase
      const baseTraitsStr = enabledTraitTexts.map(t => t.text).join(', ');
      let contextTraits: Array<{ text: string; weight?: number; categoryId?: string }> = [];
      try {
        const result = await aiService.generateTraitPrompts({
          prompt: conversationContext,
          baseTraits: baseTraitsStr,
        });
        if (result?.success && result.traits) {
          // 【Spec: enhance-conversation-interaction-prompt-recognition】保留 categoryId，
          // 用于后续互动标签分类级权重提升（interaction 分类标签拼接位置靠后需加强）
          contextTraits = result.traits.map((t: { text: string; weight?: number; categoryId?: string }) => ({
            text: t.text,
            weight: t.weight,
            categoryId: t.categoryId,
          }));
        }
      } catch (e) {
        console.warn('[CharacterDialogueChat] 生成上下文 tag 失败，仅使用角色特征:', e);
      }

      // 5. 合并上下文 tag 与角色特征 tag（去重）
      // 【Phase 3 / L2 - conversation-mode-optimization-report】改用 shared/utils/traitDedup.mergeTraitsUnique
      const mergedTraits: Array<{ text: string; weight?: number; categoryId?: string }> = mergeTraitsUnique(enabledTraitTexts, contextTraits);

      // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化（试验性功能）
      // 【执行顺序修复 2026-08-09】原设计在 generateTraitPrompts 之前执行，只看到角色特征标签，
      // 看不到动态生成的上下文互动标签（disembodied_hand / hand_on_vulva 等），导致对话中角色
      // 「抽回手」时无法删除这些互动标签。现移至 mergedTraits 形成后执行，AI 能看到完整标签列表。
      // 防御性设计：AI 调用失败/超时/返回非法数据时降级为不优化，不中断图片生成流程。
      console.log(`[executeImageGeneration] AI 标签优化: ${aiOptimizeEnabled ? '已启用' : '已禁用'}（合并后 ${mergedTraits.length} 个标签）`);
      if (aiOptimizeEnabled && mergedTraits.length > 0) {
        try {
          const optimizeResult = await aiService.optimizeTraitsForContext({
            traits: mergedTraits,
            conversationContext,
          });
          if (optimizeResult?.success && Array.isArray(optimizeResult.tagsToRemove)) {
            const suggested = optimizeResult.tagsToRemove;
            console.log(`[executeImageGeneration] AI 建议删除: [${suggested.map(t => t.text).join(', ')}]`);

            // 存在性过滤：仅移除 mergedTraits 中实际存在的标签（大小写不敏感）
            const mergedTextsLower = new Set(mergedTraits.map(t => t.text.trim().toLowerCase()));
            const validRemovals = suggested.filter(s => mergedTextsLower.has(s.text.trim().toLowerCase()));

            // 过度删除防护：AI 返回删除列表覆盖 >80% 标签时拒绝执行
            const removalRatio = validRemovals.length / mergedTraits.length;
            if (removalRatio > 0.8) {
              console.warn(`[executeImageGeneration] AI 优化返回过度删除（${validRemovals.length}/${mergedTraits.length}），已跳过`);
              aiOptimizationStatus = 'no-removal';
            } else if (validRemovals.length > 0) {
              // 执行过滤：从 mergedTraits 中移除被删除的标签（保留 categoryId 等字段不丢失）
              const removalTextsLower = new Set(validRemovals.map(r => r.text.trim().toLowerCase()));
              const filteredTraits = mergedTraits.filter(t => !removalTextsLower.has(t.text.trim().toLowerCase()));
              console.log(`[executeImageGeneration] 实际过滤: [${validRemovals.map(t => t.text).join(', ')}]，剩余 ${filteredTraits.length}/${mergedTraits.length} 标签`);
              mergedTraits.splice(0, mergedTraits.length, ...filteredTraits);
              removedTags = validRemovals;
              aiOptimizationStatus = 'success';
            } else {
              // AI 返回空列表或建议标签均不在合并列表中（存在性过滤后为空）
              aiOptimizationStatus = 'no-removal';
            }
          } else if (optimizeResult && !optimizeResult.success) {
            console.warn(`[executeImageGeneration] AI 标签优化失败: ${optimizeResult.error}，跳过优化`);
            aiOptimizationStatus = 'failed';
            aiOptimizationError = optimizeResult.error;
          }

          // 【Spec: add-ai-tag-supplement-after-removal / Task 3】AI 标签补充处理
          // 在 tagsToRemove 处理之后执行，将 AI 建议补充的标签合并到 mergedTraits。
          // 防御性设计：去重 + 冲突检查（不补充刚删除的标签）+ 过度补充防护（>50% 拒绝）。
          // 注意：此时 mergedTraits 已经被 splice 过（删除已执行），所以是删除后的状态。
          if (optimizeResult?.success && Array.isArray(optimizeResult.tagsToAdd) && optimizeResult.tagsToAdd.length > 0) {
            console.log(`[executeImageGeneration] AI 建议补充: [${optimizeResult.tagsToAdd.map(t => t.text).join(', ')}]`);

            // SubTask 3.1: 去重检查 — 跳过已存在于 mergedTraits 中的标签（大小写不敏感）
            const existingTextsLower = new Set(mergedTraits.map(t => t.text.trim().toLowerCase()));
            // SubTask 3.2: 冲突检查 — 跳过在 tagsToRemove（刚被删除）中的标签
            // 兜底执行 service 层 IMPORTANT RULES 第 7 条（AI 偶发不遵守规则时的安全网）
            const removedTextsLower = new Set(removedTags.map(r => r.text.trim().toLowerCase()));

            const validAdditions = optimizeResult.tagsToAdd.filter(s => {
              const textLower = s.text.trim().toLowerCase();
              if (existingTextsLower.has(textLower)) {
                console.log(`[executeImageGeneration] 补充标签 ${s.text} 已存在，跳过`);
                return false;
              }
              if (removedTextsLower.has(textLower)) {
                console.warn(`[executeImageGeneration] 补充标签 ${s.text} 与刚删除的标签冲突，拒绝添加`);
                return false;
              }
              return s.text.trim().length > 0;
            });

            // SubTask 3.3: 过度补充防护 — 补充标签数 > 50% mergedTraits 时拒绝执行
            if (validAdditions.length > 0) {
              const additionRatio = validAdditions.length / mergedTraits.length;
              if (additionRatio > 0.5) {
                console.warn(`[executeImageGeneration] AI 优化返回过度补充（${validAdditions.length}/${mergedTraits.length}），已跳过补充`);
              } else {
                // SubTask 3.4: 将有效补充标签加入 mergedTraits（保留 weight / categoryId 供后续权重提升使用）
                const additionsToMerge = validAdditions.map(s => ({
                  text: s.text.trim(),
                  weight: s.weight,
                  categoryId: s.categoryId,
                }));
                mergedTraits.push(...additionsToMerge);

                // SubTask 3.5: 构建 addedTags 快照（用于 ImageHistoryItem 持久化与 UI 展示）
                addedTags = validAdditions.map(s => ({
                  text: s.text.trim(),
                  reason: s.reason,
                }));

                // 有实际补充操作时，将状态提升为 success（覆盖 no-removal；failed 不会进入此分支）
                aiOptimizationStatus = 'success';

                console.log(`[executeImageGeneration] 实际补充: [${addedTags.map(t => t.text).join(', ')}]，补充后 ${mergedTraits.length} 个标签`);
              }
            }
          }
        } catch (e) {
          console.warn('[executeImageGeneration] AI 标签优化调用异常，降级为不优化:', e);
          aiOptimizationStatus = 'failed';
          aiOptimizationError = e instanceof Error ? e.message : String(e);
        }
      }

      // 【Spec: enhance-conversation-interaction-prompt-recognition】互动标签分类级权重提升
      // 互动标签（disembodied_hand / hugging_another 等）拼接位置靠后，角色特征标签较多时
      // 容易被图像模型忽略。对 categoryId === 'interaction' 的 trait 应用分类级权重提升：
      //   最终 weight = (per-tag weight ?? 1.0) × interaction_weight
      // 默认 1.2（用户可在 ConfigPanel 调整，范围 1.0-2.0），1.0 = 不提升。
      // 在渲染进程完成权重计算，applyTraitsAndLora（主进程）只看到最终 { text, weight }。
      const interactionWeight = characterConfig?.customParameters?.interaction_weight ?? 1.2;
      const finalTraits: Array<{ text: string; weight?: number }> = mergedTraits.map(t => {
        if (t.categoryId === 'interaction' && interactionWeight !== 1.0) {
          const baseWeight = t.weight ?? 1.0;
          const boostedWeight = Math.round(baseWeight * interactionWeight * 10) / 10;
          return { text: t.text, weight: boostedWeight };
        }
        return { text: t.text, weight: t.weight };
      });

      // === 阶段 3: 图片生成（切换 phase 为 image-generating，Task 9.2）===
      await updateImageAttachment(messageId, (prev) => prev ? { ...prev, phase: 'image-generating' } : prev);
      trackPhaseEnter('image-generating'); // 【Phase 2 / M2】进入图片生成阶段计时

      // 6. 加载 SD 配置
      // 【Phase 3 / L3 - conversation-mode-optimization-report】改用 shared/utils/sdConfigLoader
      const sdConfig = await loadSdWebuiConfig();

      const endpoint = sdConfig.endpoint || '';
      if (!endpoint) {
        message.error('SD WebUI 未配置，请先在设置中配置端点');
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: 'SD WebUI 未配置'
        } : prev);
        return;
      }

      // 7. 检测 SD WebUI 状态
      try {
        const statusResult = await sdService.checkStatus(endpoint);
        if (!statusResult?.available) {
          message.error('SD WebUI 未连接，请检查服务状态');
          await updateImageAttachment(messageId, (prev) => prev ? {
            ...prev, status: 'error', phase: 'error', errorMessage: 'SD WebUI 未连接'
          } : prev);
          return;
        }
      } catch {
        message.error('SD WebUI 连接失败，请检查服务状态');
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: 'SD WebUI 连接失败'
        } : prev);
        return;
      }

      // 8. 构建提示词模板（复用 general 模式模板，对话图片无特定视角槽位）
      const promptTemplate = buildAssetPromptTemplate('general', undefined);
      const negativePrompt = sdConfig.negativePrompt || 'deformed, ugly, bad_anatomy, bad_hands, missing_fingers, extra_digits, low_quality, worst_quality, normal_quality, jpeg_artifacts, blurry, watermark';

      // 9. 构建图片尺寸（从配置读取，默认 1024×1024）
      const imgWidth = characterConfig?.customParameters?.image_gen_width || 1024;
      const imgHeight = characterConfig?.customParameters?.image_gen_height || 1024;

      // 10. 构建 SD options（复用共享函数，Spec: fix-conversation-image-generation-bugs / Bug 5）
      const currentLoras = useCharacterLoraStore.getState().loras;
      const sdOptions = buildSdOptionsFromConfig({
        sdConfig,
        // 【Spec: enhance-conversation-interaction-prompt-recognition】
        // 传 finalTraits（已对 interaction 分类应用分类级权重提升），而非 mergedTraits
        enabledTraitTexts: finalTraits,
        // 【Spec: enhance-conversation-image-auditability / Task 10.3】
        // effectiveTraits 跟随 currentTraits（已优先 sessionTraits），保证临时编辑生效到 SD 生成
        effectiveTraits: currentTraits,
        characterLoras: currentLoras,
        selectedSize: { width: imgWidth, height: imgHeight },
        selectedCameraAngle: undefined,
      });

      // 【Spec: enhance-conversation-image-auditability / Task 3】来源标识，落盘日志可据此关联对话消息
      sdOptions.sourceContext = {
        source: 'conversation',
        messageId,
        characterCardId: characterInfo.characterCardId,
        round: (parentMsg.imageAttachment?.history?.length || 0) + 1,
      };

      // 11. 调用 SD 生成
      // 【Phase 3 / L8 - conversation-mode-optimization-report】SD 请求排队（同时最多 1 个）
      const sdResult = await enqueueSdRequest(() => sdService.generateTxt2Img({
        endpoint,
        prompt: promptTemplate,
        negativePrompt,
        options: sdOptions,
      }));

      if (sdResult?.success && sdResult.imageBase64) {
        // 【Phase 3 / L2 - conversation-mode-optimization-report】Base64 → data URL 改用 shared/utils/imageUtils
        const dataUrl = toPngDataUrl(sdResult.imageBase64);

        // 保存图片到磁盘（复用原 addImageMessage 中的 asset:save 逻辑，Spec: fix-conversation-image-generation-bugs / Bug 4）
        const assetId = `conv_${Date.now()}`;
        let savedAssetId = assetId;
        try {
          const saveResult = await assetService.save({
            characterCardId: characterInfo.characterCardId,
            assetType: 'general',
            assetId,
            imageBase64: dataUrl,
          });
          if (!saveResult?.success) {
            // 保存失败，回退用 dataUrl 作为 assetId（仅当前会话可用，无法持久化历史）
            savedAssetId = dataUrl;
          }
        } catch (e) {
          savedAssetId = dataUrl;
        }

        // 更新 imageAttachment：追加 history，更新 currentIndex 和 currentAssetId，status='idle'（Task 9.3 / 9.4）
        await updateImageAttachment(messageId, (prev) => {
          if (!prev) return prev;
          // 【Spec: enhance-conversation-image-auditability / Task 4】快照本次生成使用的标签与提示词
          // - usedTags：合并去重后的完整 traits 数组（角色特征 + 上下文 tag）
          // - usedPrompt：主进程 applyTraitsAndLora 处理后的最终 prompt 字符串
          // - usedNegativePrompt：本次使用的负面提示词
          // - usedLoras：本次使用的 LoRA 列表（仅保留 name/weight，避免持久化冗余字段）
          const newHistoryItem: ImageHistoryItem = {
            assetId: savedAssetId,
            createdAt: Date.now(),
            // 【Spec: enhance-conversation-interaction-prompt-recognition】
            // usedTags 快照使用 finalTraits（含互动标签权重提升后的值），与 usedPrompt 保持一致
            usedTags: finalTraits,
            usedPrompt: sdResult?.finalPrompt,
            usedNegativePrompt: negativePrompt,
            usedLoras: currentLoras.map(l => ({ name: l.name, weight: l.weight })),
            // 【Spec: add-ai-trait-optimization-for-image-gen】AI 标签优化删除的标签列表
            removedTags: removedTags.length > 0 ? removedTags : undefined,
            // 【Spec: add-ai-tag-supplement-after-removal / Task 3】AI 标签优化补充的标签列表
            // 与 removedTags 对称：仅当 AI 实际补充了标签时存在，供标签快照面板展示「AI 已补充」分区
            addedTags: addedTags.length > 0 ? addedTags : undefined,
            // 【Spec: add-ai-trait-optimization-for-image-gen / 反馈可见性修复】
            // AI 优化执行状态元数据：仅当本次生成启用了 ai_optimize_traits 时写入，
            // 记录 success/no-removal/failed 三态，供标签快照面板无论是否删除标签都给出明确反馈。
            // 未启用 AI 优化时为 undefined（不渲染分区，与原行为一致）。
            // 【Spec: add-ai-tag-supplement-after-removal / Task 3】新增 addedCount（与 removedCount 对称）
            aiOptimization: aiOptimizeEnabled ? {
              status: aiOptimizationStatus,
              removedCount: removedTags.length,
              addedCount: addedTags.length,
              error: aiOptimizationError,
            } : undefined,
          };
          const newHistory = [...prev.history, newHistoryItem];
          return {
            ...prev,
            currentAssetId: savedAssetId,
            history: newHistory,
            currentIndex: newHistory.length - 1,
            status: 'idle',
            phase: undefined,
            errorMessage: undefined,
          };
        });
        message.success(isRegenerate ? '图片重新生成成功' : '图片生成成功');
      } else {
        // 生成失败（Task 9.5：设 status='error', errorMessage，保留占位供重试）
        await updateImageAttachment(messageId, (prev) => prev ? {
          ...prev, status: 'error', phase: 'error', errorMessage: sdResult?.error || '图片生成失败'
        } : prev);
        message.error(sdResult?.error || '图片生成失败');
      }
    } catch (e) {
      console.error('[CharacterDialogueChat] executeImageGeneration error:', e);
      await updateImageAttachment(messageId, (prev) => prev ? {
        ...prev, status: 'error', phase: 'error', errorMessage: e instanceof Error ? e.message : '生成失败'
      } : prev);
      message.error(e instanceof Error ? e.message : '图片生成失败');
    } finally {
      // 【Phase 2 / M2】结算阶段耗时（成功/失败/异常路径统一收敛于此，幂等）
      trackPhaseFinish();
      // 【Phase 1 / H5】幂等守卫：仅最新生成请求重置全局状态，
      // 迟到的旧请求（generationId 已被新请求覆盖）不再干扰
      if (imageGenerationIdRef.current === generationId) {
        setIsGeneratingImage(false);
        generatingMessageIdRef.current = null;
      }
    }
  }, [stateWithVersionInfo.messages, characterInfo.characterCardName, characterInfo.characterCardId, traitStoreCardId, loadStoreTraits, loadCharacterLoras, characterConfig, updateImageAttachment]);

  // 首次生成（文本气泡「生成图片」按钮调用）（Spec: enhance-conversation-image-bubble / Task 9.1）
  const handleGenerateImage = useCallback(async (messageId: string) => {
    if (isGeneratingImage) return;
    await executeImageGeneration(messageId, false);
  }, [isGeneratingImage, executeImageGeneration]);

  // 重新生成（图片区域「重新生成」按钮调用）（Spec: enhance-conversation-image-bubble / Task 9.1）
  const handleRegenerateImage = useCallback(async (messageId: string) => {
    if (isGeneratingImage) return;
    await executeImageGeneration(messageId, true);
  }, [isGeneratingImage, executeImageGeneration]);

  // 订阅 AI 标签提示词生成阶段进度事件（Spec: enhance-conversation-image-bubble / Task 9.7）
  // 主进程在 generateTraitPrompts 期间推送 phase 变更（tag-generating → tag-auditing），
  // 渲染进程据此更新对应消息 imageAttachment.phase，驱动占位区域阶段进度条切换。
  // 【Phase 1 / H4】标准订阅模式：preload 的 onTraitPromptProgress 返回 unsubscribe 函数
  // （精确 removeListener），cleanup 中直接调用。
  // 【Phase 2 / M8】phase 更新 200ms 节流（trailing）：窗口内仅保留最新 phase。
  useEffect(() => {
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingPhase: TraitPromptPhase | null = null;
    const unsubscribe = aiService.subscribeTraitPromptProgress((data) => {
      const msgId = generatingMessageIdRef.current;
      if (!msgId || !data.phase) return;
      pendingPhase = data.phase;
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        const phase = pendingPhase; // 闭包内用 const 捕获，保证收窄类型
        pendingPhase = null;
        if (phase) {
          updateImageAttachment(msgId, (prev) => prev ? { ...prev, phase } : prev);
          trackPhaseEnter(phase); // 【Phase 2 / M2】阶段切换计时
        }
      }, 200);
    });
    return () => {
      unsubscribe();
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
    };
  }, [updateImageAttachment]);

  return {
    isGeneratingImage,
    executeImageGeneration,
    handleGenerateImage,
    handleRegenerateImage,
    generatingMessageIdRef,
  };
}
