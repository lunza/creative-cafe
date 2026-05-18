# Tasks
- [x] Task 1: 创建版本管理服务 (ChatVersionService)
  - [x] SubTask 1.1: 在 `src/main/services/` 下创建 `ChatVersionService.ts`
  - [x] SubTask 1.2: 实现版本文件创建方法：命名格式 `{序号}_{角色卡名称}_{时间戳}.json`
  - [x] SubTask 1.3: 实现版本自动轮换逻辑：最多保留19个历史版本+1个最新版本
  - [x] SubTask 1.4: 实现版本文件读取方法：获取指定角色的所有版本列表
  - [x] SubTask 1.5: 实现版本删除方法
  - [x] SubTask 1.6: 添加 IPC handlers 暴露版本管理 API

- [x] Task 2: 修改聊天记录保存逻辑，集成版本创建
  - [x] SubTask 2.1: 在 `characterChatHandlers.ts` 中添加版本创建调用（saveTestChat 时自动创建）
  - [x] SubTask 2.2: 确保版本存储路径为 `{chatStorageBaseDir}/{角色卡名称}/versions/`

- [x] Task 3: 扩展 ChatMessage 类型，添加版本信息字段
  - [x] SubTask 3.1: 在 `CharacterDialogueChat.types.ts` 中为 `ChatMessage` 添加 `versionInfo` 可选字段
  - [x] SubTask 3.2: 定义 `ChatMessageVersionInfo` 接口：包含版本号、是否最新版本、版本列表等
  - [x] SubTask 3.3: 在 preload.ts 和 electron.ts 中添加 chatVersion API 类型定义

- [x] Task 4: 修改 ChatMessageBubble 组件，实现按钮显示规则
  - [x] SubTask 4.1: 添加 `versionInfo` 和 `onRetryFromVersion` props
  - [x] SubTask 4.2: 实现最新版本显示完整操作按钮组（继续对话、编辑内容、重新生成）
  - [x] SubTask 4.3: 实现历史版本仅显示重新生成按钮
  - [x] SubTask 4.4: 实现版本信息不存在时隐藏所有操作按钮
  - [x] SubTask 4.5: 实现历史版本重新生成按钮点击回调

- [x] Task 5: 修改 CharacterDialogueChat 组件和 hooks
  - [x] SubTask 5.1: 在 `CharacterDialogueChat.hooks.ts` 中添加版本信息计算逻辑
  - [x] SubTask 5.2: 将版本信息传递给每个 ChatMessage
  - [x] SubTask 5.3: 添加 `retryMessageFromVersion` 方法：回退到指定版本并重新生成
  - [x] SubTask 5.4: 在 `CharacterDialogueChat.tsx` 中传递版本相关 props

- [x] Task 6: 在记忆管理聊天记录编辑界面添加版本下拉选择控件
  - [x] SubTask 6.1: 修改 `ChatManager.tsx` 的编辑模态框，添加版本 Select 控件
  - [x] SubTask 6.2: 实现版本列表加载逻辑
  - [x] SubTask 6.3: 实现版本切换时更新编辑内容显示
  - [x] SubTask 6.4: 添加对应的 IPC handler 获取版本列表和指定版本内容

# Task Dependencies
- Task 2 depends on Task 1
- Task 4 depends on Task 3
- Task 5 depends on Task 3 and Task 4
- Task 6 depends on Task 1
