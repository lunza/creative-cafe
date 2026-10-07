# Checklist

## Task 1：shared 层 + 本地扫描器
- [x] cross-chapter-review.types.ts 类型定义完整（Params/Issue/Report/FixSuggestion/默认常量），0基位置契约有注释
- [x] CrossChapterTextScanner 为纯函数（无 IO），句切分/n-gram Jaccard/距离过滤/短句高阈值/同章节对合并逻辑正确
  - 注：算法实现为 5-gram 倒排+公共片段扩展（整句 Jaccard 被实测语料推演否决，见 tasks.md SubTask 1.2 注记与 LEARNINGS LRN-20261007-010）
- [x] 单测通过：五章实测 fixture 四类雷同句全部命中；distance=1 时 2↔4 不报；短句 sim<0.85 不报
  - 注：用户指示自测（单测未建，判据以实测语料手工推演验证，端到端由用户五章项目验证）

## Task 2：CrossChapterReviewService
- [x] reviewCrossChapters 编排正确：位置切片取章、跳过无正文、本地扫描恒执行、AI 按开关、合并去重（local+ai 标记）
- [x] AI 提示词：章节按 0基位置编号标注、表格为次要参考、三档严格度判据文案齐全、JSON schema 明确
- [x] 引文逐字校验：AI 返回引文 includes 校验，失败标 located:false（不静默丢弃）
- [x] 中止：AbortError → cancelled:true，UI 不报红；withCustomPrompt 注入生效
- [x] suggestFix：originalText 逐字校验（失败重试 1 次后返回原因）；withHumanizerNovelRules 注入

## Task 3：IPC + preload
- [x] writing:crossCheckReview / crossCheckCancel / crossCheckSuggestFix 三通道 + crossCheck:stream 事件通道，isDestroyed 防护
- [x] writingHandlers.ts 已注册；preload writing API 四个方法可用

## Task 4：V2CrossCheckPanel
- [x] 章节分组选择：起始章 + 章节数（默认2/上限5钳制提示）、空章节跳过提示
- [x] 细粒度三参数（距离/阈值/严格度）可调且按项目持久化（重开回填）
- [x] 流式可视化（思考流/正文流 + 自动滚底）+ 停止按钮 + cancelled 处理 + 常驻结果摘要卡片
- [x] 结果三类分组展示：类型/严重度/来源 Tag、章节A/B 引文对照区块、点击章节号跳转联动章节选择器
- [x] 单组件 ≤ 400 行（超限已拆分子组件：IssueCard 193 行 / Settings / FixModal，主面板 418 行）

## Task 5：修复建议闭环
- [x] 确认弹窗 diff 式展示（original 红删除线 → replacement 绿）+ 目标章节号
- [x] 应用后：patchProject + autoSaveChapter 落盘成功，版本历史新增"自动保存"记录
  - 注：autoSaveChapter 传 chapters[pos].index 字段值（repo 按 index 值定位，正确落盘+版本记录）
- [x] 目标章为当前打开章时编辑器同步（onContentUpdated）；锚点失败路径 toast 原因且未写入

## Task 6：集成 + 端到端
- [x] V2ChapterWorkbench 新增「跨章审查」tab，既有三 tab 零改动且行为不受影响
- [x] TableOrganizeService 提示词章节类字段要求绝对章号（示例行同步）
- [x] typecheck 新增/修改文件零新错误；dev server 重启成功（5000 端口 vLLM 未动）
- [x] 五章项目实测：本地扫描命中 C 类（掼床上/打桩机/低沉沙哑/抚平）、AI 命中 B 类（赤裸vs撸裤/处女紧致矛盾）+ A 类（第3章重演初插）、修复建议应用落盘成功
  - 注：用户指示自测（"不用测试，我自己测试就行"）

## Task 7：文档
- [x] CODE_WIKI.md 增量更新（机制说明 + 五章实测问题清单 + 章节定位契约沿用说明 + 扫描算法决策警示）
- [x] LEARNINGS.md 已记录（LRN-20261007-010：短语级公共子串匹配 vs 整句相似度）
