# Checklist

## worldBookAgent IPC 桥接
- [x] `preload.ts` 暴露 `worldBookAgent` API（run/cancel/status/resume/answer）
- [x] `preload.ts` 暴露 `worldBookAgent.onProgress` 和 `worldBookAgent.onClarify` 事件订阅
- [x] `electron.d.ts` 包含 `worldBookAgent` 完整类型声明
- [x] `useWorldBookAuthoring.ts` 中所有 `window.electronAPI.worldBookAgent.*` 调用类型检查通过

## agent.mode / agent.config IPC 桥接（回归验证）
- [x] `preload.ts` 中 `agent.mode` 桥接存在（isModeActive/getModeStatus/setModeOverride）
- [x] `preload.ts` 中 `agent.config` 桥接存在（list/get/update/toggle/updateSkills）
- [x] `electron.d.ts` 中 `agent.mode` 和 `agent.config` 类型声明存在

## settingStore 类型兼容
- [x] `settingStore.ts` 第 66 行 `as AppSetting` 类型断言编译通过
- [x] `settingStore.ts` 第 387 行 `as AppSetting` 类型断言编译通过

## WebSearchConfig 类型
- [x] `setting.ts` 导出 `WebSearchConfig` 接口
- [x] `AppSetting` 接口包含 `webSearch?: WebSearchConfig` 字段
- [x] `WebSearchSettings.tsx` 导入 `WebSearchConfig` 不报 TS2305
- [x] `WebSearchSettings.tsx` 访问 `setting.webSearch` 不报 TS2339

## 全量编译验证
- [x] `npx tsc --noEmit` 对本次修复的文件零新增错误
- [x] 智能体管理中心相关文件全部编译通过
- [x] 世界书编写智能体相关文件全部编译通过
