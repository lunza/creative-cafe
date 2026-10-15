# Debug Session: fix-worldbook-relation-and-vector-retrieval

**Status**: FIXING (2026-08-21)
**Type**: 静态分析驱动修复（非运行时调试）

## Hypotheses

1. **H1（Confirmed）**: `characterService.readCharacter()` → `CharacterCard.toSpecV3()` 白名单过滤丢弃 `worldBooks` 字段
   - 证据: `FIX_RECORDS.md §7.55` + `toSpecV3()` 源码（24 个显式白名单字段）
   - LAN API 的 `readRawCardData` 已绕过此问题，PC 端未同步修复

2. **H2（Confirmed）**: `SqliteVecBackend.buildFilterClause` 在 filter 值为数组时生成 `m.source = ?` 导致 better-sqlite3 绑定失败
   - 证据: `buildFilterClause` 源码第 804 行 `m.${key} = ?` + `params.push(value)` 数组直接传值
   - better-sqlite3 不支持数组绑定，`stmt.all()` 抛 `TypeError: Invalid value` 返回空数组

## Fix Plan

### Fix 1: characterService.ts
- 新增 `readRawCardData(filePath)`：直接解 PNG tEXt chunk，不经过 toSpecV3
- 4 个世界书关系方法改用 raw 读取

### Fix 2: SqliteVecBackend.ts
- `buildFilterClause` 增加数组类型处理 → `IN (?,?,...)` 子句

## Implementation Log

### 2026-08-21
- [x] 确认 H1：characterService.getWorldBookRelations 读回为空（toSpecV3 白名单丢弃 worldBooks）
- [x] 确认 H2：SqliteVecBackend.buildFilterClause 数组绑定失败（m.source = ? + 数组值）
- [x] 实施 Fix 1：characterService.ts 新增 readRawCardData + 4 个关系方法改用 raw 读取
- [x] 实施 Fix 2：SqliteVecBackend.buildFilterClause 支持数组值生成 IN 子句
- [x] 运行时验证：世界书关系读写闭环通过（2 条→写入→3 条读回）；多源 IN 子句正确生成；单值/空数组边界通过
- [x] 编译验证：VS Code 零诊断（characterService.ts / SqliteVecBackend.ts / ContextManager.ts / characterWrite.ts）
- [x] 回归测试：npm test 3 文件 4 失败均为既有（PromptTemplateService×2 / skills×1 / agentModeService×1），无新增；worldbookTools.test.ts 21/21 通过
- [x] 文档更新：FIX_RECORDS.md §7.58/§7.59、CHANGELOG.md

**Status**: FIXED (2026-08-21)