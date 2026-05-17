# Changelog

## [0.0.30] - 2026-05-17

### Added
- **版本链接服务 VersionLinkerService**：实现聊天版本与表格快照的统一版本管理核心服务。支持版本索引管理、变更追踪、一致性验证等功能。
  - **核心接口**：VersionLinkRecord（版本链接记录）、VersionIndex（版本索引）、ChangeLogEntry（变更日志条目）、ConsistencyReport（一致性报告）
  - **版本ID生成**：格式为 `v{YYYYMMDD_HHmmss}_{6位随机字符}`，确保唯一性
  - **版本索引管理**：通过 `version-index.json` 管理所有版本链接记录，支持读取、保存、更新一致性状态
  - **变更追踪日志**：通过 `change-log.json` 记录所有版本操作，支持按数量限制查询最新条目
  - **联动版本创建**：`createLinkedVersion()` 方法同时创建聊天版本（`versions/chat/`）和表格快照（`versions/table/`），使用相同 versionLinkId 关联，自动更新索引和变更日志
  - **一致性验证**：`verifyConsistency()` 扫描所有版本文件，交叉引用索引，检查文件存在性、时间戳差异（≤5000ms阈值），发现孤立文件
  - **目录结构**：`{userDataPath}/data/memories/chats/{characterCardName}/` 下管理 `version-index.json`、`change-log.json`、`versions/chat/`、`versions/table/`
  - **字符名清理**：使用正则 `/[<>:"/\\|?*\x00-\x1F]/g` 替换为 `_`，确保目录名安全
  - **单例导出**：`export const versionLinkerService = new VersionLinkerService()`
  - **依赖**：使用 `fs/promises` 进行异步文件操作，从 `../utils/appPath` 导入 `getUserDataPath`
  - 涉及文件：VersionLinkerService.ts（新建）

## [0.0.29] - 2026-05-12

### Fixed
- **修复关联模板信息在对话框关闭后丢失的问题**：用户关联模板后关闭对话框，重新打开时模板关联信息丢失。根因：模板关联信息仅通过IPC存储在`associations.json`中，未持久化到角色卡对话配置JSON文件中。修复方案：(1)在`characterConfig`中新增`memoryTableTemplateId`和`memoryTableTemplateName`字段；(2)`MemoryTablePanel`改为从config props获取关联信息，不再独立从IPC加载；(3)关联模板时，先调用IPC执行模板关联，再调用`updateConfig`将关联信息持久化到角色配置中；(4)在`ConfigPanel`、`CharacterDialogueChat.tsx`、`CharacterDialogueChat.hooks.ts`中传递模板关联信息；(5)`MemoryTablePanel`使用`useEffect`同步`selectedTemplate`与`associatedTemplateId`，确保重新打开对话框时回显正确。涉及文件：MemoryTablePanel.tsx、ConfigPanel.tsx、CharacterDialogueChat.tsx、CharacterDialogueChat.hooks.ts

- **在记忆表格设置面板中添加关联模板按钮**：用户在启用记忆表格时如果没有关联模板，无法正常使用表格功能。新增功能：(1)在`MemoryTablePanel`中添加"关联模板"按钮，效果与聊天记录管理中的关联按钮一致；(2)用户启用记忆表格时若未关联模板，自动弹出关联模板Modal并提示"启用记忆表格前，请先关联一个模板"；(3)按钮显示当前已关联的模板名称（未关联时显示"关联模板"）；(4)关联模板Modal中使用Select下拉框展示所有可用模板，支持更换已关联的模板；(5)新增IPC handler `memory:getAssociatedTemplate`获取当前关联的模板ID；(6)在preload.ts和类型声明中暴露`getAssociatedTemplate`和`associateTemplate` API；(7)在ConfigPanel.css中添加关联模板按钮样式（绿色未关联/蓝色已关联）。涉及文件：MemoryTablePanel.tsx、memoryHandlers.ts、preload.ts、electron.d.ts、memory.ts、ConfigPanel.css

- **【重点标记】修复AI请求50%概率卡死问题**：AI服务器请求有约50%概率卡死，根因是超时机制完全失效。分析发现：(1)`ChatEngine.ts`中`timeout: 0`（无超时限制）传送到主进程；(2)`aiHandlers.ts`中`effectiveTimeout = timeout || 0`导致超时值始终为0；(3)`if (effectiveTimeout && effectiveTimeout > 0)`条件不满足，超时定时器永不创建，`fetch()`调用在服务器响应慢时无限期挂起。修复方案：采用双层超时策略——(1)连接超时30秒（检测DNS解析、TCP连接、TLS握手问题）；(2)请求超时120秒（检测服务器响应慢问题）；(3)修改`ChatEngine.ts`默认timeout从0改为120000；(4)流式和非流式请求路径均增加连接超时和请求超时检测；(5)更新`ActiveRequest`接口增加`connectionTimeoutId`字段；(6)在取消和清理逻辑中清除连接超时定时器。涉及文件：ChatEngine.ts、aiHandlers.ts

- **修复AI Handler日志中AI完整回复内容被截断的问题**：`aiHandlers.ts` 中SSE解析成功日志将AI完整回复内容限制为前2000字符（`fullContent.substring(0, 2000)`），导致长回复无法在日志文件中查看完整内容。修复方案：移除 `substring(0, 2000)` 截断逻辑，直接输出完整 `fullContent` 到日志文件。涉及文件：aiHandlers.ts

