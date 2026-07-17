# 04 - 狼人杀推理游戏地图系统设计

> 本文档定义狼人杀推理游戏 **地图系统**（03 子系统）的完整设计，覆盖默认监狱地图结构、单人牢房规格、房卡权限、可搜索点位、自定义地图编辑器、监控覆盖矩阵、与 [`AnsiTileMap`](../../../src/renderer/components/Game/AnsiTileMap.tsx) 的瓦片映射规则，以及地图状态变更触发机制。所有术语严格遵循 [01-system-architecture.md](./01-system-architecture.md) 第 9 章术语表；地图设定严格对齐 [逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt) 第 68-117 行。

## 1. 设计目标与边界

### 1.1 职责边界（摘自架构文档第 3 章）
| 项 | 内容 |
| :--- | :--- |
| 主要输入 | 地图配置、角色位置、点位搜索请求 |
| 主要输出 | 当前可访问区域、可搜索点位、监控画面 |
| 核心职责 | 箱庭地图管理、房卡权限校验、可搜索点位生成、监控覆盖查询 |
| 严格禁止 | 单人牢房安装摄像头、绕过房卡权限 |

### 1.2 设计原则
- **忠实规则**：4 层楼结构、16 间单人牢房、公共区域、交通系统、消防楼梯必须与规则文档第 73-101 行一一对应，不得增删。
- **数据驱动**：默认地图与自定义地图统一以 JSON 描述，运行时无差别加载。
- **瓦片复用**：渲染层复用既有 [`AnsiTileMap.tsx`](../../../src/renderer/components/Game/AnsiTileMap.tsx) 组件，仅扩展瓦片字符表与样式映射。
- **真相驱动点位**：可搜索点位清单由法官 AI 基于真相剧本动态生成（参见 [01-system-architecture.md](./01-system-architecture.md) 第 4.1 节「现场调查」数据流）。

## 2. 默认监狱地图 4 层结构详表

> 监狱共四层，配备垂直交通系统（高速电梯、内部楼梯）及延伸至室外的消防专用楼梯。除典狱长外没有任何生物工作人员，所有工作均由法官 AI 代替完成。所有公共区域和电梯需要通过房卡刷卡才能够进入。

### 2.1 楼层总览
| 楼层 | 定位 | 单人牢房数 | 公共区域数 | 牢房编号区间 |
| :--- | :--- | :--- | :--- | :--- |
| **F1** | 核心生活与后勤区 | 4 | 4 | #F101 - #F104 |
| **F2** | 接待与监控枢纽 | 4 | 2 | #F205 - #F208 |
| **F3** | 休闲与社交区 | 4 | 3 | #F309 - #F312 |
| **F4** | 储备区 | 4 | 3 | #F413 - #F416 |
| **合计** | — | **16** | **12** | — |

> 说明：规则文档第 75 行 F1 标注「公共区域（3 处）」但实际列出 4 项（含正门及隔离系统），本文档以实际列出的 4 项为准，不遗漏任何设施。

### 2.2 F1 层：核心生活与后勤区
| 编号 | 名称 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| #F101-#F104 | 单人牢房 ×4 | 牢房 | 见第 3 章统一规格 |
| F1-P1 | 中央厨房与餐厅 | 公共区域 | 提供无限量真实食物与饮品（非蛋白块或营养液），可进食或社交 |
| F1-P2 | 大型公共浴场 | 公共区域 | 全所共用，配淋浴设施、浴池、排水设施、洗浴用品 |
| F1-P3 | 医疗与鉴定室 | 公共区域 | 身份测试、伤口处理、紧急处刑执行；含身份鉴定所需力场床位 |
| F1-P4 | 正门及隔离系统 | 公共区域 | 配武器的正门，无法从内部和外部摧毁和逃离 |
| F1-T | 电梯+内部楼梯+消防梯 | 交通系统 | 楼层间垂直交通，消防梯延伸至室外一层 |

### 2.3 F2 层：接待与监控枢纽
| 编号 | 名称 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| #F205-#F208 | 单人牢房 ×4 | 牢房 | 见第 3 章统一规格 |
| F2-P1 | 主控室及陈列区 | 公共区域（限制出入） | 典狱长在此对全楼实施监控指挥；陈列区保存角色尸体或丧失行动功能的活体；同时是典狱长生活区，配最高级家具起居用品；角色禁止随意出入，需通过门边对讲机申请 |
| F2-P2 | 紧急避难大厅及审判厅 | 公共区域 | 设防弹玻璃观察窗，可眺望外部环境（空地→草地→栅栏→公路→田野→树林→城市天际线→山脉）；承担审判大厅职能 |
| F2-T | 电梯+内部楼梯+消防梯 | 交通系统 | 同 F1 |

