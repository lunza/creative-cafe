# 设置模块 (Settings Module) 技术文档

> 模块路径: `src/renderer/components/Settings/`
> 源码文件: `Settings.tsx`, `Settings.css`
> 状态管理: `src/renderer/stores/settingStore.ts`
> 类型定义: `src/renderer/types/setting.ts`, `src/shared/settings.ts`, `src/shared/schemas/settingSchema.ts`
> 后端支撑: `src/main/ipc/handlers/settingHandlers.ts`, `src/main/services/settingService.ts`

---

## 1. 模块功能描述

设置模块是 Creative Cafe 的**全局配置中心**，提供对应用外观、数据路径、AI 引擎、优化策略和向量配置的全面管理。

### 核心能力

| 功能区域 | 描述 |
|---------|------|
| **外观设置** | 主题切换（亮色/暗色）、动画开关、紧凑模式、仪表盘背景图片上传 |
| **路径设置** | 管理 6 类数据存储路径：世界书、角色卡、用户人设、创意、记忆、插件 |
| **路径操作** | 浏览选择目录、手动输入路径、重置默认、一键验证路径（有效性+存在性）、打开文件夹 |
| **AI 引擎管理** | 多引擎配置增删改查、默认引擎/激活引擎设置、引擎切换、连通性测试 |
| **AI 引擎参数** | API 地址/密钥/模型名/API 模式/密钥传输方式/系统提示词/采样器参数 (temperature/top_p/top_k/min_p/frequency_penalty/presence_penalty/n) |
| **优化设置** | 自动优化开关、优化级别（轻度/中度/深度）、备份优化前数据 |
| **高级设置** | 调试模式、日志级别（error/warn/info/debug） |
| **向量配置** | 集成 VectorConfigPanel 子组件（向量嵌入模式/缓存策略/上下文窗口等） |
| **配置文件操作** | 保存设置、打开配置文件（外部编辑器）、重置为默认设置 |

### AI 引擎配置完整参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `api_url` | string | `http://127.0.0.1:5000` | API 服务地址 |
| `api_key` | string | `""` | API 密钥（密码框遮蔽） |
| `model_name` | string | `qwen3.5-27b-heretic-v3` | 模型名称 |
| `api_mode` | `text_completion \| chat_completion` | `text_completion` | API 调用模式 |
| `api_key_transmission` | `header \| body` | `body` | 密钥传输方式 (Authorization头/请求体) |
| `max_tokens` | number | 10240 | 最大生成令牌数 |
| `temperature` | number | 0.7 | 温度参数 (0-2) |
| `top_p` | number | 0.95 | Top-P 采样 (0-1) |
| `top_k` | number | 0 | Top-K 采样 |
| `min_p` | number | 0.1 | Min-P 采样 |
| `frequency_penalty` | number | 0 | 频率惩罚 (-2~2) |
| `presence_penalty` | number | 0 | 存在惩罚 (-2~2) |
| `n` | number | 1 | 生成数量 |
| `system_prompt` | string | `""` | 全局系统提示词（附加到所有请求） |

---

## 2. 模块定位与业务价值

### 战略角色

设置模块是系统中**唯一被所有其他模块依赖**的基础设施模块。

```
┌────────────────────────────────────────────────────┐
│                  Settings Module                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐│
│  │ AI 引擎   │ │ 路径配置  │ │ 向量/外观/优化/高级   ││
│  │ (多引擎)  │ │ (6类)    │ │                      ││
│  └──────────┘ └──────────┘ └──────────────────────┘│
│                         ↓                           │
│  ┌────────────────────────────────────────────────┐ │
│  │         被所有业务模块依赖和引用                  │ │
│  │  WorldBook / Character / Avatar / Knowledge    │ │
│  │  Creative / Plugin / Memory / PromptOptimizer  │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### 解决的业务痛点

1. **AI 引擎多源管理**: 支持配置多个 AI 引擎（本地 API/OpenAI 兼容服务/NovelAI 等）并随时切换
2. **路径集中管理**: 6 类存储路径统一配置，避免各模块各自管理
3. **连通性验证**: 内置测试工具验证 AI 服务可用性（含响应时间/模型名显示）
4. **安全的密钥管理**: API Key 在主进程存储和传输，渲染进程不可直接访问

---

## 3. 技术实现方案

### 3.1 整体技术架构

```
Settings Component
├── Form[外观设置]
│   ├── Select[主题]
│   ├── Switch[动画/紧凑模式]
│   └── Upload[背景图片]
├── Form[路径设置] (6 行)
│   └── 每行: Input + 浏览/重置/验证 + 状态文字
├── Form[优化设置]
│   ├── Switch[自动优化]
│   ├── Select[优化级别]
│   └── Switch[备份]
├── Form[AI引擎设置]
│   ├── Select[引擎选择] + Button[管理引擎]
│   ├── 引擎参数表单 (13 个字段)
│   ├── Button[测试连通性] + Alert[结果]
│   └── Modal[引擎管理]
│       ├── Table[引擎列表] (名称/地址/模型/模式/状态)
│       └── Form[引擎编辑] (20+ 字段)
├── Form[高级设置]
│   ├── Switch[调试模式]
│   └── Select[日志级别]
├── VectorConfigPanel (ref 模式获取值)
└── Space[保存/打开配置文件/重置]
        ↓
