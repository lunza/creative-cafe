# Checklist

- [x] `writing:pipeline:*` 通道按 spec 实现（listResources/createCharacterCard/init/generateOutline/generateChapter/compose/runAll/status/cancel + progress 事件），preload `writingV2.pipeline` 类型化接入
- [x] 所有流水线方法返回统一信封 `{ success, data?, error?, code? }`，错误为可读中文且含失败阶段，不暴露堆栈
- [x] `pipeline.init` 输入校验生效（chapterCount 1-50 / targetWordCount 1000-200000 / 角色 ≥1 不重复 / 世界书 ≥1 / 资源 id 存在性），非法输入不创建项目
- [x] `runAll` 串行编排正确：任一步失败即停止、保留已完成章节、返回 `stage + partial`；`cancel` 在当前分片完成后停止后续流程
- [x] 资源注入闭环：所选角色卡/世界书 id 写入 `config.resources`，大纲与章节生成实际消费（与 V2 既有注入链路一致）
- [x] `compose` 支持 TXT/MARKDOWN/JSON，返回 `filePath` 与字数统计，文件内容含标题/章节头/正文
- [x] 纯函数单测（validatePipelineInit + assertE2EResult）全部通过；全量测试基线不回归（1466 passed / 2 预存 failed 为当前基线）
- [x] typecheck：新增/修改文件零错误（V1 存量错误不动）
- [x] dev-only E2E 控制台：`import.meta.env.DEV` 才渲染；进度事件实时刷新；结果区显示 verdict/断言明细/报告路径
- [x] E2E 冒烟（3 章 × 2000 字）verdict=PASS：章节数=3、每章字数达标、2 角色名 + 世界书词条注入、导出文件非空、`e2e-report-*.json` 生成
- [x] E2E 全量（3 章共 20000 字）verdict=PASS：总字数 ≥ 16000（80% 阈值）、角色/世界书注入、成书文件可打开
- [x] `docs/writing-pipeline-api.md` 覆盖全部通道（请求/响应 JSON 示例 + 错误码表 + 鉴权说明 + E2E 执行方式）；CODE_WIKI.md 增量更新
- [x] V1 代码零改动（仅共享类型/共享 utils 纯增量）；dev server 按 AGENTS.md 规则自动重启生效
