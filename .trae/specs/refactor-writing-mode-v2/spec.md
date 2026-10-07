# 写作模式 2.0 重构计划 Spec

## Why
当前写作模式（V1）功能复杂且代码冗余：渲染层约 14,500 行（65 个文件）、主进程约 7,900 行、63+ 个 IPC 通道、单文件 1,160 行类型定义。存在双真相源状态、两条并行生成流水线（chunk/shard 语义重叠）、多个巨型组件（1118/897/797 行）、God Hook（598 行）、大量 `any` 类型 IPC、已存在的类型错误与调试残留，架构的可维护性和扩展性差，继续在其上叠加功能成本过高。

本次重构采用**平行 V2** 策略：完整保留 V1 全部功能与入口，在其右侧新增「写作模式 2.0」入口，以全新 UI 架构 + 复用主进程服务层的方式分阶段重建。

## 用户已确认的关键决策
| 决策项 | 结论 |
|--------|------|
| 实现策略 | **平行 V2**：新入口下独立新代码（`WritingModeV2`），UI 层重写，复用主进程服务层与现有项目数据格式；V1 代码零改动 |
| 上线节奏 | **分阶段**：P0 核心流程 → P1 剧情检查+表格整理 → P2 风格学习/模板/素材绑定 |
| 舍弃功能 | ① chunk 分块流水线（仅保留 shard 分片）② CreativeSubNav 死入口 ③ 写作内嵌智能体（引导至统一 AgentCenter）④ EXPORT 空壳页（V2 直接实现真实导出） |
| 入口命名 | **写作模式 2.0**（与旧入口「写作模式」并列于创意中心卡片行右侧） |

## What Changes
- 新增「写作模式 2.0」入口卡片（创意中心，位于「写作模式」右侧），懒加载全新 `WritingModeV2` 模块
- 新增 `src/renderer/components/Creative/WritingModeV2/` 独立模块（领域驱动目录结构）
- 新增 V2 专用 store 与全类型化 IPC 服务封装层
- 移除 CreativeSubNav 中无效的「写作模式」Tab（V1 死入口，点击实际渲染创意列表页）
- 主进程：抽取共享服务层接口（零行为变更），新增导出服务实现
- **BREAKING（仅 V2 侧）**：V2 不提供 chunk 分块生成、内嵌写作智能体

## Impact
- Affected specs: `add-game-mode`（无关）、`consolidate-agents-into-system-agent`（V2 不迁移内嵌智能体，与其方向一致）
- Affected code:
  - 新增：`src/renderer/components/Creative/WritingModeV2/**`（全部新代码）
  - 修改：`CreationCenter.tsx`（新增卡片）、`CreativeSubNav.tsx`（移除死 Tab）
  - 修改：`src/main/ipc/index.ts`（注册 V2 新增 handler，如导出）、`src/main/preload.ts`（新增 `writingV2` 命名空间，全类型化）
  - 复用（只读不改）：`src/main/services/writing/**`、`src/main/services/WritingStyleLearningService.ts`、`writingProjectStore` 数据格式（`WritingProject` JSON 落盘格式完全兼容，V1/V2 可读同一项目库）
- Not affected: V1 全部运行时行为、V1 项目数据、聊天模式、角色卡、世界书

## 现状分析报告

### A. 入口盘点
| # | 入口 | 路径 | 状态 |
|---|------|------|------|
| 1 | 创意中心「写作模式」卡片 | `CreationCenter.tsx` → FullscreenDialog → lazy `WritingModeEntry` | ✅ 唯一有效入口 |
| 2 | 创意管理「写作模式」Tab | `CreativeSubNav.tsx` `'writing'` | ⚠️ 死入口：`CreativeManager.tsx` switch 无 `'writing'` 分支，落入 default 渲染 `CreativeListPage` |

**结论**：V2 新卡片只需处理入口 1；入口 2 直接移除（用户已确认）。

