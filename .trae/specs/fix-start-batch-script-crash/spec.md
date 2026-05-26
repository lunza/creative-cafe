# 修复 start.bat 闪退问题 Spec

## Why
双击 `start.bat` 时出现闪退问题，原因是脚本中存在语法错误和逻辑缺陷，导致脚本在遇到错误时立即退出，无法执行到最后的 `pause` 命令。

## What Changes
- 修复日志函数中未初始化的 `!LOG_TIMESTAMP!` 变量
- 修复 Node.js 版本检测命令中的转义字符问题
- 添加统一的错误处理机制和全局暂停功能
- 修复 `call npm run dev` 命令导致脚本退出的问题
- 确保所有错误路径都能暂停并显示错误信息

## Impact
- 受影响的文件: `start.bat`
- 不影响现有项目代码和配置

## ADDED Requirements

### Requirement: 错误处理与暂停
系统 SHALL 确保脚本在任何错误情况下都不会闪退，而是显示错误信息并暂停等待用户操作。

#### Scenario: 脚本错误时暂停
- **WHEN** 脚本执行过程中发生任何错误
- **THEN** 显示错误信息，暂停并等待用户按键

### Requirement: 日志函数修复
系统 SHALL 确保日志函数正确处理时间戳和日志文件不存在的情况。

#### Scenario: 日志文件不存在时
- **WHEN** 日志函数被调用但日志文件尚未创建
- **THEN** 直接写入日志文件而不添加时间戳

## MODIFIED Requirements
N/A

## REMOVED Requirements
N/A
