# 修复角色卡翻译功能temperature参数未配置错误

## Why
角色卡翻译功能调用AI时仍然报错"翻译失败: 未配置 temperature 参数"。根本原因是默认设置中temperature初始化为`undefined`，而`buildAIRequestOptions`函数在temperature为undefined时直接抛出错误，没有提供合理的默认值。

## What Changes
- 修改`characterAIUtils.ts`中的`buildAIRequestOptions`函数，当temperature未配置时使用合理的默认值（如0.7）
- 修改Settings组件的表单加载逻辑，当temperature为undefined时提供默认值
- 确保所有AI调用场景下temperature参数都能正确获取或使用默认值

## Impact
- Affected specs: 角色卡AI功能（翻译、润色、生成）
- Affected code: `src/renderer/utils/characterAIUtils.ts`, `src/renderer/components/Settings/Settings.tsx`

## MODIFIED Requirements

### 修改：buildAIRequestOptions 提供默认值

`buildAIRequestOptions`函数应在temperature参数未配置时使用合理的默认值（0.7），而不是直接抛出错误。

#### 场景：temperature参数有效
- **WHEN** AI引擎配置中包含有效的temperature值（0-2之间的数字）
- **THEN** 函数应使用该值

#### 场景：temperature参数未配置或无效
- **WHEN** AI引擎配置中temperature为undefined、null或不是有效数字
- **THEN** 函数应使用默认值0.7

### 修改：Settings表单加载默认值

Settings组件在加载引擎配置时，应为temperature和max_tokens等关键参数提供默认值，确保表单始终显示有效值。

#### 场景：表单加载引擎配置
- **WHEN** Settings组件加载引擎配置到表单
- **THEN** 如果temperature为undefined，应使用默认值0.7
- **THEN** 如果max_tokens为undefined，应使用默认值10240