- **【重点标记】深度排查对话功能中断问题并添加调试日志**：第一轮修复后用户反馈对话仍然无法调用AI引擎，日志在`memory:getTableData`后完全停止。排查发现：(1)备份文件存在时`autoInitializeChatSession`不会触发，返回空数据后流程中断但错误被静默吞掉；(2)`memory:autoInitializeSession` IPC handler在`memoryHandlers.ts`中已注册但未在`preload.ts`中暴露给渲染进程，导致渲染进程无法调用；(3)IPC返回数据可能存在序列化问题导致渲染进程的`await`挂起。修复方案：(1)在`requestAIResponse`函数外层添加全局try-catch包裹，确保任何未捕获异常都能被记录并更新UI错误状态；(2)在`requestAIResponse`的每个关键步骤（上下文检索→表格数据获取→提示词构建→Token管理→引擎调用）之间添加`console.log`调试日志（不依赖`addLog`的IPC通道），便于精确定位中断点；(3)在`memory:getTableData` IPC handler中添加序列化验证，确保返回数据可被正确传输；(4)在`preload.ts`中注册`autoInitializeSession` API。涉及文件：CharacterDialogueChat.hooks.ts、memoryHandlers.ts、preload.ts

- **【重点标记】实现用户首次对话自动初始化功能**：当系统检测到用户进行首次对话且尚未生成聊天记录文件和对应表格时，自动执行初始化流程。实现方案：(1)在`chatLogService.ts`中新增`autoInitializeChatSession()`方法，复用现有`associateTemplate`方法严格遵循"关联"功能的技术规范，完成模板副本创建、表格文件创建和关联关系存储；(2)修改`getTableData()`方法，在检测到表格文件不存在且备份文件也不存在时，自动调用`autoInitializeChatSession()`触发初始化，成功后递归调用自身返回新创建的表格数据；(3)在IPC层新增`memory:autoInitializeSession` handler供渲染进程主动调用；(4)在渲染进程类型声明中增加`autoInitializeSession` API类型。涉及文件：chatLogService.ts、memoryHandlers.ts、electron.d.ts、memory.ts

- **【重点标记】修复对话功能无法调用AI引擎的Bug**：用户输入信息后系统未调用AI引擎进行对话，日志在`memory:getTableData`后停止。根因：`chatLogService.getTableData()`在表格JSON文件不存在时抛出异常(`throw new Error('文件不存在')`)，导致`requestAIResponse`函数中断，后续的system prompt构建、Token管理和AI引擎调用均无法执行。修复方案：(1)将`chatLogService.ts`中`getTableData`的文件不存在异常改为返回空数据结构`{ sheets: [], headers: {}, data: {}, sheetDescriptions: {} }`，允许新对话或尚未创建表格的角色继续对话；(2)在`CharacterDialogueChat.hooks.ts`中增加记忆表格数据处理完成的确认日志和提示词构建完成的确认日志，便于后续排查类似问题。涉及文件：chatLogService.ts、CharacterDialogueChat.hooks.ts

- **【重点标记】修复用户头像存储路径错误**：avatarService.ts 使用 `process.cwd()` 作为基础路径，生成类似 `G:\AI\creative-cafe\data\user-avatars` 的绝对路径，而非正确的 `__USER_DATA__/data/user-avatars` 路径。修复方案：(1) 从 `../utils/appPath` 导入 `getUserDataPath`；(2) 将构造函数中的 `process.cwd()` 替换为 `getUserDataPath()`；(3) 头像目录现在正确设置为 `path.join(getUserDataPath(), 'data', 'user-avatars')`。涉及文件：avatarService.ts

## [0.0.28] - 2026-05-11

### Added
- **【重点标记】实现类似SillyTavern的Token管理机制**：在对话组件和业务流程中新增Token管理模块，有效监控和控制发送至AI的上下文长度，避免因上下文过长导致的响应延迟或性能下降问题。
  - **TokenCounter服务**：实现基于UTF-8字节长度的快速Token估算（UTF-8字节长度 / 3.35，与SillyTavern一致），支持消息级别Token计数、System Prompt计数、消息数组总计数。包含Token计数缓存机制（Map<messageId, tokenCount>），提升重复计算性能。涉及文件：TokenCounter.ts（新建）、types.ts（新建）
  - **ContextTruncator服务**：实现智能上下文截断算法，基于Token预算分配策略（可用预算 = 最大上下文Token数 - System Prompt Token数 - 响应预留Token数）。截断规则：(1)从最旧消息开始移除；(2)优先保留最近对话；(3)至少保留minMessagesToKeep轮对话；(4)最多保留maxMessagesToKeep条消息；(5)确保消息成对（user+assistant）。涉及文件：ContextTruncator.ts（新建）
  - **集成到对话流程**：在CharacterDialogueChat.hooks.ts的requestAIResponse()函数中，构建System Prompt后自动计算Token数并截断上下文消息。截断时记录详细日志（原始消息数、截断后消息数、Token变化、预算信息）。涉及文件：CharacterDialogueChat.hooks.ts（集成Token管理逻辑）
  - **配置支持**：扩展CharacterSessionConfig类型，新增maxContextTokens（默认6000）、reservedForResponse（默认1024）、minMessagesToKeep（默认2）、maxMessagesToKeep（默认40）字段，支持按角色自定义Token管理策略。涉及文件：CharacterDialogueChat.types.ts（类型扩展）
  - **技术实现要点**：(1)采用快速估算策略，避免浏览器端加载大型tokenizer文件；(2)Token计数包含消息格式开销（每消息4 tokens）和填充开销（3 tokens），与OpenAI API计数方式一致；(3)截断发生在System Prompt构建之后、发送给AI之前，确保关键信息（角色卡、向量检索、记忆表格）始终保留；(4)提供analyzeTruncation()方法用于分析和记录截断效果。涉及文件：TokenManagement/index.ts（模块导出）
  - **单元测试**：编写32个单元测试用例，覆盖TokenCounter和ContextTruncator的核心功能，包括：Token估算准确性、缓存管理、消息计数、截断边界情况、消息成对验证、截断分析等。所有测试通过。涉及文件：TokenManagement.test.ts（新建）

