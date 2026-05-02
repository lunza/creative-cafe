# 数据持久化存储组件 API 文档

## 组件概述

数据持久化存储组件是一个基于 `electron-store` 实现的统一数据存储解决方案，用于管理项目中所有需要持久化的数据，包括配置文件、世界书、角色卡、创意内容和聊天记录等。

### 核心特性

- **统一的数据存储接口**：提供简洁的 API 接口，支持各种数据操作
- **基于 electron-store**：利用 electron-store 的可靠持久化能力
- **支持多种数据类型**：可存储各种类型的数据，包括对象、数组、字符串等
- **错误处理机制**：内置错误处理，确保操作安全
- **数据验证功能**：确保数据结构的完整性
- **版本控制能力**：支持数据结构的向后兼容和迁移

## 安装和导入

### 安装依赖

项目已安装 `electron-store` 依赖，版本为 11.0.2。

### 导入组件

```typescript
// 导入默认实例
import { dataPersistence } from './Common';

// 或者创建自定义实例
import { getDataPersistence } from './Common';
const customPersistence = getDataPersistence({ name: 'custom-store' });
```

## API 接口说明

### 通用方法

#### `get<T>(key: string): T | undefined`
- **描述**：获取指定键的数据
- **参数**：
  - `key`：数据键名
- **返回值**：指定类型的数据或 `undefined`
- **示例**：
  ```typescript
  const settings = dataPersistence.get('settings');
  ```

#### `set<T>(key: string, value: T): void`
- **描述**：设置指定键的数据
- **参数**：
  - `key`：数据键名
  - `value`：要存储的数据
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.set('settings', { theme: 'dark', language: 'zh-CN' });
  ```

#### `update<T>(key: string, updater: (value: T) => T): void`
- **描述**：更新指定键的数据
- **参数**：
  - `key`：数据键名
  - `updater`：更新函数，接收当前值并返回新值
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.update('settings', (settings) => {
    return { ...settings, theme: 'light' };
  });
  ```

#### `delete(key: string): void`
- **描述**：删除指定键的数据
- **参数**：
  - `key`：数据键名
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.delete('testKey');
  ```

#### `clear(): void`
- **描述**：清空所有数据
- **参数**：无
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.clear();
  ```

#### `has(key: string): boolean`
- **描述**：检查指定键是否存在
- **参数**：
  - `key`：数据键名
- **返回值**：布尔值，表示键是否存在
- **示例**：
  ```typescript
  const exists = dataPersistence.has('settings');
  ```

#### `getAll(): Record<string, any>`
- **描述**：获取所有数据
- **参数**：无
- **返回值**：包含所有数据的对象
- **示例**：
  ```typescript
  const allData = dataPersistence.getAll();
  ```

#### `export(): string`
- **描述**：导出所有数据为 JSON 字符串
- **参数**：无
- **返回值**：JSON 字符串
- **示例**：
  ```typescript
  const exportedData = dataPersistence.export();
  ```

#### `import(data: string): void`
- **描述**：从 JSON 字符串导入数据
- **参数**：
  - `data`：JSON 字符串
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.import(jsonString);
  ```

### 分类方法

#### `getSettings(): any`
- **描述**：获取应用配置
- **参数**：无
- **返回值**：配置对象
- **示例**：
  ```typescript
  const settings = dataPersistence.getSettings();
  ```

#### `setSettings(settings: any): void`
- **描述**：设置应用配置
- **参数**：
  - `settings`：配置对象
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setSettings({ theme: 'dark', language: 'zh-CN' });
  ```

#### `getWorldBook(id: string): any`
- **描述**：获取指定 ID 的世界书
- **参数**：
  - `id`：世界书 ID
- **返回值**：世界书对象
- **示例**：
  ```typescript
  const worldbook = dataPersistence.getWorldBook('worldbook_1');
  ```

#### `setWorldBook(id: string, data: any): void`
- **描述**：设置指定 ID 的世界书
- **参数**：
  - `id`：世界书 ID
  - `data`：世界书数据
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setWorldBook('worldbook_1', { name: '测试世界', description: '这是一个测试世界' });
  ```

#### `getCharacter(id: string): any`
- **描述**：获取指定 ID 的角色卡
- **参数**：
  - `id`：角色卡 ID
- **返回值**：角色卡对象
- **示例**：
  ```typescript
  const character = dataPersistence.getCharacter('character_1');
  ```

#### `setCharacter(id: string, data: any): void`
- **描述**：设置指定 ID 的角色卡
- **参数**：
  - `id`：角色卡 ID
  - `data`：角色卡数据
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setCharacter('character_1', { name: '测试角色', description: '这是一个测试角色' });
  ```

#### `getCreative(id: string): any`
- **描述**：获取指定 ID 的创意内容
- **参数**：
  - `id`：创意内容 ID
- **返回值**：创意内容对象
- **示例**：
  ```typescript
  const creative = dataPersistence.getCreative('creative_1');
  ```

#### `setCreative(id: string, data: any): void`
- **描述**：设置指定 ID 的创意内容
- **参数**：
  - `id`：创意内容 ID
  - `data`：创意内容数据
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setCreative('creative_1', { title: '测试创意', content: '这是一个测试创意' });
  ```

#### `getChat(id: string): any`
- **描述**：获取指定 ID 的聊天记录
- **参数**：
  - `id`：聊天记录 ID
- **返回值**：聊天记录对象
- **示例**：
  ```typescript
  const chat = dataPersistence.getChat('chat_1');
  ```

#### `setChat(id: string, data: any): void`
- **描述**：设置指定 ID 的聊天记录
- **参数**：
  - `id`：聊天记录 ID
  - `data`：聊天记录数据
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setChat('chat_1', { messages: [], lastUpdated: new Date().toISOString() });
  ```

