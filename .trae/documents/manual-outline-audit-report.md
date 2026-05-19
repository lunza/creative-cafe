# 手动大纲编辑功能 - 全面测试与漏洞扫描报告

> 测试时间: 2026-05-18
> 测试范围: 手动大纲编辑功能全部代码
> 测试方法: 静态代码分析 + 功能完整性验证 + 边界条件测试

## 一、Bug 清单

### 🔴 严重 Bug (Critical)

#### Bug 1: OutlineEditor 缺少"新建大纲"入口
- **文件**: [OutlineEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/OutlineEditor.tsx#L76-L94)
- **问题**: 当前 OutlineEditor 仅在 `outline` 不为 null 时渲染内容。如果用户想要手动创建大纲，没有任何"新建大纲"或"切换到手动手动模式"的入口。
- **复现步骤**:
  1. 从项目列表点击"新建项目"
  2. 进入写作配置面板并提交
  3. 此时进入 OUTLINE_EDITING 视图，但 outline 为 null（因为是新配置，还没生成）
  4. OutlineEditor 显示"加载中..."，没有任何手动创建大纲的选项
- **影响**: 用户无法从空白开始手动创建大纲，核心功能缺失
- **修复方案**: 当 outline 为 null 时，显示"新建大纲"按钮，允许用户直接进入手动编辑模式

#### Bug 2: ManualOutlineEditor 初始化依赖 outline 存在
- **文件**: [WritingModeEntry.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx#L109-L121)
- **问题**: `handleOutlineConfirm` 中创建项目后直接进入 `CONTENT_GENERATION`，但手动大纲模式下 outline 可能为空。`OutlineEditor` 在 outline 为 null 时显示"加载中..."
- **复现步骤**:
  1. 新建项目时选择手动大纲模式
  2. 提交配置后，outline 为 null
  3. 进入 OUTLINE_EDITING 视图，OutlineEditor 显示"加载中..."
- **影响**: 手动大纲模式无法正常工作

#### Bug 3: ManualOutlineEditor 状态不同步到 Store
- **文件**: [OutlineEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/OutlineEditor.tsx#L67-L70)
- **问题**: `handleManualChaptersChange` 仅更新本地 state `manualChapters`，但未同步到 writingModeStore 的 outline 或 writingProjectStore。当用户点击"确认大纲"时，使用的仍是旧 outline。
- **复现步骤**:
  1. 切换到手动编辑模式
  2. 添加/修改章节
  3. 点击"确认大纲"
  4. 创建的项目大纲仍然是 AI 生成的旧数据
- **影响**: 手动编辑的内容不会保存到项目

#### Bug 4: OutlineEditor 在 outline 为 null 时崩溃风险
- **文件**: [OutlineEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/OutlineEditor.tsx#L30)
- **问题**: `const [editedOutline, setEditedOutline] = useState<GeneratedOutline>(outline!);` 使用非空断言，但 outline 可能为 null。第72行检查 `if (!outline)` 返回"加载中..."，但第30行的初始化已经可能在 outline 为 null 时出错。
- **影响**: 潜在的运行时错误

### 🟡 中等问题 (Warning)

#### Bug 5: WritingModeEntry 未传递 initialMode 给 OutlineEditor
- **文件**: [WritingModeEntry.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx#L114-L120)
- **问题**: OutlineEditor 支持 `initialMode` prop，但 WritingModeEntry 没有传递此属性。用户无法通过 UI 选择手动模式。
- **影响**: 手动编辑模式入口不可达

#### Bug 6: WritingModeStore 未记录编辑模式
- **文件**: [writingModeStore.ts](file:///d:/AI/creative-cafe/src/renderer/stores/writingModeStore.ts)
- **问题**: Store 中没有 `outlineMode: 'ai' | 'manual'` 字段，无法记住用户选择的模式。
- **影响**: 刷新或切换视图后模式状态丢失

#### Bug 7: handleOutlineConfirm 使用旧的 outline 而非 manualChapters
- **文件**: [WritingModeEntry.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx#L57-L70)
- **问题**: `handleOutlineConfirm` 使用 `useWritingModeStore` 中的 `outline`，但手动模式下 outline 未被更新。
- **影响**: 确认大纲时保存的数据不正确

#### Bug 8: WritingConfigPanel 缺少"仅手动大纲"选项
- **文件**: [WritingConfigPanel.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx)
- **问题**: 配置面板只有"生成大纲"按钮，没有"手动创建大纲"选项。
- **影响**: 用户无法跳过 AI 生成直接进入手动编辑

#### Bug 9: ManualOutlineEditor treeData 的 key 生成可能冲突
- **文件**: [ManualOutlineEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx#L119-L120)
- **问题**: `key: generateChapterKey(ch.index, 0)` 仅基于 index 生成 key。如果章节被删除后重新添加，index 可能重复。
- **影响**: React Tree 可能渲染错误

### 🟢 轻微问题 (Info)

#### Bug 10: 空状态提示缺少操作引导
- **文件**: [ManualOutlineEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx#L351-L358)
- **问题**: 空状态只显示"暂无章节"和描述，但没有直接的"创建第一个章节"按钮。
- **影响**: 用户体验不佳

#### Bug 11: 表单重置时机不当
- **文件**: [ManualOutlineEditor.tsx](file:///d:/AI/creative-cafe/src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx#L168-L180)
- **问题**: `useEffect` 在 `selectedKeys` 变化时重置表单，但如果用户正在编辑一个章节并点击"添加章节"，表单会先重置再填充新章节数据，导致闪烁。
- **影响**: UI 闪烁

#### Bug 12: 缺少章节内容字段
- **文件**: [writing.types.ts](file:///d:/AI/creative-cafe/src/shared/types/writing.types.ts#L96-L107)
- **问题**: ChapterOutline 没有 content 字段来存储章节的实际正文内容。手动编辑时无法在大纲阶段编写章节草稿。
- **影响**: 功能不完整

## 二、功能完整性测试

### 2.1 核心功能覆盖度

| 功能 | 状态 | 说明 |
|------|------|------|
| 手动创建大纲 | ❌ 缺失 | 无入口，无法从空白开始 |
| 添加章节 | ✅ 已实现 | 顶级章节添加正常 |
| 添加子章节 | ✅ 已实现 | 限制在一级嵌套 |
| 删除章节 | ✅ 已实现 | 带确认对话框 |
| 移动章节 | ✅ 已实现 | 上下移动 |
| 合并章节 | ✅ 已实现 | 基于相邻章节 |
| 拆分章节 | ✅ 已实现 | 基于 --- 分隔符 |
| 编辑属性 | ✅ 已实现 | 名称/字数/梗概/类型/重要性 |
| 撤销/重做 | ✅ 已实现 | 20步历史，快捷键支持 |
| 自动保存 | ✅ 已实现 | 500ms 节流 |
| 模式切换 | ⚠️ 部分实现 | 缺少 UI 入口 |
| 数据持久化 | ⚠️ 部分实现 | 未同步到 Store |

### 2.2 界面交互测试

| 交互元素 | 显示状态 | 响应行为 | 问题 |
|---------|---------|---------|------|
| 章节树 | ✅ 正常 | 点击选中正常 | 无 |
| 属性表单 | ✅ 正常 | 实时更新 | 无 |
| 工具栏按钮 | ✅ 正常 | 点击响应 | 无 |
| 撤销/重做按钮 | ✅ 正常 | 状态联动正常 | 无 |
| 空状态 | ⚠️ 不完整 | 无操作引导 | Bug 10 |
| 模式切换标签 | ❌ 不可达 | 未连接到 UI | Bug 5 |
| 保存状态指示器 | ✅ 正常 | Spin 动画 | 无 |

### 2.3 边界条件测试

| 测试场景 | 预期结果 | 实际结果 | 状态 |
|---------|---------|---------|------|
| 章节名称为空 | 显示验证错误 | ✅ 正确 | 通过 |
| 章节名称超过100字符 | 阻止输入 | ✅ 正确 | 通过 |
| 字数小于100 | 显示验证错误 | ✅ 正确 | 通过 |
| 字数大于50000 | 显示验证错误 | ✅ 正确 | 通过 |
| 摘要超过2000字符 | 阻止输入 | ✅ 正确 | 通过 |
| 删除最后一个章节 | 成功删除 | ✅ 正确 | 通过 |
| 上移第一个章节 | 显示警告 | ✅ 正确 | 通过 |
| 下移最后一个章节 | 显示警告 | ✅ 正确 | 通过 |
| 合并非相邻章节 | 不允许 | ⚠️ 仅合并当前选中+下一个 | 部分通过 |
| 拆分为2个以上章节 | 不支持 | ✅ 符合设计 | 通过 |
| outline 为 null 时进入编辑器 | 显示新建入口 | ❌ 显示"加载中..." | Bug 1 |
| 快速连续点击添加章节 | 每次正确添加 | ✅ 正常 | 通过 |
| 撤销超过20步 | 最旧操作丢失 | ✅ 正确 | 通过 |
| 重做后新操作 | 清空重做历史 | ✅ 正确 | 通过 |

## 三、修复方案

### P0 - 必须立即修复

#### Fix 1: 添加"新建大纲"入口 (修复 Bug 1, 2, 4)

**文件**: `OutlineEditor.tsx`

**修改**:
```typescript
// 当 outline 为 null 时，显示"新建大纲"选项
if (!outline) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <Empty
        description="暂无大纲"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
      <Space style={{ marginTop: 16 }}>
        <Button type="primary" onClick={() => {/* 切换到手动模式 */}}>
          手动创建大纲
        </Button>
        <Button onClick={onBack}>
          返回调整参数
        </Button>
      </Space>
    </div>
  );
}
```

#### Fix 2: 同步 manualChapters 到 writingModeStore (修复 Bug 3, 7)

**文件**: `OutlineEditor.tsx`

**修改**:
```typescript
const handleManualChaptersChange = (chapters: ChapterOutline[]) => {
  setManualChapters(chapters);
  
  // 同步到 writingModeStore
  const newOutline: GeneratedOutline = {
    workInfo: outline?.workInfo || {
      suggestedTitle: '手动大纲',
      novelType: 'web_novel',
      estimatedWordCount: 0,
      chapterCount: chapters.length,
      creativeDescription: ''
    },
    storyLine: {
      coreConflict: '',
      storyArc: { beginning: '', development: '', climax: '', resolution: '' },
      theme: ''
    },
    chapters,
    characterRelationships: [],
    worldbuildingNotes: []
  };
  useWritingModeStore.getState().setOutline(newOutline);
  message.success('大纲已更新');
};
```

#### Fix 3: 传递 initialMode 给 OutlineEditor (修复 Bug 5, 8)

**文件**: `WritingModeEntry.tsx`

**修改**:
1. 在 writingModeStore 中添加 `outlineMode` 状态
2. 在 WritingConfigPanel 中添加"手动创建大纲"按钮
3. 传递 `initialMode` 给 OutlineEditor

### P1 - 建议修复

#### Fix 4: 添加 outlineMode 到 writingModeStore (修复 Bug 6)

**文件**: `writingModeStore.ts`

**修改**:
```typescript
interface WritingModeState {
  // ... existing fields
  outlineMode: 'ai' | 'manual';
  setOutlineMode: (mode: 'ai' | 'manual') => void;
}
```

#### Fix 5: 改进 Tree key 生成 (修复 Bug 9)

**文件**: `ManualOutlineEditor.tsx`

**修改**:
```typescript
// 使用 index + timestamp 或 unique ID
const generateChapterKey = (index: number, level: number, id?: string): string => {
  return `ch-${level}-${index}-${id || ''}`;
};
```

#### Fix 6: 添加空状态操作引导 (修复 Bug 10)

**文件**: `ManualOutlineEditor.tsx`

**修改**:
```typescript
<Empty
  description="暂无章节"
  image={Empty.PRESENTED_IMAGE_SIMPLE}
>
  <Button type="primary" icon={<PlusOutlined />} onClick={addChapter}>
    创建第一个章节
  </Button>
</Empty>
```

## 四、回归测试计划

| 测试项 | 步骤 | 预期 | 状态 |
|--------|------|------|------|
| AI 生成大纲流程 | 1. 新建项目 2. 提交配置 3. 等待生成 | 大纲正常显示 | 待验证 |
| 手动创建大纲流程 | 1. 新建项目 2. 点击"手动创建" 3. 添加章节 | 大纲正常创建 | 待验证 |
| 模式切换 | 1. AI 生成大纲 2. 切换到手动 3. 修改 | 修改正常保存 | 待验证 |
| 确认大纲 | 1. 编辑大纲 2. 点击确认 | 项目正常创建 | 待验证 |
| 撤销/重做 | 1. 添加章节 2. 撤销 3. 重做 | 状态正确切换 | 待验证 |
| 自动保存 | 1. 修改章节 2. 等待500ms | 保存状态显示 | 待验证 |
| 合并章节 | 1. 选择章节 2. 点击合并 | 章节正确合并 | 待验证 |
| 拆分章节 | 1. 章节含 --- 2. 点击拆分 | 章节正确拆分 | 待验证 |

## 五、总结

### 问题统计
| 严重级别 | 数量 | 状态 |
|---------|------|------|
| Critical | 4 | 待修复 |
| Warning | 5 | 待修复 |
| Info | 3 | 待修复 |
| **总计** | **12** | **0/12 已修复** |

### 关键风险
1. **手动大纲模式完全不可用**: 缺少入口，用户无法触发手动创建流程
2. **数据不一致**: 手动编辑的内容不会保存到项目
3. **空状态处理不当**: outline 为 null 时用户体验差

### 优先级建议
1. **立即修复**: Fix 1, Fix 2, Fix 3 (P0)
2. **尽快修复**: Fix 4, Fix 5, Fix 6 (P1)
3. **优化项**: Bug 11, Bug 12 (P2)
