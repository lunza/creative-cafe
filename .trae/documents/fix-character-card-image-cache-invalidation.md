# 修复角色卡图片编辑修改无效问题 — 缓存失效方案

## 概述

在编辑角色卡并替换图片后，磁盘上的 PNG 文件已正确更新（此前已修复 `CharacterEditModal.tsx` 中的 `createFromImage` 逻辑），但列表视图缩略图和查看弹窗头像仍显示旧图片。根本原因是渲染层的 LRU 缓存（`thumbnailCache`/`avatarCache`）在角色卡保存/删除时从未被失效。

## 当前状态分析

### 缓存架构

文件 `src/renderer/components/Character/utils/characterThumbnailCache.tsx` 中定义了 4 个模块级 LRU 缓存：

| 缓存 | 用途 | 容量 |
|------|------|------|
| `thumbnailCache` | 列表缩略图 base64 | 100 |
| `thumbnailErrorCache` | 列表缩略图错误标记 | 100 |
| `avatarCache` | 查看弹窗头像 base64 | 100 |
| `avatarErrorCache` | 查看弹窗头像错误标记 | 100 |

**缓存键**：纯文件路径字符串 `filePath`，无版本号/修改时间/内容哈希。

### 问题根因

1. **缓存未失效**：`CharacterManager.handleSaved`（第 362-365 行）仅调用 `fetchCharacters()` 刷新文件列表元数据，**未清除任何图片缓存**。`handleDelete` 同样不清缓存。
2. **组件不感知缓存变化**：`ThumbnailImage`/`AvatarImage` 的 `useEffect` 依赖 `[filePath]`，文件路径不变时不会重新加载。即使清除了缓存，组件也不会重新触发 fetch。
3. **保存后路径不变**：编辑已有角色卡时 PNG 文件原地覆盖，路径不变，缓存命中旧数据。

### 数据流验证

| 阶段 | 缓存情况 | 图片是否新鲜 |
|------|---------|------------|
| 保存（`createFromImage`/`write`） | 主进程写磁盘，无缓存 | ✅ 新鲜 |
| `handleSaved` 回调 | ❌ 未清除缓存 | — |
| 列表缩略图（`ThumbnailImage`） | `thumbnailCache` 命中旧数据 | ❌ 旧图片 |
| 查看弹窗头像（`AvatarImage`） | `avatarCache` 命中旧数据 | ❌ 旧图片 |
| 重新打开编辑（`handleEdit`） | 直接 `file.readAsBase64` 读磁盘 | ✅ 新鲜 |
| 对话聊天头像（`useCharacterSwitch`） | 直接 `file.readAsBase64` 读磁盘 | ✅ 新鲜 |
| `MemoryChat/ChatManager.tsx` | 共享 `thumbnailCache` | ❌ 旧图片 |

### SillyTavern 兼容性

- `@lenml/char-card-reader` 解析 PNG tEXt chunks（`ccv3` 优先，其次 `chara`）
- `characterService.writeCharacter` 仅更新 tEXt chunks，不替换基底图片
- `characterService.createCharacterFromImage` 用新图片重建 PNG，嵌入新的 `chara`+`ccv3` chunks
- 本次修复仅涉及渲染层缓存失效，不触碰主进程的 PNG 解析/写入逻辑，完全兼容

## 修改方案

### 文件 1: `src/renderer/components/Character/utils/characterThumbnailCache.tsx`

**目标**：添加缓存失效机制 + 组件订阅通知

**修改内容**：

1. **添加发布-订阅机制**（新增约 25 行）：
   - 模块级 `invalidationListeners: Map<string, Set<() => void>>`
   - 导出 `invalidateCharacterImageCache(filePath: string)` 函数：清除该路径的 4 个缓存条目，通知所有订阅该路径的监听器
   - 导出 `subscribeToImageInvalidation(filePath: string, cb: () => void): () => void` 函数：注册监听器，返回取消订阅函数

2. **修改 `ThumbnailImage` 组件**（约 +8 行）：
   - 新增 `refreshKey` state（`useState(0)`）
   - 新增 `useEffect`（依赖 `[filePath]`）：订阅 `subscribeToImageInvalidation(filePath, () => setRefreshKey(k => k + 1))`
   - 将 `refreshKey` 加入现有加载 `useEffect` 的依赖数组：`[filePath]` → `[filePath, refreshKey]`

3. **修改 `AvatarImage` 组件**（同上，约 +8 行）：
   - 与 `ThumbnailImage` 相同的 `refreshKey` + 订阅机制

### 文件 2: `src/renderer/components/Character/CharacterManager.tsx`

**目标**：在保存和删除时调用缓存失效

**修改内容**：

1. **导入**（+1 行）：
   ```ts
   import { invalidateCharacterImageCache } from './utils/characterThumbnailCache';
   ```

