/**
 * 设置结构校验器（Spec: settings-feature-optimization-report / M-10, ST-6 + N3）
 *
 * 背景：settingService.validateSetting 是 no-op（恒返回 valid:true），设置保存
 * 链路（settingHandlers → storageService.setSettings）无任何真实校验；坏数据
 * 静默落盘后由消费方各自兜底（DC-2 隐式兼容）。
 *
 * 本校验器是保存链路与 N3 迁移链（shared/settingMigrations.ts）共用的唯一
 * 结构校验入口。校验策略为「结构级」而非「穷尽字段级」：AIEngineSetting 有
 * 130+ 字段，逐字段校验会随类型演进腐烂；这里只校验坏数据会导致运行时
 * 崩溃/链路瘫痪的骨架键。
 *
 * 纯函数，无依赖，主进程/渲染进程均可用。
 */

import type { SettingValidationResult } from './types/setting.types';

const VALID_LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug']);
const VALID_EMBEDDING_MODES = new Set(['remote', 'local', 'disabled']);

/**
 * 校验设置对象的结构完整性。
 *
 * 校验规则（仅骨架键，全部缺失容忍——允许部分配置存在）：
 * - setting 必须是非数组对象
 * - aiEngines 若存在：非空数组，每个引擎 id/name/api_url/model_name 为字符串
 * - logLevel 若存在：∈ error|warn|info|debug
 * - vector.embeddingMode 若存在：∈ remote|local|disabled
 * - activeEngineId 若存在且 aiEngines 非空：必须命中某引擎 id
 *
 * @returns valid + errors 清单（valid=true 时 errors 为空）
 */
export function validateSetting(setting: unknown): SettingValidationResult {
  const errors: string[] = [];

  if (setting === null || typeof setting !== 'object' || Array.isArray(setting)) {
    return { valid: false, errors: ['设置必须是对象'] };
  }
  const s = setting as Record<string, unknown>;

  if (s.aiEngines !== undefined) {
    if (!Array.isArray(s.aiEngines) || s.aiEngines.length === 0) {
      errors.push('aiEngines 必须是非空数组');
    } else {
      s.aiEngines.forEach((engine, i) => {
        if (engine === null || typeof engine !== 'object' || Array.isArray(engine)) {
          errors.push(`aiEngines[${i}] 必须是对象`);
          return;
        }
        const e = engine as Record<string, unknown>;
        for (const field of ['id', 'name', 'api_url', 'model_name'] as const) {
          if (e[field] !== undefined && typeof e[field] !== 'string') {
            errors.push(`aiEngines[${i}].${field} 必须是字符串`);
          }
        }
      });
    }
  }

  if (s.logLevel !== undefined && !VALID_LOG_LEVELS.has(String(s.logLevel))) {
    errors.push(`logLevel 非法：${String(s.logLevel)}（允许 error|warn|info|debug）`);
  }

  const vector = s.vector;
  if (vector !== null && typeof vector === 'object' && !Array.isArray(vector)) {
    const embeddingMode = (vector as Record<string, unknown>).embeddingMode;
    if (embeddingMode !== undefined && !VALID_EMBEDDING_MODES.has(String(embeddingMode))) {
      errors.push(`vector.embeddingMode 非法：${String(embeddingMode)}`);
    }
  } else if (vector !== undefined && vector !== null) {
    errors.push('vector 必须是对象');
  }

  if (
    typeof s.activeEngineId === 'string' &&
    Array.isArray(s.aiEngines) &&
    s.aiEngines.length > 0 &&
    !s.aiEngines.some(
      (e): e is { id: string } =>
        !!e && typeof e === 'object' && (e as { id?: unknown }).id === s.activeEngineId,
    )
  ) {
    errors.push(`activeEngineId "${s.activeEngineId}" 不在 aiEngines 中`);
  }

  return { valid: errors.length === 0, errors };
}
