# 仪表盘模块 (Dashboard Module) 技术文档

> 模块路径: `src/renderer/components/Dashboard/`
> 源码文件: `Dashboard.tsx`, `Dashboard.css`, `LogViewer.tsx`
> 支撑文件: `src/renderer/stores/dataStore.ts`, `src/renderer/stores/uiStore.ts`, `src/renderer/stores/logStore.ts`, `src/renderer/utils/animation.ts`

---

## 1. 模块功能描述

仪表盘模块是 Creative Cafe 应用的**系统首页与核心概览面板**，为用户提供对系统数据的即时全景观测。

### 核心能力

| 能力 | 描述 |
|------|------|
| **数据统计概览** | 实时展示世界书数量、角色卡数量、用户人设数量、已安装插件数量、配置加载状态、系统运行状态 |
| **自定义背景图片** | 用户可上传自定义背景图片（PNG/JPG/GIF/WebP），响应式自适应容器宽度（100px-800px 高度范围），按图片宽高比动态计算高度 |
| **使用技巧轮播** | 从文件系统读取 tips.json 内容，通过 Ant Design Carousel 组件轮播展示，支持左右切换和 5 秒自动播放 |
| **版本更新检查** | 调用更新检查流程：check → download → install，含完整错误处理和 Modal 确认交互 |
| **快捷文件夹访问** | 点击数据统计卡片可直接打开对应的世界书/角色卡/人设存储文件夹 |

### 操作类型

- **只读操作**: 查看统计数据、浏览使用技巧
- **导航操作**: 点击卡片跳转到文件系统文件夹
- **系统操作**: 检查更新、下载更新、安装更新
- **配置操作**: 背景图片来自设置（Settings 模块管理）

### 用户交互场景

1. 用户启动应用后首先看到仪表盘，快速了解当前系统状态
2. 在设置页面上传自定义背景图片后，仪表盘自动显示
3. 点击"检查更新"按钮触发版本更新流程
4. 浏览使用技巧轮播获取操作建议

### 功能边界

- 仪表盘**不包含**数据编辑功能，仅提供只读统计概览
- 数据统计来自其他模块的 Store，仪表盘本身不持有业务数据
- 更新功能依赖操作系统文件管理能力

---

## 2. 模块定位与业务价值

### 战略角色

仪表盘在整体系统架构中扮演**统一状态门户（Unified Status Portal）**角色：

