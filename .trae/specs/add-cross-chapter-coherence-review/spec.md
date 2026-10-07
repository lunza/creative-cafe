# 跨章节连贯性审查机制 Spec

## Why

2026-10-07 对已生成的五章《爱之岛》全文 + 表格做了系统性实测审查，确认跨章节连贯性问题已成规模，而现有机制无法覆盖：

- **表格整理机制**（TableOrganizeService）只产出"剧情概要"级数据，不处理细节连贯性；
- **单章剧情检查**（PlotCheckerService）以当前章节大纲为主要基准，缺跨章全局视角。

**实测问题清单（本 spec 的验收基准，实现后审查功能应能命中其中绝大多数）：**

A. 重复剧情（同场景/同动作重复上演）：
1. "掼到双人床上"动作出现 3 次：第2章末、第3章开头、第4章开头（逐句高度雷同）
2. 第2章末已完整演完卧室戏（压住→抽插→高潮→"彻底沦陷"），第3章却从头重演"无润滑初插 + 处女般的紧致"
3. "最后的冲刺→高潮→意识空白→沉沦"节拍在第2/3/4/5章完整重复

B. 情节矛盾：
1. 第2章岛主"赤裸着身体"（浴室/卧室均赤裸）vs 第3章"迅速地撸开了自己的裤子"
2. 第3章"完全没有润滑"+"处女般紧致的肉壁" vs 第2章已发生两轮性事（第4章"早被操得红肿外翻"才是正确状态）
3. 第2章结尾"彻底沦陷" vs 第3章开头"惊慌喊叫、还在反抗"

C. 文本重复（跨章雷同句，本地扫描可精确到句）：
- "腰部像是一台不知疲倦的打桩机"（第3章 = 第4章，逐字相同）
- "岛主的声音变得低沉而沙哑"（第3章 = 第4章，逐字相同）
- "层层叠叠的肉褶被粗暴地抚平"（第2/3/4/5章共 4 次）
- "像被电击了一样"、"紧得惊人"、"死死地箍住"、"大量的爱液喷涌而出"等 7+ 组

D. 表格问题（跨章视角）：
1. 所有行"发生章节/首次登场章节/埋设章节"均为相对值"本章"——跨章时无法定位，应为绝对章号
2. 伏笔表"每日训练约定"状态=未回收，但第5章已完整执行，实际已回收（状态过时）
3. 事件表缺第3-5章关键事件

## What Changes

- 新增 `CrossChapterTextScanner`（主进程，纯函数）：句级文本相似度扫描（字符 n-gram Jaccard），零 token 成本、位置精确到句，负责 C 类问题
- 新增 `CrossChapterReviewService`（主进程）：混合路线编排——本地扫描（恒执行）+ AI 语义审查（重复剧情 + 情节矛盾，表格为次要参考），结果合并去重
- 新增 IPC `writing:crossCheckReview` / `writing:crossCheckCancel` / `writing:crossCheckSuggestFix` + 流式事件通道
- 新增渲染层 `V2CrossCheckPanel`：工作台右侧新 tab「跨章审查」（平行独立模块，既有 pipeline/plotcheck/table 三个 tab 零改动）
- 新增 shared 类型 `cross-chapter-review.types.ts` + preload API 扩展
- 修改 `V2ChapterWorkbench`（rightTab 增加 'crosscheck'）、`writingHandlers.ts`（注册）、`preload.ts`（API）
- 小优化（针对性修复 D 类问题）：表格整理提示词的"章节"类字段要求输出**绝对章号**（如"第3章"）而非相对值"本章"

**无 BREAKING 变更。**

## Impact