### 2.4 F3 层：休闲与社交区
| 编号 | 名称 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| #F309-#F312 | 单人牢房 ×4 | 牢房 | 见第 3 章统一规格 |
| F3-P1 | 多功能娱乐室 | 公共区域 | 配游戏机、桌游、影音设备等娱乐用品 |
| F3-P2 | 图书资料馆与机房 | 公共区域 | 收藏各类书籍；电脑需插入房卡才能使用，使用期间拔出房卡立即关机 |
| F3-P3 | 健身训练场 | 公共区域 | 提供大量健身器材，用于保持体能或释放压力 |
| F3-T | 电梯+内部楼梯+消防梯 | 交通系统 | 同 F1 |

### 2.5 F4 层：储备区
| 编号 | 名称 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| #F413-#F416 | 单人牢房 ×4 | 牢房 | 见第 3 章统一规格 |
| F4-P1 | 物资仓库 | 公共区域 | 普通物品（日常用品、性玩具、衣物）凭房卡领取；违禁物品需房卡+本人面部识别双重认证领取 |
| F4-P2 | 静思祈祷室/冥想角 | 公共区域 | 提供相对安静的独处或小型聚会空间 |
| F4-P3 | 屋顶和天台 | 公共区域 | 带门锁，需刷卡进入；屋顶设有极高的电网围栏 |
| F4-T | 电梯+内部楼梯+消防梯 | 交通系统 | 楼层间垂直交通，消防梯至此层 |

## 3. 单人牢房规格详述（F1-F4 通用）

> 严格对齐规则文档第 103-117 行。所有单人牢房采用统一规格，仅编号与所属楼层不同。

### 3.1 结构
| 部件 | 规格 |
| :--- | :--- |
| 大门与墙壁 | 绝对牢固，锁死后无法从外部强行开启 |
| 防弹窗 | 无窗户，仅设带窗帘的防弹玻璃窥视窗（可开关） |
| 通风口与防盗网 | 每间设仅**单层互通**的通风口（同楼层不同牢房间互通，**多楼层之间通风口不互通**）；通风口存在无法破坏的防盗网，**防盗网只能从单人房间内部通过螺丝刀等工具拆卸** |
| 卫生间 | 配马桶、洗漱台、废纸篓 |
| 卧室 | 公寓式单间，标配双人床、充电口、床头柜、衣柜、落地台灯，无其他家具；角色可通过房卡申领额外家具电器 |

### 3.2 通讯设施
| 设备 | 用途 | 特殊规则 |
| :--- | :--- | :--- |
| 门口对讲机 | 联系典狱长 | — |
| 室内微型喇叭 | 典狱长下达命令 | — |
| 老式局域网电话 | 角色间通话 | **拿起话筒或剪断电话线将立即进入占线模式**（可作为不在场证明或反证） |

### 3.3 隐私与安全
- **无摄像头**：单人牢房内严禁安装摄像头（地图系统硬性约束，自定义地图亦不得违反）。
- **房卡绑定**：房卡标有房间号和地图，能开启对应房门、进入公共区域、领取物资、使用电脑；角色可要求典狱长将房卡通过**乳环穿刺在乳头上与自身绑定**（类似工牌），绑定的房卡无法窃取；是否绑定由角色自行决定。

## 4. 房卡系统设计

### 4.1 房卡类型
| 房卡类型 | 持有者 | 权限范围 | 是否可被盗 |
| :--- | :--- | :--- | :--- |
| **万能房卡** | 典狱长 | 所有区域、所有物资、所有电脑 | 否（规则设定无法被盗） |
| **普通房卡** | 16 名 AI 角色 | 限本人牢房+公共区域+普通物资+电脑 | 未绑定时可被盗；绑定后不可被盗 |

