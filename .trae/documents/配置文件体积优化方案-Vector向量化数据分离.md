# 配置文件体积优化方案 - Vector向量化数据分离

## 问题分析

### 当前架构

1. **配置文件存储位置**：`C:\Users\a1299\AppData\Roaming\creative-cafe\data\config.json`（或 `settings.json`）
2. **向量数据存储位置**：`{userData}/vectors/{source}/{sourceId}/vecstore.json` + `vecstore_metadata.json`

### 根本原因

根据代码分析，向量数据**本应**存储在独立的 vecstore.json 文件中，但配置文件中包含的 `vector` 配置字段可能存在以下问题：

1. **配置字段膨胀**：[Settings.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Settings/Settings.tsx#L263-L278) 在保存设置时，会将整个 `vector` 配置对象保存到settings中
2. **可能的错误存储**：某些场景下可能将实际向量数据错误地写入了配置文件
3. **配置与数据未严格分离**：缺少对配置字段的数据验证和类型约束

### 数据存储现状

- **VecstoreVectorStore.ts**（第9-10行）：定义了独立的向量存储文件路径
  - `STORE_FILE = 'vecstore.json'`
  - `METADATA_FILE = 'vecstore_metadata.json'`

- **storageService.ts**（第524-552行）：settings.json 文件读写
  - `getSettings()`：从 settings.json 读取
  - `setSettings()`：写入 settings.json

- **VectorConfigPanel.tsx**（第263行）：保存设置时包含 vector 配置

## 实施方案

### 阶段1：诊断与数据分析

#### 步骤1：检查实际配置文件内容
- 分析 `C:\Users\a1299\AppData\Roaming\creative-cafe\data\config.json` 的实际内容
- 确认是否包含向量数据（vector arrays）
- 评估配置文件的实际大小和结构

#### 步骤2：定位数据写入点
- 检查所有调用 `setSettings()` 和 `storageManager.set('settings', ...)` 的代码
- 确认是否有地方错误地将向量数组写入配置

### 阶段2：代码逻辑修正

#### 步骤3：强化配置数据结构验证

**文件**：`src/main/services/storageService.ts`

在 `setSettings()` 方法中添加数据验证：
- 检查 settings 对象中是否包含向量数据（大数组）
- 如果发现向量数据，自动移除或分离
- 添加日志记录异常数据

**新增方法**：
```typescript
private sanitizeSettings(settings: any): any {
  const sanitized = { ...settings };
  
  // 移除可能错误存储的向量数据
  if (sanitized.vectors && Array.isArray(sanitized.vectors)) {
    console.warn('[StorageService] 检测到配置中包含向量数据，已自动移除');
    delete sanitized.vectors;
  }
  
  // 检查 vector 配置字段是否包含异常大的数据
  if (sanitized.vector) {
    const vectorConfig = sanitized.vector;
    const vectorConfigSize = JSON.stringify(vectorConfig).length;
    
    if (vectorConfigSize > 10000) { // 超过10KB视为异常
      console.warn(`[StorageService] vector配置异常大: ${vectorConfigSize} bytes`);
      
      // 仅保留配置字段，移除可能的数据字段
      sanitized.vector = {
        embeddingMode: vectorConfig.embeddingMode,
        remoteModel: vectorConfig.remoteModel,
        remoteApiUrl: vectorConfig.remoteApiUrl,
        remoteApiKey: vectorConfig.remoteApiKey,
        localModel: vectorConfig.localModel,
        cacheEnabled: vectorConfig.cacheEnabled,
        cacheL1Size: vectorConfig.cacheL1Size,
        cacheL1TTL: vectorConfig.cacheL1TTL,
        cacheL2TTL: vectorConfig.cacheL2TTL,
        defaultTopK: vectorConfig.defaultTopK,
        minSimilarityScore: vectorConfig.minSimilarityScore,
        contextWindowTokens: vectorConfig.contextWindowTokens,
        autoVectorizeWorldBook: vectorConfig.autoVectorizeWorldBook,
        autoVectorizeKnowledge: vectorConfig.autoVectorizeKnowledge,
        dimension: vectorConfig.dimension,
      };
    }
  }
  
  return sanitized;
}
```

#### 步骤4：创建独立的向量配置管理器

**新建文件**：`src/main/services/VectorConfigManager.ts`

职责：
- 专门管理向量配置参数（不含向量数据）
- 提供配置读写接口
- 与 vecstore 数据存储完全解耦

**核心方法**：
- `loadVectorConfig()`：从配置文件读取向量配置
- `saveVectorConfig()`：保存向量配置到配置文件
- `validateVectorConfig()`：验证配置合法性
- `getVectorConfig()`：获取向量配置（供其他服务调用）

#### 步骤5：重构配置保存逻辑

**文件**：`src/renderer/components/Settings/Settings.tsx`（第263行）

修改保存逻辑：
```typescript
// 分离配置与数据
const vectorConfig = {
  embeddingMode: vectorConfigRef.current?.getFormValues().embeddingMode,
  remoteModel: vectorConfigRef.current?.getFormValues().remoteModel,
  remoteApiUrl: vectorConfigRef.current?.getFormValues().remoteApiUrl,
  remoteApiKey: vectorConfigRef.current?.getFormValues().remoteApiKey,
  // ... 仅保留配置字段
};

const updatedSetting = {
  ...setting,
  vector: vectorConfig, // 确保只包含配置参数
};
```

### 阶段3：数据迁移与分离

#### 步骤6：实现配置清理工具

**新建文件**：`src/main/services/ConfigCleanupService.ts`

功能：
- 扫描现有配置文件
- 识别并移除错误存储的向量数据
- 将向量数据迁移到正确的 vecstore.json 文件
- 生成清理报告

**核心方法**：
```typescript
async cleanupConfig(): Promise<{
  success: boolean;
  originalSize: number;
  cleanedSize: number;
  migratedVectors: number;
  report: string;
}>
```

#### 步骤7：添加配置写入拦截器

**文件**：`src/main/services/storageService.ts`

在 `setSettings()` 中调用清理逻辑：
```typescript
setSettings(settings: any): void {
  try {
    // 清理配置中的向量数据
    const cleanedSettings = this.sanitizeSettings(settings);
    
    const settingsPath = path.join(this.storageManager['baseDataPath'], 'settings.json');
    const settingsDir = path.dirname(settingsPath);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(cleanedSettings, null, 2), 'utf-8');
  } catch (error) {
    console.error('写入 settings.json 失败:', error);
    this.set(STORAGE_KEYS.SETTINGS, settings);
  }
}
```

### 阶段4：验证与测试

#### 步骤8：创建单元测试

**文件**：`src/test/config-cleanup.test.ts`

测试用例：
1. 配置文件清理功能
2. 配置写入拦截器
3. 向量配置管理器
4. 数据迁移正确性

#### 步骤9：手动验证

1. **验证配置文件大小**：
   - 运行清理工具前：记录原始大小
   - 运行清理工具后：确认大小显著减小（从MB级别降到KB级别）

2. **验证功能完整性**：
   - 加载设置功能正常
   - 向量配置读取正常
   - 向量数据存储和检索正常

3. **验证数据迁移**：
   - 确认向量数据完整迁移到 vecstore.json
   - 确认 vecstore_metadata.json 元数据正确

### 阶段5：优化与加固

#### 步骤10：添加配置文件监控

**文件**：`src/main/services/ConfigMonitor.ts`

功能：
- 监控配置文件大小变化
- 异常增长时发出警告
- 自动触发清理

#### 步骤11：更新类型定义

**文件**：`src/main/types/vectorConfig.ts`

强化 VectorConfig 接口约束：
```typescript
export interface VectorConfig {
  embeddingMode: EmbeddingMode;
  remoteModel: string;
  remoteApiUrl: string;
  remoteApiKey: string;
  localModel: string;
  cacheEnabled: boolean;
  cacheL1Size: number;
  cacheL1TTL: number;
  cacheL2TTL: number;
  defaultTopK: number;
  minSimilarityScore: number;
  contextWindowTokens: number;
  autoVectorizeWorldBook: boolean;
  autoVectorizeKnowledge: boolean;
  dimension?: number;
  // 明确禁止存储向量数据
  // 不允许包含 vectors、vectorData、embeddings 等字段
}
```

## 预期效果

1. **配置文件体积**：从MB级别降至KB级别（仅保留配置参数）
2. **向量数据管理**：完全独立存储于 vecstore.json 文件
3. **数据安全性**：通过写入拦截器防止配置膨胀
4. **功能完整性**：所有现有功能正常工作
5. **性能提升**：配置文件读写速度显著提升

## 风险控制

1. **数据备份**：清理前自动备份原始配置文件
2. **渐进式清理**：先分析再清理，确保数据安全
3. **回滚机制**：保留清理前后的配置文件对比
4. **日志记录**：详细记录所有操作，便于排查问题

## 实施步骤

1. ✅ 分析当前配置文件结构和存储逻辑
2. ✅ 定位vector向量化数据存储的相关代码
3. ✅ 设计配置数据与向量化数据分离方案
4. ⬜ 实现配置清理和验证逻辑
5. ⬜ 创建独立的向量配置管理器
6. ⬜ 重构配置保存逻辑
7. ⬜ 添加配置写入拦截器
8. ⬜ 创建单元测试
9. ⬜ 手动验证配置文件体积和功能
10. ⬜ 添加配置文件监控
11. ⬜ 更新类型定义
