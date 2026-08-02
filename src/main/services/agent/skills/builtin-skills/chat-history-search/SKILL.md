---
name: chat-history-search
description: "搜索和检索聊天历史记录，按关键词、时间范围或角色筛选对话内容。当需要查找历史对话内容时使用。支持按关键词搜索、按时间范围筛选、按角色过滤，返回匹配的聊天记录片段。"
emoji: 🔎
user-invocable: true
disable-model-invocation: false
command-name: /chat-history-search
command-tool: searchChatHistory
---

# Chat History Search

用于搜索和检索聊天历史记录。本技能调用 `searchChatHistory` 工具，按关键词、时间范围或角色筛选对话内容。

## 使用场景

- 需要回忆之前对话中提到的某个话题或事件
- 查找某个角色在历史对话中的发言记录
- 按时间范围检索特定时段的对话内容
- 对话智能体需要引用前文语境时，检索相关历史片段
- 用户想回顾某段特定对话的详细内容

## 调用方式

### 模型自主调用

当对话智能体需要查找历史对话内容时，调用 `searchChatHistory` 工具：

```
searchChatHistory({
  keyword: "关键词",              // 搜索关键词（可选）
  characterFilter: "角色名",      // 按角色过滤（可选）
  timeRange: {                    // 时间范围（可选）
    start: "2024-01-01T00:00:00Z",
    end: "2024-12-31T23:59:59Z"
  },
  limit: 20,                      // 返回结果上限（可选，默认 20）
  offset: 0                       // 分页偏移（可选）
})
```

### 用户命令调用

在命令面板输入 `/chat-history-search` 触发聊天历史搜索。

## 搜索条件

支持以下筛选条件（可组合使用）：

- `keyword`：关键词搜索（匹配对话内容文本）
- `characterFilter`：按角色过滤（仅返回该角色参与的对话）
- `timeRange`：按时间范围筛选（`start` / `end`）
- `limit`：返回结果数量上限
- `offset`：分页偏移量

## 返回结构

`searchChatHistory` 工具返回 JSON 结构，包含：

- `results`：匹配的聊天记录列表，每条含：
  - `messageId`：消息 ID
  - `character`：发言角色
  - `content`：消息内容
  - `timestamp`：消息时间戳
  - `context`：上下文摘要（前后各 1-2 条消息）
- `totalCount`：总匹配数
- `hasMore`：是否还有更多结果

## 注意事项

- 搜索条件为空时返回最近的对话记录（按时间倒序）
- 关键词搜索为模糊匹配，不区分大小写
- 时间范围均为可选，可仅指定 `start` 或 `end`
- 返回结果按时间倒序排列（最新的在前）
- 大量结果时使用 `limit` + `offset` 分页获取
- 对话智能体可在需要引用历史语境时自主调用
