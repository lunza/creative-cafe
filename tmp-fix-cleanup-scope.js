// 【确定性脚本】把 sendStreamChatRequest 的 try 移位到只包裹 invoke 段，使 cleanup 可被 catch 访问
const fs = require('fs');
const FILE = 'g:/AI/creative-cafe/src/renderer/components/Common/AIService.tsx';
const raw = fs.readFileSync(FILE, 'utf8');
const isCRLF = raw.includes('\r\n');
const eolCh = isCRLF ? '\r' : '';
const lines = raw.split('\n');

// 定位 sendStreamChatRequest 函数定义行
const fnIdx = lines.findIndex(l => l.includes('async sendStreamChatRequest('));
if (fnIdx === -1) { console.error('[FAIL] 找不到 sendStreamChatRequest'); process.exit(1); }
console.log('[OK] sendStreamChatRequest 位于 L' + (fnIdx + 1) + ' index ' + fnIdx);

// 确认 fnIdx+1 (L311) 是 "    try {"
const tryIdx = fnIdx + 1;
if (lines[tryIdx] !== '    try {' + eolCh) {
  console.error('[FAIL] 预期 try { 位置不匹配: L' + (tryIdx + 1) + ' = ' + JSON.stringify(lines[tryIdx]));
  process.exit(1);
}
console.log('[OK] try { 位于 L' + (tryIdx + 1));

// 在 fnIdx 之后找第一个 const result 行
const resultLine = '      const result = await (window as any).electronAPI.ai.request({' + eolCh;
let resultIdx = lines.indexOf(resultLine, fnIdx + 1);
if (resultIdx === -1) { console.error('[FAIL] 找不到 const result'); process.exit(1); }
console.log('[OK] const result 位于 L' + (resultIdx + 1) + ' index ' + resultIdx);
if (resultIdx < tryIdx) { console.error('[FAIL] 顺序错误'); process.exit(1); }

// 删除 try {（index tryIdx）
lines.splice(tryIdx, 1);
// 删除后 result 行下移 1，在其之前插入新 try {
const insertIdx = resultIdx - 1;
lines.splice(insertIdx, 0, '    try {' + eolCh);

fs.writeFileSync(FILE, lines.join(''), 'utf8');
console.log('[DONE] try 移位完成');