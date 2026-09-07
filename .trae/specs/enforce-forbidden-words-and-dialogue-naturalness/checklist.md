# Checklist

## 禁词接线（Task 1）
- [x] dialogue 请求的 system prompt 含 Forbidden Word List 块（配置启用时）
- [x] continuation（续写）请求同样注入
- [x] user-reply（用户回复生成）请求同样注入
- [x] 未启用/空类别时零注入、零额外 token
- [x] system prompt 已含禁词块时不重复注入（锚点守卫）
- [x] 日志输出注入的类别数

## 配置与设置面板（Task 2）
- [x] ForbiddenWordsConfig 含 enforcement / replacementText / maxRetries 可选字段
- [x] 存量配置（无新字段）读取时取默认值，不报错不迁移
- [x] 设置面板可切换三种执行模式并保存生效
- [x] retry-and-replace 模式下替换文本/重试次数可编辑
- [x] "对话自然度"分组含：对话去AI味开关（默认开）、采样预设开关（默认关）

## 合规检测器（Task 3）
- [x] 中文禁词子串命中（如"冰冷的"）
- [x] 英文禁词全词匹配（\b 边界，"ass" 不误匹配 "class"）
- [x] 大小写不敏感命中
- [x] 空 words / 空内容 / 未启用配置短路返回 clean
- [x] 多类别全部检测（任一类别命中即报告）
- [x] 1000+ 禁词性能 < 50ms

## 硬执行层（Task 4）
- [x] 命中且 retry 模式：自动重试并带违规反馈，≤ maxRetries 次
- [x] 重试后干净：显示干净版本，日志 result=clean-by-retry
- [x] 重试超限且 retry-and-replace：命中词替换为 replacementText 入库，其余文本不变
- [x] prompt-only 模式：不重试不替换，仅日志
- [x] 流式场景不向用户展示中间脏内容（重试期间）
- [x] 每轮响应输出 [Compliance] 日志（含无命中的 clean 轮）
- [x] 对话去AI味规则块注入点与禁词注入点共存不冲突

## 对话去AI味变体（Task 5）
- [x] HUMANIZER_DIALOGUE_RULES 含 RP 词表 + 完整 27 模式指南（不简写）
- [x] 文体总则为"像真人说话"（非百科条目化、非 JSON 声明）
- [x] 开关关闭时规则块完全撤下
- [x] 与 applyMinimalDialogueRules（reduce-dialogue-ai-flavor）锚点互不冲突、同时注入无重复
- [x] 测试规模下限断言存在（防蒸馏退化）

## 采样预设（Task 6）
- [x] qwen 系引擎：预设 temp 0.7 / top_p 0.8 / min_p 0.0（开关开时）
- [x] gemma 系引擎：预设 temp 1.0 / top_p 0.95 / min_p 0.01
- [x] 未匹配系列：采样参数保持用户配置不变
- [x] 开关默认关；关闭时请求 body 与改动前完全一致
- [x] 不修改引擎配置持久化（仅请求级覆盖）
- [x] 覆盖日志输出

## 整体验证（Task 7）
- [x] 全部新增/修改单测通过（complianceChecker 19 项 + humanizerPolish 36 项含对话变体 9 项）
- [x] tsc 零新增错误（本 spec 涉及文件无错误；存量基线不变）
- [x] dev server 重启后应用启动正常（VITE ready in 441ms）
- [x] 技术文档已增量更新（FIX_RECORDS.md §7.67），⚠️ 标记"Provider 休眠路径接线断裂"根因与防复发条目
- [x] A/B 验证方法已写入文档（指标日志 + 开关切换对比，不建独立框架）