### B. 代码规模盘点
| 层 | 规模 | 说明 |
|----|------|------|
| 渲染层 `WritingMode/` | 65 文件 ≈ 14,500 行 | 最大单文件：WritingConfigModal 1118、TableOrganizeMainPanel 897、WritingConfigPanel 797、WritingTablePreviewModal 771、ContentWorkspace 667 |
| 渲染层 store | 3 个 zustand store ≈ 710 行 | writingProjectStore(176) / writingModeStore(421) / writingModeUIStore(115) |
| 主进程服务 | ≈ 7,900 行 | OutlineGenerator 1012、PlotCheckerService 1247、TableOrganizeService 1230、ContentGenerator 972、writingAgentService 1028、AIAssistedChapterService 557、PromptBuilder 560、ChapterChunkService 226 等 |
| IPC | 63+ 通道 | `writing.*` + `writing.style.*` + `writing.table.*` + `writing.template.*`，大量 `any` 入参 |
| 共享类型 | writing.types.ts 1160 行 / 109 导出 | 混杂项目、大纲、章节、chunk、shard、表格、剧情检查、导出 8 个领域 |

### C. 底层架构逐层评估

**1. 类型层（shared/types/writing.types.ts）— 不合理**
- 单文件 8 领域混杂，109 个导出；`ChunkStatus/ChapterChunk/GenerationProgress`（chunk 体系）与 `ShardOutline/ShardStatus/ShardDetail`（shard 体系）并存。
- **已确认错误**：`writing.constants.ts` 的 `PROJECT_STATUS_LABELS` 引用了枚举中不存在的 `ProjectStatus.IN_PROGRESS/REVIEWING/ARCHIVED`（typecheck 报 TS2339×3 + TS2741），V1 项目状态标签实际显示异常。
- V2 决策：新建 `shared/types/writing-v2.types.ts` 按领域拆分（仅 V2 需要子集 + 导出类型），不修改 V1 文件。

**2. 数据/持久层（main/services/writing/ 仓库）— 基本合理，可复用**
- `WritingProjectRepository` 等 4 个仓库职责清晰；`WritingProject` JSON 落盘格式成熟。
- 复用结论：**V2 完全复用项目数据格式与仓库层**，保证 V1/V2 双入口可打开同一项目库（用户项目资产不受迁移风险）。
- 风险点：仓库层部分方法直接接收 `any`（如 saveProject），V2 侧在服务封装层加类型约束，不改仓库签名。

**3. 服务层（生成/检查/整理引擎）— 合理，复用**
- OutlineGenerator / ContentGenerator / PlotCheckerService / TableOrganizeService / WritingStyleLearningService 是纯主进程逻辑，与 UI 解耦良好，**V2 全部复用**。
- `writingAgentService`（1028 行）：V2 不迁移（用户已确认），继续服务 V1。
- `ChapterChunkService`：V2 不使用（chunk 体系舍弃），继续服务 V1。
- 新增需求：`exportProjectWithChapters` IPC 已存在但 V1 无 UI 调用，需核对其实现完成度；V2 的 P0 导出功能基于它补齐（TXT/Markdown/章节选择）。

**4. IPC 层 — 部分合理**
- 已按领域拆分为 8 个 handler 文件（writingProject/Outline/Chapter/Table/Style/PlotCheck/Template/Agent），拆分本身正确。
- 问题：preload 暴露的通道大量 `any`（`config: any`、`modelConfig: any`、`request: any` 遍布 63 通道），类型安全在边界处断裂。
- V2 决策：新增 `writingV2` preload 命名空间（复用同一批 IPC 通道 invoke，不复制主进程 handler），在 preload 与渲染层服务封装处提供**全量类型化**契约。

**5. 状态层 — 不合理（V1 最大架构问题）**
- 双真相源：`project.outline`（持久化，writingProjectStore）与 `outline`（内存，writingModeStore）并存，两处更新路径不同，已观察到漂移型 bug 的调试残留（store 中大量 "Loaded raw data check" 日志、WritingModeEntry 内置 DEBUG UI 块）。
- `writingModeStore` 同时承载大纲版本、chunk、shard、流式内容、CoT 五类关注点（421 行）；chunk 与 shard 状态并存。
- V2 决策：**单一真相源 = 项目实体（持久化优先）**，内存只保留"生成会话"瞬态状态；store 按领域拆分为 `useV2ProjectStore` / `useV2GenerationStore` / `useV2UIStore`。

**6. UI 层 — 不合理**
- `ContentWorkspace`（667 行）编排 10+ hooks + 15+ Modal，一次性全量 import，首屏包体大。
- WritingConfigModal(1118) 与 WritingConfigPanel(797) 职责重叠。
- `useChapterGeneration`（598 行）为 God Hook，串联生成、取消、断点恢复、建议、状态机。
- 4 阶段导航（PROJECTS/OUTLINE/CONTENT/EXPORT）中 EXPORT 为空壳。
- V2 决策：领域驱动目录 + 每个 Modal 懒加载 + 编排下沉到 `useWritingSession` 领域模块。

