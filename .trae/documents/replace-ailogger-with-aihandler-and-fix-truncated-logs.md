# Plan: Replace AiLogger.ts with AiHandler.ts and Fix Truncated Input Parameter Logs

## Problem Analysis

### Issue 1: Truncated Logs
- In `ContentGenerator.ts:108`, the `promptPreview` is truncated to 2000 characters with `... [truncated]` suffix
- Even though `logDebug` at line 112-116 attempts to log the full prompt, the JSON.stringify serialization in `AiLogger.ts` doesn't guarantee full output
- The `logDetailed` function in AiLogger.ts uses `JSON.stringify(data, null, 2)` which can still be truncated in console output

### Issue 2: AiLogger.ts Issues
- Duplicate logging logic with `aiHandlers.ts` (both have identical log rotation, file writing, formatting code)
- Inconsistent log prefixes (`[AiLogger]` vs `[AI Handler]`)
- Multiple maintenance points for the same functionality
- Need to consolidate into a single logging source

## Files Affected

### To Be Deleted
- `src/main/services/AiLogger.ts`

### To Be Modified
1. `src/main/services/writing/ContentGenerator.ts` (line 12, lines 99-116, lines 205-211)
2. `src/main/ipc/handlers/writingHandlers.ts` (line 11, multiple log calls)
3. `src/main/services/writing/AIAssistedChapterService.ts` (line 14, multiple log calls)
4. `src/main/services/aiLoggerService.ts` - NEW FILE: centralized logging service

## Implementation Steps

### Step 1: Create Centralized AI Logger Service
**File**: `src/main/services/aiLoggerService.ts`

- Create a new centralized logging service that exports the same API as AiLogger.ts
- Use the exact same logging implementation as `aiHandlers.ts` (copy the proven working code)
- Export functions: `logRequest`, `logResponse`, `logErrorWithContext`, `logDebug`, `logInfo`, `logWarn`, `logError`
- Ensure `logDetailed` writes complete JSON to file without truncation
- Key improvement: Add a `logRawData` function that writes raw string data directly to log file without JSON.stringify truncation

### Step 2: Update ContentGenerator.ts
**File**: `src/main/services/writing/ContentGenerator.ts`

- Change import from `'../AiLogger'` to `'../aiLoggerService'`
- Lines 99-109: Replace `promptPreview` truncation with `logRawData` to log complete prompt
- Lines 112-116: Keep `logDebug` but ensure it uses the new service
- Lines 205-211: Update `logResponse` import

### Step 3: Update writingHandlers.ts
**File**: `src/main/ipc/handlers/writingHandlers.ts`

- Change import from `'../../services/AiLogger'` to `'../../services/aiLoggerService'`
- No other changes needed (function names remain the same)

### Step 4: Update AIAssistedChapterService.ts
**File**: `src/main/services/writing/AIAssistedChapterService.ts`

- Change import from `'../AiLogger'` to `'../aiLoggerService'`
- No other changes needed (function names remain the same)

### Step 5: Delete AiLogger.ts
**File**: `src/main/services/AiLogger.ts`

- Delete the file completely

### Step 6: Verify Import Registration
- Ensure `aiHandlers.ts` is imported in `src/main/ipc/index.ts` (already done at line 13)
- Ensure writing handlers are imported in `src/main/index.ts` (already done at line 7, 93)

## Key Design Decisions

### Why create aiLoggerService.ts instead of modifying AiLogger.ts?
1. Clean separation from the problematic file
2. Can copy the proven working code from aiHandlers.ts directly
3. Easier to track changes and rollback if needed
4. User explicitly stated "AiLogger.ts must be completely removed"

### Why not make components directly use aiHandlers.ts?
- `aiHandlers.ts` is an IPC handler file with `ipcMain.handle` registrations
- It's not designed to be imported as a utility module
- Creating `aiLoggerService.ts` extracts the logging logic into a proper reusable service
- This maintains clean architecture while satisfying the "use single AI engine" requirement

### How to fix truncation?
The root cause is that `JSON.stringify` + console.log devtools truncation. Solution:
1. Add `logRawData(title: string, rawData: string)` function that writes raw string to log file directly
2. In `ContentGenerator.ts`, use `logRawData` for full prompt logging instead of truncated preview
3. The log file will contain complete data, not truncated

## Testing Strategy

1. **Manual Testing**:
   - Generate a chapter and check log file for complete prompt (no truncation)
   - Verify log file contains full JSON request body
   - Check that all log entries use consistent format

2. **Build Verification**:
   - Run TypeScript compilation to ensure no import errors
   - Run the application to verify logging works correctly
