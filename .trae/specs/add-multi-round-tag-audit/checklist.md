# Checklist

- [x] `userSynonymMapService` 持久化到 `{userData}/data/user-synonym-map.json`，提供 load/getMap/addMapping/removeMapping/lookup 方法
- [x] IPC `tagRag:getUserSynonymMap` / `tagRag:addUserSynonymMapping` / `tagRag:removeUserSynonymMapping` 注册 + preload 暴露
- [x] `validateTagsAgainstLibrary` L0 分支：自定义映射命中 → isValid=true, canonicalName=映射目标, source='user-map'
- [x] L0 在 L1 之前查询，命中则跳过 L1-L4
- [x] `NEGATION_MODIFIERS` 常量含 brimless/sleeveless/strapless/topless/bottomless/hairless/wireless/collarless
- [x] `stripNegationModifier` 正确剥离：brimless cap → cap；sleeveless dress → dress；short hair → 空串（不剥离）
- [x] L3b 在 L3 颜色拆分之后、L4 KNN 之前；仅 L0-L3 未命中时触发
- [x] brimless cap → L3b 剥离 → cap → hat（alias 命中）→ isValid=true, canonicalName=hat, source='negation-strip'
- [x] `validateTagsAgainstLibrary` 返回类型含 `source?` 字段，L0-L4 各分支设对应值
- [x] RagQualityReport 对 isValid=false 项显示「手动替换」按钮 + inline 输入框
- [x] 手动替换：trait.text 更新 + IPC 持久化映射 + ragDebug 标记 manuallyReplaced
- [x] manuallyReplaced 项显示「🟣 已手动替换」+ 撤销按钮
- [x] 撤销手动替换：还原 trait.text + 删除映射记录 + 清除 ragDebug 标记
- [x] tsc 类型检查通过（新增/修改文件无新错误）
- [x] vitest 全部测试通过（含 L0/L3b/userSynonymMapService 新测试）
- [x] docs/FIX_RECORDS.md 追加多轮审计机制记录
- [x] CODE_WIKI.md 更新匹配链描述（L0-L4 六层 + source 字段 + userSynonymMapService）
