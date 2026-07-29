# 图片生成自定义尺寸选择功能实现计划

## Context（背景）

当前图片生成功能（txt2img 和 img2img）的输出尺寸由全局设置 `sdWebui.txt2imgWidth/txt2imgHeight`（默认 1024×1024）控制，用户无法在每次生成时灵活调整尺寸。img2img 路径更是完全从源图宽高比推导尺寸，用户无法控制输出大小。

用户需求：在所有图片生成界面添加尺寸选择组件（预设 + 自定义输入），上限 2048×2048，默认使用设置中的 1024×1024，每次生成独立应用（不写入全局设置）。

## 关键发现（后端已支持）

- `sdGenerationService.ts:1219-1220` — txt2img 读取 `options.txt2imgWidth/txt2imgHeight`
- `sdGenerationService.ts:965-966` — img2img 的 `calculateImg2ImgDimensions` 若 `options.width && options.height` 已设置则直接使用，绕过宽高比推导
- 即后端**已支持**用户指定尺寸，只需前端传递参数 + 后端微调两步模式缩放

## 实现方案

### 1. 新建 SizeSelector 组件

**文件**: `src/renderer/components/Character/CharacterDialogueChat/SizeSelector.tsx`

可复用的尺寸选择组件，暗色主题 inline styles（与 AssetGenerateModal/ExpressionGenerateModal 一致）。

**Props**:
```typescript
interface SizeSelectorProps {
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
}
```

**预设尺寸列表**（Select 下拉选项，每项显示 "WxH — 场景说明"）：

| 预设 | 尺寸 | 场景说明 |
|------|------|---------|
| 头像/表情 | 512×512 | 适合头像和表情图片 |
| 全身立绘 | 512×768 | 适合全身立绘场景 |
| 竖版高清 | 768×1024 | 适合高清立绘/半身像 |
| 方图高清 | 1024×1024 | 适合高质量方图（默认） |
| 竖版超清 | 1024×1536 | 适合超清全身立绘 |
| 横版高清 | 1536×1024 | 适合横构图/宽幅场景 |
| 自定义 | — | 手动输入宽度和高度 |

**交互逻辑**:
- Select 选择预设 → 直接调用 `onChange(w, h)`
- Select 选择"自定义" → 展示两个 InputNumber（宽/高），步进 64，范围 64-2048
- InputNumber 实时验证：超出 64-2048 显示红色边框 + 错误提示文案
- 选择变更即时生效（onChange 直接触发，无需确认按钮）

### 2. 修改 AssetGenerateModal.tsx

**文件**: `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx`

- **新增 state**: `const [selectedSize, setSelectedSize] = useState({ width: 1024, height: 1024 })`
- **初始化**: 在 init useEffect 中 `setSdConfig(config)` 后，`setSelectedSize({ width: config.txt2imgWidth ?? 1024, height: config.txt2imgHeight ?? 1024 })`
- **重置**: 在关闭重置 useEffect 中重置为默认 1024×1024
- **UI 渲染**: 新增 `renderSizeSelector()` 函数，在 `renderTraitsPanel()` 之后、`renderSdUnavailableAlert()` 之前渲染（所有模式均可见）
- **buildSdOptions 修改**: 
  - `txt2imgWidth: selectedSize.width`（原 `sdConfig.txt2imgWidth`）
  - `txt2imgHeight: selectedSize.height`（原 `sdConfig.txt2imgHeight`）
  - 新增 `width: selectedSize.width`（img2img 覆盖用）
  - 新增 `height: selectedSize.height`（img2img 覆盖用）
- **依赖数组**: `buildSdOptions` 的 useCallback deps 新增 `selectedSize`

### 3. 修改 ExpressionGenerateModal.tsx

**文件**: `src/renderer/components/Character/CharacterDialogueChat/ExpressionGenerateModal.tsx`

与 AssetGenerateModal 相同的改动模式：
- 新增 `selectedSize` state + 初始化 + 重置
- 新增 `renderSizeSelector()` 函数，在 `renderHeader()` 之后渲染
- `buildSdOptions` 同样替换 `txt2imgWidth/txt2imgHeight` + 新增 `width/height`
- batch 模式的参数概览区和 single 模式均可见 SizeSelector

### 4. 后端微调：两步模式缩放

**文件**: `src/main/services/sdGenerationService.ts`

修改 `calculateImg2ImgDimensions`（约 L960-985），当用户指定了 `options.width/height` 时，按 `longSideTarget` 比例缩放中间步骤：

```typescript
if (options.width && options.height) {
  // two-step 模式 pass 1 (longSideTarget=768) 按比例缩小，pass 2 (1024) 使用完整尺寸
  const REFERENCE_TARGET = 1024;
  const scale = longSideTarget / REFERENCE_TARGET;
  if (scale < 1) {
    return {
      width: Math.max(64, Math.round(options.width * scale)),
      height: Math.max(64, Math.round(options.height * scale)),
    };
  }
  return { width: options.width, height: options.height };
}
```

**原因**: two-step 模式的设计是 pass 1 低分辨率生成 → pass 2 高分辨率放大修复。若用户指定 1024×1024，pass 1 应在 768×768 生成（×0.75），pass 2 放大到 1024×1024，保留两步放大的质量优势。direct 模式（longSideTarget=1024）scale=1.0，不受影响。

### 5. 不修改的文件

- `setting.ts` / `settings.ts` — 全局默认值 1024×1024 保持不变，作为 SizeSelector 的初始值来源
- `SDWebuiSettings.tsx` — 设置面板中的 txt2imgWidth/Height 输入框保留，作为全局默认值配置入口
- `sdGenerationService.ts` 的 `SDGenerationOptions` 接口 — `width/height/txt2imgWidth/txt2imgHeight` 字段已存在，无需新增

## 预设尺寸设计依据

- 512×512 / 512×768: 用户明确要求，适合 SD 1.5 模型及小图快速生成
- 768×1024 / 1024×1024 / 1024×1536 / 1536×1024: SDXL 推荐分辨率区间（总像素量 ≈ 1024²），覆盖竖/方/横三种构图

## 验证方案

1. **TypeScript 编译**: `npx tsc --noEmit` 确认无新增错误
2. **功能测试**:
   - 打开 AssetGenerateModal → 确认 SizeSelector 显示在特征面板下方
   - 选择预设"全身立绘 512×768" → 确认参数概览 Tag 显示 512×768
   - 选择"自定义" → 输入 2049 → 确认显示错误提示
   - 输入 2048 → 确认无错误
   - 生成立绘（txt2img）→ 确认输出图片尺寸为所选尺寸
   - 生成表情（img2img）→ 确认输出图片尺寸为所选尺寸
   - 切换角色后重新打开弹窗 → 确认尺寸重置为默认 1024×1024
3. **ExpressionGenerateModal 同理测试 batch 和 single 模式**