## [0.0.27] - 2026-05-11

### Fixed
- **修复模块切换时偶尔出现刷新效果的问题**：PageTransition 组件的 useEffect 依赖数组中包含了 children 参数，导致父组件每次渲染时即使 activeKey 未改变也会创建新的 React 元素引用，触发不必要的动画和组件重新挂载。修复方案：使用 useRef 缓存 children 引用，从 useEffect 依赖数组中移除 children，只在 activeKey 真正改变时才切换内容。涉及文件：PageTransition.tsx
- **【重点标记】修复清理缓存后聊天模式对话框无法打开的问题**：SingleChatDialog 组件在 characters.length === 0 时直接返回 null，而 fetchCharacters() 只在 CharacterManager 和 Dashboard 中被调用。清理缓存后角色数据尚未加载，导致点击聊天模式面板无法打开对话框。修复方案：在 SingleChatDialog 中监听 isDialogMode 变化，当对话框需要打开但角色数据为空时自动触发 fetchCharacters() 加载数据，并展示加载状态和空数据提示。涉及文件：SingleChatDialog.tsx

### Improved
- **修复 Ant Design Select 组件废弃 API 警告**：KnowledgeBaseBindingPanel 中使用了已废弃的 dropdownMatchSelectWidth 和 dropdownClassName API，替换为新的 popupMatchSelectWidth 和 classNames={{ popup: { root: 'knowledge-base-dropdown' } }} 语法。涉及文件：KnowledgeBaseBindingPanel.tsx
- **创作中心面板动态效果与纹理样式实现**：为四个模式面板（聊天/群聊/写作/游戏）分别实现独特纹理背景和动态动画效果。涉及文件：CreationCenter.css、CreationCenter.tsx

## [0.0.26] - 2026-05-10

### Improved
- **增强提示词区域分隔标记**：为system prompt中拼接的不同区域（背景知识、记忆表格、异步整理指令）添加了更清晰的分隔标记，帮助AI在长提示词场景下更准确区分不同区域，避免内容混淆。(1)使用Unicode双线框字符`═══════`作为区域分隔线，视觉区分度更高；(2)每个区域添加【区域 N：XXX】标题和【区域 N 结束】尾部标记，明确区域边界；(3)标题中附带说明文字，如"仅供参考，不是对话的一部分"、"以下为系统指令，不是对话内容"，帮助AI理解数据性质；涉及文件：PromptBuilder.ts

## [0.0.25] - 2026-05-10

### Improved
- **【重点标记】异步整理指令架构优化**：将完整的表格整理指令从user消息迁移回system提示词，提高AI生成tableEdit标签的稳定性。(1)**system prompt**：通过`buildFinalSystemPrompt`追加完整的`buildAsyncTableOrganizeInstructions`指令，包含表格模板结构、分类判断规则、增量更新策略等全部内容；(2)**user message**：仅拼接固定简短命令`\n\n然后进行表格整理`，作为触发AI执行整理的信号。这样AI在system prompt中看到完整指令，在user message中收到明确任务信号，双重保障tableEdit标签的生成稳定性。涉及文件：PromptBuilder.ts、CharacterDialogueChat.hooks.ts

## [0.0.24] - 2026-05-10

### Added
- **预览表格支持编辑和清空功能**：在表格预览弹窗中新增三项核心功能，满足用户自行修改或重新整理的需求。(1)**单元格内联编辑**：点击任意单元格即可进入编辑模式，支持回车确认或失焦自动保存；(2)**保存修改**：将当前表格的编辑结果持久化到JSON文件；(3)**清空当前表格**：清空当前选中表格的所有数据（带二次确认）；(4)**清空所有表格**：清空所有表格的数据（带二次确认，红色危险按钮）；涉及文件：TablePreviewModal.tsx

## [0.0.23] - 2026-05-10

### Improved
- **增强异步整理提示说明**：在参数面板的异步整理Tooltip中新增"延时"说明，明确告知用户"整理触发延时一回合（即第5条对话整理的是第3条对话的信息）"，帮助用户理解异步整理的工作机制——AI实际整理的是发送指令前的一条文本，而非后续生成的文本。涉及文件：MemoryTablePanel.tsx

## [0.0.22] - 2026-05-10