- Affected specs: `refactor-writing-mode-v2`（V2 工作台扩展）、`add-ai-custom-prompt-and-interrupt`（复用中止契约与自定义提示词模式）、`polish-deai-humanizer`（修复建议文本注入 humanizer）
- Affected code:
  - `src/shared/types/cross-chapter-review.types.ts`（新建）
  - `src/main/services/writing/CrossChapterTextScanner.ts`（新建）
  - `src/main/services/writing/CrossChapterReviewService.ts`（新建）
  - `src/main/ipc/handlers/writing/writingCrossCheckHandlers.ts`（新建）
  - `src/main/ipc/handlers/writingHandlers.ts`（注册）
  - `src/main/preload.ts`（writing API 扩展）
  - `src/renderer/components/Creative/WritingModeV2/crosscheck/V2CrossCheckPanel.tsx`（新建，必要时拆子组件/弹窗文件，单组件 ≤ 400 行约定）
  - `src/renderer/components/Creative/WritingModeV2/writing/V2ChapterWorkbench.tsx`（新 tab）
  - `src/main/services/writing/TableOrganizeService.ts`（提示词章节字段措辞）

## ADDED Requirements

### Requirement: 章节分组选择
系统 SHALL 允许用户自定义连续章节范围作为审查单元（起始章节下拉 + 章节数输入，默认 2 章，上限 5 章），仅纳入有正文的章节。

#### Scenario: 用户审查第 3-4 章
- **WHEN** 用户在工作台「跨章审查」tab 选择起始章节=第3章、章节数=2，点击「开始审查」
- **THEN** 仅第3、4章正文进入审查（本地扫描 + AI 审查），第1/2/5章不参与

#### Scenario: 章节数超上限
- **WHEN** 用户输入章节数 > 5
- **THEN** 输入被钳制到 5 并提示"长文受本地模型上下文限制，建议 ≤5 章"

#### Scenario: 范围含空章节
- **WHEN** 所选范围内部分章节无正文
- **THEN** 空章节被跳过，审查开始时提示实际参与审查的章节数

### Requirement: 本地文本重复扫描
系统 SHALL 提供确定性句级扫描（零 token 成本）：章节两两（含章内）比较，句级切分（句末标点，长度 ≥8 字），相似度用字符 4-gram Jaccard；命中条件 `sim ≥ 阈值`（默认 0.75），短句（8-15 字）额外要求 `sim ≥ 0.85` 防误报；仅比较章节距离 ≤ 用户设定值的章节对；同一章节对的多组雷同句合并为一条问题（附 ≤3 组示例）。

#### Scenario: 命中实测雷同句
- **WHEN** 对第 2-5 章执行本地扫描（默认参数）
- **THEN** 报告中包含 text_repetition 问题，覆盖"掼在双人床上"（2↔3、3↔4）、"打桩机"（3↔4）、"低沉而沙哑"（3↔4）、"粗暴地抚平"（2↔3↔4↔5）等实测案例，且每条含双侧章节号 + 逐字引文

#### Scenario: 章节距离过滤
- **WHEN** 用户将"章节比对距离"设为 1，第2章与第4章存在雷同句
- **THEN** 该雷同句不出现在结果中（距离 2 > 1）

### Requirement: AI 语义审查（重复剧情 + 情节矛盾）
系统 SHALL 调用 AI 对分组章节做语义级审查，维度固定两个：`plot_repetition`（同场景/同动作序列重复上演）、`plot_contradiction`（状态/行为/时间线前后矛盾）。提示词结构：各章正文（按**数组位置**编号标注，位置优先契约）为主要输入 + 历史表格（事件表/伏笔表/角色表）为次要参考 + AI 严格度参数文案。AI 输出 JSON 问题列表，引文必须为原文逐字摘录（主进程校验 `includes`，校验失败的引文标记为不可定位）。支持流式可视化与中止（中止返回 `cancelled: true` 标记，前端不报红色错误）。

#### Scenario: 命中实测矛盾
- **WHEN** 对第 2-4 章执行 AI 语义审查
- **THEN** 报告包含 plot_contradiction（岛主赤裸 vs 撸裤子、处女紧致 vs 前两轮性事）与 plot_repetition（第3章重演第2章已完成的卧室戏"初插"）

#### Scenario: 审查中停止
- **WHEN** AI 审查进行中用户点击「停止」
- **THEN** 主进程 AbortController 中止，结果返回 `cancelled: true`，UI 显示"已停止"并保留本地扫描已产出的结果

#### Scenario: 自定义提示词
- **WHEN** 用户在提示词 Popover 填写"重点检查角色着装连续性"
- **THEN** 该文本经 `withCustomPrompt` 追加到审查 system prompt 最末尾（最高优先级段），并持久化（独立 storageKey）

