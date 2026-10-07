# 漫画解析模式集成到写作模式 2.0 Spec

## Why

用户需要从本地漫画文件夹导入漫画图片，借助 AI 多模态模型逐页识别（角色/场景/剧情/情感 + 文本提取），并将分析结果整理为结构化文字描述，直接支撑小说/故事大纲编写。当前写作模式 2.0（V2）已有素材绑定/风格学习/模板管理三个子域（`assets` 阶段），缺少漫画解析这一创作素材入口。本次在 `V2AssetsStage` 中新增「漫画解析」Tab，复用现有多模态 AI 调用链路（`recognizeImageTraits` 同款 OpenAI Vision 协议 + `supportsVision` 能力检测），实现完整的导入→逐页浏览→AI 分析→结果整理→创作辅助流程。

## What Changes

- 新增 `src/renderer/components/Creative/WritingModeV2/manga/` 子目录，实现漫画解析全功能
- 新增 IPC 通道 `manga:scanFolder`（主进程列出文件夹内图片文件，按数字序号排序）
- 新增 `MangaParsingService`（主进程，负责单页漫画的多模态 AI 分析，含跨页上下文携带）
- 新增 `writingV2.manga` preload 命名空间（全类型化，复用 `writing:*` 风格）
- `V2AssetsStage` 新增第 4 个 Tab「漫画解析」
- `WritingV2Entry` 阶段路由不变（assets 阶段已支持）
- 修改 `src/main/ipc/index.ts` 注册 `manga:*` handler
- 修改 `src/main/preload.ts` 新增 `writingV2.manga` 命名空间
- 修改 `src/shared/types/writing-v2.types.ts` 新增漫画解析类型契约
- 修改 `src/renderer/services/writingV2Service.ts` 新增 manga 服务封装

## Impact

- Affected specs: `refactor-writing-mode-v2`（V2 assets 阶段扩展）、`add-model-capability-detection-and-image-recognition`（复用 `supportsVision` 检测 + OpenAI Vision 协议）
- Affected code:
  - 新增：`src/renderer/components/Creative/WritingModeV2/manga/**`（全部新代码）
  - 新增：`src/main/services/manga/MangaParsingService.ts`（单页 AI 分析 + 跨页上下文构建）
  - 新增：`src/main/ipc/handlers/mangaHandlers.ts`（manga:scanFolder + manga:analyzePage + manga:buildContext）
  - 修改：`src/main/ipc/index.ts`（注册 manga handler）
  - 修改：`src/main/preload.ts`（`writingV2.manga` 命名空间）
  - 修改：`src/shared/types/writing-v2.types.ts`（漫画解析类型）
  - 修改：`src/renderer/services/writingV2Service.ts`（manga 封装）
  - 修改：`src/renderer/components/Creative/WritingModeV2/assets/V2AssetsStage.tsx`（新增 Tab）

## 技术方案

### 1. 漫画导入与分页

**文件夹扫描（主进程）**：
```
manga:scanFolder(folderPath) → {
  pages: [{ index, fileName, absolutePath, fileSize }],
  total: number,
  error?: string
}
```
- 支持扩展名：`.jpg` `.jpeg` `.png` `.webp` `.bmp` `.tiff`
- 文件命名规则：提取文件名中的数字前缀（如 `01.png` → 1、`123.jpg` → 123），无数字时按字母序排
- 返回按序号升序排列的页面列表

**逐页浏览**：
- 渲染层维护 `currentIndex`（1-based），支持「上一页/下一页」按钮 + 页码跳转
- 图片通过 `file:readAsBase64` 读取为 data URI 展示（复用现有 preload `file.readAsBase64`）

### 2. 阅读顺序配置

- UI 提供 Radio 切换：`leftToRight`（从左到右）/ `rightToLeft`（从右到左）
- 影响：
  - 页面缩略图导航条的排列顺序（右到左时序号从右往左）
  - AI 分析提示词中注入阅读顺序，让模型按正确顺序描述格子（日漫从右到左阅读）
- 切换时即时生效，无需重新分析已解析页面

### 3. AI 单页漫画分析（核心）

