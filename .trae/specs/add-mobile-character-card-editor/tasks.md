# Tasks

- [x] Task 1: 服务端写端点（lanApiServer）
  - [x] 1.1 新增 `characterWrite.ts`：封装 updateCard（白名单字段校验 + characterService.write 双 spec 写回）、replaceAvatar（base64→Buffer→PNG 校验→createFromImage 语义）、createCard（载体图+字段）、deleteCard（对齐 character:delete）、worldbook relations 读写（getWorldBookRelations/setWorldBookRelations）、worldbooks 清单（扫描世界书目录）
  - [x] 1.2 `server.ts` 注册路由：PUT/POST/DELETE /api/characters... + GET /api/worldbooks；错误统一 `{error:{code,message}}`；:id 白名单校验复用现有机制；请求体大小上限（头像 base64 ≤ 10MB）
  - [x] 1.3 curl 冒烟：新建→读回→改字段→换头像→改关系→删除全链路
- [x] Task 2: 客户端 API 层与类型
  - [x] 2.1 `types.ts`：CharacterCardEditData（16 字段 + worldBookRelations）、WorldBookSummary、CharacterWorldBookRelation
  - [x] 2.2 `client.ts`：fetchCharacterCard / putCharacterCard / putCharacterAvatar / createCharacter / deleteCharacter / getWorldBookRelations / putWorldBookRelations / fetchWorldbooks（超时/错误分类沿用现有封装）
  - [x] 2.3 集成 `react-native-image-picker` 依赖并验证链接
- [x] Task 3: CharacterEditScreen 编辑屏（分区表单）
  - [x] 3.1 屏骨架：顶部 Tab 分区（基本/设定/对话/高级/关系）+ 保存按钮 + 草稿横幅；store 增加 openCardEditor 导航
  - [x] 3.2 基本：name/nickname/creator/character_version/source/tags(Chip 编辑)/头像预览与更换
  - [x] 3.3 设定：description(背景故事)/personality/scenario 多行编辑器（可全屏展开）
  - [x] 3.4 对话：first_mes/alternate_greetings(条目增删)/mes_example/group_only_greetings(条目增删)
  - [x] 3.5 高级：system_prompt/post_history_instructions/creator_notes
  - [x] 3.6 关系：世界书绑定列表（启用开关/优先级/移除）+ 从 fetchWorldbooks 添加
  - [x] 3.7 主题化 + 响应式分档（useWindowDimensions）+ 新建模式（必选载体图）
- [x] Task 4: 本地草稿与联网同步
  - [x] 4.1 AsyncStorage 草稿键 `@creative_cafe/card_draft/<id|__new__>`，表单变更 debounce 1s 自动暂存
  - [x] 4.2 重进编辑页检测草稿 → 恢复/放弃对话框；保存成功清除；断网保存置灰并提示"已存草稿，联网后可同步"
- [x] Task 5: 列表页集成
  - [x] 5.1 卡片编辑入口（与对话入口区分）、新建 FAB、长按/菜单删除（二次确认）
  - [x] 5.2 保存/删除成功后列表刷新
- [x] Task 6: 验证与交付
  - [x] 6.1 客户端 tsc 0 错误；assembleRelease 构建通过；APK 复制 android-client/apk/
  - [x] 6.2 模拟器实测：新建→编辑→换头像→关系绑定→草稿恢复→删除全流程（亮/暗主题 + 窄屏/常规/横屏三档）
  - [x] 6.3 服务端冒烟全通过；文档增量更新（android-client.md / CHANGELOG / FIX_RECORDS）

# Task Dependencies
- Task 2、3、4、5 依赖 Task 1（端点先行，客户端可并行开发但联调需 Task 1）
- Task 3 与 Task 4 可并行（草稿层独立于表单分区）
- Task 6 依赖全部完成