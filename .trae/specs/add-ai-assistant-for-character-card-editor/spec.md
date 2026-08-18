# 角色卡编辑智能助手 Spec

## Why

当前角色卡编辑器（`CharacterEditModal`）虽然提供了字段级 AI 操作（翻译/润色/生成/还原），但缺乏一个**统一的、上下文感知的智能助手**——用户无法通过自然语言提问获取跨字段的整体性设计建议，也无法获得基于角色卡完整内容的针对性指导。当前 AI 操作只能逐字段执行，割裂且缺乏全局视角。

本 spec 新增一个智能助手模块，在角色卡编辑界面中提供悬浮式助手面板，支持用户通过自然语言提问获取角色设计的结构化建议，覆盖角色描述、对话样例、系统提示词等多维度内容。

## What Changes

### 新增模块
- **`src/renderer/components/Character/CharacterCardAssistant.tsx`** — 智能助手悬浮面板组件（默认展开，外部点击不收回，含手动关闭/激活按钮）
- **`src/renderer/components/Character/CharacterCardAssistantPanel.tsx`** — 助手面板主体（对话区 + 建议展示区 + 一键复制）
- **`src/renderer/components/Character/hooks/useCharacterCardAssistant.ts`** — 助手核心 hook（状态管理 + AI 请求 + 缓存 + 多轮对话上下文）
- **`src/renderer/components/Character/AssistantSuggestionCard.tsx`** — 单条建议展示卡片组件（含复制按钮、结构化排版）
- **`src/shared/types/assistant.types.ts`** — 共享类型定义（AssistantMessage, Suggestion, AssistantState 等）

### 修改文件
- **`src/renderer/components/Character/CharacterEditModal.tsx`** — 在编辑弹窗中集成智能助手入口按钮和悬浮面板
- **`src/renderer/utils/characterAIUtils.ts`** — 新增助手专用 AI 请求方法，支持上下文感知请求
- **`src/renderer/utils/promptTemplates.ts`** — 新增助手系统提示词模板

### 不修改（隔离原则）
- **`FieldEditor.tsx`** 现有字段级 AI 操作不修改
- **`CharacterCardEditPage.tsx`** 创意管理模块编辑器不修改
- `useCharacterAIOperations.ts` 现有 AI 操作 hook 不修改

## Impact

- **Affected specs**:
  - `add-ai-expression-generation` — 复用其 AI 请求基础设施
  - `add-ai-trait-optimization-for-image-gen` — 复用其上下文构建模式
- **Affected code**:
  - `src/renderer/components/Character/CharacterEditModal.tsx` — 增加入口按钮和面板容器
  - `src/renderer/utils/characterAIUtils.ts` — 增加助手 AI 请求方法
  - `src/renderer/utils/promptTemplates.ts` — 增加助手提示词模板
  - `src/renderer/components/Character/` — 新增组件和 hook

## ADDED Requirements

### Requirement: 悬浮助手交互面板
系统 SHALL 提供一个悬浮式智能助手面板，默认保持展开状态，外部点击不自动收回。

#### Scenario: 面板默认展开
- **WHEN** 用户通过入口按钮激活智能助手
- **THEN** 助手面板以悬浮形式展开在编辑器右侧（非模态，不遮挡编辑器操作）
- **AND** 面板默认宽度 360px，高度自适应编辑器区域（最大高度 80vh）
- **AND** 面板通过 `z-index` 层叠在编辑器上方但不阻挡编辑器交互

#### Scenario: 外部点击不收回
- **WHEN** 助手面板处于展开状态，用户点击面板外部区域
- **THEN** 面板保持展开状态，不自动收回或关闭
- **AND** 用户可通过面板右上角的关闭按钮（X 图标）手动关闭

#### Scenario: 手动控制显示状态
- **WHEN** 用户点击编辑器的"智能助手"入口按钮（RobotOutlined 图标）
- **THEN** 如面板当前关闭则展开，如已展开则关闭
- **AND** 面板显示/隐藏状态通过 `useState` 管理，不依赖外部点击事件
- **AND** 切换编辑器 Tab 或关闭编辑弹窗时自动关闭面板