**多模态请求**（OpenAI Vision 协议，与 `recognizeImageTraits` 同款）：

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<MANGA_PAGE_ANALYSIS_SYSTEM_PROMPT + 阅读顺序指令 + 跨页上下文>" },
    { "role": "user", "content": [
      { "type": "text", "text": "请分析这一页漫画..." },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ]}
  ]
}
```

**System Prompt 结构**（分层）：
1. **角色识别指令**：识别主要角色（姓名/外貌特征）、表情、动作
2. **场景分析指令**：判断环境、时间、地点、氛围
3. **剧情理解指令**：按阅读顺序逐格描述情节发展和关键事件
4. **情感识别指令**：分析画面情绪氛围和角色情感
5. **文本提取指令**：精确提取所有文本（对话/旁白/拟音），标注位置（格子编号）
6. **阅读顺序指令**：`leftToRight` 或 `rightToLeft`，影响格子编号顺序
7. **跨页上下文**（第 2 页起）：前 N 页的结构化摘要表格（角色/场景/剧情/情感/关键文本），让模型理解"发生了什么"

**输出格式**（要求模型返回结构化 JSON）：
```json
{
  "pageAnalysis": {
    "characters": [
      { "name": "角色名或描述", "expression": "表情描述", "action": "动作描述" }
    ],
    "scene": { "environment": "环境描述", "time": "时间", "location": "地点", "atmosphere": "氛围" },
    "panels": [
      {
        "panelIndex": 1,
        "readingOrder": "rightToLeft",
        "plot": "该格剧情描述",
        "emotion": "情绪描述",
        "texts": [
          { "content": "对话/旁白内容", "type": "dialogue|narration|soundEffect", "position": "top-center" }
        ]
      }
    ],
    "overallEmotion": "整页情绪氛围",
    "narrativeContinuity": "与上一页的叙事衔接说明"
  }
}
```

**跨页上下文表格**（每页分析完成后自动生成，注入下一页提示词）：

| 页码 | 角色 | 场景 | 关键剧情 | 情感 | 重要对话 |
|------|------|------|---------|------|---------|
| P1 | 小明(兴奋) | 学校走廊/白天 | 小明遇到神秘人 | 好奇 | "你也是来看这个的？" |
| P2 | 小明+神秘人(严肃) | 暗室/夜晚 | 神秘人展示异常现象 | 紧张 | "不要告诉任何人" |

### 4. 主进程服务层

**`MangaParsingService`**（`src/main/services/manga/MangaParsingService.ts`）：
- `scanFolder(folderPath)`: 列出图片文件，按数字序号排序
- `analyzePage(params: { imagePath, readingOrder, previousPages: MangaPageSummary[] })`: 单页多模态 AI 分析
  - 读取图片 → base64 data URI
  - 构建 system prompt（含跨页上下文表格）
  - 调用 LLM（复用 `aiConfigProvider` + `getEngineRuntimeConfig` 模式）
  - 解析 JSON 响应（容错：提取第一个完整 JSON 对象，忽略前后文本）
  - 返回 `MangaPageAnalysis`
- `buildContextTable(summaries: MangaPageSummary[])`: 生成 Markdown 表格字符串（注入提示词）

**IPC 通道**：
- `manga:scanFolder` → 文件夹扫描
- `manga:analyzePage` → 单页分析（入参含 imagePath/readingOrder/previousSummaries）
- `manga:buildContextTable` → 生成上下文表格（渲染层可在 UI 预览时调用）

### 5. 内容输出与创作支持

**结构化输出**：
- 每页分析结果以结构化 JSON 存储（内存），同时生成可读 Markdown 摘要
- 全书分析完成后，生成完整 `MangaAnalysisResult`：
  - `pages: MangaPageAnalysis[]`
  - `characters: MangaCharacterSummary[]`（跨页聚合的角色信息）
  - `storyOutline: string`（AI 自动生成的故事大纲）
  - `chapterSuggestions: MangaChapterSuggestion[]`（章节切分建议）

**创作辅助功能**：
1. **生成故事大纲**：调用 AI 基于全部页面分析结果生成大纲（单独 IPC 调用，非流式）
2. **辅助章节编写**：将分析结果作为上下文注入 V2 大纲生成（`writing:generateOutline`），用户可选择"从漫画分析生成大纲"
3. **关键场景/对话保留**：分析结果中每格的 `plot` + `texts` 即为关键素材，可直接复制

**导出**：
- 导出为 Markdown 文件（`manga_analysis_{timestamp}.md`），包含：
  - 全书故事大纲
  - 角色汇总表
  - 逐页详细分析（场景/角色/剧情/情感/文本）
- 或直接导入写作编辑器（将大纲/章节建议填入 V2 大纲工作台）

### 6. 性能与准确性

- **格子识别**：AI 模型能力依赖（GPT-4o/Claude Vision 级别），提示词要求逐格编号描述
- **文本识别**：依赖多模态模型 OCR 能力，提示词要求精确引用
- **单页处理时间**：非流式调用，依赖网络延迟，目标 ≤ 3 秒（本地模型可能更长，UI 显示加载状态）
- **图片格式**：支持 JPG/PNG/WebP/BMP/TIFF（通过 `file:readAsBase64` 统一读取）
- **并发限制**：同一时间只允许 1 页分析（防 AI 引擎过载），UI 禁用「分析」按钮

### 7. 用户体验

- **识别结果预览**：每页分析完成后在右侧面板展示结构化结果（角色/场景/剧情/情感/文本 分区显示）
- **手动修正**：用户可编辑任何字段的分析结果（输入框/文本域），修正后保存到本地 `MangaPageAnalysis`
- **批量分析**：提供「分析全部页面」按钮（串行逐页分析，进度条显示 `current/total`）
- **保存/导入**：
  - 保存为 Markdown 文件（`file:writeBinary` 或 `file:write`）
  - 导入到写作编辑器（调用 V2 `parseOutline` 或直接设置 `project.outline`）

## ADDED Requirements

### Requirement: 漫画导入与分页浏览
系统 SHALL 支持用户选择本地文件夹导入漫画，自动识别按数字顺序排列的图片文件（01 开始），并提供逐页浏览界面，支持前后翻页控制。

#### Scenario: 导入漫画文件夹
- **WHEN** 用户点击「导入漫画」按钮并选择一个文件夹
- **THEN** 系统扫描文件夹内所有图片文件（JPG/PNG/WebP/BMP/TIFF）
- **AND** 按文件名数字前缀排序（无数字时按字母序）
- **AND** 展示页面列表和总页数

#### Scenario: 逐页浏览
- **WHEN** 用户在漫画解析界面点击「下一页」
- **THEN** 显示下一张图片
- **AND** 页码指示器更新
- **WHEN** 用户点击「上一页」
- **THEN** 显示上一张图片
- **AND** 第一页时「上一页」按钮禁用
- **WHEN** 用户在最后一页点击「下一页」
- **THEN** 按钮禁用，不执行操作

#### Scenario: 无图片文件
- **WHEN** 用户选择一个不包含任何支持格式图片的文件夹
- **THEN** 显示提示「未找到支持的图片文件」
- **AND** 不进入浏览模式

### Requirement: 阅读顺序配置
系统 SHALL 提供「从左到右」和「从右到左」两种阅读模式切换，切换时即时调整页面显示布局并影响 AI 分析。

#### Scenario: 切换阅读顺序
- **WHEN** 用户将阅读顺序从「从左到右」切换为「从右到左」
- **THEN** 页面缩略图导航条排列方向反转
- **AND** 后续 AI 分析提示词注入 `rightToLeft` 阅读顺序
- **AND** 已分析页面的结果不自动重分析（用户可手动重分析）

#### Scenario: 阅读顺序影响格子编号
- **WHEN** 阅读顺序为「从右到左」
- **AND** AI 分析该页
- **THEN** 格子编号从右往左递增（P1 最右格 → P2 次右格...）
- **AND** 输出中 `readingOrder` 字段为 `rightToLeft`

### Requirement: AI 单页漫画分析
系统 SHALL 调用多模态 AI 模型对每页漫画进行多维度分析，包括角色识别、场景分析、剧情理解、情感识别和文本提取，并保持文本位置关系。

#### Scenario: 单页分析成功
- **WHEN** 用户点击「分析此页」按钮
- **AND** 当前 AI 引擎 `supportsVision === true`
- **THEN** 系统读取图片为 base64
- **AND** 构建多模态请求（含跨页上下文）
- **AND** 解析 AI 返回的结构化 JSON
- **AND** 在右侧面板展示分析结果（角色/场景/剧情/情感/文本 分区）
- **AND** 将本页摘要加入跨页上下文

#### Scenario: 模型不支持视觉
- **WHEN** 用户点击「分析此页」但当前引擎 `supportsVision === false`
- **THEN** 显示提示「当前 AI 模型不支持图片识别，请切换到多模态模型」
- **AND** 不执行分析

#### Scenario: AI 返回格式错误
- **WHEN** AI 返回内容无法解析为有效 JSON
- **THEN** 显示错误提示「AI 返回格式异常，请重试」
- **AND** 不修改现有分析结果
- **AND** 提供「重试」按钮

#### Scenario: 跨页上下文注入
- **WHEN** 分析第 2 页及之后页面
- **THEN** 系统 prompt 中包含前 N 页（最多 10 页）的结构化摘要表格
- **AND** 表格包含：页码/角色/场景/关键剧情/情感/重要对话
- **AND** AI 输出的 `narrativeContinuity` 字段描述与上一页的衔接

### Requirement: 内容输出与创作支持
系统 SHALL 将分析结果整理为结构化文字描述，保证剧情连贯性，并提供生成故事大纲和辅助章节编写的功能。

#### Scenario: 全书大纲生成
- **WHEN** 用户完成多页分析后点击「生成故事大纲」
- **THEN** 系统将所有页面分析结果汇总为 prompt
- **AND** 调用 AI 生成结构化故事大纲
- **AND** 在结果面板展示大纲

#### Scenario: 导入写作编辑器
- **WHEN** 用户点击「导入到写作编辑器」
- **THEN** 系统将生成的故事大纲填入当前 V2 项目的 `outline` 字段
- **AND** 用户可在「大纲设计」阶段继续编辑

#### Scenario: 导出 Markdown
- **WHEN** 用户点击「导出 Markdown」
- **THEN** 系统生成包含全书大纲/角色表/逐页分析的 Markdown 文件
- **AND** 触发文件保存对话框
- **AND** 保存成功后显示文件路径

### Requirement: 识别结果预览与手动修正
系统 SHALL 提供识别结果预览功能，允许用户手动修正 AI 识别错误。

#### Scenario: 预览分析结果
- **WHEN** 页面分析完成
- **THEN** 右侧面板展示结构化结果：
  - 角色区：角色名/表情/动作 列表
  - 场景区：环境/时间/地点/氛围
  - 剧情区：逐格剧情描述
  - 情感区：整页情绪氛围
  - 文本区：对话/旁白/拟音 列表（含位置标注）

#### Scenario: 手动修正
- **WHEN** 用户点击某角色的「编辑」按钮
- **THEN** 该角色字段变为可编辑输入框
- **AND** 用户修改后点击「保存」
- **AND** 修正后的值覆盖 AI 原始输出
- **AND** 标记为「已修正」（区别于 AI 原始输出）

### Requirement: 批量分析与进度显示
系统 SHALL 支持批量分析全部页面，串行逐页处理并显示进度。

#### Scenario: 批量分析
- **WHEN** 用户点击「分析全部页面」
- **THEN** 系统从第一页开始逐页分析（跳过已分析且未修正的页）
- **AND** 进度条显示 `current/total`
- **AND** 每页分析完成后自动更新跨页上下文
- **AND** 全部完成后显示「分析完成，共 X 页」

#### Scenario: 取消批量分析
- **WHEN** 用户点击「取消」
- **THEN** 当前页分析完成后停止后续页面
- **AND** 已分析部分保留

## MODIFIED Requirements

### Requirement: V2AssetsStage Tab 集合
`V2AssetsStage` SHALL 新增第 4 个 Tab「漫画解析」，与现有素材绑定/风格学习/模板管理并列。
#### Scenario: Tab 导航
- **WHEN** 用户切换到「漫画解析」Tab
- **THEN** 显示漫画解析界面（导入/浏览/分析/结果）
- **AND** 其他 Tab 行为不变

### Requirement: writingV2 preload 命名空间
`writingV2` preload 命名空间 SHALL 新增 `manga` 子命名空间，包含 `scanFolder`/`analyzePage`/`buildContextTable`/`generateOutline`/`exportAnalysis` 方法，全类型化，禁止 any。

### Requirement: writing-v2.types.ts 类型契约
`writing-v2.types.ts` SHALL 新增漫画解析相关类型：
- `MangaPage` / `MangaPageSummary` / `MangaPageAnalysis`
- `MangaCharacterSummary` / `MangaPanelAnalysis`
- `MangaAnalysisResult` / `MangaChapterSuggestion`
- `V2MangaAPI` 接口（preload `writingV2.manga` 契约）
- `WritingV2API` 新增 `manga: V2MangaAPI` 字段

## REMOVED Requirements
无。

## 实施步骤

### Phase 1 — 地基（类型 + IPC + 主进程服务）
1. `shared/types/writing-v2.types.ts`：新增漫画解析类型（`MangaPage`/`MangaPageAnalysis`/`V2MangaAPI` 等）
2. `src/main/services/manga/MangaParsingService.ts`：`scanFolder` + `analyzePage` + `buildContextTable`
3. `src/main/ipc/handlers/mangaHandlers.ts`：注册 `manga:scanFolder`/`manga:analyzePage`/`manga:buildContextTable`/`manga:generateOutline`
4. `src/main/ipc/index.ts`：注册 manga handler
5. `src/main/preload.ts`：`writingV2.manga` 命名空间
6. `src/renderer/services/writingV2Service.ts`：manga 服务封装

### Phase 2 — UI（导入 + 浏览 + 阅读顺序）
1. `manga/V2MangaStage.tsx`：容器组件（导入/浏览/分析/结果 四区布局）
2. `manga/V2MangaImport.tsx`：文件夹选择 + 页面列表
3. `manga/V2MangaViewer.tsx`：图片展示 + 前后翻页 + 页码
4. `manga/V2MangaReadingOrderToggle.tsx`：阅读顺序 Radio
5. `V2AssetsStage.tsx`：新增「漫画解析」Tab

### Phase 3 — AI 分析 + 结果展示
1. `manga/V2MangaAnalysisPanel.tsx`：分析按钮 + 加载状态 + 结果分区展示
2. `manga/V2MangaResultEditor.tsx`：手动修正（角色/场景/剧情/文本 编辑）
3. `manga/V2MangaContextPreview.tsx`：跨页上下文表格预览
4. `manga/V2MangaBatchProgress.tsx`：批量分析进度条

### Phase 4 — 创作支持 + 导出
1. `manga/V2MangaOutlineGenerator.tsx`：故事大纲生成 + 展示
2. `manga/V2MangaExport.tsx`：Markdown 导出 + 导入写作编辑器
3. 集成到 `V2OutlineWorkbench`：「从漫画分析生成大纲」入口

### Phase 5 — 验证 + 文档
1. typecheck 零错误
2. 运行时验证：导入文件夹 → 逐页浏览 → 单页分析 → 批量分析 → 导出
3. `CODE_WIKI.md` 增量更新（漫画解析模式章节）
4. 文档更新

## 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| 多模态模型不支持（用户未配置 vision 模型） | 中 | 分析按钮前检测 `supportsVision`，不满足时提示切换模型 |
| AI 返回 JSON 格式不稳定（多余文本/截断） | 中 | 容错解析：提取第一个 `{` 到最后一个 `}` 之间的内容；失败时提示重试 |
| 大图片 base64 过大（>10MB）导致请求超时 | 低 | 主进程读取时检查文件大小，>8MB 提示用户压缩；或缩小分辨率（暂不实现，仅提示） |
| 跨页上下文过长（>10 页）导致 prompt 超长 | 中 | 最多携带前 10 页摘要；超出时仅保留最近 10 页 |
| 批量分析串行耗时过长（20 页 × 3 秒 = 60 秒） | 低 | 提供取消按钮；进度条实时反馈；不阻塞 UI（异步执行） |
