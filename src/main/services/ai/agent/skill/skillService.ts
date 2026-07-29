/**
 * 技能库服务
 *
 * Agent 技能库（对标 OpenClaw skill 管理体系）的公共服务层。
 * 组合 skillRegistry（内存索引）+ skillExecutor（执行调度）+ 文件持久化，
 * 对外提供统一的技能 CRUD / 调用 / 发现 / 版本管理 / 导入导出接口。
 *
 * 职责分层：
 * - skillRegistry：纯内存注册中心（register/unregister/get/list/discover），无 IO
 * - skillExecutor：纯执行调度（按 type 分发），无 IO
 * - skillService（本类）：在两者之上叠加文件持久化、版本历史、初始化加载，
 *   是面向调用方（IPC / Agent 工具）的统一入口
 *
 * 存储布局（userData/skills/）：
 * - builtin/*.json  — 系统内置技能（author='system'）
 * - custom/*.json   — 用户自定义技能（author='user'）
 * - agent/*.json    — Agent 自动生成技能（author='agent'）
 * - versions/<skillId>/<version>.json — 各技能的版本历史条目
 *
 * 设计要点：
 * - 文件 IO 全部使用 fs/promises 异步 API（与 VectorRegistryService 一致）
 * - loadFromDirectory 防御式加载：坏 JSON → 记录日志 + 跳过，不抛错（避免单个坏文件阻塞整个初始化）
 * - initialize 幂等：通过 initialized 标志保证多次调用不会重复加载
 * - registerSkill 支持「更新」语义：若 id 已存在，先 unregister 再 register，
 *   绕开 skillRegistry.register 的同 id 防重复校验（该校验仅防误注册，不挡合法更新）
 * - 每次注册都写入版本历史条目，支持 rollbackSkill 回滚到历史版本
 */

import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import type { AgentToolContext } from '../agentTypes'
import { skillRegistry } from './skillRegistry'
import { skillExecutor } from './skillExecutor'
import type {
  SkillCategory,
  SkillManifest,
  SkillResult,
  SkillSource,
  SkillSummary,
  SkillVersionEntry,
} from './skillTypes'
import { createLogger } from '../../../logger'

const logger = createLogger('skill-service')

/** author → 存储子目录映射 */
const AUTHOR_DIR_MAP: Record<SkillSource, string> = {
  system: 'builtin',
  user: 'custom',
  agent: 'agent',
}

class SkillService {
  /** 初始化幂等标志，保证 loadFromDirectory 仅执行一次 */
  private initialized = false

  /**
   * 注册技能（创建或更新）
   *
   * 流程：
   * 1. 补全 createdAt / updatedAt（若缺失）
   * 2. 若 id 已存在，先从 skillRegistry 注销（支持更新语义；skillRegistry.register 同 id 会抛错）
   * 3. 注册到 skillRegistry 内存索引
   * 4. 持久化 manifest 到 author 子目录文件
   * 5. 写入版本历史条目（每次注册都记录，支持回滚）
   *
   * @param manifest 技能清单
   */
  async registerSkill(manifest: SkillManifest): Promise<void> {
    // 1. 补全时间戳
    const now = new Date().toISOString()
    if (!manifest.createdAt) manifest.createdAt = now
    // updatedAt 始终刷新为当前时间（注册即更新）
    manifest.updatedAt = now

    // 2. 已存在则先注销（支持更新语义）
    if (skillRegistry.has(manifest.id)) {
      skillRegistry.unregister(manifest.id)
    }

    // 3. 注册到内存
    skillRegistry.register(manifest)

    // 4. 持久化到文件
    await this.persistSkill(manifest)

    // 5. 记录版本历史
    await this.saveVersionEntry(manifest)
  }

  /**
   * 注销技能
   *
   * 从 skillRegistry 内存索引移除 + 删除对应文件。
   * 版本历史文件保留（支持追溯已删除技能的历史版本）。
   */
  async unregisterSkill(id: string): Promise<void> {
    const manifest = skillRegistry.get(id)
    if (!manifest) {
      logger.warn(`注销技能失败：技能「${id}」不存在`)
      return
    }
    skillRegistry.unregister(id)
    // 删除 manifest 文件（版本历史保留）
    const filePath = this.getSkillFilePath(manifest)
    try {
      await fs.unlink(filePath)
      logger.info(`已删除技能文件: ${filePath}`)
    } catch (e) {
      // 文件可能已被外部删除，记日志但不抛错
      logger.warn(`删除技能文件失败（可能已不存在）: ${filePath}`, undefined, e)
    }
  }

