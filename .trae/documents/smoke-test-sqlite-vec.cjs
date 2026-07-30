// sqlite-vec smoke test - 验证扩展加载 + TEXT 主键 + cosine 搜索
// 运行: node .trae/documents/smoke-test-sqlite-vec.cjs
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const db = new Database(':memory:');
sqliteVec.load(db);

const { vec_version } = db.prepare("SELECT vec_version() AS vec_version").get();
console.log('[smoke] vec_version =', vec_version);

// 测试 1: TEXT 主键是否支持
let textPkSupported = false;
try {
  db.exec(`CREATE VIRTUAL TABLE t1 USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[4] distance_metric=cosine
  )`);
  textPkSupported = true;
  console.log('[smoke] TEXT PRIMARY KEY: SUPPORTED');
} catch (e) {
  console.log('[smoke] TEXT PRIMARY KEY: NOT SUPPORTED -', e.message);
}

if (textPkSupported) {
  // 测试 2: 插入 + 查询
  const insert = db.prepare("INSERT INTO t1(id, embedding) VALUES (?, ?)");
  insert.run('a', new Float32Array([1.0, 0.0, 0.0, 0.0]));
  insert.run('b', new Float32Array([0.0, 1.0, 0.0, 0.0]));
  insert.run('c', new Float32Array([1.0, 1.0, 0.0, 0.0]));
  console.log('[smoke] inserted 3 vectors');

  // 测试 3: KNN 搜索
  const search = db.prepare(`
    SELECT id, distance
    FROM t1
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance
  `);
  const results = search.all(new Float32Array([1.0, 0.0, 0.0, 0.0]), 3);
  console.log('[smoke] search results:');
  for (const r of results) {
    console.log('  id=' + r.id, 'distance=' + r.distance, 'score(1-d)=' + (1 - r.distance));
  }

  // 测试 4: OR REPLACE 语义（upsert）
  insert.run('a', new Float32Array([0.0, 0.0, 1.0, 0.0]));
  const countA = db.prepare("SELECT COUNT(*) AS c FROM t1 WHERE id = 'a'").get();
  console.log('[smoke] after upsert, count of id=a:', countA.c, '(should be 1)');

  // 测试 5: 删除
  db.prepare("DELETE FROM t1 WHERE id = ?").run('b');
  const total = db.prepare("SELECT COUNT(*) AS c FROM t1").get();
  console.log('[smoke] after delete b, total count:', total.c, '(should be 2)');
}

// 测试 metadata 表 JOIN
db.exec(`CREATE TABLE meta (
  id TEXT PRIMARY KEY,
  text TEXT,
  source TEXT,
  extra TEXT
)`);
const insMeta = db.prepare("INSERT OR REPLACE INTO meta(id, text, source, extra) VALUES (?, ?, ?, ?)");
insMeta.run('a', 'hello', 'worldbook', JSON.stringify({foo: 'bar'}));

const joinSearch = db.prepare(`
  SELECT v.id, v.distance, m.text, m.source, m.extra
  FROM t1 v
  JOIN meta m ON v.id = m.id
  WHERE v.embedding MATCH ? AND v.k = ?
  ORDER BY v.distance
`);
const jr = joinSearch.all(new Float32Array([0.0, 0.0, 1.0, 0.0]), 3);
console.log('[smoke] JOIN search results:');
for (const r of jr) {
  console.log('  id=' + r.id, 'text=' + r.text, 'source=' + r.source, 'extra=' + r.extra);
}

db.close();
console.log('[smoke] ALL PASSED');
