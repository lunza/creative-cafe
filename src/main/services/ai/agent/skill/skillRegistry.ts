/**
 * 技能注册中心
 *
 * Agent 技能库（对标 OpenClaw skill 管理体系）的内存注册中心。
 * 负责按 id 注册、查询技能清单（SkillManifest），供 skillService 在文件持久化之上
 * 提供内存索引，供 skillExecutor 在调用时按 id 解析到具体清单。
 *
 * 设计要点（与 toolRegistry 保持一致的风格）：
 * - 同 id 技能禁止重复注册（register 时抛错，让调用方尽早发现问题）；
 *   若需更新已有技能，应由 skillService 先 unregister 再 register（或直接调用 registerSkill
 *   内部已封装该逻辑），而非绕过校验静默覆盖。
 * - 不负责文件持久化——这是 skillService 的职责；本类仅维护内存 Map。
 * - list 支持按 category 与 enabledOnly 过滤；discover 支持按查询字符串模糊匹配
 *   name / description / tags，返回 SkillSummary 摘要供 Agent 决策调用。
 * - 导出单例 skillRegistry，全局共享；测试可用 clear() 重置。
 *
 * 与 toolRegistry 的区别：
 * - 工具是单函数调用，按组（AgentToolGroup）管理；技能是结构化能力单元，按分类
 *   （SkillCategory）管理，且支持 enabled 开关。
 * - 工具的 discover 概念较弱（按组拉取即可）；技能的 discover 是核心能力——
 *   Agent 需要根据自然语言查询找到合适的技能来调用。
 */

import type {
  SkillCategory,
  SkillManifest,
  SkillSummary,
} from './skillTypes'
import { createLogger } from '../../../logger'

const logger = createLogger('skill-registry')

class SkillRegistry {
  /** 技能 id → 技能清单（保持注册顺序，便于 list 稳定输出） */
  private skills = new Map<string, SkillManifest>()

  /**
   * 注册单个技能清单
   *
   * 同 id 防重复：若已存在同 id 技能，抛错（与 toolRegistry.register 一致），
   * 让调用方尽早发现重复注册问题。更新场景应由 skillService 先 unregister 再 register。
   */
  register(manifest: SkillManifest): void {
    if (this.skills.has(manifest.id)) {
      throw new Error(`技能「${manifest.id}」已注册，不可重复注册`)
    }
    this.skills.set(manifest.id, manifest)
    logger.info(`已注册技能: ${manifest.id} (${manifest.name})`)
  }

  /** 注销技能 */
  unregister(id: string): void {
    if (this.skills.delete(id)) {
      logger.info(`已注销技能: ${id}`)
    }
  }

  /** 获取单个技能清单 */
  get(id: string): SkillManifest | undefined {
    return this.skills.get(id)
  }

  /** 判断技能是否存在 */
  has(id: string): boolean {
    return this.skills.has(id)
  }

  /**
   * 列出技能清单（可按分类与启用状态过滤）
   *
   * @param category 可选分类过滤；不传则返回所有分类
   * @param enabledOnly 可选启用状态过滤；true 仅返回 enabled=true 的技能
   * @returns 保持注册顺序的技能清单数组
   */
  list(category?: SkillCategory, enabledOnly?: boolean): SkillManifest[] {
    const result: SkillManifest[] = []
    for (const manifest of this.skills.values()) {
      // 分类过滤：指定了 category 且不匹配时跳过
      if (category !== undefined && manifest.category !== category) continue
      // 启用状态过滤：enabledOnly=true 时仅保留 enabled 技能
      if (enabledOnly === true && !manifest.enabled) continue
      result.push(manifest)
    }
    return result
  }

  /**
   * 发现技能（按查询字符串模糊匹配 name / description / tags）
   *
   * 匹配规则：大小写不敏感的子串匹配。任一字段命中即返回。
   * 仅返回 enabled=true 的技能（禁用技能对 Agent 不可见，避免发现后调用失败）。
   * 返回 SkillSummary 摘要（不含 implementation 等大字段），供 Agent 决策。
   *
   * @param query 查询字符串（如「角色核查」「worldbook」「去重」）
   * @param category 可选分类过滤
   */
  discover(query: string, category?: SkillCategory): SkillSummary[] {
    const q = (query || '').toLowerCase().trim()
    // 空查询：返回所有启用技能摘要（按分类过滤）
    if (q === '') {
      return this.list(category, true).map(toSummary)
    }
    const result: SkillSummary[] = []
    for (const manifest of this.skills.values()) {
      // 仅发现启用的技能（禁用技能对 Agent 不可见）
      if (!manifest.enabled) continue
      // 分类过滤
      if (category !== undefined && manifest.category !== category) continue
      // 模糊匹配 name / description / tags
      const nameHit = manifest.name.toLowerCase().includes(q)
      const descHit = manifest.description.toLowerCase().includes(q)
      const tagHit = manifest.tags.some((t) => t.toLowerCase().includes(q))
      if (nameHit || descHit || tagHit) {
        result.push(toSummary(manifest))
      }
    }
    return result
  }

  /** 清空所有注册（主要供测试用） */
  clear(): void {
    this.skills.clear()
  }
}

/** 将 SkillManifest 转为 SkillSummary 摘要（剥离大字段） */
function toSummary(manifest: SkillManifest): SkillSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    version: manifest.version,
    type: manifest.type,
  }
}

/** 技能注册中心单例，全局共享 */
export const skillRegistry = new SkillRegistry()
