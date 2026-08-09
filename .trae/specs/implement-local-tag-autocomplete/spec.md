# 本地标签自动推荐功能 Spec

## Why

用户已下载 Danbooru/e621 merged 标签库（317,600 个 tag，保存于 `G:\AI\sd-webui-forge-neo\models\Stable-diffusion\Furry\tags\`），但系统中 tag 输入框（如 AssetGenerateModal 的"输入临时标签"）无自动推荐功能，用户需要手动记忆和输入英文 tag。开发本地标签自动推荐功能可大幅提升 tag 输入效率和准确性，确保 tag 来源严格匹配模型训练数据。

## What Changes

- 新增主进程 `TagAutocompleteService`：加载 CSV 标签库 → 构建 `Map<string, TagInfo>` 索引 → 提供子串匹配查询 + 多规则排序
- 新增 IPC 通道：`tag:search`（查询）/ `tag:getLoadStatus`（加载状态）/ `tag:reload`（重新加载）/ `tag:setCsvPath`（设置路径）
- 新增渲染进程 `TagAutocomplete` 组件（基于 antd `AutoComplete`）：实时输入监听 + debounce + IPC 查询 + 排序切换 + 下拉展示
- 新增设置项：`settingStore` 中添加标签库 CSV 路径 + 开关 + 默认排序规则
- 集成到 `AssetGenerateModal` 的"输入临时标签"输入框（替换现有 `Input`）

## Impact

- **Affected code**:
  - `src/main/services/tagAutocompleteService.ts`（新建）— 标签库加载 + 查询服务
  - `src/main/ipc/handlers/tagHandlers.ts`（新建）— IPC 通道处理
  - `src/main/ipc/index.ts`（修改）— 注册新通道
  - `src/renderer/components/Common/TagAutocomplete.tsx`（新建）— 自动推荐组件
  - `src/renderer/stores/settingStore.ts`（修改）— 新增配置项
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`（修改）— 集成组件
  - `src/renderer/components/Settings/`（修改）— 新增设置 UI
  - `src/shared/types/tag.types.ts`（新建）— 共享类型定义

## ADDED Requirements

### Requirement: Tag Library Data Loading

系统 SHALL 在主进程中加载 CSV 标签库文件并构建内存索引，支持高效查询。

#### Scenario: 首次加载
- **WHEN** 用户首次触发标签查询（或应用启动后异步预加载）
- **THEN** 主进程读取 CSV 文件，逐行解析为 `TagInfo` 对象（`{ name, category, count, aliases }`），构建 `Map<string, TagInfo>` 索引
- **AND** 加载完成后缓存到内存，后续查询直接从内存读取
- **AND** 加载状态通过 `tag:getLoadStatus` IPC 通道暴露（`{ loaded, loading, totalCount, csvPath, error }`）

#### Scenario: CSV 解析格式
- **GIVEN** CSV 行格式为 `tag_name,category,count,"alias1,alias2,alias3"`
- **THEN** 解析为 `{ name: tag_name, category: parseInt(category), count: parseInt(count), aliases: string[] }`
- **AND** 第 4 列（aliases）去除引号后按逗号分割为数组；无第 4 列时 aliases 为空数组

#### Scenario: 延迟加载不阻塞启动
- **WHEN** 应用启动
- **THEN** 标签库不立即加载（避免拖慢启动）
- **AND** 首次 `tag:search` 请求时触发加载；加载期间返回 `{ loading: true, results: [] }`
- **AND** 加载完成后自动执行该次查询并返回结果

#### Scenario: 重新加载
- **WHEN** 用户通过 `tag:reload` 请求重新加载（如切换 CSV 文件后）
- **THEN** 主进程清空旧索引，重新读取并解析 CSV 文件
- **AND** 返回新的加载状态（`{ success, totalCount, error? }`）

### Requirement: Real-time Tag Search

系统 SHALL 根据用户输入实时从标签库中筛选匹配结果。

#### Scenario: 子串匹配
- **WHEN** 用户输入 "app"
- **THEN** 从标签库中筛选所有 name 或 aliases 包含 "app" 的标签（如 "apple"、"application"、"snapped"）
- **AND** 结果数量限制为 top-50（避免返回过多数据）

#### Scenario: 搜索范围
- **GIVEN** 用户输入 query
- **THEN** 搜索范围包括 tag 的 `name` 字段和 `aliases` 数组中的每个别名
- **AND** 匹配方式为大小写不敏感的子串匹配（`includes`）