```
┌─────────────────────────────────────────────────┐
│                  Dashboard                        │
│  ┌──────────┬──────────┬──────────┐             │
│  │ WorldBooks│Characters│ Avatars  │  ← 数据概览  │
│  ├──────────┼──────────┼──────────┤             │
│  │ Plugins  │  Config  │  System  │  ← 系统状态  │
│  └──────────┴──────────┴──────────┘             │
│  ┌──────────────────────────────────┐           │
│  │      Tips Carousel (使用技巧)     │  ← 用户引导  │
│  └──────────────────────────────────┘           │
│  [Check Update]                                 │
└─────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **数据不可见**: 用户打开应用后无法快速感知当前系统的数据规模
2. **配置状态不明**: 用户不知道配置是否加载成功
3. **缺少引导**: 新用户缺乏使用指导
4. **版本管理不便**: 无直观的更新检查入口

### 目标用户群体

- **SillyTavern 初级用户**: 通过仪表盘了解系统能力
- **SillyTavern 高级用户**: 快速概览数据状态
- **所有用户**: 版本更新管理

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
┌─────────────────────────────────────────────────────────┐
│                   Dashboard Component                    │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │ Background  │ │ Stats Grid   │ │ Tips Carousel    │ │
│  │ (自适应背景)  │ │ (6列统计卡片) │ │ (使用技巧轮播)    │ │
│  └─────────────┘ └──────────────┘ └──────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │            Update Button (检查更新)                  │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            ↓ 数据来源
┌───────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐
│ dataStore │ │ worldBook│ │setting  │ │ logStore │ │ uiStore │
│(角色/插件) │ │  Store  │ │  Store  │ │(日志状态) │ │(UI状态) │
└───────────┘ └─────────┘ └─────────┘ └──────────┘ └─────────┘
                            ↓ IPC 通信
┌──────────────────────────────────────────────────────────┐
│         window.electronAPI (Main Process)                 │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐  │
│  │ file.*   │ │ app.*    │ │ update.*  │ │setting.* │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Observer (Zustand)** | Store 订阅 | 通过 `useDataStore()`, `useWorldBookStore()`, `useSettingStore()` 等 hooks 订阅状态变化 |
| **Container/Presentational** | 无严格分离 | Dashboard 组件自身即包含展示逻辑和副作用处理 |
| **Lazy Init** | 背景图片加载 | `handleImageLoad` 回调驱动尺寸计算，仅在图片加载完成后更新 |
| **Composition** | LogViewer 子组件 | 日志查看器作为独立子组件，通过 Props 接收状态 |

### 3.3 核心算法

#### 背景图片自适应尺寸计算

```typescript
// 核心逻辑：根据容器宽度和图片宽高比计算显示高度
const getBackgroundSize = () => {
  if (!setting?.dashboardBackgroundImage) return { height: 200 };
  const minHeight = 100;
  const maxHeight = 800;
  const { width, height } = imageSize;           // 图片原始尺寸
  if (width === 0 || height === 0) return { height: minHeight };
  const aspectRatio = width / height;             // 宽高比
  const calculatedHeight = containerWidth / aspectRatio; // 按比例计算
  let finalHeight = Math.max(minHeight, Math.min(maxHeight, calculatedHeight));
  return { height: finalHeight, objectFit: 'cover' };
};
```

#### 多 Store 数据聚合

```typescript
// 组件挂载时并行拉取所有数据
useEffect(() => {
  fetchSetting();        // → useSettingStore
  fetchWorldBooks();     // → useWorldBookStore
  fetchCharacters();     // → useDataStore
  fetchInstalledPlugins(); // → useDataStore
}, [...]);
```

#### 动画条件控制

```typescript
// 仅在用户启用动画时应用 CSS 动画类
const getAnimatedClass = (className: string, animationName: string): string => {
  return animationEnabled ? `${className} ${animationName}` : className;
};
```

### 3.4 组件树结构

```
Dashboard
├── 背景图片区 (backgroundRef)
│   ├── <img>  (自定义背景图片)
│   └── .background-placeholder (默认占位提示)
├── Row > Col (统计数据网格 6列)
│   ├── Card[世界书数量] - onClick → handleOpenWorldBookFolder
│   ├── Card[角色卡数量] - onClick → handleOpenCharacterFolder
│   ├── Card[用户设定数量] - onClick → handleOpenAvatarFolder
│   ├── Card[已安装插件]
│   ├── Card[配置状态]
│   └── Card[系统状态]
├── Card[使用技巧] (Carousel 轮播)
│   └── Carousel > div > Typography.Title + Typography.Paragraph
└── Space[检查更新] (Button + LoadingIcon)
```

### 3.5 状态管理设计

| 状态 | 来源 Store | 类型 | 说明 |
|------|-----------|------|------|
| `characters` | `dataStore` | `any[]` | 角色卡列表 |
| `installedPlugins` | `dataStore` | `InstalledPlugin[]` | 已安装插件 |
| `avatars` | `dataStore` | `any[]` | 用户人设列表 |
| `worldBooks` | `worldBookStore` | `WorldBookMeta[]` | 世界书列表 |
| `setting` | `settingStore` | `AppSettingType \| null` | 全局设置对象 |
| `animationEnabled` | `uiStore` | `boolean` | 动画开关 |
| `addLog` | `logStore` | `function` | 日志记录方法 |

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **背景图片响应式适配** | 监听容器的 `resize` 事件，通过 `ref` 获取 `offsetWidth`，动态计算高度；设置 `objectFit: 'cover'` 保证覆盖效果 |
| **多 Store 数据加载时序** | 使用多个独立 `useEffect` + 并行 `async/await`，各 Store 独立管理各自的 loading 状态 |
| **版本更新流程复杂性** | 分步执行 check → download → install，每步都有独立错误处理和日志记录；使用 Modal.confirm 获取用户确认 |
| **使用技巧数据获取** | 异步读取文件系统的 `tips` JSON 文件，失败时降级使用硬编码默认内容 |
| **动画条件渲染** | 动画通过 `animationEnabled` 全局开关控制，通过字符串拼接动态添加/移除 CSS 类 |

### 4.2 性能优化策略

1. **图片懒加载**: 背景图片仅在设置中配置后才渲染 `<img>` 元素
2. **React.memo 等效优化**: 通过 `useMemo` 缓存 `backgroundStyle` 计算结果
3. **事件监听器管理**: `resize` 事件在组件卸载时正确移除
4. **并行数据加载**: 多个 Store 数据拉取在 `useEffect` 中并行执行

### 4.3 安全考虑

- 背景图片使用 Base64 Data URL 存储在设置中，不涉及外部 URL 加载
- 文件夹打开操作通过主进程 IPC 代理，遵循 Electron 安全模型
- 更新流程所有网络操作在主进程中执行

### 4.4 边界情况处理

- 无背景图片时显示占位提示
- `tips` 文件不存在时使用硬编码默认内容
- `tips` 加载中显示 Loading 状态
- 更新检查进行中时按钮显示 loading 并禁用重复点击

---

## 5. 模块间关系

### 5.1 依赖关系图

```
Dashboard
    ├──→ useDataStore       (角色、插件、人设数据)
    │       └──→ electronAPI.character.list()
    │       └──→ electronAPI.plugin.getInstalled()
    │       └──→ electronAPI.avatar.list()
    ├──→ useWorldBookStore  (世界书数据)
    │       └──→ electronAPI.worldBook.list()
    ├──→ useSettingStore    (全局设置)
    │       └──→ electronAPI.setting.load()
    ├──→ useLogStore        (日志管理)
    ├──→ useUIStore         (UI 状态: 动画开关)
    └──→ electronAPI.update.(check/download/install)
