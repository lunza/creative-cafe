# Fix AI Engine Config State and Avatar Storage Path Spec

## Why
用户在完成AI引擎配置后，对话界面仍错误提示"请配置AI引擎"，需进入设置保存才能生效。同时用户人设存储路径在某些场景下被错误设置为绝对路径而非`__USER_DATA__/data/avatars`。这两个问题严重影响用户体验。

## What Changes
- 修复AI引擎配置状态检测逻辑，确保配置完成后自动生效
- 修复用户人设存储路径错误，确保始终使用正确的相对路径
- 添加测试用例验证修复效果

## Impact
- Affected specs: 无
- Affected code: 
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` - AI引擎状态检测
  - `src/main/services/pathService.ts` - 路径处理服务
  - `src/main/services/avatarService.ts` - 头像存储服务
  - `src/renderer/utils/persistence.tsx` - 配置持久化

## ADDED Requirements
### Requirement: AI Engine Configuration State Detection
系统 SHALL 准确检测AI引擎配置状态，在用户完成配置后立即生效，无需额外保存操作。

#### Scenario: AI engine configured
- **WHEN** 用户完成AI引擎配置
- **THEN** 对话界面自动识别配置状态，不再提示"请配置AI引擎"

#### Scenario: No AI engine configured
- **WHEN** 用户未配置任何AI引擎
- **THEN** 对话界面正确提示"请先在设置中配置AI引擎"

### Requirement: User Avatar Storage Path
系统 SHALL 始终使用`__USER_DATA__/data/avatars`作为用户人设存储路径，不得使用绝对路径。

#### Scenario: Avatar path generation
- **WHEN** 系统生成用户人设存储路径
- **THEN** 路径应为`__USER_DATA__/data/avatars`格式，而非操作系统绝对路径

## MODIFIED Requirements
### Requirement: Configuration State Management
修改配置状态检测逻辑，确保从正确的数据源读取AI引擎配置状态，避免缓存或状态不同步问题。

## REMOVED Requirements
无
