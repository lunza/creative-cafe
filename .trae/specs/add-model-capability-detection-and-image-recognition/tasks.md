# Tasks

## 阶段一：类型定义与基础设施

- [x] Task 1: 扩展 AIEngineCapabilities 接口与 ChatMessage 类型
  - [x] SubTask 1.1: 在 `src/renderer/types/setting.ts` 的 `AIEngineCapabilities` 接口新增字段
  - [x] SubTask 1.2: 在 `src/renderer/components/Common/ChatEngine/ChatEngine.types.ts` 的 `EngineCapabilities` 接口同步新增相同字段
  - [x] SubTask 1.3: 在 `src/main/services/AIService.ts` 的 `ChatMessage` 接口扩展 content 字段为联合类型
  - [x] SubTask 1.4: 更新 `src/shared/settings.ts` 默认引擎 capabilities 新增三个字段默认 false
  - [x] SubTask 1.5: 更新 `getDefaultEngineCapabilities` 函数，为新字段返回默认 false

## 阶段二：模型能力检测

- [x] Task 2: 实现模型能力检测逻辑
  - [x] SubTask 2.1: `probeVisionCapability` — 发送含 1x1 透明 PNG 的多模态请求
  - [x] SubTask 2.2: `probeThinkingCapability` — 检查模型名关键词（thinking/reasoning/r1/o1/o3/qwq）
  - [x] SubTask 2.3: `probeToolCallingCapability` — 发送含 tools 参数请求
  - [x] SubTask 2.4: `probeAllCapabilities` — 并行执行三个探测，合并结果

- [x] Task 3: 新增能力检测 IPC 通道
  - [x] SubTask 3.1: `ai:probeCapabilities` 通道注册
  - [x] SubTask 3.2: preload 暴露 `ai.probeCapabilities`
  - [x] SubTask 3.3: electron.d.ts 类型声明

## 阶段三：连通性测试扩展

- [x] Task 4: 扩展连通性测试集成能力检测
  - [x] SubTask 4.1: `TestResult` 接口新增 `capabilities?` 字段
  - [x] SubTask 4.2: 文本测试通过后调用 `ai.probeCapabilities()` 获取能力
  - [x] SubTask 4.3: 测试结果 UI 显示能力标识
  - [x] SubTask 4.4: 保存引擎配置时写入 capabilities

## 阶段四：能力标识 UI

- [x] Task 5: 在 AI 引擎管理界面显示能力标识
  - [x] SubTask 5.1: `renderCapabilityBadges` 函数（4 个图标 Tag）
  - [x] SubTask 5.2: 引擎选择下拉中显示能力标识
  - [x] SubTask 5.3: 引擎管理 Modal 列表项中显示能力标识

## 阶段五：图片识别特征提取

- [x] Task 6: 实现图片识别特征提取服务
  - [x] SubTask 6.1: `recognizeImageTraits` 方法（读取 PNG + 多模态请求 + 解析标签）
  - [x] SubTask 6.2: `ai:recognizeImageTraits` IPC 通道注册
  - [x] SubTask 6.3: preload 暴露 `recognizeImageTraits`
  - [x] SubTask 6.4: electron.d.ts 类型声明

- [x] Task 7: 在素材与特征管理 UI 中集成图片识别
  - [x] SubTask 7.1: 「AI 图片识别」按钮（EyeOutlined 图标）
  - [x] SubTask 7.2: 仅 supportsVision=true 时显示按钮，否则显示「图片识别不可用」提示
  - [x] SubTask 7.3: 点击调用 `recognizeImageTraits`
  - [x] SubTask 7.4: loading 状态
  - [x] SubTask 7.5: 识别成功后追加到 characterTraits（去重）
  - [x] SubTask 7.6: 识别失败时不修改现有标签
  - [x] SubTask 7.7: 模型不支持视觉时显示提示

## 阶段六：验证与文档

- [x] Task 8: 验证
  - [x] SubTask 8.1: TypeScript 编译检查（npx tsc --noEmit）— 无新增错误
  - [x] SubTask 8.2: AIEngineCapabilities 新字段定义正确
  - [x] SubTask 8.3: ChatMessage 多模态 content 类型正确
  - [x] SubTask 8.4: 能力检测三个探测方法实现正确
  - [x] SubTask 8.5: 连通性测试扩展后保留原有文本测试逻辑
  - [x] SubTask 8.6: 能力标识在引擎列表和下拉中正确显示
  - [x] SubTask 8.7: 图片识别 IPC 通道 + preload + 类型声明完整
  - [x] SubTask 8.8: AssetGenerateModal 图片识别按钮条件显示 + 识别结果追加逻辑

- [x] Task 9: 更新技术文档
  - [x] SubTask 9.1: CHANGELOG.md 新增条目
  - [x] SubTask 9.2: PROJECT_DOCUMENTATION_NEW.md 新增 §7.3.5 小节
  - [x] SubTask 9.3: CODE_WIKI.md 更新条目

# Task Dependencies
- Task 2（能力检测逻辑）依赖 Task 1（类型定义）
- Task 3（IPC 通道）依赖 Task 2（检测逻辑）
- Task 4（连通性测试扩展）依赖 Task 3（IPC 通道）
- Task 5（能力标识 UI）依赖 Task 1（类型定义），可与 Task 2/3/4 并行
- Task 6（图片识别服务）依赖 Task 1（ChatMessage 多模态类型）
- Task 7（UI 集成）依赖 Task 6（图片识别服务）+ Task 5（能力标识）
- Task 8（验证）依赖 Task 1-7 全部完成
- Task 9（文档）依赖 Task 8 验证通过
