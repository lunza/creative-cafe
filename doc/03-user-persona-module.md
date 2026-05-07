# 用户人设模块 (User Persona Module) 技术文档

> 模块路径: `src/renderer/components/Avatar/`
> 源码文件: `AvatarManager.tsx`, `AvatarManager.css`
> 后端支撑: `src/main/ipc/handlers/avatarHandlers.ts`, `src/main/services/avatarService.ts`
> 状态管理: `src/renderer/stores/dataStore.ts` (avatars 部分)

---

## 1. 模块功能描述

用户人设模块（在 UI 中称为"用户人设管理"）负责管理用户在 SillyTavern 中的**自我设定（Persona/Avatar）**，包括名称、描述和头像图片。

### 核心能力

| 能力 | 描述 |
|------|------|
| **人设 CRUD** | 创建、查看、编辑、删除用户人设（Persona Profile） |
| **头像管理** | 上传/更换/预览头像图片，支持 PNG/JPG/WebP/GIF 格式，限制 5MB |
| **双视图模式** | 列表视图（卡片网格展示所有人设）和详情视图（编辑单个设定） |
| **Base64 图片预览** | 头像图片以 Base64 编码异步加载，支持重试和超时处理 |
| **表单输入控制** | 名称最大 50 字符，描述最大 2000 字符，实时字符计数显示 |
| **更新日期显示** | 每个卡片显示最后修改日期标签 |

### 操作类型

- **文件操作**: 创建人设 JSON 文件、保存、删除
- **图片操作**: 选择图片文件 → 复制到人设目录 → 读取 Base64 预览
- **表单操作**: 编辑名称、描述、头像路径

### 用户交互场景

1. 用户打开人设管理页面，看到所有人设卡片网格
2. 点击"新建人设"进入详情视图，填写名称和描述
3. 点击"上传头像"选择本地图片文件
4. 编辑完成后点击"保存人设"持久化到文件
5. 点击人设卡片进入编辑视图修改

### 功能边界

- 仅管理用户自己的设定（Persona），不管理角色卡（Character）
- 人设数据与 SillyTavern 角色卡中的 Persona 系统对应
- 头像文件独立存储于人设目录下

---

## 2. 模块定位与业务价值

### 战略角色

用户人设模块管理**用户自身在 SillyTavern 对话中的身份设定**，与角色卡（Character Card）形成配对关系。

```
┌──────────────────────────────────────┐
│          SillyTavern 对话              │
│  ┌──────────┐      ┌──────────────┐  │
│  │ User     │ ←→  │ Character    │  │
│  │ Persona  │      │ Card         │  │
│  │ (本模块)  │      │ (角色卡模块)   │  │
│  └──────────┘      └──────────────┘  │
└──────────────────────────────────────┘
```

### 解决的业务痛点

1. **多身份管理**: 用户可能需要不同场景下使用不同人设
2. **人设可视化**: 头像和描述为用户设定提供直观呈现
3. **数据独立存储**: 人设数据独立于角色卡，可灵活组合

### 目标用户群体

- **SillyTavern 用户**: 需要管理自身在不同对话中的身份设定
- **角色扮演爱好者**: 需要切换不同的人设风格

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌──────────────────────────────────────────────────────┐
│                AvatarManager Component                │
│  ┌────────────────────┐  ┌─────────────────────────┐ │
│  │ 列表视图 (List)     │  │ 详情视图 (Detail)       │ │
│  │ - 卡片网格          │  │ - Form (名称/描述)      │ │
│  │ - AvatarCard 组件   │  │ - 头像上传/预览         │ │
│  │ - 编辑/删除按钮     │  │ - 保存按钮              │ │
│  └────────────────────┘  └─────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                          ↓ 状态管理
┌──────────────────────────────────────────────────────┐
│  dataStore.fetchAvatars()  +  本地 state (profiles)  │
└──────────────────────────────────────────────────────┘
                          ↓ IPC 通信