#### `getTemplate(id: string): any`
- **描述**：获取指定 ID 的模板
- **参数**：
  - `id`：模板 ID
- **返回值**：模板对象
- **示例**：
  ```typescript
  const template = dataPersistence.getTemplate('template_1');
  ```

#### `setTemplate(id: string, data: any): void`
- **描述**：设置指定 ID 的模板
- **参数**：
  - `id`：模板 ID
  - `data`：模板数据
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setTemplate('template_1', { name: '测试模板', content: '这是一个测试模板' });
  ```

### 批量操作

#### `getWorldBooks(): Record<string, any>`
- **描述**：获取所有世界书
- **参数**：无
- **返回值**：包含所有世界书的对象，键为世界书 ID
- **示例**：
  ```typescript
  const worldbooks = dataPersistence.getWorldBooks();
  ```

#### `getCharacters(): Record<string, any>`
- **描述**：获取所有角色卡
- **参数**：无
- **返回值**：包含所有角色卡的对象，键为角色卡 ID
- **示例**：
  ```typescript
  const characters = dataPersistence.getCharacters();
  ```

#### `getCreatives(): Record<string, any>`
- **描述**：获取所有创意内容
- **参数**：无
- **返回值**：包含所有创意内容的对象，键为创意内容 ID
- **示例**：
  ```typescript
  const creatives = dataPersistence.getCreatives();
  ```

#### `getChats(): Record<string, any>`
- **描述**：获取所有聊天记录
- **参数**：无
- **返回值**：包含所有聊天记录的对象，键为聊天记录 ID
- **示例**：
  ```typescript
  const chats = dataPersistence.getChats();
  ```

#### `getTemplates(): Record<string, any>`
- **描述**：获取所有模板
- **参数**：无
- **返回值**：包含所有模板的对象，键为模板 ID
- **示例**：
  ```typescript
  const templates = dataPersistence.getTemplates();
  ```

### 版本控制

#### `getVersion(): string`
- **描述**：获取当前数据版本
- **参数**：无
- **返回值**：版本字符串
- **示例**：
  ```typescript
  const version = dataPersistence.getVersion();
  ```

#### `setVersion(version: string): void`
- **描述**：设置数据版本
- **参数**：
  - `version`：版本字符串
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.setVersion('1.0.0');
  ```

#### `migrateData(): void`
- **描述**：执行数据迁移
- **参数**：无
- **返回值**：无
- **示例**：
  ```typescript
  dataPersistence.migrateData();
  ```

## 使用示例

### 基本用法

```typescript
import { dataPersistence } from './Common';

// 存储设置
dataPersistence.setSettings({
  theme: 'dark',
  language: 'zh-CN',
  logLevel: 'info'
});

// 获取设置
const settings = dataPersistence.getSettings();
console.log('当前设置:', settings);

// 存储角色卡
const character = {
  id: 'character_123',
  name: '测试角色',
  description: '这是一个测试角色',
  personality: '友好、乐观',
  scenario: '现代城市'
};
dataPersistence.setCharacter(character.id, character);

// 获取角色卡
const retrievedCharacter = dataPersistence.getCharacter(character.id);
console.log('获取的角色卡:', retrievedCharacter);

// 获取所有角色卡
const allCharacters = dataPersistence.getCharacters();
console.log('所有角色卡:', allCharacters);

// 导出数据
const exportedData = dataPersistence.export();
console.log('导出的数据:', exportedData);
```

### 错误处理

```typescript
import { dataPersistence } from './Common';

try {
  // 尝试存储无效数据
  dataPersistence.set('invalidData', null);
} catch (error) {
  console.error('存储数据失败:', error);
}

try {
  // 尝试导入无效的 JSON
  dataPersistence.import('invalid json');
} catch (error) {
  console.error('导入数据失败:', error);
}
```

## 错误处理

数据持久化组件内置了错误处理机制，当操作失败时会抛出错误。常见的错误类型包括：

- **VALIDATION_ERROR**：数据验证失败
- **STORAGE_ERROR**：存储操作失败
- **IMPORT_ERROR**：数据导入失败

建议在使用时使用 try-catch 捕获这些错误，以确保应用的稳定性。

## 最佳实践

1. **使用分类方法**：优先使用分类方法（如 `setSettings`、`setCharacter` 等）来管理特定类型的数据，而不是直接使用 `set` 方法。

2. **数据验证**：在存储数据前，确保数据结构正确，以避免验证错误。

3. **错误处理**：始终使用 try-catch 捕获可能的错误，确保应用的稳定性。

4. **版本控制**：当数据结构发生变化时，更新版本号并实现相应的迁移逻辑。

5. **数据备份**：定期导出数据，以防止数据丢失。

6. **性能优化**：对于大量数据操作，考虑批量处理，以提高性能。

## 存储位置

数据存储在 Electron 应用的用户数据目录中，具体路径为：

- **Windows**：`%APPDATA%/sillytaven-manager/config/travenmanager.json`
- **macOS**：`~/Library/Application Support/sillytaven-manager/config/travenmanager.json`
- **Linux**：`~/.config/sillytaven-manager/config/travenmanager.json`

## 版本历史

- **1.0.0**：初始版本，支持基本的 CRUD 操作、分类数据管理、版本控制和数据迁移。
