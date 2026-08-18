# AI 模型使用场景清单规格

## Why

在图片提示词生成、文本解析提示词 tag 生成等图片相关应用场景中，部分 AI 模型的输出准确率未达项目预期标准。为系统性解决此问题，需对项目全部源代码、系统注释、开发文档及应用聊天记录进行全面扫描与分析，识别并提取所有 AI 模型使用场景，形成一份结构清晰、内容详尽的场景清单文档。该清单将作为后续模型能力测试的核心依据，用于筛选最适合角色扮演、图片提示词生成、小说编写等多场景需求的本地部署小模型（20-35B 参数规模）。

## What Changes

- 对 `src/main/` 和 `src/renderer/` 全部源代码进行系统性扫描，识别所有 AI 模型调用入口
- 对 `.trae/specs/`、`.trae/documents/`、`docs/`、`CHANGELOG.md`、`FIX_RECORDS.md` 等开发文档进行扫描，提取场景上下文
- 对 `C:\Users\master\AppData\Roaming\creative-cafe\data` 下聊天记录进行分析，获取调用频率估算依据
- 创建 `docs/ai-scenarios/场景清单.md` 文档，包含每个 AI 使用场景的完整信息
- 文档不修改任何现有代码，仅产出分析文档

## Impact

- 受影响的范围：全部 AI 相关代码模块的分析
- 受影响的代码：无（仅产出分析文档，不修改代码）
- 新增文件：`docs/ai-scenarios/场景清单.md`

## 场景清单文档结构要求

每个场景必须包含以下 5 个部分：

### 1. 功能描述与精确定位
- 场景功能用途说明
- 业务价值说明
- 代码位置（文件路径、类/函数名称、行号范围）
- 完整的使用样例代码片段

### 2. 系统提示词样例
- 完整的拼接后系统提示词
- 动态传参使用规范占位符 `${parameter_name}`
- 说明各占位符的实际含义

### 3. 输入 AI 引擎的参数说明
- 参数名称
- 数据类型（string, number, boolean, object, array 等）
- 允许的取值范围或枚举值
- 参数是否必填
- 具体使用示例

### 4. 期望 AI 输出参数定义
- 输出数据结构（JSON Schema 定义）
- 格式要求（分隔符、缩进格式等）
- 字段说明
- 完整输出示例

### 5. 调用频率统计与重要程度分级
- 调用频率估算（高频/中频/低频）
- 业务重要性分级（P0-P3，P0 为最高优先级）

## 扫描范围

### 源代码
- `src/main/services/` — 主进程 AI 服务层
- `src/main/ipc/handlers/` — IPC 处理器
- `src/renderer/components/character/characterdialoguechat/pipeline/` — 对话管线
- `src/renderer/components/character/characterdialoguechat/PromptBuilder.ts` — 提示词构建
- `src/renderer/components/Common/ChatEngine/` — 聊天引擎封装
- `src/renderer/components/Common/AIService.tsx` — 渲染进程 AI 服务
- `src/renderer/components/AgentCenter/` — 智能体中心
- `src/renderer/components/Avatar/` — 头像相关
- `src/renderer/components/Chat/` — 统合聊天界面
- `src/renderer/components/Creative/` — 创作中心

### 开发文档
- `.trae/specs/*/spec.md` — 所有历史规格文档
- `.trae/documents/*.md` — 技术文档
- `docs/` — 项目文档目录
- `CHANGELOG.md` — 变更日志
- `docs/FIX_RECORDS.md` — 修复记录

### 应用数据
- `C:\Users\master\AppData\Roaming\creative-cafe\data` — 聊天记录与应用数据

## 场景覆盖定义

预期覆盖以下主要 AI 使用场景（不限于此清单，需在扫描中确认）：

| 场景类别 | 说明 |
|---------|------|
| 角色对话 | 角色扮演对话生成 |
| 角色特征生成 | 从角色卡提取视觉特征 tag |
| AI 标签兜底审核 | 未匹配标签同义词/拆分词生成 |
| 图片提示词生成 | 对话场景图片生成提示词 |
| 表情生成 | 角色表情 AI 生成 |
| 小说写作 | 章节生成、大纲生成、内容润色 |
| 剧情检查 | 小说逻辑检查与评分 |
| 记忆整理 | 聊天记录 AI 结构化整理 |
| 智能体代理 | 智能体模式下的 AI 交互 |
| 知识库问答 | 基于知识库的 AI 问答 |
| 人物资产生成 | 人物资产图片 AI 生成 |
| 世界书智能体 | 世界书条目审核与生成 |
| 嵌入向量 | 文本嵌入向量生成 |
| 标签 RAG | 基于标签库的检索增强生成 |