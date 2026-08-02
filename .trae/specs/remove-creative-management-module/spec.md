# 移除创意管理功能模块 Spec

## Why
创意管理功能模块（CreativeManager，路由 key: `creative`）自试运行以来使用率为 0%。该模块是一个基于单 JSON 文件（`creative-data.json`）的轻量级内容创作容器，内嵌了角色卡和世界书的文本编辑功能，但这些功能与系统中独立的角色卡管理模块（CharacterManager，基于 PNG 文件）和世界书管理模块（WorldBookManager，基于 JSON 文件）高度重叠。移除该模块可降低系统代码复杂度，提高维护效率。

## What Changes
- **BREAKING** 移除创意管理路由入口（`creative` tab）及侧边栏菜单项
- 删除 `CreativeManager` 容器组件及其所有子页面组件（CreativeListPage、CreativeEditPage、CharacterCardListPage、CharacterCardEditPage、WorldBookListPage、WorldBookEditPage、WorldBookEditor）
- 删除创意管理专用的子导航组件（CreativeSubNav）
- 删除创意管理专用的导出组件（FormatExport 目录下 3 个文件）
- 删除创意管理专用的 AI 生成 Hook（useCreativeAI）
- 删除创意管理专用的导出格式化工具（exportFormatters）
- 删除创意管理专用的提示词模板（promptTemplates）
- 删除创意管理前端状态管理（creativeStore）
- 删除创意管理后端 IPC 处理器（creativeHandlers）及其注册
- 删除 preload.ts 中的 creative API 定义
- 删除 electron.d.ts 中的 creative 类型声明
- 清理 uiStore 中的 creativeTab、creativeView 及相关类型和 setter
- 清理 storageService 中的 CREATIVES 存储键及相关方法
- 清理 pathService 中的 creative 模块目录映射
- 清理 chat.types.ts 中对 creativeStore 的注释引用
- **保留** Creative 目录下的 WritingMode 子目录（被 CreationCenter 懒加载使用）
- **保留** characterChat IPC 处理器（被 Character 模块使用，非创意管理专属）
- **保留** ChatStorageService（被 Character 模块共享使用）
- 更新技术文档

## Impact
- 受影响的功能：创意管理页面完全移除，用户不再能通过侧边栏访问"创意管理"入口
- 不受影响的功能：
  - 创作中心（CreationCenter，路由 key: `chat`）— 独立模块，不受影响
  - 角色卡管理（CharacterManager，路由 key: `character`）— 独立模块，不受影响
  - 世界书管理（WorldBookManager，路由 key: `worldbook`）— 独立模块，不受影响
  - 写作模式（WritingMode）— 被 CreationCenter 懒加载，保留在 Creative 目录下
- 受影响的代码：
  - `src/renderer/components/Creative/` — 删除非 WritingMode 的所有文件
  - `src/renderer/stores/creativeStore.ts` — 删除
  - `src/renderer/utils/promptTemplates.ts` — 删除
  - `src/renderer/routeConfig.ts` — 移除 creative 路由
  - `src/renderer/stores/uiStore.ts` — 移除 creative 相关状态
  - `src/main/ipc/handlers/creativeHandlers.ts` — 删除
  - `src/main/ipc/index.ts` — 移除 creative handler 注册
  - `src/main/preload.ts` — 移除 creative API
  - `src/renderer/types/electron.d.ts` — 移除 creative 类型
  - `src/main/services/storageService.ts` — 移除 CREATIVES 键和方法
  - `src/main/services/pathService.ts` — 移除 creative 映射
  - `src/shared/types/chat.types.ts` — 清理注释

## REMOVED Requirements

### Requirement: 创意管理模块
**Reason**: 该功能模块自试运行以来使用率为 0%，且其角色卡/世界书编辑功能与系统中独立的角色卡管理和世界书管理模块高度重叠，增加了不必要的代码复杂度。
**Migration**: 无需数据迁移。该模块的数据存储在独立的 `creative-data.json` 文件中，不影响其他模块的数据。已有的 `creative-data.json` 文件可保留在用户数据目录中但不再被系统读取。用户如需角色卡/世界书创作功能，可使用独立的角色卡管理模块和世界书管理模块。

#### Scenario: 移除后路由不可访问
- **WHEN** 用户查看侧边栏菜单
- **THEN** 不再显示"创意管理"菜单项
- **WHEN** 用户尝试通过编程方式设置 `activeTab` 为 `'creative'`
- **THEN** 系统回退到 Dashboard 默认页面

#### Scenario: 核心功能不受影响
- **WHEN** 用户访问"创作中心"
- **THEN** 聊天模式、写作模式、游戏模式三个入口正常显示和工作
- **WHEN** 用户访问"角色卡"管理
- **THEN** 角色卡列表、导入、编辑、AI 生成等功能正常工作
- **WHEN** 用户访问"世界书"管理
- **THEN** 世界书列表、条目管理、AI 操作等功能正常工作
- **WHEN** 用户在创作中心点击"写作模式"
- **THEN** WritingMode 组件正常懒加载和渲染
