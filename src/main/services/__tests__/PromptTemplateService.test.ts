import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptTemplate } from '../../../shared/types/promptTemplate.types';

// Mock fs - existsSync returns false so service loads defaults with empty history
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(() => {}),
  renameSync: vi.fn(() => {}),
  mkdirSync: vi.fn(() => {}),
}));

// Mock appPath to avoid electron dependency
vi.mock('../../utils/appPath', () => ({
  getUserDataPath: vi.fn(() => '/fake/userdata'),
}));

// Mock storageService - getSettings returns empty object so no engine system prompt is prepended
vi.mock('../storageService', () => ({
  getStorageService: vi.fn(() => ({
    getSettings: vi.fn(() => ({})),
  })),
}));

describe('PromptTemplateService', () => {
  let service: any;

  beforeEach(async () => {
    vi.resetModules();
    const { getPromptTemplateService } = await import('../PromptTemplateService');
    service = getPromptTemplateService();
  });

  // ========== 1. 默认模板测试 ==========
  describe('Default templates', () => {
    it('getAllTemplates() should return 22 templates (3 character-card + 15 world-book + 4 creative-chat)', () => {
      const templates = service.getAllTemplates();
      expect(templates).toHaveLength(22);
    });

    it('each default template should have correct moduleId, name, framework', () => {
      const templates = service.getAllTemplates();

      const translate = templates.find((t: any) => t.moduleId === 'character-card.translate');
      expect(translate).toBeDefined();
      expect(translate.moduleId).toBe('character-card.translate');
      expect(translate.name).toBe('角色卡翻译');
      expect(translate.framework).toBe('ICIO');

      const generate = templates.find((t: any) => t.moduleId === 'character-card.generate');
      expect(generate).toBeDefined();
      expect(generate.moduleId).toBe('character-card.generate');
      expect(generate.name).toBe('角色卡内容生成');
      expect(generate.framework).toBe('CHAT');

      const polish = templates.find((t: any) => t.moduleId === 'character-card.polish');
      expect(polish).toBeDefined();
      expect(polish.moduleId).toBe('character-card.polish');
      expect(polish.name).toBe('角色卡内容润色');
      expect(polish.framework).toBe('ICIO');
    });

    it('translate template should have expected parts (editable system) and target_field_label variable', () => {
      const translate = service.getTemplate('character-card.translate');
      expect(translate).not.toBeNull();
      expect(translate.parts).toHaveLength(1);
      // Pure text with no variables → should be editable
      expect(translate.parts[0].type).toBe('editable');
      expect(translate.parts[0].role).toBe('system');
      expect(translate.parts[0].source).toBe('用户可编辑');
      // Spec: fix-character-card-field-scope-flash-models — 新增目标字段作用域变量
      const varNames = translate.variables.map((v: any) => v.name);
      expect(varNames).toContain('target_field_label');
      // 系统提示含作用域约束锚点
      expect(translate.parts[0].content).toContain('【翻译范围约束】');
      expect(translate.parts[0].content).toContain('本次翻译目标字段：【{{target_field_label}}】');
      expect(translate.parts[0].content).toContain('绝对禁止输出角色卡其他字段');
    });

    it('generate template should have expected parts (editable system + fixed user) and variables', () => {
      const generate = service.getTemplate('character-card.generate');
      expect(generate).not.toBeNull();
      expect(generate.parts).toHaveLength(2);

      const systemPart = generate.parts.find((p: any) => p.role === 'system');
      // Pure text with no variables → should be editable
      expect(systemPart.type).toBe('editable');
      expect(systemPart.source).toBe('用户可编辑');

      const userPart = generate.parts.find((p: any) => p.role === 'user');
      // Contains {{variables}} → should be fixed
      expect(userPart.type).toBe('fixed');
      expect(userPart.source).toBe('系统固定结构');

      const varNames = generate.variables.map((v: any) => v.name);
      expect(varNames).toContain('target_field_label');
      expect(varNames).toContain('target_field_guide');
      expect(varNames).toContain('character_name');
      expect(varNames).toContain('existing_fields_info');
    });

    it('polish template should have expected parts (editable text + fixed parameter) and variables', () => {
      const polish = service.getTemplate('character-card.polish');
      expect(polish).not.toBeNull();
      expect(polish.parts).toHaveLength(2);
      // First part: editable large text (role + guidance + rules), NO variables
      expect(polish.parts[0].type).toBe('editable');
      expect(polish.parts[0].role).toBe('system');
      expect(polish.parts[0].source).toBe('用户可编辑');
      expect(polish.parts[0].variables).toEqual([]);
      // Second part: fixed parameterized section containing {{polish_requirements}}
      expect(polish.parts[1].type).toBe('fixed');
      expect(polish.parts[1].role).toBe('system');
      expect(polish.parts[1].source).toBe('系统固定结构');
      expect(polish.parts[1].variables).toContain('polish_requirements');

      const varNames = polish.variables.map((v: any) => v.name);
      expect(varNames).toContain('polish_requirements');
      // Spec: fix-character-card-field-scope-flash-models — 新增目标字段作用域变量与约束
      expect(varNames).toContain('target_field_label');
      expect(polish.parts[0].content).toContain('【润色范围约束】');
      expect(polish.parts[0].content).toContain('本次润色目标字段：【{{target_field_label}}】');
      expect(polish.parts[0].content).toContain('绝对禁止输出角色卡其他字段');
    });

    // ========== Spec: fix-character-card-field-scope-flash-models — 生成模板作用域强化 ==========
    it('generate template should contain field-scope constraints (user prompt 首行前置 + 系统规则第 7 条)', () => {
      const generate = service.getTemplate('character-card.generate');
      const systemPart = generate.parts.find((p: any) => p.role === 'system');
      const userPart = generate.parts.find((p: any) => p.role === 'user');
      // 系统提示生成规则含"仅生成目标字段"
      expect(systemPart.content).toContain('仅生成【{{target_field_label}}】一个字段的内容');
      expect(systemPart.content).toContain('绝对禁止生成或输出其他任何字段的内容');
      // user prompt 首行前置目标字段强调（位于已有信息段之前）
      expect(userPart.content.indexOf('本次任务：仅生成【{{target_field_label}}】字段的内容')).toBeLessThan(
        userPart.content.indexOf('【角色卡已有信息】')
      );
    });

    it('buildPrompt should substitute target_field_label in translate/polish system prompts', () => {
      const translateResult = service.buildPrompt('character-card.translate', { target_field_label: '描述' });
      expect(translateResult.systemPrompt).toContain('本次翻译目标字段：【描述】');
      expect(translateResult.systemPrompt).not.toContain('{{target_field_label}}');

      const polishResult = service.buildPrompt('character-card.polish', {
        polish_requirements: '测试要求',
        target_field_label: '个性',
      });
      expect(polishResult.systemPrompt).toContain('本次润色目标字段：【个性】');
      expect(polishResult.systemPrompt).not.toContain('{{target_field_label}}');
    });

    // ========== 世界书模板测试 ==========
    it('world-book templates should all exist with correct moduleId prefix', () => {
      const templates = service.getAllTemplates();
      const worldBookTemplates = templates.filter((t: any) => t.moduleId.startsWith('world-book.'));
      expect(worldBookTemplates).toHaveLength(15);

      const expectedModuleIds = [
        'world-book.translate',
        'world-book.polish-keyword',
        'world-book.polish-comment',
        'world-book.polish-content',
        'world-book.audit-content',
        'world-book.generate-keywords',
        'world-book.generate-tags',
        'world-book.sort-entries',
        'world-book.generate-entries',
        'world-book.generate-from-template',
        'world-book.expand-keywords',
        'world-book.generate-description',
        'world-book.generate-world-description',
        'world-book.generate-new-entries',
        'world-book.generate-from-characters',
      ];
      for (const moduleId of expectedModuleIds) {
        const template = service.getTemplate(moduleId);
        expect(template).not.toBeNull();
        expect(template.moduleId).toBe(moduleId);
        expect(template.id).toBe(moduleId);
      }
    });

    it('world-book.translate should have 1 editable system part with no variables', () => {
      const template = service.getTemplate('world-book.translate');
      expect(template).not.toBeNull();
      expect(template.parts).toHaveLength(1);
      expect(template.parts[0].type).toBe('editable');
      expect(template.parts[0].role).toBe('system');
      expect(template.parts[0].variables).toEqual([]);
      expect(template.variables).toHaveLength(0);
    });

    it('world-book.polish-* templates should each have editable + fixed parts with polish_requirements variable', () => {
      const moduleIds = ['world-book.polish-keyword', 'world-book.polish-comment', 'world-book.polish-content'];
      for (const moduleId of moduleIds) {
        const template = service.getTemplate(moduleId);
        expect(template).not.toBeNull();
        expect(template.parts).toHaveLength(2);
        // editable part: large text, no variables
        expect(template.parts[0].type).toBe('editable');
        expect(template.parts[0].role).toBe('system');
        expect(template.parts[0].variables).toEqual([]);
        // fixed part: contains {{polish_requirements}}
        expect(template.parts[1].type).toBe('fixed');
        expect(template.parts[1].role).toBe('system');
        expect(template.parts[1].variables).toContain('polish_requirements');
        // variable definition
        const varNames = template.variables.map((v: any) => v.name);
        expect(varNames).toContain('polish_requirements');
      }
    });

    it('world-book templates with user prompt should have fixed user part containing variables', () => {
      const testCases = [
        { moduleId: 'world-book.generate-tags', expectedVars: ['entry_comment', 'entry_content', 'entry_keys'] },
        { moduleId: 'world-book.sort-entries', expectedVars: ['entries_list'] },
        { moduleId: 'world-book.generate-entries', expectedVars: ['theme_description'] },
        { moduleId: 'world-book.generate-from-template', expectedVars: ['template_params'] },
        { moduleId: 'world-book.expand-keywords', expectedVars: ['keywords'] },
        { moduleId: 'world-book.generate-description', expectedVars: ['theme_description', 'keywords'] },
        { moduleId: 'world-book.generate-new-entries', expectedVars: ['count', 'expected_content'] },
        { moduleId: 'world-book.generate-from-characters', expectedVars: ['characters_info', 'instructions'] },
      ];
      for (const { moduleId, expectedVars } of testCases) {
        const template = service.getTemplate(moduleId);
        expect(template).not.toBeNull();
        // Should have at least 1 editable system part and 1 fixed user part
        const editableSystemParts = template.parts.filter((p: any) => p.type === 'editable' && p.role === 'system');
        const fixedUserParts = template.parts.filter((p: any) => p.type === 'fixed' && p.role === 'user');
        expect(editableSystemParts.length).toBeGreaterThanOrEqual(1);
        expect(fixedUserParts.length).toBeGreaterThanOrEqual(1);
        // Check variables are defined
        const varNames = template.variables.map((v: any) => v.name);
        for (const v of expectedVars) {
          expect(varNames).toContain(v);
        }
      }
    });

    // ========== 创作中心聊天模式模板测试 ==========
    it('creative-chat templates should all exist with correct moduleId prefix', () => {
      const templates = service.getAllTemplates();
      const creativeChatTemplates = templates.filter((t: any) => t.moduleId.startsWith('creative-chat.'));
      expect(creativeChatTemplates).toHaveLength(4);

      const expectedModuleIds = [
        'creative-chat.dialogue',
        'creative-chat.continuation',
        'creative-chat.async-table-instructions',
        'creative-chat.context-regions',
      ];
      for (const moduleId of expectedModuleIds) {
        const template = service.getTemplate(moduleId);
        expect(template).not.toBeNull();
        expect(template.moduleId).toBe(moduleId);
      }
    });

    it('creative-chat.dialogue and creative-chat.continuation should have editable + fixed parts with variables', () => {
      const moduleIds = ['creative-chat.dialogue', 'creative-chat.continuation'];
      for (const moduleId of moduleIds) {
        const template = service.getTemplate(moduleId);
        expect(template).not.toBeNull();
        expect(template.parts).toHaveLength(2);
        // editable part: core instructions, no variables
        expect(template.parts[0].type).toBe('editable');
        expect(template.parts[0].role).toBe('system');
        expect(template.parts[0].variables).toEqual([]);
        // fixed part: character info with variables
        expect(template.parts[1].type).toBe('fixed');
        expect(template.parts[1].role).toBe('system');
        // Should contain character_context and persona_section variables
        expect(template.parts[1].variables).toContain('character_context');
        expect(template.parts[1].variables).toContain('persona_section');
        // Check variable definitions
        const varNames = template.variables.map((v: any) => v.name);
        expect(varNames).toContain('char_name');
        expect(varNames).toContain('user_name');
        expect(varNames).toContain('table_edit_instruction');
        expect(varNames).toContain('character_context');
        expect(varNames).toContain('persona_section');
      }
    });

    it('creative-chat.async-table-instructions and creative-chat.context-regions should have 1 editable part with no variables', () => {
      const moduleIds = ['creative-chat.async-table-instructions', 'creative-chat.context-regions'];
      for (const moduleId of moduleIds) {
        const template = service.getTemplate(moduleId);
        expect(template).not.toBeNull();
        expect(template.parts).toHaveLength(1);
        expect(template.parts[0].type).toBe('editable');
        expect(template.parts[0].role).toBe('system');
        expect(template.parts[0].variables).toEqual([]);
        expect(template.variables).toHaveLength(0);
      }
    });
  });

  // ========== 2. buildPrompt 测试 ==========
  describe('buildPrompt', () => {
    it('translate template with empty variables should return systemPrompt containing "翻译" and empty userPrompt', () => {
      const result = service.buildPrompt('character-card.translate', {});
      expect(result.systemPrompt).toContain('翻译');
      expect(result.userPrompt).toBe('');
    });

    it('polish template with polish_requirements should include the requirement in systemPrompt', () => {
      const result = service.buildPrompt('character-card.polish', {
        polish_requirements: 'test requirement',
      });
      expect(result.systemPrompt).toContain('test requirement');
    });

    it('generate template with key variables should return both systemPrompt and userPrompt with variables replaced', () => {
      const result = service.buildPrompt('character-card.generate', {
        target_field_label: '描述',
        target_field_guide: '角色描述',
        character_name: '测试角色',
      });
      // systemPrompt should contain generate system content
      expect(result.systemPrompt).toContain('角色卡内容生成');
      // userPrompt should have variables replaced
      expect(result.userPrompt).toContain('描述');
      expect(result.userPrompt).toContain('角色描述');
      expect(result.userPrompt).toContain('测试角色');
      // Should not contain unreplaced placeholders for provided variables
      expect(result.userPrompt).not.toContain('{{target_field_label}}');
      expect(result.userPrompt).not.toContain('{{target_field_guide}}');
      expect(result.userPrompt).not.toContain('{{character_name}}');
    });

    it('{{variable_name}} placeholders should be correctly replaced with provided values', () => {
      const result = service.buildPrompt('character-card.polish', {
        polish_requirements: '自定义润色要求',
      });
      expect(result.systemPrompt).toContain('自定义润色要求');
      expect(result.systemPrompt).not.toContain('{{polish_requirements}}');
    });

    it('variables not provided should use their defaultValue', () => {
      const result = service.buildPrompt('character-card.generate', {
        target_field_label: '描述',
        target_field_guide: '角色描述',
        // character_name not provided, should use defaultValue '未设置'
        // existing_fields_info not provided, should use its defaultValue
      });
      // character_name has defaultValue '未设置'
      expect(result.userPrompt).toContain('未设置');
      // existing_fields_info has a defaultValue containing '暂无其他字段信息'
      expect(result.userPrompt).toContain('暂无其他字段信息');
    });

    it('variables not provided and without defaultValue should be replaced with empty string', () => {
      const result = service.buildPrompt('character-card.generate', {});
      // target_field_label is required and has no defaultValue → replaced with empty string
      // The content has 【{{target_field_label}}】which becomes 【】
      expect(result.userPrompt).toContain('【】');
      // No unreplaced placeholders should remain
      expect(result.userPrompt).not.toMatch(/\{\{target_field_label\}\}/);
      expect(result.userPrompt).not.toMatch(/\{\{target_field_guide\}\}/);
    });
  });

  // ========== 3. validateTemplate 测试 ==========
  describe('validateTemplate', () => {
    it('a valid template should return { valid: true, issues: [] }', () => {
      const translate = service.getTemplate('character-card.translate');
      const result = service.validateTemplate(translate);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('a template with unclosed ``` code blocks should return an error', () => {
      const base = service.getTemplate('character-card.translate');
      const template: PromptTemplate = {
        ...base,
        parts: [
          {
            id: 'test-part',
            type: 'fixed',
            label: '测试',
            content: '```some code block',
            source: 'test',
            order: 0,
            role: 'system',
            variables: [],
          },
        ],
        variables: [],
      };
      const result = service.validateTemplate(template);
      expect(result.valid).toBe(false);
      const codeBlockError = result.issues.find(
        (i: any) => i.level === 'error' && i.message.includes('代码块')
      );
      expect(codeBlockError).toBeDefined();
    });

    it('a template with unregistered {{unknown_var}} placeholder should return an error', () => {
      const base = service.getTemplate('character-card.translate');
      const template: PromptTemplate = {
        ...base,
        parts: [
          {
            id: 'test-part',
            type: 'fixed',
            label: '测试',
            content: '翻译文本 {{unknown_var}}',
            source: 'test',
            order: 0,
            role: 'system',
            variables: [],
          },
        ],
        variables: [],
      };
      const result = service.validateTemplate(template);
      const varIssues = result.issues.filter((i: any) => i.message.includes('unknown_var'));
      expect(varIssues.length).toBeGreaterThan(0);
      expect(varIssues[0].level).toBe('error');
    });

    it('a template with a defined variable not used in any part should return a warning', () => {
      const base = service.getTemplate('character-card.translate');
      const template: PromptTemplate = {
        ...base,
        parts: [
          {
            id: 'test-part',
            type: 'fixed',
            label: '测试',
            content: '翻译文本内容',
            source: 'test',
            order: 0,
            role: 'system',
            variables: [],
          },
        ],
        variables: [
          {
            name: 'unused_var',
            description: '未使用的变量',
            source: 'test',
            required: false,
          },
        ],
      };
      const result = service.validateTemplate(template);
      const warnings = result.issues.filter((i: any) => i.level === 'warning');
      const unusedWarning = warnings.find((i: any) => i.message.includes('unused_var'));
      expect(unusedWarning).toBeDefined();
    });

    it('a translate template without "翻译" keyword should return a warning', () => {
      const base = service.getTemplate('character-card.translate');
      const template: PromptTemplate = {
        ...base,
        parts: [
          {
            id: 'test-part',
            type: 'fixed',
            label: '系统提示词',
            content: '你是一个助手，请帮助用户处理文本。',
            source: 'test',
            order: 0,
            role: 'system',
            variables: [],
          },
        ],
        variables: [],
      };
      const result = service.validateTemplate(template);
      const warnings = result.issues.filter((i: any) => i.level === 'warning');
      const keywordWarning = warnings.find((i: any) => i.message.includes('翻译'));
      expect(keywordWarning).toBeDefined();
    });
  });

  // ========== 4. 历史记录和回滚测试 ==========
  // ========== Spec: fix-character-card-field-scope-flash-models — 存量模板迁移 ==========
  describe('migrateCharacterCardFieldScope', () => {
    // 从新种子推导旧种子（移除本次插入的作用域块），保持测试与种子同步自维护
    const TRANSLATE_SCOPE_BLOCK = `\n\n【翻译范围约束】\n本次翻译目标字段：【{{target_field_label}}】。\n- 仅翻译用户消息中 <translate_target> 标签内的文本\n- <context_reference> 标签内的其他字段内容仅作用词参考，绝对禁止翻译或输出其中任何内容\n- 绝对禁止输出角色卡其他字段（如个性、场景、初始消息等）的内容\n- 你的唯一输出是目标字段文本的译文`;
    const POLISH_SCOPE_BLOCK = `\n\n【润色范围约束】\n本次润色目标字段：【{{target_field_label}}】。\n- 仅润色用户消息中 <polish_target> 标签内的文本\n- <context_reference> 标签内的其他字段内容仅作参考，绝对禁止润色或输出其中任何内容\n- 绝对禁止输出角色卡其他字段（如个性、场景、初始消息等）的内容\n- 你的唯一输出是目标字段润色后的文本`;
    const GENERATE_SYSTEM_RULE7 = `\n7. 仅生成【{{target_field_label}}】一个字段的内容，绝对禁止生成或输出其他任何字段的内容（即使它们出现在已有信息中）`;
    const GENERATE_USER_PREFIX = `本次任务：仅生成【{{target_field_label}}】字段的内容，禁止生成其他任何字段。\n\n`;

    it('未修改的存量旧副本 → 自动迁移为新种子（translate/polish/generate）', () => {
      // 构造旧版 translate 副本（无作用域块、无 target_field_label 变量）
      const newTranslate = service.getTemplate('character-card.translate');
      const oldTranslate: PromptTemplate = JSON.parse(JSON.stringify(newTranslate));
      oldTranslate.parts[0].content = newTranslate.parts[0].content.replace(TRANSLATE_SCOPE_BLOCK, '');
      oldTranslate.variables = [];
      (service as any).templates.set('character-card.translate', oldTranslate);

      // 构造旧版 polish 副本
      const newPolish = service.getTemplate('character-card.polish');
      const oldPolish: PromptTemplate = JSON.parse(JSON.stringify(newPolish));
      oldPolish.parts[0].content = newPolish.parts[0].content.replace(POLISH_SCOPE_BLOCK, '');
      oldPolish.variables = oldPolish.variables.filter((v: any) => v.name === 'polish_requirements');
      (service as any).templates.set('character-card.polish', oldPolish);

      // 构造旧版 generate 副本（无规则 7、无 user prompt 首行强调）
      const newGenerate = service.getTemplate('character-card.generate');
      const oldGenerate: PromptTemplate = JSON.parse(JSON.stringify(newGenerate));
      const genSystem = newGenerate.parts.find((p: any) => p.id === 'generate-system');
      const genUser = newGenerate.parts.find((p: any) => p.id === 'generate-user');
      const oldGenSystemPart = oldGenerate.parts.find((p: any) => p.id === 'generate-system')!;
      const oldGenUserPart = oldGenerate.parts.find((p: any) => p.id === 'generate-user')!;
      oldGenSystemPart.content = genSystem!.content.replace(GENERATE_SYSTEM_RULE7, '');
      oldGenUserPart.content = genUser!.content.replace(GENERATE_USER_PREFIX, '');
      (service as any).templates.set('character-card.generate', oldGenerate);

      // 执行迁移
      (service as any).migrateCharacterCardFieldScope();

      // 断言三模板均已迁移
      const migratedTranslate = service.getTemplate('character-card.translate');
      expect(migratedTranslate.parts[0].content).toContain('【翻译范围约束】');
      expect(migratedTranslate.variables.map((v: any) => v.name)).toContain('target_field_label');

      const migratedPolish = service.getTemplate('character-card.polish');
      expect(migratedPolish.parts[0].content).toContain('【润色范围约束】');
      expect(migratedPolish.variables.map((v: any) => v.name)).toContain('target_field_label');

      const migratedGenerate = service.getTemplate('character-card.generate');
      const migratedGenSystem = migratedGenerate.parts.find((p: any) => p.id === 'generate-system');
      const migratedGenUser = migratedGenerate.parts.find((p: any) => p.id === 'generate-user');
      expect(migratedGenSystem.content).toContain('仅生成【{{target_field_label}}】一个字段的内容');
      expect(migratedGenUser.content).toContain('本次任务：仅生成【{{target_field_label}}】字段的内容');
    });

    it('用户自定义修改过的副本 → 不覆盖，保留原内容', () => {
      const newTranslate = service.getTemplate('character-card.translate');
      const customTranslate: PromptTemplate = JSON.parse(JSON.stringify(newTranslate));
      customTranslate.parts[0].content = newTranslate.parts[0].content
        .replace(TRANSLATE_SCOPE_BLOCK, '')
        + '\n自定义尾部内容';
      (service as any).templates.set('character-card.translate', customTranslate);

      (service as any).migrateCharacterCardFieldScope();

      const after = service.getTemplate('character-card.translate');
      expect(after.parts[0].content).toContain('自定义尾部内容');
      expect(after.parts[0].content).not.toContain('【翻译范围约束】');
    });

    it('已含新锚点的副本 → 幂等跳过（重复迁移无副作用）', () => {
      (service as any).migrateCharacterCardFieldScope();
      // 再次执行不应改变内容（也无异常）
      expect(() => (service as any).migrateCharacterCardFieldScope()).not.toThrow();
      expect(service.getTemplate('character-card.translate').parts[0].content).toContain('【翻译范围约束】');
    });
  });

  describe('History and rollback', () => {
    it('saving a template should create a history record', () => {
      const original = service.getTemplate('character-card.translate');
      const modified: PromptTemplate = {
        ...original,
        name: '修改后的翻译',
      };
      service.saveTemplate(modified, 'tester', '修改名称');

      const history = service.getHistory('character-card.translate');
      expect(history).toHaveLength(1);
      // The history record should snapshot the original (version 1)
      expect(history[0].version).toBe(1);
      expect(history[0].template.name).toBe('角色卡翻译');
      expect(history[0].modifiedBy).toBe('tester');
      expect(history[0].changeSummary).toBe('修改名称');
    });

    it('getHistory() should return history records sorted by version', () => {
      const original = service.getTemplate('character-card.translate');

      // Save 3 times to create history records for versions 1, 2, 3
      service.saveTemplate({ ...original, name: 'v2' }, 'tester', 'change 1');
      service.saveTemplate({ ...original, name: 'v3' }, 'tester', 'change 2');
      service.saveTemplate({ ...original, name: 'v4' }, 'tester', 'change 3');

      const history = service.getHistory('character-card.translate');
      expect(history).toHaveLength(3);

      // Verify sorted by version ascending
      for (let i = 0; i < history.length - 1; i++) {
        expect(history[i].version).toBeLessThan(history[i + 1].version);
      }
      expect(history[0].version).toBe(1);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(3);
    });

    it('rollback() should create a new version from an old one', () => {
      const original = service.getTemplate('character-card.translate');

      // Save to create version 2 (history gets version 1 snapshot)
      service.saveTemplate({ ...original, name: '修改版本' }, 'tester', '修改');

      // Verify current version is 2 with modified name
      const current = service.getTemplate('character-card.translate');
      expect(current.metadata.version).toBe(2);
      expect(current.name).toBe('修改版本');

      // Rollback to version 1
      const rolled = service.rollback('character-card.translate', 1, 'tester');

      expect(rolled).not.toBeNull();
      // New version should be 3 (existing was 2, so 2+1=3)
      expect(rolled.metadata.version).toBe(3);
      // Content should match the original (version 1)
      expect(rolled.name).toBe('角色卡翻译');
      expect(rolled.metadata.changeSummary).toContain('回滚');
    });
  });
});
