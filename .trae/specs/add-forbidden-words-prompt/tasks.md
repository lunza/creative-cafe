# Tasks

- [x] Task 1: 清理废弃实现（回滚原 add-banned-words-filter 的代码）
  - 删除 `src/renderer/utils/blockedWordsMatcher.ts` 及其测试
  - 删除 `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/BlockedWordsPlugin.ts` 及其测试
  - 回滚 `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/index.ts`（移除 BlockedWordsPlugin 导入和注册）
  - 回滚 `src/renderer/components/Settings/Settings.tsx` 中 BlockedWordsPlugin 相关引用（仅移除插件引用，保留设置面板）

- [x] Task 2: 定义新数据模型（ForbiddenWordsConfig）
  - 创建 `src/shared/types/forbiddenWords.ts`，定义 `ForbiddenWordCategory` 和 `ForbiddenWordsConfig` 接口
  - 导出 `DEFAULT_FORBIDDEN_WORDS_CONFIG` 常量（enabled=false, categories=[]）
  - 更新 `src/shared/types/index.ts` — 导出 forbiddenWords 类型
  - 更新 `src/shared/settings.ts` — 默认配置改为 `forbiddenWords` 新结构
  - 更新 `src/renderer/types/setting.ts` — AppSetting 接口字段改为 `forbiddenWords?: ForbiddenWordsConfig`

- [x] Task 3: 实现 ForbiddenWordsPromptProvider
  - 在 `src/renderer/components/Character/CharacterDialogueChat/pipeline/providers/ForbiddenWordsPromptProvider.ts` 中实现
  - 实现 PromptProvider 接口（name='ForbiddenWordsPromptProvider', section='suffix', priority=460）
  - `isActive()`：检查禁词功能是否启用且 categories 非空
  - `build()`：生成英文格式的指令块（见 spec 输出格式示例）
  - 从 settingStore 获取配置（通过依赖注入或 SettingStoreAccessor）
  - 在 `providers/index.ts` 中导出并注册到 `registerAllProviders`

- [x] Task 4: 重写禁词管理设置面板（ForbiddenWordsSettings）
  - 重写 `src/renderer/components/Settings/BlockedWordsSettings.tsx`（保留文件名，更新实现）
  - 全局开关（Switch 组件）
  - 类别列表（可展开的卡片列表，显示名称、描述、禁词预览、备注）
  - 添加类别（Modal 表单：名称、描述、禁词多行输入、备注可选）
  - 编辑类别（Modal 表单，预填数据）
  - 删除类别（Popconfirm 确认）
  - 导入/导出（JSON 格式）
  - 通过 ref 暴露 `getFormValues()` 方法
  - 更新 `Settings.tsx` 中的标签页名称（内容过滤 → 内容约束）

- [x] Task 5: 编写单元测试
  - 为 ForbiddenWordsPromptProvider 编写测试：
    - isActive 条件测试（启用/禁用/空类别/非空类别）
    - build 输出格式测试（验证输出包含英文指令格式、类别名称、禁词列表、备注）
    - 多个类别拼接测试
    - 无效配置处理测试
  - 验证所有测试通过（20 个测试用例全部通过）

# Task Dependencies

- [Task 1] 无依赖，可最先执行
- [Task 2] 无依赖，可并行执行
- [Task 3] 依赖于 [Task 2]（类型定义）
- [Task 4] 依赖于 [Task 2]（类型定义）
- [Task 5] 依赖于 [Task 3]（Provider 实现）

# 可并行执行的任务

- [Task 1] 和 [Task 2] 可并行
- [Task 3] 和 [Task 4] 在 [Task 2] 完成后可并行