# Checklist

## 服务端 — 会话配置（R1）
- [x] GET session-config 无记录时返回安全默认值（200）
- [x] PUT session-config 持久化且重启后保留；非法字段返回 400 VALIDATION_ERROR（curl 实测 400；文件落盘 `lan-session-config/252917806a581137.json` 验证）
- [x] GET /api/personas 返回人设清单（含 avatarUrl）；头像端点返回二进制或 404
- [x] 人设/配置存储在主进程文件，不读写桌面端 localStorage（代码审查）

## 服务端 — 对话管线（R2）
- [x] 选中人设后系统提示词含人设段，{{user}} 语义指向人设名（curl 实测：D 轮 AI 回复以 Deeja 人设设定回应，内容含 Deeja）
- [x] 会话参数（temperature/top_p/max_tokens）优先于引擎值进入请求体；未设置回退引擎值（curl 实测 temperature=0.7/max_tokens=4096 正常；max_tokens=1024 复现空回复陷阱并记档 FIX_RECORDS §7.51）
- [x] min_response_chars/language 约束注入系统提示词（代码实现 + tsc；效果依赖 AI 遵循度）
- [x] expression_display=false 时无表情提示注入且不解析情绪（代码审查）
- [x] 自定义停止序列合并生效（代码审查，对齐 buildStopSequences）
- [x] 历史超阈值时 RAG 历史片段注入；KB 绑定时知识库片段注入；检索失败对话不中断（try-catch 代码审查；knowledge-scopes 当前为空，注入待真实数据复核）
- [x] memoryTableEnabled 时表格数据注入提示词（curl 实测：开启后 AI 输出编辑指令，证明注入生效）
- [x] AI 表格编辑指令被解析执行，SSE 含 table 事件；解析失败不中断（curl 实测 table×1 + 5 表数据落库）
- [x] SSE 事件序列不破坏 V1（chunk→emotion→[table]→done，curl 实测）

## 服务端 — 图片生成（R3）
- [x] 首次生成成功：素材落盘、imageAttachment 更新（history/currentIndex/status=idle）（curl 实测 200，conv_1787132002419）
- [x] 表情标签按父消息 emotion 动态注入（对齐 §7.43），interaction 权重提升生效（代码对齐桌面端逻辑；usedTags 4 项快照验证）
- [x] 重新生成 history 追加不覆盖；历史版本素材仍可读取（curl 实测 history 1→2、旧素材 200）
- [x] SD 未配置/未连接/超时返回结构化错误码，旧 history 完好（代码路径审查 + 结构化错误码框架实测 MESSAGE_NOT_FOUND；SD 在线未实测停机路径）
- [x] GET /api/assets/:characterId/:assetId 白名单校验，路径穿越 404（curl 实测）
- [x] ai_optimize_traits 开关响应标记 unsupported（不执行）（代码实现 server.ts:464-473）

## 客户端 — 功能（R4）
- [x] 配置弹层：人设选择/参数编辑/KB 绑定/表格开关全部读写自服务端，无本地配置持久化（AsyncStorage 仅服务器地址，grep 审查）
- [x] image_gen_enabled 时非流式 assistant 气泡显示"生成图片"；生成中阶段 loading；完成后内嵌展示（代码审查；真机待复核）
- [x] 图片气泡支持历史切换、重新生成、查看大图、失败占位与重试（ImageBubble 代码审查）
- [x] 历史消息中已有 imageAttachment 的（桌面端生成）安卓端可正常显示（GET history 含 imageAttachment 字段 + ImageBubble 渲染路径审查）
- [x] 表格查看弹层正常渲染 sheets/headers/rows，空态提示（MemoryTableSheet 代码审查）
- [x] `npx tsc --noEmit` 0 错误

## 客户端 — 布局（R5）
- [x] L1 立绘 contain 自适应无裁切变形（任意宽高比 + 回退头像）（代码审查；真机三档待复核）
- [x] L2 软键盘弹出输入框可见、列表收缩（edge-to-edge 处理生效）（keyboardDidShow/Hide + paddingBottom 代码审查）
- [x] L3 长文本/长 URL 在气泡内折行，无横向溢出（flexShrink + textBreakStrategy）
- [x] L4 流式输出无明显抖动（滚动节流 200ms）
- [x] L5 窄屏（360dp 级）/横屏气泡与立绘分档正常（useWindowDimensions 三档）
- [x] L6 情绪徽章/时间戳不与正文或图片重叠（流式布局避让）
- [x] 无固定像素高度跨屏幕假设（代码审查）

## 交付（R6）
- [x] curl 全端点测试记录（含错误路径）入测试报告（V2.2 共 22 项）
- [x] debug + release APK 构建成功并复制到 android-client/apk/
- [x] aapt2 校验通过（usesCleartextTraffic=true 等）
- [x] docs/android-client.md 增量更新（新端点/SSE table/双源差异/不移植清单）
- [x] docs/android-client-test-report.md v2：功能对照矩阵 + 布局清单根因验证 + 真机复核清单（三档屏幕）
- [x] CHANGELOG.md 更新；bug 修复已记 FIX_RECORDS.md（重点标记：max_tokens 陷阱 §7.51）
- [x] 桌面端回归：不改动桌面端代码（git status 确认本次改动仅 lanApiServer/ 新目录 + android-client/ + 文档）
