# 修复角色卡AI功能中temperature参数读取失败问题

## Why
角色卡的翻译、润色、生成功能在调用远程AI服务器时，未能正确读取AI引擎配置中的temperature参数。根本原因是`characterAIUtils.ts`文件导入了一个不存在的`AIEngine`类型，导致TypeScript在编译时将类型解析为`unknown`，从而无法正确访问`engine.temperature`属性。

## What Changes
- 在共享类型文件中添加`AIEngine`类型别名，指向现有的`AIEngineSetting`类型
- 确保`characterAIUtils.ts`中的类型引用正确，使temperature参数能被正确读取和验证
- 验证修复后temperature参数能正确传递到AI请求中

## Impact
- Affected specs: 角色卡AI功能（翻译、润色、生成）
- Affected code: `src/renderer/utils/characterAIUtils.ts`, `src/renderer/types/setting.ts`

## MODIFIED Requirements

### 修改：添加AIEngine类型别名

在`src/renderer/types/setting.ts`中添加`AIEngine`类型导出，使其作为`AIEngineSetting`的别名，以便`characterAIUtils.ts`能够正确导入和使用。

#### 场景：修复类型导入

- **WHEN** `characterAIUtils.ts`导入`AIEngine`类型
- **THEN** 类型应正确解析为`AIEngineSetting`，使`engine.temperature`等属性能够被正确访问

### 修改：验证temperature参数读取

确保`buildAIRequestOptions`函数中的temperature验证逻辑能够正常工作，当temperature参数有效时正确读取，无效时抛出清晰的错误信息。

#### 场景：temperature参数有效

- **WHEN** AI引擎配置中包含有效的temperature值（0-2之间的数字）
- **THEN** `buildAIRequestOptions`应正确读取该值并用于AI请求

#### 场景：temperature参数无效

- **WHEN** AI引擎配置中temperature参数不存在或不是有效数字
- **THEN** 函数应抛出清晰的错误信息："未配置 temperature 参数"
