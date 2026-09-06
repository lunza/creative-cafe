# Checklist

- [x] 服务端：PUT /api/characters/:id/card 白名单字段校验生效（空 name / 越权字段返回 400，不破坏原卡）
- [x] 服务端：新建角色写入 v2 `chara` + v3 `ccv3` 双元数据，PC 端列表可见
- [x] 服务端：DELETE 仅删卡文件，行为与 PC 端 character:delete 一致，对话历史不受影响
- [x] 服务端：worldbook-relations 读写与 PC 端 CharacterWorldBookRelation 结构一致（worldBookPath/enabled/priority/filterTags）
- [x] 服务端：头像 base64 上传有大小上限（≤10MB）与 PNG 魔数校验
- [ ] 客户端：五个分区（基本/设定/对话/高级/关系）16 个字段全部可编辑且保存生效
- [ ] 客户端：新建流程（选图→填字段→创建）成功后列表出现新角色
- [ ] 客户端：编辑中断网/杀进程后重进，草稿恢复提示正常，数据不丢
- [ ] 客户端：保存成功后草稿清除；断网时保存按钮置灰并提示"已存草稿"
- [x] 客户端：删除有二次确认，删除后列表刷新
- [ ] 客户端：编辑屏亮/暗主题适配正确（输入框/Chip/Tab/对话框）
- [ ] 客户端：窄屏(<380)/常规/横屏三档布局无错位、可完整操作
- [x] 客户端：tsc 0 错误，assembleRelease 构建通过，新 APK 已复制到 android-client/apk/
- [ ] 文档：android-client.md（新端点+编辑模块）、CHANGELOG、FIX_RECORDS 已增量更新