# 创想咖啡厅 Creative Café

创想咖啡厅 Creative Café 是一款 **AI 驱动的创意内容管理工具**，专注于角色卡与世界书的创建、编辑、优化与导出。

> **独立项目声明**：本项目为完全独立开发的创意内容管理工具，仅与 SillyTavern **共享相同的角色卡 (V2/V3 PNG) 和世界书 (JSON) 文件格式**，无其他关联。

---

## 核心特性

### 🎭 角色卡管理
- **标准格式兼容**：完美支持 SillyTavern V2 / V3 PNG 角色卡格式（chara + ccv3 tEXt chunks）
- **可视化编辑**：支持名称、描述、性格、场景、对话示例等所有 V3 字段的独立编辑
- **AI 辅助创作**：AI 翻译、润色、智能生成各字段内容
- **角色卡测试对话**：内置聊天界面，可即时测试角色卡效果
- **PNG 导出与保存**：导出为标准 PNG 角色卡，或一键保存至角色卡目录

### 📖 世界书管理
- **标准 JSON 格式**：支持 SillyTavern 世界书 JSON 格式
- **条目管理**：创建、编辑、删除世界书条目（Entry）
- **AI 智能生成**：AI 辅助生成世界观、地理、势力、历史等内容
- **关系图谱**：可视化管理条目间的关联关系

### 🧠 记忆插件系统
- **Excel 模板管理**：创建多页签 Excel 模板，定义记忆结构
- **聊天记录管理**：树形结构展示，支持分页、搜索、筛选
- **AI 自动整理**：智能将聊天记录整理归档至 Excel 表格
- **表格关联**：将聊天记录与 Excel 模板灵活绑定

### 🎨 创意管理
- **Markdown 编辑器**：基于 Milkdown 的专业 Markdown 编辑体验
- **AI 智能生成**：根据创意一键生成完整的角色卡或世界书内容
- **AI 辅助工具**：选中文本后可进行 AI 扩写、润色、翻译
- **创意格式化导出**：AI 将创意内容按 V3 标准拆分为结构化属性，导出为 PNG 角色卡

### 👤 用户人设管理
- **自定义人设**：创建和管理个人对话人设（Persona）
- **人设存储路径管理**：统一配置人设文件存储位置

### 📚 知识库管理
- **多格式文档支持**：支持 PDF、DOCX、TXT 等格式文档导入
- **向量化存储**：基于 VecStore WASM 的本地向量数据库
- **语义检索**：智能语义搜索文档内容

### 🎛️ 系统设置
- **多 AI 引擎配置**：支持多个 AI API 引擎配置与切换
- **主题切换**：亮色 / 暗色模式
- **统一存储路径管理**：所有模块的存储路径支持一键快速打开对应文件夹

---

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| **前端框架** | React 18, TypeScript, Ant Design 6 |
| **状态管理** | Zustand |
| **Markdown 编辑** | Milkdown 7.x (Crepe) |
| **构建工具** | Vite 5 |
| **桌面应用** | Electron 33 |
| **向量数据库** | VecStore WASM |
| **角色卡读写** | @lenml/char-card-reader, png-chunks-extract, png-chunks-encode |
| **AI 集成** | OpenAI SDK, AI SDK V6 |
| **日志** | 统一分级日志系统（错误/警告/信息/调试） |

---

## 快速开始

### 环境要求
- Node.js 18.17.0 或更高版本
- npm 11.6.2 或更高版本

### 安装与运行

```bash
# 安装依赖
npm install

# 启动开发环境
npm run dev

# 构建生产版本
npm run build

# 打包 Electron 应用
npm run electron:build
```

或直接双击项目根目录下的 `start.bat` 启动。

---

## 项目结构

```
creative-cafe/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── ipc/              # IPC 通信处理器
│   │   ├── services/         # 核心服务（角色卡、世界书、知识库等）
│   │   └── utils/            # 工具函数
│   ├── renderer/             # 渲染进程（前端 UI）
│   │   ├── components/       # React 组件
│   │   │   ├── Character/    # 角色卡管理
│   │   │   ├── Creative/     # 创意管理
│   │   │   ├── WorldBook/    # 世界书管理
│   │   │   ├── MemoryChat/   # 记忆插件
│   │   │   ├── Persona/      # 用户人设
│   │   │   ├── KnowledgeBase/# 知识库
│   │   │   ├── Settings/     # 系统设置
│   │   │   └── Common/       # 公共组件
│   │   ├── stores/           # Zustand 状态管理
│   │   └── types/            # TypeScript 类型定义
│   └── shared/               # 主渲染共享代码
├── data/                     # 用户数据存储目录
├── doc/                      # 技术文档
├── start.bat                 # 启动脚本
└── package.json
```

---

## 角色卡格式规范

Creative Café 导出的角色卡严格遵循 **SillyTavern V3 标准**：

### PNG 结构
- **图片载体**：标准 PNG 图片（可自定义封面）
- **chara chunk**（V2 兼容）：tEXt chunk，keyword=`chara`，data=base64 编码的 JSON
- **ccv3 chunk**（V3 标准）：tEXt chunk，keyword=`ccv3`，data=base64 编码的 V3 JSON 结构

### V3 数据结构
```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    "name": "角色名称",
    "description": "角色描述",
    "personality": "性格特点",
    "scenario": "场景设定",
    "first_mes": "第一条消息",
    "mes_example": "对话示例",
    "creator_notes": "创作者备注",
    "system_prompt": "系统提示",
    "post_history_instructions": "对话后指令",
    "tags": ["标签1", "标签2"],
    "creator": "创作者",
    "character_version": "版本",
    "extensions": {}
  }
}
```

---

## 开发规范

- **代码风格**：TypeScript 严格模式，ESLint + Prettier
- **组件命名**：PascalCase 命名组件，camelCase 命名变量和函数
- **状态管理**：使用 Zustand store 集中管理模块状态
- **日志记录**：使用 `useLogStore` 统一记录关键操作和错误
- **错误处理**：所有异步操作必须包含 try-catch 和用户反馈

---

## 许可证

MIT
