# SillyTavern 记忆增强插件 - 技术原理分析

## 一、插件概述

**插件名称**: st-memory-enhancement  
**版本**: 2.2.10  
**位置**: `g:\AI\creative-cafe\sillytavern-source\SillyTavern\data\default-user\extensions\st-memory-enhancement`

该插件实现了在 SillyTavern 中通过 AI 自动维护和更新记忆表格的功能，核心特性包括：
- 动态表格数据管理（增删改查）
- AI 响应后自动解析并执行 tableEdit 指令
- 支持同步整理（自动刷新）和异步整理（分步填表）两种模式
- 表格数据注入到 AI 提示词中供 AI 读取

---

## 二、核心架构模块

### 2.1 核心管理层 (`core/manager.js`)

插件的依赖注入和模块管理系统，提供以下几个关键管理器：

| 管理器 | 职责 |
|--------|------|
| `APP` | 主程序事件源和事件类型定义 |
| `BASE` | 表格基础操作（创建、查询、转换、状态管理） |
| `DERIVED` | 派生数据和临时状态存储 |
| `EDITOR` | UI 编辑器相关功能（弹窗、提示等） |
| `SYSTEM` | 系统级工具函数 |
| `USER` | 用户配置和聊天上下文管理 |

### 2.2 表格数据模型 (`core/table/`)

| 文件 | 职责 |
|------|------|
| `base.js` | Sheet 基类定义，包含 SheetDomain、SheetType 枚举 |
| `sheet.js` | Sheet 实例管理，提供 hashSheet 存储结构 |
| `cell.js` | 单元格数据模型，支持 CellAction 操作（编辑、插入、删除） |
| `actions.js` | 表格操作执行器 |
| `template.js` | 表格模板管理 |

---

## 三、"在AI输出后拼接指令"功能实现机制

### 3.1 整体工作流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI 对话流程                                  │
├─────────────────────────────────────────────────────────────────────┤
│ 1. 用户发送消息                                                      │
│    ↓                                                                 │
│ 2. onChatCompletionPromptReady 事件触发                              │
│    → 注入表格数据到 system prompt (onChatCompletionPromptReady)      │
│    → AI 接收包含当前表格状态的提示词                                   │
│    ↓                                                                 │
│ 3. AI 生成响应                                                        │
│    → 在响应末尾附加 <tableEdit>...</tableEdit> 标签                   │
│    ↓                                                                 │
│ 4. onMessageReceived 事件触发                                        │
│    → handleEditStrInMessage() 解析 AI 响应                           │
│    → parseTableEditTag() 提取 tableEdit 标签内容                     │
│    → handleTableEditTag() 解析 insertRow/updateRow/deleteRow 指令    │
│    → executeAction() 执行表格操作                                    │
│    → sheet.save() 保存更新后的表格数据                                │
│    ↓                                                                 │
│ 5. updateSheetsView() 刷新 UI                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键事件监听机制 (`index.js:948-954`)

```javascript
// 监听主程序事件
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
APP.eventSource.on(APP.event_types.CHAT_CHANGED, onChatChanged);
APP.eventSource.on(APP.event_types.MESSAGE_EDITED, onMessageEdited);
APP.eventSource.on(APP.event_types.MESSAGE_SWIPED, onMessageSwiped);
APP.eventSource.on(APP.event_types.MESSAGE_DELETED, onChatChanged);
```

**核心事件说明：**

| 事件 | 触发时机 | 处理函数 | 功能 |
|------|----------|----------|------|
| `CHAT_COMPLETION_PROMPT_READY` | AI 生成提示词准备就绪时 | `onChatCompletionPromptReady()` | 将当前表格数据注入到 AI 提示词中 |
| `CHARACTER_MESSAGE_RENDERED` | AI 消息渲染完成时 | `onMessageReceived()` | 解析 AI 响应中的 tableEdit 指令并执行 |
| `MESSAGE_EDITED` | 用户编辑消息时 | `onMessageEdited()` | 重新解析编辑后的消息中的表格指令 |
| `MESSAGE_SWIPED` | 滑动切换回复时 | `onMessageSwiped()` | 处理不同回复版本的表格数据 |

### 3.3 表格数据注入机制 (`index.js:543-583`)

```javascript
async function onChatCompletionPromptReady(eventData) {
    // 分步填表模式处理
    if (USER.tableBaseSetting.step_by_step === true) {
        // 只注入表格数据供 AI 读取，不要求 AI 输出 tableEdit
        const tableData = getTablePrompt(eventData, true);
        eventData.chat.push({ role: getMesRole(), content: finalPrompt });
        return; // 处理完分步模式后直接退出
    }

    // 常规模式：注入完整提示词
    const promptContent = initTableData(eventData);
    if (USER.tableBaseSetting.deep === 0)
        eventData.chat.push({ role: getMesRole(), content: promptContent });
    else
        eventData.chat.splice(-USER.tableBaseSetting.deep, 0, { role: getMesRole(), content: promptContent });
}
```

