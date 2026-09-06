# Checklist

## 提示词构造
- [x] 翻译 user prompt：`<translate_target>` 包裹目标文本，`<context_reference>` 包裹其他字段并声明"禁止翻译或输出其中任何内容"
- [x] 润色 user prompt：`<polish_target>` 同构包裹
- [x] 其他字段全空时 user prompt 不含 context_reference 段落
- [x] translate/polish 模板系统提示含 `{{target_field_label}}` 变量及"仅处理该字段、绝对禁止输出其他字段内容"约束
- [x] generate 模板 user prompt 首行前置目标字段强调
- [x] generate 模板系统提示生成规则含"仅生成目标字段一个字段的内容"
- [x] 三个调用点均传入 target_field_label

## 输出防御
- [x] extractTargetFieldContent：多字段结构输出可提取目标字段段落
- [x] extractTargetFieldContent：无法提取且含 ≥2 个其他字段标签时判定越界（调用方恢复原文 + warning）
- [x] extractTargetFieldContent：标签残留清理生效
- [x] extractTargetFieldContent：正常单字段输出原样透传（无告警）
- [x] 翻译/润色/生成三个写回点均接入防御，越界时目标字段恢复原文值

## 模板迁移
- [x] 存量未修改副本自动迁移至新种子
- [x] 用户自定义修改过的副本不被覆盖（仅日志）
- [x] 全新安装直接获得新模板

## 测试与验证
- [x] extractTargetFieldContent 单测四类用例通过
- [x] 模板种子断言（含 target_field_label 变量注册）通过
- [x] 迁移单测通过
- [x] tsc 零新增错误
- [x] dev server 重启后 Electron 加载新模板代码
- [ ] 手动测试矩阵抽查：Flash 模型下翻译/润色"描述"字段不再输出个性/场景等其他字段内容（待用户实测）

## 兼容性
- [x] 角色卡数据结构（FIELD_DESCRIPTIONS 全部字段）不受影响——防御函数对未知字段 key 直接透传
- [x] Gemma4 系列行为不回归（正常单字段输出路径未被防御误伤，单测覆盖）
- [x] 去AI味规则注入点（withHumanizerTextgenRules/withHumanizerRules）不受影响
- [x] 对话模式润色链路（fix-polish-* 系列）不受影响（不同代码路径）
