# MarkdownEditor 组件使用文档

## 概述

`MarkdownEditor` 是一个功能完整、可复用的 Markdown 编辑器组件，基于 Milkdown Crepe 构建。它包含了文本编辑、主题切换、AI 辅助工具等完整功能，并支持 AI 流式响应。

## 特性

- ✨ **官方 Nord 主题** - 亮色/暗色模式支持
- 🎯 **AI 辅助工具** - 润色、扩写、翻译功能（支持流式响应）
- 🚀 **流式响应** - AI 内容实时更新，无需等待完整响应
- 📝 **完整编辑能力** - 浮动工具栏、斜杠命令、块操作
- 🎨 **主题系统** - 完善的 CSS 变量主题
- 🔄 **受控/非受控模式** - 灵活的使用方式
- 📦 **零业务依赖** - 可直接在其他项目中复用
- 🛡️ **类型安全** - 完整的 TypeScript 类型定义

## 快速开始

### 基础用法

```tsx
import React, { useRef } from 'react';
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';

function BasicExample() {
  const editorRef = useRef<MarkdownEditorHandle>(null);

  return (
    <MarkdownEditor
      ref={editorRef}
      theme="light"
      defaultValue="# Hello World"
    />
  );
}
```

### 受控模式

```tsx
import React, { useState, useRef } from 'react';
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';

function ControlledExample() {
  const [content, setContent] = useState('# My Content');
  const editorRef = useRef<MarkdownEditorHandle>(null);

  return (
    <div>
      <MarkdownEditor
        ref={editorRef}
        value={content}
        onChange={setContent}
        theme="dark"
      />
      <button onClick={() => console.log(editorRef.current?.getMarkdown())}>
        获取内容
      </button>
    </div>
  );
}
```

### 禁用 AI 工具

```tsx
import MarkdownEditor from './MarkdownEditor';

function WithoutAITools() {
  return (
    <MarkdownEditor
      enableAITools={false}
      defaultValue="# Simple Editor"
    />
  );
}
```

## API 参考

### MarkdownEditor Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `theme` | `'light' \| 'dark'` | `'light'` | 编辑器主题 |
| `value` | `string` | - | 编辑器内容（受控模式） |
| `defaultValue` | `string` | 内置示例内容 | 编辑器默认内容（非受控模式） |
| `onChange` | `(content: string) => void` | - | 内容变化回调 |
| `placeholder` | `string` | `'输入 / 以使用指令...'` | 占位符文本 |
| `enableAITools` | `boolean` | `true` | 是否启用AI工具栏 |
| `aitoolsConfig` | `object` | 全部启用 | AI工具的详细配置 |
| `className` | `string` | - | 自定义类名 |
| `style` | `React.CSSProperties` | - | 自定义样式 |
| `minHeight` | `string \| number` | `'700px'` | 编辑器最小高度 |
| `containerStyle` | `React.CSSProperties` | - | 编辑器容器样式 |

### aitoolsConfig 配置

```tsx
{
  polishEnabled?: boolean;    // 是否启用润色
  expandEnabled?: boolean;    // 是否启用扩写
  translateEnabled?: boolean; // 是否启用翻译
}
```

### MarkdownEditorHandle (ref)

| 方法 | 类型 | 说明 |
|------|------|------|
| `getMarkdown` | `() => string` | 获取编辑器的 Markdown 内容 |
| `setMarkdown` | `(content: string) => void` | 设置编辑器的 Markdown 内容 |
| `getEditorElement` | `() => HTMLElement \| null` | 获取编辑器的 DOM 元素 |

## 上下文和 Hook

### useMarkdownEditorContext

在编辑器的子组件中使用，可以获取编辑器上下文：

```tsx
import { useMarkdownEditorContext } from './MarkdownEditor';

function SomeChildComponent() {
  const { getEditorContent, setEditorContent, getEditorElement } = 
    useMarkdownEditorContext();

  // 使用这些方法...
}
```

## 完整示例

### 集成到应用中

```tsx
import React, { useState, useRef } from 'react';
import { Card, Switch, Space, Typography } from 'antd';
import { useUIStore } from '../../stores/uiStore';
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';

const { Title } = Typography;

function MarkdownEditorPage() {
  const { theme, setTheme } = useUIStore();
  const [content, setContent] = useState('');
  const editorRef = useRef<MarkdownEditorHandle>(null);

  return (
    <div>
      <Title>Markdown 编辑器</Title>
      
      <Space style={{ marginBottom: 16 }}>
        <span>{theme === 'light' ? '亮色' : '暗色'}</span>
        <Switch
          checked={theme === 'dark'}
          onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
        />
      </Space>

      <Card>
        <MarkdownEditor
          ref={editorRef}
          theme={theme}
          value={content}
          onChange={setContent}
          enableAITools={true}
          minHeight="600px"
        />
      </Card>
    </div>
  );
}
```