### D. 功能优缺点总结
**优点（V2 继承）**
- 4 阶段创作流（项目→大纲→内容→导出）符合长文创作心智模型
- 大纲双模式（AI 生成 + 手动编辑）+ 分片（shard）可控生成工作流（用户确认分片确认/摘要标记机制是有效设计）
- 主进程服务层与 UI 解耦，仓库/生成引擎可直接复用
- 剧情检查（PlotCheck 多维度评分 + 自动修正 + 批量修正）与表格整理（版本快照/回滚）是差异化能力
- 风格学习（上传文本 → 分块分析 → 风格画像）链路完整

**缺点（V2 修复）**
- 双真相源状态漂移、chunk/shard 双流水线冗余（详见 C-5）
- 巨型组件/God Hook/巨型类型文件，改动放大效应强
- IPC 边界类型断裂（any 泛滥）
- 已存在缺陷：ProjectStatus 常量错配、updateOutline 畸形 outline（TS2739）、CreativeSubNav 死入口、DEBUG UI 残留、EXPORT 空壳
- 内嵌写作智能体与统一 AgentCenter 能力重叠

### E. 功能处置清单
| 功能域 | 处置 | 说明 |
|--------|------|------|
| 项目 CRUD / 列表 / 搜索 / 删除 | **保留（复用服务）** | V2 新项目列表，兼容打开 V1 项目 |
| 大纲 AI 生成 / 手动大纲 / 续写 / 大纲编辑面板 | **保留（重构 UI）** | V2 单一 `OutlineWorkbench` 组件替代 V1 的 8 个大纲组件 |
| 章节生成（shard 分片流水线） | **保留（作为唯一流水线）** | chunk 体系舍弃 |
| 流式编辑器 / 章节拆分合并 / AI 建议 | **保留（重构）** | 拆分为独立可测组件 |
| 导出（TXT/Markdown/章节选择） | **新增实现** | 替代 EXPORT 空壳，基于 `exportProjectWithChapters` |
| 剧情检查 / 自动修正 / 逻辑记录 | **保留（P1，重构 UI）** | 右栏面板形态保留，组件重写 |
| 表格整理 / 版本快照 / 行级重整理 / 模板绑定 | **保留（P1，重构 UI）** | 独立 `TableDomain` 子目录 |
| 素材绑定（世界书/角色卡/人设） | **保留（P2）** | 复用 `loadResources` |
| 风格学习 | **保留（P2）** | 复用服务，V2 提供轻量入口 |
| 小说类型/写作风格模板管理 | **保留（P2）** | 复用服务 |
| 大纲版本管理（内存版） | **重构** | 统一走主进程版本快照，去内存版本数组 |
| chunk 分块流水线 | **舍弃** | V2 不实现，V1 保留 |
| CreativeSubNav「写作模式」Tab | **移除** | 死入口（用户确认） |
| 写作内嵌智能体（WritingAgentModal） | **舍弃** | V2 引导用户至 AgentCenter |
| EXPORT 空壳页 | **移除** | 由真实导出功能替代 |

## V2 目标架构

### F. 总体分层
```
┌─ 入口层 ──────────────────────────────────────────────┐
│ CreationCenter: [写作模式] [写作模式 2.0] ← 新增卡片    │
│  └─ lazy → WritingModeV2/WritingV2Entry (FullscreenDialog) │
├─ V2 UI 层 (src/renderer/components/Creative/WritingModeV2) │
│  projects/    项目列表 + 创建向导                        │
│  outline/     OutlineWorkbench (AI/手动统一)            │
│  writing/     章节工作台 (编辑器/分片流水线/拆并/进度)    │
│  plotcheck/   剧情检查面板 (P1)                          │
│  table/       表格整理子域 (P1)                          │
│  export/      导出对话框 (P0)                           │
│  shared/      V2 通用组件 (懒加载 Modal 基座等)          │
├─ 状态层 (stores) ────────────────────────────────────┤
│ useV2ProjectStore  持久化投影 (单一真相源=项目实体)      │
│ useV2GenerationStore 生成会话瞬态 (shard/流式/进度)      │
│ useV2UIStore 布局/面板/弹窗                              │
├─ 服务封装层 (renderer/services/writingV2Service.ts)     │
│ 全类型化封装 window.electronAPI.writingV2               │
├─ IPC 层 (preload writingV2 命名空间)                    │
│ 复用现有 writing:* 通道 invoke + 新增 writingV2:export 等│
├─ 主进程服务层（复用，零行为变更）                         │
│ OutlineGenerator / ContentGenerator / PlotChecker /     │
│ TableOrganizeService / StyleLearning / 仓库层           │
└────────────────────────────────────────────────────────┘
```

