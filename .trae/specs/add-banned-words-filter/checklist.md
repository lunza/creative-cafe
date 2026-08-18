# 验证清单

## 类型定义与配置

- [x] `BlockedWordsConfig` 类型定义包含所有必需字段（enabled, mode, words, replacement, caseSensitive, scope）
- [x] `AppSetting` 默认配置中包含 `blockedWords` 默认值（enabled=false, mode='full', words=[]）
- [x] `AppSetting` 接口中 `blockedWords` 字段为可选（`?`），兼容旧配置

## 禁词匹配工具函数

- [x] 全词匹配模式正确识别单词边界（句首、句中、句尾、标点符号前后）
- [x] 全词匹配模式不匹配子词（如 `ass` 不匹配 `assembly`）
- [x] 通配符模式正确转换 `*` 和 `?` 为正则
- [x] 正则模式正确编译和使用用户提供的正则表达式
- [x] 无效正则表达式被捕获且不抛出异常
- [x] 大小写不敏感模式正确匹配大小写变体
- [x] 大小写敏感模式仅匹配精确大小写
- [x] 空列表时返回原始内容（零开销短路）
- [x] 空内容时返回空字符串（不崩溃）
- [x] 1000+ 条禁词时单次过滤 < 50ms

## BlockedWordsPlugin 后处理插件

- [x] 插件以 priority=750 注册到 PostProcessingPipeline
- [x] 禁词启用且列表非空时 `detect()` 返回 true
- [x] 禁词禁用时 `detect()` 返回 false
- [x] 禁词列表为空时 `detect()` 返回 false
- [x] `process()` 正确过滤 content 中的禁词
- [x] 匹配工具抛出异常时，插件捕获异常、记录到 context.errors、返回原始内容
- [x] 插件注册在 `registerAllPlugins()` 中

## 禁词管理设置面板

- [x] 全局开关正常工作（开启/关闭）
- [x] 匹配模式选择器提供三种模式选项，并显示对应说明
- [x] 大小写敏感开关正常切换
- [x] 添加禁词输入框支持输入文本和 Enter 键添加
- [x] 空文本或空白文本不允许添加
- [x] 禁词列表展示当前所有条目
- [x] 删除按钮移除对应条目
- [x] 批量添加 TextArea 支持多行粘贴，自动过滤空白行和重复项
- [x] 替换文本输入框可编辑
- [x] 应用范围选择器提供「全部」和「仅对话」选项
- [x] 导出功能将禁词列表导出为 JSON 文件
- [x] 导入功能从 JSON 文件加载禁词列表（支持合并或替换）
- [x] 面板通过 `ref` 暴露 `getFormValues()` 方法

## 设置面板集成

- [x] Settings.tsx 的 Tabs 中包含「内容过滤」标签页
- [x] 标签页图标和标签文字合理
- [x] handleSave 中正确收集 BlockedWordsSettings 的配置值
- [x] 保存后的配置在重载后仍然保留（通过 setting.save/setting.load IPC 持久化）

## 端到端验证

- [x] 启用禁词表后，AI 回复中包含禁词时被正确替换（通过单元测试验证）
- [x] 禁用禁词表后，AI 回复原样输出（detect 返回 false）
- [x] 切换匹配模式后过滤行为立即改变（缓存失效重新编译）
- [x] 导入/导出功能完整可用（JSON 格式，使用 electron 文件对话框）
- [x] 无效正则表达式不导致系统崩溃（fail-safe 返回原始内容）
- [x] 大量禁词下对话性能不受明显影响（合并正则 + 缓存优化）

## 单元测试

- [x] blockedWordsMatcher 测试覆盖所有匹配模式（33 个测试用例）
- [x] blockedWordsMatcher 测试覆盖边界条件（空列表、空内容、子词不匹配）
- [x] blockedWordsMatcher 测试覆盖异常处理（无效正则）
- [x] blockedWordsMatcher 包含性能测试（1000+ 禁词 < 50ms，5000 条编译 < 200ms）
- [x] BlockedWordsPlugin 测试覆盖 detect/process/异常处理（11 个测试用例）