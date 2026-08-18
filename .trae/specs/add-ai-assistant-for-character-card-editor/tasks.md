# Tasks

- [x] Task 1: 创建共享类型定义 — 在 `src/shared/types/assistant.types.ts` 中定义 `AssistantMessage`, `Suggestion`, `AssistantState` 等类型
  - 定义 `AssistantMessage`（role: 'user' | 'assistant', content: string, timestamp: number）
  - 定义 `Suggestion`（title: string, description: string, editContent: string, actionTip: string, type: SuggestionType）
  - 定义 `SuggestionType` 枚举（DESCRIPTION, DIALOGUE, SYSTEM_PROMPT, PERSONALITY, SCENARIO, FIRST_MESSAGE）
  - 定义 `AssistantState`（isOpen: boolean, messages: AssistantMessage[], isLoading: boolean, cache: Map<string, Suggestion[]>）

- [x] Task 2: 创建助手核心 hook — 在 `src/renderer/components/Character/hooks/useCharacterCardAssistant.ts` 中实现状态管理、AI 请求、缓存、多轮对话逻辑
  - 实现 `useCharacterCardAssistant` hook
  - 实现面板显示/隐藏状态管理（`isOpen`）
  - 实现对话历史管理（`messages` 数组，维护最近 6 轮对话）
  - 实现 AI 请求方法（`sendQuestion`），构建角色卡上下文 + 用户问题
  - 实现请求取消（`AbortController`）
  - 实现缓存机制（`suggestionCache`，基于问题语义相似度判断）
  - 实现缓存失效逻辑（角色卡内容变化时清空）
  - 实现建议内容的结构化解析（从 AI 响应文本解析为 `Suggestion[]`）

- [x] Task 3: 创建建议展示卡片组件 — 在 `src/renderer/components/Character/AssistantSuggestionCard.tsx` 中实现单条建议展示
  - 实现建议标题展示（粗体 + 类型图标）
  - 实现建议说明展示
  - 实现编辑建议代码块展示（带复制按钮）
  - 实现"复制全部"按钮
  - 实现复制成功提示（2 秒自动消失）
  - 使用 `React.memo` 优化渲染

- [x] Task 4: 创建助手面板主体组件 — 在 `src/renderer/components/Character/CharacterCardAssistantPanel.tsx` 中实现对话区 + 建议展示区
  - 实现对话消息列表渲染（用户问题和 AI 回复交替展示）
  - 实现建议内容渲染（`AssistantSuggestionCard` 列表）
  - 实现输入框（`Input.TextArea`，支持 Enter 发送）
  - 实现加载状态（Spin + 动态提示文字）
  - 实现错误状态（错误提示 + 重试按钮）
  - 实现空状态引导（示例问题）

- [x] Task 5: 创建悬浮助手面板组件 — 在 `src/renderer/components/Character/CharacterCardAssistant.tsx` 中实现悬浮面板容器
  - 实现面板悬浮布局（右侧，360px 宽度，80vh 最大高度）
  - 实现外部点击不收回逻辑
  - 实现关闭按钮和收起/展开动画（CSS transition）
  - 集成 `CharacterCardAssistantPanel` 子组件
  - 使用 `React.memo` 优化渲染

- [x] Task 6: 集成到 CharacterEditModal — 修改 `CharacterEditModal.tsx` 添加入口按钮和面板容器
  - 在工具栏右侧添加"智能助手"入口按钮（RobotOutlined 图标）
  - 在编辑器内容区域右侧添加面板容器（条件渲染）
  - 将角色卡字段数据传递给 `useCharacterCardAssistant` hook
  - 编辑器 Tab 切换时自动关闭面板
  - 关闭编辑弹窗时自动销毁面板状态

- [x] Task 7: 新增助手 AI 请求方法 — 在 `src/renderer/utils/characterAIUtils.ts` 中新增助手专用请求方法
  - 实现 `sendAssistantAIRequest` 方法
  - 构建角色卡上下文提示词（含所有字段内容的 JSON 结构）
  - 构建助手系统提示词模板
  - 支持 `AbortController` 取消
  - 支持流式响应解析（可选）

- [x] Task 8: 新增助手提示词模板 — 在 `src/renderer/utils/promptTemplates.ts` 中新增助手专用模板
  - 定义 `assistant.system` 系统提示词模板（角色卡结构说明 + 建议生成规则）
  - 定义 `assistant.suggestion` 建议生成模板（结构化输出格式要求）
  - 定义 `assistant.context` 上下文构建模板（字段内容格式化）

- [x] Task 9: 自测验证 — 验证所有功能正常工作
  - 验证面板展开/关闭行为
  - 验证外部点击不影响面板
  - 验证自然语言提问返回建议
  - 验证一键复制功能
  - 验证多轮对话连贯性
  - 验证缓存机制
  - 验证加载状态和错误处理
  - 验证编辑器性能不受影响

# Task Dependencies

- [Task 1] 无依赖，可最先执行
- [Task 2] 依赖 [Task 1]（类型定义）
- [Task 3] 依赖 [Task 1]（类型定义）
- [Task 4] 依赖 [Task 2]（hook）+ [Task 3]（建议卡片）
- [Task 5] 依赖 [Task 4]（面板主体）
- [Task 6] 依赖 [Task 5]（悬浮面板）
- [Task 7] 无依赖，可与 Task 1-3 并行
- [Task 8] 无依赖，可与 Task 1-3 并行
- [Task 9] 依赖 [Task 6]（集成完成）