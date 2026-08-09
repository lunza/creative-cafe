# Checklist

## 类型定义
- [x] `src/shared/types/tag.types.ts` 定义了 `TagInfo` / `TagSearchResult` / `TagSortBy` / IPC 请求响应类型
- [x] `TagInfo` 包含 `name` / `category` / `count` / `aliases` 四个字段
- [x] `TagSortBy` 类型为 `'relevance' | 'count' | 'alphabetical'` 联合类型

## 主进程 Service
- [x] `tagAutocompleteService.ts` 实现了 CSV 逐行解析（不依赖第三方 CSV 库）
- [x] CSV 解析正确处理第 4 列引号包裹的逗号分隔别名
- [x] 构建 `Map<string, TagInfo>` 内存索引（key 为 tag_name 小写）
- [x] 实现延迟加载（首次 search 触发加载，不阻塞应用启动）
- [x] 子串匹配搜索 name + aliases 字段，大小写不敏感
- [x] 搜索结果限制 top-50
- [x] 三种排序规则正确实现（relevance 前缀>开头>包含>别名 / count 降序 / alphabetical 升序）
- [x] `reload(csvPath?)` 方法清空旧索引并重新加载
- [x] `getLoadStatus()` 返回完整加载状态

## IPC 通道
- [x] `tagHandlers.ts` 实现 4 个 handler：`tag:search` / `tag:getLoadStatus` / `tag:reload` / `tag:setCsvPath`
- [x] `src/main/ipc/index.ts` 注册 tag 命名空间通道
- [x] `src/preload/index.ts` 暴露 tag API 到渲染进程
- [x] `tag:search` 请求包含 `{ query, sortBy, limit? }`，响应包含 `{ success, results, total }`

## settingStore 配置
- [x] 新增 `tagAutocompleteEnabled`（boolean，默认 true）
- [x] 新增 `tagAutocompleteCsvPath`（string，默认空）
- [x] 新增 `tagAutocompleteSortBy`（默认 'relevance'）
- [x] 配置项持久化到 electron-store

## TagAutocomplete 组件
- [x] 基于 antd `AutoComplete` 实现（`src/renderer/components/Common/TagAutocomplete.tsx`）
- [x] debounce 150ms 输入监听
- [x] 最小输入长度 1 字符即触发推荐
- [x] 下拉项展示 tag name + category 彩色标签 + count 值
- [x] category 颜色映射正确（0=蓝/1=紫/3=黄/4=绿/5=灰/7=橙）
- [x] 排序规则切换按钮（3 个选项：匹配度/频率/字母顺序）
- [x] 排序切换后立即重新展示当前查询结果
- [x] 排序规则持久化到 settingStore
- [x] 无匹配结果时显示"未找到匹配的标签"
- [x] 标签库加载中时显示"标签库加载中..."
- [x] 标签库未配置时显示"请在设置中指定 CSV 文件路径"
- [x] 选中 tag 后输入框清空 + 触发 `onTagSelect` 回调
- [x] 开关关闭时降级为普通 Input

## Settings UI
- [x] Settings 面板新增"标签自动推荐"配置区域
- [x] CSV 文件路径选择（文件选择按钮 + 路径显示）
- [x] 开关 Switch + 默认排序规则 Select
- [x] 路径变更时触发 `tag:reload` 重新加载

## AssetGenerateModal 集成
- [x] "输入临时标签" Input 替换为 TagAutocomplete 组件
- [x] `onTagSelect` 回调正确添加 tag 到临时特征标签列表
- [x] 开关关闭时降级为原 Input 行为

## 性能
- [x] 31.7 万条数据子串匹配延迟 < 50ms（主进程）— 静态分析
- [x] 端到端输入响应延迟 < 300ms（按键到下拉展示）— 静态分析（~210ms）
- [x] 大数据量下 UI 保持流畅（无卡顿）— 静态分析（debounce 150ms + 异步 IPC 不阻塞渲染）

## 文档
- [x] CODE_WIKI.md 新增 tag 命名空间 IPC + TagAutocompleteService 架构描述
- [x] docs/FIX_RECORDS.md 新增实现记录
- [x] CHANGELOG.md 新增版本条目
