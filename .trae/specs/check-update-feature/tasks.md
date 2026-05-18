# Tasks

- [x] Task 1: 实现 update:check IPC 处理器
  - [x] SubTask 1.1: 使用 simple-git 库实现 git fetch 和 commit 差异比较
  - [x] SubTask 1.2: 获取 commit 列表（hash, message, author, date）
  - [x] SubTask 1.3: 处理非 Git 仓库等异常情况
  - [x] SubTask 1.4: 返回标准化结果格式

- [x] Task 2: 实现 update:pull IPC 处理器
  - [x] SubTask 2.1: 执行 git pull 拉取最新代码
  - [x] SubTask 2.2: 处理 git pull 冲突等异常情况
  - [x] SubTask 2.3: 拉取成功后执行 npm run build 重新编译
  - [x] SubTask 2.4: 返回编译结果和变更文件列表

- [x] Task 3: 更新 preload.ts 中的 IPC 暴露接口
  - [x] SubTask 3.1: 添加 update.pull 暴露接口
  - [x] SubTask 3.2: 移除不再需要的 update.download 和 update.install

- [x] Task 4: 更新 Dashboard.tsx 检查更新流程
  - [x] SubTask 4.1: 修改 handleCheckUpdate 显示 commit 变更列表
  - [x] SubTask 4.2: 修改 onOk 回调调用 update.pull
  - [x] SubTask 4.3: 添加拉取和编译进度反馈

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 2, Task 3]