```

### 5.2 被依赖关系

Dashboard 模块是**顶层消费者**，不被其他模块直接依赖。其他模块通过各自的 Store 向 Dashboard 提供数据。

### 5.3 数据流

```
Settings Module (设置背景图片)
    ↓ saveSetting()
settingStore (setting.dashboardBackgroundImage)
    ↓ useSettingStore()
Dashboard (渲染背景图片)
```

```
WorldBook/Character/Avatar Modules (管理数据)
    ↓ IPC: list/CUD
dataStore / worldBookStore (存储列表)
    ↓ useDataStore / useWorldBookStore
Dashboard (显示统计数量)
```

### 5.4 集成点

- **与 Settings 模块**: 读取 `setting.dashboardBackgroundImage` 渲染背景，打开 `worldBookPath/characterPath/avatarPath` 文件夹
- **与 App 模块**: 获取 `userDataPath` 解析 `__USER_DATA__` 路径宏
- **与 File 模块**: 打开文件夹 (`openFolder`)、读取 tips (`readJson`)

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储方式 | 存储位置 |
|--------|---------|---------|
| 背景图片 | Base64 Data URL 存储于设置对象 | `setting.dashboardBackgroundImage` → `settings.json` |
| 使用技巧 | JSON 文件 | 文件系统 `tips` 文件 |
| 统计数据 | 不持久化，从各 Store 实时获取 | 无 |

### 6.2 缓存策略

- **无本地缓存**: 统计数据每次组件挂载时重新拉取
- **背景图片**: 作为设置的一部分随 settingStore 管理，设置本身通过 Zustand persist 中间件持久化

### 6.3 数据生命周期

```
应用启动 → Dashboard 挂载 → 并行拉取所有 Store 数据 → 渲染
                                                          ↓
用户切换 Tab → Dashboard 卸载 (数据保留在各 Store 中)
                                                          ↓
