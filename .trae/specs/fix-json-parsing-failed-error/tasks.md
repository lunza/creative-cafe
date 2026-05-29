# Tasks
- [x] Task 1: Update PromptBuilder to enforce strict JSON format in buildOutlinePrompt method: Modify the prompt template to explicitly prevent markdown formatting inside JSON string values and ensure proper JSON structure.
  - [x] SubTask 1.1: Add explicit instruction to avoid markdown formatting inside JSON values
  - [x] SubTask 1.2: Add instruction about proper escaping of special characters
  - [x] SubTask 1.3: Ensure JSON is wrapped in proper code fences
- [x] Task 2: Enhance OutlineGenerator JSON parsing resilience: Improve the parseOutlineResponse method to handle more edge cases of malformed JSON.
  - [x] SubTask 2.1: Add better error position detection
  - [x] SubTask 2.2: Improve unescaped character handling
  - [x] SubTask 2.3: Add proper truncation handling for streaming responses
- [x] Task 3: Add comprehensive JSON validation before processing: Add validation mechanism to check JSON structure integrity before attempting to parse it.
  - [x] SubTask 3.1: Create JSON structure validator function
  - [x] SubTask 3.2: Add bracket/brace balance checking
  - [x] SubTask 3.3: Validate string value completeness

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] can be done in parallel with [Task 1]