### Improved
- **增强所有表格的分类判断规则**：为时空表格、社交表格、事件表格添加明确的分类判断标准和关键示例，帮助AI正确区分实体类型并放入对应表格。具体改进：(1)时空表格：明确只记录时间/地点，不包括角色行为或物品，添加日期/地点示例；(2)社交表格：区分日常互动与重大事件，添加互动/汇报示例；(3)事件表格：区分重大事件与日常社交，添加犯罪/案件/日常活动对比示例；(4)统一使用"分类判断"格式和关键示例格式，与角色表格、物品表格保持一致。涉及文件：PromptBuilder.ts

## [0.0.21] - 2026-05-10

### Fixed
- **【重点标记】修复隐藏的tableEdit标签露出问题**：异步整理模式下tableEdit标签未被正确从显示内容中移除，导致用户在对话界面中看到技术标签。根本原因：使用indexOf进行精确字符串匹配定位标签位置失败（因AI生成的空白字符变体导致），备用正则方案也不够全面。修复方案：(1)移除不可靠的indexOf匹配定位逻辑；(2)直接使用连续正则替换移除所有可能的标签格式；(3)简化代码流程，避免分支逻辑导致的遗漏。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.20] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理模式缺少表格模板结构信息问题**：异步整理模式下AI只收到当前表格数据，没有表格模板结构（表头定义），导致无法正确理解要提取哪些字段。修复方案：(1)修改buildFinalSystemPrompt、buildSystemPrompt接受tableStructure参数；(2)修改buildAsyncTableOrganizeInstructions使用tableStructure生成【表格模板结构】段落，包含每个表格的名称、字段结构和需要提取的字段；(3)在CharacterDialogueChat.hooks.ts中从tableResult提取sheets和headers结构传递给异步指令；(4)如果模板为空则发送默认模板结构（时空/角色/社交/物品/事件五个表格）作为备用。涉及文件：PromptBuilder.ts、usePromptBuilder.ts、CharacterDialogueChat.hooks.ts
- **【重点标记】修复异步整理模式表格描述缺失导致信息分类错误问题**：AI无法区分各表格用途，将物品错误放入角色表格。修复方案：(1)修改getTableData返回sheetDescriptions字段（从关联模板提取各表格description）；(2)tableStructure新增descriptions字段；(3)在PromptBuilder.ts中生成表格模板结构时追加"表格用途"行；(4)默认模板备用方案也追加用途描述。涉及文件：chatLogService.ts、CharacterDialogueChat.hooks.ts、PromptBuilder.ts、usePromptBuilder.ts

## [0.0.19] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理模式AI生成错误表格格式问题**：异步整理指令buildAsyncTableOrganizeInstructions()过于简略，AI缺少表格格式、增量更新策略和唯一ID策略等关键规则约束，导致生成扁平化数据而非标准tableEdit命令。修复方案：将异步整理指令替换为与同步模式buildAIPromptForProgressive()完全一致的详细规则，包括：(1)详细的tableEdit命令格式说明和参数解释；(2)完整的增量更新决策流程；(3)唯一ID策略与变体称呼识别规则；(4)错误格式示例（绝对禁止）；(5)输出要求清单。涉及文件：PromptBuilder.ts

## [0.0.18] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理模式表格文件不存在导致命令执行失败问题**：异步模式下executeTableEditCommands方法执行前表格JSON文件可能尚未创建，导致insertRowToTable/readJsonFile返回null。修复方案：(1)在executeTableEditCommands开头添加文件存在性检查；(2)使用与tableTemplateService完全一致的safeChatId计算方法（统一替换规则：/\s+/g, /@/g, /-/g等12种特殊字符）；(3)文件不存在时优先使用关联模板创建初始文件，若无关联模板则使用默认模板；(4)修复memoryHandlers.ts中缺失的tableEditParser导入。涉及文件：chatLogService.ts、memoryHandlers.ts

## [0.0.17] - 2026-05-10

### Added
- **动态tableEdit指令拼接机制**：根据用户选择的整理模式（sync/async）在任务说明中动态拼接tableEdit相关指令。参考用户成功做法（在任务说明中直接告知AI需要生成tableEdit），实现：(1)修改buildDialoguePrompt和buildContinuationPrompt支持organizeMode参数；(2)异步模式提示"系统将在提示词末尾提供详细的表格整理指令"；(3)同步模式提示"请在回复最后生成tableEdit标签，格式为<!-- <tableEdit> ... </tableEdit> -->"；(4)未选择整理模式时不拼接任何tableEdit指令，保持纯净的角色扮演提示词。涉及文件：PromptBuilder.ts、usePromptBuilder.ts

## [0.0.16] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理功能AI未返回tableEdit指令问题**：增强异步整理指令的约束力，在PromptBuilder.ts的buildAsyncTableOrganizeInstructions()函数中添加：(1)开头新增【强制要求-MANDATORY】段落，强调必须生成tableEdit标签；(2)在输出顺序中增加第3步"最终确认"要求AI检查是否已包含标签；(3)在指令末尾添加【最终提醒】强制要求生成标签。通过多重强调提高AI遵守指令的概率。涉及文件：PromptBuilder.ts

## [0.0.15] - 2026-05-10

