const fs = require('fs');
const path = require('path');

// 读取原始文件
const inputFile = '狼人杀1.0.json';
const outputFile = '狼人杀1.0_修复版.json';

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// 1. 添加缺失的根级字段
data.is_creation = false;
data.scan_depth = 50;
data.token_budget = 1082;
data.recursive_scanning = true;

// 添加 extensions 字段（如果不存在）
if (!data.extensions) {
  data.extensions = {
    "chub": {
      "id": 0,
      "full_path": "",
      "expressions": null,
      "alt_expressions": {},
      "related_lorebooks": []
    }
  };
}

// 2. 修复 entries
const entries = data.entries;
const fixedEntries = {};
let newIndex = 1;

// 按原始索引排序
const sortedKeys = Object.keys(entries).sort((a, b) => parseInt(a) - parseInt(b));

for (const oldKey of sortedKeys) {
  const entry = entries[oldKey];
  
  // 修复每个条目
  const fixedEntry = {
    ...entry,
    // 修正索引
    uid: newIndex,
    id: newIndex,
    // 确保必需字段存在
    priority: entry.priority || entry.order || 100,
    insertion_order: entry.order || 100,
    enabled: entry.enabled !== undefined ? entry.enabled : true,
    name: entry.name || entry.comment || `Entry ${newIndex}`,
    // 修正数据类型
    position: typeof entry.position === 'number' ? entry.position : 1,
    delayUntilRecursion: typeof entry.delayUntilRecursion === 'boolean' ? (entry.delayUntilRecursion ? 1 : 0) : (entry.delayUntilRecursion || 0),
    // 确保 extensions 字段存在
    extensions: entry.extensions || {
      "depth": entry.depth || 4,
      "weight": 10,
      "addMemo": entry.addMemo !== undefined ? entry.addMemo : true,
      "displayIndex": entry.displayIndex || 0,
      "useProbability": entry.useProbability !== undefined ? entry.useProbability : true,
      "characterFilter": null,
      "excludeRecursion": entry.excludeRecursion || false
    }
  };
  
  // 确保 keysecondary 是数组
  if (!Array.isArray(fixedEntry.keysecondary)) {
    fixedEntry.keysecondary = [];
  }
  
  // 确保 secondary_keys 是数组
  if (!Array.isArray(fixedEntry.secondary_keys)) {
    fixedEntry.secondary_keys = [];
  }
  
  // 确保 tags 是数组
  if (!Array.isArray(fixedEntry.tags)) {
    fixedEntry.tags = [];
  }
  
  // 确保 triggers 是数组
  if (!Array.isArray(fixedEntry.triggers)) {
    fixedEntry.triggers = [];
  }
  
  // 确保 characterFilter 存在
  if (!fixedEntry.characterFilter) {
    fixedEntry.characterFilter = {
      "isExclude": false,
      "names": [],
      "tags": []
    };
  }
  
  fixedEntries[newIndex.toString()] = fixedEntry;
  newIndex++;
}

// 替换 entries
data.entries = fixedEntries;

// 写入修复后的文件
fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf8');

console.log(`修复完成！`);
console.log(`原始条目数: ${Object.keys(entries).length}`);
console.log(`修复后条目数: ${Object.keys(fixedEntries).length}`);
console.log(`索引范围: 1 - ${Object.keys(fixedEntries).length}`);
console.log(`输出文件: ${outputFile}`);