useSettingStore
├── fetchSetting / saveSetting
├── testConnection (连通性测试)
├── restoreDefault / exportSetting / importSetting
        ↓ IPC
settingHandlers (主进程)
├── setting:load / setting:save
└── storageService → settings.json
```

### 3.2 设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Singleton** | settingService | 全局唯一设置服务实例 |
| **Observer** | useSettingStore → Settings | 设置变更自动同步 UI |
| **Strategy** | API 模式/密钥传输方式 | 双模式选择（text_completion/chat_completion, header/body）|
| **Mediator** | GraphQLForm | Form 统一管理字段验证和提交流程 |
| **Ref Forwarding** | VectorConfigPanel | 通过 ref 获取向量配置值，不通过 Form 管理 |

### 3.3 核心算法

#### `__USER_DATA__` 路径宏解析

```typescript
function resolveUserDataPlaceholder(dir: string): string {
  const userDataPath = getUserDataPath(); // AppData 路径
  if (dir.includes('__USER_DATA__')) {
    return dir.replace(/__USER_DATA__/g, userDataPath);
  }
  return dir;
}
```

#### AI 引擎连通性测试

```typescript
// 1. 根据 api_mode 构造测试 URL
//    chat_completion: {baseUrl}/v1/chat/completions
//    text_completion: {baseUrl}/v1/completions
// 2. 构造最小测试请求体
// 3. 根据 api_key_transmission 设置认证
//    - header: Authorization: Bearer {key}
//    - body: { api_key: key }
// 4. 5 秒超时发送 POST 请求
// 5. 记录: 成功/失败, 响应时间(ms), 模型名, 错误详情
```

#### 保存设置 → 同步其他模块目录

```typescript
// 保存设置后自动更新依赖模块的目录:
if (values.characterPath) {
  await window.electronAPI.character.setDirectory(values.characterPath);
}
if (values.worldBookPath) {
  await window.electronAPI.worldBook.setDirectory(values.worldBookPath);
}
```

### 3.4 组件树结构

```
Settings
├── Card[外观设置] → Form (3 fields)
├── Card[路径设置]
│   ├── 提示信息 (__USER_DATA__ 使用说明)
│   └── Form (6 个路径字段, 每个字段含 浏览/重置/验证按钮)
├── Card[优化设置] → Form (3 fields)
├── Card[AI引擎设置]
│   ├── Select[引擎选择] + Button[管理引擎]
│   ├── 引擎参数 (13 个 Form.Item)
│   ├── Button[测试连通性] + Alert[结果]
│   └── Modal[引擎管理]
│       ├── 列表视图: Table + Button[添加新引擎]
│       └── 编辑视图: Form (引擎名称/API地址/密钥/模型/模式/参数)
├── Card[高级设置] → Form (2 fields)
├── VectorConfigPanel (ref: vectorConfigRef)
└── Space[保存/打开配置文件/重置]
```

---

## 4. 关键技术要点

### 4.1 技术难点与解决方案

| 难点 | 解决方案 |
|------|---------|
| **设置对象大小监控** | 保存前检查 `JSON.stringify(setting).length` 并记录日志 |
| **localStorage 可用性检测** | 保存前写入测试键验证，不可用时提前告警 |
| **路径实时验证** | 独立按钮触发验证，状态与按钮联动（有效✔/无效✖/验证中loading） |
| **多引擎管理 UX** | Modal 内双模式: 表格列表 (选择/编辑/删除/默认) + 编辑表单 (完整参数) |
| **引擎删除保护** | 至少保留一个引擎，删除最后一个时报错 |
| **删除当前激活引擎** | 自动切换激活引擎为列表第一个，同步更新默认引擎 |
| **模块目录联动** | 保存设置后自动调用 `character.setDirectory` / `worldBook.setDirectory` |

### 4.2 性能优化策略

- **延迟验证**: 路径验证不自动触发，需用户手动点击
- **条件加载**: VectorConfigPanel 通过 ref 获取值，不阻塞主表单渲染
- **局部状态**: `paths`, `pathValidation` 等仅在 Settings 内部使用的状态用 useState 管理

### 4.3 安全考虑

- API Key 使用 `Input.Password` 组件遮蔽
- 密钥在主进程存储，渲染进程通过 Bearer Token + IPC 间接使用
- `__USER_DATA__` 路径宏限制在 AppData 隔离目录
- 所有文件操作通过主进程 IPC 代理

---

## 5. 模块间关系

### 5.1 依赖关系

```
Settings Module
    ├──→ VectorConfigPanel (向量配置)
    ├──→ useUIStore (主题/动画/紧凑模式状态)
    ├──→ useLogStore (日志)
    ├──→ settingService (主进程存储)
    └──→ electronAPI (file/app/ai/character/worldBook/vector)