**注入位置控制：**
- `deep === 0`: 追加到消息列表末尾
- `deep > 0`: 插入到倒数第 `deep` 条消息之前

**注入角色配置 (`index.js:527-536`):**
```javascript
function getMesRole() {
    switch (USER.tableBaseSetting.injection_mode) {
        case 'deep_system': return 'system';
        case 'deep_user': return 'user';
        case 'deep_assistant': return 'assistant';
    }
}
```

### 3.4 AI 响应解析机制 (`index.js:301-320`)

```javascript
export function parseTableEditTag(piece, mesIndex = -1, ignoreCheck = false) {
    // 步骤 1: 提取 tableEdit 标签内容
    const { matches } = getTableEditTag(piece.mes);
    
    // 步骤 2: 检查是否重复执行（防重）
    if (!ignoreCheck && !isTableEditStrChanged(piece, matches)) return false;
    
    // 步骤 3: 解析指令
    const tableEditActions = handleTableEditTag(matches);
    
    // 步骤 4: 格式化参数
    tableEditActions.forEach((action, index) => 
        tableEditActions[index].action = classifyParams(formatParams(action.param))
    );
    
    // 步骤 5: 获取上一个表格状态作为参考
    const { piece: prePiece } = mesIndex === -1 
        ? BASE.getLastSheetsPiece(1) 
        : BASE.getLastSheetsPiece(mesIndex - 1, 1000, false);
    const sheets = BASE.hashSheetsToSheets(prePiece.hash_sheets).filter(sheet => sheet.enable);
    
    // 步骤 6: 排序并执行操作
    for (const EditAction of sortActions(tableEditActions)) {
        executeAction(EditAction, sheets);
    }
    
    // 步骤 7: 保存更新
    sheets.forEach(sheet => sheet.save(piece, true));
    return true;
}
```

### 3.5 tableEdit 标签提取 (`index.js:642-651`)

```javascript
export function getTableEditTag(mes) {
    const regex = /<tableEdit>(.*?)<\/tableEdit>/gs;
    const matches = [];
    let match;
    while ((match = regex.exec(mes)) !== null) {
        matches.push(match[1]);  // 提取标签内部内容
    }
    const updatedText = mes.replace(regex, "");  // 从消息中移除标签
    return { matches };
}
```

**支持格式：**
- `<tableEdit>insertRow(...)</tableEdit>`
- `<!--  <tableEdit>insertRow(...)</tableEdit> -->`

### 3.6 指令解析 (`index.js:220-255`)

```javascript
function handleTableEditTag(matches) {
    const functionRegex = /(updateRow|insertRow|deleteRow)\(/g;
    let A = [];
    let positions = [];
    
    matches.forEach(input => {
        // 查找所有函数调用位置
        while ((match = functionRegex.exec(input)) !== null) {
            positions.push({
                index: match.index,
                name: match[1].replace("Row", "") // updateRow → update
            });
        }

        // 分割并解析每个函数调用
        for (let i = 0; i < positions.length; i++) {
            const start = positions[i].index;
            const end = i + 1 < positions.length ? positions[i + 1].index : input.length;
            const fullCall = input.slice(start, end);
            const lastParenIndex = fullCall.lastIndexOf(")");

            if (lastParenIndex !== -1) {
                const sliced = fullCall.slice(0, lastParenIndex);
                const argsPart = sliced.slice(sliced.indexOf("(") + 1);
                const args = argsPart.match(/("[^"]*"|\{.*\}|[0-9]+)/g)?.map(s => s.trim());
                
                A.push({
                    type: positions[i].name,  // 'update', 'insert', 'delete'
                    param: args,
                    index: positions[i].index,
                    length: end - start
                });
            }
        }
    });
    return A;
}
```

**参数解析示例：**
```
insertRow(2, {"2":"zhudi_001","3":"朱迪"})
↓
{
    type: 'insert',
    param: [2, '{"2":"zhudi_001","3":"朱迪"}']
}
```

### 3.7 指令执行 (`index.js:359-407`)