#### Scenario: 输入防抖
- **WHEN** 用户连续快速输入
- **THEN** 输入后 150ms 内若无新输入才触发查询（debounce 150ms）
- **AND** 最小输入长度为 1 字符（输入 "a" 即开始推荐）

#### Scenario: 性能要求
- **GIVEN** 标签库数据量为 31.7 万条
- **WHEN** 用户输入任意 query
- **THEN** 从按键到下拉框展示结果的端到端延迟不超过 300ms
- **AND** 主进程子串匹配遍历 31.7 万条在 50ms 以内完成

### Requirement: Configurable Sorting

系统 SHALL 提供可配置的排序功能，支持按匹配度、使用频率、字母顺序排序，并提供切换选项。

#### Scenario: 按匹配度排序（默认）
- **GIVEN** sortBy = "relevance"
- **THEN** 排序优先级：name 前缀匹配 > name 开头匹配 > name 包含匹配 > alias 匹配
- **AND** 同级内按 count 降序排列

#### Scenario: 按使用频率排序
- **GIVEN** sortBy = "count"
- **THEN** 按 count 字段降序排列（高频 tag 优先）

#### Scenario: 按字母顺序排序
- **GIVEN** sortBy = "alphabetical"
- **THEN** 按 name 字段字母升序排列（A-Z）

#### Scenario: 排序切换
- **WHEN** 用户点击下拉框中的排序切换按钮
- **THEN** 立即按新排序规则重新展示当前查询结果（无需重新输入）
- **AND** 排序规则持久化到 settingStore

### Requirement: Tag Autocomplete UI

系统 SHALL 以下拉框形式展示推荐结果，支持键盘和鼠标交互。

#### Scenario: 下拉展示
- **WHEN** 查询返回结果
- **THEN** 以下拉框形式展示，每项包含：tag name（等宽字体）+ category 标签（彩色 Tag）+ count 值
- **AND** category 颜色映射：0=general(蓝) / 1=artist(紫) / 3=copyright(黄) / 4=character(绿) / 5=meta(灰) / 7=e621(橙)

#### Scenario: 键盘选择
- **WHEN** 下拉框打开时用户按上下键
- **THEN** 高亮项上下移动（antd AutoComplete 原生支持）
- **AND** 按 Enter 选中当前高亮项

#### Scenario: 鼠标选择
- **WHEN** 用户点击下拉项
- **THEN** 选中该 tag，触发 `onTagSelect` 回调

#### Scenario: 选中后行为
- **WHEN** 用户选中一个 tag
- **THEN** 输入框清空（准备输入下一个 tag）
- **AND** 触发 `onTagSelect(tag)` 回调，由父组件决定如何处理（如添加到特征标签列表）

### Requirement: Error Handling

系统 SHALL 在无匹配结果或加载失败时提供明确反馈。

#### Scenario: 无匹配结果
- **WHEN** 查询返回空结果
- **THEN** 下拉框显示"未找到匹配的标签"提示（antd AutoComplete 的 notFoundContent）
- **AND** 不显示空下拉框

#### Scenario: 标签库未加载
- **WHEN** 标签库尚未加载完成时用户输入
- **THEN** 下拉框显示"标签库加载中..."提示
- **AND** 加载完成后自动查询并展示结果

#### Scenario: CSV 文件不存在
- **WHEN** 配置的 CSV 路径无效或文件不存在
- **THEN** `tag:getLoadStatus` 返回 `{ loaded: false, error: '文件不存在: ...' }`
- **AND** 下拉框显示"标签库未配置，请在设置中指定 CSV 文件路径"

### Requirement: Settings Configuration

系统 SHALL 提供设置项让用户配置标签库。

#### Scenario: CSV 路径配置
- **WHEN** 用户在设置中指定 CSV 文件路径
- **THEN** 路径保存到 settingStore
- **AND** 触发 `tag:reload` 重新加载新路径的标签库

#### Scenario: 开关
- **WHEN** 用户关闭标签自动推荐开关
- **THEN** TagAutocomplete 组件降级为普通 Input（无推荐功能）
- **AND** 开关状态保存到 settingStore

## MODIFIED Requirements

### Requirement: AssetGenerateModal 临时标签输入

**原有行为**：AssetGenerateModal 中"输入临时标签"使用普通 `Input` 组件，用户手动输入英文 tag，按 Enter 添加到特征标签列表。

**修改后行为**：替换为 `TagAutocomplete` 组件，用户输入时实时推荐标签库中的 tag，选中后自动添加到特征标签列表。开关关闭时降级为原 Input 行为。
