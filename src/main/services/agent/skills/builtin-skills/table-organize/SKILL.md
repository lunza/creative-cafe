---
name: table-organize
description: "整理与更新状态表（角色状态/物品/关系/时间线等表格数据）。当用户请求整理表格、添加/修改/删除表格行、或 AI 自主维护状态表时使用。通过原生工具调用执行表格操作，替代旧版 <tableEdit> 文本协议，支持批量操作与结果反馈。"
emoji: 📊
user-invocable: true
disable-model-invocation: false
command-name: /table-organize
command-tool: updateStateTable
---

# Table Organize

用于整理与更新状态表。本技能调用 `updateStateTable` 工具，通过原生工具调用执行表格操作。

## 使用场景

- 写完一章后，更新角色的状态变化（位置、装备、状态值）
- 新角色登场时，添加到角色表
- 物品变动时，更新物品表
- 关系变化时，更新关系表
- 时间推进时，更新时间线表
- AI 自主维护状态表（写作智能体模式）

## 调用方式

### 模型自主调用

当 AI 判断需要更新状态表时（如章节中出现状态变化），调用 `updateStateTable` 工具：

```
updateStateTable({
  commands: [
    {
      type: "insertRow",
      tableIndex: 1,
      data: { "1": "李四", "2": "反派", "3": "存活" }
    },
    {
      type: "updateRow",
      tableIndex: 1,
      rowIndex: 2,
      data: { "3": "已死亡" }
    },
    {
      type: "deleteRow",
      tableIndex: 2,
      rowIndex: 5
    }
  ]
})
```

### 用户命令调用

在命令面板输入 `/table-organize` 触发表格整理向导。

## 命令格式

每个 command 包含：

- `type`：命令类型
  - `insertRow`：插入新行
  - `updateRow`：更新已有行
  - `deleteRow`：删除行
- `tableIndex`：目标表格序号（1-based，整数 ≥ 1）
- `rowIndex`：目标行序号（1-based，updateRow/deleteRow 必填）
- `data`：行数据（键值对）
  - 数字键（`"1"`, `"2"`, ...）：1-based 列序号
  - 命名键：列名

## 返回结构

`updateStateTable` 工具返回 JSON 结构，包含：

- `success`：是否全部成功
- `executed`：执行的命令数
- `errors`：错误列表（部分失败时）
- `tableSnapshot`：更新后的表格快照（可选）

## 表格类型

不同模式下的表格组：

### 对话模式（dialogue）
- 角色状态表（位置、心情、状态）
- 物品表（持有物品、位置）
- 关系表（角色间关系值）

### 写作模式（writing）
- 角色表（全部出场角色）
- 物品表（剧情物品）
- 关系表（角色关系网络）
- 时间线表（关键事件时间点）
- 地点表（已建立的场景）

### 游戏模式（game）
- 玩家状态表
- NPC 表
- 物品表
- 任务表

## 注意事项

- `tableIndex` 和 `rowIndex` 均为 1-based（从 1 开始计数）
- `insertRow` 不需要 `rowIndex`（追加到表格末尾）
- `updateRow` 和 `deleteRow` 必须提供 `rowIndex`
- 批量操作时，命令按顺序执行，部分失败不影响后续命令
- 工具调用前会校验索引范围，越界时返回错误而非崩溃
- 旧版 `<tableEdit>` 文本协议仍可作为降级路径（模型不支持 tool calling 时）
