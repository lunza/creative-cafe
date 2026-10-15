/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分——异步表格整理指令（buildAsyncTableOrganizeInstructions）。
 * 原 PromptBuilder.ts 行段（1-based，逐字搬迁）：L1335-L1587。
 */
/**
 * 构建异步表格整理指令（完整版，与同步模式规则一致）
 * 固定指令部分从模板系统获取（creative-chat.async-table-instructions），
 * 动态部分（表格结构、当前表格状态、最终提醒）由代码构建并追加。
 */
export async function buildAsyncTableOrganizeInstructions(
  memoryTableData?: string,
  tableStructure?: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> }
): Promise<string> {
  // 从模板系统获取固定指令部分
  let baseInstructions = '';
  try {
    const promptResult = await window.electronAPI.prompt.build('creative-chat.async-table-instructions', {});
    if (promptResult.success && promptResult.data) {
      baseInstructions = promptResult.data.systemPrompt;
    }
  } catch (e) {
    console.error('[PromptBuilder] 获取异步表格指令模板失败，使用硬编码回退:', e);
  }

  // 如果模板获取失败，使用硬编码回退（固定指令部分）
  if (!baseInstructions) {
    baseInstructions = `\n\n【强制要求 - MANDATORY】
无论你输出了什么对话内容，你【必须】在回复的最后生成tableEdit命令标签。
这是系统功能的核心部分，不生成会导致数据处理失败！
即使没有新信息需要提取，也要生成空标签：<!--  <tableEdit>
</tableEdit> -->

【输出顺序 - 必须遵守】
1. 先输出完整的角色对话内容
2. 对话结束后换行，在文本末尾追加表格整理命令
3. 【最终确认】在输出结束前，检查是否已包含tableEdit标签，如果没有请立即生成

【tableEdit命令格式 - 严格遵循】
你需要将操作指令放在<tableEdit>标签内，使用HTML注释格式：

<!--  <tableEdit>
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
</tableEdit> -->

参数说明：
- 表格索引：从1开始，对应模板中页签的顺序
- 行索引：从1开始，对应该表格中的数据行索引
- 字段索引：从1开始，对应该表格表头的字段索引
- 每个表格的字段结构固定为：[1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增，通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成，需具有语义且保持一致性

示例(以角色表格为例，字段为[1:流水号,2:唯一id,3:角色名,4:身份,5:关系]):
- insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官","5":"主角"})
  → 在第1个表格新增一行：唯一id=zhudi_001,角色名=朱迪·霍普斯,身份=警官,关系=主角
- updateRow(1, 2, {"4":"警长"})
  → 修改第1个表格的第2条数据，只更新身份字段为"警长"
- deleteRow(1, 3)
  → 删除第1个表格的第3条数据

【增量更新策略 - 重中之重】
这是增量更新操作，不是从头整理！你必须遵循以下规则：

1. **强制重复性检查**：在生成任何insertRow命令前，必须执行以下检查流程：
   - 步骤1：查看当前消息中的实体（物品名、角色名、地点等）
   - 步骤2：在"当前已有数据"中搜索相同或高度相似的实体
   - 步骤3：使用"唯一ID快速查找索引"确认该实体的唯一ID是否已存在
   - 步骤4：如果已存在 → 使用updateRow；如果不存在 → 使用insertRow

2. **唯一ID匹配规则**：如果现有数据中已有相同唯一ID的记录，必须使用updateRow而非insertRow

3. **名称相似度匹配**（关键！）：即使唯一ID不完全相同，如果出现以下情况也必须使用updateRow：
   - 物品名相同或高度相似（如"电子面罩"和"电子面具"）
   - 角色名相同或高度相似（如"朱迪"和"朱迪·霍普斯"）
   - 描述内容高度一致
   - 类型和关键属性相同

4. **避免重复插入**：绝不要为已存在的实体生成新的insertRow命令，这是最严重的错误！

5. **只更新变化部分**：使用updateRow时，只更新发生变化的字段，不要重复填写未变化的字段


增量更新决策流程：
1. 从当前消息中识别实体（角色、物品、地点、事件等）
2. 检查表格中是否已有该实体（通过唯一ID或关键特征匹配）
   a. 首先在"唯一ID快速查找索引"中查找
   b. 如果没找到，在"当前已有数据"中通过名称相似度查找
3. 如果存在 → 使用updateRow(表格索引, 行索引, {变化的字段})更新该实体信息
4. 如果不存在 → 使用insertRow(表格索引, {新实体字段})创建新记录
5. 如果实体不再相关 → 使用deleteRow(表格索引, 行索引)删除（谨慎使用）

正确示例：
- 现有数据：行1: 唯一ID=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官
- 当前消息："朱迪说她今天升官了"
- 正确操作：updateRow(1, 1, {"4":"警长"})  ← 只更新身份字段
- 错误操作：insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**
   - 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID zhudi_001
   - 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
   - 代词回指："她"/"他"/"那个女孩" → 根据上下文指向判断对应的实体
   - 关键判断原则：如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID

3. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一


【约束规则】
- 标签必须用 <!--  <tableEdit> 开头，</tableEdit> --> 结尾，必须位于回复文本最后
- 标签内只含tableEdit命令，不含其他内容
- 只提取当前消息中明确提到的信息，不要造
- 已存在实体必须用updateRow，禁止insertRow重复插入
- 所有值必须是字符串类型，用双引号包裹
- 表格索引、行索引必须是数字，不是字符串


【错误格式示例 - 绝对禁止】

✗ insertRow(1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(1, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

✗ insertRow("1", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

 insertRow(2, {"2":"judy_badge","3":"警官徽章","4":"身份证明"})  ← 把物品放到角色表格！
  错误原因：警官徽章是物品不是角色，应该用insertRow(4, ...)放到物品表格（索引4），角色表格（索引2）只放人物

 updateRow(1, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串


【表格分类快速判断】
在生成任何insertRow命令前，先问自己："这个实体是什么类型？"
- 是人/角色/生物？ → 角色表格（索引2）
- 是物品/装备/道具？ → 物品表格（索引4）
- 是时间/地点？ → 时空表格（索引1）
- 是事件/互动？ → 社交表格（索引3）或事件表格（索引5）
- 如果不确定，记住：角色持有的物品仍然是物品，不是角色！


【输出要求】
1. 只分析当前这条消息，不要分析其他消息
2. 从当前消息中提取关键信息，生成对应的tableEdit命令
3. 将命令放在<tableEdit>标签内
4. 如果没有需要提取的信息，返回空的<tableEdit></tableEdit>
5. 确保使用正确的表格索引、行索引和字段索引
6. 参考现有表格数据，避免重复添加相同信息
7. 识别变体称呼，使用唯一ID保持一致性
8. 只提取当前消息中明确提到的信息，不要臆造
9. 【最重要】增量更新：已存在的实体必须使用updateRow，禁止使用insertRow重复插入！
10. 重复检测：在生成insertRow前，必须先在"唯一ID快速查找索引"中查找，并在"当前已有数据"中通过名称相似度查找
11. 合并重复记录：如果发现表格中存在多个相同或高度相似的记录，应使用updateRow更新其中一条，并使用deleteRow删除其他重复记录
12. 【分类规则】人物/角色 → 角色表格(索引2)；物品/装备/道具 → 物品表格(索引4)；时间/地点 → 时空表格(索引1)；事件/互动 → 社交表格(索引3)或事件表格(索引5)
`;
  }

  // 动态追加表格结构信息（不纳入模板）
  let instructions = `\n\n` + baseInstructions;

  // 追加表格模板结构信息
  if (tableStructure && tableStructure.sheets && tableStructure.sheets.length > 0) {
    instructions += `\n\n【表格模板结构】\n`;
    instructions += `当前系统配置的模板包含以下表格（请严格按照此结构提取信息）：\n\n`;
    tableStructure.sheets.forEach((sheetName: string, index: number) => {
      const headers = tableStructure.headers?.[sheetName] || [];
      const description = tableStructure.descriptions?.[sheetName] || '';
      // 提取自定义字段（排除流水号和唯一id）
      const customFields = headers.filter((h: string) => h !== '流水号' && h !== '唯一id');
      instructions += `${index + 1}. **${sheetName}**\n`;
      if (description) {
        instructions += `   - 表格用途：${description}\n`;
      }
      instructions += `   - 字段结构：[1:流水号, 2:唯一id`;
      customFields.forEach((field: string, fi: number) => {
        instructions += `, ${fi + 3}:${field}`;
      });
      instructions += `]\n`;
      instructions += `   - 需要提取的字段：${customFields.join('、')}\n\n`;
    });
    instructions += `\n`;
  } else {
    // 无表格模板结构信息时的提示：避免出现空白段落，引导 AI 按通用规则提取
    instructions += `\n\n【注意】当前无表格模板结构信息，AI 将根据通用规则提取信息。\n`;
    // 默认模板结构（备用）
    instructions += `\n\n【表格模板结构】\n`;
    instructions += `当前系统使用默认模板，包含以下表格（请严格按照此结构提取信息）：\n\n`;
    instructions += `1. **时空表格**\n`;
    instructions += `   - 表格用途：记录对话中提到的**时间和地点信息**（注意：只记录时间/地点，不包括在这些时间地点发生的角色行为或物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:日期, 4:时间, 5:地点, 6:此地角色]\n`;
    instructions += `   - 需要提取的字段：日期、时间、地点、此地角色\n`;
    instructions += `   - **分类判断**：如果实体是"时间"（日期/时刻）、"地点"（位置/场所），放入此表格；如果是角色/物品/事件，则分别放入对应表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "2024年1月15日晚上8点" → 放入时空表格（索引1）\n`;
    instructions += `     * "纽约中央公园" → 放入时空表格（索引1）\n`;
    instructions += `     * "朱迪在中央公园" → 地点放入时空表格，角色放入角色表格\n\n`;
    instructions += `2. **角色表格**\n`;
    instructions += `   - 表格用途：记录对话中出现的**人物角色**（注意：只记录真实的人物/生物/角色，不包括他们持有的物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:角色名, 4:身份, 5:关系, 6:特征, 7:备注]\n`;
    instructions += `   - 需要提取的字段：角色名、身份、关系、特征、备注\n`;
    instructions += `   - **分类判断**：如果实体是"人"、"角色"、"生物"、"动物"等**有生命的存在**，放入此表格；如果是无生命的物品/装备/道具，则必须放入物品表格\n\n`;
    instructions += `3. **社交表格**\n`;
    instructions += `   - 表格用途：记录对话中发生的**社交互动和日常事件**（注意：记录人与人之间的互动、对话、关系变化，不包括重大事件或物品）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:时间, 4:参与人, 5:事件, 6:结果, 7:备注]\n`;
    instructions += `   - 需要提取的字段：时间、参与人、事件、结果、备注\n`;
    instructions += `   - **分类判断**：如果实体是"互动行为"（对话/见面/合作/冲突）、"关系变化"、"日常活动"，放入此表格；如果是重大事件（如犯罪/事故/任务），则放入事件表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "朱迪和尼克一起调查案件" → 放入社交表格（索引3）\n`;
    instructions += `     * "朱迪向牛局长汇报工作" → 放入社交表格（索引3）\n`;
    instructions += `     * "朱迪获得了警官徽章" → 物品放入物品表格，获得行为可放入社交表格\n\n`;
    instructions += `4. **物品表格**\n`;
    instructions += `   - 表格用途：记录对话中提到的**物品、装备、道具等**（注意：角色持有的物品、装备、道具等必须放在此表格，不要放入角色表格）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:物品名, 4:类型, 5:描述, 6:状态, 7:备注/持有人]\n`;
    instructions += `   - 需要提取的字段：物品名、类型、描述、状态、备注/持有人\n`;
    instructions += `   - **分类判断**：如果实体是"物品"、"装备"、"道具"、"工具"、"武器"、"服装"、"饰品"等**无生命的物体**，放入此表格；如果实体是人物/角色，则放入角色表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "朱迪的警官徽章" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * "胡萝卜录音笔" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * "防狼喷雾" → 放入物品表格（索引4），不是角色表格！\n`;
    instructions += `     * 持有人信息应放在"备注/持有人"字段中，例如：{"3":"警官徽章","4":"身份证明","5":"朱迪的警官身份象征","6":"完好","7":"朱迪持有"}\n\n`;
    instructions += `5. **事件表格**\n`;
    instructions += `   - 表格用途：记录对话中发生的**重要事件**（注意：记录具有重大影响的事件，如犯罪/事故/任务/转折点，不包括日常社交互动）\n`;
    instructions += `   - 字段结构：[1:流水号, 2:唯一id, 3:时间, 4:事件名, 5:参与人, 6:描述, 7:影响, 8:备注]\n`;
    instructions += `   - 需要提取的字段：时间、事件名、参与人、描述、影响、备注\n`;
    instructions += `   - **分类判断**：如果实体是"重大事件"（犯罪/事故/任务/转折点/冲突爆发），放入此表格；如果是日常互动/对话/关系变化，则放入社交表格\n`;
    instructions += `   - 关键示例：\n`;
    instructions += `     * "中央公园发生抢劫案" → 放入事件表格（索引5）\n`;
    instructions += `     * "朱迪成功破获重大案件" → 放入事件表格（索引5）\n`;
    instructions += `     * "朱迪和尼克一起吃午饭" → 放入社交表格（索引3），不是事件表格！\n\n`;
  }

  // 追加当前表格状态
  if (memoryTableData && memoryTableData.trim()) {
    instructions += `\n【当前表格状态】\n${memoryTableData}\n`;
  } else {
    instructions += `\n【当前表格状态】当前无表格数据。发现新实体请用insertRow创建。\n`;
  }

  instructions += `\n【最终提醒】请务必在回复最后生成tableEdit标签，这是强制要求！\n`;

  return instructions;
}