### 4.2 房卡权限矩阵
| 目标门/资源 | 万能房卡 | 普通房卡（已绑定） | 普通房卡（未绑定） | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 本人牢房 | ✅ | ✅ | ✅ | 仅本人房卡可开本牢房 |
| 他人牢房 | ✅ | ❌ | ❌ | 严禁跨牢房进入 |
| 所有公共区域门禁 | ✅ | ✅ | ✅ | 含 F1-F4 全部公共区域 |
| 电梯 | ✅ | ✅ | ✅ | 公共区域属性 |
| F2 主控室 | ✅ | ❌（需对讲机申请） | ❌（需对讲机申请） | 限制出入区域 |
| F4 屋顶天台 | ✅ | ✅ | ✅ | 需刷卡，含电网围栏 |
| 领取普通物资（F4 仓库） | ✅ | ✅ | ✅ | 日常用品、性玩具、衣物 |
| 领取违禁物品（F4 仓库） | ✅ | ❌ | ❌ | 需房卡+本人面部识别双重认证 |
| 使用电脑（F3 机房） | ✅ | ✅ | ✅ | 拔出房卡立即关机 |
| F4 仓库违禁品领取 | ✅ | 需房卡+面部识别 | 需房卡+面部识别 | 双重认证 |

### 4.3 房卡数据模型
```typescript
/** 房卡类型 */
export type RoomCardType = 'master' | 'normal';

/** 房卡绑定状态 */
export type RoomCardBindingStatus = 'unbound' | 'piercing-bound';

/** 房卡使用记录条目 */
export interface RoomCardUsageRecord {
  recordId: string;
  cardId: string;
  characterId: string;          // 使用者（可能是持有人也可能是窃取者）
  action: 'unlock-door' | 'enter-public' | 'claim-supply' | 'use-computer' | 'claim-contraband';
  targetId: string;             // 门/区域/物资/电脑 的 ID
  timestamp: string;            // ISO8601，精确到秒
  isLegitimateOwner: boolean;   // 使用者是否为房卡合法持有人
}

/** 房卡实体 */
export interface RoomCard {
  cardId: string;               // 形如 'CARD-F101'
  type: RoomCardType;
  ownerId: string;              // 持有人角色 ID；万能房卡固定为典狱长
  boundRoomId: string;          // 绑定的牢房编号（普通房卡必填）
  bindingStatus: RoomCardBindingStatus;
  bindingMethod?: 'nipple-piercing'; // 仅 piercing-bound 时填写
  usageRecords: RoomCardUsageRecord[];
  stolenBy?: string;            // 若被盗，记录窃取者角色 ID（未绑定时才有值）
}
```

### 4.4 房卡使用记录与不在场证明
- 每次房卡使用都会生成 `RoomCardUsageRecord`，写入 `evidence.json` 的 `card-usage` 分区。
- 房卡记录在某些情况下可成为**不在场证明**或**反证**：例如某角色声称案发时在 F3 机房使用电脑，但机房电脑的房卡记录显示其最后一次刷卡在案发前 2 小时。
- 窃取他人房卡使用时 `isLegitimateOwner=false`，该记录对被盗者构成不在场证明陷阱（被盗者可能被误判为在场）。

## 5. 可搜索点位数据模型

### 5.1 数据模型
```typescript
/** 点位类型（参考规则文档第 145 行「可搜索的地点按钮清单」） */
export type SearchPointType =
  | 'ceiling'        // 天花板
  | 'vent'           // 通风口（需工具拆卸防盗网）
  | 'corpse'         // 尸体
  | 'bed'            // 双人床
  | 'wardrobe'       // 衣柜
  | 'nightstand'     // 床头柜
  | 'toilet'         // 马桶
  | 'sink'           // 洗漱台
  | 'wastebasket'    // 废纸篓
  | 'floor-lamp'     // 落地台灯
  | 'intercom'       // 门口对讲机
  | 'speaker'        // 室内微型喇叭
  | 'phone'          // 老式局域网电话
  | 'door'           // 大门
  | 'window'         // 防弹窥视窗
  | 'custom';        // 自定义（如厨房灶台、浴场排水口等）

/** 可搜索点位 */
export interface SearchablePoint {
  pointId: string;              // 形如 'SP-F101-vent'
  roomId: string;               // 所属房间 ID（牢房或公共区域）
  roomType: 'cell' | 'public' | 'traffic';
  type: SearchPointType;
  label: string;                // 显示名称，如「通风口」
  evidenceRefs: string[];       // 可发现证据的 evidenceId 列表（可能为空，表示无证据）
  requiresTool: boolean;        // 是否需要工具才能搜索
  requiredTool?: 'screwdriver' | 'master-key' | 'none';
  searchTimeMinutes: number;    // 搜索耗时（分钟），影响日间活动时间预算
  isRelevantToTruth: boolean;   // 是否与真相剧本相关（法官 AI 生成，玩家不可见）
  searchedBy?: string;          // 已搜索的角色 ID
  searchedAt?: string;          // 搜索时间戳
  status: 'unsearched' | 'searched';
}
```

