// Prompt framework types based on docs/提示词工程.md
export type PromptFramework = 'CHAT' | 'BROKE' | 'ICIO' | 'CRISPE' | 'CUSTOM';

// Module IDs
export type PromptModuleId =
  | 'character-card.generate'
  | 'character-card.translate'
  | 'character-card.polish'
  | 'world-book.translate'
  | 'world-book.polish-keyword'
  | 'world-book.polish-comment'
  | 'world-book.polish-content'
  | 'world-book.generate-keywords'
  | 'world-book.generate-tags'
  | 'world-book.sort-entries'
  | 'world-book.generate-entries'
  | 'world-book.generate-from-template'
  | 'world-book.expand-keywords'
  | 'world-book.generate-description'
  | 'world-book.generate-new-entries'
  | 'world-book.generate-from-characters'
  | 'creative-chat.dialogue'
  | 'creative-chat.continuation'
  | 'creative-chat.async-table-instructions'
  | 'creative-chat.context-regions';

// Variable definition within a prompt template
export interface PromptVariable {
  name: string;          // e.g. 'character_name' (without braces)
  description: string;   // Human-readable description
  source: string;        // Where the value comes from (e.g. 'formValues.name')
  required: boolean;     // Whether the variable must be provided
  defaultValue?: string; // Default value if not provided
}

// A single part/section of a prompt
export interface PromptPart {
  id: string;            // Unique part identifier
  type: 'fixed' | 'editable';  // Fixed = system structure, editable = business content
  label: string;         // Display name (e.g. "角色定义", "背景信息", "输出格式")
  content: string;       // The actual text content (template with {{variables}})
  source: string;        // Source description (e.g. "系统固定结构", "用户可编辑")
  order: number;         // Assembly order (0-based)
  role: 'system' | 'user';  // Whether this part goes into system or user prompt
  variables: string[];   // Variable names used in this part (without braces)
}

// Metadata for version tracking
export interface PromptMetadata {
  version: number;
  createdAt: number;     // Unix timestamp
  updatedAt: number;
  createdBy: string;
  modifiedBy: string;
  changeSummary?: string; // Summary of changes for this version
}

// Complete prompt template
export interface PromptTemplate {
  id: string;            // Unique identifier
  moduleId: PromptModuleId; // e.g. 'character-card.generate'
  name: string;          // Display name
  description: string;   // Usage description
  framework: PromptFramework;
  parts: PromptPart[];   // Ordered parts
  assemblyOrder: number[]; // Part IDs in assembly order (usually same as parts.order)
  variables: PromptVariable[]; // All variable definitions
  metadata: PromptMetadata;
}

// Validation result
export interface ValidationIssue {
  level: 'error' | 'warning';
  partId?: string;       // Which part has the issue
  message: string;
  suggestion?: string;   // Fix suggestion
}

export interface ValidationResult {
  valid: boolean;        // True if no errors (warnings allowed)
  issues: ValidationIssue[];
}

// History record
export interface PromptHistoryRecord {
  version: number;
  timestamp: number;
  modifiedBy: string;
  changeSummary: string;
  template: PromptTemplate; // Snapshot of the template at this version
}

// Build result
export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

// AI polish request — combines original prompt + task type + framework reference
export interface PromptPolishRequest {
  content: string;          // Original prompt content to polish
  framework: string;        // Current template's framework (for reference)
  moduleId: string;         // Current task type (product module ID)
  taskDescription?: string; // Human-readable task description (from MODULE_GROUPS)
}

// AI polish result — structured response with recommendation + reasoning
export interface PromptPolishResult {
  recommendedFramework: string;  // Recommended framework name, e.g. "CHAT"
  frameworkReasoning: string;    // Detailed reasoning for the recommendation
  polishedContent: string;       // Polished prompt content
  optimizationPoints: string[];  // Specific optimization points
}
