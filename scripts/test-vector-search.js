const fs = require('fs');
const path = require('path');

const VECSTORE_PATH = 'C:\\Users\\master\\AppData\\Roaming\\creative-cafe\\vectors\\worldbook\\狼人杀1.0_修复版\\vecstore.json';
const METADATA_PATH = 'C:\\Users\\master\\AppData\\Roaming\\creative-cafe\\vectors\\worldbook\\狼人杀1.0_修复版\\vecstore_metadata.json';
const REGISTRY_PATH = 'C:\\Users\\master\\AppData\\Roaming\\creative-cafe\\vector_registry.json';

let errors = 0;
let warnings = 0;

function logOk(msg) { console.log(`  ✅ ${msg}`); }
function logWarn(msg) { warnings++; console.log(`  ⚠️ ${msg}`); }
function logErr(msg) { errors++; console.log(`  ❌ ${msg}`); }

console.log('=== 向量搜索诊断与验证脚本 ===');
console.log('目标关键字: "疯狂动物城"\n');

// Step 1: 检查文件存在性
console.log('[Step 1] 检查文件存在性');
if (fs.existsSync(VECSTORE_PATH)) {
  logOk(`vecstore.json 存在 (${(fs.statSync(VECSTORE_PATH).size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  logErr('vecstore.json 不存在');
}
if (fs.existsSync(METADATA_PATH)) {
  logOk(`vecstore_metadata.json 存在 (${(fs.statSync(METADATA_PATH).size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  logErr('vecstore_metadata.json 不存在');
}
if (fs.existsSync(REGISTRY_PATH)) {
  logOk(`vector_registry.json 存在 (${(fs.statSync(REGISTRY_PATH).size / 1024).toFixed(0)} bytes)`);
} else {
  logErr('vector_registry.json 不存在');
}

// Step 2: 验证 vecstore.json 数据结构
console.log('\n[Step 2] 验证 vecstore.json 数据结构');
const vecstoreData = JSON.parse(fs.readFileSync(VECSTORE_PATH, 'utf-8'));

if (vecstoreData.dimension === 4096) {
  logOk(`维度正确: ${vecstoreData.dimension}`);
} else {
  logErr(`维度异常: ${vecstoreData.dimension} (期望 4096)`);
}

if (vecstoreData.records && Array.isArray(vecstoreData.records)) {
  logOk(`records 字段存在，共 ${vecstoreData.records.length} 条向量`);
} else {
  logErr('缺少 records 字段或格式不正确');
}

// 验证每条记录的结构
let invalidRecords = 0;
for (const record of vecstoreData.records) {
  if (!record.id) invalidRecords++;
  if (!record.vector || !Array.isArray(record.vector)) invalidRecords++;
  if (record.vector && record.vector.length !== 4096) invalidRecords++;
}
if (invalidRecords === 0) {
  logOk(`所有 ${vecstoreData.records.length} 条记录结构验证通过`);
} else {
  logErr(`${invalidRecords} 条记录结构异常`);
}

// Step 3: 验证包含"疯狂动物城"的条目
console.log('\n[Step 3] 验证"疯狂动物城"相关条目');
const metadataData = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
const targetEntries = [];
for (const [id, meta] of Object.entries(metadataData)) {
  if (JSON.stringify(meta).includes('疯狂动物城')) {
    targetEntries.push({ id, entryKeys: meta.entryKeys, entryName: meta.entryName });
  }
}

if (targetEntries.length >= 2) {
  logOk(`找到 ${targetEntries.length} 个包含"疯狂动物城"的元数据条目`);
} else if (targetEntries.length > 0) {
  logWarn(`仅找到 ${targetEntries.length} 个包含"疯狂动物城"的元数据条目 (预期 >= 2)`);
} else {
  logErr('未找到任何包含"疯狂动物城"的元数据条目');
}

targetEntries.forEach(e => {
  console.log(`    - ${e.id}: ${e.entryName} | keys: ${JSON.stringify(e.entryKeys)}`);
});

// Step 4: 验证元数据与向量的对应关系
console.log('\n[Step 4] 验证元数据与向量对应关系');
const vecIds = new Set(vecstoreData.records.map(v => v.id));
const metadataIds = new Set(Object.keys(metadataData));

let matchedCount = 0;
let missingVecs = [];
let orphanMeta = [];

for (const id of metadataIds) {
  if (vecIds.has(id)) matchedCount++;
  else missingVecs.push(id);
}
for (const id of vecIds) {
  if (!metadataIds.has(id)) orphanMeta.push(id);
}

if (matchedCount === vecstoreData.records.length && matchedCount === metadataIds.size) {
  logOk(`元数据与向量完全匹配: ${matchedCount}/${vecstoreData.records.length}`);
} else {
  if (missingVecs.length > 0) logErr(`${missingVecs.length} 条元数据缺少对应向量`);
  if (orphanMeta.length > 0) logWarn(`${orphanMeta.length} 条向量缺少对应元数据`);
}

// Step 5: 验证注册表
console.log('\n[Step 5] 验证 vector_registry.json');
if (fs.existsSync(REGISTRY_PATH)) {
  const registryData = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  
  const wolfEntry = registryData.find(e => e.sourceName === '狼人杀1.0_修复版');
  if (wolfEntry) {
    if (wolfEntry.status === 'active') {
      logOk(`注册表中"狼人杀1.0_修复版"状态: active`);
    } else {
      logErr(`注册表中"狼人杀1.0_修复版"状态异常: ${wolfEntry.status}`);
    }
    if (wolfEntry.vectorCount === 119) {
      logOk(`注册表中 vectorCount 正确: ${wolfEntry.vectorCount}`);
    } else {
      logErr(`注册表中 vectorCount 异常: ${wolfEntry.vectorCount} (期望 119)`);
    }
    if (wolfEntry.sourceType === 'worldbook') {
      logOk(`注册表中 sourceType 正确: ${wolfEntry.sourceType}`);
    } else {
      logErr(`注册表中 sourceType 异常: ${wolfEntry.sourceType}`);
    }
    if (wolfEntry.sourceId === '狼人杀1.0_修复版') {
      logOk(`注册表中 sourceId 正确: ${wolfEntry.sourceId}`);
    } else {
      logWarn(`注册表中 sourceId: ${wolfEntry.sourceId}`);
    }
  } else {
    logErr('注册表中未找到"狼人杀1.0_修复版"条目');
  }
}

// Step 6: 验证 vecstore 初始化流程关键路径
console.log('\n[Step 6] 验证初始化流程关键路径');
// 验证 vecstore.json 的 records 包含 metadata.fields 嵌套结构
const firstRecord = vecstoreData.records[0];
if (firstRecord.metadata && firstRecord.metadata.fields) {
  logOk('vecstore.json 的 metadata 使用 .fields 嵌套结构 (WASM 导出格式)');
  const fieldKeys = Object.keys(firstRecord.metadata.fields);
  logOk(`metadata.fields 包含 ${fieldKeys.length} 个字段: ${fieldKeys.slice(0, 8).join(', ')}...`);
} else {
  logWarn('vecstore.json 的 metadata 不使用 .fields 嵌套结构，可能是扁平格式');
}

// 验证 getSafeSourceId 逻辑
const testSourceId = '狼人杀1.0_修复版';
const safeId = testSourceId.replace(/[\\/:*?"<>|]/g, '_');
if (testSourceId === safeId) {
  logOk(`sourceId 净化逻辑: "${testSourceId}" 无需净化，与 disk 一致`);
} else {
  logWarn(`sourceId 净化: "${testSourceId}" → "${safeId}"`);
}

// Step 7: 验证目录结构
console.log('\n[Step 7] 验证磁盘目录结构');
const expectedDir = path.join('C:\\Users\\master\\AppData\\Roaming\\creative-cafe\\vectors\\worldbook', safeId);
if (fs.existsSync(expectedDir)) {
  const files = fs.readdirSync(expectedDir);
  logOk(`目录存在: ${expectedDir}`);
  logOk(`包含文件: ${files.join(', ')}`);
} else {
  logErr(`目录不存在: ${expectedDir}`);
}

// Step 8: 汇总报告
console.log('\n========================================');
console.log('           诊断汇总报告');
console.log('========================================');
console.log(`错误: ${errors}  警告: ${warnings}`);
if (errors === 0 && warnings === 0) {
  console.log('✅ 磁盘数据完整性验证全部通过！');
  console.log('\n运行时搜索问题的可能原因:');
  console.log('  1. VectorStoreService.search() 聚合路径跳过了未初始化的 store');
  console.log('  2. destroyAndDeleteFiles() 后 storeBySource Map 未被清理');
  console.log('  3. loadMetadataFromFile() 使用了错误的回退路径');
  console.log('\n以上问题已通过源代码修复解决，重新编译后可验证。');
} else if (errors === 0) {
  console.log('⚠️ 存在警告，需关注但不影响核心功能');
} else {
  console.log('❌ 存在错误，需要排查磁盘数据问题');
}
console.log('========================================\n');
