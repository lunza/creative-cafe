# Checklist

## 类型定义与配置
- [x] `SDWebuiConfig` 新增 `selectedLoras?: Array<{ name: string; weight: number }>` 字段（setting.ts）
- [x] 默认 sdWebui 配置新增 `selectedLoras: []`（settings.ts）
- [x] SDWebuiSettings DEFAULT_SD_WEBUI_CONFIG 同步（SDWebuiSettings.tsx）
- [x] ExpressionGenerateModal DEFAULT_SD_CONFIG 同步（ExpressionGenerateModal.tsx）

## LoRA 服务层与 IPC
- [x] `loraService.ts` 实现 `fetchLoraList(endpoint)` — 调用 GET /sdapi/v1/loras
- [x] 为每个 LoRA 构建预览图 URL（/sd_extra_networks/thumb?filename=...）
- [x] 读取本地 JSON 元数据文件（description/activationText/preferredWeight/sdVersion/notes）
- [x] 从 path 提取分类（子目录名）
- [x] `LoraModel` 接口定义完整（name/alias/path/previewUrl/description/category 等）
- [x] `lora:list` IPC 通道注册（loraHandlers.ts）
- [x] preload 暴露 `lora.list`（preload.ts）
- [x] electron.d.ts 类型声明

## LoRA 选择 UI
- [x] LoraSelectModal 组件创建
- [x] 网格布局预览卡片（预览图 + 模型名）
- [x] 搜索框（前端过滤，不区分大小写）
- [x] 分类筛选（Select 下拉，从 category 去重）
- [x] 多选功能（点击卡片切换选中）
- [x] 悬停 Tooltip 显示 JSON 元数据
- [x] 缺失预览图显示占位图
- [x] 缺失 JSON 显示「无额外说明」
- [x] 已选区域（标签 + 权重 Slider 0-1 步进 0.05 + 移除按钮）
- [x] 权重默认值 0.7
- [x] 预览图懒加载（loading="lazy"）
- [x] 列表缓存（Modal 关闭不重新请求）

## 生成流程集成
- [x] AssetGenerateModal 参数区新增 LoRA 入口（显示已选数量 + 打开 Modal）
- [x] AssetGenerateModal buildSdOptions() 透传 selectedLoras
- [x] ExpressionGenerateModal 同步集成 LoRA 入口
- [x] ExpressionGenerateModal buildSdOptions() 透传 selectedLoras
- [x] sdGenerationService SDGenerationOptions 新增 selectedLoras 字段
- [x] sdGenerationService 将 selectedLoras 转为 `<lora:name:weight>` 标签注入 prompt 前部
- [x] 无 LoRA 时不注入标签（行为不变）

## 持久化
- [x] SDWebuiSettings 表单包含 selectedLoras
- [x] getFormValues() 返回 selectedLoras
- [x] selectedLoras 持久化到配置文件

## 文档
- [x] CHANGELOG.md 新增条目
- [x] PROJECT_DOCUMENTATION_NEW.md 新增小节
- [x] CODE_WIKI.md 更新条目
