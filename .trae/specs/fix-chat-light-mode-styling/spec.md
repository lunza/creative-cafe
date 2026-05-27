# 聊天界面亮色模式完整适配规范

## Why
当前聊天界面在亮色模式下，角色选择器面板、配置面板、头部栏、输入框等区域仍使用硬编码的深色背景和紫色渐变，与亮色主题严重不协调。同时，双引号对话文字的金黄色在亮色背景下对比度不足，影响可读性。

## What Changes
- 角色选择器面板背景色和文字色跟随主题切换
- 配置面板背景色、分隔线、卡片背景跟随主题切换
- 聊天头部栏背景色跟随主题切换
- 输入框区域背景色跟随主题切换
- 双引号对话文字在亮色模式下从金黄色改为深橙色，确保对比度
- 配置面板中的滑块、下拉框、按钮等组件样式适配亮色模式
- 所有面板样式通过CSS变量实现主题切换，保持平滑过渡

## Impact
- 受影响组件: `CharacterSelectorPanel.tsx`, `CharacterSelectorPanel.css`, `ConfigPanel.tsx`, `ConfigPanel.css`, `ChatHeader.tsx`, `ChatInputBar.tsx`, `MessageRenderer.styles.css`
- 影响范围: 角色对话聊天窗口的所有面板和元素

## ADDED Requirements
### Requirement: 角色选择器面板主题适配
角色选择器面板 SHALL 在亮色模式下使用浅色背景，暗色模式下保持深色背景，所有文字、边框、选中状态均跟随主题变化。

#### Scenario: 角色选择器亮色模式
- **WHEN** 用户切换到亮色模式
- **THEN** 角色选择器面板背景变为浅灰色，文字变为深灰色，选中状态保持紫色高亮

### Requirement: 配置面板主题适配
配置面板 SHALL 在亮色模式下使用浅色背景，所有子面板（参数面板、知识面板等）的卡片背景、文字颜色均适配亮色主题。

#### Scenario: 配置面板亮色模式
- **WHEN** 用户切换到亮色模式
- **THEN** 配置面板背景变为白色/浅灰色，文字变为深色，滑块和按钮保持品牌色

### Requirement: 双引号对话文字对比度
系统 SHALL 确保双引号内的对话文字在亮色模式下有足够的对比度，使用深橙色替代金黄色。

### Requirement: 颜色平滑过渡
系统 SHALL 实现所有面板颜色切换时的平滑过渡效果（0.3s ease），避免视觉突兀变化。

## MODIFIED Requirements
### Requirement: 聊天头部栏样式
聊天头部栏 SHALL 使用CSS变量定义背景色和文字色，替代硬编码的深色值。

### Requirement: 聊天输入框样式
聊天输入框 SHALL 使用CSS变量定义背景色、边框色和文字色，确保亮色模式下为浅色输入框。

## REMOVED Requirements
（无删除项）