### Requirement: 细粒度参数配置
系统 SHALL 提供三个独立可调参数并按项目持久化（localStorage，key 含 projectId）：① 章节比对距离 N（整数 1-10，默认 2，作用于本地扫描与 AI 提示词）；② 文本相似度阈值（0.50-0.95 滑杆，默认 0.75，作用于本地扫描）；③ AI 严格度（严格/标准/宽松三值，默认标准，映射到提示词判据文案：严格=合理回声也报、标准=影响阅读体验才报、宽松=只报明显重复/矛盾）。

#### Scenario: 参数生效
- **WHEN** 用户将阈值从 0.75 调到 0.90 后重新审查
- **THEN** 本地扫描结果中低相似度（0.75-0.90）的雷同句消失，高相似度保留

#### Scenario: 参数持久化
- **WHEN** 用户重开应用
- **THEN** 三个参数回填为该项目的上次值

### Requirement: 审查结果可视化
系统 SHALL 按三类（重复剧情/情节矛盾/文本重复）分组展示问题列表，每条问题卡片包含：类型 Tag、严重度（高/中/低）、来源（local/ai）、章节A 与 章节B 的**逐字引文对比**（上下对照区块）、问题描述；点击引文中的章节标识可跳转到对应章节（复用 `setSelectedChapterIndex`）。

#### Scenario: 结果分组展示
- **WHEN** 审查完成返回混合报告
- **THEN** 三类各自成组（组头显示数量），本地与 AI 重复命中同一雷同句时合并为一条（来源标记 local+ai），不重复展示

#### Scenario: 跳转定位
- **WHEN** 用户点击问题卡片中"第3章"标识
- **THEN** 工作台切换到第3章（章节选择器联动）

### Requirement: 一键修复建议
系统 SHALL 为每条问题提供「生成修复建议」：AI 基于问题（双侧引文 + 描述）+ 目标章节全文生成 `{ chapterIndex, originalText, replacementText, explanation }`；主进程校验 `originalText` 在目标章节中逐字存在（失败重试一次，仍失败返回失败原因）；替换文本注入 `withHumanizerNovelRules`（去 AI 味）；用户确认后写回（`patchProject` 更新章节 content + `autoSaveChapter` 落盘，自动产生版本记录）；若目标章为当前打开章则同步编辑器（`onContentUpdated`）；该问题标记为"已修复"。

#### Scenario: 修复一条文本重复
- **WHEN** 用户对"打桩机"雷同问题点击「生成修复建议」并确认应用
- **THEN** 第4章中"腰部像是一台不知疲倦的打桩机"被替换为改写文本，章节文件落盘 + 版本历史新增"自动保存"记录，问题卡片显示"已修复"

#### Scenario: 建议锚点校验失败
- **WHEN** AI 返回的 originalText 与章节实际文本不完全一致（含重试后）
- **THEN** 返回失败原因（"原文定位失败，请重试"），不写入任何内容

### Requirement: 表格整理章节字段绝对化（小优化）
TableOrganizeService 的整理提示词 SHALL 要求"发生章节/首次登场章节/埋设章节/回收章节"等章节类字段输出**绝对章号**（"第N章"，N 为实际章节序号），禁止输出"本章"等相对值。

#### Scenario: 重新整理后
- **WHEN** 用户清空并重新「AI 整理全部」
- **THEN** 表格章节类字段为"第1章"…"第5章"形式的绝对引用（存量"本章"数据需用户重整理后更新）

## MODIFIED Requirements

### Requirement: V2ChapterWorkbench 右侧 tab
在既有 `rightTab: 'pipeline' | 'plotcheck' | 'table'` 基础上新增 `'crosscheck'`（label「跨章审查」，图标 `NodeIndexOutlined` 或类似）；渲染 `<V2CrossCheckPanel project chapterIndex onContentUpdated />`。既有三个 tab 的组件、行为、props 零改动。

#### Scenario: 新 tab 与既有 tab 共存
- **WHEN** 用户切换「剧情检查」与「跨章审查」tab
- **THEN** 两个面板状态互不干扰，剧情检查的报告/历史保留

## REMOVED Requirements

（无）
