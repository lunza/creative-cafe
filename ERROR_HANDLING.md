# 错误处理文档

## 1. 常见错误类型

### 1.1 网络错误

**错误信息:** `网络错误: 无法连接到API服务器`

**原因:**
- API服务器未运行
- 网络连接问题
- API URL配置错误

**解决方案:**
- 确保API服务器已启动并运行
- 检查网络连接是否正常
- 验证API URL是否正确
- 检查防火墙设置

### 1.2 请求超时

**错误信息:** `请求超时`

**原因:**
- API服务器响应速度慢
- 网络延迟
- 超时设置过短

**解决方案:**
- 增加超时设置（默认为30秒）
- 检查API服务器性能
- 优化网络连接

### 1.3 响应错误

**错误信息:** `响应错误`

**原因:**
- API服务器配置问题
- 服务器内部错误
- 响应格式不正确

**解决方案:**
- 检查API服务器配置
- 查看服务器日志
- 验证API版本兼容性

### 1.4 HTTP 500错误

**错误信息:** `HTTP 500: Internal Server Error`

**原因:**
- API服务器内部错误
- 服务器代码异常
- 数据库连接问题

**解决方案:**
- 查看API服务器日志
- 检查服务器配置
- 联系API服务提供商

### 1.5 解析错误

**错误信息:** `解析响应失败`

**原因:**
- API返回的不是有效的JSON格式
- 响应格式与预期不符

**解决方案:**
- 检查API文档
- 验证API版本
- 联系API服务提供商

## 2. 日志系统

### 2.1 日志位置

日志文件存储在项目根目录的 `logs/` 文件夹中：
- `logs/ai-handler.log` - AI请求处理日志

### 2.2 日志内容

日志包含以下信息：
- 请求URL和方法
- 请求头和请求体
- 响应状态码
- 错误详情
- 异常堆栈信息

### 2.3 查看日志

使用以下命令查看日志：

```bash
# 查看最新的AI处理日志
tail -n 50 logs/ai-handler.log

# 实时查看日志
tail -f logs/ai-handler.log
```

## 3. 错误处理最佳实践

### 3.1 前端错误处理

1. **显示友好的错误信息**
   - 使用模态框显示详细错误信息
   - 提供错误类型和解决建议
   - 添加重试功能

2. **错误类型判断**
   - 网络错误：检查连接
   - 超时错误：增加超时设置
   - 服务器错误：查看服务器日志

3. **用户体验优化**
   - 添加加载状态
   - 提供清晰的错误提示
   - 避免系统崩溃

### 3.2 后端错误处理

1. **详细的错误日志**
   - 记录完整的请求和响应
   - 记录错误的详细信息
   - 记录异常堆栈

2. **错误分类**
   - 网络错误
   - 超时错误
   - 服务器错误
   - 解析错误

3. **跨平台兼容性**
   - 确保在macOS和Windows上都能正常工作
   - 统一错误处理逻辑
   - 确保日志文件路径正确

## 4. 故障排除步骤

### 4.1 基本故障排除

1. **检查API服务器状态**
   - 确认服务器是否运行
   - 验证服务器端口是否可访问
   - 测试服务器响应

2. **验证配置**
   - 检查API URL是否正确
   - 验证API密钥是否有效
   - 检查API模式设置

3. **网络检查**
   - 测试网络连接
   - 检查防火墙设置
   - 验证代理配置

### 4.2 高级故障排除

1. **查看详细日志**
   - 检查 `logs/ai-handler.log`
   - 分析错误详情
   - 查看异常堆栈

2. **API测试**
   - 使用Postman或curl测试API
   - 验证API响应格式
   - 检查API文档

3. **服务器检查**
   - 查看API服务器日志
   - 检查服务器资源使用
   - 验证服务器配置

## 5. 常见问题解决方案

### 5.1 AI生成失败

**问题:** 点击生成按钮后显示错误

**解决方案:**
1. 检查AI引擎配置是否正确
2. 验证API服务器是否运行
3. 查看 `logs/ai-handler.log` 获取详细错误信息
4. 根据错误类型采取相应措施

### 5.2 网络连接问题

**问题:** 无法连接到API服务器

**解决方案:**
1. 检查网络连接
2. 验证API URL是否正确
3. 确保API服务器已启动
4. 检查防火墙设置

### 5.3 请求超时

**问题:** 生成过程中显示超时错误

**解决方案:**
1. 增加超时设置
2. 检查API服务器响应速度
3. 优化网络连接
4. 考虑使用更强大的服务器

### 5.4 HTTP 500错误

**问题:** API服务器返回500错误

**解决方案:**
1. 查看API服务器日志
2. 检查服务器配置
3. 验证API版本兼容性
4. 联系API服务提供商

## 6. 错误代码参考