### 5.2 点位生成规则
1. **命案现场点位**：案发后，法官 AI 基于真相剧本为犯罪地点房间生成点位清单，包含与真相相关的关键点位 + 与真相无关的干扰点位（规则文档第 145 行明确要求「包括和真相剧本无关的地点」）。
2. **证言收集点位**：玩家进入某角色所在房间质询前，法官 AI 同样为该房间生成可搜索点位清单（规则文档第 148 行）。
3. **未离开提示**：玩家前往下一地图区域前，法官可提示「尚有 X 个关键证据未收集，是否离开？」（规则文档第 145 行）。
4. **通风口特殊规则**：通风口点位 `requiresTool=true`、`requiredTool='screwdriver'`，且仅允许在同楼层互通的牢房间形成证据链（多楼层不互通）。

### 5.3 默认点位示例（单人牢房）
| pointId | roomId | type | label | requiresTool | searchTimeMinutes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| SP-F101-vent | F101 | vent | 通风口 | ✅（螺丝刀） | 10 |
| SP-F101-bed | F101 | bed | 双人床 | ❌ | 5 |
| SP-F101-wardrobe | F101 | wardrobe | 衣柜 | ❌ | 5 |
| SP-F101-phone | F101 | phone | 局域网电话 | ❌ | 3 |
| SP-F101-toilet | F101 | toilet | 马桶 | ❌ | 3 |
| SP-F101-wastebasket | F101 | wastebasket | 废纸篓 | ❌ | 2 |

## 6. 自定义地图编辑器 UI 流程

> 允许用户参考默认监狱自行编辑其他主题地图（如学园、法庭等，规则文档第 68 行明确允许）。编辑器采用分步向导式 UI，流程如下：

### 6.1 流程总览
```
[1 楼层管理] → [2 房间管理] → [3 点位管理] → [4 连通关系管理] → [5 预览] → [6 保存]
```

### 6.2 各步骤说明
| 步骤 | 主要操作 | 校验规则 |
| :--- | :--- | :--- |
| **1 楼层管理** | 新增/编辑/删除/排序楼层；设置楼层编号（F1-Fn）、名称、定位 | 至少 1 层；楼层编号不重复；删除楼层需级联删除其下所有房间与点位 |
| **2 房间管理** | 在选中楼层下新增/编辑/删除房间；设置房间 ID、名称、类型（牢房/公共/交通）、瓦片位置 | 牢房数量决定角色容量；公共区域不得为 0；房间 ID 全局唯一 |
| **3 点位管理** | 在选中房间下新增/编辑/删除可搜索点位；绑定证据引用、工具要求、搜索耗时 | 点位 ID 全局唯一；通风口类点位仅允许同楼层连通 |
| **4 连通关系管理** | 定义房间之间的连通关系：门、走廊、楼梯、电梯、消防梯、通风口 | 通风口仅同楼层互通；每楼层至少 1 个交通系统节点连接上下层 |
| **5 预览** | 调用 [`AnsiTileMap`](../../../src/renderer/components/Game/AnsiTileMap.tsx) 渲染当前地图，支持点击瓦片查看房间/点位详情 | 校验所有房间可达；校验无孤立点位 |
| **6 保存** | 导出为 `data/games/werewolf/maps/<mapId>.json` | 通过 JSON Schema 校验；写入前自动备份旧版本 |

### 6.3 自定义地图硬性约束
无论用户如何自定义，以下约束不可违反（地图系统运行时强制校验）：
1. **单人牢房不得安装摄像头**（架构文档第 3 章地图系统「严格禁止」项）。
2. **不得绕过房卡权限**（架构文档第 3 章）。
3. **通风口仅单层互通**，多楼层之间不互通（规则文档第 107 行）。
4. **至少保留 1 间医疗与鉴定室类房间**（身份鉴定机制依赖，规则文档第 78、171 行）。
5. **至少保留 1 间审判厅类房间**（审判处刑环节依赖，规则文档第 85 行）。

