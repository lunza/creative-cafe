# Tasks
- [x] Task 1: 修改 Token 管理默认配置值
  - [x] SubTask 1.1: 修改 `CharacterDialogueChat.hooks.ts` 中的默认配置值
    - maxContextTokens: 6000 → 32000
    - reservedForResponse: 1024 → 4096
    - minMessagesToKeep: 2 → 3
    - maxMessagesToKeep: 40 → 60
  - [x] SubTask 1.2: 修改 `TokenManagementPanel.tsx` 中的模型预设配置
    - DeepSeek V3.2: reservedForResponse 4096 → 8192
  - [x] SubTask 1.3: 更新 `TokenManagementPanel.tsx` 中的默认显示值
    - reservedForResponse 默认显示值从 1024 改为 4096

- [x] Task 2: 添加 Token 预算警告日志
  - [x] SubTask 2.1: 在 `ContextTruncator.ts` 中添加预算检查逻辑
    - 当可用预算 < 2000 tokens 时输出警告
    - 警告信息包含当前预算值和推荐配置

- [x] Task 3: 验证修改效果
  - [x] SubTask 3.1: 检查代码编译无错误
  - [x] SubTask 3.2: 验证默认配置值已正确更新
  - [x] SubTask 3.3: 验证预算警告日志功能

# Task Dependencies
- Task 2 依赖 Task 1（需要先确定新的默认值）
- Task 3 依赖 Task 1 和 Task 2
