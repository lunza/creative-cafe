# Fix ContentWorkspace Empty Chapter Display

## Why
The issue is that when a project is loaded, the `currentProject` in `WritingModeEntry` is retrieved using `getCurrentProject()` which returns a snapshot. While the store `projects` array updates with loaded data, the reference used to derive `currentProject` doesn't change if the object is mutated in place during the `set` operation. This causes `ContentWorkspace` to receive an `outline` without chapter content, resulting in an empty markdown editor even though the data is correctly saved to disk.

## What Changes
- Fix `writingProjectStore.loadProjects` to properly update project data
- Fix `WritingModeEntry` to use store subscription pattern for current project
- Ensure `ContentWorkspace` receives updated outline data when projects load

## Impact
- Affected specs: fix-chapter-content-persistence
- Affected code: src/renderer/stores/writingProjectStore.ts, src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx

## MODIFIED Requirements
### Requirement: Project Data Loading
The system SHALL ensure that when projects are loaded from disk, all components receive the updated project data including chapter content.

#### Scenario: Load projects on mount
- **WHEN** `loadProjects` is called and completes
- **THEN** `currentProject.outline` should contain chapter content loaded from disk
- **AND** `ContentWorkspace` should display the chapter content in the markdown editor