### 自定义样式

```tsx
import MarkdownEditor from './MarkdownEditor';

function CustomStyleEditor() {
  return (
    <MarkdownEditor
      style={{
        background: '#f0f0f0',
        borderRadius: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}
      containerStyle={{
        padding: 16,
      }}
      minHeight="500px"
    />
  );
}
```

## 主题系统

组件使用 CSS 变量实现主题系统，支持亮色和暗色两种主题：

```tsx
// 使用亮色主题
<MarkdownEditor theme="light" />

// 使用暗色主题
<MarkdownEditor theme="dark" />
```

主题会应用到编辑器和 AI 工具栏。

## 依赖要求

### 必需依赖

```json
{
  "@milkdown/react": "^7.0.0",
  "@milkdown/crepe": "^7.0.0",
  "antd": "^5.0.0",
  "react": "^18.0.0",
  "react-dom": "^18.0.0"
}
```

### 可选依赖（AI 工具）

```json
{
  "zustand": "^4.0.0" // 用于状态管理
}
```

## AI 流式响应

MarkdownEditor 集成了完整的 AI 流式响应功能，提供以下特性：

### 流式响应特性

- 🚀 **实时更新** - AI 生成内容时，编辑器立即更新
- ⚡ **无需等待** - 不需要完整响应就可以看到内容
- 📊 **进度显示** - 显示处理进度和状态
- 🛡️ **错误处理** - 完善的错误处理和重试机制

### 使用方式

流式响应功能已自动集成在 AI 工具中，无需额外配置：

```tsx
<MarkdownEditor
  ref={editorRef}
  theme="light"
  enableAITools={true}  // 启用 AI 工具即启用流式响应
  defaultValue="# Hello World"
/>
```

### 工作流程

1. 选择编辑器中的文本
2. 点击 AI 工具按钮（润色/扩写/翻译）
3. AI 流式生成内容，编辑器实时更新
4. 生成完成后显示最终结果

### 技术架构

```
MarkdownEditor
    ↓
MarkdownAITools (流式响应逻辑)
    ↓
AIService (核心服务)
    ↓
真实 AI 服务
```

### 配置说明

流式响应功能会自动从 `useSettingStore` 读取 AI 引擎配置，包括：
- API 地址
- API Key
- 默认模型
- 温度设置
- 最大 tokens

## 注意事项

1. **AI 工具依赖**：AI 工具需要项目中的 `useSettingStore` 和 `useLogStore`，以及 `window.electronAPI.ai`
2. **性能优化**：对于大型文档，注意编辑器的性能表现
3. **版本兼容性**：确保 Milkdown 相关包的版本兼容
4. **CSS 导入**：组件会自动导入 Milkdown 相关的 CSS，无需额外导入
5. **网络要求**：流式响应需要网络连接到 AI 服务
6. **本地服务**：推荐使用本地 AI 服务（如 http://127.0.0.1:5000）以获得最佳体验

## 常见问题

### Q: 如何获取编辑器的内容？

A: 有两种方式：
- 使用 `onChange` 回调（推荐）
- 使用 ref 的 `getMarkdown()` 方法

### Q: 编辑器内容没有自动保存？

A: 你需要自己实现保存逻辑，通过 `onChange` 监听内容变化，然后保存到合适的位置。

### Q: AI 工具可以自定义吗？

A: 可以通过 `aitoolsConfig` 配置具体启用哪些工具。完整的自定义需要修改 `MarkdownAITools` 组件。

### Q: 编辑器支持多种语言吗？

A: 基础编辑器不依赖语言，但 AI 翻译工具支持多种目标语言。

## 进一步开发

如果需要扩展编辑器功能，可以：
1. 修改 `MarkdownEditor.tsx` 添加新的 props
2. 扩展 `MarkdownEditor.types.ts` 添加新类型
3. 自定义主题样式在 `milkdownTheme.ts`
4. 增强 AI 工具功能在 `MarkdownAITools.tsx`

## 更新日志

### v1.0.0
- 初始版本发布
- 基础 Markdown 编辑功能
- 亮色/暗色主题
- AI 辅助工具集成
- 完整的类型定义和文档
