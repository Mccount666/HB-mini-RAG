// backend/test/kb-gate.test.js - 知识库审核门控测试（上线安全开关）
// 覆盖：终审双条件（reviewed===true 且 reviewedBy 非空）、lab_reference 参考标准例外、
// onlyReviewed 过滤行为。不依赖 index.json（loadKnowledge 只读源数据）。
const test = require('node:test');
const assert = require('node:assert');

process.env.EMBEDDING_PROVIDER = 'local';

const { loadKnowledge, isReviewed } = require('../src/kb/index');

test('isReviewed 终审双条件：reviewed 严格 === true 且 reviewedBy 非空', () => {
  assert.equal(isReviewed({ reviewed: true, reviewedBy: '导师' }), true);
  assert.equal(isReviewed({ reviewed: true, reviewedBy: '' }), false); // 缺审核人
  assert.equal(isReviewed({ reviewed: true }), false); // 缺审核人
  assert.equal(isReviewed({ reviewed: false, reviewedBy: '某人' }), false); // 未通过
  assert.equal(isReviewed({ reviewed: 'true', reviewedBy: '某人' }), false); // 字符串 "true" 不算通过
  assert.equal(isReviewed(null), false);
});

test('onlyReviewed=false 返回全部条目；true 时只保留终审条目 + lab_reference 参考标准', () => {
  const all = loadKnowledge({ onlyReviewed: false });
  assert.ok(all.length >= 160, `全量应 ≥160 条，实际 ${all.length}`);

  const gated = loadKnowledge({ onlyReviewed: true });
  assert.ok(gated.length > 0 && gated.length < all.length, '门控后应少于全量');

  // 门控集中不允许出现未终审的非 lab_reference 条目
  for (const it of gated) {
    if (it.category === 'lab_reference') continue; // 参考标准例外（OCR 解读依赖）
    assert.equal(it.reviewed, true, `${it.id} 不应进入门控库`);
    assert.ok(it.reviewedBy, `${it.id} 缺 reviewedBy`);
  }
  // lab_reference 14 条应全部保留
  assert.equal(gated.filter((it) => it.category === 'lab_reference').length, 14);
});
