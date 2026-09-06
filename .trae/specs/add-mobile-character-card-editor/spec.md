# 移动端角色卡编辑模块（add-mobile-character-card-editor）Spec

## Why
安卓客户端目前只能浏览/对话，角色卡的全部编辑操作必须回 PC 端完成。用户需要在移动端获得与 PC 端同源的核心编辑能力（新建/编辑/删除角色卡、管理世界书关系），并适应移动端输入与断网场景。

## What Changes
- **服务端（lanApiServer）新增写端点**（复用 characterService 既有 CRUD，PC 端无改动）：
  - `PUT /api/characters/:id/card` — 更新角色卡字段（白名单校验）
  - `PUT /api/characters/:id/avatar` — 替换头像载体图（base64 PNG，重建 PNG 元数据）
  - `POST /api/characters` — 新建角色卡（载体图 + 字段）
  - `DELETE /api/characters/:id` — 删除角色卡（行为对齐 PC 端 `character:delete`）
  - `GET/PUT /api/characters/:id/worldbook-relations` — 读写角色-世界书绑定
  - `GET /api/worldbooks` — 世界书清单（供绑定选择）
- **安卓客户端（android-client）新增角色卡编辑模块**：
  - 新屏 `CharacterEditScreen`：分区表单（基本/设定/对话/高级/关系），亮暗主题适配，按屏宽分档响应式布局
  - 角色列表页集成：卡片编辑入口、新建 FAB、删除入口（确认对话框）
  - 本地草稿：编辑过程自动暂存 AsyncStorage，断网不丢；联网保存成功后清除
- 头像更换：`react-native-image-picker` 选图 → base64 上传（局域网内传输）

## Impact
- Affected specs: `add-android-chat-client`（列表页新增入口）、`fix-android-chat-parity-v3`（主题系统复用）
- Affected code:
  - 服务端：`src/main/services/lanapiserver/server.ts`（新路由）、新增 `characterWrite.ts`（写入用例封装，复用 `characterService`）
  - 客户端：`src/api/client.ts`（新接口）、`src/screens/CharacterEditScreen.tsx`（新）、`src/screens/CharacterListScreen.tsx`（入口集成）、`src/store.ts`（导航）、`src/types.ts`（CharacterCard 编辑类型）
- 约束继承：客户端为纯客户端形态——角色卡数据全部经 LAN API 读写，本地仅存草稿（数据非配置）；明文 HTTP 仅限局域网

## ADDED Requirements

### Requirement: 角色卡字段编辑
系统 SHALL 支持在移动端编辑与 PC 端同源的全部角色卡字段：name、nickname、description（背景故事）、personality、scenario、first_mes、alternate_greetings、mes_example、group_only_greetings、system_prompt、post_history_instructions、creator_notes、creator、character_version、source、tags。

#### Scenario: 编辑并保存成功
- **WHEN** 用户修改姓名与背景故事后点保存且服务端可达
- **THEN** 服务端白名单校验通过并写回 PNG 卡（v2 `chara` + v3 `ccv3` 双写），客户端清除草稿并返回列表，桌面端可见同一变更

#### Scenario: 非法字段被拒
- **WHEN** 提交 name 为空或含白名单外字段
- **THEN** 服务端返回 `400 VALIDATION_ERROR`，客户端提示且原卡不被破坏

### Requirement: 头像查看/替换与新建角色
系统 SHALL 支持查看当前头像、从相册选图替换载体 PNG，以及"选图 → 填字段 → 创建"的新建流程（对齐 PC 端 createFromImage）。

#### Scenario: 新建角色
- **WHEN** 用户在列表页点新建 FAB，选图并填写必填字段（name）后提交
- **THEN** 服务端生成含双 spec 元数据的新 PNG，列表刷新可见新角色

### Requirement: 删除角色卡
系统 SHALL 支持删除角色卡，删除前必须二次确认；删除行为与 PC 端一致（仅删卡文件，历史会话存储不动）。

### Requirement: 世界书关系管理
系统 SHALL 支持查看/添加/移除角色的世界书绑定（worldBookPath、enabled、priority、filterTags），数据结构与 PC 端 `CharacterWorldBookRelation` 一致。

#### Scenario: 添加绑定
- **WHEN** 用户在"关系"分区选择某世界书并启用、设优先级后随卡保存
- **THEN** `worldBookRelations` 数组写入角色卡 JSON，PC 端关系面板同步可见

### Requirement: 本地草稿与联网同步
系统 SHALL 在编辑期间将表单状态自动暂存本地（防断网/进程被杀丢失）；断网时保存不可用并明确提示"已存草稿"；恢复联网后可一键保存；保存成功即清除草稿。

#### Scenario: 断网不丢稿
- **WHEN** 编辑中断网或 App 被杀后重新打开该角色编辑页
- **THEN** 检测到本地草稿并提示"恢复草稿/放弃"，选择恢复后表单回到断点状态

### Requirement: 移动端适配
编辑界面 SHALL 遵循移动端交互规范：分区导航（顶部 Tab 或折叠分区）、多行大文本编辑器可展开、亮暗主题全适配、按屏宽分档（<380 紧凑 / 常规 / 横屏宽幅）的响应式布局。

## MODIFIED Requirements

### Requirement: 角色列表页（原 add-android-chat-client R4）
列表卡片新增"编辑"入口；顶栏/悬浮新增"新建角色"按钮；编辑入口与原有对话入口并存且不误触。

## REMOVED Requirements
（无）
