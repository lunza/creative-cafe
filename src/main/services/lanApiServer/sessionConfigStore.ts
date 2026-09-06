/**
 * LAN 会话配置存储（Spec: fix-android-chat-feature-parity / Task 1）
 *
 * 为每个角色卡持久化「LAN 会话配置」（安卓客户端专用，双源并存）：
 *   `{userData}/data/lan-session-config/<hash>.json`
 *
 * 设计要点：
 * - 与桌面端渲染进程 localStorage（character-session-<cardId>）完全独立，
 *   互不迁移、互不读取（spec 明确双源并存，文档注明差异）
 * - 参照 characterLoraService 的按角色哈希存储模式（SHA-256 前 16 位）
 * - 原子写：先写 .tmp 再 rename，避免进程中断产生半截 JSON
 * - 读取失败一律返回安全默认值（不抛异常），保证对话管线可用性优先
 */

import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserDataPath } from '../../utils/appPath';

// ==================== 类型定义 ====================

/** LAN 会话参数子集（对齐桌面端 AIParameterConfig 中 headless 管线实际消费的字段） */
export interface LanCustomParameters {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  /** 最小回复字数下限（注入系统提示词） */
  min_response_chars?: number;
  /** AI 回复语言约束 */
  language?: 'zh' | 'en' | 'ja';
  /** 表情显示开关（false 时不注入表情提示、不解析情绪） */
  expression_display?: boolean;
  /** 对话图片生成开关 */
  image_gen_enabled?: boolean;
  /** 图片输出宽度（64-2048） */
  image_gen_width?: number;
  /** 图片输出高度（64-2048） */
  image_gen_height?: number;
  /** 互动元素标签权重提升（1.0-2.0） */
  interaction_weight?: number;
  /** 思考内容处理三态（Spec: fix-android-chat-parity-v3；strip=存储前剥离 / strip_render=存储保留渲染剥离 / fold=折叠展示） */
  think_tag_mode?: 'strip' | 'strip_render' | 'fold';
  /** 辅助模式开关（开启后 AI 在回复末尾附加 3 个推荐选项） */
  assist_mode?: boolean;
  /** 频率惩罚（防重复；OpenAI 兼容采样参数） */
  frequency_penalty?: number;
  /** 存在惩罚（防重复） */
  presence_penalty?: number;
  /** DRY 采样乘数（仅 supportsDrySampler 引擎注入；0 = 关闭） */
  dry_multiplier?: number;
}

/** LAN 会话配置（每角色一份） */
export interface LanSessionConfig {
  characterCardId: string;
  version: 1;
  /** 选中的用户人设 ID（null = 未选择） */
  selectedPersonaId: string | null;
  /** AI 参数子集（未设置字段沿用引擎级配置） */
  customParameters: LanCustomParameters;
  /** 绑定的知识库文档 ID 列表 */
  boundKnowledgeBaseIds: string[];
  /** 记忆表格开关 */
  memoryTableEnabled: boolean;
  /** 自定义停止序列开关 */
  customStopSequencesEnabled: boolean;
  /** 自定义停止序列数组（每行一个） */
  customStopSequences: string[];
  lastUpdated: number;
}

// ==================== 校验常量与工具 ====================

const NUM_RANGES: Record<string, { min: number; max: number; integer?: boolean }> = {
  temperature: { min: 0, max: 2 },
  top_p: { min: 0, max: 1 },
  max_tokens: { min: 0, max: 100000, integer: true },
  min_response_chars: { min: 0, max: 10000, integer: true },
  image_gen_width: { min: 64, max: 2048, integer: true },
  image_gen_height: { min: 64, max: 2048, integer: true },
  interaction_weight: { min: 1, max: 2 },
  frequency_penalty: { min: -2, max: 2 },
  presence_penalty: { min: -2, max: 2 },
  dry_multiplier: { min: 0, max: 2 },
};

const LANGUAGES = new Set(['zh', 'en', 'ja']);
const THINK_TAG_MODES = new Set(['strip', 'strip_render', 'fold']);
const BOOL_KEYS = new Set(['expression_display', 'image_gen_enabled', 'assist_mode']);
const MAX_STOP_SEQUENCES = 32;
const MAX_STOP_SEQUENCE_LENGTH = 200;
const MAX_KB_BINDINGS = 64;

