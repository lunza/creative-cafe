# Tasks

## 服务端（src/main/services/lanApiServer/）

- [x] Task 1: LAN 会话配置存储与接口
  - [x] 新增 `sessionConfigStore.ts`：每角色 JSON 持久化（`{userData}/data/lan-session-config/<hash>.json`），字段对齐 spec R1（selectedPersonaId / customParameters 子集 / boundKnowledgeBaseIds / memoryTableEnabled / image_gen 相关），读缺省兜底 + 原子写
  - [x] `GET/PUT /api/chats/:id/session-config`（PUT 白名单字段校验，非法值 400 VALIDATION_ERROR）
  - [x] `GET /api/personas`（复用 avatarService 扫描人设 JSON，映射 avatarUrl）+ `GET /api/personas/:id/avatar`（二进制/404）
  - [x] 验证：curl 读取默认值 → PUT 修改 → 再读一致；重启后配置保留
- [x] Task 2: 对话管线增强（人设 + 参数）
  - [x] dialogue.ts 读取会话配置：注入用户人设段（复用 PromptBuilder 人设构建，userName 由 'User' 改为人设名/缺省回退）
  - [x] 参数生效：temperature/top_p/max_tokens（会话值优先，引擎值回退）、language 约束注入、min_response_chars 字数下限注入、expression_display=false 时不注入表情提示（且不解析情绪）、自定义停止序列合并（对齐 buildStopSequences 扩展参数）
  - [x] 验证：curl SSE 对照日志中的请求体与系统提示词（人设段/字数约束/语言约束存在性）
- [x] Task 3: RAG 注入
  - [x] 对话历史 RAG：历史条数超阈值时调用 chatHistory 检索服务（对齐桌面端阈值与 topK），注入系统提示词「本会话相关历史片段」区域
  - [x] 知识库绑定检索：boundKnowledgeBaseIds 非空时调用 context 检索服务，注入知识库区域
  - [x] 两类检索均 try-catch 跳过（失败不阻塞对话，日志 warn）
  - [x] 验证：构造超阈值历史 + 绑定知识库，日志确认注入；断开 embedding 场景对话仍正常
- [x] Task 4: 记忆表格（注入 + 编辑指令 + 查看端点）
  - [x] memoryTableEnabled=true 时读取表格数据注入系统提示词（格式对齐桌面端 MemoryTableProvider）
  - [x] AI 回复含表格编辑指令时：剥离指令文本 → 复用 memoryService parse/execute → 刷新表格 → SSE 推送 `table` 事件；解析失败忽略
  - [x] `GET /api/chats/:id/memory-table`（sheets/headers/rows；未启用返回 enabled:false 空结构）
  - [x] 验证：curl 触发 AI 输出编辑指令场景，二次 GET 表格确认已变更、SSE 含 table 事件
- [x] Task 5: headless 图片生成
  - [x] 新增 `imageGeneration.ts`：读角色 traits.json + LoRA 清单（含权重）→ 父消息 emotion 动态表情标签（EMOTION_PROMPT_MAP + 冲突 tag 过滤，对齐 §7.43）→ interaction 分类权重提升 → SD 配置/状态检查 → generateTxt2Img → asset 落盘 → 更新消息 imageAttachment（history 追加/快照 usedTags/usedPrompt/usedLoras）→ 持久化
  - [x] `POST /api/chats/:id/messages/:messageId/image`（regenerate 参数；SD 超时/失败结构化错误码，imageAttachment status='error' 不损旧 history）
  - [x] `GET /api/assets/:characterId/:assetId`（白名单校验防穿越，PNG 二进制）
  - [x] ai_optimize_traits 不移植：请求携带该开关时响应标记 unsupported（文档注明）
  - [x] 验证：curl 首次生成/重新生成（history+1）/SD 停机错误路径/素材读取/穿越攻击 404

## 客户端（android-client/）

