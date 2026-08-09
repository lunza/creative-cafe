# 扩展 ADetailer 检测模型：支持 Furry/拟人生物面部识别

## Context（背景）

**问题**：当前系统的图生图 YOLO 检测模型在识别人类面部时效果良好，但在识别动物和兽人等类人生物（furry/kemono/anthro）时表现不佳。原因是项目预设的 9 个检测模型（`face_yolov8n.pt` 等）全部针对人类面部训练，对兽人特有的吻部、长耳、毛发等结构识别率低。

**研究结论**：目前**没有公开的、专门为 furry/拟人生物面部识别训练的 ADetailer YOLO 模型**（学术界 Fursee 论文有相关研究但不公开 .pt 文件）。但存在 3 类可行方案：

1. **YOLO-World 开放词汇检测**（方案 A）：ADetailer-Neo 已预装 `yolov8x-worldv2.pt`，支持通过文本提示零样本检测任意对象（如 `furry face, anthro head`）。ADetailer-Neo 的 args 已支持 `ad_model_classes` 字段（从 [Haoming02/ADetailer-Neo issue #9](https://github.com/Haoming02/ADetailer-Neo/issues/9) 错误堆栈证实：`classes=args.ad_model_classes` 透传给 `ultralytics_predict`）。

2. **Anzhc Head+Hair 分割模型**（方案 B）：社区训练的头部+毛发分割模型 `Anzhc HeadHair seg y8m.pt`（mAP50=0.867），对兽人头部（含毛发/耳朵）覆盖比 face 检测更全。来源 [Anzhc/Anzhcs_YOLOs](https://huggingface.co/Anzhc/Anzhcs_YOLOs)。

3. **Anzhc Face 高精度插画模型**（方案 C）：`Anzhc Face seg 640 v4 y11n.pt`（mAP50=0.835，远超 `face_yolov8n.pt` 的 0.660），训练数据包含 illustration，对动漫风 kemono 面部精度更高。

**用户决策**：A + B + C 三个方案全部实施。

**预期结果**：用户在 SD WebUI 设置面板的「ADetailer 高级参数」中可选择 3 个新增检测模型；选择 YOLO-World 时额外显示「检测类别」输入框，可输入自定义文本提示检测 furry/兽人面部。

---

## 改动清单

### 1. 类型定义层 — `src/renderer/types/setting.ts`

在 `SDWebuiConfig` 接口的 `adModel` 字段后（约 L81）新增：

```ts
/**
 * ADetailer 检测类别（2026-08-07 新增，仅 YOLO-World 模型生效）。
 *
 * 【重点标记 - Furry/拟人生物面部识别扩展】
 * 源码位置：ADetailer-Neo args.py `ad_model_classes`。
 * 仅当 adModel 为 YOLO-World 系列（文件名含 "world"）时生效，
 * 透传给 ultralytics_predict 的 classes 参数实现零样本开放词汇检测。
 * 空字符串=使用模型默认 COCO 80 类；填入文本提示如
 * "furry face, anthro head, animal head, kemono face" 可检测任意类别。
 */
adModelClasses?: string;
```

### 2. 主进程类型 — `src/main/services/sdGenerationService.ts`

**2a.** `SDGenerateParams` 接口（L199 `adModel?: string;` 后）新增 `adModelClasses?: string;` + 同样的注释。

**2b.** adArgs 构建（L1202-1212 附近）条件透传 `ad_model_classes`：

```ts
const adArgs: Record<string, unknown> = {
  ad_model: adModel,
  ad_prompt: prompt,
  ad_negative_prompt: adNegativePromptValue,
  ad_confidence: adConfidence,
  // ... 现有字段
};

// 【重点标记 - YOLO-World 开放词汇检测（2026-08-07）】
// 仅当模型为 YOLO-World 系列（文件名含 "world"）且 adModelClasses 非空时透传。
// 非_world 模型传该字段会被 ADetailer-Neo 忽略，但显式条件避免混淆。
const isYoloWorldModel = adModel.toLowerCase().includes('world');
const adModelClassesValue = options.adModelClasses?.trim();
if (isYoloWorldModel && adModelClassesValue) {
  adArgs.ad_model_classes = adModelClassesValue;
}
```

### 3. 默认值同步（4 处 DEFAULT_CONFIG）

在以下 4 处 `adModel: 'face_yolov8n.pt',` 行后新增 `adModelClasses: '',`：

- `src/shared/settings.ts:216`（`defaultSetting.sdWebui`）
- `src/renderer/components/Settings/SDWebuiSettings.tsx:39`（`DEFAULT_SD_WEBUI_CONFIG`）
- `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx:140`（`DEFAULT_SD_CONFIG`）
- `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx:199`（`DEFAULT_SD_CONFIG`）

> 依据项目记忆铁律：「新增可选字段到持久化数据结构时，必须检查所有对象重构路径」。4 处 DEFAULT_CONFIG 必须同步，避免旧配置缺失字段时为 undefined。

### 4. 预设列表扩展 — `src/renderer/components/Settings/SDWebuiSettings.tsx:126-136`

`ADETAILER_MODEL_OPTIONS` 末尾新增 3 项（保留现有 9 项不变）：

```ts
const ADETAILER_MODEL_OPTIONS = [
  // ... 现有 9 项 ...
  // 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
  // 3 个新增模型，覆盖 furry/兽人/动物面部场景：
  // - yolov8x-worldv2.pt：YOLO-World 开放词汇，ADetailer-Neo 预装，配合 adModelClasses 字段检测任意类别
  // - Anzhc HeadHair seg y8m.pt：社区头部+毛发分割，对兽人头部覆盖更全（含耳朵/毛发）
  // - Anzhc Face seg 640 v4 y11n.pt：高精度插画人脸（mAP50=0.835，远超 face_yolov8n 的 0.660）
  { label: 'yolov8x-worldv2.pt（YOLO-World 开放词汇，furry/兽人，需配合下方「检测类别」）', value: 'yolov8x-worldv2.pt' },
  { label: 'Anzhc HeadHair seg y8m.pt（社区头部+毛发分割，兽人覆盖更全，需下载）', value: 'Anzhc HeadHair seg y8m.pt' },
  { label: 'Anzhc Face seg 640 v4 y11n.pt（高精度插画人脸，mAP 0.835，需下载）', value: 'Anzhc Face seg 640 v4 y11n.pt' },
];
```

同时更新常量上方注释（L117-124），补充 3 个新模型说明。

### 5. UI 条件渲染 — `src/renderer/components/Settings/SDWebuiSettings.tsx`

**5a.** 在组件顶部 `Form.useWatch` 区域（L195 附近）新增监听 adModel：

```ts
const adModelValue = Form.useWatch('adModel', form) ?? 'face_yolov8n.pt';
const isYoloWorldModel = (adModelValue as string).toLowerCase().includes('world');
```

**5b.** 在 adModel 的 Form.Item（L700-720）之后、adConfidence 的 Form.Item（L722）之前，插入条件渲染的 adModelClasses Form.Item + Anzhc 下载提示 Alert：

```tsx
{/* 【重点标记 - YOLO-World 检测类别（2026-08-07）】仅 YOLO-World 模型显示 */}
{isYoloWorldModel && (
  <Form.Item
    label={
      <Space>
        <span>检测类别（ad_model_classes）</span>
        <Tooltip title="仅 YOLO-World 模型生效。逗号分隔的文本提示，零样本检测任意对象。例如：furry face, anthro head, animal head, kemono face。留空则使用模型默认 COCO 80 类">
          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
        </Tooltip>
      </Space>
    }
    name="adModelClasses"
    tooltip="逗号分隔的检测类别文本提示，仅 YOLO-World 模型生效"
  >
    <Input.TextArea
      rows={2}
      placeholder="furry face, anthro head, animal head, kemono face（留空=使用默认 COCO 80 类）"
    />
  </Form.Item>
)}

{/* Anzhc 社区模型下载提示（仅当选择 Anzhc 模型时显示） */}
{(adModelValue as string).startsWith('Anzhc') && (
  <Alert
    type="warning"
    showIcon
    style={{ marginBottom: 16 }}
    message="此模型需手动下载"
    description={
      <div style={{ fontSize: 12 }}>
        从 HuggingFace 下载：<a href="https://huggingface.co/Anzhc/Anzhcs_YOLOs" target="_blank" rel="noopener noreferrer">Anzhc/Anzhcs_YOLOs</a>
        <br />
        下载后放入 SD WebUI 的 <code>models/adetailer/</code> 目录，文件名必须与上方完全一致。
      </div>
    }
  />
)}
```

### 6. Modal 参数透传（2 处）

`ExpressionGenerateModal.tsx:505` 和 `AssetGenerateModal.tsx:1016` 的参数构建处，在 `adModel: sdConfig.adModel,` 后新增 `adModelClasses: sdConfig.adModelClasses,`。

> 这两个 Modal 不需要独立的 ADetailer 模型选择 UI（它们复用全局 sdConfig），只需透传字段。

### 7. 文档增量更新（user_rules 要求）

**7a.** `CODE_WIKI.md` — 在 ADetailer 相关章节（§4.4 服务表 / §9 store 表 / §10 类型表）补一行：新增 `adModelClasses` 字段 + 3 个检测模型预设，指向 FIX_RECORDS.md §7.18。

**7b.** `docs/FIX_RECORDS.md` — 新增 §7.18「Furry/拟人生物面部识别 ADetailer 模型扩展（2026-08-07）」，记录：
- 研究结论：无公开 furry 专用 YOLO 模型
- 3 个方案的选型理由
- ADetailer-Neo 已预装 yolov8x-worldv2.pt + args 已支持 ad_model_classes 的源码证据
- 全链路改动文件清单

---

## 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| adModelClasses 字段可选性 | `?: string`（可选，默认空） | 避免影响现有 face/hand/person 模型；空=使用模型默认类 |
| YOLO-World 识别逻辑 | `adModel.toLowerCase().includes('world')` | 简单可靠，覆盖 yolov8x-worldv2.pt / yolov8s-world.pt 等所有变体 |
| ad_model_classes 透传条件 | 仅_world 模型 + 非空时透传 | 避免对非_world 模型传递无效字段（虽然 ADetailer-Neo 会忽略） |
| Anzhc 模型下载提示 | 选择 Anzhc 模型时显示 Alert | 用户需手动下载，必须显式提示路径 + 链接 |
| 预设类别建议 | placeholder 给出 `furry face, anthro head, animal head, kemono face` | 通用 furry 检测类别，覆盖大部分场景 |

---

## 验证方案

### 1. 类型检查
```powershell
cd g:\AI\creative-cafe; npx tsc --noEmit
```
确认无 TS 编译错误（重点检查 SDWebuiConfig 新字段在 4 处 DEFAULT_CONFIG + 2 处 Modal 透传 + sdGenerationService 均同步）。

### 2. UI 验证（手动）
- 启动应用 → 设置 → SD WebUI 设置 → ADetailer 高级参数
- 检测模型下拉应有 12 个选项（原 9 + 新增 3）
- 选择 `yolov8x-worldv2.pt` → 下方出现「检测类别」TextArea
- 选择 `Anzhc HeadHair seg y8m.pt` → 下方出现下载提示 Alert
- 选择 `face_yolov8n.pt` → 两者都不显示

### 3. 集成验证（需 SD WebUI 运行）
- 选择 `yolov8x-worldv2.pt` + 检测类别填 `furry face, anthro head`
- 生成一张兽人角色图片，查看 ADetailer 是否正确检测面部
- 检查 `logs/sdGeneration/` 日志确认 `ad_model_classes` 字段已透传

### 4. 文档一致性
- 确认 CODE_WIKI.md 对应章节已更新
- 确认 docs/FIX_RECORDS.md §7.18 已添加

---

## 风险与注意事项

1. **ADetailer-Neo `extra="forbid"` 约束**：`ad_model_classes` 必须是 `ADetailerArgs` 的合法字段。已从 [issue #9 堆栈](https://github.com/Haoming02/ADetailer-Neo/issues/9) 证实 `args.ad_model_classes` 被访问且透传给 `ultralytics_predict(classes=...)`，属于合法字段。

2. **Anzhc 模型未下载时的行为**：若用户选择 Anzhc 模型但未下载，ADetailer-Neo 会报「模型未找到」错误。下载提示 Alert 已显式引导，错误信息也会指向 `models/adetailer/` 目录。

3. **YOLO-World 检测精度**：零样本检测精度可能不如专门训练的模型。用户可通过调整 `ad_confidence`（默认 0.3，可降至 0.2）提升召回率。

4. **CRLF 文件编辑风险**：根据项目记忆，Windows 下 Edit 工具对 CRLF 文件的多行块匹配可能静默失败。Edit 后需立即 Read 验证。
