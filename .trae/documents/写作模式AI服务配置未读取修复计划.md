# 写作模式"未配置 AI 服务地址"错误排查与修复计划

## 一、问题背景

用户在写作模式点击"生成大纲"时，收到错误：
```
[Writing] Outline generation error: { code: 'AI_SERVICE_UNAVAILABLE', message: '未配置 AI 服务地址', details: undefined, recoverable: false }
```

从仪表盘截图可见，Deepseek 已连接（deepseek-v1-pro），向量模型和向量存储都已配置。但写作模式仍报"未配置 AI 服务地址"。

## 二、问题根源分析

### 核心问题：配置读取路径不一致

#### 1. 写作模式读取配置的方式（错误路径）

**文件**: [OutlineGenerator.ts:205-213](file:///g:/AI/creative-cafe/src/main/services/writing/OutlineGenerator.ts#L205-L213)

```typescript
private async getBaseUrl(): Promise<string | undefined> {
  try {
    const { getStorageService } = require('../storageService');
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    return settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl;
  } catch {
    return undefined;
  }
}
```

**问题分析**:
- 写作模式期望从 `settings.ai.baseUrl` 或 `settings.ai.apiBaseUrl` 或 `settings.baseUrl` 读取 AI 地址
- 但实际的设置数据结构是 `AppSettingType`，AI 配置存储在 `aiEngines` 数组中，字段名为 `api_url` 和 `api_key`

#### 2. 实际设置的存储结构

**文件**: [Settings.tsx:63-64](file:///g:/AI/creative-cafe/src/renderer/components/Settings/Settings.tsx#L63-L64)

设置加载逻辑：
```typescript
const engines = setting.aiEngines || [];
const engine = engines.find(e => e.id === setting.activeEngineId) || engines[0];
```

**AI 引擎配置字段**:
- `api_url`: API 服务地址（如 `http://127.0.0.1:5000`）
- `api_key`: API 密钥
- `model_name`: 模型名称
- `api_mode`: API 模式（`text_completion` 或 `chat_completion`）
- `max_tokens`, `temperature`, `top_p` 等参数

**保存路径**: [Settings.tsx:243-257](file:///g:/AI/creative-cafe/src/renderer/components/Settings/Settings.tsx#L243-L257)

#### 3. 正确的 AI 配置读取路径

应该从 `settings.aiEngines` 数组中读取：
```
settings.aiEngines[0].api_url   →   AI 服务地址
settings.aiEngines[0].api_key   →   API 密钥
```

## 三、实施步骤

### 步骤 1: 修复 OutlineGenerator.ts 的 getBaseUrl 和 getApiKey

**文件**: [OutlineGenerator.ts:205-224](file:///g:/AI/creative-cafe/src/main/services/writing/OutlineGenerator.ts#L205-L224)

修改 `getBaseUrl()` 方法：
1. 读取 `settings.aiEngines` 数组
2. 获取第一个引擎（`aiEngines[0]`）或标记为 active 的引擎
3. 从该引擎中提取 `api_url` 字段作为 baseUrl
4. 添加诊断日志输出实际读取到的 settings 结构

修改 `getApiKey()` 方法：
1. 同样从 `aiEngines[0]` 中提取 `api_key` 字段
2. 添加诊断日志

### 步骤 2: 修复 ContentGenerator.ts 的配置读取

**文件**: [ContentGenerator.ts](file:///g:/AI/creative-cafe/src/main/services/writing/ContentGenerator.ts)

`ContentGenerator.ts` 中同样使用 `getBaseUrl()` 和 `getApiKey()` 方法，需要同步修复。

### 步骤 3: 验证修复

1. 运行 `npm run build` 确认编译通过
2. 检查 TypeScript 诊断信息
3. 确认所有相关组件无错误

## 四、预期输出

- 修复 "未配置 AI 服务地址" 的根本原因（配置读取路径不一致）
- 写作模式能正确从 `aiEngines` 数组中读取 AI 服务配置
- 添加诊断日志便于未来排查类似问题
- 确保代码通过编译和类型检查