┌──────────────────────────────────────────────────────┐
│  window.electronAPI.avatar.*                          │
│  window.electronAPI.file.* (图片操作)                 │
└──────────────────────────────────────────────────────┘
                          ↓ 主进程
┌──────────────────────────────────────────────────────┐
│  avatarHandlers → avatarService                       │
│  ├── listAvatars / readAvatar / writeAvatar           │
│  ├── deleteAvatar / getAvatarDir / setAvatarDir       │
└──────────────────────────────────────────────────────┘
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **状态机** | `viewMode: 'list' \| 'detail'` | 列表/详情 双视图切换 |
| **Factory** | `handleCreateProfile` | 创建默认结构的 Profile 对象 |
| **Component Composition** | `AvatarCard` 子组件 | 独立的头像加载和渲染逻辑 |

### 3.3 核心算法

#### 头像上传与复制流程

```typescript
// 1. 选择文件 (通过原生文件选择器)
const selectedFilePath = await window.electronAPI.file.selectFile([...]);

// 2. 构造目标路径 (人设目录 + 唯一文件名)
const targetPath = avatarDir + '/avatar-' + editingProfile.id + '-' + Date.now() + '.' + fileExt;

// 3. 复制文件到人设目录
const copyResult = await window.electronAPI.file.copyFile(selectedFilePath, targetPath);

// 4. 验证文件存在
const existsResult = await window.electronAPI.file.exists(targetPath);

// 5. 读取 Base64 用于预览
const readResult = await window.electronAPI.file.readAsBase64(targetPath);
```

#### 人设列表排序

```typescript
// 按更新时间降序排列 (最新的在前)
loadedProfiles.sort((a, b) => b.updatedAt - a.updatedAt);
```

### 3.4 组件树结构

```
AvatarManager
├── [列表视图]
│   ├── Space[操作栏] (刷新/新建人设)
│   ├── Row > Col > Card[人设卡片]
│   │   ├── AvatarCard (头像缩略图)
│   │   ├── Card.Meta (名称/描述摘要)
│   │   └── Card.actions (编辑/删除按钮)
│   └── Empty (空状态提示)
└── [详情视图]
    ├── Button[返回列表]
    ├── Title[人设名称]
    └── Card > Form
        ├── Form.Item[人设名称] (Input, maxLength=50)
        ├── Form.Item[用户设定描述] (TextArea, maxLength=2000)
        ├── Form.Item[头像] (上传按钮 + Avatar 预览)
        └── Form.Item[保存] (Button type=primary)
```

### 3.5 状态管理

| 状态 | 类型 | 说明 |
|------|------|------|
| `viewMode` | `'list' \| 'detail'` | 当前视图模式 |
| `profiles` | `UserAvatarProfile[]` | 人设列表 (本地 state) |
| `editingProfile` | `UserAvatarProfile \| null` | 正在编辑的人设 |
| `profileForm` | `{ name, description, avatarPath }` | 表单字段值 |
| `avatarDisplayUrl` | `string` | 头像 Base64 Data URL |
| `avatarDir` | `string` | 人设存储目录 |

### 3.6 数据模型

```typescript
interface UserAvatarProfile {
  id: string;            // 唯一标识 (profile-{timestamp})
  name: string;          // 人设名称
  description: string;   // 人设描述
  avatarPath: string;    // 头像文件路径
  createdAt: number;     // 创建时间戳
  updatedAt: number;     // 更新时间戳
}
```

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **跨平台路径兼容** | 内部统一使用正斜杠 `/` 存储路径，读取时转换回系统原生格式 |
| **头像文件管理** | 上传时复制到人设目录（而非使用原路径），确保文件不因源位置变动而丢失 |
| **Base64 异步加载** | 通过 `readAsBase64` IPC 调用异步加载，5 秒超时自动回退到默认图标 |
| **视图状态清理** | 切换视图时正确重置 `editingProfile`、`avatarFileList` 等状态 |
| **删除当前编辑项** | 如果删除的是当前正在编辑的人设，自动切换回列表视图 |

### 4.2 性能优化策略

