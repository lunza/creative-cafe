# Checklist

## enrichSystemPrompt 修复
- [x] `AIService.enrichSystemPrompt` 添加 `typeof msg.content === 'string'` 守卫，数组 content 保留不变
- [x] `characterTraitAIService.enrichSystemPrompt` 确认安全并添加注释
- [x] 详细中文注释说明适配规则

## Header 全局能力标识
- [x] Header.tsx 导入 useSettingStore，读取活跃引擎 capabilities
- [x] logo 旁显示能力标识（编辑/眼睛/思考/扳手）
- [x] 条件渲染：仅对应能力=true 时显示
- [x] 未检测时仅显示编辑图标 + Tooltip 提示
- [x] 样式小尺寸，与标题对齐
- [x] 详细中文注释
- [x] 清理未使用的 Badge 导入

## ChatEngine 能力感知
- [x] 审计 sendMessage 请求构建流程
- [x] supportsThinking 感知（enable_chain_of_thought + supportsThinking 双条件）
- [x] use_function_calling 与 supportsToolCalling 一致性确认
- [x] 详细中文注释

## 全量 AI 调用点兼容性审计
- [x] writing 服务审计 + 注释（5 个文件）
- [x] memory 服务审计 + 注释（2 个文件）
- [x] renderer AI 调用点审计 + 注释（6 个文件：AIService.tsx / useWorldBookAIOperations / characterAIUtils / useCreativeAI / WorldBookEditor / ChatEngine）
- [x] aiHandlers.ts 通用转发器审计 + 注释

## 文档
- [x] CHANGELOG.md 新增条目
- [x] PROJECT_DOCUMENTATION_NEW.md 新增兼容性审计小节
- [x] CODE_WIKI.md 更新条目

## TypeScript 检查
- [x] `npx tsc --noEmit` 已执行，修改文件未引入新增 TS 错误
