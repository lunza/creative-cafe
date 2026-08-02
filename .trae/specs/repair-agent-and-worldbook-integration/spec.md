# 修复智能体与世界书编写智能体集成损坏 Spec

## Why
在执行 text_completion 模式移除和路径设置移除时，git index 损坏导致全量 reset 到 HEAD，随后重新应用修改时遗漏了 `worldBookAgent` IPC 桥接和 `electron.d.ts` 类型声明。同时 `api_mode` 类型收窄导致 `settingStore.ts` 的 `as AppSetting` 类型断言失败。需修复这些集成断裂点，恢复智能体管理中心和自驱世界书编写智能体的完整可用性。

## What Changes
- 修复 `preload.ts` 中丢失的 `worldBookAgent` API 桥接（run/cancel/status/resume/answer + onProgress/onClarify 事件订阅）
- 修复 `electron.d.ts` 中丢失的 `worldBookAgent` 类型声明
- 修复 `settingStore.ts` 中 `as AppSetting` 类型断言失败（`api_mode` 类型从联合类型收窄为字面量导致不兼容）
- 修复 `setting.ts` 中 `WebSearchConfig` 类型导出缺失和 `webSearch` 字段缺失
- 验证所有智能体相关 IPC 通道（agent.mode / agent.config / worldBookAgent）完整可用

## Impact
- Affected specs: `add-agent-mode-management-and-center`, `implement-worldbook-authoring-agent`
- Affected code:
  - `src/main/preload.ts` — worldBookAgent API 桥接
  - `src/renderer/types/electron.d.ts` — worldBookAgent 类型声明
  - `src/renderer/stores/settingStore.ts` — as AppSetting 类型断言
  - `src/renderer/types/setting.ts` — WebSearchConfig 导出 + webSearch 字段
  - `src/renderer/components/Settings/Settings.tsx` — webSearch 配置面板引用

## ADDED Requirements

### Requirement: worldBookAgent IPC 桥接恢复
系统 SHALL 在 preload.ts 中暴露 `worldBookAgent` API 对象，包含 run/cancel/status/resume/answer 方法及 onProgress/onClarify 事件订阅接口，并在 electron.d.ts 中声明对应类型。

#### Scenario: 智能体编写世界书
- **WHEN** 用户在 Agent 模式下点击"智能体编写"按钮
- **THEN** WorldBookAuthoringModal 通过 `window.electronAPI.worldBookAgent.run()` 启动编写流程
- **AND** 进度事件通过 `onProgress` 回调实时推送
- **AND** 澄清问题通过 `onClarify` 回调推送并等待用户回答

### Requirement: settingStore 类型兼容
系统 SHALL 确保 `settingStore.ts` 中的 `as AppSetting` 类型断言在 `api_mode` 类型为 `'chat_completion'` 字面量时编译通过。

#### Scenario: 加载设置
- **WHEN** 应用启动并从 settings.json 加载配置
- **THEN** `restoreDefault()` 和 `fetchSetting()` 中的 `as AppSetting` 类型断言不报 TS2352 错误

### Requirement: WebSearchConfig 类型完整
系统 SHALL 在 `setting.ts` 中导出 `WebSearchConfig` 类型，并在 `AppSetting` 接口中包含 `webSearch?: WebSearchConfig` 字段。

#### Scenario: Web 搜索设置面板加载
- **WHEN** 用户打开设置页面
- **THEN** WebSearchSettings 组件正确导入 `WebSearchConfig` 类型并读写 `setting.webSearch` 字段

## MODIFIED Requirements

### Requirement: electron.d.ts 类型声明完整性
`electron.d.ts` SHALL 包含以下智能体相关 API 的完整类型声明：
- `agent.mode`（isModeActive/getModeStatus/setModeOverride + onChanged 事件）
- `agent.config`（list/get/update/toggle/updateSkills + onChanged 事件）
- `worldBookAgent`（run/cancel/status/resume/answer + onProgress/onClarify 事件）
