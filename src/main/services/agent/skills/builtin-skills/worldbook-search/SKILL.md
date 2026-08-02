---
name: worldbook-search
description: "搜索世界书条目，按关键词、标签或分类检索世界观设定信息。当需要查询世界观设定时使用。支持按关键词搜索世界书条目、按标签筛选、按分类浏览，返回匹配的条目内容。"
emoji: 🌐
user-invocable: true
disable-model-invocation: false
command-name: /worldbook-search
command-tool: searchWorldbook
---

# Worldbook Search

用于搜索世界书条目。本技能调用 `searchWorldbook` 工具，按关键词、标签或分类检索世界观设定信息。

## 使用场景

- 对话中需要引用某个地点的设定细节时，搜索对应条目
- 查找某个人物的背景档案
- 确认某个物品的属性与描述
- 按分类浏览世界书中的设定元素（地点 / 人物 / 物品 / 事件等）
- 对话智能体需要校验世界观一致性时，检索相关条目

## 调用方式

### 模型自主调用

当对话智能体需要查询世界观设定时，调用 `searchWorldbook` 工具：

```
searchWorldbook({
  keyword: "关键词",              // 搜索关键词（可选）
  tags: ["地点", "首都"],          // 按标签筛选（可选）
  category: "location",          // 按分类筛选（可选）
  limit: 20,                     // 返回结果上限（可选，默认 20）
  offset: 0                      // 分页偏移（可选）
})
```

### 用户命令调用

在命令面板输入 `/worldbook-search` 触发世界书搜索。

## 搜索条件

支持以下筛选条件（可组合使用）：

- `keyword`：关键词搜索（匹配条目标题与内容）
- `tags`：按标签筛选（匹配条目标签列表）
- `category`：按分类筛选
  - `location`：地点
  - `character`：人物
  - `item`：物品
  - `event`：事件
  - `lore`：设定/规则
  - `organization`：组织/势力
- `limit`：返回结果数量上限
- `offset`：分页偏移量

## 返回结构

`searchWorldbook` 工具返回 JSON 结构，包含：

- `results`：匹配的条目列表，每条含：
  - `entryId`：条目 ID
  - `title`：条目标题
  - `content`：条目内容
  - `tags`：标签列表
  - `category`：分类
  - `relevanceScore`：相关度评分（0-1）
- `totalCount`：总匹配数
- `hasMore`：是否还有更多结果

## 注意事项

- 搜索条件为空时返回所有条目（按更新时间倒序）
- 关键词搜索同时匹配条目标题与内容，不区分大小写
- 标签筛选为包含匹配（条目标签包含任一指定标签即命中）
- 分类筛选为精确匹配
- 返回结果按相关度评分降序排列
- 大量结果时使用 `limit` + `offset` 分页获取
- 对话智能体可在需要引用世界观设定时自主调用
