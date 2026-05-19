# Tasks

- [x] Task 1: 新建世界书AI生成模态框 - WorldBookGenerateModal
  - [x] SubTask 1.1: 创建 `src/renderer/components/WorldBook/WorldBookGenerateModal.tsx` 组件
  - [x] SubTask 1.2: 实现角色卡多选面板（Checkbox.Group，加载 `window.electronAPI.character.list()`）
  - [x] SubTask 1.3: 实现"AI生成"按钮，构建prompt并调用AI服务（复用 `sendCharacterAIRequest` 模式）
  - [x] SubTask 1.4: Prompt构建：将所选角色卡的 name/description/personality/scenario 等信息作为上下文，要求AI生成世界书（名称+简介+条目列表JSON）
  - [x] SubTask 1.5: 解析AI返回的JSON，转换为世界书标准格式（使用 `createDefaultEntry` 兼容结构）
  - [x] SubTask 1.6: 生成预览区域展示，支持编辑条目和手动添加条目
  - [x] SubTask 1.7: 保存按钮调用 `onCreateWorldBook` 完成创建

- [x] Task 2: 新建角色卡AI生成模态框 - CharacterCardGenerateModal
  - [x] SubTask 2.1: 创建 `src/renderer/components/Character/CharacterCardGenerateModal.tsx` 组件
  - [x] SubTask 2.2: 实现世界书多选面板（Checkbox.Group，加载 `window.electronAPI.worldBook.list()`）
  - [x] SubTask 2.3: 实现角色卡生成参数配置表单（角色定位、性格特征、能力设定、外观描述、关系描述，均为可选）
  - [x] SubTask 2.4: 实现"AI生成"按钮，构建prompt并调用AI服务
  - [x] SubTask 2.5: Prompt构建：将所选世界书的核心条目信息+用户参数作为上下文，要求AI生成角色卡（name/description/personality/scenario/first_mes/mes_example等）
  - [x] SubTask 2.6: 解析AI返回的JSON，转换为角色卡标准格式
  - [x] SubTask 2.7: 生成预览区域展示，支持编辑各字段
  - [x] SubTask 2.8: 保存按钮调用 `onCreateCharacterCard` 完成创建

- [x] Task 3: 在世界书管理器中集成AI生成入口
  - [x] SubTask 3.1: 在 `WorldBookManager.tsx` 的"新建世界书"按钮旁新增"AI生成世界书"按钮
  - [x] SubTask 3.2: 新增 `isGenerateModalOpen` 状态控制 `WorldBookGenerateModal` 的显示
  - [x] SubTask 3.3: 实现 `handleCreateFromAI` 回调，接收生成结果并调用 `window.electronAPI.worldBook.write`

- [x] Task 4: 在角色卡管理器中集成AI生成入口
  - [x] SubTask 4.1: 在 `CharacterManager.tsx` 的新建按钮旁新增"AI生成"按钮
  - [x] SubTask 4.2: 新增 `isCharacterGenerateModalOpen` 状态控制 `CharacterCardGenerateModal` 的显示
  - [x] SubTask 4.3: 实现 `handleCreateCharacterFromAI` 回调，接收生成结果并调用现有的角色卡创建逻辑

- [x] Task 5: 更新技术文档
  - [x] SubTask 5.1: 在 `.trae/documents/技术文档.md` 中记录新功能实现

# Task Dependencies
- Task 3 depends on Task 1 (WorldBookGenerateModal需要先创建)
- Task 4 depends on Task 2 (CharacterCardGenerateModal需要先创建)
- Task 1 and Task 2 can be done in parallel (no dependencies between them)
- Task 3 and Task 4 can be done in parallel (no dependencies between them)
