# Checklist

## tableEdit命令解析器
- [x] insertRow命令能正确解析表格索引、行索引和字段数据
- [x] updateRow命令能正确解析表格索引、行索引和更新字段
- [x] deleteRow命令能正确解析表格索引和行索引
- [x] 多命令组合能按顺序正确解析和执行
- [x] 格式错误的命令能被正确捕获并记录日志
- [x] 解析器能处理<tableEdit>标签内的HTML注释格式

## 逐条聊天记录处理
- [x] 系统能按时间顺序遍历所有user和assistant消息
- [x] 每条消息处理时携带上一条处理后的表格数据作为上下文
- [x] 处理进度能实时反馈给UI显示
- [x] 单条消息处理失败不影响后续消息处理
- [x] 系统消息(system)被正确过滤不参与处理

## 表格数据上下文构建
- [x] buildTableContext方法能正确格式化表格数据
- [x] 上下文包含表格名称、表头、数据行数和具体内容
- [x] 上下文格式清晰,便于AI理解和使用

## AI提示词模板
- [x] 提示词包含tableEdit命令的完整语法说明
- [x] 提示词包含insertRow/updateRow/deleteRow命令示例
- [x] AI能正确返回tableEdit命令格式的响应
- [x] 保留JSON格式作为备选方案

## 表格模板复制
- [x] 用户点击新增模板能从系统模板正确复制
- [x] 复制的模板名称自动处理冲突(添加后缀)
- [x] 复制的模板包含系统模板的所有页签和字段
- [x] 每个表格自动包含流水号和唯一id字段
- [x] 复制的模板保存到templates目录

## 表格数据存储
- [x] 数据存储支持基于表格索引的insert/update/delete操作
- [x] getTableByIndex方法能正确获取指定索引的表格
- [x] updateTableByIndex方法能正确更新指定索引的表格
- [x] createTableFile创建的JSON文件结构支持索引操作

## IPC接口和UI
- [x] processChatProgressive IPC接口支持逐条处理并返回进度
- [x] copyTemplate IPC接口支持模板复制操作
- [x] ChatManager UI能显示处理进度百分比和当前状态
- [x] 模板管理支持新增模板复制功能

## 错误处理和日志
- [x] tableEdit命令解析错误有详细日志记录
- [x] AI API调用失败有重试机制
- [x] 处理过程中的关键步骤都有日志输出
- [x] 错误不会导致整个处理流程中断