2. **修改 `handleSaved` 回调**（第 362-365 行，约 +4 行）：
   ```ts
   const handleSaved = useCallback((savedPath: string | null) => {
     setIsEditModalOpen(false);
     if (savedPath) {
       invalidateCharacterImageCache(savedPath);
     }
     fetchCharacters();
   }, [fetchCharacters]);
   ```
   - 将参数名从 `_savedPath` 改为 `savedPath`（去掉下划线前缀，启用使用）

3. **修改 `handleDelete` 回调**（第 115-126 行，约 +2 行）：
   ```ts
   const handleDelete = useCallback(async (path: string) => {
     addLog(`[Character] 删除角色卡: ${path}`);
     try {
       await window.electronAPI.character.delete(path);
       invalidateCharacterImageCache(path);  // 新增
       addLog(`[Character] 删除成功: ${path}`, 'info');
       message.success('删除成功');
       fetchCharacters();
     } catch (error) {
       addLog(`[Character] 删除失败: ${path}`, 'error');
       message.error('删除失败');
     }
   }, [addLog, fetchCharacters]);
   ```

4. **修改 `handleImportCharacter` 回调**（第 302-336 行，约 +1 行）：
   - 在导入成功后调用 `invalidateCharacterImageCache(result.targetPath)`，因为导入可能覆盖同名文件

### 文件 3: `doc/04-character-card-module.md`

**目标**：增量更新技术文档

**修改内容**：
- 在 4.5 节（已有 Bug 修复记录）补充缓存失效修复
- 更新 4.1 技术难点表，添加缓存失效条目
- 更新 3.3 核心算法，描述缓存失效机制

## 不修改的文件

- `src/main/services/characterService.ts` — 主进程解析/写入逻辑无需改动
- `src/main/ipc/handlers/characterHandlers.ts` — IPC 层无需改动
- `src/renderer/components/Character/CharacterEditModal.tsx` — 此前的图片替换修复已正确工作
- `src/renderer/components/Character/CharacterDialogueChat/CharacterSelectorPanel.tsx` — 使用独立的组件内 state 缓存，不在本次修复范围（可后续优化）
- `src/renderer/components/MemoryChat/ChatManager.tsx` — 共享 `thumbnailCache`，缓存失效后自动受益，无需改动

## 假设与决策

1. **假设**：`CharacterEditModal.tsx` 中的图片替换修复（`imageChanged` + `createFromImage`）已正确工作，磁盘文件会被正确更新。本次修复仅解决渲染层缓存问题。
2. **决策**：使用发布-订阅模式而非 prop drilling 或 context，因为缓存是模块级单例，发布-订阅最简洁且不侵入组件树。
3. **决策**：不修改 `CharacterSelectorPanel.tsx` 的本地缓存，因为它是对话聊天子模块的独立实现，不在用户描述的核心问题范围内。
4. **决策**：`MemoryChat/ChatManager.tsx` 无需修改，因为它直接使用共享的 `thumbnailCache`，缓存被清除后，下次访问会重新从磁盘加载。

## 验证步骤

### 1. TypeScript 类型检查
```bash
npx tsc --noEmit
```
确认无新增类型错误（已有错误 `setting.getCharacterDir` 为预存问题，不影响本次修复）。

### 2. 功能测试场景

| # | 场景 | 操作 | 预期结果 |
|---|------|------|---------|
| 1 | PNG 图片替换 | 编辑已有角色卡 → 更换为 PNG 图片 → 保存 → 查看列表缩略图 | 缩略图显示新图片 |
| 2 | JPG 图片替换 | 编辑已有角色卡 → 更换为 JPG 图片 → 保存 → 查看列表缩略图 | 缩略图显示新图片（经 canvas 转 PNG） |
| 3 | 大尺寸图片替换 | 编辑已有角色卡 → 更换为 4K+ 大图 → 保存 → 查看列表缩略图 | 缩略图显示新图片 |
| 4 | 连续多次替换 | 编辑 → 替换图片 A → 保存 → 再次编辑 → 替换图片 B → 保存 → 查看列表 | 缩略图显示图片 B |
| 5 | 重新打开编辑验证 | 替换图片 → 保存 → 重新打开编辑弹窗 | 编辑弹窗显示新图片 |
| 6 | 查看弹窗头像 | 替换图片 → 保存 → 点击文件名打开查看弹窗 | 头像显示新图片 |
| 7 | 仅编辑数据不换图 | 编辑角色卡文本数据（不更换图片）→ 保存 → 查看列表 | 缩略图不变（正确行为） |
| 8 | 删除角色卡 | 删除角色卡 → 查看列表 | 列表移除该项，无残留缓存问题 |
| 9 | 导入同名角色卡 | 导入与已有角色卡同名的文件 → 查看列表 | 缩略图显示导入的新图片 |
| 10 | 角色卡解析兼容 | 替换图片后 → 在对话聊天中使用该角色卡 → 检查角色数据是否正确 | 角色卡数据（name/description 等）完整正确 |
