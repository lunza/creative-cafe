# AI 模型能力检测与图片识别特征提取 Spec

## Why

项目现有 AI 引擎设置仅检测连通性（发送文本测试消息），不检测模型是否支持视觉、思维链或工具调用等能力。角色卡特征提取仅支持从文本描述生成，无法利用多模态模型的图片识别能力从角色卡 PNG 图片自动提取视觉特征标签。需新增模型能力自动检测机制，并基于检测结果在素材与特征管理中实现图片识别特征提取功能。

## What Changes

- 扩展 `AIEngineCapabilities` 接口：新增 `supportsVision`、`supportsThinking`、`supportsToolCalling` 字段
- 扩展连通性测试流程：测试通过后自动探测模型能力（视觉/思维链/工具调用），将结果存入引擎配置
- 在设置页 AI 引擎管理中显示能力标识（眼睛=视觉、思考=思维链、扳手=工具调用、编辑=文本生成）
- 扩展 `ChatMessage` 类型：支持 OpenAI Vision 多模态 content 数组格式
- 新增图片识别特征提取服务：调用多模态模型分析角色卡 PNG 图片，提取视觉特征标签
- 新增 IPC 通道 `ai:recognizeImageTraits`：接收角色卡路径，返回识别的特征标签数组
- 在素材与特征管理 UI（AssetGenerateModal）中新增「AI 图片识别」按钮：当检测到模型具备视觉能力时显示，点击后调用图片识别服务提取特征
- 扩展 preload + electron.d.ts 类型声明

## Impact

- Affected specs: `add-asset-and-trait-management`（特征管理新增图片识别入口）
- Affected code:
  - 修改：`src/renderer/types/setting.ts` — `AIEngineCapabilities` 新增字段
  - 修改：`src/renderer/types/electron.d.ts` — 新增 `recognizeImageTraits` 类型声明
  - 修改：`src/renderer/stores/settingStore.ts` — `testConnection` 扩展能力检测
  - 修改：`src/renderer/components/Settings/hooks/useAIEngineSettings.ts` — `TestResult` 新增能力字段
  - 修改：`src/renderer/components/Settings/AIEngineSettingsPanel.tsx` — 显示能力标识
  - 修改：`src/main/services/AIService.ts` — `ChatMessage` 支持多模态 content
  - 修改：`src/main/services/characterTraitAIService.ts` — 新增图片识别方法
  - 修改：`src/main/ipc/handlers/characterTraitAIHandlers.ts` — 新增 `ai:recognizeImageTraits` 通道
  - 修改：`src/main/preload.ts` — 暴露 `recognizeImageTraits` API
  - 修改：`src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — 新增图片识别按钮

## 技术方案

### 模型能力检测机制

连通性测试通过后，向模型发送探测请求判断能力：

| 能力 | 检测方式 | 判定条件 |
|------|---------|---------|
| 视觉（Vision） | 发送含 image_url 的多模态消息（1x1 测试图片 base64） | HTTP 200 + 非 error 响应 |
| 思维链（Thinking） | 检查模型名是否包含 thinking/reasoning/r1 等关键词 | 名称匹配 |
| 工具调用（Tool Calling） | 发送含 tools 参数的请求 | HTTP 200 + 非 error 响应 |

**视觉检测请求体**（OpenAI Vision 格式）：
```json
{
  "model": "<model_name>",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "Describe this image in one word."},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,<1x1透明PNG>"}}
    ]
  }],
  "max_tokens": 5
}
```

**工具调用检测请求体**：
```json
{
  "model": "<model_name>",
  "messages": [{"role": "user", "content": "test"}],
  "tools": [{"type": "function", "function": {"name": "test", "description": "test", "parameters": {"type": "object", "properties": {}}}}],
  "max_tokens": 1
}
```

### 能力标识显示

在 AI 引擎管理列表和引擎选择下拉中，每个引擎显示能力图标：
- **编辑图标**（EditOutlined）：所有模型默认显示（文本生成能力）
- **眼睛图标**（EyeOutlined）：`supportsVision === true` 时显示
- **思考图标**（BulbOutlined）：`supportsThinking === true` 时显示
- **扳手图标**（ToolOutlined）：`supportsToolCalling === true` 时显示

### 图片识别特征提取

```
角色卡 PNG 路径 → file.readAsBase64 → base64 图片
     ↓
构建多模态 ChatMessage（system: 提取视觉特征为英文 tag + user: [text + image_url]）
     ↓
POST {baseUrl}/v1/chat/completions（OpenAI Vision 格式）
     ↓
解析响应 → 按逗号/换行分割 → trim → 去重 → 返回 string[]
     ↓
