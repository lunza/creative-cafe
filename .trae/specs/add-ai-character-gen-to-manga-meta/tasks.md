# Tasks

- [x] Task 1: 类型契约 + IPC 通道（地基）
  - [x] 1.1 `src/shared/types/writing-v2.types.ts`：新增 `V2MangaCharacterGenResult { success; charactersText?; cancelled?; error? }`；`V2MangaAPI` 新增 `generateCharacterInfo(params: { imagePath; summaries?; mangaMeta?; currentCharacters?; customPrompt? })`；`cancel` key 联合类型扩展 `'generateCharacterInfo'`
  - [x] 1.2 `src/main/services/manga/MangaParsingService.ts`：新增 `generateCharacterInfo` 方法（见 Task 2 细则，可先占位签名）
  - [x] 1.3 `src/main/ipc/handlers/mangaHandlers.ts`：注册 `manga:generateCharacterInfo` handler（入参校验：imagePath 非空；错误捕获 + addLog）；`manga:cancel` 的 key 类型扩展
- [x] Task 2: 主进程 AI 生成服务 `MangaParsingService.generateCharacterInfo`
  - [x] 2.1 AbortController 注册 key `generateCharacterInfo`（复用 `cancelControllers`），fetch 传 signal；abort → `{ success:false, cancelled:true, error:'用户已停止' }`
  - [x] 2.2 入参处理：校验图片存在与大小（复用 MAX_FILE_SIZE=8MB 判定）；读取 AI 配置（`aiConfigProvider.getAIConfig({ defaultTransmission:'header' })`）与引擎运行时参数（`getEngineRuntimeConfig`）
  - [x] 2.3 图片 → base64 data URI（扩展名 mime 映射复用 analyzePage 的 mimeMap 模式）
  - [x] 2.4 构建 system prompt：角色视觉特征识别指令（姓名/定位/外貌特征/性格特点，图片优先）+ `buildContextTable(summaries)` 整体分析上下文（summaries 非空时）+ 漫画背景信息（mangaMeta 中文标签注入，复用现有 label 映射）+ 已有角色文本 currentCharacters（要求整合保留有效信息，不盲目丢弃）+ `withCustomPrompt` 末尾注入
  - [x] 2.5 输出 JSON 契约 `{ characters: [{ name, role, appearance, personality }] }`；`parseJsonFromContent` 容错解析；格式化为每角色一行文本（`姓名（定位）：外貌；性格`，定位缺省省略括号）；空结果守卫；`finish_reason=length` 截断提示
  - [x] 2.6 超时控制：120s 定时器触发 abortController.abort()（区分超时/用户取消，超时返回「AI 分析超时，请重试或减少图片大小」）；错误路径对齐 analyzePage（未配置引擎 / HTTP 非 200 / 空内容 / JSON 异常 / 网络失败）
- [x] Task 3: 弹窗 UI（V2MangaMetaModal.tsx）
  - [x] 3.1 新 props：`supportsVision?: boolean`、`comicSummaries?: MangaPageSummary[]`（缺省安全）
  - [x] 3.2 图片上传区：`window.electronAPI.file.selectFile` 文件过滤（jpg/jpeg/png/webp/bmp）；扩展名 + 8MB 大小校验（前端校验与主进程提示一致）；`file.readAsBase64` 生成 data URI 缩略图预览；重新选择/移除操作；读取失败 message.error
  - [x] 3.3 「AI 生成角色信息」按钮：`disabled = !imagePath || !supportsVision || loading`；不支持视觉时 title 提示；旁边挂 `CustomPromptPopover`（唯一 storageKey，如 `v2manga_meta_character_custom_prompt`）
  - [x] 3.4 生成流程：`readCustomPrompt(key) || undefined` 透传；loading 中按钮切 danger「停止生成」（调 `getWritingV2API()?.manga.cancel('generateCharacterInfo')`）；`cancelled=true` → message.info「已停止」；成功 → `form.setFieldValue('characters', charactersText)` + message.success；失败 → message.error(真实错误文本)；状态用 useRef 防重入（React state 不能做并发控制）
  - [x] 3.5 「主要角色」TextArea maxLength 500 → 2000；现有回填（setFieldsValue）/保存（handleOk trim）逻辑不变
- [x] Task 4: 父组件接入（V2MangaStage.tsx）
  - [x] 4.1 复用组件顶层已有派生数据 `summaries`（464 行 `analyzedPages.map(analysisToSummary)`，early return 之前，两分支均可用），无需新增 buildAllSummaries
  - [x] 4.2 两处 `<V2MangaMetaModal>`（新建/编辑入口）传入 `supportsVision={!visionUnsupported}` 与 `comicSummaries={summaries}`
- [x] Task 5: 验证 + 文档
  - [x] 5.1 `npm run typecheck` 零错误（本次 6 个变更文件零错误；完整日志无 manga/writing-v2/preload 匹配项，其余均为预存无关错误）
  - [ ] 5.2 运行时验证（部分完成）：Vite 确认运行中、Electron 已重启生效（主进程改动，启动日志无异常）；编辑模式完整链路 / 停止按钮 / 无 vision 禁用态 / 新建模式无上下文生成 等 UI 交互链路待用户实测
  - [x] 5.3 `CODE_WIKI.md` Phase 10 末尾新增功能条目（标注验证状态）；`CHANGELOG.md` 顶部新增条目

# Task Dependencies

- Task 2 依赖 Task 1（类型与签名）
- Task 3 依赖 Task 1/2（IPC 可用）
- Task 4 依赖 Task 3（props 定义）
- Task 5 依赖全部前置任务
- 按 AGENTS.md 约定：全部任务在主对话直接完成，不启动子代理
