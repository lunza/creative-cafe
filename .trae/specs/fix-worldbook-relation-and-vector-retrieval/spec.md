# 修复世界书关联与向量库检索功能 Spec

## Why

版本更新后，角色卡编辑器中的世界书关联功能（PC 端）因 `@lenml/char-card-reader` 库的 `toSpecV3()` 白名单过滤导致 `worldBooks` 字段被静默丢弃，关系写入后读回为空。同时，对话管线中的向量库检索因 `ContextManager` 传递数组类型 source 过滤器给 `SqliteVecBackend`，导致 SQL 参数绑定失败，检索结果被静默吞没，对话无法获取世界书/知识库的向量检索内容。

## What Changes

### 修复一：PC 端角色卡世界书关系读写保真（`characterService.ts`）

- `characterService.ts` 新增 `readRawCardData(filePath)` 方法（与 `characterWrite.ts` 同构）：直接解 PNG tEXt chunk（优先 v3 ccv3，回退 v2 chara），不经过 `toSpecV3()` 白名单过滤
- `getWorldBookRelations` / `setWorldBookRelations` / `addWorldBookRelation` / `removeWorldBookRelation` 改用 `readRawCardData` 读取，确保 `worldBooks` 字段保真
- **BREAKING**: 无（行为不变，仅修复数据丢失）

### 修复二：向量库多源检索过滤器兼容（`SqliteVecBackend.ts` / `ContextManager.ts`）

- `SqliteVecBackend.buildFilterClause` 增加数组类型处理：当 filter 值为数组时，使用 `IN` 操作符而非 `=`，生成 `m.source IN (?,?,?)` 形式的 SQL
- 或 `ContextManager` 在设置 `filter.source` 时，将数组展开为 `source_0` / `source_1` 等 OR 条件
- 修复后验证：多源过滤（`['worldbook', 'knowledge', 'memory']`）正确返回各来源的检索结果

### 修复三：全链路回归验证

- 验证 PC 端角色卡编辑 → 添加世界书关联 → 保存 → 重新打开 → 关系可见
- 验证对话管线中向量检索能正确返回世界书/知识库内容
- 验证移动端世界书关系功能不受影响（已有 `readRawCardData` 保护）

## Impact

- Affected specs: `add-mobile-character-card-editor`（世界书关系，移动端已修复，PC 端同步修复）、`repair-agent-and-worldbook-integration`（回归验证）
- Affected code:
  - `src/main/services/characterService.ts` — 新增 `readRawCardData` 方法，修改 4 个世界书关系方法
  - `src/main/services/SqliteVecBackend.ts` — 修复 `buildFilterClause` 数组处理
  - `src/main/services/ContextManager.ts` — 可选修复（按方案二/三）

## ADDED Requirements

### Requirement: PC 端世界书关系读写保真
系统 SHALL 保证 PC 端（`CharacterEditModal` 和 `CharacterManager`）通过 IPC 读写世界书关系时，`worldBooks` 字段不被 `toSpecV3()` 白名单过滤丢弃。

#### Scenario: PC 端添加世界书关联并保存
- **WHEN** 用户在 PC 端角色卡编辑器中添加世界书关联并保存
- **THEN** 关联数据写入角色卡 PNG（chara + ccv3 双 chunk）
- **AND** 重新打开编辑页时，关联关系正确显示

#### Scenario: PC 端 worldBooks 读回不为空
- **WHEN** 调用 `characterService.getWorldBookRelations(filePath)`
- **THEN** 返回的 `worldBooks` 数组包含所有已存储的关联，而非空数组

### Requirement: 向量库多源过滤器兼容
系统 SHALL 支持 `filter.source` 为数组类型（如 `['worldbook', 'knowledge', 'memory']`），正确执行多源向量检索。

#### Scenario: 多源检索正常返回
- **WHEN** `ContextManager.retrieveContextWithKeywords` 调用 `vectorStoreService.search` 时传入 `filter.source = ['worldbook', 'knowledge', 'memory']`
- **THEN** `SqliteVecBackend` 正确生成 `IN` 查询并返回所有匹配来源的检索结果

## MODIFIED Requirements

### Requirement: characterService 世界书关系方法（原 `getWorldBookRelations` / `setWorldBookRelations` / `addWorldBookRelation` / `removeWorldBookRelation`）
内部读取路径从 `readCharacter()` → `CharacterCard.toSpecV3()` 改为 `readRawCardData()` 直接解 PNG chunk，确保 `worldBooks` 非标准字段保真。

### Requirement: SqliteVecBackend.buildFilterClause（原单值 = 比较）
增加对数组类型 filter 值的处理，使用 `IN` 操作符替代 `=` 比较。

## REMOVED Requirements
（无）