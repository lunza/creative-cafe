/**
 * 错误日志 context 统一构建（Spec: settings-feature-optimization-report / CR-4, M-20）
 *
 * 背景：errorType/errorLocation/errorMessage 三元组结构在 Settings.tsx 与
 * useAIEngineSettings.ts 共 6 处手写，且 useAIEngineSettings.ts 的两处测试
 * 路径字段名漂移为 error_message/error_stack（与其余 4 处 errorMessage 不一致）。
 *
 * 本模块是该三元组的唯一定义点：日志字段名统一为 errorMessage，
 * error_stack 作为附加字段保留（不丢失堆栈信息）。
 */

/** 错误日志 context 标准结构（errorType + errorLocation + errorMessage [+ errorStack]） */
export interface SettingLogContext {
  errorType: string;
  errorLocation: string;
  errorMessage: string;
  /** 错误堆栈（非 Error 对象时为 undefined，避免写入无意义值） */
  errorStack?: string;
}

/**
 * 构建标准错误 context。
 *
 * @param error    捕获到的异常（Error 或任意值）
 * @param location 错误位置标识（如 'Settings.tsx:handleSave'），用于日志检索定位
 */
export function buildErrorContext(error: unknown, location: string): SettingLogContext {
  return {
    errorType: error instanceof Error ? error.name : 'UnknownError',
    errorLocation: location,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
  };
}
