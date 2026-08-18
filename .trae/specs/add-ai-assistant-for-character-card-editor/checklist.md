# Checklist

## 共享类型定义
- [x] `AssistantMessage` 类型定义正确（role, content, timestamp）
- [x] `Suggestion` 类型定义正确（title, description, editContent, actionTip, type）
- [x] `SuggestionType` 枚举值完整（6 种类型）
- [x] `AssistantState` 类型定义正确

## 助手核心 Hook
- [x] `useCharacterCardAssistant` hook 实现完整
- [x] 面板显示/隐藏状态管理正确
- [x] 对话历史管理（最近 6 轮）正确实现
- [x] AI 请求方法正确构建角色卡上下文
- [x] 请求取消功能正常工作
- [x] 缓存机制正确实现
- [x] 缓存失效逻辑正确（角色卡内容变化时清空）
- [x] 建议内容结构化解析正确

## 建议展示卡片组件
- [x] 建议标题展示（粗体 + 类型图标）
- [x] 建议说明展示
- [x] 编辑建议代码块展示
- [x] 单条复制按钮
- [x] "复制全部"按钮
- [x] 复制成功提示（2 秒自动消失）
- [x] React.memo 优化应用

## 助手面板主体组件
- [x] 对话消息列表渲染正确
- [x] 建议内容渲染正确
- [x] 输入框功能正常（Enter 发送）
- [x] 加载状态展示（Spin + 提示文字）
- [x] 错误状态展示（提示 + 重试按钮）
- [x] 空状态引导（示例问题）

## 悬浮助手面板组件
- [x] 面板右侧悬浮布局正确
- [x] 外部点击不收回
- [x] 关闭按钮功能正常
- [x] 展开/收起动画流畅
- [x] React.memo 优化应用

## 集成到 CharacterEditModal
- [x] 工具栏入口按钮正确显示
- [x] 入口按钮切换面板显示/隐藏
- [x] 角色卡字段数据正确传递给 hook
- [x] 编辑器 Tab 切换时自动关闭面板
- [x] 关闭编辑弹窗时销毁面板状态

## 助手 AI 请求方法
- [x] `sendAssistantAIRequest` 方法实现正确
- [x] 角色卡上下文提示词构建正确
- [x] AbortController 取消支持
- [x] 流式响应解析（可选）

## 助手提示词模板
- [x] `assistant.system` 系统提示词模板
- [x] `assistant.suggestion` 建议生成模板
- [x] `assistant.context` 上下文构建模板

## 功能验证
- [x] 面板展开/关闭行为正确
- [x] 外部点击不影响面板状态
- [x] 自然语言提问返回结构化建议
- [x] 建议内容一键复制功能正常
- [x] 多轮对话保持上下文连贯
- [x] 缓存机制减少重复请求
- [x] 加载状态提示清晰
- [x] 错误处理完善，支持重试
- [x] 编辑器性能不受影响（无卡顿）