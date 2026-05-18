# 写作模式"生成大纲" Unknown Error 全面排查与修复计划

## 一、问题背景

用户在写作模式配置面板点击"生成大纲"按钮后，系统弹出 "Unknown error" 错误提示。需要全链路排查问题根源并修复。

## 二、排查范围

### 1. 前端代码审查

#### 1.1 触发入口分析
- **目标文件**: `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx`
- **重点检查**: `handleGenerateOutline` 函数（约第 90-154 行）
  - 表单校验逻辑是否正确
  - AI 配置加载状态检查
  - `window.electronAPI.writing.generateOutline` 调用方式
  - 错误捕获与处理逻辑

#### 1.2 electronAPI 类型定义
- **目标文件**: `src/renderer/types/electron.d.ts`
- **重点检查**: `writing.generateOutline` 方法签名是否与 IPC handler 一致

#### 1.3 资源加载流程
- **目标文件**: `WritingConfigPanel.tsx` 的 `loadResources` 函数
- **重点检查**: `avatar.list()` 调用是否返回有效数据，过滤逻辑是否正确

### 2. IPC Handler 审查

#### 2.1 generateOutline Handler
- **目标文件**: `src/main/ipc/handlers/writingHandlers.ts`
- **重点检查**:
  - `writing:generateOutline` handler 实现（约第 128-153 行）
  - `request.resources?.userPersonaIds` 访问是否安全（刚添加的代码）
  - `writingResourceManager.loadUserPersonas` 调用是否异常
  - `outlineGenerator.buildPrompt(enrichedRequest)` 类型是否兼容

#### 2.2 loadResources Handler
- **目标文件**: `writingHandlers.ts` 的 `writing:loadResources` handler
- **重点检查**: `userPersonaIds` 参数解构是否安全

### 3. 后端服务审查

#### 3.1 WritingResourceManager
- **目标文件**: `src/main/services/WritingResourceManager.ts`
- **重点检查**:
  - `loadUserPersonas` 方法实现
  - `pathService.getCustomPath('avatar')` 返回值是否为空/undefined
  - 文件读取逻辑是否正确

#### 3.2 OutlineGenerator
- **目标文件**: `src/main/services/writing/OutlineGenerator.ts`
- **重点检查**:
  - `buildPrompt` 方法新增的 `_resourceContext` 参数处理
  - `promptBuilder.buildOutlinePrompt` 调用签名是否匹配

#### 3.3 PromptBuilder
- **目标文件**: `src/main/services/writing/PromptBuilder.ts`
- **重点检查**:
  - `buildOutlinePrompt` 新增 `resourceContext` 参数的模板字符串拼接
  - 模板中 `${resourceContext ? ...}` 语法是否正确

### 4. 类型一致性检查

#### 4.1 OutlineGenerationRequest 类型
- **目标文件**: `src/shared/types/writing.types.ts`
- **重点检查**: `OutlineGenerationRequest` 接口中的 `resources` 字段是否包含 `userPersonaIds`

#### 4.2 WritingResourceConfig 类型
- **目标文件**: `src/shared/types/writing.types.ts`
- **重点检查**: 已添加的 `userPersonaIds?: string[]` 是否可选且类型正确

## 三、实施步骤

### 步骤 1: 定位错误根源
1. 检查 `handleGenerateOutline` 的 catch 块，确认错误来源
2. 分析 `generateOutline` IPC handler 的异常捕获逻辑
3. 检查 `writingResourceManager.loadUserPersonas` 是否抛出异常

### 步骤 2: 修复代码问题
根据步骤 1 的排查结果，修复发现的问题：
- 如果是类型不匹配：修正类型定义
- 如果是方法调用错误：修正调用方式
- 如果是空值访问：添加安全访问保护
- 如果是参数传递错误：修正参数结构

### 步骤 3: 增强错误处理
1. 在 `handleGenerateOutline` 中添加更详细的错误日志
2. 在 IPC handler 中添加参数校验和错误分类
3. 在 `loadUserPersonas` 中添加路径不存在时的优雅降级

### 步骤 4: 验证修复
1. 运行 `npm run build` 确认编译通过
2. 检查 TypeScript 诊断信息
3. 验证所有相关组件无错误

## 四、预期输出

- 修复 "Unknown error" 的根本原因
- 增强错误处理，提供更具体的错误提示
- 确保代码通过编译和类型检查
