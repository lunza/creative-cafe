---
name: description-polish
description: "润色章节中的描写片段（场景/人物/动作/心理/对话）。当用户请求优化文笔、增强描写、调整氛围、或对指定段落进行润色时使用。保持原文情节不变，仅提升描写的细腻度、画面感与文学性。"
emoji: ✨
user-invocable: true
disable-model-invocation: false
command-name: /description-polish
command-tool: polishDescription
---

# Description Polish

用于润色小说章节中的描写片段。本技能调用 `polishDescription` 工具，对指定文本进行文学性增强。

## 使用场景

- 觉得某段场景描写过于干瘪，希望增强画面感
- 人物外貌描写需要更细腻
- 动作戏需要更流畅的节奏感
- 心理活动需要更深入的刻画
- 对话需要更符合角色性格
- 整体文风需要统一（如更偏古风/现代/科幻）

## 调用方式

### 模型自主调用

当用户请求"润色这段"、"优化描写"、"文笔太干"等时，模型应调用 `polishDescription` 工具：

```
polishDescription({
  originalText: "他走进了房间，看到了一把剑。",  // 待润色的原文
  polishTarget: "scene",                          // 润色目标类型
  style: {                                        // 风格偏好（可选）
    tone: "肃杀",
    detail: "high",                               // 细节程度 low/medium/high
    sensory: ["visual", "auditory"]               // 感官维度
  },
  context: {                                      // 上下文（可选）
    characterCards: [...],
    worldBookEntries: [...],
    surroundingText: "前文..."
  },
  preservePlot: true                              // 是否保持情节不变（默认 true）
})
```

### 用户命令调用

在命令面板输入 `/description-polish`，然后在编辑器中选中待润色的文本触发。

## 润色目标类型

`polishTarget` 支持以下类型：

- `scene`：场景描写（环境、氛围、空间感）
- `character`：人物描写（外貌、神态、气质）
- `action`：动作描写（战斗、运动、肢体语言）
- `psychology`：心理描写（内心独白、情绪变化）
- `dialogue`：对话（台词节奏、语气、潜台词）
- `sensory`：感官描写（视/听/嗅/味/触）
- `comprehensive`：综合润色（以上全部，默认）

## 返回结构

`polishDescription` 工具返回 JSON 结构，包含：

- `polishedText`：润色后的文本
- `changes`：修改点列表，每项含：
  - `type`：修改类型（added/modified/removed）
  - `original`：原文片段
  - `polished`：润色后片段
  - `reason`：修改原因
- `wordCountBefore`：润色前字数
- `wordCountAfter`：润色后字数
- `styleAlignment`：风格一致度评分（0-100）

## 润色原则

1. **保持情节不变**：`preservePlot=true` 时，不改变事件顺序与因果关系
2. **保持角色一致**：人物言行符合角色卡设定
3. **保持世界观一致**：描写符合世界书规则（如魔法体系、科技水平）
4. **增强而非重写**：在原文基础上增强，不推翻重写
5. **风格统一**：与整体文风保持一致，避免突兀

## 注意事项

- 润色后建议用户对比原文，确认是否符合预期
- 长段落建议分段润色，避免单次处理过长文本
- `polishTarget` 指定具体类型时，润色更精准；`comprehensive` 适用于整体提升
- 若润色结果不满意，可调整 `style` 参数重新润色
