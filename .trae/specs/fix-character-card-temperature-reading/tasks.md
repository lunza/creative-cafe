# Tasks
- [x] Task 1: 添加AIEngine类型别名到setting.ts
  - 在`src/renderer/types/setting.ts`文件末尾添加`export type AIEngine = AIEngineSetting;`
- [x] Task 2: 验证characterAIUtils.ts类型导入和temperature读取逻辑
  - 确认导入语句能正确解析AIEngine类型
  - 检查buildAIRequestOptions函数中temperature验证逻辑是否正确
- [x] Task 3: 端到端测试验证
  - 启动应用，进入角色卡管理
  - 在设置中配置temperature参数（如0.7）
  - 测试角色卡翻译/润色/生成功能
  - 确认temperature参数被正确读取并传递到AI请求中

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
