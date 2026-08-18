/**
 * AI 辅助角色特征生成 IPC 处理器（Spec: add-asset-and-trait-management / Task 12）
 *
 * 通道列表：
 *   - ai:generateCharacterTraits       基于角色卡 description/personality/scenario 调用 LLM
 *                                      生成视觉特征 tag 列表（非流式）
 *   - ai:recognizeImageTraits          通过多模态模型识别角色卡 PNG 图片提取视觉特征 tag
 *   - ai:generateTraitPrompts          将用户自由文本提示词解析为分类 SD tag（Spec: add-prompt-generation-in-asset-modal）
 *                                      在 AI 素材生成弹窗中提供「提示词生成」入口，
 *                                      生成结果携带 categoryId / translation / originalText，
 *                                      可直接追加到 editedTraits，复用 L0-L5 完整审计链
 *   - ai:optimizeTraitsForContext      根据对话上下文分析角色特征标签的矛盾关系，返回应删除的标签列表
 *                                      （Spec: add-ai-trait-optimization-for-image-gen）
 *                                      入参 { traits, conversationContext }，返回 { success, tagsToRemove?, error? }
 *
 * 事件通道（主进程 → 渲染进程单向推送）：
 *   - ai:traitPromptProgress           图片生成阶段进度事件（Spec: enhance-conversation-image-bubble / Task 3）
 *                                      在 ai:generateTraitPrompts handler 内推送，payload 为 { phase }
 *                                      phase 取值：'tag-generating'（调用 service 前）/ 'tag-auditing'（service 返回后）
 *                                      渲染进程通过 preload.ai.onTraitPromptProgress 订阅，用于切换占位文案
 *
 * 注册模式参照 registerCharacterTraitHandlers() / registerAssetHandlers()：
 * 导出 registerCharacterTraitAIHandlers() 函数，由 ipc/index.ts 调用。
 *
 * 参数与返回值与 characterTraitAIService 各方法签名对齐：
 *   - generateCharacterTraits：{ characterCardId, description, personality?, scenario? } → { success, traits?, error? }
 *   - recognizeImageTraits：{ characterCardPath, characterName? } → { success, traits?, error? }
 *   - generateTraitPrompts：{ prompt, baseTraits? } → { success, traits?, error?, ragDebug? }
 *
 * 与 aiHandlers.ts（ai:request / ai:cancel / ai:listModels）的关系：
 *   - aiHandlers.ts 提供通用 HTTP 转发（前端自己拼 messages），是低层通道
 *   - 本 handler 是高层业务通道（service 内部读 AI 配置 + 拼 prompt + 解析响应）
 *   - 命名空间统一在 ai: 下，与 Spec SubTask 12.3 要求一致
 *
 * service 内部已 try/catch 兜底；外层 handler 再 try/catch 提供 IPC 序列化兜底，
 * 保证渲染进程永不收到 reject（与 characterTraitHandlers / assetHandlers 一致）。
 */
import { ipcMain } from 'electron';
import { characterTraitAIService } from '../../services/characterTraitAIService';
import type {
  GenerateCharacterTraitsParams,
  GenerateTraitPromptsParams,
  OptimizeTraitsParams,
  OptimizeTraitsResult,
  RecognizeImageTraitsParams
} from '../../services/characterTraitAIService';