### Requirement: 自然语言提问与结构化建议
系统 SHALL 支持用户通过自然语言提问获取角色卡编辑建议，并返回结构化、可操作的建议内容。

#### Scenario: 自然语言提问
- **WHEN** 用户在助手面板输入框中输入自然语言问题（如"我想给这个角色添加一个能体现她正直善良的背景，我应该怎么做？"）
- **THEN** 系统将用户问题 + 当前角色卡完整内容（所有已填字段）构建为 AI 请求上下文
- **AND** 发送请求后显示加载状态（Spin 组件 + "正在思考..." 提示文字）
- **AND** 返回的结构化建议展示在对话区，以 Markdown 格式渲染

#### Scenario: 结构化建议展示
- **WHEN** AI 返回建议内容
- **THEN** 建议内容按以下结构组织展示：
  - **建议标题**（粗体 + 图标，概括建议类型）
  - **建议说明**（详细描述建议内容）
  - **编辑建议**（具体可粘贴的文本内容，以代码块格式展示）
  - **操作建议**（建议用户如何在编辑器中执行）
- **AND** 每条建议独立展示，允许多条建议在同一响应中返回

#### Scenario: 建议类型覆盖
- **WHEN** 用户提问涉及角色设计的各个方面
- **THEN** 系统至少支持以下类型的建议：
  - 角色描述优化建议（`description` 字段优化方向）
  - 对话样例内容建议（`example_messages` 新增或修改建议）
  - 系统提示词补充建议（`system_prompt` 扩展方向）
  - 角色性格一致性建议（`personality` 与已有内容的协调性）
  - 场景设定建议（`scenario` 补充或完善）
  - 初始消息优化建议（`first_message` 改进方向）

### Requirement: 一键复制功能
系统 SHALL 支持对建议内容的任意部分进行一键复制。

#### Scenario: 复制建议内容
- **WHEN** 用户将鼠标悬停在建议卡片的代码块或建议文本上
- **THEN** 显示"复制"按钮（CopyOutlined 图标）
- **AND** 点击后复制对应内容到剪贴板
- **AND** 复制成功后显示短暂"已复制!"提示（2 秒后自动消失）
- **AND** 复制操作通过 `navigator.clipboard.writeText()` 实现

#### Scenario: 整条建议复制
- **WHEN** 用户点击建议卡片右上角的"复制全部"按钮
- **THEN** 复制该条建议的完整内容（标题 + 说明 + 编辑建议）到剪贴板
- **AND** 显示"已复制!"提示

### Requirement: 内容上下文感知
系统 SHALL 在生成建议时充分分析用户当前已输入的角色卡内容，提供相关性高的针对性建议。

#### Scenario: 上下文构建
- **WHEN** 用户发送提问
- **THEN** 系统自动收集当前角色卡所有已填字段内容（name, description, personality, scenario, first_messages, example_messages, system_prompt, post_history_instructions, creator_notes, alternate_greetings, tags, mes_example 等）
- **AND** 将字段内容 + 用户问题构建为 AI 请求的 `systemPrompt` + `userPrompt`
- **AND** 系统提示词中包含明确的角色卡结构说明，指导 AI 理解各字段含义

#### Scenario: 相关性保障
- **WHEN** AI 生成建议
- **THEN** 系统提示词要求 AI 严格基于用户已填写的角色卡内容给出建议
- **AND** 避免返回脱离角色设定的通用化建议
- **AND** 建议中应引用角色卡中的具体内容（如"根据您设定的'坚毅勇敢'性格特征..."）

### Requirement: 多轮对话能力
系统 SHALL 支持多轮对话式的建议交互，基于历史对话提供连贯的建议内容。

#### Scenario: 对话历史管理
- **WHEN** 用户连续发送多条提问
- **THEN** 系统维护当前会话的对话历史列表（`AssistantMessage[]`），包含用户问题和 AI 回复
- **AND** 每次新请求时，将最近 6 轮对话（用户+AI）作为历史上下文一同发送
- **AND** 对话历史在用户关闭面板或关闭编辑弹窗时清空