| 错误类型 | 错误代码 | 描述 | 解决方案 |
|---------|---------|------|----------|
| 网络错误 | network | 无法连接到API服务器 | 检查服务器状态和网络连接 |
| 超时错误 | timeout | 请求超过设定时间 | 增加超时设置，检查服务器响应速度 |
| 响应错误 | response | 服务器没有返回响应体 | 检查服务器配置，查看服务器日志 |
| 解析错误 | parse | 无法解析API响应 | 检查API版本，验证响应格式 |
| 未知错误 | unknown | 发生未知错误 | 查看详细日志，联系技术支持 |

## 7. 联系支持

如果您遇到无法解决的错误，请提供以下信息联系技术支持：

1. 完整的错误信息
2. `logs/ai-handler.log` 文件内容
3. AI引擎配置详情
4. 操作系统版本
5. 复现步骤

## 8. 总结

本错误处理文档提供了常见错误的解决方案和故障排除步骤，帮助您快速定位和解决AI生成功能中的问题。通过详细的错误信息、完善的日志系统和系统的故障排除流程，您可以更有效地解决遇到的问题，确保创意管理智能生成功能的正常运行。

## 9. 向量测试模块常见问题

### 9.1 【重点标记】WASM查询不返回metadata导致向量测试显示空结果

**问题描述:** 向量测试模块中，相似性查询和向量查看功能返回空结果或metadata为空对象

**根本原因:** vecstore-wasm模块的`query()`方法只返回`id`和`score`字段，不返回`metadata`字段，导致搜索结果中metadata始终为`null/undefined`

**解决方案:**
1. 实现元数据缓存机制（`metadataCache: Map<string, Record<string, any>>`）
2. 修改`search()`方法，从metadataCache中补全搜索结果的metadata
3. 修改`getById()`方法，从metadataCache中获取metadata
4. 在`add()`、`addBatchNoPersist()`中同步更新metadataCache
5. 在`delete()`、`deleteByPrefix()`、`clear()`中同步删除metadataCache条目
6. 实现双文件持久化机制（vecstore.json + vecstore_metadata.json）
7. 在`initialize()`时从文件加载metadata到cache

**修复文件:** `src/main/services/VecstoreVectorStore.ts`

### 9.2 向量维度不匹配错误

**问题描述:** `Vector dimension mismatch: expected 384, got 4096`

**根本原因:** 不同嵌入模型输出不同维度的向量（如OpenAI text-embedding-3-small输出1536维，Qwen模型可能输出4096维）

**解决方案:**
1. 实现动态维度支持，从配置文件读取维度
2. 自动检测：通过调用embedding API生成测试向量，获取实际维度
3. 模型推断：根据模型名称推断维度（维护模型-维度映射表）
4. 维度不匹配时清空旧数据，使用新维度重新初始化

### 9.3 元数据重启后丢失

**问题描述:** 应用重启后，向量数据仍然存在但metadata丢失，导致无法查看分片内容

**根本原因:** WASM模块的metadata可能不随向量数据一起持久化，或持久化格式不正确

**解决方案:**
1. 实现双文件持久化：vecstore.json（向量数据）+ vecstore_metadata.json（元数据）
2. 启动时从vecstore_metadata.json加载元数据到cache
3. 每次add/update操作同步更新metadataCache
4. 删除操作同步清理metadataCache

### 9.4 向量化后分片内容为空

**问题描述:** 文档向量化成功，但查看分片时内容显示为空

**根本原因:** `addBatchNoPersist()`方法未同步更新metadataCache，导致缓存中无元数据

**解决方案:**
1. 在`addBatchNoPersist()`中添加metadataCache更新逻辑
2. 确保metadata中的text字段正确传递和存储
3. 添加详细日志输出，便于调试

## 10. 世界书向量化常见问题

### 10.1 description字段不应向量化

**问题描述:** 世界书向量化时，description字段被错误地向量化为独立向量

**根本原因:** 原有实现将description作为独立向量处理，不符合世界书结构设计规范

**解决方案:**
1. 移除description字段的向量化逻辑
2. 将description作为元数据引用存储在条目元数据中（`worldBookDescription`字段）
3. 每个条目向量包含完整的条目字段信息（name、key、keysecondary、keys、secondary_keys、comment、content）

**修复文件:** `src/main/services/worldBookService.ts`

### 10.2 条目向量缺少完整字段信息

**问题描述:** 世界书条目向量化时，元数据中缺少关键字段（keysecondary、secondary_keys等）

**根本原因:** 原有实现只提取了部分字段（key、comment），未包含所有条目字段

**解决方案:**
1. 提取完整的条目字段：name、key、keysecondary、keys、secondary_keys、comment、content
2. 构建完整的元数据对象，包含所有关键字段
3. 合并key和keysecondary到entryKeys字段用于检索

### 10.3 JSON存储与VecStore存储差异

**问题描述:** 不清楚JSON存储和VecStore存储在数据结构上的差异

**说明:**
- **JSON存储**（JSONVectorStore）：数据存储为JSON文件，适合小型数据集（< 5000向量），支持批量操作
- **VecStore存储**（VecstoreVectorStore）：基于WASM实现，数据存储为二进制格式+元数据JSON，适合大型数据集（> 5000向量），需要元数据缓存机制

