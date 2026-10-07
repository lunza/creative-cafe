# Tasks

- [x] Task 1: Implement Stage 1 (Label Requirement Identification)
  - [x] SubTask 1.1: Implement logic to extract all existing entries and their labels from the World Book.
  - [x] SubTask 1.2: Create a prompt for the AI to identify the entry type and return a list of relevant reference labels.
  - [x] SubTask 1.3: Implement the AI call and parsing of the label list.

- [x] Task 2: Implement Stage 2 (Reference Content Collection & Filtering)
  - [x] SubTask 2.1: Implement retrieval logic to find all entries associated with the identified reference labels.
  - [x] SubTask 2.2: Implement a filter to ensure only audited/verified entries are included.
  - [x] SubTask 2.3: Extract full field content from the filtered reference entries.

- [x] Task 3: Implement Stage 3 (Enhanced Generation)
  - [x] SubTask 3.1: Implement context assembly (Original request + Reference content + World theme).
  - [x] SubTask 3.2: Create the final generation prompt emphasizing consistency and continuity.
  - [x] SubTask 3.3: Implement the final AI call and return the result.

- [x] Task 4: Integration and Pipeline Orchestration
  - [x] SubTask 4.1: Integrate the three stages into the existing AI generation trigger.
  - [x] SubTask 4.2: Implement error handling for cases where no similar labels are found.

- [x] Task 5: Verification and Tuning
  - [x] SubTask 5.1: Test the pipeline with various entry types to verify label identification accuracy.
  - [x] SubTask 5.2: Verify that the generated content reflects the style and settings of the reference entries.
  - [x] SubTask 5.3: Measure latency to ensure it meets performance requirements.

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 3
- Task 5 depends on Task 4
