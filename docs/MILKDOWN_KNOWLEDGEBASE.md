# Milkdown 编辑器知识库

## 📚 概述

本项目使用 `@milkdown/react` 作为 Markdown 编辑器，这是一个插件驱动的 WYSIWYG Markdown 编辑器框架，受到 Typora 启发，基于 ProseMirror 和 Remark 构建。

**官方网站**: https://milkdown.dev/  
**GitHub 仓库**: https://github.com/Milkdown/milkdown

---

## 📦 依赖结构

### 当前使用的 Milkdown 方案

```json
{
  "dependencies": {
    "@milkdown/core": "^7.20.0",
    "@milkdown/preset-commonmark": "^7.20.0",
    "@milkdown/react": "^7.20.0",
    "@milkdown/theme-nord": "^7.20.0"
  }
}
```

**注意**：`@milkdown/plugin-toolbar` 包不存在，已跳过。

---

## 🚀 React 快速开始

### 最小化实现

这是官方推荐的最简单的 Milkdown React 实现：

```tsx
import React from 'react';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { nord } from '@milkdown/theme-nord';
import '@milkdown/theme-nord/style.css';

const MilkdownEditor: React.FC = () => {
  const initialContent = '# Hello Milkdown';
  
  useEditor((root) => {
    return Editor
      .make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContent);
      })
      .config(nord)
      .use(commonmark)
      .create();
  }, []);

  return <Milkdown />;
};

const App: React.FC = () => {
  return (
    <MilkdownProvider>
      <MilkdownEditor />
    </MilkdownProvider>
  );
};

export default App;
```

### API 详解

#### 核心组件和 Hook

1. **MilkdownProvider**

```typescript
import { MilkdownProvider } from '@milkdown/react';

<MilkdownProvider>
  {/* 应用组件 */}
</MilkdownProvider>
```

**作用**：维护编辑器实例的生命周期，管理跨组件的状态共享，必须作为所有编辑器相关组件的父容器。

2. **useEditor Hook**

```typescript
useEditor((root) => {
  return Editor
    .make()
    .use(commonmark)
    .config(nord)
    .container(root)
    .create();
}, [dependencies]);
```

**参数说明**：
- `root`: DOM 元素，编辑器的容器
- `dependencies`: 依赖数组，变化时重新创建编辑器

3. **Milkdown 组件**

```typescript
import { Milkdown } from '@milkdown/react';

<Milkdown />
```

**作用**：渲染编辑器视图区域。

---

## 🎨 可用主题

### Nord Theme（推荐）

```typescript
import { nord } from '@milkdown/theme-nord';
import '@milkdown/theme-nord/style.css';
```

使用 Nord 主题，美观现代，特别适合 AI 对话环境。

---

## 📝 可用预设

### Commonmark

```typescript
import { commonmark } from '@milkdown/preset-commonmark';
```

支持标准 Commonmark 语法，包括：
- 标题（# H1, ## H2, ### H3, 等）
- 文本格式（**粗体**, *斜体*, ~~删除线~~）
- 列表（有序、无序）
- 链接
- 引用
- 代码块
- 等等...

---

## 📂 完整示例结构

```tsx
import React from 'react';
import { Card, Typography, Divider } from 'antd';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { nord } from '@milkdown/theme-nord';
import '@milkdown/theme-nord/style.css';

const { Title, Text } = Typography;

const markdown = `# Milkdown 最小化测试页面

欢迎使用 Milkdown Markdown 编辑器！

---

## 基本功能

### 文本格式化

- **粗体文本**
- *斜体文本*
- ~~删除线~~
- \`行内代码\`

### 列表

- 无序列表项1
- 无序列表项2

1. 有序列表项1
2. 有序列表项2

---

## 测试完成！

请尝试在编辑器中输入内容！
`;

const MilkdownEditor: React.FC = () => {
  useEditor((root) => {
    return Editor
      .make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, markdown);
      })
      .config(nord)
      .use(commonmark)
      .create();
  }, []);

  return <Milkdown />;
};

const TestPage: React.FC = () => {
  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <Title level={2}>🎯 Milkdown 最小化测试页面</Title>
      <Text type="secondary">使用 Milkdown 实现的 AI 友好 Markdown 编辑器</Text>
      
      <Divider />

      <Card title="✏️ Milkdown Editor">
        <MilkdownProvider>
          <MilkdownEditor />
        </MilkdownProvider>
      </Card>
    </div>
  );
};

export default TestPage;
```

---

## ✨ Milkdown 特色功能

- 实时所见即所得编辑
- Nord 主题美观现代
- 完整的 Markdown 支持
- 插件驱动架构
- React 生态深度融合
- 完整的 TypeScript 类型定义

---

## 🎯 适用场景

- AI 对话系统
- 笔记应用
- 博客编辑器
- 文档工具

---

## 📱 技术栈

- React + TypeScript
- Milkdown 插件架构
- Nord 主题支持
- ProseMirror 核心
- Vite 构建

---

## 🔗 相关资源

- **Milkdown 官网**: https://milkdown.dev/
- **GitHub 主仓库**: https://github.com/Milkdown/milkdown
- **GitHub 示例**: https://github.com/Milkdown/examples
- **GitHub 文档网站**: https://github.com/Milkdown/website

---

## ⚠️ 历史问题记录

### Milkdown 兼容性探索记录

**早期尝试**：
- 尝试使用 `@milkdown/crepe` 包（存在样式兼容性问题）
- 尝试 `@milkdown/kit` + `@milkdown/theme-nord` 组合
- 发现依赖包之间存在冲突

**临时方案**：
- 曾切换到 `@uiw/react-md-editor` 替代方案
- 该方案轻量级、稳定且无依赖冲突

**最终方案**（2026-04-24）：
- 重新安装并使用 Milkdown 官方推荐的包组合
- `@milkdown/react` + `@milkdown/preset-commonmark` + `@milkdown/theme-nord`
- 基于 `@milkdown/react` 和 `@milkdown/kit` 的稳定集成

---

## 📝 更新记录

### 2026-04-24 (最新)
- **[重点标记]** 重新安装 Milkdown 相关包
- **[重点标记]** 使用 @milkdown/react + @milkdown/preset-commonmark + @milkdown/theme-nord 稳定组合
- 更新 TestPage.tsx 使用官方推荐的 Milkdown 集成方式
- 卸载 @uiw/react-md-editor 替代方案
- 注意：@milkdown/plugin-toolbar 包不存在，已跳过

### 2026-04-24 (中期)
- 临时切换到 @uiw/react-md-editor
- 完全移除所有 Milkdown 相关包

### 2026-04-24 (早期)
- 移除 @milkdown/crepe 包
- 尝试 @milkdown/kit + @milkdown/theme-nord 组合
- 发现兼容性问题

### 2025-04-25
- 修复 @milkdown/react 导入错误
- 尝试 @milkdown/crepe 集成

### 2025-04-24
- 最初创建 Milkdown 知识库
- 更新到 @milkdown/kit 最新包结构