```javascript
function executeAction(EditAction, sheets) {
    const action = EditAction.action;
    const sheet = sheets[action.tableIndex];
    
    switch (EditAction.type) {
        case 'update':
            // 更新现有行
            const rowIndex = action.rowIndex ? parseInt(action.rowIndex) : 0;
            if (rowIndex >= sheet.getRowCount() - 1) 
                return executeAction({...EditAction, type:'insert'}, sheets);  // 降级为插入
            Object.entries(action.data).forEach(([key, value]) => {
                const cell = sheet.findCellByPosition(rowIndex + 1, parseInt(key) + 1);
                cell.newAction(Cell.CellAction.editCell, { value }, false);
            });
            break;
            
        case 'insert':
            // 插入新行
            const cell = sheet.findCellByPosition(sheet.getRowCount() - 1, 0);
            cell.newAction(Cell.CellAction.insertDownRow, {}, false);
            const lastestRow = sheet.getRowCount() - 1;
            const cells = sheet.getCellsByRowIndex(lastestRow);
            cells.forEach((cell, index) => {
                if (index === 0) return;
                cell.data.value = action.data[index - 1];
            });
            break;
            
        case 'delete':
            // 删除行
            const deleteRow = parseInt(action.rowIndex) + 1;
            const cell = sheet.findCellByPosition(deleteRow, 0);
            cell.newAction(Cell.CellAction.deleteSelfRow, {}, false);
            break;
    }
}
```

**操作排序优先级 (`index.js:415-423`):**
```javascript
const priority = {
    update: 0,  // 优先更新
    insert: 1,  // 其次插入
    delete: 2   // 最后删除
};
```

---

## 四、异步整理（分步填表）模式

### 4.1 触发条件 (`index.js:673-689`)

```javascript
async function onMessageReceived(chat_id) {
    if (USER.tableBaseSetting.isExtensionAble === false) return;
    
    // 分步填表模式
    if (USER.tableBaseSetting.step_by_step === true && USER.getContext().chat.length > 2) {
        TableTwoStepSummary("auto");  // 异步执行，不阻塞主流程
    } else {
        // 同步模式：直接解析 AI 响应中的 tableEdit 指令
        if (USER.tableBaseSetting.isAiWriteTable === false) return;
        const chat = USER.getContext().chat[chat_id];
        handleEditStrInMessage(chat);
    }
}
```

### 4.2 两步摘要流程 (`scripts/runtime/separateTableUpdate.js`)

```
┌──────────────────────────────────────────────────────────────┐
│                    分步填表工作流程                            │
├──────────────────────────────────────────────────────────────┤
│ 1. 累积多条对话记录                                           │
│    ↓                                                         │
│ 2. 弹出确认框（可选跳过）                                      │
│    ↓                                                         │
│ 3. undoSheets(0) - 恢复到上次填表前的状态                     │
│    ↓                                                         │
│ 4. executeIncrementalUpdateFromSummary()                     │
│    → 构建独立提示词（包含当前表格+待整理聊天记录）              │
│    → 调用 AI API（可使用独立模型）                             │
│    → 解析 AI 返回的 tableEdit 指令                            │
│    → 执行表格操作                                             │
│    ↓                                                         │
│ 5. saveChat() + reloadCurrentChat() - 保存并刷新              │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 增量更新执行 (`scripts/runtime/absoluteRefresh.js:867-1030`)

```javascript
export async function executeIncrementalUpdateFromSummary(
    chatToBeUsed,      // 待整理的聊天记录
    originTableText,   // 当前表格文本
    finalPrompt,       // 完整提示词
    referencePiece,    // 参考的聊天片段
    useMainAPI,        // 是否使用主 API
    silentUpdate,      // 是否静默更新
    isSilentMode       // 是否静默模式（不显示加载提示）
) {
    // 1. 构建 API 提示词（支持多消息格式）
    const promptMessages = JSON5.parse(USER.tableBaseSetting.step_by_step_user_prompt);
    const processedMessages = promptMessages.map(msg => ({
        ...msg,
        content: replacePlaceholders(msg.content)  // $0=表格, $1=上下文, $2=聊天记录, $3=提示词
    }));
    
    // 2. 调用 AI API
    rawContent = useMainAPI 
        ? await handleMainAPIRequest(processedMessages, null, isSilentMode)
        : await handleCustomAPIRequest(processedMessages, userPromptForApi, true, isSilentMode);
    
    // 3. 解析响应中的 tableEdit 标签
    const { matches } = getTableEditTag(rawContent);
    
    // 4. 执行表格操作
    executeTableEditActions(matches, referencePiece);
    
    // 5. 保存并刷新
    USER.saveChat();
    BASE.refreshContextView();
    updateSystemMessageTableStatus();
    
    return 'success';
}
```

---

## 五、配置参数读取方式

### 5.1 核心配置项 (`USER.tableBaseSetting`)

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `isExtensionAble` | boolean | 插件是否启用 |
| `isAiReadTable` | boolean | AI 是否读取表格数据 |
| `isAiWriteTable` | boolean | AI 是否写入表格数据 |
| `step_by_step` | boolean | 是否启用分步填表模式 |
| `step_by_step_use_main_api` | boolean | 分步填表是否使用主 API |
| `injection_mode` | string | 注入模式：`deep_system`/`deep_user`/`deep_assistant`/`injection_off` |
| `deep` | number | 注入深度（0=末尾，>0=倒数第n条之前） |
| `clear_up_stairs` | number | 整理时使用的聊天记录条数 |
| `message_template` | string | 表格数据注入的模板格式 |

### 5.2 提示词模板配置

```javascript
// 分步填表提示词模板
USER.tableBaseSetting.step_by_step_user_prompt;  // JSON5 格式的多消息数组