export interface ValidationIssue {
  field: string;
  reason: string;
}

/**
 * 校验并规整 PUT body（白名单字段）。
 * 返回 issues 数组；空数组表示合法，normalize 后的字段在第二个返回值中。
 */
export function validateAndNormalizeSessionConfig(
  body: unknown
): { issues: ValidationIssue[]; normalized: Partial<LanSessionConfig> | null } {
  const issues: ValidationIssue[] = [];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { issues: [{ field: 'body', reason: '必须是 JSON 对象' }], normalized: null };
  }
  const raw = body as Record<string, unknown>;
  const normalized: Partial<LanSessionConfig> = {};

  // selectedPersonaId：string | null
  if ('selectedPersonaId' in raw) {
    const v = raw.selectedPersonaId;
    if (v === null) {
      normalized.selectedPersonaId = null;
    } else if (typeof v === 'string' && v.length > 0 && v.length <= 256) {
      normalized.selectedPersonaId = v;
    } else {
      issues.push({ field: 'selectedPersonaId', reason: '必须是非空字符串或 null' });
    }
  }

  // customParameters：白名单数值/布尔/枚举
  if ('customParameters' in raw) {
    const cp = raw.customParameters;
    if (typeof cp !== 'object' || cp === null || Array.isArray(cp)) {
      issues.push({ field: 'customParameters', reason: '必须是对象' });
    } else {
      const out: LanCustomParameters = {};
      for (const [key, value] of Object.entries(cp as Record<string, unknown>)) {
        const range = NUM_RANGES[key];
        if (range) {
          if (typeof value !== 'number' || !isFinite(value)) {
            issues.push({ field: `customParameters.${key}`, reason: '必须是数字' });
          } else if (value < range.min || value > range.max) {
            issues.push({ field: `customParameters.${key}`, reason: `范围 ${range.min}-${range.max}` });
          } else if (range.integer && !Number.isInteger(value)) {
            issues.push({ field: `customParameters.${key}`, reason: '必须是整数' });
          } else {
            (out as any)[key] = value;
          }
          continue;
        }
        if (BOOL_KEYS.has(key)) {
          if (typeof value !== 'boolean') {
            issues.push({ field: `customParameters.${key}`, reason: '必须是布尔值' });
          } else {
            (out as any)[key] = value;
          }
          continue;
        }
        if (key === 'language') {
          if (typeof value !== 'string' || !LANGUAGES.has(value)) {
            issues.push({ field: 'customParameters.language', reason: "仅支持 'zh' | 'en' | 'ja'" });
          } else {
            out.language = value as LanCustomParameters['language'];
          }
          continue;
        }
        if (key === 'think_tag_mode') {
          if (typeof value !== 'string' || !THINK_TAG_MODES.has(value)) {
            issues.push({ field: 'customParameters.think_tag_mode', reason: "仅支持 'strip' | 'strip_render' | 'fold'" });
          } else {
            out.think_tag_mode = value as LanCustomParameters['think_tag_mode'];
          }
          continue;
        }
        // 非白名单字段：忽略（不报错，宽松处理未知字段保持前向兼容）
      }
      normalized.customParameters = out;
    }
  }

  // boundKnowledgeBaseIds：string[]
  if ('boundKnowledgeBaseIds' in raw) {
    const v = raw.boundKnowledgeBaseIds;
    if (!Array.isArray(v)) {
      issues.push({ field: 'boundKnowledgeBaseIds', reason: '必须是字符串数组' });
    } else if (v.length > MAX_KB_BINDINGS) {
      issues.push({ field: 'boundKnowledgeBaseIds', reason: `最多 ${MAX_KB_BINDINGS} 项` });
    } else {
      const ids: string[] = [];
      for (const item of v) {
        if (typeof item !== 'string' || !item.trim()) {
          issues.push({ field: 'boundKnowledgeBaseIds', reason: '数组元素必须是非空字符串' });
          break;
        }
        ids.push(item.trim());
      }
      if (!issues.some(i => i.field === 'boundKnowledgeBaseIds')) {
        normalized.boundKnowledgeBaseIds = Array.from(new Set(ids));
      }
    }
  }

  // 布尔开关
  for (const key of ['memoryTableEnabled', 'customStopSequencesEnabled'] as const) {
    if (key in raw) {
      if (typeof raw[key] !== 'boolean') {
        issues.push({ field: key, reason: '必须是布尔值' });
      } else {
        normalized[key] = raw[key] as boolean;
      }
    }
  }

  // customStopSequences：string[]
  if ('customStopSequences' in raw) {
    const v = raw.customStopSequences;
    if (!Array.isArray(v)) {
      issues.push({ field: 'customStopSequences', reason: '必须是字符串数组' });
    } else if (v.length > MAX_STOP_SEQUENCES) {
      issues.push({ field: 'customStopSequences', reason: `最多 ${MAX_STOP_SEQUENCES} 项` });
    } else {
      const stops: string[] = [];
      for (const item of v) {
        if (typeof item !== 'string' || !item.trim()) {
          issues.push({ field: 'customStopSequences', reason: '数组元素必须是非空字符串' });
          break;
        }
        if (item.length > MAX_STOP_SEQUENCE_LENGTH) {
          issues.push({ field: 'customStopSequences', reason: `单项长度上限 ${MAX_STOP_SEQUENCE_LENGTH}` });
          break;
        }
        stops.push(item);
      }
      if (!issues.some(i => i.field === 'customStopSequences')) {
        normalized.customStopSequences = stops;
      }
    }
  }

  return { issues, normalized: issues.length === 0 ? normalized : null };
}

