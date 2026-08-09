# Tasks

- [x] Task 1: 创建共享类型定义 `src/shared/types/tag.types.ts`
  - [x] SubTask 1.1: 定义 `TagInfo` 接口（`{ name: string; category: number; count: number; aliases: string[] }`）
  - [x] SubTask 1.2: 定义 `TagSearchResult` 接口（`{ name, category, count, aliases, matchType }`）
  - [x] SubTask 1.3: 定义 `TagSortBy` 类型（`'relevance' | 'count' | 'alphabetical'`）
  - [x] SubTask 1.4: 定义 IPC 请求/响应类型（`TagSearchRequest` / `TagSearchResponse` / `TagLoadStatus`）

- [x] Task 2: 创建主进程 `TagAutocompleteService`（`src/main/services/tagAutocompleteService.ts`）
  - [x] SubTask 2.1: 实现 CSV 文件解析（逐行读取 + 正则解析 `tag_name,category,count,"aliases"` 格式，不依赖第三方 CSV 库）
  - [x] SubTask 2.2: 构建 `Map<string, TagInfo>` 内存索引（key=tag_name 小写，value=TagInfo）
  - [x] SubTask 2.3: 实现延迟加载策略（首次 search 请求时触发加载，加载期间返回 loading 状态）
  - [x] SubTask 2.4: 实现子串匹配查询（遍历 Map，name + aliases 的 `includes` 匹配，limit=50）
  - [x] SubTask 2.5: 实现三种排序规则（relevance: 前缀>开头>包含>别名 + count 降序 / count: count 降序 / alphabetical: name 升序）
  - [x] SubTask 2.6: 实现 `reload(csvPath?)` 方法（清空索引 + 重新加载）
  - [x] SubTask 2.7: 实现 `getLoadStatus()` 方法（返回 `{ loaded, loading, totalCount, csvPath, error }`）

- [x] Task 3: 注册 IPC 通道（`src/main/ipc/handlers/tagHandlers.ts` + `src/main/ipc/index.ts`）
  - [x] SubTask 3.1: 创建 `tagHandlers.ts`，实现 4 个 handler：`tag:search` / `tag:getLoadStatus` / `tag:reload` / `tag:setCsvPath`
  - [x] SubTask 3.2: 在 `src/main/ipc/index.ts` 中注册 tag 命名空间的 4 个通道（遵循现有注册顺序约定）
  - [x] SubTask 3.3: 在 `src/preload/index.ts` 中暴露 tag 相关 API 到渲染进程

- [x] Task 4: settingStore 新增配置项
  - [x] SubTask 4.1: 在 `settingStore` 中新增 `tagAutocompleteEnabled`（boolean，默认 true）
  - [x] SubTask 4.2: 新增 `tagAutocompleteCsvPath`（string，默认空）
  - [x] SubTask 4.3: 新增 `tagAutocompleteSortBy`（TagSortBy，默认 'relevance'）
  - [x] SubTask 4.4: 确保配置项持久化到 electron-store

- [x] Task 5: 创建 `TagAutocomplete` 组件（`src/renderer/components/Common/TagAutocomplete.tsx`）
  - [x] SubTask 5.1: 基于 antd `AutoComplete` 实现组件骨架（Props: `value` / `onChange` / `onTagSelect` / `placeholder` / `disabled` / `style`）
  - [x] SubTask 5.2: 实现 debounce 150ms 输入监听 → IPC `tag:search` 查询
  - [x] SubTask 5.3: 实现下拉项渲染（tag name + category 彩色 Tag + count 值）
  - [x] SubTask 5.4: 实现排序规则切换（Dropdown 按钮在 AutoComplete 旁边，3 个选项）
  - [x] SubTask 5.5: 实现无匹配结果提示（notFoundContent = "未找到匹配的标签"）
  - [x] SubTask 5.6: 实现加载中提示（标签库未加载时显示"标签库加载中..."）
  - [x] SubTask 5.7: 实现选中后清空输入框 + 触发 `onTagSelect(tag)` 回调
  - [x] SubTask 5.8: 实现开关关闭时降级为普通 Input

- [x] Task 6: Settings UI 新增标签自动推荐配置区域
  - [x] SubTask 6.1: 在 Settings 面板中新增"标签自动推荐"配置区域
  - [x] SubTask 6.2: 实现 CSV 文件路径选择（文件选择按钮 + 路径显示）
  - [x] SubTask 6.3: 实现开关 Switch + 默认排序规则 Select
  - [x] SubTask 6.4: 路径变更时触发 `tag:reload` IPC 重新加载

- [x] Task 7: 集成到 AssetGenerateModal
  - [x] SubTask 7.1: 找到"输入临时标签"的 Input 组件位置（L1940 附近）
  - [x] SubTask 7.2: 替换为 `TagAutocomplete` 组件
  - [x] SubTask 7.3: 实现 `onTagSelect` 回调：将选中的 tag 添加到临时特征标签列表（复用现有 handleAddTrait 逻辑）
  - [x] SubTask 7.4: 确保 `tagAutocompleteEnabled` 关闭时降级为原 Input 行为

- [x] Task 8: 性能验证 + 文档更新
  - [x] SubTask 8.1: 验证 31.7 万条数据的子串匹配延迟 < 50ms（主进程）— 静态分析
  - [x] SubTask 8.2: 验证端到端输入响应延迟 < 300ms（按键到下拉展示）— 静态分析
  - [x] SubTask 8.3: 更新 CODE_WIKI.md（新增 tag 命名空间 IPC + TagAutocompleteService 架构描述）
  - [x] SubTask 8.4: 更新 docs/FIX_RECORDS.md（新增实现记录）
  - [x] SubTask 8.5: 更新 CHANGELOG.md

# Task Dependencies
- [Task 3] depends on [Task 1]（IPC 类型定义）和 [Task 2]（Service 方法）
- [Task 5] depends on [Task 1]（类型定义）和 [Task 3]（IPC API）
- [Task 6] depends on [Task 4]（settingStore 配置项）和 [Task 3]（tag:reload IPC）
- [Task 7] depends on [Task 5]（TagAutocomplete 组件）和 [Task 4]（开关配置）
- [Task 8] depends on [Task 7]（集成完成后验证）
- [Task 1] 和 [Task 2] 和 [Task 4] 可并行
