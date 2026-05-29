# Fix JSON Parsing Failed Error in Outline Generation Spec

## Why
The writing mode outline generation feature encounters an OUTLINE_GENERATION_FAILED error with message '大纲解析失败，AI 返回的内容格式不正确'. The error occurs when AI returns malformed JSON that cannot be parsed by the OutlineGenerator, causing the JSON parsing to fail. Analysis of the New 2.json file revealed that the AI response was truncated mid-JSON object, resulting in malformed structure with duplicate content.

## What Changes
- Modify the prompt template in PromptBuilder to enforce strict JSON format compliance
- Add explicit instructions to prevent AI from generating markdown formatting inside JSON string values
- Improve the JSON parsing resilience in OutlineGenerator with better error recovery
- Add proper validation mechanisms to ensure generated JSON is well-formed before processing

## Impact
- Affected specs: Writing mode outline generation functionality
- Affected code: src/main/services/writing/PromptBuilder.ts, src/main/services/writing/OutlineGenerator.ts

## ADDED Requirements
### Requirement: Strict JSON Format Enforcement
The system SHALL ensure that AI-generated outlines conform to strict JSON format standards without any markdown formatting inside string values.

#### Scenario: AI generates outline with proper JSON format
- **WHEN** user requests outline generation
- **THEN** the AI response MUST be a valid JSON object without any markdown formatting inside string values

### Requirement: JSON Validation and Recovery
The system SHALL validate the JSON structure before parsing and attempt recovery if possible.

#### Scenario: Invalid JSON recovery
- **WHEN** AI returns malformed JSON
- **THEN** the system SHALL attempt to fix common JSON issues before throwing an error

## MODIFIED Requirements
### Requirement: Outline Generation Prompt Template
The existing prompt template in PromptBuilder needs to be enhanced to prevent markdown formatting inside JSON values.

## REMOVED Requirements
### Requirement: None
No requirements are being removed.