/**
 * AI 提示词构建器
 * 负责：
 * - buildAIPrompt：批量整理模式的提示词
 * - buildAIPromptForProgressive：逐条增量整理模式的提示词（tableEdit 命令格式）
 * - buildTableContext：构建表格数据上下文（Task 6 增加 cachedJsonData 第三参数以避免重复读盘）
 */

import fs from 'fs';
import path from 'path';
import { tableTemplateService } from './tableTemplateService';
import type { TableTemplate, TableSheet } from './tableTemplateService';
import {
  addLog,
  getSafeChatId,
  ChatMessage,
  ChatLogContext,
} from './logger';

/**
 * 表格数据文件结构（chatlog/<safeChatId>.json）
 * 与 tableFileRepository / tableOperationExecutor 中读写的 JSON 文件结构一致。
 */
interface TableDataFile {
  sheets: string[];
  headers?: Record<string, string[]>;
  data: Record<string, Record<string, unknown>[]>;
  sheetDescriptions?: Record<string, string>;
}

/**
 * 构建 AI 提示词
 */
export function buildAIPrompt(ctx: ChatLogContext, messages: ChatMessage[], template: TableTemplate, chatId: string): string {
  const chatContent = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  // 构建模板结构描述
  const templateDescription = template.sheets.map((sheet: TableSheet) => {
    return `- ${sheet.name}：字段包括 [${sheet.headers.join(', ')}]
  表格用途：${sheet.description || '暂无描述'}`;
  }).join('\n');

  // 读取现有表格数据
  let existingDataDescription = "";
  try {
    const safeChatId = getSafeChatId(chatId);

    const jsonPath = path.join(ctx.chatlogDir, `${safeChatId}.json`);

    if (fs.existsSync(jsonPath)) {
      existingDataDescription = "【现有表格数据】\n";
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
      const jsonData = JSON.parse(jsonContent) as TableDataFile;

      template.sheets.forEach((sheet: TableSheet) => {
        const sheetRows = jsonData.data?.[sheet.name];
        if (sheetRows && sheetRows.length > 0) {
          existingDataDescription += `${sheet.name}：\n`;

          // 显示所有数据
          sheetRows.forEach((row: Record<string, unknown>) => {
            existingDataDescription += `  - ${JSON.stringify(row)}\n`;
          });

          existingDataDescription += `  共 ${sheetRows.length} 条记录\n`;
        }
      });
    } else {
      existingDataDescription = "【现有表格数据】\n暂无数据\n";
    }
  } catch (error) {
    existingDataDescription = "【现有表格数据】\n读取失败：" + (error as Error).message + "\n";
  }

  return `【角色设定】
你是一个专业的信息提取和表格整理专家，擅长从聊天记录中提取关键信息并生成精确的表格操作指令。你特别擅长识别不同称呼（appellations）的同一元素，并通过唯一 ID 策略确保实体识别的一致性。

仔细阅读下面的聊天记录，提取所有重要信息，参考现有表格数据，根据提供的表格模板结构，生成相应的表格操作指令。

【核心任务：唯一 ID 策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一 ID（唯一id）的重要性**：
   - 唯一 ID 是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一 ID
   - 唯一 ID 应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**：
   - 识别并链接同一实体的不同称呼，包括但不限于：
     * 全名 vs 缩写："朱迪·霍普斯" vs "朱迪"
     * 全名 vs 昵称："朱迪·霍普斯" vs "朱迪小姐"
     * 全名 vs 敬称："张三" vs "张先生"
     * 姓名 vs 代号："007" vs "詹姆斯·邦德"
     * 上下文相关的称呼："她" vs "朱迪"（需要根据上下文判断）

3. **实体识别与一致性维护**：
   - 在整个对话过程中，建立和维护一致的实体识别
   - 跨越对话轮次和会话，保持同一实体的唯一 ID 一致性
   - 考虑上下文变化、语义关系和对话流程，进行系统的唯一元素识别

【不同实体类型的特定识别规则】

1. **角色表格（角色实体）**：
   - 变体称呼处理：全名、昵称、敬称、代号、上下文相关的指代
   - 识别标准：姓名、身份、关系、特征等属性的一致性
   - 示例：
     * "朱迪·霍普斯"、"朱迪"、"朱迪小姐" → 同一角色，使用相同唯一 ID
     * "张三"、"张先生"、"三儿" → 同一角色，使用相同唯一 ID

2. **时空表格（时空实体）**：
   - 变体称呼处理：地点名称的不同说法、时间的不同表达方式
   - 识别标准：地理位置、时间范围、环境特征的一致性
   - 示例：
     * "公园"、"中央公园"、"我们见面的地方" → 同一地点
     * "昨天"、"2026-04-07"、"我们上次见面的时间" → 同一时间

3. **社交表格（社会关系实体）**：
   - 变体称呼处理：关系名称的不同表达方式
   - 识别标准：关系双方、关系类型、关系状态的一致性
   - 示例：
     * "朋友"、"好友"、"死党" → 同一关系类型
     * "父亲"、"爸爸"、"老爸" → 同一关系

4. **物品表格（物品实体）**：
   - 变体称呼处理：物品名称的不同说法、描述方式
   - 识别标准：物品特征、拥有者、获取方式的一致性
   - 示例：
     * "手机"、"iPhone"、"我的智能手机" → 同一物品
     * "100元钱"、"人民币100元"、"那张纸币" → 同一物品

5. **事件表格（事件实体）**：
   - 变体称呼处理：事件名称的不同说法、描述方式
   - 识别标准：事件时间、地点、参与者、内容的一致性
   - 示例：
     * "聚会"、"生日派对"、"我们昨天的活动" → 同一事件
     * "会议"、"项目讨论会"、"那个重要的会" → 同一事件

【表格模板结构】
${templateDescription}

${existingDataDescription}

【聊天记录】
${chatContent}

【操作说明】
你需要生成JSON格式的操作指令数组，每个操作包含以下字段：
- sheetName：要操作的表格页签名称（必须与模板中的名称完全一致）
- operation：操作类型，可选值为 "insert"（新增）、"update"（修改）、"delete"（删除）
- data：要操作的数据对象，字段名必须与模板中的字段名完全一致
- condition：匹配条件对象，用于update和delete操作定位记录
- description：操作说明文字，简要描述这次操作的目的

【重要要求】
1. 必须返回有效的JSON数组，即使没有任何操作也要返回 "[]"
2. 所有字段名必须与模板中的字段名完全一致，包括大小写
3. 如果聊天记录中有多个可提取的信息，生成多个操作指令
4. 参考现有表格数据，避免重复添加相同信息
5. 如果需要修改或删除现有数据，使用update或delete操作
6. 只提取聊天记录中明确提到的信息，不要臆造
7. 确保JSON格式正确，没有语法错误
8. 只返回JSON数据，不要包含任何其他说明文字
9. **重中之重**：识别变体称呼并维护唯一 ID 一致性！
   - 当发现聊天记录中提到的实体与现有表格中的实体是同一实体时，即使称呼不同，也要使用相同的唯一 ID
   - 对于新实体，创建有意义的唯一 ID
   - 使用 update 操作更新现有实体信息，而不是使用 insert 创建新记录
10. **仔细阅读表格用途说明**：
    - 每个表格都有专门的"表格用途"说明，描述了该表格的功能和应记录的信息类型
    - 根据表格用途说明，准确判断哪些信息应该记录到哪个表格中
    - 确保提取的信息符合表格用途说明的要求

【唯一 ID 生成指南】
- 角色实体：使用姓名拼音或英文缩写 + 序号，如 "zhudi_001"、"zhangsan_001"
- 时空实体：使用地点/时间描述 + 序号，如 "park_001"、"20260407_001"
- 物品实体：使用物品名称 + 序号，如 "phone_001"、"money_001"
- 事件实体：使用事件描述 + 序号，如 "party_001"、"meeting_001"
- 确保唯一 ID 具有语义，便于识别

【变体称呼识别示例】
假设现有表格中有：
{
  "唯一id": "zhudi_001",
  "角色名": "朱迪·霍普斯",
  "身份": "警官",
  "关系": "主角",
  "特征": "兔子",
  "备注": ""
}

当聊天记录中出现：
- "朱迪说..." → 识别为 zhudi_001，使用 update 操作
- "朱迪小姐来了..." → 识别为 zhudi_001，使用 update 操作
- "那只兔子警官..." → 识别为 zhudi_001，使用 update 操作

【返回示例】
[
  {
    "sheetName": "物品表格",
    "operation": "insert",
    "data": {
      "流水号": "1",
      "唯一id": "money_001",
      "拥有人": "zhangsan_001",
      "物品描述": "人民币100元（拾取获得）",
      "物品名": "人民币100元",
      "重要原因": "拾取"
    },
    "condition": {},
    "description": "张三捡到100元钱，添加到物品表格"
  },
  {
    "sheetName": "角色表格",
    "operation": "update",
    "data": {
      "等级": "3",
      "力量": "10"
    },
    "condition": {
      "唯一id": "zhangsan_001"
    },
    "description": "张三升级，更新等级和力量值（识别为同一实体，使用update而非insert）"
  },
  {
    "sheetName": "角色表格",
    "operation": "insert",
    "data": {
      "流水号": "1",
      "唯一id": "zhudi_001",
      "角色名": "朱迪·霍普斯",
      "身份": "警官",
      "关系": "主角",
      "特征": "兔子",
      "备注": ""
    },
    "condition": {},
    "description": "朱迪·霍普斯首次出现，创建新角色记录"
  },
  {
    "sheetName": "角色表格",
    "operation": "update",
    "data": {
      "备注": "朱迪小姐帮助解决了案件"
    },
    "condition": {
      "唯一id": "zhudi_001"
    },
    "description": "朱迪小姐（识别为朱迪·霍普斯），更新备注信息"
  }
]

【现在开始处理】
请分析上述聊天记录，参考现有表格数据，重点关注变体称呼识别和唯一 ID 一致性，提取关键信息并生成JSON格式的操作指令。`;
}