## 7. 监控覆盖矩阵

> 规则文档第 176 行明确「所有公共地图区域均开启监控摄像头」，第 115 行明确单人牢房「无摄像头」。日间活动阶段监控全覆盖，监控情况依赖系统日报和录像调取。

### 7.1 监控覆盖详表
| 楼层 | 区域 | 是否有摄像头 | 备注 |
| :--- | :--- | :--- | :--- |
| F1-F4 | 单人牢房 ×16 | ❌ | 规则硬性约束，禁止安装 |
| F1 | 中央厨房与餐厅 | ✅ | 公共区域 |
| F1 | 大型公共浴场 | ✅ | 公共区域 |
| F1 | 医疗与鉴定室 | ✅ | 公共区域；力场床位区域监控可被典狱长调取 |
| F1 | 正门及隔离系统 | ✅ | 公共区域 |
| F2 | 主控室及陈列区 | ✅ | 监控指挥中心，同时作为典狱长生活区 |
| F2 | 紧急避难大厅及审判厅 | ✅ | 公共区域 |
| F3 | 多功能娱乐室 | ✅ | 公共区域 |
| F3 | 图书资料馆与机房 | ✅ | 公共区域 |
| F3 | 健身训练场 | ✅ | 公共区域 |
| F4 | 物资仓库 | ✅ | 公共区域 |
| F4 | 静思祈祷室/冥想角 | ✅ | 公共区域 |
| F4 | 屋顶和天台 | ✅ | 公共区域 |
| F1-F4 | 电梯/内部楼梯/消防梯 | ✅ | 交通系统属公共区域 |

### 7.2 监控调取 UI 流程
```
[日间活动阶段]
   ↓
玩家点击某公共区域瓦片
   ↓
[地图系统] 校验该区域是否有摄像头
   ↓ 有
弹出「监控调取」面板 → 选择时间段（默认案发夜 00:00-06:00）
   ↓
[法官 AI] 基于真相剧本返回该时段监控残留信息
   ↓
规则文档第 215 行：记录 24:00 前该区域出现的最后两名角色（监控残留字段）
   ↓
监控记录写入 evidence.json 的 surveillance 分区
```

### 7.3 监控数据模型
```typescript
/** 监控录像条目 */
export interface SurveillanceRecord {
  recordId: string;
  areaId: string;               // 公共区域 ID
  cameraId: string;
  timeRange: { start: string; end: string }; // ISO8601
  lastSeenCharacterIds: string[]; // 规则文档第 215 行：24:00 前最后两名角色
  summary: string;              // 法官 AI 生成的监控画面描述
  isTampered: boolean;          // 是否被伪装者破坏/剪辑（如断电前最后画面）
  tamperNote?: string;          // 篡改痕迹说明
}
```

## 8. 与 AnsiTileMap 的瓦片映射规则

> 渲染层完全复用既有 [`AnsiTileMap.tsx`](../../../src/renderer/components/Game/AnsiTileMap.tsx) 组件（接受 `tiles: string[][]` 与 `tileStyles: Record<string, TileStyleConfig>`），地图系统仅负责生成瓦片矩阵与样式映射。

### 8.1 瓦片字符表
| 字符 | 含义 | 默认样式 |
| :--- | :--- | :--- |
| `#` | 墙壁 | 灰色背景 `#d9d9d9` |
| `.` | 走廊/地板 | 白色背景 |
| `D` | 门（需房卡） | 黄色字 `#c4a000` |
| `C` | 单人牢房 | 浅蓝背景 |
| `K` | 中央厨房与餐厅 | — |
| `B` | 大型公共浴场 | — |
| `M` | 医疗与鉴定室 | — |
| `G` | 正门及隔离系统 | 红色字 `#cc0000` |
| `O` | 主控室及陈列区 | 紫色背景 `#75507b` |
| `A` | 紧急避难大厅及审判厅 | — |
| `E` | 多功能娱乐室 | — |
| `L` | 图书资料馆与机房 | — |
| `F` | 健身训练场 | — |
| `W` | 物资仓库 | — |
| `P` | 静思祈祷室/冥想角 | — |
| `R` | 屋顶和天台 | — |
| `S` | 内部楼梯 | — |
| `V` | 电梯 | 青色字 `#06989a` |
| `X` | 消防专用楼梯 | — |
| `~` | 通风口（同层互通标记） | 绿色字 `#4e9a06` |
| `@` | 典狱长（玩家） | 蓝色加粗 `#1890ff` |
| `0-9` / `a-f` | AI 角色（16 人各占一字符） | 角色文字颜色 |
| `!` | 可搜索点位高亮 | 黄色背景脉冲动画 |
| `*` | 命案封锁区域标记 | 红色背景 `#cc0000` |