// ==================== 存储实现 ====================

function defaultConfig(characterCardId: string): LanSessionConfig {
  return {
    characterCardId,
    version: 1,
    selectedPersonaId: null,
    customParameters: {},
    boundKnowledgeBaseIds: [],
    memoryTableEnabled: false,
    customStopSequencesEnabled: false,
    customStopSequences: [],
    lastUpdated: 0,
  };
}

function sanitizeCardId(characterCardId: string): string {
  return crypto.createHash('sha256').update(characterCardId, 'utf8').digest('hex').slice(0, 16);
}

class SessionConfigStore {
  private dir: string;

  constructor() {
    this.dir = path.join(getUserDataPath(), 'data', 'lan-session-config');
    fs.mkdir(this.dir, { recursive: true }).catch(err => {
      console.error('[LanSessionConfig] 创建目录失败:', err);
    });
  }

  private fileOf(characterCardId: string): string {
    return path.join(this.dir, `${sanitizeCardId(characterCardId)}.json`);
  }

  /** 读取配置；不存在/损坏时返回安全默认值（不抛异常） */
  async load(characterCardId: string): Promise<LanSessionConfig> {
    const fallback = defaultConfig(characterCardId);
    try {
      const file = this.fileOf(characterCardId);
      if (!fsSync.existsSync(file)) return fallback;
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<LanSessionConfig>;
      // 字段级兜底（防止手工编辑产生缺字段 JSON）
      return {
        characterCardId,
        version: 1,
        selectedPersonaId: typeof parsed.selectedPersonaId === 'string' ? parsed.selectedPersonaId : null,
        customParameters:
          typeof parsed.customParameters === 'object' && parsed.customParameters !== null
            ? parsed.customParameters
            : {},
        boundKnowledgeBaseIds: Array.isArray(parsed.boundKnowledgeBaseIds)
          ? parsed.boundKnowledgeBaseIds.filter((x): x is string => typeof x === 'string')
          : [],
        memoryTableEnabled: parsed.memoryTableEnabled === true,
        customStopSequencesEnabled: parsed.customStopSequencesEnabled === true,
        customStopSequences: Array.isArray(parsed.customStopSequences)
          ? parsed.customStopSequences.filter((x): x is string => typeof x === 'string')
          : [],
        lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : 0,
      };
    } catch (error) {
      console.error('[LanSessionConfig] 读取失败，返回默认配置:', error);
      return fallback;
    }
  }

  /** 原子保存：tmp 写入 → rename */
  async save(characterCardId: string, config: LanSessionConfig): Promise<void> {
    const file = this.fileOf(characterCardId);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }
}

export const sessionConfigStore = new SessionConfigStore();
