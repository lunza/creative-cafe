# Tasks
- [x] Task 1: Refactor data structure to use only project.chapters: Consolidate the dual data structure (project.chapters and project.outline.chapters) into a single structure using project.chapters.
  - [x] SubTask 1.1: Update WritingProject type definition to remove outline.chapters dependency
  - [x] SubTask 1.2: Modify WritingStorageService to sync outline.chapters with project.chapters on load/save
  - [x] SubTask 1.3: Update all outline update operations to modify both outline and chapters simultaneously
- [x] Task 2: Fix index assignment logic to prevent duplicates: Address the issue where AI regeneration causes duplicate index values.
  - [x] SubTask 2.1: Identify the root cause of duplicate index assignment in OutlineGenerator
  - [x] SubTask 2.2: Implement proper index validation and assignment logic
  - [x] SubTask 2.3: Ensure consecutive index assignment during outline regeneration
- [x] Task 3: Update all code references from outline.chapters to chapters: Migrate all code that accesses outline.chapters to use chapters instead.
  - [x] SubTask 3.1: Update writing handlers to use project.chapters
  - [x] SubTask 3.2: Update renderer components to access chapters from project.chapters
  - [x] SubTask 3.3: Update utility functions and hooks to use project.chapters
- [ ] Task 4: Update UI components and business logic: Ensure all UI elements and business logic work correctly with the new unified structure.
  - [ ] SubTask 4.1: Update outline editors to work with unified data structure
  - [ ] SubTask 4.2: Update chapter generation components
  - [ ] SubTask 4.3: Update version management and export functionality
- [ ] Task 5: Testing and validation: Verify that the changes work correctly and don't introduce regressions.
  - [ ] SubTask 5.1: Test outline generation and regeneration multiple times
  - [ ] SubTask 5.2: Test chapter editing and content generation
  - [ ] SubTask 5.3: Validate data persistence and loading

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 4]