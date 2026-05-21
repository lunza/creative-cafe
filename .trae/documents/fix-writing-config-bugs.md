# 修复创作配置表单 Bug 计划

## Bug 描述

1. **结束章节提示"结束章节不能小于起始章节"**：连载模式下，结束章节字段显示校验错误提示
2. **结束章节永远是 10**：修改章节数量后，结束章节不跟随更新，且手动修改后会重置为默认值
3. **AI 生成完毕后无法编辑 JSON**：生成完成后 TextArea 为 readOnly，用户无法修改后再保存
4. **按钮功能重复**：WritingConfigModal 中存在两组按钮（"生成大纲"和"开始创作"）

## 根因分析

### Bug 1 & 2 根因
`chapterRangeEnd` 的 `initialValue={chapterCount}` 在 Form.Item 动态挂载时捕获了当时的章节数量值（默认 10）。由于 `shouldUpdate` 只监听 `includeEnding` 变化，当用户修改 `chapterCount` 后，Form.Item 不会重新渲染，导致 `initialValue` 不会更新。同时，动态 Form.Item 挂载时字段的初始值可能未正确设置，触发校验器提前报错。

### Bug 3 根因
生成完成后 `pendingRawJson` 存在，TextArea 的 `readOnly` 属性阻止了用户编辑。

### Bug 4 根因
WritingConfigModal 中存在两组按钮：
- Form 内部的按钮组（line 719-753）：包含"保存配置"、"手动创建大纲"、"重新生成"、"保存大纲"
- Modal 底部的按钮组（line 801-807）：包含"取消"、"手动创建大纲"、"开始创作"
两组按钮功能重叠，造成混淆。

## 修复方案

### Bug 1 & 2：章节范围选择器修复

**涉及文件**：
- `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx`
- `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx`

**修复步骤**：

1. 将 `shouldUpdate` 条件扩展为同时监听 `includeEnding` 和 `chapterCount` 变化：
   ```tsx
   shouldUpdate={(prevValues, currentValues) =>
     prevValues.includeEnding !== currentValues.includeEnding ||
     prevValues.chapterCount !== currentValues.chapterCount
   }
   ```

2. 移除 `chapterRangeEnd` 和 `chapterRangeStart` 的 `initialValue` 属性，改用 `useEffect` 在 `includeEnding` 变为 `false` 时设置默认值：
   ```tsx
   useEffect(() => {
     if (form.getFieldValue('includeEnding') === false) {
       form.setFieldsValue({
         chapterRangeStart: 1,
         chapterRangeEnd: form.getFieldValue('chapterCount') || DEFAULT_WRITING_CONFIG.chapterCount
       });
     }
   }, [/* 仅在 includeEnding 变化时触发 */]);
   ```

3. 当 `chapterCount` 变化且处于连载模式时，同步更新 `chapterRangeEnd` 的最大值（使用 `max` 属性动态控制，不改变用户已输入的值）

4. 在 `chapterRangeEnd` 和 `chapterRangeStart` 的 validator 中，增加对 `undefined` 值的处理，避免空值触发校验错误

### Bug 3：AI 生成完毕后可编辑 JSON

**涉及文件**：
- `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx`

**修复步骤**：

1. 添加 `editableJson` 状态，在生成完成后初始化为 AI 返回的原始 JSON
2. 将生成完成后的 TextArea 从 `readOnly` 改为可编辑，绑定到 `editableJson` 状态
3. 用户编辑后，点击"保存大纲"按钮时解析编辑后的 JSON
4. 如果 JSON 解析失败，显示错误提示但不阻止保存

### Bug 4：移除重复按钮

**涉及文件**：
- `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx`

**修复步骤**：

1. 删除 Modal 底部重复的按钮组（line 801-807）
2. 保留 Form 内部的按钮组，确保包含所有必要操作：
   - "取消"按钮
   - "加载配置"按钮
   - "保存配置"按钮
   - 生成阶段：显示"手动创建大纲"和"生成大纲"
   - 生成完成阶段：显示"重新生成"和"保存大纲"

## 影响范围

- 仅影响创作配置表单 UI 和交互逻辑
- 不涉及类型定义、后端服务、IPC 处理的变更