```

### 5.2 被依赖关系

**所有业务模块** 通过 `useSettingStore().setting` 读取 AI 引擎和路径配置。

---

## 6. 数据持久化

### 6.1 存储机制

| 数据项 | 存储格式 | 存储位置 |
|--------|---------|---------|
| 全局设置 | JSON 文件 | `{AppData}/creative-cafe/data/settings.json` |
| 默认设置 | `shared/settings.ts` 常量 | 代码内置 (无文件持久化时回退) |

### 6.2 设置 Schema

```typescript
interface AppSetting {
  // 引擎配置
  aiEngines: AIEngineSetting[];      // 多引擎列表
  activeEngineId: string;            // 当前激活引擎
  defaultEngineId: string;           // 默认引擎
  
  // 路径配置 (全部支持 __USER_DATA__ 宏)
  worldBookPath: string;             // 默认: __USER_DATA__/data/worldbooks
  characterPath: string;             // 默认: __USER_DATA__/data/characters
  avatarPath: string;                // 默认: __USER_DATA__/data/avatars
  creativePath: string;              // 默认: __USER_DATA__/data/creatives
  memoryPath: string;                // 默认: __USER_DATA__/data/memories
  pluginPath: string;                // 默认: __USER_DATA__/data/plugins
  
  // 外观
  theme: 'light' | 'dark';
  animationEnabled: boolean;
  compactMode: boolean;
  dashboardBackgroundImage: string;  // Base64 Data URL
  
  // 优化
  autoOptimize: boolean;
  optimizeLevel: 'light' | 'medium' | 'deep';
  backupBeforeOptimize: boolean;
  
  // 高级
  debugMode: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  
  // 向量
  vector: VectorConfig;
}
```

### 6.3 数据生命周期

```
应用启动 → settingHandlers 初始化 → 读取 settings.json
    ↓ (不存在则使用默认设置)
useSettingStore.fetchSetting() → 同步到渲染进程
    ↓
用户修改 → Form.validate → handleSave
    ↓
saveSetting → IPC → storageService.setSettings → 写入 JSON
    ↓ (同步更新)
character.setDirectory / worldBook.setDirectory
```

---

## 7. API 文档

### 7.1 设置加载

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `setting:load` |
| **调用方式** | `window.electronAPI.setting.load()` |
| **请求参数** | 无 |
| **返回结构** | `{ success: boolean; setting?: AppSettingType; error?: string }` |

### 7.2 设置保存

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `setting:save` |
| **调用方式** | `window.electronAPI.setting.save(setting)` |
| **请求参数** | `setting: AppSettingType` — 完整设置对象 |
| **返回结构** | `{ success: boolean; error?: string }` |

### 7.3 路径选择

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `file:selectDirectory` |
| **调用方式** | `window.electronAPI.file.selectDirectory()` |
| **请求参数** | 无 |
| **返回结构** | `string \| null` — 选择的目录路径 |

### 7.4 路径验证

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `file:validatePath` |
| **调用方式** | `window.electronAPI.file.validatePath(path)` |
| **请求参数** | `path: string` — 绝对路径 |
| **返回结构** | `{ valid: boolean; exists: boolean; error?: string }` |

### 7.5 用户数据路径

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `app:getUserDataPath` |
| **调用方式** | `window.electronAPI.app.getUserDataPath()` |
| **返回结构** | `string` — AppData 用户数据目录 |

### 7.6 打开配置文件

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `app:openConfigFile` |
| **调用方式** | `window.electronAPI.app.openConfigFile()` |
| **返回结构** | `{ success: boolean }` |

### 7.7 AI 连通性测试 (内部)

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `ai:request` (间接) |
| **请求参数** | `{ url, method: 'POST', headers, body, timeout: 5000 }` |
| **返回结构** | `{ success: boolean; data?: { choices, usage, id }; error?: string }` |

### 7.8 角色卡路径更新

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `character:setDirectory` |
| **请求参数** | `dir: string` (支持 `__USER_DATA__` 宏) |
| **返回结构** | `{ success: boolean; characterDir: string }` |

### 7.9 世界书路径更新

| 项目 | 内容 |
|------|------|
| **IPC 通道** | `worldBook:setDirectory` |
| **请求参数** | `dir: string` (支持 `__USER_DATA__` 宏) |
| **返回结构** | `{ success: boolean; worldBookDir: string }` |
