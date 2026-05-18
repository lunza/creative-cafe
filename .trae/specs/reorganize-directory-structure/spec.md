# 项目目录结构重组规范

## Why

当前项目目录结构存在多处不规范问题：文件分类混乱、相似功能模块分散、命名风格不统一、临时文件散落在项目根目录、插件代码与主代码混合等。这些问题降低了代码可维护性、增加了新开发者理解成本，并可能导致未来的维护混乱。

## What Changes

- **按功能域重组服务层**：将 `src/main/services/` 按功能分类（AI、向量存储、角色、记忆、知识库等）
- **清理组件目录**：重新组织 `src/renderer/components/`，按业务域划分而非按文件类型
- **统一命名规范**：所有文件采用 kebab-case 命名，服务文件以 `.service.ts` 结尾
- **清理冗余文件**：移除临时文件，整理测试脚本和文档
- **分离插件代码**：将 LongTermMemory 插件独立到 `plugins/` 目录
- **集中测试文件**：建立统一的测试目录结构

## Impact

- 受影响模块：所有目录结构
- 受影响代码：所有 import 路径需要更新
- 构建配置：vite.config.ts、tsconfig.json 可能需要更新
- **不会破坏任何现有功能**，仅做结构重组

## ADDED Requirements

### Requirement: 目录结构规范
项目 SHALL 采用以下目录组织结构：

```
src/
├── main/                           # Electron 主进程
│   ├── index.ts                    # 主进程入口
│   ├── preload.ts                  # 预加载脚本
│   ├── services/                   # 业务服务层
│   │   ├── ai/                     # AI 相关服务
│   │   ├── character/              # 角色相关服务
│   │   ├── chat/                   # 聊天相关服务
│   │   ├── memory/                 # 记忆系统服务
│   │   ├── knowledge-base/         # 知识库服务
│   │   ├── vector/                 # 向量存储相关服务
│   │   ├── world-book/             # 世界观书籍服务
│   │   ├── storage/                # 存储管理服务
│   │   ├── avatar/                 # 头像服务
│   │   ├── plugin/                 # 插件服务
│   │   ├── setting/                # 设置服务
│   │   ├── file/                   # 文件操作服务
│   │   ├── model/                  # 模型下载管理
│   │   └── optimization/           # 优化器服务
│   ├── ipc/                        # IPC 通信
│   │   ├── handlers/               # IPC 处理器
│   │   └── index.ts                # IPC 注册入口
│   ├── shared/                     # 主进程共享代码
│   │   └── schemas/                # 数据验证 schema
│   ├── types/                      # 主进程类型定义
│   └── utils/                      # 主进程工具函数
├── renderer/                       # React 渲染进程
│   ├── main.tsx                    # 渲染进程入口
│   ├── App.tsx                     # 根组件
│   ├── settings.ts                 # 渲染进程设置
│   ├── components/                 # React 组件
│   │   ├── avatar/                 # 头像管理组件
│   │   ├── character/              # 角色相关组件
│   │   │   ├── character-dialogue/ # 角色对话组件
│   │   │   └── character-manager/  # 角色管理组件
│   │   ├── chat/                   # 聊天模式组件
│   │   ├── creative/               # 创意工坊组件
│   │   │   ├── editor/             # 编辑器相关
│   │   │   ├── export/             # 导出功能
│   │   │   └── generate/           # AI生成相关
│   │   ├── dashboard/              # 仪表盘组件
│   │   ├── knowledge-base/         # 知识库组件
│   │   ├── layout/                 # 布局组件
│   │   ├── markdown-editor/        # Markdown 编辑器
│   │   ├── memory-chat/            # 记忆聊天
│   │   ├── persona/                # 人设管理
│   │   ├── plugin/                 # 插件管理
│   │   ├── prompt-optimizer/       # 提示词优化器
│   │   ├── settings/               # 设置页面
│   │   ├── vector/                 # 向量相关面板
│   │   └── world-book/             # 世界观书籍组件
│   ├── hooks/                      # 自定义 React Hooks
│   ├── services/                   # 渲染进程服务
│   ├── stores/                     # Zustand 状态管理
│   ├── styles/                     # 全局样式
│   ├── types/                      # 渲染进程类型定义
│   └── utils/                      # 渲染进程工具函数
├── shared/                         # 主进程与渲染进程共享
│   ├── schemas/                    # 共享数据验证 schema
│   ├── types/                      # 共享类型定义
│   └── settings.ts                 # 共享设置
└── test/                           # 测试文件
    ├── setup.ts                    # 测试配置
    ├── unit/                       # 单元测试
    ├── integration/                # 集成测试
    └── fixtures/                   # 测试夹具

plugins/                            # 插件目录（与 src 平级）
└── long-term-memory/               # 长期记忆插件
    ├── core/                       # 核心逻辑
    ├── scripts/                    # 脚本
    ├── manifest.json               # 插件清单
    └── index.js                    # 插件入口
```

