# Tasks
- [x] 任务1：在"添加引擎"和"编辑引擎"模态框中补充缺失的API密钥传输方式字段
  - 在engineForm中添加api_key_transmission字段（Select组件，选项为header/body）
  - 确保该字段在添加新引擎时包含默认值（与AI引擎设置保持一致）
  - 确保该字段在编辑现有引擎时正确加载和保存

- [x] 任务2：为"编辑引擎"模态框实现连通性测试功能
  - 复用现有的handleTestConnection函数逻辑
  - 在编辑引擎表单中添加"测试连通性"按钮
  - 测试按钮应读取当前表单中的配置（api_url、api_key等）进行测试
  - 显示测试结果（成功/失败、响应时间、详细信息等）

- [x] 任务3：统一默认引擎配置值
  - 确保handleAddEngine函数中的emptyEngine对象包含api_key_transmission字段
  - 确保handleSaveEngine函数中新建引擎时包含api_key_transmission字段
  - 验证所有字段默认值与AI引擎设置保持一致

# Task Dependencies
- 任务2依赖于任务1完成（需要api_key_transmission字段存在后才能正确测试连通性）
- 任务3可与任务1并行进行