### G. 关键架构规则
1. **单一真相源**：所有持久化状态以项目实体（DB）为准；`useV2ProjectStore` 只是其内存投影，任何写操作 = 更新投影 + 落盘（沿用 AUTO_SAVE_DELAY 防抖）。内存 store 不保存第二份 outline/chapters 持久副本。
2. **单一生成流水线**：V2 只有 shard 分片流水线；`useV2GenerationStore` 状态机 `IDLE → PLANNING(分片大纲) → STREAMING(分片内容) → INTEGRATING(合并) → DONE/ERROR`。
3. **类型边界**：`writingV2` preload 契约全量类型化（禁止 any）；渲染层通过 `writingV2Service` 访问，禁止直接裸调 electronAPI。
4. **懒加载**：V2 入口级 lazy + 每个 Modal 级 lazy；`WritingV2Entry` 首屏不加载 plotcheck/table 域组件。
5. **组件规模上限**：V2 单组件 ≤ 400 行，超限必须拆分（写入代码评审标准）。
6. **数据兼容**：V2 读写 `WritingProject` 现有 JSON 格式，不做数据迁移；V1 项目可在 V2 打开并继续创作（shard 状态不要求 V1 兼容，chunk 数据 V2 忽略）。

## ADDED Requirements

### Requirement: 写作模式 2.0 入口
创意中心 SHALL 在「写作模式」卡片右侧展示「写作模式 2.0」卡片，点击打开 FullscreenDialog 懒加载 V2 模块；两卡片视觉上有版本区分（V2 带 "2.0" 徽标），旧入口行为零变化。
#### Scenario: 双入口并存
- **WHEN** 用户打开创意中心
- **THEN** 看到「写作模式」与「写作模式 2.0」两张相邻卡片，分别打开 V1/V2

### Requirement: V2 核心创作流（P0）
V2 SHALL 支持：新建项目（配置向导）→ AI/手动大纲 → 分片章节生成（流式）→ 章节编辑/拆并 → 导出（TXT/Markdown/章节多选），且兼容打开 V1 已有项目。
#### Scenario: V1 项目迁移使用
- **WHEN** 用户在 V2 中选择一个 V1 创建的项目
- **THEN** 大纲与章节内容完整加载，可继续分片生成与导出

### Requirement: V2 全类型化 IPC
`writingV2` preload 命名空间 SHALL 对全部通道提供完整 TS 类型（请求/响应/事件），渲染层服务封装层禁止出现 any 穿透。

### Requirement: V2 领域分模块（P1/P2）
V2 SHALL 以独立子目录实现剧情检查、表格整理（P1）与素材绑定、风格学习、模板管理（P2），全部懒加载，不影响 P0 首屏体积。

## MODIFIED Requirements

### Requirement: CreativeSubNav Tab 集合
创意管理子导航 SHALL 仅包含 创意/角色卡/世界书 三个 Tab；移除原「写作模式」死 Tab（其点击从未渲染写作界面，实际落入 default 分支渲染创意列表）。
#### Scenario: 移除后无残留
- **WHEN** 用户浏览创意管理子导航
- **THEN** 不再出现「写作模式」Tab，其余 Tab 行为不变

## REMOVED Requirements
### Requirement: V2 chunk 分块流水线
**Reason**: 与 shard 分片流水线语义重叠（用户确认舍弃）
**Migration**: 无；V1 chunk 功能不受影响

### Requirement: V2 内嵌写作智能体
**Reason**: 与统一 AgentCenter 能力重叠（用户确认舍弃）
**Migration**: V2 不提供内嵌智能体入口；需要智能体能力的用户由引导提示指向 AgentCenter

### Requirement: V2 EXPORT 空壳页
**Reason**: 空壳占位由 P0 真实导出功能替代
**Migration**: 无

## 实施步骤（分阶段）