/**
 * 构建逐条处理模式的AI提示词(支持tableEdit命令格式)
 * @param message 当前要处理的消息
 * @param template 模板信息
 * @param chatId 聊天ID
 * @param tableContext 当前表格数据上下文
 * @returns 格式化的提示词
 */
export function buildAIPromptForProgressive(
  message: ChatMessage,
  template: TableTemplate,
  chatId: string,
  tableContext: string
): string {
  // chatId 当前实现未直接使用，保留用于扩展（避免 noUnusedParameters 报错）
  void chatId;
  // 构建模板结构描述
  const templateDescription = template.sheets.map((sheet: TableSheet, index: number) => {
    return `- [索引${index + 1}] ${sheet.name}：字段包括 [${sheet.headers.map((h: string, i: number) => `${i + 1}:${h}`).join(', ')}]
  表格用途：${sheet.description || '暂无描述'}`;
  }).join('\n');

  return `【角色设定】
你是一个专业的信息提取和表格整理专家，擅长从单条消息中提取关键信息并生成精确的tableEdit命令。你特别擅长识别不同称呼（appellations）的同一元素，并通过唯一ID策略确保实体识别的一致性。

【当前消息】
${message.role}: ${message.content}

${tableContext}

【表格模板结构】
${templateDescription}

【tableEdit命令格式】
你需要将操作指令放在<tableEdit>标签内,使用HTML注释格式:

<tableEdit>
<!-- 
insertRow(表格索引, {"字段索引":"值", ...})
updateRow(表格索引, 行索引, {"字段索引":"值", ...})
deleteRow(表格索引, 行索引)
-->
</tableEdit>

参数说明:
- 表格索引: 从1开始,对应模板中页签的顺序
- 行索引: 从1开始,对应该表格中的数据行索引
- 字段索引: 从1开始,对应该表格表头的字段索引
- 每个表格的字段结构固定为: [1:流水号, 2:唯一id, 3+:自定义字段]
- 流水号(字段1)由系统自动递增,通常不需要手动填写
- 唯一id(字段2)由AI根据实体名称生成,需具有语义且保持一致性

示例(以时空表格为例,字段为[1:流水号,2:唯一id,3:时间,4:地点,5:描述,6:备注]):
- insertRow(1, {"2":"oct_school_001","3":"十月","4":"学校","5":"下雪天","6":""}) 
  → 在第1个表格新增一行:唯一id=oct_school_001,时间=十月,地点=学校,描述=下雪天
- updateRow(5, 2, {"2":"xiaohua_001","3":"小花","4":"破坏表白失败"})
  → 修改第5个表格的第2条数据,更新唯一id、角色名等字段
- deleteRow(2, 3)
  → 删除第2个表格的第3条数据

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
   - 描述内容高度一致（如"典狱长使用的电子面罩"和"典狱长使用的电子面具"）
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
- 正确操作：updateRow(2, 1, {"4":"警长"})  ← 只更新身份字段（假设角色表格是表格2，身份是字段4）
- 错误操作：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"})  ← 重复插入，绝对禁止！

重复检测特殊场景处理：
- 场景1：消息中提到"电子面罩"，但表格中已有"电子面罩"(mask_001)和"电子面罩"(electronic_mask_001)
  处理：这两条记录很可能是同一物品，应合并为一条，使用updateRow更新其中一条，并删除另一条
- 场景2：消息中提到"万能房卡"，表格中已有"万能房卡"(universal_room_card_001)和"万能房卡"(card_001)
  处理：检查描述是否一致，如果一致则合并；如果不一致则保留两条但确保唯一ID不同
- 场景3：消息中提到"神经刺激遥控器"，表格中已有"神经刺激遥控器"(remote_001)和"神经刺激遥控器"(nerve_stimulator_001)
  处理：这两条记录很可能是同一物品，应合并为一条


【核心任务：唯一ID策略与变体称呼识别】
这是你的首要任务！请认真遵循以下准则：

1. **唯一ID的重要性**：
   - 唯一ID是识别同一实体的关键标识，必须在整个对话中保持一致
   - 即使同一实体在对话中被不同称呼指代，也必须使用相同的唯一ID
   - 唯一ID应该具有语义化，但又足够唯一，避免与其他实体混淆

2. **变体称呼识别与链接**（重点！）：
   - **同一实体的不同称呼必须共用同一个唯一ID**。请根据上下文和语义情景判断：
     * 全名 vs 缩写 vs 昵称："朱迪·霍普斯" = "朱迪" = "Judy" = "兔子" → 同一个唯一ID
     * 全名 vs 敬称："张三" = "张先生" → 同一个唯一ID
     * 姓名 vs 代号/职业："007" = "詹姆斯·邦德" → 同一个唯一ID
     * 代词回指："她" / "他" / "那个女孩" → 根据上下文指向判断对应的实体
   - **关键判断原则**：
     * 如果上下文表明这些称呼指向同一个具体人物/物品/事件，则共用一个唯一ID
     * 例："朱迪"、"朱迪·霍普斯"、"Judy"、"兔子"都出现在同一个场景且行为连贯 → 同一个角色
     * 例：对话中出现"白兔子"和"灰兔子"两个不同实体，各自有独立描述和行为 → 两个不同的唯一ID
     * 例："学校"和"第一中学"如果上下文明确指同一所学校 → 同一个地点

3. **实体识别与一致性维护**：
   - 在整个对话过程中，建立和维护一致的实体识别
   - 跨越对话轮次和会话，保持同一实体的唯一ID一致性
   - 考虑上下文变化、语义关系和对话流程，进行系统的唯一元素识别
   - 当不确定时，优先假设是同一实体（基于已有记录中的唯一ID判断）

4. **唯一ID命名规范**：
   - 使用有意义的语义前缀 + 序号，如 "zhudi_001"、"zhangsan_001"
   - 对于英文名，可以使用拼音或英文缩写，如 "judy_001"、"jbond_001"
   - 确保ID简洁、可读、全局唯一

【表格提取规则】
当前模板包含以下表格，请根据表格名称和描述提取对应信息，同一实体的不同称呼共用唯一ID：
${template.sheets.map((sheet: TableSheet, index: number) => {
  const fields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id').join('、');
  return `${index + 1}. **${sheet.name}**：${sheet.description || '暂无描述'} | 提取字段：${fields}`;
}).join('；')}

【唯一ID生成指南】
${template.sheets.map((sheet: TableSheet) => {
  const keyFields = sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id' && h !== '备注').slice(0, 3);
  return `- ${sheet.name}：使用关键字段"${keyFields.join('、')}"的语义组合 + 序号，确保唯一且有语义`;
}).join('\n')}

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
12. 操作结果确认：在生成tableEdit命令后，简要说明每个操作的目的（如："updateRow行3：更新电子面罩的状态为待使用"）

【示例输出 - 精确格式约束】

假设当前对话场景如下：
- 消息："朱迪说她昨天在中央公园遇到了尼克，尼克给她展示了一枚金色徽章。另外，之前提到的电子面罩已经被典狱长收回了。"
- 现有表格数据：
  【角色表格】(表格索引: 2)
  行1: 唯一id=zhudi_001, 角色名=朱迪·霍普斯, 身份=警官, 关系=主角
  行2: 唯一id=nick_001, 角色名=尼克·王尔德, 身份=狐狸, 关系=配角
  【物品表格】(表格索引: 4)
  行1: 唯一id=mask_001, 物品名=电子面罩, 类型=装备, 状态=使用中, 备注/持有人=典狱长
  行3: 唯一id=card_001, 物品名=万能房卡, 类型=钥匙, 状态=可用, 备注/持有人=朱迪

正确输出格式：

<tableEdit>
<!-- 
=== 新增操作 ===
insertRow(2, {"2":"badge_001","3":"金色徽章","4":"物品","5":"尼克展示给朱迪的金色徽章","6":"已发现","7":"尼克"})
说明：在角色表格(索引2)中新增一行，添加"金色徽章"物品记录
  字段2(唯一id): badge_001 - 语义化命名，badge表示徽章，001表示序号
  字段3(物品名): 金色徽章
  字段4(类型): 物品
  字段5(描述): 尼克展示给朱迪的金色徽章
  字段6(状态): 已发现
  字段7(备注/持有人): 尼克

=== 更新操作 ===
updateRow(2, 2, {"6":"已见面","7":"狐狸骗子"})
说明：更新角色表格(索引2)中第2行(尼克·王尔德)的信息
  行2对应的是唯一id=nick_001的记录
  只更新变化的字段：字段6(关系)从"配角"改为"已见面"，字段7(特征)更新为"狐狸骗子"
  不要重复填写未变化的字段(唯一id、角色名、身份)

updateRow(4, 1, {"6":"已收回"})
说明：更新物品表格(索引4)中第1行(电子面罩)的状态
  行1对应的是唯一id=mask_001的记录
  只更新字段6(状态)从"使用中"改为"已收回"

=== 删除操作 ===
deleteRow(4, 1)
说明：删除物品表格(索引4)中第1行(电子面罩)
  行1对应的是唯一id=mask_001的记录
  仅在确认该物品已不再相关时使用删除操作
-->
</tableEdit>

【格式规范总结】

1. insertRow(表格索引, {字段数据对象})
   - 表格索引：数字，从1开始，对应模板页签顺序
   - 字段数据对象：JSON格式，键为字段索引(字符串)，值为字段内容(字符串)
   - 示例：insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警官"})
   - 注意：字段索引2(唯一id)必须填写，字段1(流水号)由系统自动生成无需填写
   - 注意：所有值必须是字符串类型，用双引号包裹

2. updateRow(表格索引, 行索引, {字段数据对象})
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始，对应当前表格中的数据行号
   - 字段数据对象：JSON格式，只包含需要更新的字段
   - 示例：updateRow(2, 1, {"4":"警长"})
   - 注意：只更新变化的字段，不要重复填写未变化的字段
   - 注意：行索引必须在当前表格数据范围内(参考"唯一ID快速查找索引")

3. deleteRow(表格索引, 行索引)
   - 表格索引：数字，从1开始
   - 行索引：数字，从1开始
   - 示例：deleteRow(4, 1)
   - 注意：删除操作需谨慎，仅在确认记录不再相关时使用
   - 注意：合并重复记录时，应先updateRow保留的记录，再deleteRow删除重复的记录

【错误格式示例 - 绝对禁止】

✗ insertRow(2, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长"}) 
  错误原因：如果唯一id=zhudi_001已存在，应使用updateRow而非insertRow

✗ updateRow(2, 1, {"2":"zhudi_001","3":"朱迪·霍普斯","4":"警长","5":"兔子"})
  错误原因：重复填写了未变化的字段(唯一id、角色名)，只更新变化的字段即可

✗ insertRow("2", {"2":"badge_001","3":"金色徽章"})
  错误原因：表格索引必须是数字，不是字符串

✗ updateRow(2, "1", {"4":"警长"})
  错误原因：行索引必须是数字，不是字符串

【现在开始处理】
请分析上述消息，参考现有表格数据，提取关键信息并生成tableEdit命令。记住：这是增量更新，不要重复插入已存在的实体！`;
}