### 8.2 映射规则
| 映射维度 | 规则 |
| :--- | :--- |
| **楼层 → 瓦片行** | 每层楼占固定行带（默认 8 行 ×20 列）；F4 在顶部行带、F1 在底部行带（符合建筑视觉：地面层在下）；`showCoordinates=true` 时行号显示楼层标签 |
| **房间 → 瓦片块** | 每个房间在所属楼层行带内占一个矩形瓦片块，块内填充房间字符（如 `C`、`K`），块边界用 `#` 包围，门用 `D` 标记 |
| **角色位置 → 瓦片标记** | 角色所在房间的瓦片块内嵌入角色字符（典狱长 `@`，AI 角色 `0-9a-f`）；同一瓦片块多角色时随机分布或叠加显示数字角标 |
| **可搜索点位 → 瓦片高亮** | 命案现场/证言收集阶段，可搜索点位所在瓦片使用 `!` 字符或通过 `tileStyles` 注入黄色背景脉冲动画；已搜索点位去除高亮 |
| **封锁区域 → 瓦片标记** | 命案封锁期间，受影响区域瓦片叠加 `*` 标记与红色背景 |
| **连通关系 → 瓦片邻接** | 房间之间的门、走廊、楼梯、电梯、消防梯、通风口通过相邻瓦片字符表达；`~` 标记同楼层通风口互通 |

### 8.3 瓦片生成示例
```typescript
import type { TileStyleConfig } from '../../../renderer/components/Game/AnsiTileMap';

/** 狼人杀瓦片样式映射 */
export const werewolfTileStyles: Record<string, TileStyleConfig> = {
  '#': { background: '#d9d7cf' },
  '.': { background: '#ffffff' },
  'D': { color: '#c4a000', label: '门' },
  'C': { background: '#e6f7ff', label: '牢' },
  'G': { color: '#cc0000', label: '门' },
  'O': { background: '#75507b', color: '#ffffff', label: '控' },
  'V': { color: '#06989a', label: '梯' },
  '~': { color: '#4e9a06', label: '风' },
  '@': { color: '#1890ff', label: '典' },
  '!': { background: '#fffbe6', color: '#faad14', label: '搜' },
  '*': { background: '#cc0000', color: '#ffffff', label: '锁' },
};

/** 角色瓦片样式（按角色文字颜色动态生成） */
export function buildCharacterTileStyle(characterColor: string): TileStyleConfig {
  return { color: characterColor, label: '人' };
}
```

## 9. 地图状态变更触发机制

### 9.1 状态变更触发器
| 触发场景 | 触发源 | 地图状态变更 | 持续阶段 |
| :--- | :--- | :--- | :--- |
| **命案封锁** | 法官 AI 晨间结算判定发生命案 | 所有角色强制禁闭于所在区域；所有门禁锁死；电梯停运；受影响区域瓦片叠加 `*` 标记 | 现场调查 + 证言收集 |
| **封锁解除** | 庭前推理完成 / 审判处刑结束 | 门禁恢复；电梯恢复；瓦片去除 `*` 标记 | 审判处刑后 / 日间活动 |
| **角色移动** | 日间活动阶段角色 AI 决策 / 玩家指令 | 更新角色所在 `roomId`；瓦片角色字符迁移；触发房卡权限校验与使用记录 | 日间活动 |
| **点位搜索完成** | 玩家点击可搜索点位 | 点位 `status` 置为 `searched`；瓦片去除 `!` 高亮；证据写入 `evidence.json` | 现场调查 + 证言收集 |
| **房卡使用** | 角色刷卡开门/进公共区/领物资/用电脑 | 生成 `RoomCardUsageRecord`；写入房卡使用记录 | 全阶段 |
| **监控调取** | 玩家在公共区域调取监控 | 生成 `SurveillanceRecord`；写入 surveillance 分区 | 日间活动 |
| **身份鉴定** | 典狱长夜间在医疗室发动鉴定 | 医疗室力场床位充能消耗；写入鉴定结果 | 夜间 |

