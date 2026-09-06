/**
 * 统一参数注入器 — ParameterInjector
 *
 * Spec: redesign-dialogue-pipeline-architecture / ParameterInjector
 *
 * 消除 requestAIResponse、generateUserReply、polishInput 三处重复的参数注入逻辑。
 * 提供三级参数合并、引擎配置构建和停止序列生成三个核心方法。
 */

import type {
  AIParameterConfig,
  EffectiveAIParams,
  AIEngineConfig,
  EngineCapabilities,
  PipelineMode,
} from './pipeline.types';

import {
  buildSamplingExtras,
  getDefaultEngineCapabilities,
} from '../../../Common/ChatEngine/ChatEngine.types';

import {
  buildStopSequences as buildStopSequencesImpl,
  buildStopSequencesForUserReply,
} from '../PromptBuilder';

import { DEFAULT_MAX_TOKENS } from '../TokenManagement';

// Spec: analyze-llamacpp-model-compatibility
// 硬编码兜底值统一改为共享"通用"模型系列模板常量（引擎值缺失时的最后兜底，
// 保证对话默认参数与参数模板体系同源）
import { GENERIC_MODEL_PARAMS } from '../../../../../shared/modelParameterPresets';

/** 默认 temperature（引擎未配置时兜底，来源：通用模型系列模板） */
const DEFAULT_TEMPERATURE = GENERIC_MODEL_PARAMS.temperature;

export class ParameterInjector {
  /**
   * 三级合并：customParameters > globalEngine > defaults
   *
   * 迁移自 CharacterDialogueChat.hooks.ts::getEffectiveParams（约 174-285 行）。
   * 包含全部参数：temperature / max_tokens / top_p / frequency_penalty /
   * presence_penalty / repetition_penalty / DRY 采样组 / no_repeat_ngram_size /
   * top_k / min_p。
   *
   * @param custom 角色会话级自定义参数（来自 sessionConfig.customParameters）
   * @param engine 全局引擎配置（来自 setting.aiEngines 中激活的引擎）
   * @returns 合并后的有效参数
   */
  getEffectiveParams(custom: AIParameterConfig, engine: AIEngineConfig): EffectiveAIParams {
    const customParams = custom || {};
    const globalEngine = engine || ({} as AIEngineConfig);

    const hasCustomParams = Object.keys(customParams).length > 0;
    const source: 'global' | 'custom' = hasCustomParams ? 'custom' : 'global';

    const effectiveParams: EffectiveAIParams = {
      temperature: customParams.temperature ?? globalEngine.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: customParams.max_tokens !== undefined
        ? customParams.max_tokens
        : (globalEngine.max_tokens !== undefined ? globalEngine.max_tokens : DEFAULT_MAX_TOKENS),
      source,
    };

    // 可选参数：top_p
    if (customParams.top_p !== undefined) {
      effectiveParams.top_p = customParams.top_p;
    } else if (globalEngine.top_p !== undefined) {
      effectiveParams.top_p = globalEngine.top_p;
    }

    // 可选参数：frequency_penalty
    if (customParams.frequency_penalty !== undefined) {
      effectiveParams.frequency_penalty = customParams.frequency_penalty;
    } else if (globalEngine.frequency_penalty !== undefined) {
      effectiveParams.frequency_penalty = globalEngine.frequency_penalty;
    }

    // 可选参数：presence_penalty
    if (customParams.presence_penalty !== undefined) {
      effectiveParams.presence_penalty = customParams.presence_penalty;
    } else if (globalEngine.presence_penalty !== undefined) {
      effectiveParams.presence_penalty = globalEngine.presence_penalty;
    }

    // 可选参数：repetition_penalty（兼容 SillyTavern 风格的 aiEngines.rep_pen 字段）
    if (customParams.repetition_penalty !== undefined) {
      effectiveParams.repetition_penalty = customParams.repetition_penalty;
    } else if ((globalEngine as any).rep_pen !== undefined) {
      effectiveParams.repetition_penalty = (globalEngine as any).rep_pen;
    }

    // 可选参数：DRY 采样组
    if (customParams.dry_multiplier !== undefined) {
      effectiveParams.dry_multiplier = customParams.dry_multiplier;
    } else if (globalEngine.dry_multiplier !== undefined) {
      effectiveParams.dry_multiplier = globalEngine.dry_multiplier;
    }
    if (customParams.dry_base !== undefined) {
      effectiveParams.dry_base = customParams.dry_base;
    } else if (globalEngine.dry_base !== undefined) {
      effectiveParams.dry_base = globalEngine.dry_base;
    }
    if (customParams.dry_allowed_length !== undefined) {
      effectiveParams.dry_allowed_length = customParams.dry_allowed_length;
    } else if (globalEngine.dry_allowed_length !== undefined) {
      effectiveParams.dry_allowed_length = globalEngine.dry_allowed_length;
    }
    if (customParams.no_repeat_ngram_size !== undefined) {
      effectiveParams.no_repeat_ngram_size = customParams.no_repeat_ngram_size;
    } else if (globalEngine.no_repeat_ngram_size !== undefined) {
      effectiveParams.no_repeat_ngram_size = globalEngine.no_repeat_ngram_size;
    }

    // top_k / min_p 合并
    if (customParams.top_k !== undefined) {
      effectiveParams.top_k = customParams.top_k;
    } else if (globalEngine.top_k !== undefined) {
      effectiveParams.top_k = globalEngine.top_k;
    }
    if (customParams.min_p !== undefined) {
      effectiveParams.min_p = customParams.min_p;
    } else if (globalEngine.min_p !== undefined) {
      effectiveParams.min_p = globalEngine.min_p;
    }

    return effectiveParams;
  }

