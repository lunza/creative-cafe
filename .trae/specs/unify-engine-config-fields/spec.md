# 统一引擎配置字段规范

## Why
"添加引擎"、"编辑引擎"模态框与"AI引擎设置"表单之间存在字段不一致的问题。"AI引擎设置"包含了"API密钥传输方式"（api_key_transmission）字段，而添加/编辑引擎表单缺失该字段。同时，编辑引擎页面缺少连通性测试功能，导致用户体验不一致。

## What Changes
- 在"添加引擎"和"编辑引擎"模态框中补齐缺失的`api_key_transmission`字段
- 在"编辑引擎"模态框中实现连通性测试功能，与"AI引擎设置"页面的测试功能保持一致

## Impact
- 受影响的模块：引擎配置管理
- 受影响的文件：
  - `src/renderer/components/Settings/Settings.tsx` - 主要修改文件
  - `src/renderer/types/setting.ts` - 类型定义（已包含api_key_transmission）

## ADDED Requirements
### Requirement: 添加/编辑引擎字段完整性
添加引擎和编辑引擎表单 SHALL 包含与"AI引擎设置"完全一致的字段配置，确保字段完整性。

#### Scenario: 添加新引擎时包含所有字段
- **WHEN** 用户点击"添加新引擎"按钮
- **THEN** 表单应包含以下所有字段：引擎名称、API地址、API密钥、模型名称、API模式、API密钥传输方式、最大令牌数、温度参数、Top P、Top K、Min P、频率惩罚、存在惩罚、生成数量、系统提示词

#### Scenario: 编辑现有引擎时包含所有字段
- **WHEN** 用户点击"编辑"按钮打开引擎编辑表单
- **THEN** 表单应包含与"AI引擎设置"一致的所有字段，包括API密钥传输方式

### Requirement: 编辑引擎连通性测试
编辑引擎模态框 SHALL 提供连通性测试功能，与"AI引擎设置"页面的测试功能保持一致的用户体验和技术实现。

#### Scenario: 在编辑引擎时测试连通性
- **WHEN** 用户在编辑引擎表单中点击"测试连通性"按钮
- **THEN** 系统应向当前表单中配置的API地址发起连接测试请求，并显示测试结果（成功/失败、响应时间、详细信息等）

## MODIFIED Requirements
### Requirement: 引擎表单字段
"添加引擎"和"编辑引擎"表单 SHALL 包含以下完整字段列表：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 引擎名称（必填）|
| api_url | string | API地址（必填）|
| api_key | string | API密钥 |
| model_name | string | 模型名称（必填）|
| api_mode | string | API模式（text_completion/chat_completion）|
| api_key_transmission | string | API密钥传输方式（header/body）|
| max_tokens | number | 最大令牌数 |
| temperature | number | 温度参数 |
| top_p | number | Top P参数 |
| top_k | number | Top K参数 |
| min_p | number | Min P参数 |
| frequency_penalty | number | 频率惩罚 |
| presence_penalty | number | 存在惩罚 |
| n | number | 生成数量 |
| system_prompt | string | 系统提示词 |