### Added
- **仪表盘使用技巧内容更新**：基于系统技术文档（01-09模块文档）编写了10条完整的系统使用指南，覆盖系统导航说明、AI引擎配置、世界书编辑、角色卡创作测试闭环、对话测试技巧、知识库语义检索、用户人设管理、效率提升技巧、数据安全说明、典型工作流推荐。Tips存储在 `data/tips.json`，通过 `file:readJson` IPC读取并在仪表盘Carousel组件中轮播展示。涉及文件：data/tips.json、doc/01-dashboard-module.md

## [0.0.14] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理竞态条件**：将内容清理逻辑从setState之后移至之前执行，统一使用displayContent作为最终显示内容，避免带标签内容被保存到localStorage的竞态风险。涉及文件：CharacterDialogueChat.hooks.ts

### Improved
- **增强正则表达式兼容性**：支持3种tableEdit标签格式匹配（标准HTML注释+标签、纯标签、注释分隔格式），提升对AI变体输出的容错能力。涉及文件：CharacterDialogueChat.hooks.ts
- **增强IPC调用诊断**：添加chatId非空验证、解析错误详情输出、执行结果统计信息记录，便于问题排查。涉及文件：CharacterDialogueChat.hooks.ts
- **异步整理后自动刷新表格数据**：命令执行成功后主动调用getTableData刷新memoryTableDataRef，确保后续对话使用最新表格上下文。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.13] - 2026-05-10

### Improved
- **【重点标记】优化异步整理提示词 - Token减少20-30%且功能完整**：重构了异步整理指令的提示词结构，新建 `buildAsyncTableOrganizeInstructions()` 函数，在保持与同步整理相同功能覆盖的前提下，精简token消耗。关键优化点：(1)合并重复说明，去除冗余描述；(2)精简示例输出，保留核心格式约束；(3)突出输出顺序要求，明确标签必须位于回复文本最后；(4)保留核心策略：增量更新、唯一ID、变体称呼识别、重复检测；(5)明确标签格式 `<!--  <tableEdit>` 开头、`</tableEdit> -->` 结尾。涉及文件：PromptBuilder.ts

## [0.0.12] - 2026-05-10

### Fixed
- **【重点标记】修复异步整理功能提示词未正确拼接问题**：修复了当表格数据为空时，异步整理指令不会被追加到提示词末尾的问题。将 `PromptBuilder.ts` 中异步整理指令的追加条件从 `organizeMode === 'async' && memoryTableData && memoryTableData.trim()` 修改为仅依赖 `organizeMode === 'async'`，并在表格数据为空时提示AI创建新表格。涉及文件：PromptBuilder.ts
- **增强异步整理日志记录**：在 `CharacterDialogueChat.hooks.ts` 中增加了详细的日志记录，包括进入异步整理模式、正则匹配结果、解析结果等，便于追踪问题。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.11] - 2026-05-10

### Added
- **【重点标记】实时整理表格功能增强 - 异步整理模式**：在"开启实时整理表格"按钮下方新增"同步整理"和"异步整理"两个互斥选项，实现AI在回复对话内容后隐式包裹tableEdit命令，系统自动解析执行而不影响用户可见的对话内容。
  - **UI交互优化**：在MemoryTablePanel.tsx中新增Radio.Group组件，提供同步/异步整理模式切换，默认选中"同步整理"，关闭实时整理时自动重置为同步模式。涉及文件：MemoryTablePanel.tsx
  - **提示词注入逻辑**：在PromptBuilder.ts的buildFinalSystemPrompt方法中，当organizeMode='async'时追加异步整理指令，明确要求AI使用`<!--  <tableEdit>`开头、`</tableEdit> -->`结尾的隐式标签包裹tableEdit命令。涉及文件：PromptBuilder.ts
  - **回复解析执行**：在CharacterDialogueChat.hooks.ts的onComplete回调中，使用正则表达式`/<!--\s*<tableEdit>([\s\S]*?)<\/tableEdit>\s*-->/gi`检测并提取标签内容，使用IIFE包裹异步解析逻辑避免回调中使用await，解析后自动执行表格命令并清理对话内容。涉及文件：CharacterDialogueChat.hooks.ts
  - **IPC通信扩展**：在memoryHandlers.ts中新增`memory:parseTableEdit` handler暴露表格解析功能，在preload.ts中新增`parseTableEdit`方法供渲染进程调用。涉及文件：memoryHandlers.ts、preload.ts
  - **技术实现要点**：(1)标签格式严格遵循`<!--  <tableEdit>`开头（含两个空格），`</tableEdit> -->`结尾；(2)解析器期望标准格式`<tableEdit><!-- commands --></tableEdit>`，因此提取后需重新包装；(3)对话内容清理后确保用户界面不显示标签部分；(4)完善的错误处理和日志记录。

## [0.0.10] - 2026-05-10

