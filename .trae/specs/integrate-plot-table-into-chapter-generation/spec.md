# Integrate Plot Table into Chapter Generation Spec

## Why
The chapter generation prompt currently lacks context from the writing table organizer (plot tables), which means the AI doesn't have access to structured historical story data (characters, items, events, locations) when generating new chapters. This can lead to plot inconsistencies. We already implemented this for the plot check feature — now the same integration is needed for chapter generation.

## What Changes
- Add `writingTableData` field to `ContentGenerationRequest` interface
- Add `buildTableContextForPrompt` method to `ContentGenerator` class (following the same approach as `PlotCheckerService`)
- Integrate table context into the chapter generation prompt between previous chapters and current chapter outline
- Update IPC handler `writing:generateChapter` to read and pass writing table data
- Update `writing:generateContentStream` handler similarly

## Impact
- Affected specs: creative-writing-mode (extension)
- Affected code:
  - `src/shared/types/writing.types.ts` (modify - add writingTableData to ContentGenerationRequest)
  - `src/main/services/writing/ContentGenerator.ts` (modify - add table context builder and integrate into prompt)
  - `src/main/ipc/handlers/writingHandlers.ts` (modify - read and pass table data to content generator)

## ADDED Requirements

### Requirement: Writing Table Context in Chapter Generation Prompt
The system SHALL include writing table organizer data (timeline, character, social, item, event tables) as background context in the chapter generation prompt, following the same formatting approach used in the plot check feature.

#### Scenario: Table data is included in generation prompt
- **WHEN** a chapter generation request is made
- **THEN** the system reads writing table data from the project
- **AND** formats it into a human-readable context string
- **AND** inserts it into the prompt between previous chapters and the current chapter outline

#### Scenario: Table data formatting matches plot check style
- **WHEN** table data is formatted for the generation prompt
- **THEN** each table sheet is displayed with:
  - Table name and index
  - Table purpose/description
  - Existing data rows with field labels
  - Unique ID lookup index (if applicable)

#### Scenario: Empty or missing table data
- **WHEN** the project has no writing table data configured
- **THEN** no table context is added to the prompt
- **AND** the generation proceeds normally without table context

### Requirement: Table Context Prompt Structure
The table context SHALL be inserted into the user prompt in the following position:
```
## 前序章节
...

## 历史剧情表格数据（重要参考资料）
以下表格记录了之前章节中已建立的角色、物品、事件、地点等关键信息...

=== 时空表格 (表格索引: 1) ===
表格用途：...
当前已有数据（共X条）：
  行1: ...
...

=== 角色表格 (表格索引: 2) ===
...

## 本章大纲
...
```

## MODIFIED Requirements

### Requirement: ContentGenerationRequest Type
The `ContentGenerationRequest` interface SHALL be extended with an optional `writingTableData` field:
```typescript
writingTableData?: {
  tableConfig?: {
    associatedTemplateId: string;
    associatedTemplateName: string;
  };
  sheets?: string[];
  headers?: Record<string, string[]>;
  data?: Record<string, Record<string, any>[]>;
  sheetDescriptions?: Record<string, string>;
};
```

### Requirement: ContentGenerator.buildPrompt
The `buildPrompt` method SHALL include table context built by a new `buildTableContextForPrompt` method. The table context SHALL be inserted after previous chapters and before the chapter outline in the user prompt.

### Requirement: IPC Handler
The `writing:generateChapter` and `writing:generateContentStream` handlers SHALL read writing table data via `writingStorageService.getTableData()` and `getTableConfig()` and include it in the `ContentGenerationRequest`.
