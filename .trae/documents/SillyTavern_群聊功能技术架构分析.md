# SillyTavern 群聊功能技术架构分析

> **文档版本**: v1.0  
> **分析日期**: 2026-05-13  
> **项目版本**: SillyTavern 最新版  
> **分析范围**: `public/scripts/group-chats.js`, `src/endpoints/groups.js`, `src/endpoints/chats.js`

---

## 目录

- [1. 概述](#1-概述)
- [2. 核心模块组成](#2-核心模块组成)
- [3. 数据结构设计](#3-数据结构设计)
- [4. 消息传递机制](#4-消息传递机制)
- [5. 角色激活算法](#5-角色激活算法)
- [6. 用户状态管理](#6-用户状态管理)
- [7. 界面交互逻辑](#7-界面交互逻辑)
- [8. API 接口定义](#8-api-接口定义)
- [9. 生成模式分析](#9-生成模式分析)
- [10. 关键算法实现](#10-关键算法实现)
- [11. 与其他功能模块的集成](#11-与其他功能模块的集成)
- [12. 数据迁移与兼容性](#12-数据迁移与兼容性)
- [13. 核心流程图](#13-核心流程图)
- [14. 开发参考指南](#14-开发参考指南)

---

## 1. 概述

### 1.1 群聊功能简介

SillyTavern 的群聊（Group Chat）功能允许用户创建包含多个 AI 角色（Character）的对话群组。在群聊中，多个角色可以根据不同的激活策略轮流或同时发言，实现多角色互动的沉浸式对话体验。该功能广泛应用于角色扮演故事创作、多角色讨论模拟等场景。

### 1.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | Vanilla JavaScript + jQuery | 无框架纯 JS 实现 |
| 后端 | Node.js + Express | RESTful API 服务端 |
| 存储 | 文件系统（JSON/JSONL） | 无数据库，纯文件存储 |
| 通信 | HTTP REST API | Fetch API 前后端交互 |
| 事件 | EventEmitter 模式 | 自定义事件总线 |

### 1.3 核心设计理念

- **文件驱动**: 所有数据以文件形式存储，群定义使用 `.json`，聊天记录使用 `.jsonl`（JSON Lines）
- **事件驱动**: 通过 `eventSource` 实现模块间松耦合通信
- **策略模式**: 多种角色激活策略可配置切换
- **懒加载**: 角色数据按需加载（unshallow），减少内存占用

---

## 2. 核心模块组成

### 2.1 前端控制模块 `group-chats.js`

**文件路径**: `public/scripts/group-chats.js`

这是群聊功能的核心前端控制器，包含约 2500 行代码，负责：

- 群聊的 CRUD 操作
- 角色激活策略的实现
- 消息生成流程控制
- UI 渲染与交互
- 状态管理

**关键导出**:
```javascript
export {
    selected_group,           // 当前选中的群 ID
    openGroupId,              // 当前打开的群 ID
    is_group_automode_enabled, // 自动模式是否启用
    hideMutedSprites,         // 是否隐藏静音角色精灵
    is_group_generating,      // 是否正在生成回复
    group_generation_id,      // 当前生成批次 ID
    groups,                   // 所有群组数据
    saveGroupChat,            // 保存群聊消息
    generateGroupWrapper,     // 群聊生成入口函数
    deleteGroup,              // 删除群组
    getGroupAvatar,           // 获取群头像
    getGroups,                // 获取所有群组
    regenerateGroup,          // 重新生成群聊
    resetSelectedGroup,       // 重置选中群状态
    select_group_chats,       // 选择群聊
    getGroupChatNames,        // 获取群聊名称列表
};
```

### 2.2 后端群组管理模块 `groups.js`

**文件路径**: `src/endpoints/groups.js`

Express 路由模块，提供群组管理的 RESTful API：

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/groups/all` | POST | 获取所有群组 |
| `/api/groups/create` | POST | 创建新群组 |
| `/api/groups/edit` | POST | 编辑群组 |
| `/api/groups/delete` | POST | 删除群组 |

### 2.3 后端群聊消息模块 `chats.js`

**文件路径**: `src/endpoints/chats.js`

Express 路由模块，提供群聊消息的 CRUD 操作：

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/chats/group/get` | POST | 获取群聊消息 |
| `/api/chats/group/save` | POST | 保存群聊消息 |
| `/api/chats/group/delete` | POST | 删除群聊消息 |
| `/api/chats/group/info` | POST | 获取群聊信息 |
| `/api/chats/group/import` | POST | 导入群聊消息 |

### 2.4 事件系统 `events.js`

**文件路径**: `public/scripts/events.js`

群聊相关的事件类型：

```javascript
GROUP_UPDATED: 'group_updated',
GROUP_CHAT_DELETED: 'group_chat_deleted',
GROUP_CHAT_CREATED: 'group_chat_created',
GROUP_MEMBER_DRAFTED: 'group_member_drafted',
GROUP_WRAPPER_STARTED: 'group_wrapper_started',
GROUP_WRAPPER_FINISHED: 'group_wrapper_finished',
CHARACTER_GROUP_OVERLAY_STATE_CHANGE_BEFORE: 'character_group_overlay_state_change_before',
CHARACTER_GROUP_OVERLAY_STATE_CHANGE_AFTER: 'character_group_overlay_state_change_after',
```

---

## 3. 数据结构设计

### 3.1 Group 对象结构

```javascript
/**
 * @typedef {Object} Group
 * @property {string} id - 群组唯一标识（时间戳字符串）
 * @property {string} name - 群组名称
 * @property {string[]} members - 成员头像标识符列表（按顺序）
 * @property {string} avatar_url - 自定义头像 URL（可为空）
 * @property {boolean} allow_self_responses - 是否允许角色自回复
 * @property {number} activation_strategy - 激活策略（0=NATURAL, 1=LIST, 2=MANUAL, 3=POOLED）
 * @property {number} generation_mode - 生成模式（0=SWAP, 1=APPEND, 2=APPEND_DISABLED）
 * @property {string[]} disabled_members - 被禁用的成员列表
 * @property {boolean} fav - 是否收藏
 * @property {string} chat_id - 当前活跃聊天的 ID
 * @property {string[]} chats - 所有聊天 ID 列表
 * @property {number} auto_mode_delay - 自动模式延迟（秒）
 * @property {string} generation_mode_join_prefix - 追加模式前缀模板
 * @property {string} generation_mode_join_suffix - 追加模式后缀模板
 * @property {boolean} hideMutedSprites - 是否隐藏静音角色精灵
 * @property {number} date_added - 创建时间（毫秒时间戳）
 * @property {string} create_date - 创建时间（ISO 格式）
 * @property {number} date_last_chat - 最后聊天时间（毫秒时间戳）
 * @property {number} chat_size - 聊天文件大小（字节）
 */
```

**JSON 文件示例**:
```json
{
    "id": "1700000000000",
    "name": "冒险小队",
    "members": [
        "Seraphina.png",
        "Warrior.png",
        "Mage.png"
    ],
    "avatar_url": "",
    "allow_self_responses": false,
    "activation_strategy": 0,
    "generation_mode": 0,
    "disabled_members": [],
    "fav": true,
    "chat_id": "2024-01-01_120000",
    "chats": ["2024-01-01_120000", "2024-01-02_150000"],
    "auto_mode_delay": 5,
    "generation_mode_join_prefix": "[{{char}}]",
    "generation_mode_join_suffix": "",
    "hideMutedSprites": false
}
```

### 3.2 ChatMessage 对象结构

```javascript
/**
 * @typedef {Object} ChatMessage
 * @property {string} name - 发送者名称
 * @property {boolean} is_user - 是否为用户消息
 * @property {boolean} is_system - 是否为系统消息
 * @property {string} send_date - 发送时间（ISO 格式）
 * @property {string} mes - 消息内容
 * @property {string} [original_avatar] - 原始头像标识
 * @property {string} [force_avatar] - 强制头像 URL（用于群聊）
 * @property {Object} [extra] - 额外数据
 * @property {number} [extra.gen_id] - 生成批次 ID
 * @property {string} [extra.display_text] - 显示文本
 * @property {string} [extra.type] - 消息类型
 */
```

### 3.3 ChatHeader 结构（消息文件头部）

```javascript
/**
 * @typedef {Object} ChatHeader
 * @property {Object} chat_metadata - 聊天元数据
 * @property {string} chat_metadata.integrity - 完整性校验 UUID
 * @property {string} user_name - 用户名（群聊中固定为 "unused"）
 * @property {string} character_name - 角色名（群聊中固定为 "unused"）
 */
```

### 3.4 文件存储格式

**群组定义文件**: `<user>/groups/<id>.json`
- 格式：标准 JSON
- 原子写入：使用 `write-file-atomic` 防止写入损坏

**群聊消息文件**: `<user>/group chats/<chat_id>.jsonl`
- 格式：JSON Lines（每行一个 JSON 对象）
- 第一行：ChatHeader（包含元数据）
- 后续行：ChatMessage（按时间顺序）

**文件存储路径结构**:
```
data/
├── default-user/
│   ├── groups/                    # 群组定义
│   │   ├── 1700000000000.json
│   │   └── 1700000000001.json
│   └── group chats/               # 群聊消息
│       ├── 2024-01-01_120000.jsonl
│       └── 2024-01-02_150000.jsonl
```

---

## 4. 消息传递机制

### 4.1 群聊消息加载流程

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  用户选择群  │ ──> │ 加载群组数据  │ ──> │ 验证群组数据  │
│  聊          │     │ getGroups()   │     │ validateGroup│
└─────────────┘     └──────────────┘     └──────────────┘
                                               │
                    ┌──────────────┐     ┌─────▼──────┐
                    │ 渲染消息到 UI │ <── │ 加载聊天文件│
                    │ printMessages │     │ loadGroup  │
                    └──────────────┘     │ Chat()     │
                                         └────────────┘
```

**核心代码** (`getGroupChat` 函数):

```javascript
export async function getGroupChat(groupId, reload = false) {
    const group = groups.find((x) => x.id === groupId);
    if (!group) return;

    // 1. 验证群组数据（移除不存在的成员和重复项）
    await validateGroup(group);
    
    // 2. 按需加载成员完整数据
    await unshallowGroupMembers(groupId);

    // 3. 从服务器加载聊天文件
    const chat_id = group.chat_id;
    const data = await loadGroupChat(chat_id);
    
    // 4. 提取并处理元数据
    const metadata = data?.[0]?.chat_metadata ?? {};
    const freshChat = !metadata.tainted && (!Array.isArray(data) || !data.length);

    // 5. 移除聊天头部（metadata 行）
    if (Array.isArray(data) && data.length && Object.hasOwn(data[0], 'chat_metadata')) {
        data.shift();
    }

    // 6. 添加完整性 UUID（如果缺失）
    if (!metadata.integrity) {
        metadata.integrity = uuidv4();
    }

    // 7. 处理新聊天或加载已有消息
    if (group && Array.isArray(group.members) && freshChat) {
        // 新聊天：生成角色的第一条消息
        chat.splice(0, chat.length);
        for (let member of group.members) {
            const character = characters.find(x => x.avatar === member);
            const mes = await getFirstCharacterMessage(character);
            if (mes?.mes) {
                chat.push(mes);
                await eventSource.emit(event_types.MESSAGE_RECEIVED, ...);
                addOneMessage(mes);
            }
        }
        await saveGroupChat(groupId, false);
    } else if (Array.isArray(data) && data.length) {
        // 已有聊天：加载消息并渲染
        chat.splice(0, chat.length, ...data);
        chat.forEach(ensureMessageMediaIsArray);
        await printMessages();
    }

    // 8. 更新元数据并触发事件
    updateChatMetadata(metadata, true);
    await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId());
}
```

### 4.2 群聊消息保存流程

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│ 触发保存      │ ──> │ 构建 ChatHeader│ ──> │ 压缩请求体   │
│ saveGroupChat│     │ 添加元数据     │     │ compressReq  │
└──────────────┘     └───────────────┘     └──────────────┘
                                                 │
                    ┌──────────────┐     ┌───────▼──────┐
                    │ 更新群组时间  │ <── │ POST 保存到  │
                    │ date_last_chat│    │ /api/chats/  │
                    └──────────────┘    │ group/save   │
                                        └──────────────┘
```

**核心代码** (`saveGroupChat` 函数):

```javascript
async function saveGroupChat(groupId, shouldSaveGroup, force = false) {
    const group = groups.find(x => x.id == groupId);
    const chatId = group.chat_id;
    
    // 更新最后聊天时间
    group.date_last_chat = Date.now();
    
    // 构建聊天头部（包含元数据）
    const chatHeader = {
        chat_metadata: { ...chat_metadata },
        user_name: 'unused',
        character_name: 'unused',
    };
    
    // 压缩请求体（减少传输大小）
    const saveGroupChatRequest = await compressRequest({
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ 
            id: chatId, 
            chat: [chatHeader, ...chat], 
            force: force 
        }),
    });
    
    // 发送到服务器
    const response = await fetch('/api/chats/group/save', saveGroupChatRequest);

    // 处理完整性校验失败
    if (!response.ok) {
        const errorData = await response.json();
        const isIntegrityError = errorData?.error === 'integrity' && !force;
        if (isIntegrityError) {
            // 弹出确认对话框，防止数据损坏
            const popupResult = await Popup.show.input(
                t`ERROR: Chat integrity check failed while saving the file.`,
                t`Enter OVERWRITE to confirm overwrite (and potentially LOSE YOUR DATA)...`,
                '',
                { okButton: 'OK', cancelButton: false },
            );
            const forceSaveConfirmed = popupResult === 'OVERWRITE';
            if (!forceSaveConfirmed) {
                window.location.reload(); // 重新加载防止数据损坏
                return;
            }
            await saveGroupChat(groupId, shouldSaveGroup, true); // 强制保存
        }
    }
}
```

### 4.3 完整性校验机制（Integrity Check）

完整性校验用于防止并发写入导致的数据丢失：

1. **加载时**: 从聊天文件第一行读取 `chat_metadata.integrity` UUID
2. **保存时**: 服务器验证文件的当前 integrity 与加载时是否一致
3. **不一致时**: 拒绝保存，提示用户确认强制保存或重新加载

**服务器端实现** (`trySaveChat` 函数):
```javascript
export async function trySaveChat(chatData, filePath, skipIntegrityCheck, handle, cardName, backupDirectory) {
    const jsonlData = chatData?.map(m => JSON.stringify(m)).join('\n');
    
    const doIntegrityCheck = (checkIntegrity && !skipIntegrityCheck);
    const chatIntegritySlug = doIntegrityCheck ? chatData?.[0]?.chat_metadata?.integrity : undefined;

    // 验证文件完整性
    if (chatIntegritySlug && !await checkChatIntegrity(filePath, chatIntegritySlug)) {
        throw new IntegrityMismatchError(...);
    }
    
    // 原子写入
    tryWriteFileSync(filePath, jsonlData);
    
    // 自动备份
    getBackupFunction(handle)(backupDirectory, cardName, jsonlData);
}
```

### 4.4 并发控制与防丢失策略

| 策略 | 说明 |
|------|------|
| 原子写入 | 使用 `write-file-atomic` 确保写入原子性 |
| 完整性校验 | UUID 匹配检测并发修改 |
| 自动备份 | 每次保存自动创建带时间戳的备份文件 |
| 节流保存 | `debounce` 防止频繁保存 |
| 保存锁定 | `isChatSaving` 标志防止保存期间切换聊天 |

---

## 5. 角色激活算法

### 5.1 激活策略枚举

```javascript
export const group_activation_strategy = {
    NATURAL: 0,    // 自然激活：基于提及和健谈度
    LIST: 1,       // 列表顺序：按成员列表顺序依次发言
    MANUAL: 2,     // 手动激活：用户手动指定发言角色
    POOLED: 3,     // 池化随机：从未发言角色中随机选择
};
```

### 5.2 NATURAL 模式（自然激活）

**算法流程**:

```
用户输入/最后消息
       │
       ▼
┌──────────────────────┐
│  检测是否提及角色名称  │ ──> 提及的角色激活
│  extractAllWords()    │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  健谈度概率检测        │ ──> random() < talkativeness
│  Math.random()        │      则激活
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  无人激活？            │ ──> 从健谈角色中随机选1个
│  while(retries)       │
└──────────────────────┘
```

**核心代码**:
```javascript
function activateNaturalOrder(members, input, lastMessage, allowSelfResponses, isUserInput) {
    let activatedMembers = [];

    // 1. 防止同一角色连续发言（除非允许自回复）
    let bannedUser = !isUserInput && lastMessage && !lastMessage.is_user && lastMessage.name;
    if (allowSelfResponses) {
        bannedUser = undefined;
    }

    // 2. 检测用户输入中的角色提及
    if (input && input.length) {
        for (let inputWord of extractAllWords(input)) {
            for (let member of members) {
                const character = characters.find(x => x.avatar === member);
                if (!character || character.name === bannedUser) continue;
                if (extractAllWords(character.name).includes(inputWord)) {
                    activatedMembers.push(member);
                    break;
                }
            }
        }
    }

    // 3. 健谈度概率激活
    const chattyMembers = [];
    const shuffledMembers = shuffle([...members]);
    for (let member of shuffledMembers) {
        const character = characters.find((x) => x.avatar === member);
        if (!character || character.name === bannedUser) continue;

        const rollValue = Math.random();
        const talkativeness = isNaN(character.talkativeness)
            ? talkativeness_default
            : Number(character.talkativeness);
        
        if (talkativeness >= rollValue) {
            activatedMembers.push(member);
        }
        if (talkativeness > 0) {
            chattyMembers.push(member);
        }
    }

    // 4. 保底机制：确保至少一个角色发言
    let retries = 0;
    const randomPool = chattyMembers.length > 0 ? chattyMembers : members;
    while (activatedMembers.length === 0 && ++retries <= randomPool.length) {
        const randomIndex = Math.floor(Math.random() * randomPool.length);
        const character = characters.find((x) => x.avatar === randomPool[randomIndex]);
        if (character) {
            activatedMembers.push(randomPool[randomIndex]);
        }
    }

    // 5. 去重并返回角色 ID 列表
    activatedMembers = activatedMembers.filter(onlyUnique);
    return activatedMembers.map(x => characters.findIndex(y => y.avatar === x)).filter(x => x !== -1);
}
```

### 5.3 LIST 模式（列表顺序）

```javascript
function activateListOrder(members) {
    // 简单去重后直接返回所有成员
    let activatedMembers = members.filter(onlyUnique);
    return activatedMembers
        .map(x => characters.findIndex(y => y.avatar === x))
        .filter(x => x !== -1);
}
```

### 5.4 POOLED 模式（池化随机）

```javascript
function activatePooledOrder(members, lastMessage, isUserInput) {
    let activatedMember = null;
    const spokenSinceUser = [];

    // 1. 收集上次用户发言后已发言的角色
    for (const message of chat.slice().reverse()) {
        if (message.is_user || isUserInput) break;
        if (message.is_system || message.extra?.type === system_message_types.NARRATOR) continue;
        if (message.original_avatar) {
            spokenSinceUser.push(message.original_avatar);
        }
    }

    // 2. 从未发言的角色中随机选择
    const haveNotSpoken = members.filter(x => !spokenSinceUser.includes(x));
    if (haveNotSpoken.length) {
        activatedMember = haveNotSpoken[Math.floor(Math.random() * haveNotSpoken.length)];
    }

    // 3. 如果所有角色都已发言，随机选择（排除最后发言者）
    if (activatedMember === null) {
        const lastMessageAvatar = members.length > 1 && lastMessage && !lastMessage.is_user && lastMessage.original_avatar;
        const randomPool = lastMessageAvatar 
            ? members.filter(x => x !== lastMessage.original_avatar) 
            : members;
        activatedMember = randomPool[Math.floor(Math.random() * randomPool.length)];
    }

    const memberId = characters.findIndex(y => y.avatar === activatedMember);
    return memberId !== -1 ? [memberId] : [];
}
```

### 5.5 Swipe/Continue/Impersonate 逻辑

| 操作 | 说明 | 激活逻辑 |
|------|------|----------|
| `swipe` | 重新生成最后一条消息 | 查找被刷新的消息对应的角色 |
| `continue` | 让最后发言的角色继续 | 同 swipe |
| `impersonate` | 随机选择一个角色冒充用户 | 从所有成员中随机选1个 |
| `quiet` | 静默生成（不显示发送内容） | 按顺序激活第一个成员 |

**Swipe 激活代码**:
```javascript
function activateSwipe(members, { allowSystem = false } = {}) {
    let activatedNames = [];
    const lastMessage = chat[chat.length - 1];

    // 1. 如果最后是用户/系统/旁白消息，找上一个角色消息
    if (lastMessage.is_user || (!allowSystem && lastMessage.is_system) || 
        lastMessage.extra?.type === system_message_types.NARRATOR) {
        for (const message of chat.slice().reverse()) {
            if (message.is_user || (!allowSystem && message.is_system) || 
                message.extra?.type === system_message_types.NARRATOR) continue;
            if (message.original_avatar) {
                activatedNames.push(message.original_avatar);
                break;
            }
        }
        // 找不到则随机选择
        if (activatedNames.length === 0) {
            activatedNames.push(shuffle(members.slice())[0]);
        }
    }

    // 2. 预处理：匹配角色头像
    if (!lastMessage.original_avatar) {
        const matches = characters.filter(x => x.name == lastMessage.name);
        for (const match of matches) {
            if (members.includes(match.avatar)) {
                activatedNames.push(match.avatar);
                break;
            }
        }
    } else {
        activatedNames.push(lastMessage.original_avatar);
    }

    return activatedNames.map(x => characters.findIndex(y => y.avatar === x)).filter(x => x !== -1);
}
```

---

## 6. 用户状态管理

### 6.1 核心状态变量

```javascript
// 群聊状态标志
let is_group_generating = false;        // 是否正在生成回复
let is_group_automode_enabled = false;  // 自动模式是否启用
let hideMutedSprites = false;           // 是否隐藏静音角色精灵
let groups = [];                        // 所有群组数据
let selected_group = null;              // 当前选中的群 ID
let group_generation_id = null;         // 当前生成批次 ID（用于重新生成）
let openGroupId = null;                 // 当前打开的群 ID（编辑界面）
let newGroupMembers = [];               // 新群待添加的成员列表
let groupChatQueueOrder = new Map();    // 群聊发言顺序 Map<avatar, queue_position>
```

### 6.2 生成状态管理

```javascript
async function generateGroupWrapper(byAutoMode, type = null, params = {}) {
    // 1. 检查连接状态
    if (online_status === 'no_connection') {
        is_group_generating = false;
        setSendButtonState(false);
        return Promise.resolve();
    }

    // 2. 防止并发生成
    if (is_group_generating) {
        return Promise.resolve();
    }

    try {
        // 3. 设置生成状态
        hideSwipeButtons();
        is_group_generating = true;
        setCharacterName('');
        setCharacterId(undefined);
        
        // 4. 设置生成批次 ID
        group_generation_id = Date.now();
        
        // 5. 激活角色并依次生成
        for (const chId of activatedMembers) {
            setCharacterId(chId);
            setCharacterName(characters[chId].name);
            await eventSource.emit(event_types.GROUP_MEMBER_DRAFTED, chId);
            
            // 调用核心生成函数
            textResult = await Generate(generateType, { 
                automatic_trigger: byAutoMode, 
                ...params 
            });
            
            // 自动续写检查
            let messageChunk = textResult?.messageChunk;
            while (shouldAutoContinue(messageChunk, type === 'impersonate')) {
                textResult = await Generate('continue', { 
                    automatic_trigger: byAutoMode, 
                    ...params 
                });
                messageChunk = textResult?.messageChunk;
            }
        }
    } finally {
        // 6. 清理状态（无论成功失败都会执行）
        is_group_generating = false;
        setSendButtonState(false);
        setCharacterId(undefined);
        groupChatQueueOrder = new Map();
        setCharacterName('');
        activateSendButtons();
        showSwipeButtons();
        await eventSource.emit(event_types.GROUP_WRAPPER_FINISHED, { selected_group, type });
    }
}
```

### 6.3 自动模式状态管理

```javascript
// 自动模式工作线程
let autoModeWorker = null;

function setAutoModeWorker() {
    clearInterval(autoModeWorker);
    const autoModeDelay = groups.find(x => x.id === selected_group)?.auto_mode_delay ?? DEFAULT_AUTO_MODE_DELAY;
    autoModeWorker = setInterval(groupChatAutoModeWorker, autoModeDelay * 1000);
}

// 自动模式工作函数
async function groupChatAutoModeWorker() {
    // 检查自动模式条件和生成状态
    if (!is_group_automode_enabled || online_status === 'no_connection') return;
    if (!selected_group || is_send_press || is_group_generating) return;

    // 创建 AbortController 用于取消
    groupAutoModeAbortController = new AbortController();
    await generateGroupWrapper(true, 'auto', { signal: groupAutoModeAbortController.signal });
}

// 停止自动模式
function stopAutoModeGeneration() {
    if (groupAutoModeAbortController) {
        groupAutoModeAbortController.abort();
    }
    is_group_automode_enabled = false;
    $('#rm_group_automode').prop('checked', false);
}
```

### 6.4 AbortController 取消机制

```javascript
async function generateGroupWrapper(byAutoMode, type = null, params = {}) {
    function throwIfAborted() {
        if (params.signal instanceof AbortSignal && params.signal.aborted) {
            throw new Error('AbortSignal was fired. Group generation stopped');
        }
    }

    try {
        for (const chId of activatedMembers) {
            throwIfAborted();  // 每次生成前检查是否已取消
            textResult = await Generate(generateType, params);
        }
    } finally {
        // 清理状态
    }
}
```

---

## 7. 界面交互逻辑

### 7.1 群聊 UI 组件结构

```
┌─────────────────────────────────────────────────┐
│  右侧面板（Right Menu）                           │
│  ┌───────────────────────────────────────────┐  │
│  │ 群组创建/编辑区块                            │  │
│  │  ┌─────────┐  ┌─────────┐                 │  │
│  │  │ 群头像  │  │ 群组名称 │                 │  │
│  │  │ 预览区  │  │ 输入框   │                 │  │
│  │  └─────────┘  └─────────┘                 │  │
│  │                                           │  │
│  │  ┌───────────────────────────────────────┐│  │
│  │  │ 候选成员列表（可搜索、分页）             ││  │
│  │  │ [角色1] [角色2] [角色3] ...            ││  │
│  │  └───────────────────────────────────────┘│  │
│  │                                           │  │
│  │  ┌───────────────────────────────────────┐│  │
│  │  │ 群组成员列表（可排序、启用/禁用）        ││  │
│  │  │ [角色A] [角色B] [角色C] ...            ││  │
│  │  └───────────────────────────────────────┘│  │
│  │                                           │  │
│  │  [激活策略] [生成模式] [自动模式] [收藏]    │  │
│  │  [删除群组] [查看聊天记录] [场景设置]       │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 7.2 成员列表渲染与分页

使用 jQuery Pagination 插件实现分页：

```javascript
function printGroupMembers() {
    const storageKey = 'GroupMembers_PerPage';
    const pageSize = Number(accountStorage.getItem(storageKey)) || 5;
    
    $('.rm_group_members_pagination').each(function () {
        $(this).pagination({
            dataSource: getGroupCharacters({ doFilter: true, onlyMembers: true }),
            pageRange: 1,
            position: 'top',
            showPageNumbers: false,
            prevText: '<',
            nextText: '>',
            formatNavigator: PAGINATION_TEMPLATE,
            showNavigator: true,
            showSizeChanger: true,
            pageSize: pageSize,
            callback: function (data) {
                $('.rm_group_members').empty();
                for (const i of data) {
                    $('.rm_group_members').append(getGroupCharacterBlock(i.item));
                }
                localizePagination($(this));
            },
        });
    });
}
```

### 7.3 角色头像拼图生成

当没有自定义群头像时，自动从成员头像中选取最多 4 张生成拼图：

```javascript
function getGroupAvatar(group) {
    // 1. 优先使用自定义头像
    if (isValidImageUrl(group.avatar_url)) {
        return $(`<div class="avatar"><img src="${group.avatar_url}"></div>`);
    }

    // 2. 收集成员头像（最多4张）
    const memberAvatars = [];
    for (const member of group.members) {
        const charIndex = characters.findIndex(x => x.avatar === member);
        if (charIndex !== -1 && characters[charIndex].avatar !== 'none') {
            memberAvatars.push(getThumbnailUrl('avatar', characters[charIndex].avatar));
        }
        if (memberAvatars.length === 4) break;
    }

    // 3. 根据数量选择拼图模板
    const avatarCount = memberAvatars.length;
    if (avatarCount >= 1 && avatarCount <= 4) {
        const groupAvatar = $(`#group_avatars_template .collage_${avatarCount}`).clone();
        for (let i = 0; i < avatarCount; i++) {
            groupAvatar.find(`.img_${i + 1}`).attr('src', memberAvatars[i]);
        }
        return groupAvatar;
    }

    // 4. 无成员时使用默认头像
    return $('<div class="missing-avatar fa-solid fa-user-slash"></div>');
}
```

### 7.4 标签系统集成

群聊支持标签分类管理：

```javascript
// 显示群组的标签
const tagsElement = template.find('.tags');
printTagList(tagsElement, { 
    forEntityOrKey: group.id, 
    tagOptions: { isCharacterList: true } 
});

// 应用标签过滤
applyTagsOnGroupSelect(groupId);
```

### 7.5 拖拽与排序交互

- 成员列表支持上下排序按钮
- 排序结果直接修改 `group.members` 数组
- 使用 `reorderGroupMember` 函数处理：

```javascript
async function reorderGroupMember(groupId, groupMember, direction) {
    const id = groupMember.data('id');
    const thisGroup = groups.find((x) => x.id == groupId);
    const memberArray = thisGroup?.members ?? newGroupMembers;

    const indexOf = memberArray.indexOf(id);
    if (direction == 'down') {
        const next = memberArray[indexOf + 1];
        if (next) {
            memberArray[indexOf + 1] = memberArray[indexOf];
            memberArray[indexOf] = next;
        }
    }
    if (direction == 'up') {
        const prev = memberArray[indexOf - 1];
        if (prev) {
            memberArray[indexOf - 1] = memberArray[indexOf];
            memberArray[indexOf] = prev;
        }
    }

    printGroupMembers();
    if (openGroupId) {
        await editGroup(groupId, false, false);
        updateGroupAvatar(thisGroup);
    }
}
```

---

## 8. API 接口定义

### 8.1 群组管理 API

#### 8.1.1 获取所有群组

```
POST /api/groups/all
Headers: { omitContentType: true }
Response: Group[]
```

#### 8.1.2 创建群组

```
POST /api/groups/create
Headers: { 'Content-Type': 'application/json' }
Body: {
    name: string,
    members: string[],
    avatar_url?: string,
    allow_self_responses?: boolean,
    activation_strategy?: number,
    generation_mode?: number,
    disabled_members?: string[],
    fav?: boolean,
    chat_id?: string,
    chats?: string[],
    auto_mode_delay?: number,
    generation_mode_join_prefix?: string,
    generation_mode_join_suffix?: string,
}
Response: { id: string, ...Group }
```

#### 8.1.3 编辑群组

```
POST /api/groups/edit
Headers: { 'Content-Type': 'application/json' }
Body: Group (完整群组对象)
Response: { ok: true }
```

#### 8.1.4 删除群组

```
POST /api/groups/delete
Headers: { 'Content-Type': 'application/json' }
Body: { id: string }
Response: { ok: true }
```

**服务端实现**:
```javascript
router.post('/delete', getFileNameValidationFunction('id'), async (request, response) => {
    const id = request.body.id;
    const pathToGroup = path.join(request.user.directories.groups, sanitize(`${id}.json`));

    try {
        // 1. 读取群组数据获取聊天列表
        const group = JSON.parse(fs.readFileSync(pathToGroup, 'utf8'));

        // 2. 删除所有关联的聊天文件
        if (group && Array.isArray(group.chats)) {
            for (const chat of group.chats) {
                const pathToFile = path.join(request.user.directories.groupChats, sanitize(`${chat}.jsonl`));
                if (fs.existsSync(pathToFile)) {
                    fs.unlinkSync(pathToFile);
                }
            }
        }
    } catch (error) {
        console.error('Could not delete group chats. Clean them up manually.', error);
    }

    // 3. 删除群组定义文件
    if (fs.existsSync(pathToGroup)) {
        fs.unlinkSync(pathToGroup);
    }

    return response.send({ ok: true });
});
```

### 8.2 群聊消息 API

#### 8.2.1 获取群聊消息

```
POST /api/chats/group/get
Body: { id: string }
Response: ChatMessage[] (JSON Lines 解析后的数组)
```

#### 8.2.2 保存群聊消息

```
POST /api/chats/group/save
Body: {
    id: string,
    chat: ChatHeader[],
    force?: boolean
}
Response: { ok: true } | { error: 'integrity' }
```

#### 8.2.3 删除群聊消息

```
POST /api/chats/group/delete
Body: { id: string }
Response: { ok: true }
```

#### 8.2.4 获取群聊信息

```
POST /api/chats/group/info
Body: { id: string }
Response: {
    file_id: string,
    file_name: string,
    file_size: string,
    chat_items: number,
    mes: string,
    last_mes: number|string,
    chat_metadata?: Object
}
```

#### 8.2.5 导入群聊消息

```
POST /api/chats/group/import
Headers: { omitContentType: true }
Body: FormData (multipart/form-data)
Response: { res: string } (chat_id)
```

---

## 9. 生成模式分析

### 9.1 生成模式枚举

```javascript
export const group_generation_mode = {
    SWAP: 0,              // 切换模式：每次只生成一个角色的回复
    APPEND: 1,            // 追加模式：合并所有角色卡片后生成
    APPEND_DISABLED: 2,   // 禁用追加：类似 SWAP 但不使用角色卡片
};
```

### 9.2 SWAP 模式（角色切换）

- **原理**: 每个角色轮流作为主要角色（`setCharacterId`）进行生成
- **提示词构建**: 使用当前角色的完整角色卡（description, personality, scenario, mesExamples）
- **适用场景**: 传统群聊，角色各自独立回复

### 9.3 APPEND 模式（追加合并）

- **原理**: 将所有角色的角色卡合并后作为提示词
- **Join Prefix/Suffix**: 可配置的前后缀模板，用于分隔不同角色的信息

**角色卡合并逻辑**:
```javascript
function getGroupCharacterCardsLazy(groupId, characterId) {
    const group = groups.find(x => x.id === groupId);
    
    function collectField(fieldName, getter, preprocess = null) {
        const values = [];
        for (const member of group.members) {
            const index = characters.findIndex(x => x.avatar === member);
            const character = characters[index];
            if (index === -1 || !character) continue;
            
            // 跳过的成员（除非是当前生成角色）
            if (group.disabled_members.includes(member) && characterId !== index && 
                group.generation_mode !== group_generation_mode.APPEND_DISABLED) {
                continue;
            }
            
            values.push(replaceAndPrepareForJoin(getter(character), character.name, fieldName, preprocess));
        }
        return values.filter(x => x.length).join('\n');
    }

    return createLazyFields({
        description: () => collectField('Description', c => c.description),
        personality: () => collectField('Personality', c => c.personality),
        scenario: () => baseChatReplace(scenarioOverride?.trim()) || collectField('Scenario', c => c.scenario),
        mesExamples: () => baseChatReplace(mesExamplesOverride?.trim()) ||
            collectField('Example Messages', c => c.mes_example, ...),
    });
}
```

### 9.4 APPEND_DISABLED 模式

- 与 SWAP 类似，但不合并其他角色的角色卡
- 适用于需要角色独立上下文的场景

### 9.5 Join Prefix/Suffix 模板系统

用户可自定义模板变量：
- `<FIELDNAME>`: 替换为字段名称（Description, Personality 等）
- `{{char}}`: 角色名称替换
- 支持 `baseChatReplace` 的所有变量替换规则

---

## 10. 关键算法实现

### 10.1 提及检测算法

```javascript
// 从输入中提取所有单词（支持中文分词）
function extractAllWords(text) {
    // 使用正则表达式匹配单词或中文字符
    return text.match(/[\u4e00-\u9fff]+|\w+/g) || [];
}

// 检测用户输入是否提及角色
for (let inputWord of extractAllWords(input)) {
    for (let member of members) {
        const character = characters.find(x => x.avatar === member);
        if (!character || character.name === bannedUser) continue;
        
        // 角色名包含用户输入的词，则激活该角色
        if (extractAllWords(character.name).includes(inputWord)) {
            activatedMembers.push(member);
            break;
        }
    }
}
```

### 10.2 健谈度概率算法

```javascript
// 角色 talkativeness 属性范围: 0.0 ~ 1.0
// 默认值: talkativeness_default (通常为 0.5)

const rollValue = Math.random();  // 生成 0~1 的随机数
const talkativeness = Number(character.talkativeness) || talkativeness_default;

// 如果 talkativeness >= random，角色将被激活
// 例如: talkativeness=0.8 的角色有 80% 概率发言
if (talkativeness >= rollValue) {
    activatedMembers.push(member);
}
```

### 10.3 角色成员查找算法

支持按索引或名称查找：

```javascript
export function findGroupMemberId(arg, full = false) {
    const group = groups.find(x => x.id == selected_group);
    const index = parseInt(arg);
    const searchByString = isNaN(index);

    if (searchByString) {
        // 使用 Fuse.js 模糊搜索角色名称
        const memberNames = group.members.map(x => ({
            avatar: x,
            name: characters.find(y => y.avatar === x)?.name,
            index: characters.findIndex(y => y.avatar === x),
        }));
        const fuse = new Fuse(memberNames, { keys: ['avatar', 'name'] });
        const result = fuse.search(arg);
        return !full ? chid : { ...{ id: chid }, ...result[0].item };
    } else {
        // 按索引查找
        const memberAvatar = group.members[index];
        const chid = characters.findIndex(x => x.avatar === memberAvatar);
        return !full ? chid : { id: chid, avatar: memberAvatar, name: ..., index: index };
    }
}
```

### 10.4 深度提示词（Depth Prompt）算法

群聊中每个角色可以配置深度提示词，用于控制上下文注入：

```javascript
export function getGroupDepthPrompts(groupId, characterId) {
    const group = groups.find(x => x.id === groupId);
    if (group.generation_mode === group_generation_mode.SWAP) return [];

    const depthPrompts = [];
    for (const member of group.members) {
        const index = characters.findIndex(x => x.avatar === member);
        const character = characters[index];
        if (index === -1 || !character) continue;
        
        // 跳过禁用的成员
        if (group.disabled_members.includes(member) && characterId !== index) continue;

        const depthPromptText = baseChatReplace(
            character.data?.extensions?.depth_prompt?.prompt?.trim(), 
            null, 
            character.name
        ) || '';
        const depthPromptDepth = character.data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default;
        const depthPromptRole = character.data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default;

        if (depthPromptText) {
            depthPrompts.push({ text: depthPromptText, depth: depthPromptDepth, role: depthPromptRole });
        }
    }
    return depthPrompts;
}
```

### 10.5 角色重命名同步算法

当角色被重命名时，需要更新所有群组和历史消息：

```javascript
export async function renameGroupMember(oldAvatar, newAvatar, newName) {
    for (const group of groups) {
        // 1. 更新群组中的成员标识
        const memberIndex = group.members.findIndex(x => x == oldAvatar);
        if (memberIndex == -1) continue;
        
        group.members[memberIndex] = newAvatar;
        await editGroup(group.id, true, false);

        // 2. 更新所有聊天中的历史消息
        for (const chatId of group.chats) {
            const messages = await loadGroupChat(chatId);
            let hadChanges = false;
            
            for (const message of messages) {
                if (Object.hasOwn(message, 'chat_metadata')) continue; // 跳过元数据
                if (message.is_user || message.is_system) continue;    // 跳过用户/系统消息
                
                // 匹配旧头像的消息，更新名称和头像 URL
                if (message.force_avatar && message.force_avatar.indexOf(encodeURIComponent(oldAvatar)) !== -1) {
                    message.name = newName;
                    message.force_avatar = message.force_avatar.replace(
                        encodeURIComponent(oldAvatar), 
                        encodeURIComponent(newAvatar)
                    );
                    message.original_avatar = newAvatar;
                    hadChanges = true;
                }
            }

            if (hadChanges) {
                await eventSource.emit(event_types.CHARACTER_RENAMED_IN_PAST_CHAT, messages, oldAvatar, newAvatar);
                const saveChatResponse = await fetch('/api/chats/group/save', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ id: chatId, chat: [...messages] }),
                });
            }
        }
    }
}
```

---

## 11. 与其他功能模块的集成

### 11.1 世界信息（World Info）集成

- 群聊生成时，世界信息会根据当前激活的角色进行过滤和注入
- `getGroupCharacterCards` 函数中的 `scenario` 字段会使用 `baseChatReplace` 进行变量替换
- 每个角色的世界信息在生成时被整合到提示词中

### 11.2 标签系统（Tags）集成

```javascript
import { printTagList, createTagMapFromList, applyTagsOnCharacterSelect, tag_map, applyTagsOnGroupSelect, printTagFilters, tag_filter_type } from './tags.js';

// 群组标签过滤
const groupCandidatesFilter = new FilterHelper(debounce(printGroupCandidates, debounce_timeout.quick));
const groupMembersFilter = new FilterHelper(debounce(printGroupMembers, debounce_timeout.quick));

// 标签过滤触发
$('#rm_group_filter').on('input', filterGroupMembers);
$('#rm_group_members_filter').on('input', filterGroupMemberList);
```

### 11.3 书签系统（Bookmarks）集成

```javascript
export async function saveGroupBookmarkChat(groupId, name, metadata, mesId, chatData = undefined) {
    const group = groups.find(x => x.id === groupId);
    group.chats.push(name);  // 添加书签聊天到群组

    const chatHeader = {
        chat_metadata: { ...chat_metadata, ...(metadata || {}) },
        user_name: 'unused',
        character_name: 'unused',
    };

    // 裁剪聊天内容到指定消息
    const trimmedChat = chatData ?? (mesId !== undefined ? chat.slice(0, Number(mesId) + 1) : chat);

    await editGroup(groupId, true, false);
    await fetch('/api/chats/group/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ id: name, chat: [chatHeader, ...trimmedChat] }),
    });
}
```

### 11.4 扩展系统（Extensions）集成

群聊通过 `eventSource` 触发多种扩展事件：

```javascript
// 扩展可监听的事件
await eventSource.emit(event_types.GROUP_WRAPPER_STARTED, { selected_group, type });
await eventSource.emit(event_types.GROUP_MEMBER_DRAFTED, chId);
await eventSource.emit(event_types.GROUP_WRAPPER_FINISHED, { selected_group, type });
await eventSource.emit(event_types.GROUP_CHAT_CREATED);
await eventSource.emit(event_types.GROUP_CHAT_DELETED, chatId);
await eventSource.emit(event_types.GROUP_UPDATED);
await eventSource.emit(event_types.CHARACTER_FIRST_MESSAGE_SELECTED, eventArgs);
```

### 11.5 Slash Commands 集成

群聊支持通过 Slash Commands 进行控制：

```javascript
// 在 script.js 中注册了群聊相关的命令
// 例如：/group, /member, /speak 等命令
```

### 11.6 宏系统（Macros）集成

```javascript
import { MacroEnvBuilder } from './macros/engine/MacroEnvBuilder.js';

// 群聊相关的宏环境变量
// 宏可以访问：group, member, activation_strategy 等变量
```

### 11.7 TTS 扩展集成

```javascript
// 群聊消息生成后，可触发 TTS 朗读
cancelTtsPlay();  // 切换群聊时停止 TTS
```

### 11.8 稳定扩散（Stable Diffusion）集成

```javascript
// extensions/stable-diffusion/index.js
// 群聊中的角色头像可用于生成图像
```

### 11.9 请求压缩集成

```javascript
import { compressRequest } from './request-compression.js';

// 保存群聊消息时压缩请求体
const saveGroupChatRequest = await compressRequest({
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ id: chatId, chat: [chatHeader, ...chat], force: force }),
});
```

---

## 12. 数据迁移与兼容性

### 12.1 群聊元数据迁移逻辑

SillyTavern 在启动时自动迁移旧版群组元数据格式：

```javascript
export async function migrateGroupChatsMetadataFormat(userDirectories) {
    for (const userDirs of userDirectories) {
        const groupFiles = await fsPromises.readdir(userDirs.groups, { withFileTypes: true });
        
        for (const groupFile of groupFiles) {
            const groupData = tryParse(await fsPromises.readFile(groupFilePath, 'utf8'));
            
            // 检查是否需要迁移（旧格式使用 chat_metadata/past_metadata）
            const needsMigration = ['chat_metadata', 'past_metadata'].some(key => 
                Object.hasOwn(groupData, key)
            );
            if (!needsMigration) continue;

            // 备份原文件
            await fsPromises.copyFile(groupFilePath, path.join(backupPath, groupFile.name));

            // 将群组级元数据迁移到每个聊天文件
            const allMetadata = {
                ...(groupData.past_metadata || {}),
                [groupData.chat_id]: (groupData.chat_metadata || {}),
            };

            for (const chatId of groupData.chats) {
                const chatData = await readChatFile(chatId);
                const chatHeader = { chat_metadata: allMetadata[chatId] || {} };
                const newChatData = [chatHeader, ...chatData];
                await writeFileAtomic(chatFilePath, newChatData.map(JSON.stringify).join('\n'));
            }

            // 删除旧字段
            delete groupData.chat_metadata;
            delete groupData.past_metadata;
            await writeFileAtomic(groupFilePath, JSON.stringify(groupData, null, 4));
        }
    }
}
```

### 12.2 旧版本兼容处理

```javascript
// 群组 ID 从数字转字符串
if (typeof group.id === 'number') {
    group.id = String(group.id);
}

// 旧版本没有 disabled_members 字段
if (group.disabled_members == undefined) {
    group.disabled_members = [];
}

// 旧版本使用 name 匹配，新版本使用 avatar
if (group.chat_id == undefined) {
    group.chat_id = group.id;
    group.chats = [group.id];
    group.members = group.members
        .map(x => characters.find(y => y.name == x)?.avatar)
        .filter(x => x)
        .filter(onlyUnique);
}
```

### 12.3 数据完整性保障

| 机制 | 说明 |
|------|------|
| `sanitize-filename` | 文件名过滤，防止路径穿越 |
| `write-file-atomic` | 原子写入，防止写入中断损坏 |
| `integrity UUID` | 并发写入检测 |
| `备份系统` | 自动备份到 `backups/` 目录 |
| `validateGroup` | 启动时验证成员存在性 |

---

## 13. 核心流程图

### 13.1 群聊创建流程

```
┌─────────────┐
│ 用户填写    │
│ 群信息      │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ 收集成员列表         │
│ newGroupMembers      │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 自动生成名称         │
│ (如果未填写)         │
│ "Group: A, B, C"    │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ POST /api/groups/   │
│ create               │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 服务器创建           │
│ .json 定义文件       │
│ 生成 ID (时间戳)     │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 重新加载群组         │
│ getCharacters()      │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ 打开新创建的群        │
│ select_group_chats() │
└─────────────────────┘
```

### 13.2 群聊消息生成流程

```
┌─────────────┐
│ 用户发送    │
│ 消息        │
└──────┬──────┘
       │
       ▼
┌──────────────────────┐
│ generateGroupWrapper │
│ 检查状态              │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ 获取激活策略          │
│ activation_strategy   │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐     ┌──────────────────┐
│ 激活成员              │ ──> │ NATURAL: 提及检测 │
│ activateXXX()         │     │ + 健谈度概率      │
└──────┬───────────────┘     │ LIST: 顺序遍历     │
       │                     │ POOLED: 未发言随机 │
       │                     │ MANUAL: 指定       │
       │                     └──────────────────┘
       │
       ▼
┌──────────────────────┐
│ 遍历激活的成员        │
│ for chId in members   │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ setCharacterId(chId) │
│ 设置当前角色          │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Generate(type)       │
│ 调用核心生成函数      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ shouldAutoContinue?  │
│ ──> Generate('cont') │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ 清理状态              │
│ is_group_generating   │
│ = false               │
└──────────────────────┘
```

### 13.3 群聊切换流程

```
┌─────────────┐
│ 点击群组    │
└──────┬──────┘
       │
       ▼
┌──────────────────────┐
│ openGroupById(id)    │
│ 检查保存状态          │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ 检查是否正在生成      │
│ is_group_generating   │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ clearChat()          │
│ 清空当前聊天          │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ cancelTtsPlay()      │
│ 停止 TTS              │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ selected_group = id  │
│ updateChatMetadata()  │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ getGroupChat(id)     │
│ 加载新群聊天消息      │
└──────────────────────┘
```

---

## 14. 开发参考指南

### 14.1 创建新群聊功能的步骤

1. **添加新的 API 端点**（如果需要）
   ```javascript
   // src/endpoints/groups.js
   router.post('/new-endpoint', async (request, response) => {
       // 实现逻辑
   });
   ```

2. **扩展 Group 数据结构**
   ```javascript
   // 添加新字段到 Group 类型定义
   // 确保在 /create 端点中处理新字段
   ```

3. **添加前端控制逻辑**
   ```javascript
   // public/scripts/group-chats.js
   async function newFeature() {
       // 实现逻辑
   }
   ```

4. **添加事件类型**
   ```javascript
   // public/scripts/events.js
   NEW_GROUP_FEATURE: 'new_group_feature',
   ```

5. **触发和监听事件**
   ```javascript
   await eventSource.emit(event_types.NEW_GROUP_FEATURE, data);
   ```

### 14.2 扩展现有群聊功能的方法

**添加新的激活策略**:
```javascript
// 1. 在枚举中添加新策略
export const group_activation_strategy = {
    NATURAL: 0,
    LIST: 1,
    MANUAL: 2,
    POOLED: 3,
    YOUR_NEW_STRATEGY: 4,  // 添加新策略
};

// 2. 在 generateGroupWrapper 中处理新策略
if (activationStrategy === group_activation_strategy.YOUR_NEW_STRATEGY) {
    activatedMembers = activateYourNewOrder(enabledMembers, ...);
}

// 3. 实现激活算法
function activateYourNewOrder(members, ...) {
    // 返回激活的角色 ID 数组
    return memberIds;
}
```

**添加新的生成模式**:
```javascript
export const group_generation_mode = {
    SWAP: 0,
    APPEND: 1,
    APPEND_DISABLED: 2,
    YOUR_NEW_MODE: 3,  // 添加新模式
};
```

### 14.3 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 群聊消息不显示 | 成员头像与角色不匹配 | 使用 `validateGroup` 清理无效成员 |
| 完整性校验失败 | 多设备同时修改聊天 | 重新加载页面获取最新数据 |
| 角色不响应 | 激活策略配置问题 | 检查 `activation_strategy` 设置 |
| 群聊创建失败 | 文件名包含非法字符 | 使用 `sanitize` 过滤文件名 |
| 头像拼图不显示 | 成员头像路径无效 | 检查角色是否存在且头像不为 'none' |
| 自动模式不工作 | 连接状态或生成中 | 检查 `online_status` 和 `is_group_generating` |

### 14.4 最佳实践

1. **始终使用事件通信**: 不要直接调用其他模块的函数，使用 `eventSource.emit` 和 `eventSource.on`
2. **保存前验证数据**: 使用 `validateGroup` 确保数据一致性
3. **处理异步操作**: 使用 `async/await` 确保顺序执行
4. **防抖保存**: 使用 `debounce` 避免频繁保存
5. **错误处理**: 提供友好的错误提示，必要时使用 `Popup.show.input` 确认危险操作
6. **内存管理**: 使用 `unshallowCharacter` 按需加载角色数据

---

## 附录：术语表

| 术语 | 说明 |
|------|------|
| Group | 群组定义，包含成员列表和配置 |
| Group Chat | 群组内的具体聊天会话 |
| Character | AI 角色，有独立的角色卡 |
| Activation Strategy | 决定哪些角色发言的策略 |
| Generation Mode | 决定如何构建提示词的模式 |
| JSONL | JSON Lines，每行一个 JSON 对象的文件格式 |
| Integrity Check | 完整性校验，防止并发写入丢失 |
| Auto Mode | 自动模式，定时触发生成 |
| Unshallow | 按需加载完整角色数据 |
| Swipe | 重新生成最后一条消息 |

---

*文档结束。如需进一步了解某个模块的实现细节，请参考对应的源代码文件。*
