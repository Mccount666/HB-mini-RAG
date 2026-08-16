// tools/kb-status.js - 知识库审核状态清单（给开发者 + 导师看）
// 用法：node tools/kb-status.js
const fs = require('fs');
const path = require('path');

const kbDir = path.join(__dirname, '..', 'backend', 'data', 'knowledge_base');
const files = fs.readdirSync(kbDir).filter((f) => f.endsWith('.json'));

let total = 0;
let reviewed = 0;
const pending = [];
const byCat = {};

for (const f of files) {
  const arr = JSON.parse(fs.readFileSync(path.join(kbDir, f), 'utf-8'));
  for (const it of arr) {
    total++;
    byCat[it.category] = (byCat[it.category] || 0) + 1;
    if (it.reviewed && it.reviewedBy) {
      reviewed++;
    } else {
      pending.push(`${it.id} [${it.category}] ${it.question}`);
    }
  }
}

console.log(`知识库共 ${total} 条，已审核 ${reviewed} 条，待审核 ${total - reviewed} 条`);
console.log('分类分布：', byCat);
if (pending.length) {
  console.log('\n待导师审核清单：');
  pending.forEach((p) => console.log('  - ' + p));
} else {
  console.log('\n✅ 全部条目已审核，可设置 KB_ONLY_REVIEWED=true 后重新 ingest 上线。');
}
