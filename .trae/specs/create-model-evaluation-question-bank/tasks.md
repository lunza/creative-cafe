# Tasks

- [x] Task 1: 分析出题素材 — 解析 B:\Desktop\新建文件夹 (2) 下 3 张角色卡 PNG 和世界书 JSON，提取可用于出题的非 NSFW 内容（角色设定、性格、世界观、规则）
  - [x] SubTask 1.1: 解析世界书「福瑞狼人杀」内容，提取角色名、性格、游戏规则、互动格式（过滤 NSFW）
  - [x] SubTask 1.2: 解析 3 个角色卡 PNG 的角色数据（name / description / personality / scenario）
  - [x] SubTask 1.3: 汇总可用素材清单，标注每个场景可用的素材与需模拟的素材
- [x] Task 2: 定义维度与难度体系 — 建立 D-01 至 D-08 八个测评维度，明确各维度能力范围与评估重点
  - [x] SubTask 2.1: 编写 8 个维度的定义（能力范围、评估重点、适用场景）
  - [x] SubTask 2.2: 定义动态参数复杂度分级标准（L1 简单 / L2 中等 / L3 困难）
  - [x] SubTask 2.3: 建立百分级六级评分通用框架（S/A/B/C/D/E）
- [x] Task 3: 编写核心维度题目（D-01 角色扮演对话）— 结合角色卡与世界书
  - [x] SubTask 3.1: 设计 L1 简单题 2 道（单一动态参数）
  - [x] SubTask 3.2: 设计 L2 中等题 2 道（多参数组合）
  - [x] SubTask 3.3: 设计 L3 困难题 2 道（复杂上下文推理）
  - [x] SubTask 3.4: 编写每道题的标准答案
  - [x] SubTask 3.5: 编写每道题的评分标准
- [x] Task 4: 编写图片相关维度题目（D-02 特征标签提取、D-03 图片提示词构建）
  - [x] SubTask 4.1: D-02 L1/L2/L3 各 2 道题（结合角色卡特征）
  - [x] SubTask 4.2: D-03 L1/L2/L3 各 2 道题
  - [x] SubTask 4.3: 编写标准答案与评分标准
- [x] Task 5: 编写写作相关维度题目（D-04 小说内容生成、D-05 文本润色与改写）
  - [x] SubTask 5.1: D-04 L1/L2/L3 各 2 道题（结合世界书世界观）
  - [x] SubTask 5.2: D-05 L1/L2/L3 各 2 道题
  - [x] SubTask 5.3: 编写标准答案与评分标准
- [x] Task 6: 编写逻辑与结构化维度题目（D-06 逻辑推理、D-07 信息提取、D-08 指令遵循）
  - [x] SubTask 6.1: D-06 L1/L2/L3 各 2 道题（结合狼人杀规则）
  - [x] SubTask 6.2: D-07 L1/L2/L3 各 2 道题
  - [x] SubTask 6.3: D-08 L1/L2/L3 各 2 道题
  - [x] SubTask 6.4: 编写标准答案与评分标准
- [x] Task 7: 编译题库文档 — 将全部题目组织为层级结构并输出到 docs/ai-scenarios/测评题库.md
  - [x] SubTask 7.1: 组装文档结构（维度概述 → 各维度 → 难度级别 → 题目 → 标准答案 → 评分标准）
  - [x] SubTask 7.2: 格式审核与一致性检查（8 维度 × 3 难度 × 2 题题量一致性）
  - [x] SubTask 7.3: NSFW 内容终审（确保题库无任何 NSFW 内容残留）

## Task Dependencies

- [Task 2] depends on [Task 1] — 需先确定可用素材
- [Task 3, 4, 5, 6] depends on [Task 2] — 需先确定维度体系
- [Task 7] depends on [Task 3, 4, 5, 6]