/**
 * 世界书编写智能体 barrel 导出
 *
 * 来源：spec §二 Task 4.7 / `implement-worldbook-authoring-agent`
 *
 * 导出三大服务 + 类型 re-export，便于外部模块统一引用：
 *  - worldbookAuthoringService：编排核心（三阶段状态机）
 *  - worldbookAuditService：审计服务（三维度质量把控）
 *  - worldbookPlanningService：规划服务（对话式需求澄清）
 *
 * 用法：
 * ```ts
 * import {
 *   worldbookAuthoringService,
 *   worldbookAuditService,
 *   worldbookPlanningService,
 * } from './worldbook';
 * ```
 */

// ==================== 编排服务（Task 4） ====================

export {
  WorldBookAuthoringService,
  getWorldBookAuthoringService,
  getWorldBookAuthoringServiceSync,
  resetWorldBookAuthoringService,
  createDefaultAuthoringTools,
  createDefaultEntryGenerator,
} from './worldbookAuthoringService';

export type {
  IAuthoringTools,
  IEntryGenerator,
  ISteerSink,
  IGoalSink,
  WorldBookAuthoringServiceDeps,
} from './worldbookAuthoringService';

// ==================== 审计服务（Task 2） ====================

export { WorldBookAuditService, worldbookAuditService } from './worldbookAuditService';

export type {
  IEmbeddingProvider,
  IVectorStoreProvider,
  LLMCompareFn,
  WorldBookAuditServiceDeps,
} from './worldbookAuditService';

// ==================== 规划服务（Task 3） ====================

export {
  WorldBookPlanningService,
  worldbookPlanningService,
  createDefaultLLMCallFn,
  parseJsonLoose,
  generateDimensionId,
  inferDefaultKeywordStrategy,
} from './worldbookPlanningService';

export type { LLMCallFn, PlanningLLMConfig } from './worldbookPlanningService';

// ==================== 类型契约（Task 1） ====================

export type {
  WorldBookAuthoringConfig,
  WorldBookAuthoringLLMConfig,
  WorldBookAuthoringAgentCoreConfig,
  IAuditServices,
  IPlanningServices,
  WorldBookAuthoringProgressCallback,
  WorldBookAuthoringRunRequest,
  WorldBookAuthoringRunResult,
} from './worldbookAuthoringTypes';

// ==================== 共享类型 re-export（SSOT） ====================

export type {
  AuthoringState,
  AuthoringDimensionCategory,
  AuthoringDimensionSource,
  KeywordStrategy,
  AuthoringDimension,
  ClarifyingQuestion,
  AuthoringGoal,
  AuthoringPlan,
  AuthoringSession,
  AuditSeverity,
  MissingField,
  UnderfilledDimension,
  CompletenessReport,
  ConsistencyIssue,
  ConsistencyReport,
  DeviatedEntry,
  ConformanceReport,
  AuditAutoFix,
  AuditUserDecision,
  AuditReport,
  AuthoringProgressEvent,
  AuthoringConfig,
  WorldBookAuthoringSession,
  WorldBookAuthoringProgressEvent,
  WorldBookAuthoringAuditReport,
  WorldBookAuthoringPlan,
} from '../../../../shared/types/worldbook-authoring.types';

export {
  DEFAULT_AUTHORING_CONFIG,
  AUDIT_SEVERITY_ORDER,
  meetsAuditSeverityThreshold,
} from '../../../../shared/types/worldbook-authoring.types';