  /** 获取技能清单（委托 skillRegistry） */
  getSkill(id: string): SkillManifest | undefined {
    return skillRegistry.get(id)
  }

  /** 列出技能（委托 skillRegistry） */
  listSkills(category?: SkillCategory, enabledOnly?: boolean): SkillManifest[] {
    return skillRegistry.list(category, enabledOnly)
  }

  /** 发现技能（委托 skillRegistry） */
  discoverSkills(query: string, category?: SkillCategory): SkillSummary[] {
    return skillRegistry.discover(query, category)
  }

  /**
   * 调用技能
   *
   * 获取 manifest 后委托 skillExecutor.invoke 执行。
   * 技能不存在时返回结构化错误（不抛错）。
   */
  async invokeSkill(
    id: string,
    input: Record<string, any>,
    context?: AgentToolContext
  ): Promise<SkillResult> {
    const manifest = skillRegistry.get(id)
    if (!manifest) {
      return { success: false, error: '技能不存在' }
    }
    if (!manifest.enabled) {
      return { success: false, error: `技能「${id}」已禁用` }
    }
    return await skillExecutor.invoke(manifest, input, context)
  }

  /**
   * 从目录加载所有技能
   *
   * 遍历 builtin / custom / agent 三个子目录下的 *.json，
   * 解析为 SkillManifest 后注册到 skillRegistry。
   *
   * 防御式加载：
   * - 目录不存在则创建（首次启动场景）
   * - 单个文件解析失败 → 记录日志 + 跳过，不抛错
   * - 同 id 重复加载 → 跳过并记录警告（首次加载优先）
   */
  async loadFromDirectory(): Promise<void> {
    const baseDir = path.join(app.getPath('userData'), 'skills')
    const subdirs = ['builtin', 'custom', 'agent']
    let loadedCount = 0

    for (const subdir of subdirs) {
      const dir = path.join(baseDir, subdir)
      try {
        // 确保目录存在（首次启动场景）
        await fs.mkdir(dir, { recursive: true })
      } catch (e) {
        logger.warn(`创建技能目录失败: ${dir}`, undefined, e)
        continue
      }

      let files: string[]
      try {
        files = await fs.readdir(dir)
      } catch (e) {
        logger.warn(`读取技能目录失败: ${dir}`, undefined, e)
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = path.join(dir, file)
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          const manifest = JSON.parse(content) as SkillManifest
          // 同 id 防重复加载（首次加载优先）
          if (skillRegistry.has(manifest.id)) {
            logger.warn(
              `技能「${manifest.id}」已注册，跳过重复加载: ${filePath}`
            )
            continue
          }
          skillRegistry.register(manifest)
          loadedCount++
          logger.info(`已加载技能: ${manifest.id} (${manifest.name}) from ${subdir}`)
        } catch (e) {
          // 单个文件解析失败：记录日志 + 跳过，不抛错
          logger.warn(
            `加载技能文件失败，已跳过: ${filePath}`,
            e instanceof Error ? e.message : String(e)
          )
        }
      }
    }
    logger.info(`从目录加载完成，共加载 ${loadedCount} 个技能`)
  }

  /**
   * 持久化所有已注册技能到文件
   *
   * 遍历 skillRegistry 中所有技能，按 author 子目录写入文件。
   * 单个技能持久化失败不影响其他技能（防御式）。
   */
  async saveToDirectory(): Promise<void> {
    const all = skillRegistry.list()
    let savedCount = 0
    for (const manifest of all) {
      try {
        await this.persistSkill(manifest)
        savedCount++
      } catch (e) {
        logger.warn(
          `持久化技能失败: ${manifest.id}`,
          e instanceof Error ? e.message : String(e)
        )
      }
    }
    logger.info(`持久化完成，共保存 ${savedCount}/${all.length} 个技能`)
  }

  /**
   * 获取技能版本历史
   *
   * 读取 versions/<skillId>/ 下的所有 JSON 文件，按 createdAt 降序排列（最新在前）。
   * 目录不存在或无文件时返回空数组。
   */
  async getSkillHistory(id: string): Promise<SkillVersionEntry[]> {
    const dir = this.getVersionDir(id)
    try {
      const files = await fs.readdir(dir)
      const entries: SkillVersionEntry[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf-8')
          entries.push(JSON.parse(content) as SkillVersionEntry)
        } catch (e) {
          logger.warn(`读取版本文件失败，已跳过: ${file}`, undefined, e)
        }
      }
      // 按 createdAt 降序（最新在前）
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return entries
    } catch (e) {
      // 目录不存在或读取失败：返回空数组
      logger.debug(`技能「${id}」无版本历史或读取失败`, undefined, e)
      return []
    }
  }

  /**
   * 回滚技能到指定版本
   *
   * 读取版本历史条目，取出该版本的 manifest 重新注册（覆盖当前版本）。
   * 回滚会生成一条新的版本历史记录（版本号沿用回滚目标版本）。
   *
   * @param id 技能 id
   * @param version 目标版本号（如 "1.0.0"）
   */
  async rollbackSkill(id: string, version: string): Promise<void> {
    const versionFile = path.join(this.getVersionDir(id), `${version}.json`)
    try {
      const content = await fs.readFile(versionFile, 'utf-8')
      const entry = JSON.parse(content) as SkillVersionEntry
      // 重新注册旧版本 manifest（registerSkill 内部会处理更新语义 + 写新版本条目）
      await this.registerSkill(entry.manifest)
      logger.info(`技能「${id}」已回滚到版本 ${version}`)
    } catch (e) {
      logger.error(
        `回滚技能失败: ${id}@${version}`,
        e instanceof Error ? e.message : String(e)
      )
      throw new Error(
        `回滚技能「${id}」到版本 ${version} 失败: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
    }
  }

  /**
   * 导出技能为 JSON 字符串
   *
   * @returns 美化格式的 manifest JSON 字符串
   * @throws 技能不存在时抛错
   */
  async exportSkill(id: string): Promise<string> {
    const manifest = skillRegistry.get(id)
    if (!manifest) {
      throw new Error(`技能「${id}」不存在，无法导出`)
    }
    return JSON.stringify(manifest, null, 2)
  }

  /**
   * 从 JSON 字符串导入技能
   *
   * 解析 JSON 后调用 registerSkill（支持新建与覆盖更新）。
   * @throws JSON 解析失败或 manifest 不合法时抛错
   */
  async importSkill(json: string): Promise<void> {
    let manifest: SkillManifest
    try {
      manifest = JSON.parse(json) as SkillManifest
    } catch (e) {
      throw new Error(
        `导入技能失败：JSON 解析错误: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
    }
    await this.registerSkill(manifest)
  }

  /**
   * 初始化服务
   *
   * 幂等：通过 initialized 标志保证多次调用仅首次执行 loadFromDirectory。
   * 调用方（如应用启动流程）可安全重复调用。
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('skillService 已初始化，跳过重复初始化')
      return
    }
    await this.loadFromDirectory()
    this.initialized = true
    logger.info('skillService 初始化完成')
  }

  // ===== 私有辅助方法 =====

  /**
   * 获取技能 manifest 文件路径
   *
   * 布局：userData/skills/<author-dir>/<id>.json
   * author-dir 由 author 字段映射：system→builtin, user→custom, agent→agent
   */
  private getSkillFilePath(manifest: SkillManifest): string {
    const subdir = AUTHOR_DIR_MAP[manifest.author] ?? 'custom'
    return path.join(app.getPath('userData'), 'skills', subdir, `${manifest.id}.json`)
  }

  /** 获取技能版本历史目录：userData/skills/versions/<id>/ */
  private getVersionDir(id: string): string {
    return path.join(app.getPath('userData'), 'skills', 'versions', id)
  }

  /** 持久化单个技能 manifest 到文件 */
  private async persistSkill(manifest: SkillManifest): Promise<void> {
    const filePath = this.getSkillFilePath(manifest)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8')
  }

  /**
   * 写入版本历史条目
   *
   * 文件名：<version>.json（如 "1.0.0.json"）
   * 同版本号会覆盖（保留最新一次该版本的 manifest 快照）。
   */
  private async saveVersionEntry(
    manifest: SkillManifest,
    changeLog?: string
  ): Promise<void> {
    const dir = this.getVersionDir(manifest.id)
    await fs.mkdir(dir, { recursive: true })
    const entry: SkillVersionEntry = {
      version: manifest.version,
      manifest,
      createdAt: new Date().toISOString(),
      changeLog,
    }
    const file = path.join(dir, `${manifest.version}.json`)
    await fs.writeFile(file, JSON.stringify(entry, null, 2), 'utf-8')
  }
}

/** 技能库服务单例，全局共享 */
export const skillService = new SkillService()
