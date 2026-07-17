# 狼人杀推理游戏 · 策划阶段文档集

> 本文档是狼人杀推理游戏策划阶段（Phase 0）14 份设计文档的导航入口。
>
> 本游戏融合**狼人杀**（阵营博弈 + 技能）+ **弹丸论破**（学级裁判 + 处刑）+ **逆转裁判**（证据 / 证言 / 威慑 / 异议）三大机制，由 AI 法官驱动，玩家扮演典狱长（预言家 + 警长双重身份）在 16 名 AI 角色中追查伪装者。
>
> 所有术语严格遵循 [01-system-architecture.md](./01-system-architecture.md) [§9 术语表](./01-system-architecture.md#9-术语表)；规则依据 [逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt)；策划阶段不修改任何 `src/` 下源代码，仅交付设计文档。

**当前策划阶段版本**：`v1.0.0` ｜ **维护人**：见各文档头部 Maintainer 字段 ｜ **最后更新**：2026-07-17

---

## 1. 文档清单与一句话简介

| 编号 | 文档 | 一句话简介 | 推荐阅读时长 |
| :---: | :--- | :--- | :---: |
| 01 | [系统架构](./01-system-architecture.md) | 划分法官 / 角色 / 地图 / 流程 / AI 驱动 / 规则六大子系统，给出职责矩阵、数据流向、复用清单与全文档术语表。 | 20 min |
| 02 | [法官系统设计](./02-judge-system-design.md) | 定义法官 AI 单例的五大职责、暗码标记协议、真相剧本 TypeScript Interface 与二次监管三层机制。 | 25 min |
| 03 | [角色系统设计](./03-character-system-design.md) | 定义 `WerewolfCharacter` 档案结构、`FactionCode` 枚举、16 人样例角色表与 Fisher-Yates 阵营分配算法。 | 20 min |
| 04 | [地图系统设计](./04-map-system-design.md) | 规划 F1-F4 四层楼 + 16 单人牢房 + 12 公共区域结构、房卡系统、可搜索点位模型与监控覆盖矩阵。 | 20 min |
| 05 | [游戏流程设计](./05-game-flow-design.md) | 设计八大阶段状态机（`WerewolfPhase` + `phaseTransitions`）与各阶段 `PhaseUIType` 操作映射。 | 25 min |
| 06 | [AI 驱动机制](./06-ai-driving-mechanism.md) | 设计 `AiContext` 上下文隔离、行为决策树、伪装者六大策略、神民四种技能决策与有界并发队列（上限 3）。 | 30 min |
| 07 | [规则系统设计](./07-rule-system-design.md) | 定义基础规则集（屠边局 / 7+4+5 配比）、7 个扩展规则、`WerewolfRuleSet` 接口与 JSON Schema 合法性校验。 | 20 min |
| 08 | [UI/UX 设计](./08-ui-ux-design.md) | 规定 16 角色颜色、阵营色 / 状态色、9 个界面 ASCII 线框图与 antd 组件映射，对接 `GameMainPage` 布局。 | 25 min |
| 09 | [数据库设计](./09-database-design.md) | 规划 `werewolf/` 子目录下 8 个 JSON 文件 Schema、与 `GameSaveRepository` / `GameTableRepository` 集成与版本迁移。 | 25 min |
| 10 | [文件目录结构](./10-file-directory-structure.md) | 规划主进程 9 个服务 + 1 个 Prompt 构建器、6 个 IPC handler、渲染进程模板与共享类型 / 常量目录。 | 20 min |
| 11 | [核心模块划分](./11-core-module-division.md) | 拆分 M1-M8 八大模块，给出 ASCII 依赖图、输入输出接口草案、复用矩阵与 5 个 Sprint 开发优先级。 | 25 min |
| 12 | [法官提示词约束](./12-judge-prompt-constraints.md) | 提供三大最高核心指令、`werewolf-judge-system-v1` 完整 system prompt、各场景 Prompt 与 AI 互检三层监管。 | 30 min |
| 13 | [策划阶段总结](./13-design-summary.md) | 14 份交付文档清单与摘要、与 `add-game-mode-framework` 的 13 个对接点、风险清单、开放问题与下一阶段实现 spec 拆分建议。 | 15 min |
| 14 | README 导航（本文档） | 14 份文档的导航入口、阅读顺序、依赖关系图与快速索引。 | 5 min |

> **说明**：编号 01-14 已全部完成并落盘。

---

## 2. 推荐阅读顺序

阅读顺序遵循"先架构后细节、先机制后实现"原则，每个阶段的目的说明如下：

| 阅读阶段 | 文档 | 阅读目的 |
| :---: | :--- | :--- |
| 1 | [01 系统架构](./01-system-architecture.md) | 建立全局视角：理解六大子系统职责边界、数据隔离五层与术语表，为后续文档提供统一概念基础。 |
| 2 | [02 法官系统](./02-judge-system-design.md) | 理解游戏核心驱动力：法官 AI 的五大职责、暗码协议与真相剧本格式是后续所有机制的基础。 |
| 3 | [03 角色系统](./03-character-system-design.md) | 掌握参与者档案：角色数据结构、阵营配比（7+4+5）与四大神民技能机制。 |
| 4 | [04 地图系统](./04-map-system-design.md) | 理解空间载体：四层楼结构、房卡权限与可搜索点位是现场调查环节的物理基础。 |
| 5 | [05 游戏流程](./05-game-flow-design.md) | 串起完整循环：八大阶段状态机定义了从夜间到日间的完整数据流与 UI 切换。 |
| 6 | [06 AI 驱动机制](./06-ai-driving-mechanism.md) | 理解智能体行为：上下文隔离矩阵与伪装者 / 神民策略决策树是游戏可玩性的关键。 |
| 7 | [07 规则系统](./07-rule-system-design.md) | 明确博弈边界：基础规则集与 7 个扩展规则定义了胜负条件与合法性约束。 |
| 8 | [08 UI/UX 设计](./08-ui-ux-design.md) | 可视化呈现：9 个线框图与 antd 组件映射将机制转化为玩家可操作的界面。 |
| 9 | [09 数据库设计](./09-database-design.md) | 持久化方案：8 个 JSON Schema 与存档轮转策略保证游戏状态可恢复。 |
| 10 | [10 文件目录结构](./10-file-directory-structure.md) | 工程化落位：明确每个服务 / handler / 组件的源码位置，为实现阶段铺路。 |
| 11 | [11 核心模块划分](./11-core-module-division.md) | 模块化拆分：M1-M8 八大模块的接口草案与依赖图指导并行开发与测试策略。 |
| 12 | [12 法官提示词约束](./12-judge-prompt-constraints.md) | Prompt 工程细节：完整 system prompt 模板与各场景 Prompt 是 AI 行为一致性的保障。 |
| 13 | [13 策划阶段总结](./13-design-summary.md) | 收尾与展望：汇总对接点、风险与下一阶段实现 spec 拆分建议。 |

> **快速路径**：若仅需了解游戏机制，阅读 01 → 05 → 07 三份即可；若需进入实现阶段，必须按完整顺序阅读 01-12。

---

## 3. 文档间依赖关系图

以下 ASCII 依赖图基于 [01-system-architecture.md §8.2](./01-system-architecture.md#82-文档间依赖关系) 扩展，标注了每份文档的依赖来源：

```
                    ┌──────────────────────────────────┐
                    │  01-system-architecture（基础）    │
                    │  术语表 / 全景图 / 复用清单         │
                    └──────────────┬───────────────────┘
                                   │ 被所有文档依赖
            ┌──────────────┬───────┴───────┬──────────────┐
            ▼              ▼               ▼              ▼
       ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
       │ 02 法官 │   │ 03 角色  │   │ 04 地图  │   │ 07 规则  │
       └────┬────┘   └──────────┘   └──────────┘   └──────────┘
            │
            ├─→ 06-ai-driving（AI 驱动）← 依赖 02 法官
            │
            └─→ 12-prompt-constraints（提示词）← 依赖 02 法官

       ┌─────────────────────────────────────────────────┐
       │  05-game-flow（流程）← 依赖 02 / 03 / 04 / 07    │
       └────────────────────┬────────────────────────────┘
                            │
       ┌────────────────────┼────────────────────────────┐
       ▼                    ▼                            ▼
  ┌──────────┐      ┌──────────────┐           ┌──────────────────┐
  │ 08 UI/UX │      │ 09 数据库    │           │ 10 文件目录      │
  └──────────┘      └──────────────┘           └──────────────────┘
       │                    │                            │
       └────────────────────┼────────────────────────────┘
                            ▼
                ┌──────────────────────────┐
                │  11-module-division（模块）│
                │  ← 依赖 02~07 + 08/09/10 │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  13-summary（总结）       │
                │  ← 依赖全部 01~12         │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  README（导航，本文档）   │
                │  ← 依赖全部 01~13         │
                └──────────────────────────┘
```

**依赖说明**：
- **基础层**：01 是所有文档的基础，提供术语表与全景图。
- **子系统层**：02 / 03 / 04 / 07 相互独立，可并行阅读。
- **耦合层**：06（AI 驱动）与 12（提示词）强依赖 02（法官）；05（流程）依赖 02 / 03 / 04 / 07。
- **工程层**：08 / 09 / 10 依赖全部子系统文档；11（模块）依赖 02~10。
- **收尾层**：13（总结）与 README 依赖全部前序文档。

---

## 4. 文档版本与维护说明

### 4.1 版本号规则

采用 [语义化版本号](https://semver.org/lang/zh-CN/) `MAJOR.MINOR.PATCH`：

| 版本段 | 触发条件 | 示例 |
| :---: | :--- | :--- |
| **MAJOR** | 文档结构性重构（章节拆分 / 合并 / 删除）、术语表重大变更、与既有框架对接方式根本性调整 | `1.0.0` → `2.0.0` |
| **MINOR** | 新增章节、新增子模块设计、扩展规则集扩充、数据结构向后兼容的字段新增 | `1.0.0` → `1.1.0` |
| **PATCH** | 修正错别字、补充说明、修复交叉引用链接、优化表述（不改变语义） | `1.0.0` → `1.0.1` |

### 4.2 当前版本

- **策划阶段整体版本**：`v1.0.0`（首次完整交付）
- **各文档版本**：见各文档头部的 `Version` 字段
- **版本同步策略**：MAJOR / MINOR 版本变更需同步更新本 README 的文档清单表与依赖关系图

### 4.3 变更记录位置

每份文档末尾维护 `## Changelog` 章节，格式如下：

```markdown
## Changelog

### v1.0.0 (2026-07-XX)
- 首次创建文档
- 覆盖 XXX 内容

### v1.0.1 (2026-07-XX)
- 修复 §X.X 中术语与 01-system-architecture.md 术语表不一致问题
```

### 4.4 维护人字段

每份文档头部维护 `Maintainer` 字段：

```markdown
> **Maintainer**: <负责人>
> **Version**: v1.0.0
> **Last Updated**: YYYY-MM-DD
```

### 4.5 文档一致性约束

- 所有文档术语必须与 [01-system-architecture.md §9 术语表](./01-system-architecture.md#9-术语表) 一致
- 跨文档引用必须使用相对路径链接（如 `[02 法官](./02-judge-system-design.md)`）
- 数据结构（如 `WerewolfCharacter` / `TruthScript` / `WerewolfPhase`）在多处定义必须保持一致

---

## 5. 与既有 doc/10-game-mode-module.md 的衔接关系

### 5.1 衔接定位

本策划文档集作为既有 [`doc/10-game-mode-module.md`](../../doc/10-game-mode-module.md) 的**狼人杀章节延伸**，遵循既有文档的章节结构对齐策略（详见 [01-system-architecture.md §8.1](./01-system-architecture.md#81-与-doc10-game-mode-modulemd-的衔接)）：

| `doc/10` 章节结构 | 对应本策划文档 |
| :--- | :--- |
| 模块功能描述 | [01-system-architecture.md](./01-system-architecture.md) |
| 组件树 | [11-core-module-division.md](./11-core-module-division.md) |
| IPC 接口表 | [10-file-directory-structure.md](./10-file-directory-structure.md) |
| 表格 schema | [09-database-design.md](./09-database-design.md) |
| AI prompt 构建流程 | [12-judge-prompt-constraints.md](./12-judge-prompt-constraints.md) |
| 扩展指南 | [13-design-summary.md](./13-design-summary.md) |

### 5.2 文件状态说明

> ⚠️ **注意**：截至本次 README 创建时（2026-07-17），`doc/10-game-mode-module.md` 文件在仓库中**尚未创建**（通过 Glob 搜索 `**/10-game-mode-module.md` 无结果）。01-system-architecture.md §8.1 已引用该路径作为衔接目标，待既有文档体系补充后该链接即可生效。

### 5.3 后续实现阶段的文档规划

本策划阶段（Phase 0）交付设计文档后，下一阶段（实现阶段）将在 `doc/` 目录下新增狼人杀模块的实现文档：

| 阶段 | 文档路径 | 内容 |
| :--- | :--- | :--- |
| Phase 0（当前） | `docs/werewolf-game/01~13 + README.md` | 策划设计文档（本目录） |
| Phase 1（计划） | `doc/11-werewolf-module.md` | 狼人杀模块实现说明（对接 `doc/10` 的狼人杀章节） |
| Phase 2+（计划） | `.trae/specs/implement-werewolf-*-*/` | 拆分为 5 个实现 spec（详见 13 号文档 §5 拆分建议） |

---

## 6. 快速索引

按主题分类的文档索引表，便于按需查阅：

| 想了解的主题 | 直接阅读 | 关键章节 |
| :--- | :--- | :--- |
| **游戏整体架构与术语** | [01 系统架构](./01-system-architecture.md) | §3 子系统职责矩阵、§9 术语表 |
| **法官 AI 系统** | [02 法官系统](./02-judge-system-design.md) + [12 提示词约束](./12-judge-prompt-constraints.md) | 02 §2 法官职责、12 §1 system prompt 模板 |
| **角色档案与阵营分配** | [03 角色系统](./03-character-system-design.md) | §2 WerewolfCharacter、§4 阵营分配算法 |
| **地图与可搜索点位** | [04 地图系统](./04-map-system-design.md) | §2 四层楼结构、§5 可搜索点位模型 |
| **游戏阶段与状态机** | [05 游戏流程](./05-game-flow-design.md) | §2 WerewolfPhase 枚举、§3 phaseTransitions |
| **AI 上下文隔离与行为策略** | [06 AI 驱动](./06-ai-driving-mechanism.md) | §2 AiContext、§5 伪装者六大策略 |
| **基础规则与扩展规则** | [07 规则系统](./07-rule-system-design.md) | §2 基础规则集、§3 扩展规则、§6 胜负条件 |
| **UI 线框图与配色** | [08 UI/UX 设计](./08-ui-ux-design.md) | §3 配色规范、§4-§12 线框图 |
| **数据存储与存档结构** | [09 数据库设计](./09-database-design.md) | §2 存档目录树、§3-§10 JSON Schema |
| **源码目录与文件职责** | [10 文件目录结构](./10-file-directory-structure.md) | §3 主进程服务、§4 IPC handler、§5 渲染进程 |
| **核心模块接口与依赖** | [11 核心模块划分](./11-core-module-division.md) | §2 M1-M8 清单、§3 依赖图、§4 接口草案 |
| **暗码标记协议** | [02 法官系统](./02-judge-system-design.md) §4 + [12 提示词](./12-judge-prompt-constraints.md) §2 | 02 §4.3 三必须原则、12 §2.3 正则校验 |
| **真相剧本格式** | [02 法官系统](./02-judge-system-design.md) §5 + [12 提示词](./12-judge-prompt-constraints.md) §3 | 02 §5.2 TruthScript Interface、12 §3.2 生成 Prompt |
| **数据隔离五层** | [01 系统架构](./01-system-architecture.md) §4 + [06 AI 驱动](./06-ai-driving-mechanism.md) §3 | 01 §4.2 数据隔离、06 §3 可见性矩阵 |
| **与既有框架对接** | [01 系统架构](./01-system-architecture.md) §5 + [11 核心模块](./11-core-module-division.md) §5 | 01 §5 复用清单、11 §5 复用矩阵 |
| **开发优先级与并行度** | [11 核心模块划分](./11-core-module-division.md) | §7 开发优先级、§8 5 个 Sprint |
| **测试策略** | [11 核心模块划分](./11-core-module-division.md) | §6 测试策略（单元 / 集成 / e2e） |

---

## 7. 阅读前准备

阅读本策划文档集前，建议先了解以下背景资料：

1. **规则剧本**：[逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt) —— 游戏玩法的原始需求来源
2. **既有框架 spec**：[add-game-mode-framework spec](../../.trae/specs/add-game-mode-framework/spec.md) —— 本游戏复用的基础设施
3. **既有经营模板**：[`src/main/services/game/templates/management/`](../../src/main/services/game/templates/management/) —— 狼人杀模板的实现参考样本
4. **既有占位**：[`src/renderer/components/Game/templates/WerewolfTemplate.ts`](../../src/renderer/components/Game/templates/WerewolfTemplate.ts) —— 当前 `PLANNED` 状态，实现阶段替换

---

## Changelog

### v1.0.0 (2026-07-17)
- 首次创建 README 导航文档
- 覆盖 7 个章节：标题简介、14 文档清单表、推荐阅读顺序、ASCII 依赖关系图、版本与维护说明、与 `doc/10` 衔接关系、快速索引
- 标注 13-design-summary.md 已完成创建（v1.0.0）
- 标注 `doc/10-game-mode-module.md` 在仓库中尚未创建
- 严格对齐 [01-system-architecture.md §9 术语表](./01-system-architecture.md#9-术语表)
