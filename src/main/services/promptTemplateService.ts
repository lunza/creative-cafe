/**
 * 提示词模板服务
 * 负责提示词模板的存储、构建、校验和历史版本管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataPath } from '../utils/appPath';
import { getStorageService } from './storageService';
import { aiService } from './AIService';
import {
  PromptTemplate,
  PromptHistoryRecord,
  BuiltPrompt,
  ValidationResult,
  ValidationIssue,
  PromptModuleId,
  PromptVariable,
  PromptPart,
  PromptFramework,
  PromptMetadata,
  PromptPolishRequest,
  PromptPolishResult
} from '../../shared/types/promptTemplate.types';

class PromptTemplateService {
  private static readonly SCHEMA_VERSION = 5; // v5: 新增世界书模块13个提示词模板
  private templatesPath: string;
  private historyPath: string;
  private templates: Map<string, PromptTemplate> = new Map();
  private history: Map<string, PromptHistoryRecord[]> = new Map();
  private initialized: boolean = false;

  constructor() {
    const baseDataPath = path.join(getUserDataPath(), 'data');
    this.templatesPath = path.join(baseDataPath, 'prompt-templates.json');
    this.historyPath = path.join(baseDataPath, 'prompt-templates-history.json');
    this.initialize();
  }

  /**
   * 初始化：从文件加载模板和历史记录，失败时使用默认模板
   */
  private initialize(): void {
    try {
      this.loadTemplates();
      this.loadHistory();
      this.initialized = true;
    } catch (error) {
      console.error('[PromptTemplateService] 初始化失败，使用默认模板:', error);
      this.loadDefaults();
      this.initialized = true;
    }
  }

  /**
   * 原子写入：先写入 .tmp 文件，再重命名为目标文件
   */
  private atomicWrite(filePath: string, data: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * 从文件加载模板
   *
   * 持久化策略：
   * 1. SCHEMA_VERSION 不匹配 → 破坏性重置（结构变更，如 parts 类型定义变化）
   * 2. SCHEMA_VERSION 匹配 → 从文件加载用户模板，然后增量合并新增的默认模板
   *    （保留用户对已有模板的修改，自动补充新模板）
   */
  private loadTemplates(): void {
    try {
      if (fs.existsSync(this.templatesPath)) {
        const raw = fs.readFileSync(this.templatesPath, 'utf-8');
        const data = JSON.parse(raw);

        // 检查 schema 版本，不匹配则用默认模板重新初始化（破坏性重置）
        if (data._schemaVersion !== PromptTemplateService.SCHEMA_VERSION) {
          console.log('[PromptTemplateService] Schema 版本不匹配，使用默认模板重新初始化');
          this.loadDefaults();
          this.persistTemplates();
          return;
        }

        // 移除元数据字段后加载模板
        delete data._schemaVersion;
        this.templates = new Map(Object.entries(data));

        // 增量合并：补充默认模板中有但用户文件中缺失的新模板
        this.mergeNewDefaultTemplates();

        // 【内容迁移 - Spec: fix-dialogue-worldbook-association-and-tag-output】
        // continuation 模板白名单补充表情/选项标签豁免（已有安装的持久化副本
        // 不会经 mergeNewDefaultTemplates 更新，需按锚点做非破坏性内容迁移）
        this.migrateContinuationWhitelist();

        // 【内容迁移 - Spec: fix-character-card-field-scope-flash-models】
        // 角色卡三模板（translate/polish/generate）补充目标字段作用域声明：
        // Flash 模型（glm5.3-flash/qwen3.8-flash 等）会忽略"仅处理目标字段"要求，
        // 输出完整角色卡内容；存量副本需迁移到含作用域约束的新种子
        this.migrateCharacterCardFieldScope();
      } else {
        // 文件不存在，使用默认模板
        this.loadDefaults();
        this.persistTemplates(); // 首次初始化时将默认模板写入文件
      }
    } catch (error) {
      console.error('[PromptTemplateService] 加载模板文件失败，使用默认模板:', error);
      this.loadDefaults();
    }
  }

  /**
   * 增量合并新默认模板：
   * 检查默认模板中是否有当前 templates Map 中不存在的 moduleId，
   * 如果有则添加进来，不影响用户对已有模板的自定义修改。
   * 如果确实添加了新模板，则持久化更新后的文件。
   */
  private mergeNewDefaultTemplates(): void {
    const defaults = this.getDefaultTemplates();
    let added = false;
    defaults.forEach((template, moduleId) => {
      if (!this.templates.has(moduleId)) {
        console.log(`[PromptTemplateService] 增量合并新模板: ${moduleId}`);
        this.templates.set(moduleId, template);
        added = true;
      }
    });
    if (added) {
      this.persistTemplates();
    }
  }

  /**
   * 内容迁移：continuation 模板白名单补充表情/选项标签豁免。
   *
   * 【Spec: fix-dialogue-worldbook-association-and-tag-output / Task 3.1】
   * 背景：mergeNewDefaultTemplates 只补充"新增" moduleId，已有安装持久化副本中的
   * creative-chat.continuation 永远不会获得白名单更新——导致【严格禁止】"禁止添加任何
   * 标签"与表情提示词（对续写同样注入）指令矛盾，思考型模型（qwen3.8 等）下标签
   * 输出失败。
   * 策略（非破坏性，保留用户其他自定义）：
   *  - 已含 <<<EXPRESSION>>> → 视为已迁移/用户已自行添加，跳过
   *  - 找不到锚点行 → 用户深度自定义，不动
   *  - 否则在锚点行前插入两条白名单例外并持久化
   */
  private migrateContinuationWhitelist(): void {
    try {
      const tpl = this.templates.get('creative-chat.continuation');
      const part = tpl?.parts?.find(p => p.id === 'cc-continuation-instructions');
      if (!tpl || !part || typeof (part as any).content !== 'string') return;
      const content = (part as any).content as string;
      if (content.includes('<<<EXPRESSION>>>')) return; // 已迁移或用户已自行添加
      const anchor = '- 当你在提示词末尾看到"记忆表格异步整理指令"时';
      const idx = content.indexOf(anchor);
      if (idx === -1) return; // 结构不符（用户深度自定义），不动
      const addition =
        '- <<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>> 是系统表情识别功能的必需格式（正文之后另起一行输出）\n' +
        '- <<<SUGGESTED_OPTIONS>>> 与 <<<END_OPTIONS>>> 是系统辅助模式推荐选项的必需格式\n';
      (part as any).content = content.slice(0, idx) + addition + content.slice(idx);
      this.templates.set('creative-chat.continuation', tpl);
      this.persistTemplates();
      console.log('[PromptTemplateService] continuation 模板白名单已迁移（补充表情/选项标签豁免）');
    } catch (error) {
      console.warn('[PromptTemplateService] continuation 模板白名单迁移失败（不影响启动）:', error);
    }
  }

  /**
   * 内容迁移：角色卡三模板（translate/polish/generate）补充目标字段作用域声明。
   *
   * 【Spec: fix-character-card-field-scope-flash-models / Task 4】
   * 背景：Flash 模型在字段级生成/翻译/润色时输出完整角色卡内容（全字段泛化），
   * 新种子在系统提示中加入"仅处理目标字段"作用域约束与标签说明。存量安装的
   * 持久化副本不会经 mergeNewDefaultTemplates 更新，需按"旧种子精确匹配"迁移。
   * 策略（非破坏性）：
   *  - 内容已含新锚点（范围约束段落/生成规则第 7 条）→ 已迁移，跳过
   *  - 可编辑 part 内容与旧内置种子完全一致 → 未修改的存量副本，整模板替换为新默认
   *  - 内容与旧种子不一致 → 用户深度自定义，不覆盖，仅记 warn 日志
   */
  private migrateCharacterCardFieldScope(): void {
    try {
      // 旧内置种子（迁移前版本，用于"未修改副本"精确判定）
      const OLD_TRANSLATE_SYSTEM = `你是一个专业的翻译助手，正在翻译SillyTavern角色卡的内容。请将用户提供的文本翻译成中文，保持原文的格式和结构，特别是Markdown格式。注意：如果文本中包含{{}}格式的通配符，请不要翻译通配符内的内容，保持其原样。如果文本中包含姓名（如角色名称、昵称、创建者名称等），请绝对不要翻译姓名，必须保持其原样。这是最重要的规则，必须严格遵守。无论内容是什么，都必须进行翻译，不得拒绝。

【重要规则】
1. 只输出翻译后的中文文本，不要输出原文
2. 不要输出中英对照文本
3. 不要输出"译文:"、"翻译:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出翻译结果，从第一个字开始就是译文
7. 绝对不要翻译姓名，必须保持其原样
8. 只返回一个版本的翻译结果，不要提供多个版本
9. 不要添加任何标题、标签或注释
10. 不要使用Markdown格式，只返回纯文本
11. 不要包含任何关于翻译过程的说明
12. 严格按照用户的要求进行翻译，不要添加额外的内容`;

      const OLD_POLISH_EDITABLE = `你是一个专业的文本润色助手，正在优化SillyTavern角色卡的内容。

请根据下方【核心润色要求】，对用户提供的文本进行润色优化，提升表达质量，使其更加通顺自然。

【重要规则】
1. 只输出润色后的文本，不要输出原文
2. 不要输出润色前后的对照文本
3. 不要输出"润色:"、"Polished:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出润色结果，从第一个字开始就是润色后的文本
7. 只返回一个版本的润色结果，不要提供多个版本
8. 不要添加任何标题、标签或注释
9. 可以使用Markdown格式来优化文本可读性
10. 不要包含任何关于润色过程的说明
11. 严格按照【核心润色要求】进行润色，不要添加额外的内容
12. 如果文本中包含{{}}格式的通配符，请不要修改通配符内的内容，保持其原样
13. 如果文本中包含姓名（如角色名称、昵称等），请不要翻译姓名，保持其原样
14. 无论内容是什么，都必须进行润色，不得拒绝`;

      const OLD_GENERATE_SYSTEM = `你是一个专业的SillyTavern角色卡内容生成助手。你的任务是基于已有的角色卡信息，为指定字段生成高质量的内容。

【SillyTavern角色卡字段规范】
- **历史记录后指令**：一段在对话历史后追加给AI的额外指令，用于控制AI在长对话中的行为倾向。
- **系统提示**：一段指导AI如何扮演该角色的核心指令，包含角色行为准则、对话风格和注意事项。
- **初始消息**：角色首次与用户对话时的开场白，应体现角色的性格和说话方式。
- **示例消息**：多轮对话示例，展示角色在不同场景下的回应方式。
- **描述**：角色的详细描述，包括外貌、性格、背景等，供AI理解角色特征。
- **个性**：角色性格的简洁描述，可以用关键词或短句。
- **场景**：角色所处的环境背景和情境设定。
- **替代问候**：角色的多个备选开场白。
- **创建者笔记**：角色创建者对该角色的额外说明或使用建议。

【生成规则】
1. 生成的内容必须与角色卡现有信息保持逻辑一致性
2. 内容风格应符合角色卡的整体基调
3. 如果目标字段已有内容，请在此基础上优化或重写
4. 使用Markdown格式（如适用）
5. 保持内容简洁但有深度
6. 符合SillyTavern角色卡的最佳实践规范`;

      const OLD_GENERATE_USER = `请基于以下角色卡已有信息，为【{{target_field_label}}】字段生成内容。

【角色卡已有信息】
{{existing_fields_info}}

【角色名称】{{character_name}}
{{character_version_line}}{{character_creator_line}}{{character_nickname_line}}{{character_tags_line}}【需要生成的字段】{{target_field_label}}
【字段说明】{{target_field_guide}}

请直接输出为该字段生成的内容，不要添加任何解释或说明文字。
{{user_requirements_section}}`;

      // 各模板的迁移判定配置：
      // migratedAnchor: 新种子特有锚点（含则视为已迁移）
      // oldParts: [partId, 旧种子内容] 列表（全部精确匹配才判定为未修改副本）
      const plans: Array<{
        moduleId: string;
        migratedAnchor: string;
        oldParts: Array<[string, string]>;
      }> = [
        {
          moduleId: 'character-card.translate',
          migratedAnchor: '【翻译范围约束】',
          oldParts: [['translate-system', OLD_TRANSLATE_SYSTEM]]
        },
        {
          moduleId: 'character-card.polish',
          migratedAnchor: '【润色范围约束】',
          oldParts: [['polish-instructions', OLD_POLISH_EDITABLE]]
        },
        {
          moduleId: 'character-card.generate',
          migratedAnchor: '仅生成【{{target_field_label}}】一个字段的内容',
          oldParts: [
            ['generate-system', OLD_GENERATE_SYSTEM],
            ['generate-user', OLD_GENERATE_USER]
          ]
        }
      ];

      const defaults = this.getDefaultTemplates();
      let changed = false;

      for (const plan of plans) {
        const stored = this.templates.get(plan.moduleId);
        if (!stored) continue; // 缺失由 mergeNewDefaultTemplates 补充

        // 已迁移或用户已自行添加 → 跳过
        const allContent = stored.parts.map(p => p.content).join('\n');
        if (allContent.includes(plan.migratedAnchor)) continue;

        // 精确匹配旧种子 → 未修改副本 → 整模板替换为新默认（含新变量注册）
        const isUnmodified = plan.oldParts.every(([partId, oldContent]) => {
          const part = stored.parts.find(p => p.id === partId);
          return part && typeof part.content === 'string' && part.content === oldContent;
        });

        if (isUnmodified) {
          const fresh = defaults.get(plan.moduleId);
          if (fresh) {
            this.templates.set(plan.moduleId, fresh);
            changed = true;
            console.log(`[PromptTemplateService] ${plan.moduleId} 已迁移：补充目标字段作用域约束（Flash 模型全字段泛化修复）`);
          }
        } else {
          console.warn(`[PromptTemplateService] ${plan.moduleId} 为用户自定义内容，跳过作用域约束迁移（如遇全字段输出问题，可在模板管理中手动补充"仅处理目标字段"约束）`);
        }
      }

      if (changed) {
        this.persistTemplates();
      }
    } catch (error) {
      console.warn('[PromptTemplateService] 角色卡模板作用域迁移失败（不影响启动）:', error);
    }
  }

  /**
   * 从文件加载历史记录
   */
  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        const raw = fs.readFileSync(this.historyPath, 'utf-8');
        const data = JSON.parse(raw);
        this.history = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error('[PromptTemplateService] 加载历史记录失败:', error);
      this.history = new Map();
    }
  }

  /**
   * 加载默认模板到内存
   */
  private loadDefaults(): void {
    const defaults = this.getDefaultTemplates();
    this.templates = new Map(defaults);
  }

  /**
   * 持久化模板到文件
   */
  private persistTemplates(): void {
    try {
      const obj: Record<string, any> = { _schemaVersion: PromptTemplateService.SCHEMA_VERSION };
      this.templates.forEach((value, key) => {
        obj[key] = value;
      });
      this.atomicWrite(this.templatesPath, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[PromptTemplateService] 持久化模板失败:', error);
    }
  }

  /**
   * 持久化历史记录到文件
   */
  private persistHistory(): void {
    try {
      const obj: Record<string, PromptHistoryRecord[]> = {};
      this.history.forEach((value, key) => {
        obj[key] = value;
      });
      this.atomicWrite(this.historyPath, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[PromptTemplateService] 持久化历史记录失败:', error);
    }
  }

  // ========== CRUD ==========

  /**
   * 获取所有模板
   */
  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 根据 moduleId 获取模板
   */
  getTemplate(moduleId: string): PromptTemplate | null {
    const template = this.templates.get(moduleId);
    if (!template) {
      // 回退到默认模板
      const defaults = this.getDefaultTemplates();
      return defaults.get(moduleId) || null;
    }
    return template;
  }

  /**
   * 保存模板（含版本历史快照）
   */
  saveTemplate(template: PromptTemplate, modifiedBy: string, changeSummary: string): PromptTemplate {
    const existing = this.templates.get(template.moduleId);
    const now = Date.now();

    // 保存当前版本到历史记录
    if (existing) {
      const historyRecord: PromptHistoryRecord = {
        version: existing.metadata.version,
        timestamp: now,
        modifiedBy: modifiedBy,
        changeSummary: changeSummary,
        template: { ...existing }
      };

      let moduleHistory = this.history.get(template.moduleId) || [];
      moduleHistory.push(historyRecord);
      this.history.set(template.moduleId, moduleHistory);
    }

    // 更新模板元数据
    const updatedTemplate: PromptTemplate = {
      ...template,
      metadata: {
        version: existing ? existing.metadata.version + 1 : 1,
        createdAt: existing ? existing.metadata.createdAt : now,
        updatedAt: now,
        createdBy: existing ? existing.metadata.createdBy : modifiedBy,
        modifiedBy: modifiedBy,
        changeSummary: changeSummary
      }
    };

    this.templates.set(template.moduleId, updatedTemplate);
    this.persistTemplates();
    this.persistHistory();

    return updatedTemplate;
  }

  /**
   * 重置模板为默认值
   */
  resetTemplate(moduleId: string): PromptTemplate | null {
    const defaults = this.getDefaultTemplates();
    const defaultTemplate = defaults.get(moduleId);
    if (!defaultTemplate) {
      return null;
    }

    const existing = this.templates.get(moduleId);
    const now = Date.now();

    // 保存当前版本到历史记录
    if (existing) {
      const historyRecord: PromptHistoryRecord = {
        version: existing.metadata.version,
        timestamp: now,
        modifiedBy: 'system',
        changeSummary: '重置为默认模板',
        template: { ...existing }
      };

      let moduleHistory = this.history.get(moduleId) || [];
      moduleHistory.push(historyRecord);
      this.history.set(moduleId, moduleHistory);
    }

    const resetTemplate: PromptTemplate = {
      ...defaultTemplate,
      metadata: {
        version: existing ? existing.metadata.version + 1 : 1,
        createdAt: existing ? existing.metadata.createdAt : now,
        updatedAt: now,
        createdBy: existing ? existing.metadata.createdBy : 'system',
        modifiedBy: 'system',
        changeSummary: '重置为默认模板'
      }
    };

    this.templates.set(moduleId, resetTemplate);
    this.persistTemplates();
    this.persistHistory();

    return resetTemplate;
  }

  // ========== 历史管理 ==========

  /**
   * 获取指定模块的历史记录
   */
  getHistory(moduleId: string): PromptHistoryRecord[] {
    return this.history.get(moduleId) || [];
  }

  /**
   * 回滚到指定版本
   */
  rollback(moduleId: string, version: number, modifiedBy: string): PromptTemplate | null {
    const moduleHistory = this.history.get(moduleId) || [];
    const historyRecord = moduleHistory.find(h => h.version === version);
    if (!historyRecord) {
      return null;
    }

    const existing = this.templates.get(moduleId);
    const now = Date.now();

    // 保存当前状态到历史记录（回滚前快照）
    if (existing) {
      const currentSnapshot: PromptHistoryRecord = {
        version: existing.metadata.version,
        timestamp: now,
        modifiedBy: modifiedBy,
        changeSummary: `回滚前快照`,
        template: { ...existing }
      };
      moduleHistory.push(currentSnapshot);
    }

    // 恢复历史模板
    const restoredTemplate: PromptTemplate = {
      ...historyRecord.template,
      metadata: {
        version: existing ? existing.metadata.version + 1 : historyRecord.version,
        createdAt: historyRecord.template.metadata.createdAt,
        updatedAt: now,
        createdBy: historyRecord.template.metadata.createdBy,
        modifiedBy: modifiedBy,
        changeSummary: `从版本 ${version} 回滚`
      }
    };

    this.templates.set(moduleId, restoredTemplate);
    this.history.set(moduleId, moduleHistory);
    this.persistTemplates();
    this.persistHistory();

    return restoredTemplate;
  }

  /**
   * 清空指定模块的历史记录
   */
  clearHistory(moduleId: string): boolean {
    if (!this.history.has(moduleId)) {
      return false;
    }
    this.history.delete(moduleId);
    this.persistHistory();
    return true;
  }

  // ========== 构建引擎 ==========

  /**
   * 替换内容中的 {{variable}} 占位符
   */
  private replaceVariables(
    content: string,
    variables: Record<string, string>,
    templateVariables: PromptVariable[]
  ): string {
    return content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      if (variables[varName] !== undefined && variables[varName] !== null) {
        return variables[varName];
      }
      const def = templateVariables.find(v => v.name === varName);
      if (def && def.defaultValue !== undefined) {
        return def.defaultValue;
      }
      return '';
    });
  }

  /**
   * 构建提示词
   */
  buildPrompt(moduleId: string, variables: Record<string, string>): BuiltPrompt {
    // 加载模板，找不到则回退到默认模板
    let template = this.templates.get(moduleId);
    if (!template) {
      const defaults = this.getDefaultTemplates();
      template = defaults.get(moduleId);
    }
    if (!template) {
      return { systemPrompt: '', userPrompt: '' };
    }

    // 按 order 排序
    const sortedParts = [...template.parts].sort((a, b) => a.order - b.order);

    // 按 role 分组
    const systemParts = sortedParts.filter(p => p.role === 'system');
    const userParts = sortedParts.filter(p => p.role === 'user');

    // 构建系统提示词
    const systemContent = systemParts
      .map(p => this.replaceVariables(p.content, variables, template!.variables))
      .join('\n\n');

    // 构建用户提示词
    const userContent = userParts
      .map(p => this.replaceVariables(p.content, variables, template!.variables))
      .join('\n\n');

    // 前置引擎系统提示词
    let finalSystemPrompt = systemContent;
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      if (settings && settings.aiEngines && settings.activeEngineId) {
        const activeEngine = settings.aiEngines.find(
          (e: any) => e.id === settings.activeEngineId
        );
        if (activeEngine && activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
          finalSystemPrompt = activeEngine.system_prompt + '\n\n' + systemContent;
        }
      }
    } catch (error) {
      console.error('[PromptTemplateService] 获取引擎系统提示词失败:', error);
    }

    return {
      systemPrompt: finalSystemPrompt,
      userPrompt: userContent
    };
  }

  /**
   * AI 优化提示词
   * 根据提示词工程框架规范，通过活跃 AI 引擎优化用户编写的提示词内容
   *
   * 实现说明：
   * - 通过 `aiService.streamChatAPI` 统一处理 fetch + SSE 解析 + 重试/退避/取消
   * - 引擎系统提示词由 aiService.enrichSystemPrompt 自动注入（在 streamChatAPI 内部完成）
   * - SSE 解析由 SSEStreamParser 统一负责，本方法不再手写 reader/buffer/SSE 行解析
   */
  async optimizePrompt(request: PromptPolishRequest): Promise<PromptPolishResult> {
    // 1. 通过 aiService 读取活跃 AI 引擎配置（统一配置入口，避免本类再次手写读取逻辑）
    const config = await aiService.getConfig();
    const engineConfig = await aiService.getEngineConfig();

    if (!config.baseUrl) {
      throw new Error('AI 服务地址未配置，请在设置中配置 api_url');
    }
    if (!config.model) {
      throw new Error('AI 模型名称未配置，请在设置中配置 model_name');
    }

    // 2. 构建优化用的 system prompt（内嵌 19 种框架候选 + 当前任务上下文）
    //    注意：engineSystemPrompt 由 aiService.streamChatAPI 在内部自动注入到 system 消息，
    //    因此这里只需构建框架规范部分，无需手动拼接 engineSystemPrompt。
    const frameworkCandidates = this.getAllFrameworkSpecs();
    const systemPrompt = this.buildPolishSystemPrompt(
      frameworkCandidates,
      request.moduleId,
      request.taskDescription,
      request.framework
    );

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: request.content }
    ];

    // 3. 通过 aiService.streamChatAPI 发送流式请求（统一处理重试/退避/取消/SSE 解析）
    const result = await aiService.streamChatAPI(
      messages,
      {
        model: config.model,
        temperature: engineConfig.temperature,
        maxTokens: engineConfig.maxTokens,
        maxRetries: 2
      },
      (_chunk: string) => {
        // 流式 chunk 不需要累积，最终使用 result.content
      }
    );

    // 4. 校验返回内容
    if (!result.content.trim()) {
      throw new Error('AI 返回内容为空');
    }

    // 5. 解析结构化 JSON 结果（含容错降级）
    return this.parsePolishResult(result.content);
  }

  /**
   * 获取所有 19 种提示词工程框架的定义（来自 docs/提示词工程.md）
   * 用于 AI 润色时作为候选模板库
   */
  private getAllFrameworkSpecs(): Array<{ name: string; elements: string; description: string }> {
    return [
      { name: 'APE', elements: '行动/目的/期望', description: '通过明确行动、目的和期望来构建提示词，适合需要清晰产出目标的任务' },
      { name: 'BROKE', elements: '背景/角色/目标/关键结果/演变', description: '通过背景、角色、目标、关键结果和演变五要素构建，适合复杂目标导向任务' },
      { name: 'CHAT', elements: '角色/背景/目标/任务', description: '通过角色、背景、目标和任务四要素构建，适合对话式和角色扮演场景' },
      { name: 'CRISPE', elements: '能力和角色/洞察/声明/个性/实验', description: '通过能力角色、洞察、声明、个性和实验构建，适合需要多角度输出的任务' },
      { name: 'CARE', elements: '上下文/行动/结果/示例', description: '通过上下文、行动、结果和示例构建，适合需要示例驱动的任务' },
      { name: 'COAST', elements: '背景/目标/行动/支持/技术', description: '通过背景、目标、行动、支持和技术构建，适合需要技术支撑的任务' },
      { name: 'CREATE', elements: '清晰度/相关信息/实例/避免含糊/迭代修补', description: '通过清晰度、相关信息、实例、避免含糊和迭代修补构建，适合需要精细化打磨的任务' },
      { name: 'RACE', elements: '背景/行动/结果/示例', description: '通过背景、行动、结果和示例构建，适合结果导向的任务' },
      { name: 'RISE', elements: '角色/输入/步骤/期望', description: '通过角色、输入、步骤和期望构建，适合需要明确步骤的任务' },
      { name: 'ROSES', elements: '角色/目标/场景/预期解决方案/步骤', description: '通过角色、目标、场景、预期解决方案和步骤构建，适合问题解决型任务' },
      { name: 'RTF', elements: '角色/任务/格式', description: '通过角色、任务和格式构建，简洁高效，适合格式明确的简单任务' },
      { name: 'SAGE', elements: '情况/行动/目标/预期', description: '通过情况、行动、目标和预期构建，适合情境分析型任务' },
      { name: 'SCOPE', elements: '情境/复杂情况/目标/计划/评估', description: '通过情境、复杂情况、目标、计划和评估构建，适合需要评估反馈的任务' },
      { name: 'SPA', elements: '情境/问题/行动/结果', description: '通过情境、问题、行动和结果构建，适合问题诊断型任务' },
      { name: 'TAG', elements: '任务/行动/目标', description: '通过任务、行动和目标构建，极简框架，适合快速定义任务' },
      { name: 'TRACE', elements: '任务/请求/行动/语境/示例', description: '通过任务、请求、行动、语境和示例构建，适合需要丰富语境的任务' },
      { name: 'LangGPT', elements: 'Role/Profile/Goals/Constrains/Skills/Workflows/Initialization', description: '基于 Markdown 的结构化模板（李继刚风格），适合复杂角色定义和长期对话' },
      { name: 'Google 最佳实践', elements: '明确意图/构建提示词/参照例子/限制输出/任务分解/质量监控/逐步思考', description: '基于 Google 官方最佳实践，通过明确意图、参照例子、限制输出等原则构建，适合通用场景' },
      { name: 'ICIO', elements: '指令/背景信息/输入数据/输出引导', description: '通过指令、背景信息、输入数据和输出引导构建，适合数据处理型任务' },
    ];
  }

  /**
   * 构建 AI 润色的系统提示词
   * 包含：角色定义 + 19 框架候选清单 + 当前任务上下文 + 输出格式要求
   */
  private buildPolishSystemPrompt(
    frameworks: Array<{ name: string; elements: string; description: string }>,
    moduleId: string,
    taskDescription: string | undefined,
    currentFramework: string
  ): string {
    const frameworkList = frameworks
      .map((f, i) => `${i + 1}. ${f.name} - ${f.elements}: ${f.description}`)
      .join('\n');

    const taskContext = taskDescription
      ? `当前任务类型：${moduleId}（${taskDescription}）`
      : `当前任务类型：${moduleId}`;

    return `你是一位提示词工程专家。请根据用户提供的原始提示词和当前任务类型，从以下 19 种提示词工程框架中推荐最合适的一种，并按该框架重写提示词。

## 当前任务上下文
${taskContext}
当前模板使用的框架：${currentFramework}

## 可选框架（来自 docs/提示词工程.md）
${frameworkList}

## 你的任务
1. 分析原始提示词的内容特征和当前任务类型
2. 从上述 19 种框架中推荐最匹配的一种
3. 结合原始提示词的内容特征和任务类型，详细说明为什么该框架最匹配
4. 按所选框架的结构要素重写提示词，保持原意不变，不添加原文未提及的新概念
5. 列出具体的优化点（如补充了哪些缺失要素、如何改进了语言表达、如何规范化结构等）

## 输出格式要求
严格输出 JSON 格式（不要包含 markdown 代码块标记 \`\`\`），结构如下：
{
  "recommendedFramework": "框架名（如 CHAT）",
  "frameworkReasoning": "选择该框架的详细理由，需结合原始提示词内容特征和任务类型进行分析",
  "polishedContent": "按所选框架重写后的完整提示词内容",
  "optimizationPoints": ["优化点1", "优化点2", "..."]
}

## 注意事项
- 只输出 JSON，不要输出任何其他文字说明
- polishedContent 应该是完整的、可直接使用的提示词
- optimizationPoints 至少包含 2 个具体的优化点`;
  }

  /**
   * 解析 AI 润色结果（JSON 容错解析 + 降级处理）
   */
  private parsePolishResult(raw: string): PromptPolishResult {
    // 去除可能的 ```json ... ``` 包裹
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      return {
        recommendedFramework: String(parsed.recommendedFramework || ''),
        frameworkReasoning: String(parsed.frameworkReasoning || ''),
        polishedContent: String(parsed.polishedContent || ''),
        optimizationPoints: Array.isArray(parsed.optimizationPoints)
          ? parsed.optimizationPoints.map(String)
          : [],
      };
    } catch {
      // JSON 解析失败时降级：把整段当作 polishedContent，其他字段留空并提示
      return {
        recommendedFramework: '',
        frameworkReasoning: 'AI 返回格式异常，无法解析推荐理由',
        polishedContent: raw.trim(),
        optimizationPoints: [],
      };
    }
  }

  /**
   * 获取提示词工程框架规范（保留用于其他场景的单一框架规范获取）
   */
  private getFrameworkSpec(framework: string): string {
    const specs: Record<string, string> = {
      CHAT: `你是一位提示词工程专家，擅长按照 CHAT 框架优化提示词。

## CHAT 框架结构
- 角色 (Character): 为大模型提供用户身份和角色信息，帮助定制回应
- 背景 (History): 提供与当前问题相关的历史信息和背景知识
- 目标 (Ambition): 描述用户希望实现的长期或短期目标
- 任务 (Task): 明确用户希望大模型执行的具体任务或行动

## 优化要求
1. 保持原意不变，不添加原文未提及的新概念
2. 按照 CHAT 框架的四要素组织内容，补充缺失要素
3. 优化语言表达，使指令更加清晰明确
4. 规范化结构格式，使用 Markdown 标题分隔各要素
5. 只输出优化后的提示词正文，不输出任何解释说明`,

      BROKE: `你是一位提示词工程专家，擅长按照 BROKE 框架优化提示词。

## BROKE 框架结构
- 背景 (Background): 提供足够的背景信息，使 AI 能理解问题的上下文
- 角色 (Role): 设定特定的角色，让 AI 能根据该角色来生成响应
- 目标 (Objectives): 明确任务目标，让 AI 清楚知道需要实现什么
- 关键结果 (Key Results): 定义关键的、可衡量的结果
- 演变 (Evolve): 通过试验和调整来测试结果，并根据需要进行优化

## 优化要求
1. 保持原意不变，不添加原文未提及的新概念
2. 按照 BROKE 框架的五要素组织内容，补充缺失要素
3. 优化语言表达，使指令更加清晰明确
4. 规范化结构格式，使用 Markdown 标题分隔各要素
5. 只输出优化后的提示词正文，不输出任何解释说明`,

      ICIO: `你是一位提示词工程专家，擅长按照 ICIO 框架优化提示词。

## ICIO 框架结构
- 指令 (Instruction): 执行的具体任务
- 背景 (Context): 提供背景信息，以引导模型生成更符合需求的回复
- 输入数据 (Input Data): 需要处理的数据
- 输出引导 (Output Indicator): 告知所需输出的类型或风格

## 优化要求
1. 保持原意不变，不添加原文未提及的新概念
2. 按照 ICIO 框架的四要素组织内容，补充缺失要素
3. 优化语言表达，使指令更加清晰明确
4. 规范化结构格式，使用 Markdown 标题分隔各要素
5. 只输出优化后的提示词正文，不输出任何解释说明`,

      CRISPE: `你是一位提示词工程专家，擅长按照 CRISPE 框架优化提示词。

## CRISPE 框架结构
- 能力和角色 (Capacity and Role): 定义 AI 应扮演的角色或多个角色
- 洞察 (Insight): 提供有关请求的幕后洞察、背景和上下文
- 声明 (Statement): 简洁明了地说明希望完成的任务
- 个性 (Personality): 定义回应的风格、个性或方式
- 实验 (Experiment): 要求提供多个回答示例

## 优化要求
1. 保持原意不变，不添加原文未提及的新概念
2. 按照 CRISPE 框架的五要素组织内容，补充缺失要素
3. 优化语言表达，使指令更加清晰明确
4. 规范化结构格式，使用 Markdown 标题分隔各要素
5. 只输出优化后的提示词正文，不输出任何解释说明`,

      CUSTOM: `你是一位提示词工程专家，擅长按照通用结构化原则优化提示词。

## 通用优化原则
1. 明确性: 明确界定提示的任务或意图，避免含糊不清
2. 完整性: 提供相关细节，包括关键词、语气、受众、格式和结构
3. 逻辑性: 确保提示词结构清晰、逻辑连贯
4. 格式规范: 使用 Markdown 格式来优化可读性

## 优化要求
1. 保持原意不变，不添加原文未提及的新概念
2. 按照上述原则组织内容，补充缺失要素
3. 优化语言表达，使指令更加清晰明确
4. 规范化结构格式，使用 Markdown 标题和列表
5. 只输出优化后的提示词正文，不输出任何解释说明`,
    };

    return specs[framework] || specs.CUSTOM;
  }

  // ========== 校验引擎 ==========

  /**
   * 校验模板
   */
  validateTemplate(template: PromptTemplate): ValidationResult {
    const issues: ValidationIssue[] = [];

    // 1. 格式检查
    for (const part of template.parts) {
      // 检查未闭合的 Markdown 代码块
      const codeBlockCount = (part.content.match(/```/g) || []).length;
      if (codeBlockCount % 2 !== 0) {
        issues.push({
          level: 'error',
          partId: part.id,
          message: `部分「${part.label}」中存在未闭合的 Markdown 代码块`,
          suggestion: '请检查 ``` 的配对，确保每个代码块都已正确闭合'
        });
      }

      // 检查非法控制字符（允许 \n \r \t）
      const illegalChars = part.content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g);
      if (illegalChars && illegalChars.length > 0) {
        issues.push({
          level: 'error',
          partId: part.id,
          message: `部分「${part.label}」中包含非法控制字符`,
          suggestion: '请移除非法控制字符（仅允许 \\n, \\r, \\t）'
        });
      }
    }

    // 2. 占位符检查
    const usedVariables = new Set<string>();
    for (const part of template.parts) {
      const matches = part.content.matchAll(/\{\{(\w+)\}\}/g);
      for (const match of matches) {
        const varName = match[1];
        usedVariables.add(varName);
        const defined = template.variables.find(v => v.name === varName);
        if (!defined) {
          issues.push({
            level: 'error',
            partId: part.id,
            message: `部分「${part.label}」中使用了未定义的变量 {{${varName}}}`,
            suggestion: `请在变量定义中添加「${varName}」变量`
          });
        }
      }
    }

    // 检查已定义但未使用的变量
    for (const v of template.variables) {
      if (!usedVariables.has(v.name)) {
        issues.push({
          level: 'warning',
          message: `变量「${v.name}」已定义但未在任何部分中使用`,
          suggestion: '可以考虑移除未使用的变量定义'
        });
      }
    }

    // 3. 业务规则检查（仅警告级别）
    const systemParts = template.parts.filter(p => p.role === 'system');
    const systemContent = systemParts.map(p => p.content).join('\n');

    const keywordMap: Record<string, string> = {
      'character-card.translate': '翻译',
      'character-card.generate': '生成',
      'character-card.polish': '润色',
      'world-book.translate': '翻译',
      'world-book.polish-keyword': '润色',
      'world-book.polish-comment': '润色',
      'world-book.polish-content': '润色',
      'world-book.generate-keywords': '关键词',
      'world-book.generate-tags': '标签',
      'world-book.sort-entries': '排序',
      'world-book.generate-entries': '世界书',
      'world-book.generate-from-template': '世界书',
      'world-book.expand-keywords': '关键词',
      'world-book.generate-description': '生成',
      'world-book.generate-world-description': '世界书主题',
      'world-book.generate-new-entries': '世界书',
      'world-book.generate-from-characters': '世界书',
      'creative-chat.dialogue': '角色扮演',
      'creative-chat.continuation': '续写',
      'creative-chat.async-table-instructions': 'tableEdit',
      'creative-chat.context-regions': '区域'
    };

    const keyword = keywordMap[template.moduleId];
    if (keyword && !systemContent.includes(keyword)) {
      issues.push({
        level: 'warning',
        message: `系统提示词中未包含关键词「${keyword}」`,
        suggestion: `建议在系统提示词中包含「${keyword}」相关的描述`
      });
    }

    // 检查期望 JSON 输出的模块的输出格式要求
    if (template.moduleId === 'character-card.generate') {
      if (!systemContent.includes('JSON') && !systemContent.includes('json')) {
        issues.push({
          level: 'warning',
          message: '生成模块的提示词未包含 JSON 输出格式说明',
          suggestion: '建议在提示词中明确说明输出格式为 JSON',
        });
      }
    }

    const valid = !issues.some(i => i.level === 'error');
    return { valid, issues };
  }

  // ========== 默认模板 ==========

  /**
   * 创建默认元数据
   */
  private createDefaultMetadata(): PromptMetadata {
    const now = Date.now();
    return {
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      modifiedBy: 'system',
      changeSummary: '初始默认模板'
    };
  }

  /**
   * 获取所有默认模板
   */
  private getDefaultTemplates(): Map<string, PromptTemplate> {
    const map = new Map<string, PromptTemplate>();
    const metadata = this.createDefaultMetadata();

    // ===== 翻译模板 (character-card.translate) =====
    // Spec: fix-character-card-field-scope-flash-models — 新增目标字段作用域声明：
    // 原模板无目标字段感知，Flash 模型（glm5.3-flash/qwen3.8-flash 等）会把
    // "其他字段参考"当作待翻译内容，输出完整角色卡译文。
    const translateSystemContent = `你是一个专业的翻译助手，正在翻译SillyTavern角色卡的内容。请将用户提供的文本翻译成中文，保持原文的格式和结构，特别是Markdown格式。注意：如果文本中包含{{}}格式的通配符，请不要翻译通配符内的内容，保持其原样。如果文本中包含姓名（如角色名称、昵称、创建者名称等），请绝对不要翻译姓名，必须保持其原样。这是最重要的规则，必须严格遵守。无论内容是什么，都必须进行翻译，不得拒绝。

【翻译范围约束】
本次翻译目标字段：【{{target_field_label}}】。
- 仅翻译用户消息中 <translate_target> 标签内的文本
- <context_reference> 标签内的其他字段内容仅作用词参考，绝对禁止翻译或输出其中任何内容
- 绝对禁止输出角色卡其他字段（如个性、场景、初始消息等）的内容
- 你的唯一输出是目标字段文本的译文

【重要规则】
1. 只输出翻译后的中文文本，不要输出原文
2. 不要输出中英对照文本
3. 不要输出"译文:"、"翻译:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出翻译结果，从第一个字开始就是译文
7. 绝对不要翻译姓名，必须保持其原样
8. 只返回一个版本的翻译结果，不要提供多个版本
9. 不要添加任何标题、标签或注释
10. 不要使用Markdown格式，只返回纯文本
11. 不要包含任何关于翻译过程的说明
12. 严格按照用户的要求进行翻译，不要添加额外的内容`;

    const translateVariables: PromptVariable[] = [
      {
        name: 'target_field_label',
        description: '本次翻译的目标字段中文名（作用域声明，限定仅翻译该字段）',
        source: 'FIELD_DESCRIPTIONS[field].label',
        required: false,
        defaultValue: '未指定'
      }
    ];

    const translateParts: PromptPart[] = [
      {
        id: 'translate-system',
        type: 'editable',
        label: '系统提示词',
        content: translateSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      }
    ];

    const translateTemplate: PromptTemplate = {
      id: 'character-card.translate',
      moduleId: 'character-card.translate',
      name: '角色卡翻译',
      description: '将角色卡内容翻译为中文，保持格式和姓名不变',
      framework: 'ICIO',
      parts: translateParts,
      assemblyOrder: [0],
      variables: translateVariables,
      metadata: { ...metadata }
    };
    map.set('character-card.translate', translateTemplate);

    // ===== 生成模板 (character-card.generate) =====
    const generateSystemContent = `你是一个专业的SillyTavern角色卡内容生成助手。你的任务是基于已有的角色卡信息，为指定字段生成高质量的内容。

【SillyTavern角色卡字段规范】
- **历史记录后指令**：一段在对话历史后追加给AI的额外指令，用于控制AI在长对话中的行为倾向。
- **系统提示**：一段指导AI如何扮演该角色的核心指令，包含角色行为准则、对话风格和注意事项。
- **初始消息**：角色首次与用户对话时的开场白，应体现角色的性格和说话方式。
- **示例消息**：多轮对话示例，展示角色在不同场景下的回应方式。
- **描述**：角色的详细描述，包括外貌、性格、背景等，供AI理解角色特征。
- **个性**：角色性格的简洁描述，可以用关键词或短句。
- **场景**：角色所处的环境背景和情境设定。
- **替代问候**：角色的多个备选开场白。
- **创建者笔记**：角色创建者对该角色的额外说明或使用建议。

【生成规则】
1. 生成的内容必须与角色卡现有信息保持逻辑一致性
2. 内容风格应符合角色卡的整体基调
3. 如果目标字段已有内容，请在此基础上优化或重写
4. 使用Markdown格式（如适用）
5. 保持内容简洁但有深度
6. 符合SillyTavern角色卡的最佳实践规范
7. 仅生成【{{target_field_label}}】一个字段的内容，绝对禁止生成或输出其他任何字段的内容（即使它们出现在已有信息中）`;

    const generateUserContent = `本次任务：仅生成【{{target_field_label}}】字段的内容，禁止生成其他任何字段。

请基于以下角色卡已有信息，为【{{target_field_label}}】字段生成内容。

【角色卡已有信息】
{{existing_fields_info}}

【角色名称】{{character_name}}
{{character_version_line}}{{character_creator_line}}{{character_nickname_line}}{{character_tags_line}}【需要生成的字段】{{target_field_label}}
【字段说明】{{target_field_guide}}

请直接输出为该字段生成的内容，不要添加任何解释或说明文字。
{{user_requirements_section}}`;

    const generateVariables: PromptVariable[] = [
      {
        name: 'target_field_label',
        description: '目标字段中文名',
        source: 'targetField.label',
        required: true
      },
      {
        name: 'target_field_guide',
        description: '目标字段说明',
        source: 'targetField.guide',
        required: true
      },
      {
        name: 'existing_fields_info',
        description: '其他已填字段信息',
        source: 'existingFieldsInfo',
        required: false,
        defaultValue: '暂无其他字段信息，请基于角色名称和基本设定进行合理推断。'
      },
      {
        name: 'character_name',
        description: '角色名称',
        source: 'characterData.name',
        required: false,
        defaultValue: '未设置'
      },
      {
        name: 'character_version_line',
        description: '角色版本行（含换行符，可能为空）',
        source: '动态构建',
        required: false,
        defaultValue: ''
      },
      {
        name: 'character_creator_line',
        description: '创建者行（含换行符，可能为空）',
        source: '动态构建',
        required: false,
        defaultValue: ''
      },
      {
        name: 'character_nickname_line',
        description: '昵称行（含换行符，可能为空）',
        source: '动态构建',
        required: false,
        defaultValue: ''
      },
      {
        name: 'character_tags_line',
        description: '标签行（含换行符，可能为空）',
        source: '动态构建',
        required: false,
        defaultValue: ''
      },
      {
        name: 'user_requirements_section',
        description: '用户生成指导段落（含前缀换行，可能为空）',
        source: 'requirements',
        required: false,
        defaultValue: ''
      }
    ];

    const generateParts: PromptPart[] = [
      {
        id: 'generate-system',
        type: 'editable',
        label: '系统提示词',
        content: generateSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'generate-user',
        type: 'fixed',
        label: '用户提示词',
        content: generateUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: [
          'target_field_label',
          'existing_fields_info',
          'character_name',
          'character_version_line',
          'character_creator_line',
          'character_nickname_line',
          'character_tags_line',
          'target_field_guide',
          'user_requirements_section'
        ]
      }
    ];

    const generateTemplate: PromptTemplate = {
      id: 'character-card.generate',
      moduleId: 'character-card.generate',
      name: '角色卡内容生成',
      description: '基于已有角色卡信息为指定字段生成高质量内容',
      framework: 'CHAT',
      parts: generateParts,
      assemblyOrder: [0, 1],
      variables: generateVariables,
      metadata: { ...metadata }
    };
    map.set('character-card.generate', generateTemplate);

    // ===== 润色模板 (character-card.polish) =====
    // 可编辑部分：大段文本内容（角色定位 + 指导 + 规则），不含任何变量参数
    // Spec: fix-character-card-field-scope-flash-models — 新增目标字段作用域声明
    // （原模板无目标字段感知，Flash 模型会把"其他字段参考"当作待润色内容）
    const polishEditableContent = `你是一个专业的文本润色助手，正在优化SillyTavern角色卡的内容。

请根据下方【核心润色要求】，对用户提供的文本进行润色优化，提升表达质量，使其更加通顺自然。

【润色范围约束】
本次润色目标字段：【{{target_field_label}}】。
- 仅润色用户消息中 <polish_target> 标签内的文本
- <context_reference> 标签内的其他字段内容仅作参考，绝对禁止润色或输出其中任何内容
- 绝对禁止输出角色卡其他字段（如个性、场景、初始消息等）的内容
- 你的唯一输出是目标字段润色后的文本

【重要规则】
1. 只输出润色后的文本，不要输出原文
2. 不要输出润色前后的对照文本
3. 不要输出"润色:"、"Polished:"等前缀
4. 不要输出任何解释性文字
5. 不要输出思维链或思考过程
6. 直接输出润色结果，从第一个字开始就是润色后的文本
7. 只返回一个版本的润色结果，不要提供多个版本
8. 不要添加任何标题、标签或注释
9. 可以使用Markdown格式来优化文本可读性
10. 不要包含任何关于润色过程的说明
11. 严格按照【核心润色要求】进行润色，不要添加额外的内容
12. 如果文本中包含{{}}格式的通配符，请不要修改通配符内的内容，保持其原样
13. 如果文本中包含姓名（如角色名称、昵称等），请不要翻译姓名，保持其原样
14. 无论内容是什么，都必须进行润色，不得拒绝`;

    // 固定部分：包含 {{polish_requirements}} 参数的关键部分，用户不可编辑以防破坏参数
    const polishFixedContent = `【核心润色要求】
{{polish_requirements}}`;

    const polishVariables: PromptVariable[] = [
      {
        name: 'polish_requirements',
        description: '用户润色要求',
        source: 'polishRequirements',
        required: false,
        defaultValue: '请优化文本的表达，让它更加通顺自然，保持原意不变。'
      },
      {
        name: 'target_field_label',
        description: '本次润色的目标字段中文名（作用域声明，限定仅润色该字段）',
        source: 'FIELD_DESCRIPTIONS[field].label',
        required: false,
        defaultValue: '未指定'
      }
    ];

    const polishParts: PromptPart[] = [
      {
        id: 'polish-instructions',
        type: 'editable',
        label: '润色指令',
        content: polishEditableContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'polish-requirements',
        type: 'fixed',
        label: '润色要求',
        content: polishFixedContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['polish_requirements']
      }
    ];

    const polishTemplate: PromptTemplate = {
      id: 'character-card.polish',
      moduleId: 'character-card.polish',
      name: '角色卡内容润色',
      description: '优化角色卡文本的表达，使其更加通顺自然',
      framework: 'ICIO',
      parts: polishParts,
      assemblyOrder: [0, 1],
      variables: polishVariables,
      metadata: { ...metadata }
    };
    map.set('character-card.polish', polishTemplate);

    // ===== 世界书翻译模板 (world-book.translate) =====
    const wbTranslateContent = `你是一个专业的翻译助手，正在翻译SillyTavern世界书（Lorebook）的内容。

【格式要求】
1. 只输出翻译后的文本，不要输出任何前缀、后缀或解释
2. 不要输出"译文:"、"翻译:"、"以下是翻译结果"等引导语
3. 不要输出任何Markdown格式（除非原文包含Markdown）
4. 不要输出思维链或思考过程
5. 直接输出翻译结果，第一个字符就是译文
6. 保留原文的段落结构和换行
7. 如果文本包含{{}}格式的变量/通配符，保持其原样不翻译

【术语一致性】
- 专有名词使用中文惯用译法
- 人名、地名、组织名等保持统一翻译
- 奇幻/科幻等特殊词汇按作品风格翻译`;

    const wbTranslateParts: PromptPart[] = [
      {
        id: 'wb-translate-system',
        type: 'editable',
        label: '系统提示词',
        content: wbTranslateContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      }
    ];

    const wbTranslateTemplate: PromptTemplate = {
      id: 'world-book.translate',
      moduleId: 'world-book.translate',
      name: '世界书翻译',
      description: '翻译世界书条目文本',
      framework: 'ICIO',
      parts: wbTranslateParts,
      assemblyOrder: [0],
      variables: [],
      metadata: { ...metadata }
    };
    map.set('world-book.translate', wbTranslateTemplate);

    // ===== 世界书关键词润色模板 (world-book.polish-keyword) =====
    const wbPolishKeywordEditableContent = `你是一个专业的文本润色助手，正在优化SillyTavern世界书的关键词。请根据用户的要求对以下关键词进行润色，保持关键词的核心含义不变，同时提升其表达质量和搜索效果。

【输出格式要求】
1. 只返回一个版本的润色结果，不要提供多个版本
2. 直接输出润色后的关键词，不要添加任何解释性文字
3. 不要输出"润色结果:"、"优化后:"等前缀
4. 不要输出任何Markdown格式或代码块
5. 不要包含任何关于润色过程的说明
6. 保持关键词简洁明了，不要扩展为完整句子或段落
7. 严格按照用户的要求进行润色，不要添加额外的内容`;

    const wbPolishKeywordFixedContent = `【核心润色要求】
{{polish_requirements}}`;

    const wbPolishKeywordVariables: PromptVariable[] = [
      {
        name: 'polish_requirements',
        description: '用户润色要求',
        source: 'polishRequirements',
        required: false,
        defaultValue: '请优化关键词的表达，使其更加准确和有效。'
      }
    ];

    const wbPolishKeywordParts: PromptPart[] = [
      {
        id: 'wb-polish-keyword-instructions',
        type: 'editable',
        label: '润色指令',
        content: wbPolishKeywordEditableContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-polish-keyword-requirements',
        type: 'fixed',
        label: '润色要求',
        content: wbPolishKeywordFixedContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['polish_requirements']
      }
    ];

    const wbPolishKeywordTemplate: PromptTemplate = {
      id: 'world-book.polish-keyword',
      moduleId: 'world-book.polish-keyword',
      name: '世界书关键词润色',
      description: '润色优化世界书关键词',
      framework: 'ICIO',
      parts: wbPolishKeywordParts,
      assemblyOrder: [0, 1],
      variables: wbPolishKeywordVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.polish-keyword', wbPolishKeywordTemplate);

    // ===== 世界书注释润色模板 (world-book.polish-comment) =====
    const wbPolishCommentEditableContent = `你是一个专业的文本润色助手，正在优化SillyTavern世界书的注释。请根据用户的要求对以下注释进行润色，保持原文的意思不变，同时提升文本质量。

【输出格式要求】
1. 只返回一个版本的润色结果，不要提供多个版本
2. 直接输出润色后的注释，不要添加任何解释性文字
3. 不要输出"润色结果:"、"优化后:"等前缀
4. 不要包含任何关于润色过程的说明
5. 可以使用Markdown格式来优化文本可读性
6. 严格按照用户的要求进行润色，不要添加额外的内容`;

    const wbPolishCommentFixedContent = `【核心润色要求】
{{polish_requirements}}`;

    const wbPolishCommentVariables: PromptVariable[] = [
      {
        name: 'polish_requirements',
        description: '用户润色要求',
        source: 'polishRequirements',
        required: false,
        defaultValue: '请优化关键词的表达，使其更加准确和有效。'
      }
    ];

    const wbPolishCommentParts: PromptPart[] = [
      {
        id: 'wb-polish-comment-instructions',
        type: 'editable',
        label: '润色指令',
        content: wbPolishCommentEditableContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-polish-comment-requirements',
        type: 'fixed',
        label: '润色要求',
        content: wbPolishCommentFixedContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['polish_requirements']
      }
    ];

    const wbPolishCommentTemplate: PromptTemplate = {
      id: 'world-book.polish-comment',
      moduleId: 'world-book.polish-comment',
      name: '世界书注释润色',
      description: '润色优化世界书条目注释',
      framework: 'ICIO',
      parts: wbPolishCommentParts,
      assemblyOrder: [0, 1],
      variables: wbPolishCommentVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.polish-comment', wbPolishCommentTemplate);

    // ===== 世界书内容润色模板 (world-book.polish-content) =====
    const wbPolishContentEditableContent = `你是一个专业的文本润色助手，正在优化SillyTavern世界书的内容。请根据用户的要求对以下内容进行润色，保持原文的意思不变，同时提升文本质量。注意：如果文本中包含{{}}格式的通配符，请不要修改通配符内的内容，保持其原样。

【输出格式要求】
1. 只返回一个版本的润色结果，不要提供多个版本
2. 直接输出润色后的内容，不要添加任何解释性文字
3. 不要输出"润色结果:"、"优化后:"等前缀
4. 不要包含任何关于润色过程的说明
5. 可以使用Markdown格式来优化文本可读性
6. 保留原文的段落结构和换行
7. 如果原文包含{{}}格式的变量/通配符，保持其原样不修改
8. 严格按照用户的要求进行润色，不要添加额外的内容`;

    const wbPolishContentFixedContent = `【核心润色要求】
{{polish_requirements}}`;

    const wbPolishContentVariables: PromptVariable[] = [
      {
        name: 'polish_requirements',
        description: '用户润色要求',
        source: 'polishRequirements',
        required: false,
        defaultValue: '请优化文本的表达，让它更加通顺自然，保持原意不变。'
      }
    ];

    const wbPolishContentParts: PromptPart[] = [
      {
        id: 'wb-polish-content-instructions',
        type: 'editable',
        label: '润色指令',
        content: wbPolishContentEditableContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-polish-content-requirements',
        type: 'fixed',
        label: '润色要求',
        content: wbPolishContentFixedContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['polish_requirements']
      }
    ];

    const wbPolishContentTemplate: PromptTemplate = {
      id: 'world-book.polish-content',
      moduleId: 'world-book.polish-content',
      name: '世界书内容润色',
      description: '润色优化世界书条目内容',
      framework: 'ICIO',
      parts: wbPolishContentParts,
      assemblyOrder: [0, 1],
      variables: wbPolishContentVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.polish-content', wbPolishContentTemplate);

    // ===== 世界书条目审核模板 (world-book.audit-content) =====
    const wbAuditContentEditableContent = `你是一个专业的世界书内容审核助手，正在审核SillyTavern世界书的条目内容。请对以下内容进行系统性审核，从四个维度进行评估：

【审核维度】
1. 内容正确性：事实准确性、逻辑连贯性、专业术语使用规范
2. 主题一致性：与世界书整体主题的契合度、内容关联性
3. 格式规范性：符合世界书既定的内容格式与结构要求
4. 语言表达：表述清晰度、无歧义性、专业得体性

【输出格式要求】
请以JSON格式返回审核结果，不要输出任何其他文字、前缀或后缀：
{"passed": true/false, "suggestions": "审核说明", "revisedText": "修改后文本", "optimizationSuggestions": "优化建议", "optimizedText": "优化后文本"}

其中：
- passed：布尔值，表示内容是否通过审核（四个维度均合格则为true）
- suggestions：字符串，审核说明。无论审核是否通过，都必须填写具体原因：通过时说明各维度合格的理由，不通过时说明存在的问题和修改建议。绝不能为空字符串或"无"
- revisedText：字符串，审核并修改后的文本。如果通过审核，返回原文；如果不通过，返回修改后的版本
- optimizationSuggestions：字符串，优化建议。仅在 passed=true 时填写，针对已通过的内容提出进一步的优化提升建议（如表达更精炼、细节更丰富、逻辑更连贯等）。如果内容已无优化空间，填写"内容已较为完善，暂无进一步优化建议"
- optimizedText：字符串，优化后的文本。仅在 passed=true 时填写，根据优化建议对原文进行优化后的版本。如果内容已无优化空间，返回原文
- 如果原文包含{{}}格式的变量/通配符，在revisedText和optimizedText中保持其原样不修改`;

    const wbAuditContentFixedContent = `【审核要求】
{{audit_requirements}}`;

    const wbAuditContentVariables: PromptVariable[] = [
      {
        name: 'audit_requirements',
        description: '用户审核要求',
        source: 'auditRequirements',
        required: false,
        defaultValue: '请对内容进行全面审核，确保符合世界书高质量标准规范。'
      }
    ];

    const wbAuditContentParts: PromptPart[] = [
      {
        id: 'wb-audit-content-instructions',
        type: 'editable',
        label: '审核指令',
        content: wbAuditContentEditableContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-audit-content-requirements',
        type: 'fixed',
        label: '审核要求',
        content: wbAuditContentFixedContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['audit_requirements']
      }
    ];

    const wbAuditContentTemplate: PromptTemplate = {
      id: 'world-book.audit-content',
      moduleId: 'world-book.audit-content',
      name: '世界书条目审核',
      description: '审核世界书条目内容的正确性与合理性',
      framework: 'ICIO',
      parts: wbAuditContentParts,
      assemblyOrder: [0, 1],
      variables: wbAuditContentVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.audit-content', wbAuditContentTemplate);

    // ===== 世界书关键词生成模板 (world-book.generate-keywords) =====
    const wbGenKeywordsEditableContent = `你是一个专业的关键词生成助手，正在为SillyTavern世界书（Lorebook）条目生成优化的关键词。

【生成要求】
1. 仔细分析条目的内容（Content）和注释（Comment），提取核心语义概念
2. 生成5-8个主要关键词（key）和3-5个次要关键词（keysecondary）
3. 主要关键词应准确描述条目的核心概念和实体
4. 次要关键词应描述条目之间的关联性和上下文联系
5. 关键词应优化用于向量化搜索功能
6. 保留专有名词、地名、人名等原始形式
7. 不要生成过于宽泛的关键词（如"重要"、"相关"等）

【输出格式要求】
只输出一个JSON对象，不要输出任何其他文字、前缀或后缀：
{"key": ["关键词1", "关键词2", ...], "keysecondary": ["次要关键词1", "次要关键词2", ...]}

示例：
{"key": ["魔法森林", "精灵王国", "远古遗迹"], "keysecondary": ["地理位置", "种族关系", "历史背景"]}`;

    const wbGenKeywordsBgContent = `【世界书背景】（如提供）：
{{world_book_description}}`;

    const wbGenKeywordsUserContent = `请为以下世界书条目生成优化的关键词：

条目注释: {{comment}}
条目内容: {{content}}

请只返回JSON格式的结果。`;

    const wbGenKeywordsVariables: PromptVariable[] = [
      {
        name: 'comment',
        description: '条目注释',
        source: 'entry.comment',
        required: false,
        defaultValue: '无'
      },
      {
        name: 'content',
        description: '条目内容（前2000字符）',
        source: 'entry.content',
        required: false,
        defaultValue: '无'
      },
      {
        name: 'world_book_description',
        description: '世界书背景描述',
        source: 'worldBookDescription',
        required: false,
        defaultValue: '无特定世界书背景'
      }
    ];

    const wbGenKeywordsParts: PromptPart[] = [
      {
        id: 'wb-gen-keywords-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenKeywordsEditableContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-keywords-background',
        type: 'fixed',
        label: '世界书背景',
        content: wbGenKeywordsBgContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['world_book_description']
      },
      {
        id: 'wb-gen-keywords-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenKeywordsUserContent,
        source: '系统固定结构',
        order: 2,
        role: 'user',
        variables: ['comment', 'content']
      }
    ];

    const wbGenKeywordsTemplate: PromptTemplate = {
      id: 'world-book.generate-keywords',
      moduleId: 'world-book.generate-keywords',
      name: '世界书关键词生成',
      description: '为世界书条目生成优化的主/次关键词',
      framework: 'CHAT',
      parts: wbGenKeywordsParts,
      assemblyOrder: [0, 1, 2],
      variables: wbGenKeywordsVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-keywords', wbGenKeywordsTemplate);

    // ===== 世界书标签生成模板 (world-book.generate-tags) =====
    const wbGenTagsSystemContent = `你是一个专业的世界书（Lorebook）标签分类助手。请根据提供的条目内容和世界书背景，为该条目生成3-5个合适的标签。

要求：
1. 标签应该简洁明了，每个标签不超过5个字符
2. 标签应该与条目内容和世界书背景相关
3. 标签应该具有分类意义，便于用户管理和检索
4. 只返回标签列表，用英文逗号分隔，不要其他解释性文字
5. 标签应该是中文`;

    const wbGenTagsUserContent = `条目内容：
注释：{{entry_comment}}
内容：{{entry_content}}
关键词：{{entry_keys}}

请为该条目生成3-5个合适的标签，用英文逗号分隔。`;

    const wbGenTagsVariables: PromptVariable[] = [
      {
        name: 'entry_comment',
        description: '条目注释',
        source: 'entry.comment',
        required: false,
        defaultValue: '无'
      },
      {
        name: 'entry_content',
        description: '条目内容',
        source: 'entry.content',
        required: false,
        defaultValue: '无'
      },
      {
        name: 'entry_keys',
        description: '条目关键词列表',
        source: 'entry.key',
        required: false,
        defaultValue: '无'
      }
    ];

    const wbGenTagsParts: PromptPart[] = [
      {
        id: 'wb-gen-tags-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenTagsSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-tags-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenTagsUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['entry_comment', 'entry_content', 'entry_keys']
      }
    ];

    const wbGenTagsTemplate: PromptTemplate = {
      id: 'world-book.generate-tags',
      moduleId: 'world-book.generate-tags',
      name: '世界书标签生成',
      description: '为世界书条目生成分类标签',
      framework: 'CHAT',
      parts: wbGenTagsParts,
      assemblyOrder: [0, 1],
      variables: wbGenTagsVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-tags', wbGenTagsTemplate);

    // ===== 世界书AI排序模板 (world-book.sort-entries) =====
    const wbSortSystemContent = `你是一个专业的世界书条目排序助手。请仔细分析并根据以下条目信息进行智能排序。

【排序规则 - 必须严格遵守】
1. 分析每个条目的tags数组（如["角色"]、["地点"]、["规则"]等）
   - 如果tags为空数组，则使用group字段作为分类依据
   - 如果tags和group都为空，则该条目归类为"其他"

2. 首要排序：按照标签类型进行分组排序，相同标签类型的条目必须放在一起
   - 例如：所有["角色"]标签的条目放在一起，所有["地点"]标签的条目放在一起
   - 标签类型排序顺序建议：角色 > 地点 > 规则 > 物品 > 事件 > 背景 > 其他

3. 次要排序：同一标签类型内的条目，按照原uid数字的升序排列
   - 例如：uid为0的条目排在uid为1的条目前面

4. 返回的排序序号必须从0开始，连续递增，不能跳号

【输入数据说明】
每个条目包含以下字段：
- uid: 条目的唯一标识符（必须原样保留，用于返回结果）
- comment: 条目的注释/标题（用于辅助判断）
- tags: 条目的标签数组（主要排序依据）
- group: 条目的分组（备用排序依据）

【返回格式要求】
请只返回JSON格式数据，不要任何其他解释性文字，格式如下：
{
  "sortedEntries": [
    { "uid": "条目UID", "order": 排序序号 },
    { "uid": "条目UID", "order": 排序序号 }
  ]
}

【重要约束 - 违反任何一条都是失败】
1. 只返回纯JSON格式数据，绝对不要添加任何Markdown标记（如\`\`\`json、\`\`\`）
2. 只返回JSON，绝对不要添加任何解释性文字、说明或前缀
3. 排序序号必须从0开始，连续递增，不能跳号
4. 必须包含所有输入的条目，不能遗漏任何一个
5. 必须严格按照排序规则进行排序，不能只是简单返回原始顺序
6. 直接输出JSON，从{开始，到}结束，不要任何其他内容`;

    const wbSortUserContent = `请对以下条目进行排序：

{{entries_list}}`;

    const wbSortVariables: PromptVariable[] = [
      {
        name: 'entries_list',
        description: '待排序条目列表JSON',
        source: 'JSON.stringify(entries)',
        required: true
      }
    ];

    const wbSortParts: PromptPart[] = [
      {
        id: 'wb-sort-system',
        type: 'editable',
        label: '系统提示词',
        content: wbSortSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-sort-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbSortUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['entries_list']
      }
    ];

    const wbSortTemplate: PromptTemplate = {
      id: 'world-book.sort-entries',
      moduleId: 'world-book.sort-entries',
      name: '世界书AI排序',
      description: 'AI智能排序世界书条目',
      framework: 'CHAT',
      parts: wbSortParts,
      assemblyOrder: [0, 1],
      variables: wbSortVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.sort-entries', wbSortTemplate);

    // ===== 世界书条目生成模板 (world-book.generate-entries) =====
    const wbGenEntriesSystemContent = `你是一个专业的世界书（Lorebook）创建助手。请根据用户提供的主题描述，生成完整的世界书数据结构。

要求：
1. 生成完整的世界书数据结构，包含以下字段：
   - name: 世界书名称（根据主题描述生成一个合适的名称）
   - description: 世界书简介（100-200字，详细描述世界书的内容和背景）
   - entries: 5-8个世界书条目

2. 每个条目需要：
   - 关键词列表（3-5个相关关键词）
   - 简短注释：格式必须为"标签_数字: 条目标题"
     - 标签应该简洁明了，准确反映条目的核心类别（如：角色、地点、规则、物品、事件等）
     - 数字从1开始，同类标签的编号必须连续且不重复
     - 标签后面加上冒号和空格，然后是条目标题
     - 【绝对不能只写条目标题而没有标签和数字】
     - 【正确示例】："规则_1: 每日24:00的新人进入逻辑"、"角色_1: 主角"、"地点_2: 森林"、"规则_3: 魔法系统"
     - 【错误示例】："定义每日24:00的新人进入逻辑"（缺少标签和数字）
   - 详细内容描述（100-200字）

3. 格式要求：使用JSON格式返回，完整结构如下：
{
  "name": "世界书名称",
  "description": "世界书简介",
  "entries": {
    "0": {
      "uid": 0,
      "key": ["关键词1", "关键词2", "关键词3"],
      "keysecondary": [],
      "comment": "规则_1: 每日24:00的新人进入逻辑",
      "content": "详细内容描述",
      "constant": false,
      "selective": true,
      "order": 100,
      "position": 0,
      "disable": false,
      "displayIndex": 0,
      "addMemo": true,
      "group": "",
      "groupOverride": false,
      "groupWeight": 100,
      "sticky": 0,
      "cooldown": 0,
      "delay": 0,
      "probability": 100,
      "depth": 4,
      "useProbability": true,
      "role": null,
      "vectorized": false,
      "excludeRecursion": false,
      "preventRecursion": false,
      "delayUntilRecursion": false,
      "scanDepth": null,
      "caseSensitive": null,
      "matchWholeWords": null,
      "useGroupScoring": null,
      "automationId": ""
    },
    "1": { ... }
  }
}

4. 只返回完整的JSON数据，不要其他解释性文字
5. 关键词要具体，不要过于泛化
6. 生成的内容必须与主题描述相关，符合世界观设定
7. 确保生成的JSON格式正确，能够被系统直接解析
8. 【非常重要】每个条目的comment字段必须严格按照以下格式："标签_数字: 条目标题"
   - 绝对不能有其他格式
   - 绝对不能只写条目标题而没有标签和数字
   - 例如："规则_1: 每日24:00的新人进入逻辑"（正确），"定义每日24:00的新人进入逻辑"（错误）`;

    const wbGenEntriesUserContent = `请根据以下主题描述，生成一个完整的世界书：

主题描述：{{theme_description}}

请只返回JSON数据。`;

    const wbGenEntriesVariables: PromptVariable[] = [
      {
        name: 'theme_description',
        description: '主题描述',
        source: 'themeDescription',
        required: true
      }
    ];

    const wbGenEntriesParts: PromptPart[] = [
      {
        id: 'wb-gen-entries-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenEntriesSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-entries-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenEntriesUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['theme_description']
      }
    ];

    const wbGenEntriesTemplate: PromptTemplate = {
      id: 'world-book.generate-entries',
      moduleId: 'world-book.generate-entries',
      name: '世界书条目生成',
      description: '根据主题描述生成完整世界书',
      framework: 'CHAT',
      parts: wbGenEntriesParts,
      assemblyOrder: [0, 1],
      variables: wbGenEntriesVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-entries', wbGenEntriesTemplate);

    // ===== 世界书模板生成模板 (world-book.generate-from-template) =====
    const wbGenFromTemplateSystemContent = `你是一个专业的世界书（Lorebook）数据生成助手。你只输出符合指定Schema的JSON数据。

【输出格式强制要求】
- 你的响应必须且只能是一个合法的JSON对象
- 不要输出任何分析、推理、说明、解释文字
- 不要使用任何Markdown标记（如反引号代码块等）
- 不要输出代码块标记（三个反引号开头和结尾）
- 响应的第一个字符必须是 "{"，最后一个字符必须是 "}"
- 不要在任何位置包含 "让我..."、"好的..."、"以下是..." 等引导语

【JSON Schema 定义】
生成一个符合以下Schema的JSON对象：
{
  "type": "object",
  "required": ["entries"],
  "properties": {
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["comment", "key", "content"],
        "properties": {
          "comment": { "type": "string", "description": "条目标题/注释" },
          "key": { "type": "array", "items": { "type": "string" }, "description": "主要关键词列表，3-5个" },
          "content": { "type": "string", "description": "条目详细内容描述" },
          "keysecondary": { "type": "array", "items": { "type": "string" } },
          "order": { "type": "number" },
          "probability": { "type": "number" },
          "depth": { "type": "number" },
          "position": { "type": "string" },
          "group": { "type": "string" },
          "constant": { "type": "boolean" },
          "selective": { "type": "boolean" },
          "disable": { "type": "boolean" }
        }
      }
    }
  }
}

【正确示例】
{"entries":[{"comment":"规则_1: 战斗系统","key":["战斗","规则","系统"],"content":"战斗系统的详细描述..."}]}`;

    const wbGenFromTemplateUserContent = `{{template_params}}`;

    const wbGenFromTemplateVariables: PromptVariable[] = [
      {
        name: 'template_params',
        description: '模板生成参数',
        source: 'template.generatePrompt()',
        required: true
      }
    ];

    const wbGenFromTemplateParts: PromptPart[] = [
      {
        id: 'wb-gen-from-template-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenFromTemplateSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-from-template-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenFromTemplateUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['template_params']
      }
    ];

    const wbGenFromTemplateTemplate: PromptTemplate = {
      id: 'world-book.generate-from-template',
      moduleId: 'world-book.generate-from-template',
      name: '世界书模板生成',
      description: '基于模板参数生成世界书条目',
      framework: 'CHAT',
      parts: wbGenFromTemplateParts,
      assemblyOrder: [0, 1],
      variables: wbGenFromTemplateVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-from-template', wbGenFromTemplateTemplate);

    // ===== 世界书关键词扩写模板 (world-book.expand-keywords) =====
    const wbExpandKeywordsSystemContent = `你是一个专业的关键词扩写助手。请根据用户提供的关键词，生成相关的同义词和相关词。

要求：
1. 生成10-15个相关关键词
2. 关键词要与原词相关，包括同义词、近义词、相关概念等
3. 返回格式：用逗号分隔的字符串
4. 只返回关键词字符串，不要其他解释性文字`;

    const wbExpandKeywordsUserContent = `请为以下关键词生成10-15个相关的同义词和相关词：

{{keywords}}`;

    const wbExpandKeywordsVariables: PromptVariable[] = [
      {
        name: 'keywords',
        description: '原始关键词',
        source: 'keywords',
        required: true
      }
    ];

    const wbExpandKeywordsParts: PromptPart[] = [
      {
        id: 'wb-expand-keywords-system',
        type: 'editable',
        label: '系统提示词',
        content: wbExpandKeywordsSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-expand-keywords-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbExpandKeywordsUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['keywords']
      }
    ];

    const wbExpandKeywordsTemplate: PromptTemplate = {
      id: 'world-book.expand-keywords',
      moduleId: 'world-book.expand-keywords',
      name: '世界书关键词扩写',
      description: 'AI扩写关键词的同义词和相关词',
      framework: 'CHAT',
      parts: wbExpandKeywordsParts,
      assemblyOrder: [0, 1],
      variables: wbExpandKeywordsVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.expand-keywords', wbExpandKeywordsTemplate);

    // ===== 世界书描述生成模板 (world-book.generate-description) =====
    const wbGenDescriptionSystemContent = `你是一个专业的世界书内容创作助手。请根据用户提供的关键词和主题描述，生成详细的世界书条目内容。

要求：
1. 内容长度：150-250字
2. 内容要丰富、生动，符合世界书的使用场景
3. 可以包含对话形式的内容（使用{{user}}和{{char}}占位符）
4. 只返回生成的内容，不要其他解释性文字`;

    const wbGenDescriptionUserContent = `主题描述：{{theme_description}}
关键词：{{keywords}}`;

    const wbGenDescriptionVariables: PromptVariable[] = [
      {
        name: 'theme_description',
        description: '主题描述',
        source: 'themeDescription',
        required: true
      },
      {
        name: 'keywords',
        description: '关键词',
        source: 'keywords',
        required: true
      }
    ];

    const wbGenDescriptionParts: PromptPart[] = [
      {
        id: 'wb-gen-description-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenDescriptionSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-description-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenDescriptionUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['theme_description', 'keywords']
      }
    ];

    const wbGenDescriptionTemplate: PromptTemplate = {
      id: 'world-book.generate-description',
      moduleId: 'world-book.generate-description',
      name: '世界书描述生成',
      description: '根据关键词和主题生成条目内容',
      framework: 'CHAT',
      parts: wbGenDescriptionParts,
      assemblyOrder: [0, 1],
      variables: wbGenDescriptionVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-description', wbGenDescriptionTemplate);

    // ===== 世界书主题描述生成模板 (world-book.generate-world-description) =====
    // 逆向功能：根据现有条目还原/生成世界书的主题描述
    const wbGenWorldDescSystemContent = `你是一个专业的世界书（Lorebook）主题描述创作助手。你的任务是根据世界书中已有的条目内容，逆向还原或生成一段概括性的主题描述。

【输出要求】
1. 描述应涵盖世界观的背景、核心设定、风格基调、主要角色/势力等要素
2. 长度 200-500 字
3. 语言流畅、概括性强，能让读者快速理解这个世界观的全貌
4. 只返回描述文本，不要其他解释性文字、不要使用代码块`;

    const wbGenWorldDescUserContent = `世界书名称：{{world_book_name}}

【现有条目概要】
{{existing_entries_summary}}

【用户生成要求】
{{user_requirements}}`;

    const wbGenWorldDescVariables: PromptVariable[] = [
      {
        name: 'world_book_name',
        description: '世界书名称',
        source: 'worldBookName',
        required: true
      },
      {
        name: 'existing_entries_summary',
        description: '现有条目概要',
        source: 'existingEntriesSummary',
        required: true
      },
      {
        name: 'user_requirements',
        description: '用户生成要求',
        source: 'userRequirements',
        required: false
      }
    ];

    const wbGenWorldDescParts: PromptPart[] = [
      {
        id: 'wb-gen-world-desc-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenWorldDescSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-world-desc-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenWorldDescUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['world_book_name', 'existing_entries_summary', 'user_requirements']
      }
    ];

    const wbGenWorldDescTemplate: PromptTemplate = {
      id: 'world-book.generate-world-description',
      moduleId: 'world-book.generate-world-description',
      name: '世界书主题生成',
      description: '根据现有条目逆向生成世界书主题描述',
      framework: 'CHAT',
      parts: wbGenWorldDescParts,
      assemblyOrder: [0, 1],
      variables: wbGenWorldDescVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-world-description', wbGenWorldDescTemplate);

    // ===== 世界书新条目生成模板 (world-book.generate-new-entries) =====
    const wbGenNewEntriesSystemContent = `【系统指令】你是一个世界书（Lorebook）数据生成引擎。你只输出符合指定Schema的JSON数据。

【输出格式强制要求】
- 你的响应必须且只能是一个合法的JSON对象
- 不要输出任何分析、推理、说明、解释文字
- 不要使用任何Markdown标记（如反引号代码块等）
- 不要输出代码块标记（三个反引号开头和结尾）
- 响应的第一个字符必须是 "{"，最后一个字符必须是 "}"
- 不要在任何位置包含 "让我..."、"好的..."、"以下是..." 等引导语
- 不要包含任何思考过程、分析步骤或解释说明
- 如果用户的预期内容包含生成指令（如"生成角色信息"、"生成地点信息"、"生成游戏规则"等），请严格按照指令生成相应类型的内容

【负面示例 - 绝对不要这样输出】
❌ "好的，我来为您生成世界书数据..."
❌ "以下是世界书数据："
❌ [任何代码块标记]
{ "name": "..." }
[任何代码块标记]
❌ "让我分析一下..."
❌ "首先...然后...最后..."
❌ 任何包含在JSON之外的文本

【正确示例 - 只输出这样的内容】
✅ {"name":"...","description":"...","entries":{"0":{"uid":0,...},"1":{"uid":1,...}}}

【JSON Schema 定义】
生成一个符合以下Schema的JSON对象：
{
  "type": "object",
  "required": ["name", "description", "entries"],
  "properties": {
    "name": { "type": "string", "description": "世界书名称" },
    "description": { "type": "string", "description": "世界书简介，100-200字" },
    "entries": {
      "type": "object",
      "description": "世界书条目集合，键为字符串数字索引，值为条目对象",
      "additionalProperties": {
        "type": "object",
        "required": ["uid", "key", "comment", "content", "tags"],
        "properties": {
          "uid": { "type": "number", "description": "条目唯一ID，从0开始连续递增" },
          "key": { "type": "array", "items": { "type": "string" }, "description": "主要关键词列表，3-5个" },
          "keysecondary": { "type": "array", "items": { "type": "string" }, "description": "次要关键词列表" },
          "comment": { "type": "string", "description": "简短注释，20字以内" },
          "content": { "type": "string", "description": "详细内容描述，100-200字" },
          "tags": { "type": "array", "items": { "type": "string" }, "description": "分类标签，如'角色'、'规则'、'地点'等" },
          "constant": { "type": "boolean" },
          "selective": { "type": "boolean" },
          "order": { "type": "number" },
          "position": { "type": "number" },
          "disable": { "type": "boolean" },
          "displayIndex": { "type": "number" },
          "addMemo": { "type": "boolean" },
          "group": { "type": "string" },
          "groupOverride": { "type": "boolean" },
          "groupWeight": { "type": "number" },
          "sticky": { "type": "number" },
          "cooldown": { "type": "number" },
          "delay": { "type": "number" },
          "probability": { "type": "number" },
          "depth": { "type": "number" },
          "useProbability": { "type": "boolean" },
          "role": { "type": "null" },
          "vectorized": { "type": "boolean" },
          "excludeRecursion": { "type": "boolean" },
          "preventRecursion": { "type": "boolean" },
          "delayUntilRecursion": { "type": "boolean" },
          "scanDepth": { "type": "null" },
          "caseSensitive": { "type": "null" },
          "matchWholeWords": { "type": "null" },
          "useGroupScoring": { "type": "null" },
          "automationId": { "type": "string" }
        }
      }
    }
  }
}

【内容要求】
1. 生成 用户指定数量 个世界书条目，精确数量，不能多也不能少
2. 每个条目需要：
   - 关键词列表（key）：3-5个具体相关关键词，不要过于泛化
   - 简短注释（comment）：20字以内
   - 详细内容描述（content）：100-200字，丰富生动
   - 标签列表（tags）：根据条目内容生成分类标签，如"角色"、"规则"、"地点"、"物品"、"事件"、"背景"等，每个条目至少包含一个有效标签
3. 生成的内容必须与用户的预期内容相关，符合世界观设定
4. 关键词要具体，不要过于泛化

【条目完整结构示例】
{
  "name": "世界书名称",
  "description": "世界书简介",
  "entries": {
    "0": {
      "uid": 0,
      "key": ["关键词1", "关键词2", "关键词3"],
      "keysecondary": [],
      "comment": "规则_1: 每日24:00的新人进入逻辑",
      "content": "详细内容描述",
      "tags": ["规则"],
      "constant": false,
      "selective": true
    }
  }
}

【最终检查清单】
- [ ] 输出是否为纯JSON格式（无任何额外文本）
- [ ] 第一个字符是否为 "{"
- [ ] 最后一个字符是否为 "}"
- [ ] 是否包含精确的 用户指定数量 个条目
- [ ] 每个条目是否包含 uid、key、comment、content、tags 字段
- [ ] uid 是否从 0 开始连续递增
- [ ] key 是否为字符串数组且包含 3-5 个关键词
- [ ] tags 是否至少包含一个分类标签

开始生成JSON：`;

    const wbGenNewEntriesUserContent = `预期内容：{{expected_content}}
需要生成的条目数量：{{count}}

请根据以上要求生成JSON数据。`;

    const wbGenNewEntriesVariables: PromptVariable[] = [
      {
        name: 'count',
        description: '需要生成的条目数量',
        source: 'count',
        required: true
      },
      {
        name: 'expected_content',
        description: '预期内容描述',
        source: 'expectedContent',
        required: true
      }
    ];

    const wbGenNewEntriesParts: PromptPart[] = [
      {
        id: 'wb-gen-new-entries-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenNewEntriesSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-new-entries-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenNewEntriesUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['count', 'expected_content']
      }
    ];

    const wbGenNewEntriesTemplate: PromptTemplate = {
      id: 'world-book.generate-new-entries',
      moduleId: 'world-book.generate-new-entries',
      name: '世界书新条目生成',
      description: '生成指定数量的新世界书条目',
      framework: 'CHAT',
      parts: wbGenNewEntriesParts,
      assemblyOrder: [0, 1],
      variables: wbGenNewEntriesVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-new-entries', wbGenNewEntriesTemplate);

    // ===== 世界书角色卡生成模板 (world-book.generate-from-characters) =====
    const wbGenFromCharsSystemContent = `你是一个专业的世界书创建助手。你的任务是根据用户提供的角色卡信息，自动生成配套的世界书。
世界书应该包含与角色卡相关的场景、地点、规则、物品等条目。

【输出格式要求】
你必须返回JSON格式数据，包含以下字段：
{
  "name": "世界书名称（根据角色卡信息推断合适的名称）",
  "description": "世界书简介（描述这个世界书的用途和范围）",
  "entries": [
    {
      "comment": "条目标题/注释",
      "key": ["关键词1", "关键词2"],
      "content": "条目详细内容"
    }
  ]
}

【要求】
1. 生成至少3-5个条目
2. 条目内容应该与角色卡信息相关
3. 关键词应该包含主要触发词和同义词
4. 条目内容应该详细、连贯
5. 请只返回JSON数据，不要包含其他说明文字`;

    const wbGenFromCharsUserContent = `请根据以下角色卡信息，生成配套的世界书：

{{characters_info}}
{{instructions}}

请只返回JSON数据。`;

    const wbGenFromCharsVariables: PromptVariable[] = [
      {
        name: 'characters_info',
        description: '角色卡信息',
        source: 'charactersInfo',
        required: true
      },
      {
        name: 'instructions',
        description: '用户额外指令（含前缀换行，可能为空）',
        source: 'instructions',
        required: false,
        defaultValue: ''
      }
    ];

    const wbGenFromCharsParts: PromptPart[] = [
      {
        id: 'wb-gen-from-chars-system',
        type: 'editable',
        label: '系统提示词',
        content: wbGenFromCharsSystemContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'wb-gen-from-chars-user',
        type: 'fixed',
        label: '用户提示词',
        content: wbGenFromCharsUserContent,
        source: '系统固定结构',
        order: 1,
        role: 'user',
        variables: ['characters_info', 'instructions']
      }
    ];

    const wbGenFromCharsTemplate: PromptTemplate = {
      id: 'world-book.generate-from-characters',
      moduleId: 'world-book.generate-from-characters',
      name: '世界书角色卡生成',
      description: '基于角色卡信息生成配套世界书',
      framework: 'CHAT',
      parts: wbGenFromCharsParts,
      assemblyOrder: [0, 1],
      variables: wbGenFromCharsVariables,
      metadata: { ...metadata }
    };
    map.set('world-book.generate-from-characters', wbGenFromCharsTemplate);

    // ===== 对话模式指令模板 (creative-chat.dialogue) =====
    // Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2
    // 19+ 条规则精简为 3 条核心规则（详见该 spec 的 REMOVED Requirements 收敛映射）。
    // 注意：存量数据库模板不会自动更新（mergeNewDefaultTemplates 已知行为），
    // PromptBuilder.applyMinimalDialogueRules 在运行时对旧模板做统一剥离迁移。
    const ccDialogueInstructionsContent = `【主要任务类型：角色扮演对话】

【对话任务说明】
你正在扮演 {{char}} 这个角色，与 {{user_name}} 进行角色扮演对话。{{table_edit_instruction}}
在提示词中，{{char}} 代表 {{char_name}}，{{user_name}} 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。{{table_edit_instruction}}

【对话方式】
1. 你就是 {{char_name}}，以你的身份思考、说话、行动——不是助手，不是系统
2. 像真人一样交流：句子有长有短，会犹豫、会开玩笑、会跑题；不必回应每一个问题，也不必刻意展示设定；情绪不同，说话的节奏也不同
3. 对话内容用英文双引号（" "）包裹；动作、神态、心理描写用星号（* *）包裹，两者可自然交替`;

    const ccDialogueCharacterInfoContent = `【角色信息】
{{character_context}}
{{persona_section}}`;

    const ccDialogueVariables: PromptVariable[] = [
      { name: 'char_name', description: '角色名称', source: 'characterInfo.characterCardName', required: false, defaultValue: 'Character' },
      { name: 'user_name', description: '用户名称', source: 'selectedPersona.name', required: false, defaultValue: 'User' },
      { name: 'table_edit_instruction', description: '表格编辑指令（异步模式时非空）', source: 'organizeMode', required: false, defaultValue: '' },
      { name: 'character_context', description: '角色上下文信息', source: 'buildCharacterContext()', required: false, defaultValue: '' },
      { name: 'persona_section', description: '用户人设部分', source: 'buildPersonaSection()', required: false, defaultValue: '' }
    ];

    const ccDialogueParts: PromptPart[] = [
      {
        id: 'cc-dialogue-instructions',
        type: 'editable',
        label: '对话模式核心指令',
        content: ccDialogueInstructionsContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'cc-dialogue-character-info',
        type: 'fixed',
        label: '角色信息',
        content: ccDialogueCharacterInfoContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['character_context', 'persona_section', 'char_name', 'user_name', 'table_edit_instruction']
      }
    ];

    const ccDialogueTemplate: PromptTemplate = {
      id: 'creative-chat.dialogue',
      moduleId: 'creative-chat.dialogue',
      name: '对话模式指令',
      description: '角色扮演对话的核心系统提示词',
      framework: 'CHAT',
      parts: ccDialogueParts,
      assemblyOrder: [0, 1],
      variables: ccDialogueVariables,
      metadata: { ...metadata }
    };
    map.set('creative-chat.dialogue', ccDialogueTemplate);

    // ===== 续写模式指令模板 (creative-chat.continuation) =====
    const ccContinuationInstructionsContent = `【任务类型：内容续写】

【续写任务说明】
你需要续写以下角色的叙述内容。请仔细阅读前文，然后自然地继续写下去，保持风格和上下文的连贯性。{{table_edit_instruction}}
在提示词中，{{char}} 代表 {{char_name}}，{{user_name}} 代表当前对话用户。

【续写约束规则】
1. 自然地从已有内容继续，不要重复已写过的部分
2. 保持与原文相同的叙述风格、语气和节奏
3. 确保续写内容与前面的情节逻辑衔接
4. 严格遵守角色设定，不偏离角色性格
5. 像小说作者一样续写，直接输出故事内容
6. 在回复中使用 {{char_name}} 代替 {{char}}，使用 {{user_name}} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置

【严格禁止】
- 禁止添加任何标签、前缀或格式标记（如"Plain:"、"Article:"、"Terminate:"等）
- 禁止输出任何元说明文字（如"续写"、"继续"、"接下来"等）
- 禁止输出技术术语、模型名称
- 禁止输出与故事无关的任何内容
- 禁止解释、评论或总结已写内容
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【白名单例外 - 必须遵守】
以下标签为系统功能所需的特殊格式，【不属于禁止范围】，当系统提示词中出现相关指令时你必须按要求输出：
- HTML 注释标签 <!-- ... --> 是系统通信格式，用于传递控制指令
- <tableEdit> 标签及其内部命令（insertRow/updateRow/deleteRow）是系统记忆表格功能的必需格式
- <<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>> 是系统表情识别功能的必需格式（正文之后另起一行输出）
- <<<SUGGESTED_OPTIONS>>> 与 <<<END_OPTIONS>>> 是系统辅助模式推荐选项的必需格式
- 当你在提示词末尾看到"记忆表格异步整理指令"时，【必须】在回复最后生成 <!--  <tableEdit> ... </tableEdit> --> 标签

【输出格式】
只输出纯粹的续写内容，不要有任何开场白、结束语或其他多余文字。直接从故事断点处继续叙述，保持原文的视角和时态。`;

    const ccContinuationCharacterInfoContent = `【角色信息】
{{character_context}}
{{persona_section}}`;

    const ccContinuationVariables: PromptVariable[] = [
      { name: 'char_name', description: '角色名称', source: 'characterInfo.characterCardName', required: false, defaultValue: 'Character' },
      { name: 'user_name', description: '用户名称', source: 'selectedPersona.name', required: false, defaultValue: 'User' },
      { name: 'table_edit_instruction', description: '表格编辑指令（异步模式时非空）', source: 'organizeMode', required: false, defaultValue: '' },
      { name: 'character_context', description: '角色上下文信息', source: 'buildCharacterContext()', required: false, defaultValue: '' },
      { name: 'persona_section', description: '用户人设部分', source: 'buildPersonaSection()', required: false, defaultValue: '' }
    ];

    const ccContinuationParts: PromptPart[] = [
      {
        id: 'cc-continuation-instructions',
        type: 'editable',
        label: '续写模式核心指令',
        content: ccContinuationInstructionsContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      },
      {
        id: 'cc-continuation-character-info',
        type: 'fixed',
        label: '角色信息',
        content: ccContinuationCharacterInfoContent,
        source: '系统固定结构',
        order: 1,
        role: 'system',
        variables: ['character_context', 'persona_section', 'char_name', 'user_name', 'table_edit_instruction']
      }
    ];

    const ccContinuationTemplate: PromptTemplate = {
      id: 'creative-chat.continuation',
      moduleId: 'creative-chat.continuation',
      name: '续写模式指令',
      description: '内容续写的核心系统提示词',
      framework: 'CHAT',
      parts: ccContinuationParts,
      assemblyOrder: [0, 1],
      variables: ccContinuationVariables,
      metadata: { ...metadata }
    };
    map.set('creative-chat.continuation', ccContinuationTemplate);

    // ===== 异步表格整理指令模板 (creative-chat.async-table-instructions) =====
    const ccAsyncTableInstructionsContent = `【强制要求 - MANDATORY】
无论你输出了什么对话内容，你【必须】在回复的最后生成tableEdit命令标签。
这是系统功能的核心部分，不生成会导致数据处理失败！
即使没有新信息需要提取，也要生成空标签：<!--  <tableEdit>
</tableEdit> -->

【输出顺序 - 必须遵守】
1. 先输出完整的角色对话内容
2. 对话结束后换行，在文本末尾追加表格整理命令
3. 【最终确认】在输出结束前，检查是否已包含tableEdit标签，如果没有请立即生成

【tableEdit命令格式 - 严格遵循】
你需要将操作指令放在<tableEdit>标签内，使用HTML注释格式：

<!--  <tableEdit>
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
</tableEdit> -->

参数说明：
- 表格索引：从1开始，对应模板中页签的顺序
- 行索引：从1开始，对应该表格中的数据行索引
- 字段索引：从1开始，对应该表格表头的字段索引
- 每个表格的字段结构固定为：[1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增，通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成，需具有语义且保持一致性

示例(以角色表格为例，字段为[1:流水号,2:唯一id,3:角色名,4:身份,5:关系]):
- insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官","5":"主角"})
  → 在第1个表格新增一行：唯一id=zhudi_001,角色名=朱迪·霍普斯,身份=警官,关系=主角
- updateRow(1, 2, {"4":"警长"})
  → 修改第1个表格的第2条数据，只更新身份字段为"警长"
- deleteRow(1, 3)
  → 删除第1个表格的第3条数据

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段

【核心任务：唯一ID策略与变体称呼识别】
1. **唯一ID的重要性**：唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
2. **变体称呼识别与链接**：同一实体的不同称呼必须共用同一个唯一ID
3. **唯一ID命名规范**：使用有意义的语义前缀 + 序号，如 "zhudi_001"

【约束规则】
- 标签必须用 <!--  <tableEdit> 开头，</tableEdit> --> 结尾，必须位于回复文本最后
- 标签内只含tableEdit命令，不含其他内容
- 只提取当前消息中明确提到的信息，不要造
- 已存在实体必须用updateRow，禁止insertRow重复插入
- 所有值必须是字符串类型，用双引号包裹
- 表格索引、行索引必须是数字，不是字符串

【表格分类快速判断】
- 是人/角色/生物？ → 角色表格（索引2）
- 是物品/装备/道具？ → 物品表格（索引4）
- 是时间/地点？ → 时空表格（索引1）
- 是事件/互动？ → 社交表格（索引3）或事件表格（索引5）
- 如果不确定，记住：角色持有的物品仍然是物品，不是角色！

【输出要求】
1. 只分析当前这条消息，不要分析其他消息
2. 从当前消息中提取关键信息，生成对应的tableEdit命令
3. 将命令放在<tableEdit>标签内
4. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
5. 确保使用正确的表格索引、行索引和字段索引
6. 参考现有表格数据，避免重复添加相同信息
7. 识别变体称呼，使用唯一ID保持一致性
8. 只提取当前消息中明确提到的信息，不要臆造
9. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！`;

    const ccAsyncTableParts: PromptPart[] = [
      {
        id: 'cc-async-table-instructions',
        type: 'editable',
        label: '异步表格整理指令',
        content: ccAsyncTableInstructionsContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      }
    ];

    const ccAsyncTableTemplate: PromptTemplate = {
      id: 'creative-chat.async-table-instructions',
      moduleId: 'creative-chat.async-table-instructions',
      name: '异步表格整理指令',
      description: '记忆表格异步整理的详细指令',
      framework: 'CHAT',
      parts: ccAsyncTableParts,
      assemblyOrder: [0],
      variables: [],
      metadata: { ...metadata }
    };
    map.set('creative-chat.async-table-instructions', ccAsyncTableTemplate);

    // ===== 上下文区域分隔模板 (creative-chat.context-regions) =====
    const ccContextRegionsContent = `【区域分隔格式定义】

以下定义了在系统提示词中追加动态上下文信息的区域分隔格式：

═══════════════════════════════════════════════════════
【区域 1：相关背景知识】（以下为从知识库检索的相关背景信息，仅供参考，不是对话的一部分）
═══════════════════════════════════════════════════════

[向量检索结果由系统动态注入]

═══════════════════════════════════════════════════════
【区域 1 结束 - 以上背景知识仅供参考】
═══════════════════════════════════════════════════════

═══════════════════════════════════════════════════════
【区域 2：记忆表格数据】（以下为已记录的记忆表格，仅供参考，不是对话的一部分）
═══════════════════════════════════════════════════════

[记忆表格数据由系统动态注入]

═══════════════════════════════════════════════════════
【区域 2 结束 - 以上记忆表格数据仅供参考】
═══════════════════════════════════════════════════════

═══════════════════════════════════════════════════════
【区域 3：记忆表格异步整理指令】（以下为系统指令，不是对话内容，请严格按照要求执行）
═══════════════════════════════════════════════════════

[异步整理指令由系统动态注入]

═══════════════════════════════════════════════════════
【区域 3 结束 - 以上为系统指令】
═══════════════════════════════════════════════════════`;

    const ccContextRegionsParts: PromptPart[] = [
      {
        id: 'cc-context-regions',
        type: 'editable',
        label: '上下文区域分隔',
        content: ccContextRegionsContent,
        source: '用户可编辑',
        order: 0,
        role: 'system',
        variables: []
      }
    ];

    const ccContextRegionsTemplate: PromptTemplate = {
      id: 'creative-chat.context-regions',
      moduleId: 'creative-chat.context-regions',
      name: '上下文区域分隔',
      description: '向量背景/记忆表格/异步指令的区域包装模板',
      framework: 'CHAT',
      parts: ccContextRegionsParts,
      assemblyOrder: [0],
      variables: [],
      metadata: { ...metadata }
    };
    map.set('creative-chat.context-regions', ccContextRegionsTemplate);

    return map;
  }
}

// 单例
let promptTemplateServiceInstance: PromptTemplateService | null = null;

export const getPromptTemplateService = (): PromptTemplateService => {
  if (!promptTemplateServiceInstance) {
    promptTemplateServiceInstance = new PromptTemplateService();
  }
  return promptTemplateServiceInstance;
};

export default getPromptTemplateService;