1. **按需加载**: 头像 Base64 仅在需要显示时异步加载
2. **文件验证**: 上传头像后验证文件存在性，避免后续显示失败
3. **列表排序**: 按更新时间排序，最近修改的优先显示

### 4.3 安全考虑

- 人设目录限制在 `__USER_DATA__/data/avatars` 下
- 文件操作通过主进程 IPC 代理
- 图片文件类型验证（仅允许 PNG/JPG/WebP/GIF）
- 图片大小限制 5MB

### 4.4 边界情况处理

- 无头像时显示默认 UserOutlined 图标
- 空人设列表显示 Empty 组件提示
- 头像文件不存在时静默降级
- 保存时验证名称为非空

---

## 5. 模块间关系

### 5.1 依赖关系

```
Avatar Module
    ├──→ Setting Module (存储路径配置)
    │       └──→ avatarPath → avatarService.setAvatarDir()
    ├──→ File Module (文件/图片操作)
    │       └──→ selectFile / copyFile / exists / readAsBase64
    ├──→ App Module (用户数据路径)
    │       └──→ getUserDataPath (解析 __USER_DATA__)
    └──→ LogStore (日志记录)
```

### 5.2 被依赖关系

```
Dashboard Module
    └──→ avatars 数量统计
CharacterDialogueChat (角色对话)
    └──→ PersonaPanel (用户人设选择)
```

### 5.3 数据流

```
用户操作       → AvatarManager → IPC → avatarService → 文件系统
  ↑                                                       ↓
  └────────────────── 读取更新 ──────────────────────────┘
```

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 人设 Profile | JSON 文件 | `{avatarDir}/{id}.json` |
| 头像图片 | 原始图片文件 | `{avatarDir}/avatar-{profileId}-{timestamp}.{ext}` |

### 6.2 缓存策略

- **无缓存**: 每次操作后重新加载完整列表 (`loadProfiles`)
- **头像预览**: 仅在编辑详情视图中临时加载 Base64，离开时清除

### 6.3 数据生命周期

```
创建 → 生成 ID → 填写表单 → 保存 → 写入 JSON + 复制头像文件
编辑 → 读取 JSON → 加载头像 → 修改 → 保存 → 覆盖 JSON
删除 → 删除 JSON 文件 → 刷新列表
```

---

## 7. API 文档

### 7.1 人设列表

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `avatar:list` |
| **调用方式** | `window.electronAPI.avatar.list()` |
| **请求参数** | 无 |
| **返回结构** | `{ name: string; path: string; size: number; modified: Date }[]` |

### 7.2 读取人设

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `avatar:read` |
| **调用方式** | `window.electronAPI.avatar.read(path)` |
| **请求参数** | `path: string` — JSON 文件路径 |
| **返回结构** | `UserAvatarProfile \| null` |

### 7.3 写入人设

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `avatar:write` |
| **调用方式** | `window.electronAPI.avatar.write(path, data)` |
| **请求参数** | `path: string`; `data: UserAvatarProfile` |
| **返回结构** | `{ success: boolean }` |

### 7.4 删除人设

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `avatar:delete` |
| **调用方式** | `window.electronAPI.avatar.delete(path)` |
| **请求参数** | `path: string` — 文件路径 |
| **返回结构** | `{ success: boolean }` |

### 7.5 获取/设置目录

| IPC 通道 | 调用方式 | 说明 |
|---------|---------|------|
| `avatar:getDirectory` | `avatar.getDirectory()` | 返回当前人设目录路径 |
| `avatar:setDirectory` | `avatar.setDirectory(dir)` | 设置人设目录 (`__USER_DATA__` 宏支持) |

### 7.6 文件操作 (通过 file API)

| IPC 通道 | 调用方式 | 用途 |
|---------|---------|------|
| `file:selectFile` | `file.selectFile(filters)` | 选择图片文件 |
| `file:copyFile` | `file.copyFile(src, dst)` | 复制头像到人设目录 |
| `file:exists` | `file.exists(path)` | 验证文件存在 |
| `file:readAsBase64` | `file.readAsBase64(path)` | Base64 读取头像 |
