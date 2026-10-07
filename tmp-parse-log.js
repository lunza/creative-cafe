const fs = require('fs');
const raw = fs.readFileSync('g:/AI/creative-cafe/logs/ai-handler/ai-handler_20260927_084522.log', 'utf8');
const lines = raw.split('\n');

const blocks = [];
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/\[(req-[a-z0-9]+)\] 收到AI请求/);
  if (m) { cur = { id: m[1], contents: [], deltas: [], collect: false }; blocks.push(cur); continue; }
  if (!cur) continue;
  const cm = line.match(/^        "content": "((?:[^"\\]|\\.)*)"/);
  if (cm) cur.contents.push(cm[1]);
  if (line.includes('流式响应原始数据')) { cur.collect = true; continue; }
  if (cur.collect) {
    const dm = line.match(/data: (\{.*\})/);
    if (dm) {
      try {
        const j = JSON.parse(dm[1]);
        const d = j.choices?.[0]?.delta;
        if (d && typeof d.content === 'string') cur.deltas.push(d.content);
        if (j.choices?.[0]?.finish_reason) cur.finish = j.choices[0].finish_reason;
      } catch {}
    }
  }
}

for (const b of blocks) {
  const user = b.contents[b.contents.length - 1] || '';
  const plain = (b.deltas || []).join('');
  let op = '?', field = '?';
  let m2 = user.match(/请润色以下 <polish_target>/); if (m2) op = '润色';
  m2 = user.match(/请翻译以下 <translate_target>/); if (m2) op = '翻译';
  m2 = user.match(/为【(.+?)】字段生成内容/); if (m2) { op = '生成'; field = m2[1]; }
  m2 = user.match(/<polish_target>/); 
  if (op === '润色') {
    // 目标字段从上下文前一行找不到，改从系统提示的【润色范围约束】拿
    const sys = b.contents[0] || '';
    m2 = sys.match(/本次润色目标字段：【(.+?)】/);
    if (m2) field = m2[1];
  }
  if (op === '翻译') {
    const sys = b.contents[0] || '';
    m2 = sys.match(/本次翻译目标字段：【(.+?)】/);
    if (m2) field = m2[1];
  }
  console.log(`[${b.id}] ${op} 目标=${field} finish=${b.finish} respLen=${plain.length}`);
  console.log(`   target前60字: ${user.match(/<(?:polish|translate)_target>\n([\s\S]{0,60})/)?.[1]?.replace(/\\n/g,'⏎') || '?'}`);
}