export function registerCharacterTraitAIHandlers() {
  /**
   * 调用 LLM 生成角色视觉特征 tag 列表。
   *
   * 入参：
   *   - characterCardId：角色卡 ID（必填，用于日志关联）
   *   - description：角色描述（必填）
   *   - personality：角色性格（可选）
   *   - scenario：角色场景（可选）
   *
   * 返回：
   *   - success=true：traits 为 tag 字符串数组（可能为空，表示 LLM 未提取到）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 错误场景：
   *   - AI 引擎未配置（baseUrl/apiKey/modelName 缺失）
   *   - 调用失败（网络/超时/HTTP 错误）
   *   - 返回格式异常（空内容/无法解析）
   */
  ipcMain.handle(
    'ai:generateCharacterTraits',
    async (_event, args: GenerateCharacterTraitsParams) => {
      try {
        return await characterTraitAIService.generateCharacterTraits(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] generateCharacterTraits failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 通过多模态模型识别角色卡图片，提取视觉特征 tag 列表（Spec: add-model-capability-detection-and-image-recognition / Task 6）。
   *
   * 入参：
   *   - characterCardPath：角色卡 PNG 图片路径（必填）
   *   - characterName：角色名（可选，注入 prompt 提供上下文）
   *
   * 返回：
   *   - success=true：traits 为 tag 字符串数组（可能为空，表示模型未提取到）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 前置条件：当前 AI 引擎需 supportsVision=true（由前端判断，handler 不重复检测）
   *
   * 错误场景：
   *   - AI 引擎未配置（baseUrl/apiKey/modelName 缺失）
   *   - 角色卡图片读取失败（文件不存在/无权限）
   *   - 调用失败（网络/超时/HTTP 错误）
   *   - 返回格式异常（空内容/无法解析）
   */
  ipcMain.handle(
    'ai:recognizeImageTraits',
    async (_event, args: RecognizeImageTraitsParams) => {
      try {
        return await characterTraitAIService.recognizeImageTraits(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] recognizeImageTraits failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 将用户自由文本提示词解析为分类 SD tag（Spec: add-prompt-generation-in-asset-modal）。
   *
   * 通道用途：
   *   - 接收用户在 AI 素材生成弹窗「提示词生成」面板输入的自由文本提示词
   *     （如 "red hair, blue dress, forest background"），由主进程 LLM 解析为
   *     分类特征 tag 列表（含 categoryId / translation / originalText）
   *   - 输出可直接追加到 AssetGenerateModal.editedTraits，无需二次处理
   *
   * 入参：
   *   - prompt：用户输入的提示词（必填非空，空/纯空白触发兜底错误）
   *   - baseTraits：当前已有特征文本（可选，逗号分隔，作为上下文避免重复生成）
   *
   * 返回：
   *   - success=true：traits 为分类特征数组（含 translation + originalText）
   *     ragDebug 为 RAG 标签库质检报告（与 generateCharacterTraits 结构兼容）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 错误场景（service 内部已兜底为 `{ success: false, error }`，handler 再 try/catch
   * 提供 IPC 序列化兜底，保证渲染进程永不收到 reject）：
   *   - 空输入：prompt 为空或纯空白 → 「请输入提示词」（不调用 LLM）
   *   - AI 引擎未配置：baseUrl / apiKey / modelName 任一缺失
   *   - 引擎参数缺失：temperature / max_tokens 未配置
   *   - 调用失败：网络 / 超时 / HTTP 错误
   *   - 解析失败：LLM 返回空内容 / 无法解析为分类 tag
   *
   * 审计流程（与 generateCharacterTraits 完全一致，L0-L5 完整审计链）：
   *   - L0 自定义同义词映射（userSynonymMapService）
   *   - L1 name 精确匹配 / L2 alias 精确匹配
   *   - L3 颜色复合词拆分 / L3b 否定性修饰词剥离
   *   - L4 语义 KNN 替换（score >= 0.3 自动替换）
   *   - L5 AI 兜底（LLM 生成候选词 → 再走 L0-L4 → 命中替换 + 持久化）
   */
  ipcMain.handle(
    'ai:generateTraitPrompts',
    async (event, args: GenerateTraitPromptsParams) => {
      // Spec: enhance-conversation-image-bubble / Task 3 — IPC 进度事件
      //
      // service.generateTraitPrompts 内部串行执行「LLM 生成 tag」+「applyTagAudit（L0-L5 审核）」，
      // handler 无法在两阶段之间精确插入事件。故采用方案 (b) 最小改动：
      //   - 调用 service 前推送 { phase: 'tag-generating' }（渲染进程显示「标签生成中…」）
      //   - service 返回后、return 前推送 { phase: 'tag-auditing' }（渲染进程显示「标签审核中…」，
      //     在拿到结果到发起 sd.generateTxt2Img 之间展示此状态）
      //
      // phase 取值与 preload.ts / electron.d.ts 的 onTraitPromptProgress 类型契约一致：
      //   'tag-generating' | 'tag-auditing' | 'image-generating'
      // （spec.md 场景文字中的 'auditing' 为简写，canonical 名称为 'tag-auditing'，
      //   否则渲染进程 phase === 'tag-auditing' 判断永不命中）
      //
      // 推送事件与 return 独立：发送失败（如渲染进程已销毁）不影响返回值与错误处理。
      const sendProgress = (phase: 'tag-generating' | 'tag-auditing' | 'image-generating') => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('ai:traitPromptProgress', { phase });
          }
        } catch (sendError) {
          // 渲染进程可能已销毁，忽略进度事件发送失败（不影响主流程）
          console.warn('[CharacterTraitAIHandler] traitPromptProgress send failed:', sendError);
        }
      };

      try {
        sendProgress('tag-generating');
        const result = await characterTraitAIService.generateTraitPrompts(args);
        sendProgress('tag-auditing');
        return result;
      } catch (error) {
        console.error('[CharacterTraitAIHandler] generateTraitPrompts failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * AI 自定义情绪提示词生成（Spec: enhance-custom-emotion-system）。
   *
   * 通道用途：
   *   - 接收用户输入的情绪关键词（如"热恋"）
   *   - 由主进程 LLM 生成 4 维度 SD tag（FACE / ACTION / SYMBOL / BACKGROUND）+ NL 描述
   *   - 执行标签审计链验证
   *   - 返回 { positive, nlPrompt, auditDetails }
   */
  ipcMain.handle(
    'ai:generateEmotionPrompts',
    async (_event, args: { emotionLabel: string; existingKeys?: string[] }) => {
      try {
        return await characterTraitAIService.generateEmotionPrompts(args.emotionLabel, args.existingKeys);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] generateEmotionPrompts failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * AI 标签优化：根据对话上下文分析角色特征标签的矛盾关系，返回应删除的标签列表。
   *
   * Spec: add-ai-trait-optimization-for-image-gen
   *
   * 通道用途：
   *   - 接收当前已启用的角色特征标签列表 + 对话上下文
   *   - 由主进程 LLM 分析标签与对话上下文的矛盾（如角色卡标签为「长发」但对话上下文描述为「短发」）
   *   - 返回应删除的标签列表（含原因），前端据此提示用户确认删除
   *
   * 入参：
   *   - traits：当前已启用的角色特征标签列表（{ text, weight?, categoryId? }）
   *   - conversationContext：当前对话上下文（用户与角色的完整对话文本）
   *
   * 返回：
   *   - success=true：tagsToRemove 为建议删除的标签列表（含 reason；可能为空数组，表示无矛盾）
   *   - success=false：error 为友好错误信息（非堆栈）
   *
   * 错误场景（service 内部已兜底为 `{ success: false, error }`，handler 再 try/catch
   * 提供 IPC 序列化兜底，保证渲染进程永不收到 reject）：
   *   - 空输入：conversationContext 为空或纯空白 → 「对话上下文为空」（不调用 LLM）
   *   - 空标签：traits 为空数组 → 直接返回 success=true, tagsToRemove=[]（不调用 LLM）
   *   - AI 引擎未配置：baseUrl / apiKey / modelName 任一缺失
   *   - 引擎参数缺失：temperature / max_tokens 未配置
   *   - 调用失败：网络 / 超时 / HTTP 错误
   *   - 解析失败：LLM 返回空内容 / 无法解析为 JSON
   */
  ipcMain.handle(
    'ai:optimizeTraitsForContext',
    async (_event, args: OptimizeTraitsParams): Promise<OptimizeTraitsResult> => {
      try {
        return await characterTraitAIService.optimizeTraitsForContext(args);
      } catch (error) {
        console.error('[CharacterTraitAIHandler] optimizeTraitsForContext failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