// 重整理模板
USER.tableBaseSetting.rebuild_message_template_list;  // 模板列表
USER.tableBaseSetting.lastSelectedTemplate;           // 当前选择的模板
```

---

## 六、关键工作流程详解

### 6.1 同步整理模式（默认）

```
用户发送消息
    ↓
系统准备提示词 → onChatCompletionPromptReady()
    ↓ 注入当前表格数据到 prompt
AI 生成回复（需在回复末尾附加 tableEdit 指令）
    ↓
消息渲染完成 → onMessageReceived()
    ↓
handleEditStrInMessage()
    ↓
parseTableEditTag() → getTableEditTag() → handleTableEditTag()
    ↓
executeAction() → sortActions() → 执行 insert/update/delete
    ↓
sheet.save(piece) → 保存表格数据到当前聊天片段
    ↓
updateSheetsView() → 刷新 UI
```

### 6.2 异步整理模式（分步填表）

```
用户发送多条消息（累积）
    ↓
onMessageReceived() 检测到 step_by_step === true
    ↓
TableTwoStepSummary("auto") → 异步执行，不阻塞
    ↓
弹出确认框（可配置跳过）
    ↓
undoSheets(0) → 恢复到上次填表前的干净状态
    ↓
executeIncrementalUpdateFromSummary()
    ↓ 构建独立提示词：
    │ - $0: 当前表格数据
    │ - $1: 上下文聊天记录
    │ - $2: 待整理的聊天记录
    │ - $3: 完整的表格提示词（包含表格结构、规则等）
    ↓
调用 AI API（可使用独立模型和配置）
    ↓
解析 AI 返回的 tableEdit 指令
    ↓
executeTableEditActions() → 执行表格操作
    ↓
USER.saveChat() + reloadCurrentChat() → 保存并刷新
```

---

## 七、与当前项目（Creative Café）的对比

| 特性 | SillyTavern 插件 | Creative Café 当前实现 |
|------|------------------|------------------------|
| 指令拼接位置 | AI 响应末尾（由 AI 生成） | 由前端代码提取，不依赖 AI 生成 |
| 解析触发 | `CHARACTER_MESSAGE_RENDERED` 事件 | SSE 流式响应完成后的回调 |
| 表格状态管理 | 基于 `hash_sheets` 的 Sheet 实例 | 基于 Excel 文件 + 内存状态 |
| 增量更新 | 直接在原表格上执行操作 | 通过 IPC 发送到后端处理 |
| 异步整理 | 独立 API 调用，可配置模型 | 复用主对话 API，追加指令到 prompt |
| 指令格式 | `<tableEdit>insertRow(...)</tableEdit>` | 相同的 tableEdit 格式 |

---

## 八、关键代码位置索引

| 功能 | 文件 | 行号 |
|------|------|------|
| 事件注册 | `index.js` | 948-954 |
| 提示词注入 | `index.js` | 543-583 |
| 消息接收处理 | `index.js` | 673-689 |
| tableEdit 标签提取 | `index.js` | 642-651 |
| 指令解析 | `index.js` | 220-255 |
| 指令执行 | `index.js` | 359-407 |
| 分步填表入口 | `separateTableUpdate.js` | 77-121 |
| 增量更新执行 | `absoluteRefresh.js` | 867-1030 |
| LLM API 调用 | `llmApi.js` | 24-130 |

---

## 九、总结

SillyTavern 记忆增强插件的核心实现原理是：

1. **事件驱动**: 通过监听 SillyTavern 主程序的事件（提示词准备、消息渲染等）来触发表格操作
2. **Prompt 注入**: 在 AI 生成提示词时将当前表格数据注入，让 AI 了解现有记忆状态
3. **指令解析**: AI 在回复末尾生成 `<tableEdit>` 标签，插件通过正则表达式提取并解析其中的 `insertRow/updateRow/deleteRow` 指令
4. **表格操作**: 基于 Sheet 实例系统执行增删改操作，并持久化到聊天数据中
5. **双模式支持**: 同步模式（每次回复后自动更新）和异步模式（累积多条回复后统一整理）

**关键设计亮点：**
- 使用 `hash_sheets` 数据结构维护表格状态，支持高效查询和更新
- 通过 `CellAction` 操作队列实现事务性的表格修改
- 分步填表模式支持使用独立的 API 配置，避免与主对话共享上下文长度
- 完善的事件监听系统确保表格状态与对话同步