### Changed
- **【重点标记】表格整理功能重构 - 实时整理与完全整理拆分**：将当前单一的表格整理功能拆分为两个独立模块，解决了重复触发、功能混杂、缺乏防抖等问题。
  - **新增整理锁机制**：在chatLogService.ts中新增organizingLocks Map，实现canStartOrganize、setOrganizingLock、releaseOrganizingLock方法，防止并发整理和重复触发。涉及文件：chatLogService.ts
  - **重构实时整理方法**：修改processChatProgressive方法，添加防抖检查（默认3000ms最小间隔），仅处理新增消息（增量更新），日志标识改为[Auto Organize]。涉及文件：chatLogService.ts
  - **新增完全整理方法**：新增processChatFull方法，清空表格数据并重新处理所有消息，带有完整的错误处理和回滚机制，日志标识改为[Full Reorganize]。涉及文件：chatLogService.ts
  - **新增IPC Handler**：在memoryHandlers.ts中新增memory:processChatFull IPC handler，修改memory:processChatProgressive使用新的options参数。涉及文件：memoryHandlers.ts
  - **更新Preload API**：在preload.ts中更新processChatProgressive API签名，新增processChatFull API暴露给渲染进程。涉及文件：preload.ts
  - **增强前端防抖**：在CharacterDialogueChat.hooks.ts中将实时整理的防抖延迟从500ms增加到2000ms，并使用新的options参数。涉及文件：CharacterDialogueChat.hooks.ts
  - **拆分前端调用逻辑**：在ChatManager.tsx中，当restart=true时使用processChatFull API进行完全整理，否则使用processChatProgressive API进行实时整理。涉及文件：ChatManager.tsx
  - **新增OrganizeOptions接口**：定义整理选项接口，包含continueFromLast（是否从上次位置继续）和minInterval（最小间隔时间）参数。涉及文件：chatLogService.ts

## [0.0.9] - 2026-05-10

### Changed
- **【重点标记】强化提示词和去重机制 - 消除表格重复记录**：针对物品表格等内容管理中出现的重复记录问题，全面优化了AI提示词和后端去重逻辑，确保所有表格数据更新操作的准确性和有效性。
  - **增强表格上下文唯一ID索引**：在buildTableContext方法中新增"唯一ID快速查找索引"，为AI提供唯一ID到行号的快速映射，便于AI快速定位需要更新的记录。涉及文件：chatLogService.ts（buildTableContext方法）
  - **强化AI提示词重复检测策略**：在buildAIPromptForProgressive方法中新增"强制重复性检查"流程，包含4步检查法；新增"名称相似度匹配"规则，明确物品名/角色名/描述内容高度相似时也应使用updateRow；新增"重复检测特殊场景处理"段落，提供3个具体的重复记录合并示例。涉及文件：chatLogService.ts（buildAIPromptForProgressive方法）
  - **增强输出要求**：新增3条输出要求，包括重复检测、合并重复记录、操作结果确认，要求AI在生成命令后说明每个操作的目的。涉及文件：chatLogService.ts（buildAIPromptForProgressive方法）
  - **实现名称相似度去重算法**：在executeTableEditCommands方法中新增基于Levenshtein编辑距离的名称相似度检测，当检测到名称相似（相似度>70%）的记录时，自动将insertRow转换为updateRow。新增isSimilarName和levenshteinDistance两个辅助方法。涉及文件：chatLogService.ts（executeTableEditCommands方法、isSimilarName方法、levenshteinDistance方法）
  - **双重去重保障**：现在系统具有双重去重机制：(1) AI层面的提示词引导去重；(2) 后端执行时的唯一ID匹配+名称相似度匹配去重。确保即使在AI误判的情况下，后端也能自动纠正并避免重复插入。

## [0.0.8] - 2026-05-10

### Changed
- **【重点标记】修复角色对话实时整理表格功能 - 实现真正的增量更新**：修复了实时整理表格功能中存在的重复插入、上下文不清晰、缺乏去重保护等问题。现在表格整理功能通过对比当前表格内容与最新信息，执行精确的增删改操作，确保表格数据准确反映最新状态。
  - **优化表格上下文格式**：将buildTableContext方法生成的表格数据从JSON格式改为清晰的"行N: 字段=值"格式，添加表格索引和行索引标识，便于AI理解现有数据结构并生成正确的updateRow/deleteRow命令。涉及文件：chatLogService.ts（buildTableContext方法）
  - **增强AI提示词增量更新策略**：在buildAIPromptForProgressive方法中新增"增量更新策略"段落，明确说明这是增量更新而非从头整理，添加去重检查规则和增量更新决策流程，强调已存在实体必须使用updateRow而非insertRow。涉及文件：chatLogService.ts（buildAIPromptForProgressive方法）
  - **添加命令执行前去重检查**：在executeTableEditCommands方法中，执行insertRow命令前先读取当前表格数据，检查唯一ID是否已存在。如果已存在则自动转换为updateRow操作，避免重复插入。涉及文件：chatLogService.ts（executeTableEditCommands方法）
  - **实现操作回滚机制**：在processChatProgressive方法中，处理开始前备份当前表格数据，出现严重错误时自动回滚到备份状态，保持表格数据一致性。涉及文件：chatLogService.ts（processChatProgressive方法）
  - **修复行索引显示问题**：修正了日志输出中行索引的显示，确保显示1-based的人类可读行号（rowIndex + 1）。

## [0.0.7] - 2026-05-10