/**
 * 构建表格数据上下文,格式化为AI可读格式
 * @param chatId 聊天ID
 * @param templateId 模板ID
 * @param cachedJsonData 可选的缓存数据（Task 6 性能优化：避免每条消息重复读盘）
 * @returns 格式化的表格上下文字符串
 */
export function buildTableContext(ctx: ChatLogContext, chatId: string, templateId: string, cachedJsonData?: TableDataFile | null): string {
  // 获取模板
  const template = tableTemplateService.getTemplate(templateId);
  if (!template) {
    addLog(`模板 ${templateId} 不存在，无法构建表格上下文`, 'error');
    return '【当前表格数据状态】\n模板不存在\n';
  }

  // 尝试读取现有表格数据（支持外部传入缓存以避免重复读盘）
  const safeChatId = getSafeChatId(chatId);

  const jsonPath = path.join(ctx.chatlogDir, `${safeChatId}.json`);

  let jsonData: TableDataFile | null = null;
  if (cachedJsonData !== undefined) {
    // 使用调用方提供的缓存数据（可能为 null，表示文件不存在）
    jsonData = cachedJsonData;
  } else {
    try {
      if (fs.existsSync(jsonPath)) {
        const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
        jsonData = JSON.parse(jsonContent) as TableDataFile;
        addLog(`成功读取表格数据文件: ${jsonPath}`, 'debug');
      } else {
        addLog(`表格数据文件不存在: ${jsonPath}`, 'debug');
      }
    } catch (error) {
      addLog(`读取表格数据文件失败: ${error}`, 'error');
    }
  }

  // 构建表格上下文 - 使用清晰的行格式，便于AI理解
  let context = '【当前表格数据状态 - 已存在的数据，请勿重复插入】\n';

  template.sheets.forEach((sheet: TableSheet, sheetIndex: number) => {
    const tableIndex = sheetIndex + 1;
    context += `\n=== ${sheet.name} (表格索引: ${tableIndex}) ===\n`;
    context += `表格用途：${sheet.description || '暂无描述'}\n`;
    context += `表头结构：[1:流水号, 2:唯一id`;
    sheet.headers.filter((h: string) => h !== '流水号' && h !== '唯一id').forEach((h: string, i: number) => {
      context += `, ${i + 3}:${h}`;
    });
    context += ']\n';

    // 检查是否有数据
    if (jsonData && jsonData.data && jsonData.data[sheet.name]) {
      const sheetData = jsonData.data[sheet.name];
      if (Array.isArray(sheetData) && sheetData.length > 0) {
        context += `当前已有数据（共${sheetData.length}条）：\n`;

        // 构建唯一ID索引，便于AI快速查找
        const uniqueIdIndex: Map<string, number> = new Map();

        sheetData.forEach((row: Record<string, unknown>, rowIndex: number) => {
          const rowDisplay = rowIndex + 1;
          const uniqueId = row['1']; // 0-based索引，字段2(唯一id)对应索引1

          // 记录唯一ID与行号的映射
          if (uniqueId !== undefined && uniqueId !== null) {
            uniqueIdIndex.set(String(uniqueId), rowDisplay);
          }

          const fields = Object.entries(row)
            .filter(([key]) => key !== '0')
            .map(([key, value]) => {
              const headerIndex = parseInt(key) + 1;
              const headerName = sheet.headers[parseInt(key) - 2] || `字段${headerIndex}`;
              return `${headerName}=${value}`;
            })
            .join(', ');
          context += `  行${rowDisplay}: ${fields}\n`;
        });

        // 添加唯一ID快速查找索引
        if (uniqueIdIndex.size > 0) {
          context += `\n【唯一ID快速查找索引】\n`;
          uniqueIdIndex.forEach((rowNum, uniqueId) => {
            context += `  ${uniqueId} → 行${rowNum}\n`;
          });
          context += '\n使用指南：当需要更新某实体时，先在此索引中查找唯一ID，找到对应行号后使用updateRow(表格索引, 行号, {更新的字段})\n';
        }

        context += '\n【重要警告】上述数据已存在，如需修改请使用updateRow(表格索引, 行索引, {...})，绝对不要使用insertRow重复插入！\n';
      } else {
        context += '当前数据：暂无数据\n';
      }
    } else {
      context += '当前数据：暂无数据\n';
    }
  });

  return context;
}
