// backend/test/kb-gate.test.js - 知识库审核门控测试（上线安全开关）
// 覆盖：终审双条件（reviewed===true 且 reviewedBy 非空）、onlyReviewed 过滤行为。
// lab_reference 不再有白名单例外，其 14 条靠真实终审标记进入门控库；不依赖 index.json。
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

test('onlyReviewed=false 返回全部条目；true 时只保留终审条目（lab_reference 也必须终审）', () => {
  const all = loadKnowledge({ onlyReviewed: false });
  assert.ok(all.length >= 160, `全量应 ≥160 条，实际 ${all.length}`);

  const gated = loadKnowledge({ onlyReviewed: true });
  assert.ok(gated.length > 0 && gated.length < all.length, '门控后应少于全量');

  // 门控集中任何分类都必须终审；lab_reference 不再有白名单例外
  for (const it of gated) {
    assert.equal(it.reviewed, true, `${it.id} 不应进入门控库`);
    assert.ok(it.reviewedBy, `${it.id} 缺 reviewedBy`);
  }
  // lab_reference 14 条应全部靠 reviewed/reviewedBy 保留，而不是靠分类白名单
  assert.equal(gated.filter((it) => it.category === 'lab_reference').length, 14);
});

test('lab_reference 未终审条目不能绕过 onlyReviewed 门控', () => {
  assert.equal(isReviewed({ category: 'lab_reference', reviewed: false, reviewedBy: '' }), false);
});