#### Scenario: 文件移动操作
- **WHEN** 执行目录重组
- **THEN** 所有 import 路径 SHALL 自动更新

### Requirement: 文件命名规范
所有文件 SHALL 遵循以下命名规则：
- 组件文件：`PascalCase.tsx`（如 `CharacterManager.tsx`）
- 服务文件：`kebab-case.service.ts`（如 `character.service.ts`）
- 工具文件：`kebab-case.utils.ts`（如 `format.utils.ts`）
- 类型文件：`kebab-case.types.ts`（如 `character.types.ts`）
- 样式文件：`kebab-case.css`（如 `character-manager.css`）
- Hook 文件：`usePascalCase.ts`（如 `useCharacterSwitch.ts`）
- 测试文件：`kebab-case.test.ts` 或 `kebab-case.test.tsx`
- 配置文件：保持现有命名（如 `tsconfig.json`）

### Requirement: 测试文件组织
- 单元测试放在 `src/test/unit/` 目录
- 集成测试放在 `src/test/integration/` 目录
- 组件紧邻测试文件可放在组件目录内的 `__tests__/` 子目录
- 测试夹具（fixtures）放在 `src/test/fixtures/` 目录

### Requirement: 临时文件清理
项目根目录 SHALL 不包含临时文件：
- 移除 `temp_hooks.txt`
- 测试脚本移至 `scripts/` 目录或整合到测试套件

## MODIFIED Requirements

### Requirement: IPC 处理器组织
**当前**: `src/main/ipc/handlers/` 下文件较多，难以维护
**修改为**: 按功能域分组：
- `character/` - 角色相关 handlers
- `chat/` - 聊天相关 handlers  
- `creative/` - 创意相关 handlers
- `memory/` - 记忆相关 handlers
- `knowledge-base/` - 知识库 handlers
- `world-book/` - 世界观书籍 handlers
- `setting/` - 设置 handlers
- `plugin/` - 插件 handlers
- `avatar/` - 头像 handlers
- `file/` - 文件 handlers
- `ai/` - AI 服务 handlers
- `app/` - 应用级 handlers
- `update/` - 更新相关 handlers

## REMOVED Requirements

### Requirement: Common 组件目录
**原因**: `src/renderer/components/Common/` 包含过多不相关内容（AIService、DataPersistence、ChatEngine、MarkdownEditor、RichTextRenderer 等），违背了单一职责原则

**迁移方案**:
- `AIService.*` → `src/renderer/services/ai.service.ts`（作为服务而非组件）
- `DataPersistence.*` → `src/renderer/services/persistence.service.ts`
- `ChatEngine/` → `src/renderer/services/chat-engine/`
- `MarkdownEditor/` → `src/renderer/components/markdown-editor/`（独立顶级目录）
- `RichTextRenderer.tsx` → `src/renderer/components/common/rich-text-renderer.tsx`
- `StoragePathDisplay.tsx` → `src/renderer/components/common/storage-path-display.tsx`
- 新建 `src/renderer/components/common/` 存放真正通用的 UI 组件
