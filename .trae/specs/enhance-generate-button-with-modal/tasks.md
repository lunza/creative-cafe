# 任务列表

## 任务 1: 新增生成指导弹窗状态和 Modal 组件
- [x] 任务 1.1: 在 CharacterManager.tsx 中添加生成弹窗相关状态
  - [x] 添加 `isGenerateModalOpen` 状态（boolean）
  - [x] 添加 `generateRequirements` 状态（string）
  - [x] 添加 `currentGenerateField` 状态（string | null）
- [x] 任务 1.2: 在 CharacterManager.tsx 中新增生成指导 Modal 组件
  - [x] Modal 标题为"AI生成"
  - [x] 包含提示文字和 4 行 TextArea
  - [x] 底部按钮：取消 + 确认生成（或生成进行中时显示中断请求）
  - [x] 支持 autoFocus
  - [x] 生成进行中时禁用输入和关闭

## 任务 2: 修改 handleGenerate 函数
- [x] 任务 2.1: 将原 handleGenerate 拆分为两步
  - [x] 原 handleGenerate 改为 `openGenerateModal(field)`：打开弹窗并设置当前字段
  - [x] 新增 `performGenerate()` 函数：执行实际的 AI 生成逻辑
  - [x] performGenerate 接收 generateRequirements 参数并拼接到 userPrompt 末尾
- [x] 任务 2.2: 更新 FieldEditor 的 onGenerate 回调
  - [x] 将 onGenerate 回调从 handleGenerate 改为 openGenerateModal

## 任务 3: 验证与测试
- [x] 任务 3.1: 验证弹窗 UI 与润色弹窗一致性
  - [x] 布局结构一致
  - [x] 按钮位置和样式一致
  - [x] 输入框尺寸一致
- [x] 任务 3.2: 验证功能正确性
  - [x] 点击生成按钮弹出弹窗
  - [x] 输入指导后生成内容包含指导信息
  - [x] 不输入指导直接生成，行为与之前一致
  - [x] 取消按钮正常工作
  - [x] 生成进行中可中断

## 任务依赖关系
- 任务 1 和 任务 2 可以并行实施（但实际有依赖，任务 2 依赖任务 1 的状态）
- 任务 3 依赖于 任务 1、2 完成