### Phase 0 — 地基（不产生用户可见功能）
1. `shared/types/writing-v2.types.ts`：按领域拆分的 V2 类型子集（Project/Outline/Chapter/Shard/Export）
2. preload 新增 `writingV2` 命名空间（复用现有通道 + 全类型化）；`electron.d.ts` 补声明
3. `renderer/services/writingV2Service.ts` 全类型服务封装
4. 移除 CreativeSubNav 死 Tab（独立小改动，先落）
5. 新增 V2 入口卡片 + `WritingV2Entry` 空壳骨架（4 阶段导航占位）

### Phase 1（P0）— 核心创作流
1. `useV2ProjectStore`（持久化投影 + 防抖落盘）+ 项目列表页 + 创建向导（替代 1118 行 ConfigModal，拆为分步表单）
2. `outline/OutlineWorkbench`：AI 生成（流式 + CoT 展示）/ 手动编辑 / 大纲确认，统一替代 V1 8 个大纲组件
3. `useV2GenerationStore` shard 状态机 + `writing/` 章节工作台：流式编辑器、分片大纲确认、分片生成/重生成、合并、章节拆分/合并、进度面板
4. `export/` 导出对话框：TXT/Markdown/章节多选，补齐主进程导出实现缺口
5. 验收：新建项目走完全流程导出文件成功；打开 V1 项目继续创作成功

### Phase 2（P1）— 质量与结构化
1. `plotcheck/` 剧情检查面板（复用 PlotCheckerService IPC）：报告/自动修正/批量修正/逻辑记录
2. `table/` 表格整理子域：预览/整理/版本快照/回滚/模板绑定（复用 TableOrganizeService）
3. 右栏多 Tab 面板体系（V2 版，支持 resize）

### Phase 3（P2）— 扩展能力
1. 素材绑定（世界书/角色卡/人设，复用 loadResources）
2. 风格学习入口（复用 WritingStyleLearningService）
3. 模板管理（小说类型/写作风格模板，复用 template 通道）

### Phase 4 — 收尾
1. V1 标注为"经典模式"（仅文案，不改行为）
2. 回归验证：V1 全流程不受影响 + V2 分阶段功能验收 + typecheck/test 通过

## 时间规划（相对阶段，按依赖序）
| 阶段 | 内容 | 交付物 |
|------|------|--------|
| Phase 0 | 地基 | 类型/IPC 契约/服务封装/入口卡片/死 Tab 移除 |
| Phase 1 | P0 核心流 | 项目→大纲→分片生成→导出 全链路可用 |
| Phase 2 | P1 质量能力 | 剧情检查 + 表格整理 |
| Phase 3 | P2 扩展 | 素材/风格/模板 |
| Phase 4 | 收尾 | 回归 + 文档更新 |
每阶段独立可交付、可验收；阶段内任务按 tasks.md 顺序执行，阶段 0/1 完成后即具备最小可用产品形态。

## 风险与对策
| 风险 | 等级 | 对策 |
|------|------|------|
| 复用主进程服务时发现隐藏耦合（如 handler 内部依赖 V1 前端约定） | 中 | Phase 0 先打通全类型契约层，暴露问题尽早；不改 handler 行为，必要时在 V2 服务封装层适配 |
| V1/V2 同开同一项目导致双写冲突 | 中 | 同一时刻仅一个入口激活（FullscreenDialog 互斥）；落盘防抖 + 最后写入者胜；文档注明不建议双入口同时编辑 |
| V2 首版功能少于 V1 造成用户困惑 | 低 | 分阶段交付 + 卡片描述注明当前能力；Phase 3 后能力对齐 |
| 类型子集遗漏导致返工 | 低 | Phase 0 类型层按 P0-P2 功能清单预扫描（本 spec 的处置清单即为清单） |

## 验证计划
- `npm run typecheck`：V2 新代码零错误（V1 存量错误不新增）
- `npm test`：存量 1414 通过用例不回归
- 运行时验收（遵循记忆规则：必须运行时验证，不能仅静态分析）：
  - 双入口并存渲染、V1 全流程冒烟（新建/大纲/生成）
  - V2 全流程：新建→大纲→分片生成→编辑→导出文件内容核对
  - V1 项目 → V2 打开数据完整性核对（章节数/字数/大纲字段）
  - 移除 CreativeSubNav Tab 后创意管理三个 Tab 正常
