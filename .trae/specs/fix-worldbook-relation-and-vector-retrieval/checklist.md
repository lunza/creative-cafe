# Checklist

## PC 端世界书关系读写保真
- [x] `characterService.ts` 新增 `readRawCardData` 方法，直接解 PNG tEXt chunk 不经过 toSpecV3
- [x] `getWorldBookRelations` 改用 `readRawCardData` 读取，返回正确 worldBooks 数组
- [x] `setWorldBookRelations` 改用 `readRawCardData` 读取 + writeCharacter 写入，worldBooks 不丢失
- [x] `addWorldBookRelation` / `removeWorldBookRelation` 底层复用修复后的方法
- [x] 写入后立即读回闭环验证通过（worldBooks 数据一致）

## 向量库多源过滤器
- [x] `SqliteVecBackend.buildFilterClause` 支持数组值生成 `IN` 子句
- [x] 多源 filter（`['worldbook', 'knowledge', 'memory']`）正确返回各来源结果
- [x] 单值 filter（`source = 'worldbook'`）行为不变（回归）

## 全链路回归验证
- [x] PC 端角色卡编辑 → 添加世界书关联 → 保存 → 重开 → 关系可见
- [x] 移动端世界书关系不受影响（已有 `readRawCardData` 保护）
- [x] 对话管线向量检索结果正确注入 system prompt
- [x] 编译零新增错误（tsc --noEmit）
- [x] 文档增量更新（FIX_RECORDS.md / CHANGELOG.md）