用户可编辑（添加/删除/修改）→ saveTraits 持久化
```

### ChatMessage 多模态扩展

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
}
```

## ADDED Requirements

### Requirement: AI 模型能力检测
系统 SHALL 在连通性测试通过后自动检测模型的视觉、思维链和工具调用能力，并将结果存储到引擎配置中。

#### Scenario: 检测多模态模型
- **WHEN** 用户点击「测试连通性」按钮且模型支持视觉输入
- **THEN** 系统发送含 image_url 的多模态探测请求
- **AND** 收到正常响应后标记 `supportsVision = true`
- **AND** 在测试结果中显示「视觉」能力标识

#### Scenario: 检测纯文本模型
- **WHEN** 用户点击「测试连通性」按钮且模型不支持视觉输入
- **THEN** 多模态探测请求返回错误
- **AND** 系统标记 `supportsVision = false`
- **AND** 不显示「视觉」能力标识

#### Scenario: 检测思维链能力
- **WHEN** 系统检测模型名包含 thinking/reasoning/r1/o1 等关键词
- **THEN** 标记 `supportsThinking = true`
- **AND** 显示「思考」能力标识

#### Scenario: 检测工具调用能力
- **WHEN** 系统发送含 tools 参数的探测请求且收到正常响应
- **THEN** 标记 `supportsToolCalling = true`
- **AND** 显示「扳手」能力标识

#### Scenario: 能力检测失败时的容错
- **WHEN** 能力探测请求因网络超时或服务端错误失败
- **THEN** 对应能力标记为 `false`
- **AND** 不影响其他能力的检测结果
- **AND** 连通性测试整体仍视为成功（如果基础文本测试通过）

### Requirement: 能力标识显示
系统 SHALL 在 AI 引擎管理界面为每个引擎显示能力标识图标。

#### Scenario: 显示能力标识
- **WHEN** 引擎配置中存在 capabilities 数据
- **THEN** 在引擎列表项和引擎选择下拉中显示对应图标
- **AND** 编辑图标（文本生成）始终显示
- **AND** 眼睛图标仅在 supportsVision=true 时显示
- **AND** 思考图标仅在 supportsThinking=true 时显示
- **AND** 扳手图标仅在 supportsToolCalling=true 时显示

### Requirement: 图片识别特征提取
系统 SHALL 支持调用多模态模型分析角色卡 PNG 图片，自动提取视觉特征标签。

#### Scenario: 图片识别提取特征
- **WHEN** 用户在素材与特征管理中点击「AI 图片识别」按钮
- **AND** 当前 AI 引擎 supportsVision=true
- **THEN** 系统读取角色卡 PNG 图片为 base64
- **AND** 构建多模态请求发送给 AI 模型
- **AND** 解析响应提取视觉特征标签
- **AND** 将识别结果填入特征标签列表（追加到现有标签后）

#### Scenario: 模型不支持视觉时的处理
- **WHEN** 用户点击「AI 图片识别」按钮但当前引擎 supportsVision=false
- **THEN** 显示提示「当前 AI 模型不支持图片识别，请切换到多模态模型」
- **AND** 不执行任何识别操作

#### Scenario: 图片识别失败
- **WHEN** 图片识别请求失败（网络错误/模型错误）
- **THEN** 显示错误信息
- **AND** 不修改现有特征标签

### Requirement: 特征标签编辑
系统 SHALL 支持对图片识别结果进行编辑（添加/删除/修改）。

#### Scenario: 编辑识别结果
- **WHEN** 图片识别完成并填入特征标签列表后
- **THEN** 用户可逐个删除不需要的标签
- **AND** 用户可手动添加新标签
- **AND** 用户可修改标签内容
- **AND** 点击保存后持久化到磁盘

## MODIFIED Requirements

### Requirement: 连通性测试（原 useAIEngineSettings 扩展）
连通性测试在原有文本测试通过后，新增能力探测阶段：
1. 文本测试（不变）— 确认 API 可达 + 模型可响应
2. 视觉探测 — 发送多模态消息，判断 supportsVision
3. 思维链探测 — 检查模型名关键词，判断 supportsThinking
4. 工具调用探测 — 发送含 tools 请求，判断 supportsToolCalling

测试结果中新增 `capabilities` 字段，用户确认后保存到引擎配置。

### Requirement: 素材与特征管理（原 add-asset-and-trait-management 扩展）
特征管理区域新增「AI 图片识别」入口，仅当当前引擎 supportsVision=true 时显示。识别结果追加到现有特征列表，用户可编辑后保存。

## REMOVED Requirements

无。
