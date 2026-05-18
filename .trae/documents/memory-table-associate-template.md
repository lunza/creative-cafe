# 在记忆表格设置中添加关联模板按钮

## 需求

在记忆表格设置面板中添加关联模板功能：
1. 添加一个"关联模板"按钮，与聊天记录管理中的关联按钮效果一致
2. 用户启用记忆表格时，必须关联模板才能进行对话

## 现有代码分析

### MemoryTablePanel.tsx
- 位置：`src/renderer/components/Character/CharacterDialogueChat/MemoryTablePanel.tsx`
- 已有功能：启用开关、实时整理开关、同步/异步整理切换、预览表格按钮
- 已有 props：`characterCardName`（角色名称）

### 聊天记录管理中的关联功能（ChatManager.tsx）
- `handleAssociateTemplate()` 方法：调用 `window.electronAPI.memory.associateTemplate()`
- 关联流程：
  1. 用户点击"关联模板"按钮
  2. 弹出 Modal，显示模板列表（从 `getAllTemplates` 获取）
  3. 用户选择模板并点击确认
  4. 调用 `window.electronAPI.memory.associateTemplate(chatId, templateId)`
  5. 成功后关闭 Modal

## 实施方案

### 步骤 1：在 MemoryTablePanel 中添加关联模板功能

**修改文件**：`src/renderer/components/Character/CharacterDialogueChat/MemoryTablePanel.tsx`

新增以下功能：
1. **状态管理**：
   - `associatedTemplateId: string | null` - 当前关联的模板 ID
   - `associateModalVisible: boolean` - 关联模板 Modal 显示状态
   - `selectedTemplate: string` - 用户选择的模板 ID
   - `templates: any[]` - 可用模板列表
   - `associateLoading: boolean` - 关联操作加载状态

2. **useEffect**：加载当前关联的模板和所有可用模板
   - 调用 `window.electronAPI.memory.getAssociatedTemplate(characterCardName)` 获取已关联的模板
   - 调用 `window.electronAPI.memory.getAllTemplates()` 获取可用模板列表

3. **handleToggle 增强**：在启用记忆表格时检查是否已关联模板
   - 如果 `enabled` 且 `!associatedTemplateId`，阻止启用并弹出关联模板 Modal
   - 弹出提示："启用记忆表格前，请先关联一个模板"

4. **新增 UI 元素**：
   - 在"预览表格"按钮上方添加"关联模板"按钮
   - 按钮显示当前关联的模板名称（如果已关联）或"选择模板"
   - 点击后打开关联模板 Modal

5. **关联模板 Modal**：
   - 使用 `Modal` 组件
   - 显示模板列表（Select 下拉框）
   - 每个模板选项显示模板名称
   - 确认按钮调用 `window.electronAPI.memory.associateTemplate(characterCardName, selectedTemplate)`
   - 成功后更新 `associatedTemplateId` 并关闭 Modal

### 步骤 2：在 hooks.ts 中增加模板关联检查

**修改文件**：`src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`

在 `useCharacterConfig` 的 `useEffect` 中，当用户启用记忆表格但未关联模板时，弹出警告提示。

### 步骤 3：确保 IPC 接口已注册

**确认文件**：`src/main/preload.ts`
- `getAssociatedTemplate: (chatId: string) => Promise<any>`
- `associateTemplate: (chatId: string, templateId: string) => Promise<void>`

### 步骤 4：样式调整

在 `ConfigPanel.css` 中添加关联模板按钮的样式。

## 实现细节

### MemoryTablePanel 新增代码结构

```tsx
const MemoryTablePanel: React.FC<MemoryTablePanelProps> = ({
  enabled,
  autoOrganize,
  organizeMode,
  characterCardName,
  onToggle,
  onAutoOrganizeToggle,
  onOrganizeModeChange,
}) => {
  // ... 现有状态 ...
  
  // 新增状态
  const [associatedTemplateId, setAssociatedTemplateId] = useState<string | null>(null);
  const [associatedTemplateName, setAssociatedTemplateName] = useState<string>('');
  const [associateModalVisible, setAssociateModalVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [associateLoading, setAssociateLoading] = useState(false);

  // 加载关联信息和模板列表
  useEffect(() => {
    loadAssociationInfo();
    loadTemplates();
  }, [characterCardName]);

  const loadAssociationInfo = async () => {
    // 获取当前关联的模板
    const templateId = await window.electronAPI.memory.getAssociatedTemplate(characterCardName);
    if (templateId) {
      setAssociatedTemplateId(templateId);
      // 从模板列表中查找模板名称
      const allTemplates = await window.electronAPI.memory.getAllTemplates();
      const template = allTemplates?.find((t: any) => t.id === templateId);
      setAssociatedTemplateName(template?.name || templateId);
    }
  };

  const loadTemplates = async () => {
    const allTemplates = await window.electronAPI.memory.getAllTemplates();
    setTemplates(allTemplates || []);
  };

  const handleToggle = useCallback((checked: boolean) => {
    if (checked && !associatedTemplateId) {
      message.warning('启用记忆表格前，请先关联一个模板');
      setAssociateModalVisible(true);
      return;
    }
    onToggle(checked);
    if (!checked) {
      onAutoOrganizeToggle(false);
    }
  }, [onToggle, onAutoOrganizeToggle, associatedTemplateId]);

  const handleAssociateTemplate = async () => {
    if (!selectedTemplate) {
      message.error('请选择模板');
      return;
    }
    setAssociateLoading(true);
    try {
      await window.electronAPI.memory.associateTemplate(characterCardName, selectedTemplate);
      message.success('关联模板成功');
      setAssociatedTemplateId(selectedTemplate);
      const template = templates.find(t => t.id === selectedTemplate);
      setAssociatedTemplateName(template?.name || selectedTemplate);
      setAssociateModalVisible(false);
    } catch (error) {
      message.error('关联模板失败');
    } finally {
      setAssociateLoading(false);
    }
  };

  // 新增 UI：关联模板按钮
  <div className="memory-table-action-row">
    <Button
      icon={<LinkOutlined />}
      onClick={() => setAssociateModalVisible(true)}
      size="small"
      className="memory-table-associate-btn"
      block
      type={associatedTemplateId ? 'default' : 'primary'}
    >
      {associatedTemplateId ? `已关联: ${associatedTemplateName}` : '关联模板'}
    </Button>
  </div>

  // 新增 UI：关联模板 Modal
  <Modal
    title="关联模板"
    open={associateModalVisible}
    onCancel={() => setAssociateModalVisible(false)}
    onOk={handleAssociateTemplate}
    confirmLoading={associateLoading}
  >
    <Select
      placeholder="选择模板"
      value={selectedTemplate || associatedTemplateId}
      onChange={setSelectedTemplate}
      style={{ width: '100%' }}
    >
      {templates.map(template => (
        <Option key={template.id} value={template.id}>
          {template.name}
        </Option>
      ))}
    </Select>
  </Modal>
};
```

## 涉及的文件

1. `src/renderer/components/Character/CharacterDialogueChat/MemoryTablePanel.tsx` - 主要修改
2. `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` - 新增样式
3. `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` - 可能需要微调

## 预期效果

- 用户启用记忆表格时，如果未关联模板，会提示"启用记忆表格前，请先关联一个模板"并弹出关联模板对话框
- 关联模板按钮会显示当前已关联的模板名称
- 用户可以在任何时候点击"关联模板"按钮来更换关联的模板
- 关联后，表格数据会自动使用该模板的结构创建
