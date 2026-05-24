# 修复表格整理 AI 调用参数配置问题 - 实现步骤

## 步骤 1：修改 `WritingStorageService` 添加 AI 引擎配置获取方法

在 `WritingStorageService` 类中添加以下私有方法（参考 `ContentGenerator.getApiKey()` 实现）：

**1.1 添加 `getActiveEngine()` 方法**
```typescript
private getActiveEngine(): any {
  const storageService = getStorageService();
  const settings = storageService.getSettings();
  const engines = settings?.aiEngines || [];
  if (engines.length > 0) {
    return engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
  }
  return null;
}
```

**1.2 添加 `getApiKey()` 方法**
```typescript
private getApiKey(): string {
  const engine = this.getActiveEngine();
  const apiKey = engine?.api_key;
  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置 → AI引擎设置中配置');
  }
  return apiKey;
}
```

**1.3 添加 `getApiKeyTransmission()` 方法**
```typescript
private getApiKeyTransmission(): string {
  const engine = this.getActiveEngine();
  return engine?.api_key_transmission || 'header';
}
```

**1.4 添加 `getBaseUrl()` 方法**
```typescript
private getBaseUrl(): string {
  const engine = this.getActiveEngine();
  if (!engine?.api_url) {
    throw new Error('未配置 AI 服务地址，请在设置 → AI引擎设置中配置');
  }
  // 去掉末尾的路径，只保留基础 URL
  return engine.api_url.replace(/\/v1\/chat\/completions$/, '').replace(/\/v1\/completions$/, '');
}
```

**1.5 添加 `getModelName()` 方法**
```typescript
private getModelName(): string {
  const engine = this.getActiveEngine();
  if (!engine?.model_name) {
    throw new Error('未配置模型名称，请在设置 → AI引擎设置中配置');
  }
  return engine.model_name;
}
```

## 步骤 2：修改 `buildApiEndpoint` 方法返回值

**2.1 修改方法签名**，将返回值从 `{ apiUrl: string; apiMode: string }` 扩展为包含所有必要信息：
```typescript
private buildApiEndpoint(modelConfig: ModelConfig): {
  apiUrl: string;
  apiMode: string;
  apiKey: string;
  apiKeyTransmission: string;
  modelName: string;
}
```

**2.2 修改方法实现**，使用新添加的辅助方法获取所有参数，移除硬编码的默认 URL 逻辑。

## 步骤 3：重构 `callAIAPI` 方法

**3.1 修改方法签名**，将 `apiEndpoint` 参数类型改为新的完整类型。

**3.2 移除 `modelConfig` 中所有默认值**：
- 删除 `modelConfig.model || 'gpt-4o'` → 改为使用 `apiEndpoint.modelName`
- 删除 `modelConfig.temperature ?? 0.3` → 改为使用 `modelConfig.temperature`（必须提供）
- 删除 `modelConfig.maxTokens ?? 4000` → 改为使用 `modelConfig.maxTokens`（必须提供）

**3.3 添加 API Key 验证**：
- 从 `apiEndpoint` 中获取 `apiKey`
- 如果为空，抛出明确错误：`'未配置 API Key，请在设置 → AI引擎设置中配置'`

**3.4 构建请求头**，根据 `apiKeyTransmission` 配置：
- `header`：添加 `Authorization: Bearer ${apiKey}` 到 headers
- `body`：在 payload 中添加 `api_key: apiKey`

**3.5 修复调试日志**：
- 将 `apiKey.substring(0, 10)` 改为安全的日志输出

## 步骤 4：修改前端 `handleStartOrganize`

**4.1 移除硬编码的 `modelConfig` 默认值**，改为从用户配置或界面获取参数。

**4.2 如果前端没有配置界面**，则传递空对象 `{}`，由后端从全局设置获取所有参数。

## 步骤 5：验证

- 运行 `npx tsc -p tsconfig.json --noEmit` 确保无编译错误
- 测试表格整理功能，确认 API Key 正确传递
- 验证参数缺失时能正确抛出异常并提示用户
