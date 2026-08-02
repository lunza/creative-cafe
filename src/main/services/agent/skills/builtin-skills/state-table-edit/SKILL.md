---
name: state-table-edit
description: "编辑角色状态表，更新角色的属性、关系、位置等状态信息。当对话过程中角色状态发生变化、需要添加或修改状态表条目时使用。支持添加、修改、删除状态表条目，维护角色属性和关系的一致性。"
emoji: 📝
user-invocable: true
disable-model-invocation: false
command-name: /state-table-edit
command-tool: updateStateTable
---

# State Table Edit

用于编辑角色状态表。本技能调用 `updateStateTable` 工具，在对话过程中维护角色属性、关系与位置等状态信息的一致性。

## 使用场景

- 对话中角色位置发生变化时，更新位置状态
- 角色间关系值发生变化时，更新关系表
- 新角色登场时，添加角色状态条目
- 角色属性（心情、状态、装备等）变化时，更新对应字段
- 角色退场或状态重置时，删除或清空条目

## 调用方式

### 模型自主调用

当对话智能体判断需要更新角色状态表时（如对话中出现状态变化），调用 `updateStateTable` 工具：

```
updateStateTable({
  commands: [
    {
      type: "insertRow",
      tableIndex: 1,
      data: { "1": "新角色名", "2": "位置", "3": "状态" }
    },
    {
      type: "updateRow",
      tableIndex: 1,
      rowIndex: 2,
      data: { "3": "已离开" }
    },
    {
      type: "deleteRow",
      tableIndex: 2,
      rowIndex: 3
    }
  ]
})
```

### 用户命令调用

在命令面板输入 `/state-table-edit` 触发状态表编辑向导。

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

## 对话模式状态表

对话模式下的状态表组：

- **角色状态表**：角色名、位置、心情、当前状态
- **关系表**：角色间关系值与关系描述
- **物品表**：角色持有物品及位置

## 注意事项

- `tableIndex` 和 `rowIndex` 均为 1-based（从 1 开始计数）
- `insertRow` 不需要 `rowIndex`（追加到表格末尾）
- `updateRow` 和 `deleteRow` 必须提供 `rowIndex`
- 批量操作时，命令按顺序执行，部分失败不影响后续命令
- 工具调用前会校验索引范围，越界时返回错误而非崩溃
- 对话智能体应在状态发生变化时主动调用，确保状态表与对话内容同步
