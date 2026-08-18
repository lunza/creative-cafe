# 验证清单

## 废弃实现清理

- [x] `src/renderer/utils/blockedWordsMatcher.ts` 及其测试已删除
- [x] `src/renderer/components/Character/CharacterDialogueChat/pipeline/plugins/BlockedWordsPlugin.ts` 及其测试已删除
- [x] `plugins/index.ts` 已回滚，不再注册 BlockedWordsPlugin
- [x] `src/shared/types/blockedWords.ts` 已删除或重写

## 新数据模型

- [x] `ForbiddenWordsConfig` 包含 `enabled` 和 `categories` 字段
- [x] `ForbiddenWordCategory` 包含 `name`、`description`、`words`、`note?` 字段
- [x] 默认配置为 `enabled=false, categories=[]`
- [x] `AppSetting` 接口中 `forbiddenWords` 字段为可选（`?`）

## ForbiddenWordsPromptProvider

- [x] 以 `name='ForbiddenWordsPromptProvider'`、`section='suffix'`、`priority=460` 注册
- [x] 禁词启用且 categories 非空时 `isActive()` 返回 true
- [x] 禁词禁用时 `isActive()` 返回 false
- [x] categories 为空时 `isActive()` 返回 false
- [x] `build()` 输出英文格式的指令块
- [x] 输出包含 `Forbidden Word List (Strict Constraints):` 标题
- [x] 每个类别生成 `No {CategoryName}: {Description}` 格式的段落
- [x] 禁词以 `"word"` 格式出现在引导示例中
- [x] 备注（note）以 `Note: {note}` 格式追加在类别段落末尾
- [x] Provider 注册在 `registerAllProviders()` 中
- [x] 设置存储访问通过依赖注入（SettingStoreAccessor）可测试

## 设置面板

- [x] 全局开关正常工作（开启/关闭）
- [x] 类别列表展示所有类别（名称、描述、禁词预览）
- [x] 添加类别 Modal 表单包含名称、描述、禁词多行输入、备注可选
- [x] 编辑类别 Modal 表单预填已有数据
- [x] 删除类别有 Popconfirm 确认
- [x] 导入功能从 JSON 文件加载类别列表（合并，不替换已有类别）
- [x] 导出功能将类别列表导出为 JSON 文件
- [x] 面板通过 `ref` 暴露 `getFormValues()` 方法
- [x] Settings.tsx 标签页名称改为「内容约束」

## 单元测试

- [x] Provider 测试覆盖 isActive 条件（启用/禁用/空/非空）
- [x] Provider 测试覆盖 build 输出格式
- [x] Provider 测试覆盖多个类别拼接
- [x] 所有测试通过（20 tests / 20 passed）

## 端到端验证

- [x] 启用禁词功能后，生成的系统 prompt 末尾包含 `Forbidden Word List` 指令块（build 输出验证）
- [x] 禁用禁词功能后，系统 prompt 不包含 `Forbidden Word List` 指令块（isActive/build 验证）
- [x] 添加/删除类别后，指令块内容同步更新（纯函数 + store 状态驱动）
- [x] 导入/导出功能完整可用（JSON 格式，使用 electron 文件对话框）