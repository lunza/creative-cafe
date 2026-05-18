# 表格整理功能实现 Spec

## Why
当前系统已具备基础的表格模板管理和聊天记录处理功能,但表格整理流程较为简单,缺乏逐条消息的精细处理能力,无法充分利用AI的上下文理解优势。需要实现一个基于AI的精细化表格整理系统,通过逐条处理聊天记录并累积表格数据作为上下文,提高信息提取的准确性和连贯性。

## What Changes
- 新增逐条聊天记录处理模块,支持顺序遍历user和assistant消息
- 实现tableEdit命令解析器,解析AI返回的HTML注释格式命令
- 新增表格数据上下文构建模块,将处理完成的表格数据提供给AI作为上下文
- 增强AI提示词模板,支持tableEdit命令格式输出
- 优化表格数据存储结构,支持表格索引和多表格管理
- 新增表格整理进度追踪和错误处理机制

## Impact
- Affected specs: 记忆增强插件、表格模板管理、聊天记录处理
- Affected code: 
  - `src/main/services/memory/chatLogService.ts` - 核心处理逻辑
  - `src/main/services/memory/tableTemplateService.ts` - 模板和数据管理
  - `src/main/ipc/handlers/memoryHandlers.ts` - IPC接口
  - `src/renderer/components/MemoryChat/ChatManager.tsx` - UI交互

## ADDED Requirements

### Requirement: 逐条聊天记录处理
系统 SHALL 支持按顺序逐条遍历和处理聊天记录中的user和assistant消息。

#### Scenario: 逐条处理成功
- **WHEN** 用户启动表格整理功能并选择要处理的聊天记录
- **THEN** 系统按时间顺序遍历所有user和assistant消息,逐条发送给AI处理
- **THEN** 每次处理时携带当前消息内容和上一条消息处理完成后的表格数据

#### Scenario: 处理进度追踪
- **WHEN** 表格整理功能运行中
- **THEN** 系统实时向用户显示当前处理进度(当前处理的消息编号/总消息数)

### Requirement: tableEdit命令解析器
系统 SHALL 实现tableEdit命令解析器,能够准确解析AI返回的HTML注释格式命令。

#### Scenario: 解析insertRow命令
- **WHEN** AI返回 `<!-- insertRow(0, {"0":"十月","1":"冬天/下雪","2":"学校","3":"<user>/悠悠"}) -->`
- **THEN** 系统在第1个表格(索引0)的新行中插入数据:字段0="十月",字段1="冬天/下雪",字段2="学校",字段3="<user>/悠悠"

#### Scenario: 解析updateRow命令
- **WHEN** AI返回 `<!-- updateRow(4, 1, {0: "小花", 1: "破坏表白失败", 2: "10月", 3: "学校", 4: "愤怒"}) -->`
- **THEN** 系统修改第5个表格(索引4)的第2条数据(索引1),更新所有字段

#### Scenario: 解析deleteRow命令
- **WHEN** AI返回 `<!-- deleteRow(1, 2) -->`
- **THEN** 系统删除第2个表格(索引1)的第3条数据(索引2)

#### Scenario: 解析多命令组合
- **WHEN** AI返回包含多个tableEdit命令的响应
- **THEN** 系统按顺序依次解析并执行所有命令

#### Scenario: 处理格式错误命令
- **WHEN** AI返回的命令格式不正确或参数错误
- **THEN** 系统记录错误日志,跳过该命令,继续处理后续命令

### Requirement: 表格数据上下文构建
系统 SHALL 将处理完成的表格数据格式化为AI可读的上下文格式。

#### Scenario: 构建上下文
- **WHEN** 处理下一条聊天记录时
- **THEN** 系统将当前所有表格的数据按模板结构格式化后发送给AI
- **THEN** 上下文包含每个表格的名称、表头、当前数据行数和数据内容

### Requirement: 表格模板复制功能
系统 SHALL 支持从系统模板复制创建用户模板,复制后的模板包含流水号和唯一id字段。

#### Scenario: 复制系统模板
- **WHEN** 用户点击"新增模板"按钮
- **THEN** 系统将系统模板复制一份到templates目录
- **THEN** 复制的模板名称不能与现有模板重复(自动添加后缀区分)
- **THEN** 复制的模板包含系统模板的所有页签和字段
- **THEN** 每个表格自动包含"流水号"和"唯一id"字段

### Requirement: 表格数据与AI上下文集成
系统 SHALL 将表格数据集成到AI对话上下文中,增强AI的长期记忆能力。

#### Scenario: 对话时获取表格上下文
- **WHEN** 用户与AI进行对话
- **THEN** 系统将当前聊天会话关联的表格数据作为上下文提供给AI
- **THEN** AI能够基于表格数据进行连贯的对话

## MODIFIED Requirements

### Requirement: 现有processChat方法
**修改原因**: 现有方法一次性处理所有消息,需要改为逐条处理以提升准确性

```
修改 processChat 方法:
- 改为逐条遍历消息,每次调用AI时携带当前消息+上一条处理后的表格数据
- 支持tableEdit命令格式的AI响应解析
- 添加进度回调机制,支持UI实时显示处理进度
- 增强错误处理,单条消息处理失败不影响后续处理
```

### Requirement: 现有buildAIPrompt方法
**修改原因**: 需要修改提示词以支持tableEdit命令格式输出

```
修改 buildAIPrompt 方法:
- 更新提示词模板,要求AI返回tableEdit命令格式
- 添加tableEdit命令语法说明
- 优化示例输出,展示命令格式
- 保留现有JSON格式作为备选方案
```

### Requirement: 现有表格数据存储
**修改原因**: 需要支持基于表格索引的insert/update/delete操作

```
修改表格数据存储结构:
- 数据存储中增加表格索引映射关系
- updateRow和deleteRow操作需要基于表格索引定位
- insertRow操作需要指定表格索引
```

## REMOVED Requirements

### Requirement: 一次性批量处理模式
**Reason**: 逐条处理模式更精确,能更好地利用上下文信息
**Migration**: 保留现有批量处理作为快速处理选项,用户可根据需求选择处理模式
