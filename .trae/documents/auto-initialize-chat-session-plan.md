# 用户首次对话自动初始化功能实施计划

## 需求分析

当系统检测到用户进行首次对话且尚未生成聊天记录文件和对应表格时（`getTableData()` 返回空数据），应自动执行初始化流程：
1. 创建新的聊天记录实体，包含必要元数据
2. 绑定系统默认表格模板
3. 创建空表格用于后续数据存储
4. 严格遵循现有"关联"功能的技术规范

## 现有代码分析

### 已有的关键功能

**1. `chatLogService.associateTemplate(chatId, templateId)`** ([chatLogService.ts:2049](file:///g:/AI/creative-cafe/src/main/services/memory/chatLogService.ts#L2049-L2100))
- 创建模板副本（`isCopy: true, originalTemplateId, chatId`）
- 调用 `tableTemplateService.createTableFile()` 创建表格JSON
- 调用 `saveAssociation()` 保存关联关系到 `associations.json`
- 这是"关联"功能的核心实现

**2. `tableTemplateService.createTableFile(chatId, templateId, safeChatId)`** ([tableTemplateService.ts:248](file:///g:/AI/creative-cafe/src/main/services/memory/tableTemplateService.ts#L248-L295))
- 根据模板结构初始化JSON表格数据（sheets, headers, data）
- 保存到 `chatlog/` 目录

**3. 默认模板** ([tableTemplateService.ts:29](file:///g:/AI/creative-cafe/src/main/services/memory/tableTemplateService.ts#L29-L70))
- ID: `st-memory-enhancement-default`
- 包含5个表格：时空、角色、社交、物品、事件

**4. 已有的自动创建表格逻辑** ([chatLogService.ts:1196](file:///g:/AI/creative-cafe/src/main/services/memory/chatLogService.ts#L1196-L1215))
- 在 `executeTableEditCommands` 中已有类似逻辑：当表格文件不存在时，尝试用关联模板或默认模板创建文件
- 但此逻辑仅在异步整理命令执行时触发，不覆盖首次对话场景

### 触发时机

应在 `getTableData()` 方法中检测到表格文件不存在时触发自动初始化。当前 `getTableData()` 已修改为返回空数据而非抛出异常，是添加自动初始化的理想位置。

## 实施方案

### 步骤1：在 `chatLogService` 中新增 `autoInitializeChatSession()` 方法

**文件**：`src/main/services/memory/chatLogService.ts`

在 `getTableData()` 方法之前，新增公共方法 `autoInitializeChatSession(chatId: string)`，执行完整的初始化流程：

```typescript
public autoInitializeChatSession(chatId: string): boolean {
  // 1. 检查是否已存在关联关系（避免重复初始化）
  const existingTemplateId = this.getAssociatedTemplate(chatId);
  if (existingTemplateId) {
    addLog(`[AutoInit] 聊天会话 ${chatId} 已有关联模板 ${existingTemplateId}，跳过初始化`, 'info');
    return false; // 已初始化，跳过
  }

  addLog(`[AutoInit] 开始自动初始化聊天会话: ${chatId}`, 'info');

  try {
    // 2. 获取默认模板ID（取第一个可用模板）
    const allTemplates = tableTemplateService.getAllTemplates();
    if (!allTemplates || allTemplates.length === 0) {
      addLog('[AutoInit] 没有可用的表格模板，无法自动初始化', 'error');
      return false;
    }

    const defaultTemplateId = allTemplates[0].id;
    addLog(`[AutoInit] 使用默认模板: ${defaultTemplateId} (${allTemplates[0].name})`, 'info');

    // 3. 调用现有的 associateTemplate 方法完成初始化
    // associateTemplate 内部会：
    //   - 创建模板副本（包含 originalTemplateId, chatId 等元数据）
    //   - 调用 createTableFile 创建空表格JSON文件
    //   - 调用 saveAssociation 保存关联关系
    this.associateTemplate(chatId, defaultTemplateId);

    addLog(`[AutoInit] 聊天会话 ${chatId} 自动初始化完成`, 'info');
    return true;
  } catch (error) {
    addLog(`[AutoInit] 自动初始化失败: ${error}`, 'error');
    console.error('[AutoInit] Auto initialization error:', error);
    return false;
  }
}
```

**设计说明**：
- 复用现有 `associateTemplate` 方法，严格遵循"关联"功能的技术规范
- `associateTemplate` 内部已包含：创建模板副本、保存副本、创建表格文件、存储关联关系 四个步骤
- 使用 `addLog` 记录详细日志（通过 `sendLogToRenderer` 发送到渲染进程）
- 返回 boolean 标识是否成功执行了初始化

### 步骤2：修改 `getTableData()` 方法，在返回空数据时触发自动初始化

**文件**：`src/main/services/memory/chatLogService.ts`（修改 `getTableData` 方法）

在当前 `getTableData()` 方法返回空数据的分支中，增加自动初始化调用：

```typescript
// 当前代码（修改后）：
if (!fs.existsSync(jsonPath)) {
  console.log('[getTableData] 表格文件不存在 (新对话或尚未创建表格):', jsonPath);
  // ... 尝试从 chats 目录查找备份文件 ...
  
  // 新增：自动初始化
  const initSuccess = this.autoInitializeChatSession(chatId);
  
  if (initSuccess) {
    // 初始化成功后，重新读取刚创建的表格数据
    addLog('[getTableData] 自动初始化成功，重新读取表格数据', 'info');
    return this.getTableData(chatId); // 递归调用获取刚创建的数据
  }
  
  console.log('[getTableData] 备份文件也不存在且自动初始化失败，返回空数据');
  return { sheets: [], headers: {}, data: {}, sheetDescriptions: {} };
}
```

**注意**：递归调用 `this.getTableData(chatId)` 时，由于刚创建的文件已存在，会走正常的文件读取分支（line 3217-3252），不会再次触发初始化。

### 步骤3：（可选）在 IPC 层增加独立的初始化 API

**文件**：`src/main/ipc/handlers/memoryHandlers.ts`

新增一个独立的 IPC handler 供渲染进程主动调用初始化：

```typescript
ipcMain.handle('memory:autoInitializeSession', async (
  event: IpcMainInvokeEvent, 
  chatId: string
): Promise<{ success: boolean; templateId: string | null }> => {
  try {
    console.log('[IPC] memory:autoInitializeSession 请求, chatId:', chatId);
    const templateId = chatLogService.getAssociatedTemplate(chatId);
    
    // 如果已有模板，说明已初始化
    if (templateId) {
      return { success: true, templateId };
    }
    
    // 执行自动初始化
    const success = chatLogService.autoInitializeChatSession(chatId);
    const newTemplateId = success ? chatLogService.getAssociatedTemplate(chatId) : null;
    
    console.log('[IPC] memory:autoInitializeSession 返回结果:', { success, templateId: newTemplateId });
    return { success, templateId: newTemplateId };
  } catch (error) {
    console.error('[IPC] memory:autoInitializeSession 失败:', error);
    return { success: false, templateId: null };
  }
});
```

**设计说明**：
- 这是一个可选步骤，主要用于前端主动触发（如用户点击"开始整理"按钮但表格尚未创建时）
- 主要触发点还是 `getTableData()` 中的被动触发

### 步骤4：在渲染进程类型声明中增加新 API

**文件**：`src/renderer/types/electron.ts` 或 `src/renderer/types/electron.d.ts`

增加新 API 的类型声明（如果步骤3被采用）。

## 技术要点总结

| 要点 | 说明 |
|------|------|
| **复用现有逻辑** | 完全复用 `associateTemplate` 方法，确保遵循现有技术规范 |
| **模板副本机制** | `associateTemplate` 会创建模板副本（`isCopy: true`），保留 `originalTemplateId` 和 `chatId` 元数据 |
| **关联关系存储** | 关联关系保存在 `chatsDir/associations.json` 中，格式为 `Record<string, AssociationRecord>` |
| **表格文件位置** | JSON表格文件保存在 `chatlog/` 目录，命名格式为 `{safeChatId}.json` |
| **去重保护** | 通过 `getAssociatedTemplate()` 检查是否已有模板关联，避免重复初始化 |
| **默认模板选择** | 使用 `getAllTemplates()[0]` 获取第一个可用模板（即默认模板 `st-memory-enhancement-default`） |
| **日志记录** | 使用 `addLog` 通过 `sendLogToRenderer` 向渲染进程发送日志 |
| **递归安全** | `getTableData` 中递归调用时，文件已创建，不会再次触发初始化 |

## 实施步骤

1. 在 `chatLogService.ts` 中新增 `autoInitializeChatSession()` 方法
2. 修改 `getTableData()` 方法，在文件不存在且备份不存在的分支中调用 `autoInitializeChatSession()`
3. （可选）在 `memoryHandlers.ts` 中新增 `memory:autoInitializeSession` IPC handler
4. （可选）在渲染进程类型声明中增加新 API 类型
5. 测试验证：新建对话角色 → 发送消息 → 确认表格文件自动创建且对话正常进行