### Added
- **【重点标记】记忆表格支持功能**：在角色对话配置面板中新增"记忆表格设置"板块，位于"向量化设置"与"AI参数配置"之间。包含两个开关："是否启用"（启用后在对话提示词中整合记忆管理模块的表格数据）和"是否实时整理表格"（启用后每次对话完成后自动触发表格整理操作）。新增组件：MemoryTablePanel.tsx。类型扩展：CharacterSessionConfig 新增 memoryTableEnabled 和 memoryTableAutoOrganize 字段，新增 MemoryTableConfig、MemoryTableSheet、MemoryTableData 接口。PromptBuilder.ts 支持将格式化的表格数据追加到系统提示词中。配置支持持久化保存。涉及文件：CharacterDialogueChat.types.ts（新增类型）、MemoryTablePanel.tsx（新建）、ConfigPanel.tsx（集成新面板）、ConfigPanel.css（新增样式）、CharacterDialogueChat.hooks.ts（表格数据获取、自动整理触发）、PromptBuilder.ts（整合表格数据）、CharacterDialogueChat.tsx（主组件集成）

### Changed
- **【重点标记】AI请求日志打印完整提示词入参**：修复了 `console.debug` 打印请求体时 DevTools 以 `... more characters` 形式截断长字符串的问题。改为逐条打印 messages 数组的 role 和内容预览（前200字符），同时将完整 JSON 写入日志文件。涉及文件：aiHandlers.ts（优化请求体日志输出）
- **【重点标记】修复记忆表格数据结构读取错误**：修正了 `CharacterDialogueChat.hooks.ts` 中读取 `memory.getTableData` 返回数据的逻辑。原代码错误地将 `sheets`（string[]）当作对象数组遍历（访问 `sheet.sheetName` 等），导致记忆表格数据始终为空。同时移除了50行输出限制。涉及文件：CharacterDialogueChat.hooks.ts（修复两处数据读取逻辑）
- **【重点标记】修复记忆表格数据路径不匹配问题**：表格整理功能使用 `characterCardName`（如"狼人杀助手2.0"）保存文件，但 hooks 使用 `characterCardId`（完整图片路径）读取文件，导致文件找不到。现在统一使用 `characterCardName` 进行读取。涉及文件：CharacterDialogueChat.hooks.ts（修复 requestAIResponse 和 fetchMemoryTableData 两处）
- **【重点标记】修复记忆表格数据读取映射错误**：表格数据在 JSON 文件中使用数字索引（"0", "1", "2"等）存储，但前端错误地尝试使用列标题（"流水号", "角色名"等）访问。现已修正为使用数字索引映射（headers[0] → row["0"], headers[1] → row["1"]等）。涉及文件：CharacterDialogueChat.hooks.ts
- **【重点标记】修复实时整理表格路径错误**：实时整理表格功能同样使用了错误的 `characterCardId`（完整图片路径）而非 `characterCardName`（角色卡名称），导致找不到聊天记录文件。现已修正。涉及文件：CharacterDialogueChat.hooks.ts（修复 onComplete 回调）
- **【重点标记】修复表格整理断点续传进度计算错误**：断点续传模式下（如从第4条消息开始处理9条消息），进度百分比错误地按绝对位置计算（显示44%而非实际的1/6=17%）。修复后进度百分比基于"已处理数/当前批次待处理总数"计算，处理详情仍保留绝对消息编号（4/9）。涉及文件：chatLogService.ts（processChatProgressive 方法）
- **【重点标记】修复 memory:getTableData IPC handler 日志输出**：优化了 `memoryHandlers.ts` 中 `memory:getTableData` 的日志输出，详细记录返回的数据结构摘要（sheets、headersKeys、dataKeys），便于调试表格数据传递问题。涉及文件：memoryHandlers.ts
- **【重点标记】增强全链路诊断日志**：在 CharacterDialogueChat.hooks.ts 的 requestAIResponse 和 fetchMemoryTableData 中添加了详细的调试日志（console.log），追踪 memoryTableEnabled 状态、使用的 chatId、tableResult 内容等。涉及文件：CharacterDialogueChat.hooks.ts

## [0.0.6] - 2026-05-09

### Added
- **【重点标记】世界书关键词匹配引擎**：实现基于关键词匹配的世界书条目激活功能。支持主关键词（key）、次关键词（keysecondary）、备用关键词（keys、secondary_keys）。支持 selective 模式（主+次关键词同时匹配）、概率过滤（probability）、完整单词匹配、不区分大小写、group 排序权重等完整 SillyTavern 兼容特性。对话时同时执行向量检索和关键词匹配，两种结果合并注入提示词。涉及文件：WorldBookKeywordMatcher.ts（新建）、worldBookService.ts（新增matchKeywords）、ContextManager.ts（新增retrieveContextWithKeywords）、preload.ts（新增worldbook IPC）、electron.d.ts（新增类型定义）、CharacterDialogueChat.hooks.ts（改用综合检索API）

## [0.0.5] - 2026-05-09

### Changed
- **【重点标记】对话系统提示词拼接逻辑重构——统一由PromptBuilder管理**：将对话系统中的提示词拼接逻辑完全统一由PromptBuilder模块管理。hooks中移除了手动的提示词拼接代码，改为调用usePromptBuilder Hook提供的buildCompleteSystemPrompt方法。PromptBuilder.ts中为每个拼接步骤添加了明确的注释（第一步→第六步），标明每个步骤的数据来源。涉及文件：PromptBuilder.ts（重构注释）、usePromptBuilder.ts（新增buildCompleteSystemPrompt）、CharacterDialogueChat.hooks.ts（简化拼接逻辑）

