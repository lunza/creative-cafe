# 优化启动脚本 Spec

## Why
当前 `start.bat` 脚本功能基础，缺少自动环境配置、进度可视化、国内镜像源支持和完善的错误处理。用户在国内网络环境下运行项目时，需要手动配置镜像源、处理依赖安装问题，且脚本缺少日志记录和自动重试机制，不符合零配置、零干预的启动要求。

## What Changes
- 重写 `start.bat` 脚本，增加 Node.js 自动检测与安装能力
- 强制使用国内 npm 镜像源（淘宝镜像）
- 实现命令行进度条显示（依赖下载进度）
- 自动创建 logs、AppData/Roaming 数据目录
- 实现自动重试机制和完善的错误日志
- 启动成功后显示 Electron 应用运行状态及访问地址
- 所有操作日志记录到 logs 目录

## Impact
- 受影响的文件: `start.bat`（重写）
- 新增文件: `logs/` 目录及相关日志文件
- 不影响现有项目代码和配置

## ADDED Requirements

### Requirement: 环境与依赖管理
系统 SHALL 自动检测并安装 Node.js 运行环境（推荐版本 v18+），并强制使用国内镜像源进行依赖下载。

#### Scenario: 检测到 Node.js 未安装
- **WHEN** 脚本检测到系统未安装 Node.js
- **THEN** 脚本提供清晰的安装指引，或尝试自动下载并安装指定版本

#### Scenario: 强制使用国内镜像源
- **WHEN** 执行 npm install 时
- **THEN** 脚本自动配置使用 https://registry.npmmirror.com 作为 npm 镜像源

### Requirement: 进度可视化
系统 SHALL 在命令行界面显示依赖下载进度条，包含百分比和动态更新。

#### Scenario: 依赖下载进度显示
- **WHEN** 执行 npm install 安装依赖
- **THEN** 显示下载进度条、百分比及当前状态

### Requirement: 项目初始化
系统 SHALL 在启动前自动创建必要的目录结构。

#### Scenario: 创建必要目录
- **WHEN** 脚本首次运行
- **THEN** 自动创建 logs 目录和 AppData/Roaming 下的数据存储目录

### Requirement: 一键启动
系统 SHALL 实现从零到启动的全自动流程。

#### Scenario: 完整启动流程
- **WHEN** 用户双击 start.bat
- **THEN** 自动完成环境检测、依赖安装、项目初始化、启动 Electron 应用

### Requirement: 错误处理与日志
系统 SHALL 捕获所有错误并记录日志，支持可恢复错误的自动重试。

#### Scenario: 错误记录与重试
- **WHEN** npm install 失败
- **THEN** 记录错误到日志文件，自动重试最多 3 次

## MODIFIED Requirements
N/A

## REMOVED Requirements
N/A
