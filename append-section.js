const fs = require('fs');
const main = 'g:/AI/creative-cafe/docs/FIX_RECORDS.md';
const sec = 'g:/AI/creative-cafe/.trae/append-fix-section.md';
let a = fs.readFileSync(main, 'utf8');
let s = fs.readFileSync(sec, 'utf8');
// 确保追加前有一个换行（文件若以换行结尾则不重复）
if (a.length > 0 && a[a.length - 1] !== '\n') {
  a += '\n';
}
a += '\n' + s;
fs.writeFileSync(main, a, 'utf8');
console.log('[DONE] 追加成功, 文件大小 ' + fs.statSync(main).size + ' bytes, 行数 ' + fs.readFileSync(main, 'utf8').split('\n').length);