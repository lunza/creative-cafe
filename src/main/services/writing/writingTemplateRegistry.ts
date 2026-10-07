/**
 * 写作表格模板解析器
 *
 * 写作与对话模板分离（用户要求）：
 * - 模板列表（getAllTemplates）只返回写作域内置模板（WRITING_TABLE_TEMPLATES）
 * - 整理流程按 id 解析模板时：写作内置模板优先（适配为 TableTemplate 形状，
 *   调用点无需改动）；未命中再回退记忆（对话）模块模板库——
 *   兼容历史上已绑定对话模板的存量项目，避免整理流程报"模板不存在"。
 */
import fs from 'fs';
import path from 'path';
import {
  WRITING_TABLE_TEMPLATES,
  type WritingTableTemplate,
} from '../../../shared/constants/writingTableTemplates';
import {
  mergeWritingTemplates,
  validateWritingTemplate,
  type V2TableTemplateView,
} from '../../../shared/utils/v2TableUtils';
import { tableTemplateService, type TableTemplate } from '../memory/tableTemplateService';
import { getWritingProjectsPath } from './WritingProjectRepository';

/** 自定义模板存储文件（全局，非按项目） */
function getCustomTemplatesFile(): string {
  return path.join(getWritingProjectsPath(), 'table-templates.json');
}

function loadCustomTemplates(): WritingTableTemplate[] {
  try {
    const file = getCustomTemplatesFile();
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as WritingTableTemplate[]) : [];
  } catch {
    return [];
  }
}

function persistCustomTemplates(templates: WritingTableTemplate[]): void {
  const file = getCustomTemplatesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(templates, null, 2), 'utf8');
}

/** 写作模板列表（内置 + 自定义，带 custom 标记） */
export function getWritingTableTemplates(): V2TableTemplateView[] {
  return mergeWritingTemplates(WRITING_TABLE_TEMPLATES, loadCustomTemplates());
}

export interface V2TemplateOpResult {
  success: boolean;
  template?: WritingTableTemplate;
  error?: string;
}

/** 新建/更新自定义模板（内置 id 受保护，不可覆盖） */
export function saveCustomTemplate(input: WritingTableTemplate): V2TemplateOpResult {
  if (WRITING_TABLE_TEMPLATES.some((t) => t.id === input.id)) {
    return { success: false, error: '内置模板不可修改，请新建自定义模板' };
  }
  const err = validateWritingTemplate(input);
  if (err) return { success: false, error: err };
  const custom = loadCustomTemplates();
  const template: WritingTableTemplate = {
    ...input,
    id: input.id || `writing-custom-${Date.now()}`,
  };
  const idx = custom.findIndex((t) => t.id === template.id);
  if (idx >= 0) custom[idx] = template;
  else custom.push(template);
  persistCustomTemplates(custom);
  return { success: true, template };
}

/** 删除自定义模板（内置模板受保护） */
export function deleteCustomTemplate(id: string): V2TemplateOpResult {
  if (WRITING_TABLE_TEMPLATES.some((t) => t.id === id)) {
    return { success: false, error: '内置模板不可删除' };
  }
  const custom = loadCustomTemplates();
  const next = custom.filter((t) => t.id !== id);
  if (next.length === custom.length) {
    return { success: false, error: '模板不存在' };
  }
  persistCustomTemplates(next);
  return { success: true };
}

/** 写作内置模板适配为 TableTemplate 形状（createdAt/updatedAt/version 仅结构占位） */
const BUILTIN_AS_TABLE_TEMPLATE: TableTemplate[] = WRITING_TABLE_TEMPLATES.map(asTableTemplate);

/** 写作模板（内置 + 自定义）适配为 TableTemplate 形状 */
function asTableTemplate(t: WritingTableTemplate): TableTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    sheets: t.sheets,
    createdAt: 'builtin',
    updatedAt: 'builtin',
    version: '1.0',
  };
}

/** 按 id 解析模板：写作内置 → 写作自定义 → 记忆模块（存量兼容） */
export function resolveWritingTableTemplate(id: string): TableTemplate | null {
  const builtin = BUILTIN_AS_TABLE_TEMPLATE.find((t) => t.id === id);
  if (builtin) return builtin;
  const custom = loadCustomTemplates().find((t) => t.id === id);
  if (custom) return asTableTemplate(custom);
  return tableTemplateService.getTemplate(id);
}
