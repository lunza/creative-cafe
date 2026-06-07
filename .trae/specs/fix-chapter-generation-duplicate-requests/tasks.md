# 任务列表

## 任务 1: 修复事件监听器重复注册问题
- [x] 任务 1.1: 添加 outlineRef 用于存储最新 outline 值
  - [x] 在 hook 顶部添加 `const outlineRef = useRef(outline)`
  - [x] 添加新的 useEffect 同步更新 outlineRef.current
  
- [x] 任务 1.2: 修改事件监听器 useEffect 依赖
  - [x] 将 `useEffect` 的依赖从 `[outline]` 改为 `[]`（空数组）
  - [x] 确保回调函数内部通过 `outlineRef.current` 访问 outline 而非闭包中的 outline
  
- [x] 任务 1.3: 验证闭包中的其他依赖也使用 refs
  - [x] 检查 `onStreamComplete` 回调中使用的 `updateProject`、`saveProject`、`currentProjectRef` 等是否仍然有效
  - [x] 确保所有需要在回调中访问的状态都通过 ref 或 store 获取

## 任务 2: 验证修复效果
- [x] 任务 2.1: TypeScript 编译验证（无新增错误）
- [x] 任务 2.2: IDE 诊断验证（useChapterGeneration.ts 无诊断错误）

## 任务依赖关系
- 任务 1.1、1.2、1.3 可以并行实施
- 任务 2 依赖于任务 1 完成
