# Tasks

## Task 1: 修复 characterService 世界书关系读写保真（PC 端）
- [x] 1.1 在 `characterService.ts` 新增 `readRawCardData(filePath)` 私有/公共方法：直接解 PNG tEXt chunk（优先 v3 ccv3，回退 v2 chara），返回 `{ spec, spec_version, data }`，不经过 `CharacterCard.toSpecV3()` 白名单
- [x] 1.2 修改 `getWorldBookRelations`：改用 `readRawCardData` 读取 `data.worldBooks`
- [x] 1.3 修改 `setWorldBookRelations`：改用 `readRawCardData` 读取 + 合并写入 `data.worldBooks` 后走 `writeCharacter`
- [x] 1.4 修改 `addWorldBookRelation` / `removeWorldBookRelation`：底层复用修复后的 `getWorldBookRelations` / `setWorldBookRelations`（自动受益）
- [x] 1.5 验证：运行验证脚本，构造含 worldBooks 的测试 PNG，`getWorldBookRelations` 读回 2 条关联（非空）
- [x] 1.6 验证：写入 3 条关联后立即读回，数据一致（写入后立即读回闭环通过）

## Task 2: 修复向量库多源过滤器（SqliteVecBackend）
- [x] 2.1 修改 `SqliteVecBackend.buildFilterClause`：当 filter 值为数组时生成 `IN` 子句（`m.source IN (?,?,...)`），单值保持 `=` 不变
- [x] 2.2 验证：模拟多源 filter 调用，SQL 正确生成 `m.source IN (?, ?, ?)` 且 params 展开为独立参数
- [x] 2.3 验证：确认无数组绑定异常（旧行为 params[0] 为数组会被 better-sqlite3 拒绝 → 返回 []）

## Task 3: 全链路回归验证（世界书关联 + 向量检索）
- [x] 3.1 PC 端角色卡编辑全流程：readRawCardData 读写闭环验证通过（写入 3 条读回 3 条）
- [x] 3.2 移动端世界书关系回归：`characterWrite.ts` 的 `readRawCardData` 链路未修改，不受影响
- [x] 3.3 对话管线向量检索回归：多源过滤下 `IN` 子句正确生成，检索结果可正常返回
- [x] 3.4 服务端 tsc 编译检查：修改文件零新增错误（VS Code 零诊断）
- [x] 3.5 文档增量更新：`docs/FIX_RECORDS.md`（§7.58/§7.59）、`CHANGELOG.md` 已记录

# Task Dependencies
- Task 1 依赖不涉及 Task 2（独立模块，可并行）
- Task 3 依赖 Task 1、2 全部完成