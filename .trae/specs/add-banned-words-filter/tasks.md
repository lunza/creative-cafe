# Tasks

- [x] Task 1: 定义禁词表类型与默认配置
  - 在 `src/shared/types/blockedWords.ts` 中定义 `BlockedWordsConfig` 接口和 `BlockedWordEntry` 类型
  - 在 `src/shared/settings.ts` 的 `AppSetting.defaultSetting` 中添加 `blockedWords` 默认配置（enabled=false, mode='full', words=[]）
  - 在 `src/renderer/types/setting.ts` 的 `AppSetting` 接口中添加 `blockedWords?: BlockedWordsConfig`

- [x] Task 2: 实现禁词匹配工具函数
  - 在 `src/renderer/utils/blockedWordsMatcher.ts` 中实现纯函数工具
  - 实现 `compileBlockedWords(words: string[], mode: BlockedWordsMode, caseSensitive: boolean): RegExp[]`
  - 实现 `filterBlockedWords(content: string, config: BlockedWordsConfig): string`
  - 实现三种匹配模式：full（全词匹配 \b 边界）、wildcard（通配符转正则）、regex（直接使用）
  - 包含性能优化：预编译正则缓存、空列表短路、合并正则批量匹配
  - 包含无效正则的捕获和处理

- [x] Task 3: 实现 BlockedWordsPlugin 后处理插件
  - 在 `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/BlockedWordsPlugin.ts` 中实现
  - 实现 `PostProcessPlugin` 接口（name='blockedWords', priority=750）
  - `detect()` 方法：检查禁词表是否启用且非空
  - `process()` 方法：调用 `blockedWordsMatcher.filterBlockedWords()` 过滤内容
  - 从 settingStore 获取配置（通过 context 或全局 store）
  - 异常处理：无效正则等异常捕获后记录到 context.errors，返回原始内容
  - 在 `plugins/index.ts` 中导出并注册到 `registerAllPlugins`

- [x] Task 4: 实现禁词管理设置面板
  - 在 `src/renderer/components/Settings/BlockedWordsSettings.tsx` 中实现
  - 全局开关（Switch 组件）
  - 匹配模式选择器（Radio 或 Select，含 full/wildcard/regex 三种模式说明）
  - 大小写敏感开关
  - 禁词列表展示（可滚动的列表，每条可删除）
  - 添加禁词输入框（含添加按钮，支持 Enter 键添加）
  - 批量添加功能区（TextArea，支持多行粘贴）
  - 替换文本输入框
  - 应用范围选择器（全部/仅对话）
  - 导入/导出按钮（JSON 格式，使用 electron 文件对话框）
  - 通过 ref 暴露 `getFormValues()` 方法，与 Settings.tsx 的保存逻辑集成

- [x] Task 5: 集成设置面板到 Settings 标签页
  - 修改 `src/renderer/components/Settings/Settings.tsx`
  - 导入 BlockedWordsSettings 组件
  - 在 Tabs 的 items 数组中新增「内容过滤」标签页
  - 在 handleSave 中收集 BlockedWordsSettings 的配置值并合并到 updatedSetting
  - 添加 ref 引用 BlockedWordsSettings 组件

- [x] Task 6: 编写单元测试
  - 为 `blockedWordsMatcher.ts` 编写测试：
    - 全词匹配测试（含边界情况：禁词在句首、句中、句尾，禁词作为子词不匹配）
    - 通配符匹配测试（`*`、`?` 模式）
    - 正则匹配测试（含无效正则的容错）
    - 大小写敏感/不敏感测试
    - 空列表/空内容边界测试
    - 大量禁词性能测试（1000+ 条，验证 < 50ms）
  - 为 `BlockedWordsPlugin.ts` 编写测试：
    - detect 条件测试（启用/禁用/空列表）
    - process 执行测试
    - 异常处理测试

# Task Dependencies

- [Task 1] 无依赖，可最先执行
- [Task 2] 依赖于 [Task 1]（类型定义）
- [Task 3] 依赖于 [Task 2]（匹配工具函数）
- [Task 4] 依赖于 [Task 1]（类型定义）
- [Task 5] 依赖于 [Task 4]（设置面板组件）
- [Task 6] 依赖于 [Task 2] 和 [Task 3]（实现代码）

# 可并行执行的任务

- [Task 1] 和 [Task 4] 可并行（类型定义与设置面板设计可同时进行）
- [Task 2] 和 [Task 4] 可并行（匹配工具与设置面板无依赖）