- [x] Task 6: 类型与 API 层扩展
  - [x] types.ts：SessionConfig / PersonaSummary / ImageAttachment / MemoryTableData 类型；ChatMessage 增加 imageAttachment
  - [x] client.ts：getSessionConfig/putSessionConfig/fetchPersonas/generateImage/fetchAssetUrl/fetchMemoryTable
  - [x] sse.ts：`table` 事件处理（不影响既有 chunk/emotion/done/error）
  - [x] 验证：`npx tsc --noEmit` 0 错误
- [x] Task 7: 会话配置底部弹层
  - [x] 对话页 Appbar 增加"设置"入口 → BottomSheet：人设选择（头像+名称列表）、参数（temperature/top_p/max_tokens/min_response_chars/language/expression_display/image_gen 开关与尺寸）、知识库绑定开关、记忆表格开关
  - [x] 保存 → PUT 成功提示；失败错误分类提示；无任何本地持久化
  - [x] 验证：tsc + 代码审查（AsyncStorage 仍仅服务器地址一项）
- [x] Task 8: 图片气泡与表格查看
  - [x] ImageBubble 组件：图片展示（Image + aspectRatio 自适应 + 加载/失败占位）、生成中阶段 loading、‹›历史切换、重新生成、点击全屏查看（Modal + 缩放滚动可选简版）
  - [x] ChatScreen 消息渲染接入 imageAttachment；image_gen_enabled 时非流式 assistant 气泡显示"生成图片"按钮
  - [x] 表格查看弹层（headers/rows 简单表格 + 横向滚动 + 空态）
  - [x] 验证：tsc + 组件审查（列表 key 稳定、流式消息不渲染图片按钮）
- [x] Task 9: 布局修复与多尺寸适配（L1–L6）
  - [x] L1 立绘区：固定高改 contain + 屏宽自适应 + maxHeight，失败回退保持
  - [x] L2 键盘：edge-to-edge 下显式键盘避让（KeyboardAvoidingView 正确 behavior 或 keyboard-controller/EdgeToEdge 方案，真机可验证的最低风险方案）
  - [x] L3 气泡文本 flexShrink + breakStrategy；时间戳/徽章不与内容重叠（L6 安全边距）
  - [x] L4 scrollToBottom 节流（如 200ms）
  - [x] L5 useWindowDimensions：窄屏/横屏气泡 maxWidth 与立绘高度分档
  - [x] 验证：tsc + 布局代码审查（无固定像素高度依赖屏幕假设）
- [x] Task 10: 构建与静态验证
  - [x] `npx tsc --noEmit`、`gradlew assembleDebug + assembleRelease`
  - [x] aapt2 校验（usesCleartextTraffic=true 等，对齐 §7.48 教训）
  - [x] APK 复制到 `android-client/apk/` 并记录
  - [x] 验证：双变体 BUILD SUCCESSFUL + aapt2 输出正确

## 交付

- [x] Task 11: 文档与测试报告
  - [x] `docs/android-client.md` 增量：新端点（session-config/personas/image/assets/memory-table）、SSE `table` 事件、双源配置差异说明、范围边界（不移植项清单）
  - [x] `docs/android-client-test-report.md` v2：功能对照矩阵（桌面 vs 安卓 V1 vs V2）、布局问题清单+根因+修复验证、curl 测试记录、真机复核清单（含小屏/常规/横屏三档）
  - [x] CHANGELOG.md 记录；如遇 bug 修复写 FIX_RECORDS.md（重点标记）
  - [x] 验证：文档与实际接口/字段一致（抽查核对）

# Task Dependencies
- Task 2、3、4 依赖 Task 1（会话配置先行）
- Task 5 依赖 Task 1（image_gen 参数）；5 可与 2/3/4 并行
- Task 6 依赖服务端契约（Task 1–5 的 spec 定义，可先行按契约并行）
- Task 7、8 依赖 Task 6；Task 9 独立可并行
- Task 10 依赖 6–9；Task 11 依赖全部