**最佳实践:**
1. 无论使用哪种存储模式，都遵循相同的向量添加接口
2. 元数据格式保持一致
3. 向量ID命名规范统一（`wb_entry_{worldBookName}_{uid}`）

### 10.4 【重点标记】世界书条目分片串行问题

**问题描述:** 世界书JSON文件上传后被错误地按500字符分割成多个分片，导致条目内容被截断，出现多个分片具有相同的comment但不同关键词的问题

**根本原因:** `DocumentProcessorService.chunkText()`方法对所有文件统一使用500字符分块逻辑，没有针对世界书JSON文件的特殊处理

**解决方案:**
1. 添加`json`文件类型支持到`DocumentFileType`和`SUPPORTED_EXTENSIONS`
2. 添加`extractJson()`方法用于JSON文件文本提取
3. 添加`isWorldBookFormat()`方法检测世界书JSON结构（检查`entries`字段）
4. 添加`chunkWorldBookEntries()`方法实现条目级别分块（每个条目一个完整分块，不分割）
5. 重命名原有逻辑为`chunkStandardText()`用于标准500字符分块
6. 重构`chunkText()`方法根据文件类型自动选择分块策略
7. 更新`processDocument()`传递文件类型给`chunkText()`

**分块策略:**
- **世界书JSON文件**：按条目分块，每个条目包含`## {comment/name}\n关键词：{keys}\n{content}`格式，保持完整性
- **其他文档**（PDF、DOCX、TXT等）：保持500字符分块标准，无变化

**修复文件:** `src/main/services/DocumentProcessorService.ts`

**验证要点:**
1. 世界书JSON上传后每个条目对应一个分片
2. 分片内容包含完整的条目字段（name、key、keysecondary、comment、content）
3. 其他文档上传后仍然按500字符正常分块
4. 通过知识库和测试页面两种路径上传都正确

## 11. OutlineEditor 编辑状态绑定问题

### 11.1 【重点标记】编辑章节时 Input/TextArea 值不响应状态更新

**问题描述:** 在 OutlineEditor 组件中编辑章节标题或摘要时，用户输入的内容无法正确显示在输入框中，修改不会反映到编辑界面

**根本原因:** 编辑模式下，Input 和 TextArea 的 `value` 属性直接绑定到 `chapter.title` 和 `chapter.summary`，这些值来自 `editedOutline.chapters.map()` 遍历时的闭包变量。由于 React 的渲染机制，`chapter` 变量引用的是上一次渲染时的数组元素，而不是最新的 `editedOutline` 状态值，导致 `handleChapterEdit` 虽然正确更新了状态，但输入框的值绑定没有读取到最新状态

**解决方案:**
1. 将 Input 的 value 从 `chapter.title` 改为 `editedOutline.chapters.find(c => c.index === chapter.index)?.title ?? chapter.title`
2. 将 TextArea 的 value 从 `chapter.summary` 改为 `editedOutline.chapters.find(c => c.index === chapter.index)?.summary ?? chapter.summary`
3. 确保直接从当前状态读取值，而不是依赖 map 迭代中的闭包变量

**修复文件:** `src/renderer/components/Creative/WritingMode/OutlineEditor.tsx`

**验证要点:**
1. 点击编辑按钮后，输入框正确显示当前章节标题和摘要
2. 修改标题或摘要时，输入框实时反映用户输入
3. 保存后状态正确更新并显示成功提示

## 12. 写作模式大纲保存问题

### 12.1 【重点标记】生成一章时无法保存大纲

**问题描述:** 在写作模式生成大纲时，如果用户选择生成一章（chapterCount=1），则无法保存大纲，提示"大纲中未定义章节"错误

**根本原因:** 当AI生成单章大纲时，可能返回 `chapters` 字段为单个对象而非数组（如 `"chapters": {...}` 而非 `"chapters": [{...}]`）。`validateOutline` 方法中的 `Array.isArray(data.chapters)` 检查会失败，导致抛出异常

**解决方案:**
1. 添加 `normalizeChapters` 方法，在JSON解析后、验证前将单个对象规范化为数组
2. 在 `parseOutlineResponse` 方法的两个解析路径中都调用该方法：
   - 直接解析成功路径
   - 修复策略成功路径
3. 确保无论AI返回对象还是数组，都能正确处理

**修复文件:** `src/main/services/writing/OutlineGenerator.ts`

**关键代码:**
```typescript
private normalizeChapters(data: any): void {
  if (data.chapters && !Array.isArray(data.chapters)) {
    console.log('[OutlineGenerator] chapters is not an array, wrapping in array');
    data.chapters = [data.chapters];
  }
}
```

**验证要点:**
1. 生成一章时能正常保存大纲
2. 生成多章时功能不受影响
3. AI返回对象或数组格式都能正确处理
