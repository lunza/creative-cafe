# Tasks

## 阶段一：类型定义与配置

- [x] Task 1: 扩展类型定义与默认配置
  - [x] SubTask 1.1: SDWebuiConfig 新增 selectedLoras 字段
  - [x] SubTask 1.2: settings.ts 默认配置新增 selectedLoras: []
  - [x] SubTask 1.3: SDWebuiSettings DEFAULT_SD_WEBUI_CONFIG 同步
  - [x] SubTask 1.4: ExpressionGenerateModal DEFAULT_SD_CONFIG 同步

## 阶段二：LoRA 服务层与 IPC

- [x] Task 2: 实现 LoRA 服务层
  - [x] SubTask 2.1: loraService.ts — fetchLoraList + 预览图 URL + JSON 元数据 + 分类提取
  - [x] SubTask 2.2: LoraModel 接口定义

- [x] Task 3: 新增 LoRA IPC 通道
  - [x] SubTask 3.1: loraHandlers.ts — lora:list 通道注册
  - [x] SubTask 3.2: preload.ts 暴露 lora.list
  - [x] SubTask 3.3: electron.d.ts 类型声明
  - [x] SubTask 3.4: ipc/index.ts 注册 registerLoraHandlers

## 阶段三：LoRA 选择 UI

- [x] Task 4: 实现 LoRA 选择 Modal 组件
  - [x] SubTask 4.1: LoraSelectModal.tsx — 网格 + 搜索 + 分类 + 多选 + Tooltip + 权重 + 移除
  - [x] SubTask 4.2: 性能优化（懒加载 + 缓存）

## 阶段四：生成流程集成

- [x] Task 5: AssetGenerateModal 集成 LoRA 选择
  - [x] SubTask 5.1: 参数概览区新增 LoRA 入口 Tag
  - [x] SubTask 5.2: buildSdOptions() 透传 selectedLoras
  - [x] SubTask 5.3: LoraSelectModal 渲染 + 确认回调更新 sdConfig

- [x] Task 6: ExpressionGenerateModal 集成 LoRA 选择
  - [x] SubTask 6.1: 批量模式 + 单个模式新增 LoRA 入口
  - [x] SubTask 6.2: buildSdOptions() 透传 selectedLoras

- [x] Task 7: sdGenerationService 注入 LoRA 标签
  - [x] SubTask 7.1: SDGenerationOptions 新增 selectedLoras 字段
  - [x] SubTask 7.2: prompt 注入 <lora:name:weight> 标签
  - [x] SubTask 7.3: 无 LoRA 时不注入标签

## 阶段五：SD 设置页 LoRA 持久化

- [x] Task 8: SDWebuiSettings 持久化 selectedLoras
  - [x] SubTask 8.1: getFormValues() 保留 setting.sdWebui.selectedLoras
  - [x] SubTask 8.2: form.setFieldsValue 初始化时包含 selectedLoras

## 阶段六：验证与文档

- [x] Task 9: 验证
  - [x] SubTask 9.1: TypeScript 编译检查（无新增错误）
  - [x] SubTask 9.2-9.7: 代码审查全部通过（30 个检查点）

- [x] Task 10: 更新技术文档
  - [x] SubTask 10.1: CHANGELOG.md 新增条目
  - [x] SubTask 10.2: PROJECT_DOCUMENTATION_NEW.md 新增 §7.3.7
  - [x] SubTask 10.3: CODE_WIKI.md 新增 §14.28/§14.29 + 更新服务表

# Task Dependencies
- Task 2（服务层）依赖 Task 1（类型定义）
- Task 3（IPC）依赖 Task 2（服务层）
- Task 4（UI）依赖 Task 3（IPC）
- Task 5/6（生成 Modal 集成）依赖 Task 4（UI）+ Task 1（类型）
- Task 7（Service 注入）依赖 Task 1（类型），可与 Task 4/5/6 并行
- Task 8（设置持久化）依赖 Task 1（类型），可与 Task 4-7 并行
- Task 9（验证）依赖 Task 1-8 全部完成
- Task 10（文档）依赖 Task 9 验证通过
