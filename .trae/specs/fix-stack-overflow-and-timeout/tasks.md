# Tasks

- [x] Task 1: 分析调用栈溢出错误的根本原因
  - [x] SubTask 1.1: 检查 `CharacterDialogueChat.hooks.ts` 中的 `onComplete` 回调和 `setState` 调用
  - [x] SubTask 1.2: 分析 `saveChatToStore` 函数的执行路径
  - [x] SubTask 1.3: 检查 IPC 序列化过程中可能存在的循环引用
  - **发现**: 局部函数 `clearTimeout` 遮蔽了全局 `clearTimeout`，导致递归调用自身产生栈溢出

- [x] Task 2: 分析流超时问题的原因
  - [x] SubTask 2.1: 检查 AI 响应流处理逻辑（`handleStreamResponse` 相关代码）
  - [x] SubTask 2.2: 验证流超时配置的合理性
  - [x] SubTask 2.3: 检查流处理过程中是否存在阻塞或死锁
  - **发现**: 120秒超时对于大 max_tokens 配置可能不足

- [x] Task 3: 修复调用栈溢出问题
  - [x] SubTask 3.1: 将局部函数 `clearTimeout` 重命名为 `clearStreamTimeout`，避免遮蔽全局函数
  - [x] SubTask 3.2: 确保传递给 IPC 的消息是纯数据对象，无循环引用
  - [x] SubTask 3.3: 添加 JSON 序列化验证，检测循环引用
  - [x] SubTask 3.4: 添加 `isSavingRef` 重入保护，防止并发保存

- [x] Task 4: 修复流超时问题
  - [x] SubTask 4.1: 根据 max_tokens 动态调整超时：>8192 使用 300s，否则 120s
  - [x] SubTask 4.2: 优化流处理日志，包含超时时长信息

- [x] Task 5: 编写全面的测试用例
  - [x] SubTask 5.1: 正常流程测试：AI 响应完成后正确保存
  - [x] SubTask 5.2: 边界条件测试：大消息、特殊字符处理
  - [x] SubTask 5.3: 异常场景测试：网络中断、超时处理
  - [x] SubTask 5.4: IPC 序列化测试：验证无循环引用

- [x] Task 6: 验证修复效果
  - [x] SubTask 6.1: 执行所有测试用例（31 个测试用例全部通过）
  - [x] SubTask 6.2: 确认不再出现调用栈溢出错误
  - [x] SubTask 6.3: 确认流超时问题已解决

# Task Dependencies
- Task 3 depends on Task 1
- Task 4 depends on Task 2
- Task 5 depends on Task 3, Task 4
- Task 6 depends on Task 5
