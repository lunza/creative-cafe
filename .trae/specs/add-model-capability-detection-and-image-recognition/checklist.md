# Checklist

## 类型定义
- [x] `AIEngineCapabilities` 新增 `supportsVision?`、`supportsThinking?`、`supportsToolCalling?` 字段（setting.ts + ChatEngine.types.ts）
- [x] `ChatMessage.content` 扩展为联合类型支持多模态 content 数组（AIService.ts）
- [x] 默认引擎 capabilities 新增三个字段默认 false（settings.ts）
- [x] `getDefaultEngineCapabilities` 返回新字段默认 false（ChatEngine.types.ts）

## 模型能力检测
- [x] `probeVisionCapability` 发送含 image_url 的多模态探测请求，200+非 error → true
- [x] `probeThinkingCapability` 检查模型名关键词（thinking/reasoning/r1/o1/o3/qwq）
- [x] `probeToolCallingCapability` 发送含 tools 参数请求，200+非 error → true
- [x] `probeAllCapabilities` 并行执行三个探测，合并结果，单个失败不影响其他
- [x] `ai:probeCapabilities` IPC 通道注册 + preload 暴露 + electron.d.ts 类型声明

## 连通性测试扩展
- [x] `TestResult` 接口新增 `capabilities?` 字段（Task 5.4 前置类型准备，2026-07-28）
- [x] 文本测试通过后自动调用 `ai.probeCapabilities()` 获取能力
- [x] 测试结果 UI 显示能力标识（Task 5.4，2026-07-28；UI 完成，await Task 4.2 数据接入）
- [x] 保存引擎配置时写入 capabilities
- [x] 原有文本测试逻辑不受影响

## 能力标识 UI
- [x] 编辑图标（EditOutlined）始终显示
- [x] 眼睛图标（EyeOutlined）仅 supportsVision=true 时显示
- [x] 思考图标（BulbOutlined）仅 supportsThinking=true 时显示
- [x] 扳手图标（ToolOutlined）仅 supportsToolCalling=true 时显示
- [x] 引擎选择下拉中显示能力标识
- [x] 引擎管理 Modal 列表项中显示能力标识
- [x] （额外）连通性测试结果区显示能力标识（Task 5.4）

## 图片识别特征提取
- [x] `recognizeImageTraits` 方法读取角色卡 PNG 为 base64 + 构建多模态请求
- [x] system prompt 指示提取视觉特征为英文 SD tag
- [x] 响应解析：逗号/换行分割 + trim + 去序号 + 去重保序
- [x] `ai:recognizeImageTraits` IPC 通道注册 + preload 暴露 + electron.d.ts 类型声明
- [x] AssetGenerateModal 新增「AI 图片识别」按钮
- [x] 仅 supportsVision=true 时显示按钮
- [x] 识别中显示 loading 状态
- [x] 识别成功后追加到 characterTraits（去重）
- [x] 识别失败时不修改现有标签
- [x] 模型不支持视觉时显示提示

## 文档
- [x] CHANGELOG.md 新增条目
- [x] PROJECT_DOCUMENTATION_NEW.md 新增小节
- [x] CODE_WIKI.md 更新条目
