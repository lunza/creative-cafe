# Checklist

- [x] 「主要角色」现有编辑功能零回归：手动输入/修改/保存/回显行为不变（TextArea maxLength 放宽为唯一字段变更）
- [x] 图片上传区支持 JPG/JPEG/PNG/WEBP/BMP 选择，预览缩略图 + 移除/重选可用
- [x] 非法扩展名 / >8MB / 读取失败 三类上传异常均有明确提示，不触发 AI 调用
- [x] 「AI 生成角色信息」按钮仅在「已上传图片 + supportsVision + 非加载中」时可用
- [x] 生成管线包含：上传图片 + 整体分析结果（跨页上下文表格）+ 漫画背景信息 + 已有角色文本 + 用户自定义提示词（withCustomPrompt 末尾注入，永久约定）
- [x] AI 返回 JSON 解析成功并格式化为文本，自动回填「主要角色」字段，弹窗保持打开、字段可继续编辑
- [x] 加载中按钮切换 danger「停止生成」；点击后请求中止，提示「已停止」（cancelled:true 区分，非报错）
- [x] AI 超时（120s）返回「AI 分析超时」友好错误；引擎未配置/HTTP 错误/空内容/JSON 异常均有真实错误透出
- [x] 生成失败时「主要角色」字段与已上传图片保持不变
- [x] `manga:cancel('generateCharacterInfo')` 可中止；key 缺省时一并取消
- [x] `npm run typecheck` 零错误（本次 6 个变更文件零错误；完整日志无 manga/writing-v2/preload 匹配项，其余均为预存无关错误）
- [ ] 运行时验证通过：编辑模式完整链路（上传→生成→回填→修改→保存→重开回显）+ 新建模式生成 + 无 vision 引擎禁用态（应用已重启生效、typecheck 通过；UI 交互链路待用户实测）
- [x] CODE_WIKI.md 与根目录技术文档完成增量更新
