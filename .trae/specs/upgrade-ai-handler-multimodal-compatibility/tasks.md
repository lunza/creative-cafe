# Tasks

## 阶段一：修复 enrichSystemPrompt 多模态兼容性

- [x] Task 1: 修复 AIService.enrichSystemPrompt 多模态兼容性
  - [x] SubTask 1.1: 添加 `typeof msg.content === 'string'` 守卫
  - [x] SubTask 1.2: 添加详细中文注释说明适配规则
  - [x] SubTask 1.3: 审计 characterTraitAIService.ts 确认安全并添加注释

## 阶段二：Header 全局能力标识

- [x] Task 2: 在主界面 Header logo 旁显示模型能力标识
  - [x] SubTask 2.1: 导入 useSettingStore，读取活跃引擎 capabilities
  - [x] SubTask 2.2: 渲染小尺寸图标 Tag（编辑/眼睛/思考/扳手）
  - [x] SubTask 2.3: 未检测时仅显示编辑图标 + Tooltip 提示
  - [x] SubTask 2.4: 样式适配（14px 图标，与标题对齐）
  - [x] SubTask 2.5: 添加详细中文注释

## 阶段三：ChatEngine 能力感知

- [x] Task 3: ChatEngine 请求构建感知模型能力
  - [x] SubTask 3.1: 审计 sendMessage 请求体构建流程
  - [x] SubTask 3.2: supportsThinking 双条件感知（enable_chain_of_thought + supportsThinking）
  - [x] SubTask 3.3: use_function_calling 与 supportsToolCalling 一致性
  - [x] SubTask 3.4: 添加详细中文注释

## 阶段四：全量 AI 调用点兼容性审计

- [x] Task 4: 审计所有 AI 调用点并添加兼容性注释
  - [x] SubTask 4.1: writing 服务审计 + 注释（5 个文件）
  - [x] SubTask 4.2: memory 服务审计 + 注释（2 个文件）
  - [x] SubTask 4.3: renderer AI 调用点审计 + 注释（6 个文件）
  - [x] SubTask 4.4: aiHandlers.ts 通用转发器审计 + 注释

## 阶段五：验证与文档

- [x] Task 5: 验证
  - [x] SubTask 5.1: TypeScript 编译检查
  - [x] SubTask 5.2: enrichSystemPrompt 修复正确
  - [x] SubTask 5.3: Header 能力标识正确显示
  - [x] SubTask 5.4: ChatEngine 能力感知逻辑正确
  - [x] SubTask 5.5: 所有 AI 调用点兼容性注释完整

- [x] Task 6: 更新技术文档
  - [x] SubTask 6.1: CHANGELOG.md 新增条目
  - [x] SubTask 6.2: PROJECT_DOCUMENTATION_NEW.md 新增兼容性审计小节
  - [x] SubTask 6.3: CODE_WIKI.md 更新 AIService / Header / ChatEngine 条目

# Task Dependencies
- Task 2（Header 标识）独立，可与 Task 1/3/4 并行
- Task 3（ChatEngine 感知）独立，可与 Task 1/2/4 并行
- Task 4（全量审计）独立，可与 Task 1/2/3 并行
- Task 1（enrichSystemPrompt 修复）独立
- Task 5（验证）依赖 Task 1-4 全部完成
- Task 6（文档）依赖 Task 5 验证通过
