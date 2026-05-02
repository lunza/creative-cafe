/**
 * Markdown编辑器默认配置
 */

/**
 * 编辑器默认内容
 */
export const DEFAULT_EDITOR_CONTENT = `# Markdown 编辑器

欢迎使用 Markdown 编辑器！这是一个专为 AI 环境设计的编辑器。

---

## 🎨 基本功能

### 文本格式化

- **粗体文本** - 使用双星号包裹
- *斜体文本* - 使用单星号包裹
- ~~删除线~~ - 使用双波浪号包裹
- \`行内代码\` - 使用反引号包裹

### 列表

#### 无序列表
- 🍎 苹果
- 🥜 花生
- 🥛 牛奶
- 🍞 面包

#### 有序列表
1. 第一步
2. 第二步
3. 第三步
4. 第四步完成！

### 代码块

\`\`\`typescript
// TypeScript 示例
interface User {
  id: string;
  name: string;
  age: number;
}

const user: User = {
  id: '1',
  name: '张三',
  age: 25
};

console.log('Hello, Milkdown!');
\`\`\`

### 引用

> 💡 这是一段引用文本
>
> Milkdown 是一个非常优秀的轻量级标记语言，
> 特别适合在 AI 对话场景中使用。

### 链接

- [Milkdown 官网](https://milkdown.dev)
- [GitHub 仓库](https://github.com/Milkdown/milkdown)

### 表格

| 功能 | 状态 | 说明 |
|------|------|------|
| 编辑 | ✅ | 支持实时编辑 |
| 预览 | ✅ | 支持预览模式 |
| 主题 | ✅ | 支持多种主题 |
| 代码高亮 | ✅ | 支持语法高亮 |

---

## 🎉 开始编辑

现在您可以在编辑器中尝试编辑这段 Markdown 文本，体验编辑的强大功能！

> 💡 **提示**：选中文字会出现浮动工具栏，输入 / 会显示命令菜单
`;

/**
 * 编辑器默认配置
 */
export const DEFAULT_EDITOR_CONFIG = {
  theme: 'light' as const,
  placeholder: '输入 / 以使用指令...',
  features: {
    blockEdit: true,
  },
  enableAITools: true,
  enableSave: false,
  storageKey: 'markdown_editor_content',
  minHeight: '700px',
} as const;

/**
 * AI工具默认配置
 */
export const DEFAULT_AI_TOOLS_CONFIG = {
  polishEnabled: true,
  expandEnabled: true,
  translateEnabled: true,
} as const;

/**
 * 默认占位符
 */
export const DEFAULT_PLACEHOLDER = '开始输入...';

/**
 * 编辑器默认容器样式
 */
export const DEFAULT_CONTAINER_STYLE = {
  width: '100%',
  height: '100%',
} as const;