#### Scenario: 连贯建议
- **WHEN** 用户在上一轮建议基础上追问（如"这个背景故事应该怎么融入对话样例？"）
- **THEN** AI 参考上一轮对话的上下文，给出连贯的补充建议
- **AND** 避免重复已经给出过的建议内容

### Requirement: 建议内容缓存
系统 SHALL 实现建议内容的缓存机制，避免重复请求相同内容。

#### Scenario: 缓存命中
- **WHEN** 用户发送的提问与之前某次提问的语义相似度超过阈值（通过 LLM 判断）
- **THEN** 系统优先返回缓存的建议内容，不发起新 AI 请求
- **AND** 在建议上方提示"基于之前的建议"标签
- **AND** 用户可选择"重新生成"以获取新建议

#### Scenario: 缓存失效
- **WHEN** 用户修改了角色卡内容（任意字段发生变化）
- **THEN** 清空该会话的缓存
- **AND** 下次提问时重新基于最新内容生成建议

### Requirement: 加载状态与性能保障
系统 SHALL 确保助手功能不影响主编辑界面的性能，并提供适当的加载状态提示。

#### Scenario: 加载状态提示
- **WHEN** AI 请求进行中
- **THEN** 对话区显示加载指示器（Spin 组件）
- **AND** 显示"正在分析角色卡内容并生成建议..."动态提示文字
- **AND** 输入框在请求期间禁用，防止重复提交
- **AND** 支持取消进行中的请求（通过 `AbortController`）

#### Scenario: 性能保障
- **WHEN** 助手面板处于展开状态但不活跃
- **THEN** 不进行任何 AI 请求或轮询
- **AND** 面板渲染使用 `React.memo` 避免不必要的重渲染
- **AND** 对话历史列表使用虚拟列表（`react-window` 或类似方案）避免长对话卡顿
- **AND** 面板打开/关闭使用 CSS transition 动画，不触发重排

#### Scenario: 错误处理
- **WHEN** AI 请求失败（网络错误、引擎错误等）
- **THEN** 显示错误提示信息（"请求失败，请稍后重试"）
- **AND** 提供"重试"按钮
- **AND** 不丢失当前对话历史

## MODIFIED Requirements

### Requirement: CharacterEditModal 入口集成
**原实现**：`CharacterEditModal.tsx` 顶部工具栏仅有标题和关闭按钮。

**修改后**：在工具栏右侧新增"智能助手"入口按钮（RobotOutlined 图标），点击后显示/隐藏助手面板。面板在编辑器内容区域右侧以绝对定位方式悬浮，不影响编辑器 Tab 切换和内容编辑。

## REMOVED Requirements

无。本 spec 不移除任何现有功能，所有变更均为新增。

## 交付物清单

1. **可独立运行的智能助手面板模块**：`CharacterCardAssistant.tsx` + `CharacterCardAssistantPanel.tsx` + `AssistantSuggestionCard.tsx`
2. **助手核心 hook**：`useCharacterCardAssistant.ts`（状态管理 + AI 请求 + 缓存 + 多轮对话）
3. **共享类型定义**：`assistant.types.ts`
4. **集成修改**：`CharacterEditModal.tsx` 入口按钮 + 面板容器

## 验收标准

- [ ] 助手面板默认展开，外部点击不收回
- [ ] 入口按钮可手动控制面板显示/隐藏
- [ ] 自然语言提问可获取结构化建议
- [ ] 建议内容支持一键复制（单条和全部）
- [ ] 建议基于角色卡完整内容生成，相关性高
- [ ] 多轮对话保持上下文连贯性
- [ ] 缓存机制有效，相同提问不重复请求
- [ ] 加载状态提示清晰，支持取消请求
- [ ] 错误处理完善，支持重试
- [ ] 面板不影响编辑器性能（无卡顿、无额外渲染）