## [0.0.4] - 2026-05-09

### Changed
- **【重点标记】对话系统界面优化——向量化设置重构**：将知识库绑定功能从独立面板收纳到"向量化设置"区域中。"向量化设置"与"AI参数配置"同级排列。向量化面板支持折叠/展开切换，知识库绑定作为其内部内容展示。涉及文件：VectorizationPanel.tsx（新建）、KnowledgeBaseBindingPanel.tsx（移除自身折叠逻辑）、ConfigPanel.tsx（更新布局）、ConfigPanel.css（新增向量化面板样式）

## [0.0.3] - 2026-05-09

### Changed
- **【重点标记】对话系统界面优化——可折叠面板**：右侧配置栏的"知识库绑定设置"和"AI参数配置"模块重构为可折叠式组件。默认展开状态，点击标题栏切换折叠/展开。折叠时仅显示标题栏，展开时完整显示设置项。折叠状态通过localStorage持久化记忆。涉及文件：KnowledgeBaseBindingPanel.tsx、ParameterPanel.tsx、ConfigPanel.css
- **【重点标记】对话系统提示词构建逻辑重构**：将对话功能中的提示词构建过程提取为独立的逻辑文件。创建PromptBuilder.ts作为核心提示词构建模块，包含buildDialoguePrompt、buildContinuationPrompt、buildCharacterContext、buildPersonaSection等函数。创建usePromptBuilder.ts作为React Hook封装层，提供buildDialoguePrompt、buildContinuationPrompt、buildFinalPrompt等方法。CharacterDialogueChat.hooks.ts简化为调用usePromptBuilder，CharacterDialogueChat.utils.ts改为从PromptBuilder重新导出以保持向后兼容。涉及文件：PromptBuilder.ts（新建）、usePromptBuilder.ts（新建）、CharacterDialogueChat.hooks.ts、CharacterDialogueChat.utils.ts

### Added
- 可折叠面板折叠/展开指示图标（▼/▶）
- AI参数配置模块折叠时的自定义参数指示器（紫色小圆点）
- 知识库绑定数量标签显示

## [0.0.2] - 2026-05-02

### Fixed
- **【重点标记】修复向量测试模块WASM交互问题**：修复了VecstoreVectorStore.search()方法中WASM query()不返回metadata导致向量测试显示空结果的问题。通过引入元数据缓存机制，从metadataCache中补全搜索结果的完整元数据信息，确保相似性查询和向量查看功能正常工作
- **【重点标记】修复世界书条目分片串行问题**：重构了DocumentProcessorService.chunkText()方法，实现智能分块策略。世界书JSON文件按条目分块（每个条目一个完整分块，不分割），其他文档保持500字符分块标准。涉及文件：DocumentProcessorService.ts（新增chunkWorldBookEntries、chunkStandardText、isWorldBookFormat方法）
- 修复了向量维度不匹配问题（expected 384, got 4096），实现了动态维度支持
- 修复了元数据持久化问题，实现双文件存储机制（vecstore.json + vecstore_metadata.json）
- 修复了addBatchNoPersist方法未同步更新元数据缓存的问题

### Added
- 实现了元数据缓存机制（metadataCache），解决WASM query不返回metadata的根本问题
- 实现了启动时从文件加载元数据的功能
- 增加了详细的日志输出，便于调试向量存储相关问题
- 添加JSON文件类型支持，用于世界书JSON文件处理

### Changed
- **【重点标记】知识库版本字段替换为向量存储模式**：将知识库的"版本"(version)字段完全替换为"向量存储模式"(vectorStoreMode)字段，用于区分JSON向量和VecStore存储向量。移除了版本控制相关功能（版本历史、版本恢复），简化了知识条目管理逻辑。涉及文件：KnowledgeItem接口定义、KnowledgeBaseService、KnowledgeBaseManager UI组件、preload.ts IPC API、electron.d.ts类型定义
- **【重点标记】世界书向量化功能重构**：改进世界书向量化处理逻辑，以entries数组中的每个条目为基本单位进行拆分。每个条目向量包含完整字段信息（name、key、keysecondary、keys、secondary_keys、comment、content）。**description字段不再参与向量化**，仅作为元数据引用存储在条目元数据中。明确区分JSON存储和VecStore存储的差异，确保符合VecStore的存储规范。涉及文件：worldBookService.ts
- **【重点标记】文档分块策略优化**：DocumentProcessorService实现智能分块，世界书JSON按条目分块，其他文档按500字符分块

## [0.0.1] - 2026-04-04

### Added
- 实现了配置管理功能，包括API连接配置、模型参数、高级设置和模板管理
- 支持文本补全模式和聊天补全模式的配置
- 为每个参数添加了详细的问号提示，包含功能说明、影响分析和建议值范围
- 实现了配置的导入/导出功能
- 实现了Prompts数组的动态管理，支持添加、删除和查看prompts项
- 解决了{{}}格式通配符的显示问题

### Fixed
- 修复了导入配置导致白屏的问题
- 修复了导入配置时配置名称没有将文件名回显的问题
- 修复了缺少图标导入的问题

### Changed
- 优化了表单的布局和样式
- 提高了应用的稳定性和可靠性