用户切回 Dashboard → Dashboard 重新挂载 → 重新拉取数据
```

---

## 7. API 文档

### 7.1 获取世界书列表

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:list` |
| **调用方式** | `window.electronAPI.worldBook.list()` |
| **HTTP 方法** | 无（IPC invoke） |
| **请求参数** | 无 |
| **返回结构** | `WorldBookMeta[]` —— `{ name: string; path: string; size: number; modified: Date }[]` |
| **错误处理** | 异常时返回空数组 `[]`，不影响其他数据加载 |

### 7.2 获取角色卡列表

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `character:list` |
| **调用方式** | `window.electronAPI.character.list()` |
| **请求参数** | 无 |
| **返回结构** | `Character[]` —— `{ name: string; path: string; size: number; modified: Date; characterName?: string; version?: string; creator?: string; tags?: string[]; cardVersion?: 'v1'\|'v2'\|'v3' }[]` |
| **错误处理** | 异常时 Store 设置 error 状态 |

### 7.3 获取用户人设列表

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `avatar:list` |
| **调用方式** | `window.electronAPI.avatar.list()` |
| **请求参数** | 无 |
| **返回结构** | `Avatar[]` —— 包含 `name`, `path`, `size`, `modified` 字段 |
| **错误处理** | 异常时 Store 设置 error 状态 |

### 7.4 获取已安装插件

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `plugin:getInstalled` |
| **调用方式** | `window.electronAPI.plugin.getInstalled()` |
| **请求参数** | 无 |
| **返回结构** | `InstalledPlugin[]` |
| **错误处理** | 异常时 Store 设置 error 状态 |

### 7.5 加载设置

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `setting:load` |
| **调用方式** | `window.electronAPI.setting.load()` |
| **请求参数** | 无 |
| **返回结构** | `{ success: boolean; setting?: AppSettingType; error?: string }` |
| **错误处理** | `success: false` 时包含 `error` 信息 |

### 7.6 检查更新

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `update:check` |
| **调用方式** | `window.electronAPI.update.check()` |
| **请求参数** | 无 |
| **返回结构** | `{ success: boolean; data?: { hasUpdate: boolean; currentVersion: string; latestVersion: string }; message?: string }` |

### 7.7 下载更新

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `update:download` |
| **调用方式** | `window.electronAPI.update.download(latestVersion)` |
| **请求参数** | `latestVersion: string` — 目标版本号 |
| **返回结构** | `{ success: boolean; data?: { downloadPath: string }; message?: string }` |

### 7.8 安装更新

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `update:install` |
| **调用方式** | `window.electronAPI.update.install(downloadPath)` |
| **请求参数** | `downloadPath: string` — 下载的安装包路径 |
| **返回结构** | `{ success: boolean; message?: string }` |

### 7.9 打开文件夹

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `file:openFolder` |
| **调用方式** | `window.electronAPI.file.openFolder(path)` |
| **请求参数** | `path: string` — 已解析的绝对路径 |
| **返回结构** | `{ success: boolean; message?: string }` |

### 7.10 读取 JSON 文件

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `file:readJson` |
| **调用方式** | `window.electronAPI.file.readJson(fileName)` |
| **请求参数** | `fileName: string` — 文件名（如 `tips`） |
| **返回结构** | 解析后的 JSON 数据或 `null` |

### 7.11 获取用户数据路径

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `app:getUserDataPath` |
| **调用方式** | `window.electronAPI.app.getUserDataPath()` |
| **请求参数** | 无 |
| **返回结构** | `string` — 用户数据目录的绝对路径 |

---

## 附录: LogViewer 子组件

`LogViewer` 是 Dashboard 模块的一个独立子组件（`src/renderer/components/Dashboard/LogViewer.tsx`），用于显示 SillyTavern 启动日志。

| 属性 | 描述 |
|------|------|
| **Props** | `logs: string[]` — 日志行数组, `clearLogs: () => void` — 清空日志回调 |
| **功能** | 自动滚动到底部、复制全部日志到剪贴板、清空日志 |
| **状态** | 无内部业务状态，完全由父组件驱动 |