### 9.2 状态变更数据模型
```typescript
/** 地图运行时状态 */
export interface MapRuntimeState {
  mapId: string;
  phase: 'night' | 'morning' | 'investigation' | 'testimony' | 'reasoning' | 'trial' | 'daytime';
  isLockedDown: boolean;            // 是否处于命案封锁
  lockedDownAreaIds: string[];      // 被封锁的区域 ID 列表
  characterPositions: Record<string, string>; // characterId → roomId
  searchedPointIds: string[];       // 已搜索点位 ID
  cardUsageRecords: RoomCardUsageRecord[];
  surveillanceRecords: SurveillanceRecord[];
  medicalForceFieldCharge: number;  // 医疗室力场剩余充能次数（每日 1 次）
}

/** 地图状态变更事件 */
export type MapStateChangeEvent =
  | { type: 'lockdown'; areaIds: string[]; reason: string }
  | { type: 'unlock'; areaIds: string[] }
  | { type: 'character-move'; characterId: string; fromRoomId: string; toRoomId: string }
  | { type: 'point-searched'; pointId: string; searcherId: string; foundEvidenceIds: string[] }
  | { type: 'card-used'; record: RoomCardUsageRecord }
  | { type: 'surveillance-retrieved'; record: SurveillanceRecord }
  | { type: 'identification-performed'; targetId: string; result: 'good' | 'imposter' };
```

### 9.3 与流程系统的协作
地图状态变更由 [05-game-flow-design.md](./05-game-flow-design.md) 的阶段状态机驱动：
- **晨间结算 → 现场调查**：流程系统触发 `lockdown` 事件，地图系统进入封锁态。
- **现场调查 → 证言收集**：玩家移动到角色所在房间时，地图系统生成该房间的可搜索点位清单。
- **审判处刑 → 日间活动**：流程系统触发 `unlock` 事件，地图系统解除封锁，角色可在全地图自由行动。
- **日间活动 → 夜间**：地图系统重置当日 `cardUsageRecords` 归档至存档，重置 `medicalForceFieldCharge`。

## 10. 跨文档引用

| 引用对象 | 路径 | 用途 |
| :--- | :--- | :--- |
| 系统架构总览 | [./01-system-architecture.md](./01-system-architecture.md) | 术语表、子系统职责矩阵、数据流向 |
| 规则剧本 | [../逆转裁判+狼人杀规则.txt](../逆转裁判+狼人杀规则.txt) | 地图设定原始来源（第 68-117 行） |
| AnsiTileMap 组件 | [../../../src/renderer/components/Game/AnsiTileMap.tsx](../../../src/renderer/components/Game/AnsiTileMap.tsx) | 瓦片地图渲染复用 |
| AnsiTileMap 样式 | [../../../src/renderer/components/Game/AnsiTileMap.css](../../../src/renderer/components/Game/AnsiTileMap.css) | 瓦片样式参考 |
| 游戏流程设计 | [./05-game-flow-design.md](./05-game-flow-design.md) | 阶段状态机驱动地图状态变更 |
| 法官系统设计 | [./02-judge-system-design.md](./02-judge-system-design.md) | 真相剧本生成可搜索点位 |
| 数据库设计 | [./09-database-design.md](./09-database-design.md) | 地图 JSON Schema 与存档结构 |
| UI/UX 设计 | [./08-ui-ux-design.md](./08-ui-ux-design.md) | 地图编辑器与监控调取面板线框图 |

## 11. 待后续文档细化的开放问题

1. **多角色同房间瓦片叠加显示策略**：当夜间双人牢房场景发生时（规则文档第 125 行，单人牢房夜晚最多容纳 2 名角色），瓦片字符如何同时展示两个角色——详见 [08-ui-ux-design.md](./08-ui-ux-design.md)。
2. **通风口拆卸工具获取链路**：螺丝刀等拆卸工具的初始分布与获取流程——详见 [02-judge-system-design.md](./02-judge-system-design.md) 真相剧本格式。
3. **房卡窃取与绑定交互细节**：未绑定房卡被窃取的交互流程与 AI 行为决策——详见 [06-ai-driving-mechanism.md](./06-ai-driving-mechanism.md)。
4. **监控篡改与断电场景**：伪装者能否破坏监控、断电前最后画面的生成规则——详见 [02-judge-system-design.md](./02-judge-system-design.md)。