  /**
   * 根据 capabilities 构建完整的引擎配置。
   *
   * 迁移自 CharacterDialogueChat.hooks.ts 中的 engineConfigWithParams 构建逻辑
   * （约 641-707 行），消除三处重复代码。
   *
   * 统一处理 top_p / top_k / min_p / frequency_penalty / presence_penalty 的直接注入，
   * 以及 repetition_penalty / DRY 采样组 / no_repeat_ngram_size 的能力门控注入
   * （通过 buildSamplingExtras 按 capabilities 决定是否包含，含默认值兜底）。
   *
   * @param base 基础引擎配置（来自全局 setting 中激活的引擎）
   * @param params 合并后的有效参数
   * @param capabilities 后端能力探测结果
   * @returns 注入参数后的完整引擎配置
   */
  buildEngineConfig(
    base: AIEngineConfig,
    params: EffectiveAIParams,
    capabilities: EngineCapabilities
  ): AIEngineConfig {
    // 克隆基础配置，保留 id / name / api_url / api_key / model_name / api_mode 等连接字段
    const config: AIEngineConfig = {
      ...base,
      // 覆盖核心参数
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      // 能力探测：优先用引擎显式配置，缺省用传入的 capabilities
      capabilities: base.capabilities || capabilities || getDefaultEngineCapabilities(),
    };

    // ===== 非能力门控参数：直接注入（与 hooks.ts 一致） =====
    if (params.top_p !== undefined) {
      config.top_p = Number(params.top_p);
    }
    if (params.frequency_penalty !== undefined) {
      config.frequency_penalty = Number(params.frequency_penalty);
    }
    if (params.presence_penalty !== undefined) {
      config.presence_penalty = Number(params.presence_penalty);
    }
    if (params.top_k !== undefined) {
      config.top_k = Number(params.top_k);
    }
    if (params.min_p !== undefined) {
      config.min_p = Number(params.min_p);
    }

    // ===== 能力门控参数：使用 buildSamplingExtras 按 capabilities 注入 =====
    // buildSamplingExtras 仅返回能力启用时的参数（含默认值兜底），
    // 替代 hooks.ts 中逐个 if 判断 + ChatEngine 层二次过滤的重复逻辑。
    const extras = buildSamplingExtras(
      {
        repetition_penalty: params.repetition_penalty,
        dry_multiplier: params.dry_multiplier,
        dry_base: params.dry_base,
        dry_allowed_length: params.dry_allowed_length,
        no_repeat_ngram_size: params.no_repeat_ngram_size,
        capabilities,
        api_mode: base.api_mode,
      },
      capabilities
    );

    // 将 buildSamplingExtras 返回的能力门控参数合并到 config
    // 仅包含 supportsRepPen / supportsDrySampler 启用时的字段，未启用时自动省略
    if (extras.repetition_penalty !== undefined) {
      config.repetition_penalty = extras.repetition_penalty;
    }
    if (extras.dry_multiplier !== undefined) {
      config.dry_multiplier = extras.dry_multiplier;
    }
    if (extras.dry_base !== undefined) {
      config.dry_base = extras.dry_base;
    }
    if (extras.dry_allowed_length !== undefined) {
      config.dry_allowed_length = extras.dry_allowed_length;
    }
    if (extras.no_repeat_ngram_size !== undefined) {
      config.no_repeat_ngram_size = extras.no_repeat_ngram_size;
    }

    return config;
  }

  /**
   * 根据管线模式构建停止序列。
   *
   * 迁移自 PromptBuilder.ts::buildStopSequences 和 buildStopSequencesForUserReply。
   *
   * 模式与停止序列对应关系：
   * - dialogue / continuation / retry：用户名变体（阻断 AI 代替用户发言）
   * - userReply：角色名变体（阻断 AI 越权代替角色发言）
   * - polish：空数组（润色模式无需停止序列）
   *
   * @param mode 管线模式
   * @param charName 角色名（缺省 'Character'）
   * @param userName 用户名（缺省 'User'）
   * @returns 停止序列数组
   */
  buildStopSequences(mode: PipelineMode, charName: string, userName: string): string[] {
    switch (mode) {
      case 'dialogue':
      case 'continuation':
      case 'retry':
        // 用户名变体：阻断 AI 代替用户发言
        return buildStopSequencesImpl(userName);

      case 'userReply':
        // 角色名变体：阻断 AI 越权代替角色发言
        return buildStopSequencesForUserReply(charName);

      case 'polish':
        // 润色模式无需停止序列
        return [];

      default:
        return [];
    }
  }
}
