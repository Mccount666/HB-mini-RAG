// backend/test/rag.test.js - RAG 管线单元测试（node:test，无外部依赖）
// 运行：cd backend && npm test
// 覆盖：同义词扩展 / BM25 排序 / 混合检索在-出范围分隔 / 护栏（引用+数字）/ 追问查询构建
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// 测试固定用本地向量化和全部演示条目（不依赖 .env / API key）
process.env.EMBEDDING_PROVIDER = 'local';
process.env.KB_ONLY_REVIEWED = 'false';
process.env.INDEX_FILE = path.join(__dirname, '..', 'data', 'index.json');

const { expandText } = require('../src/rag/synonyms');
const { bm25Tokenize, buildDocStats, bm25Scores, saturate } = require('../src/rag/bm25');
const { localEmbed } = require('../src/rag/embedder');
const { scoreItems } = require('../src/rag/retriever');
const { validateCitations, extractCriticalNumbers, checkGroundedNumbers, guardAnswer } = require('../src/rag/guard');
const { buildRetrievalQuery } = require('../src/rag/query');
const { buildItems } = require('../src/kb/ingest');

// ---- 同义词扩展 ----
test('expandText 把口语说法映射到规范术语（AFP→甲胎蛋白、肚子胀→腹部膨隆）', () => {
  assert.ok(expandText('AFP 多少算正常').includes('甲胎蛋白'));
  assert.ok(expandText('孩子肚子胀怎么办').includes('腹部膨隆'));
  assert.ok(expandText('换肝是怎么回事').includes('肝移植'));
  // 无关文本不被扩展
  assert.equal(expandText('今天天气不错'), '今天天气不错');
});

test('bm25Tokenize 剔除停用词并做同义词扩展', () => {
  const tokens = bm25Tokenize('孩子的AFP是多少呢');
  assert.ok(tokens.includes('afp'));
  assert.ok(tokens.includes('甲胎蛋白') || tokens.some((t) => t.length >= 2 && t.includes('甲胎')));
  assert.ok(!tokens.includes('的'));
});

// ---- BM25 排序 ----
test('BM25 在化验参考分类内把 AFP 问题排到最前', async () => {
  const items = await buildItems();
  const lab = items.filter((it) => it.category === 'lab_reference');
  const stats = buildDocStats(lab);
  const scores = bm25Scores('甲胎蛋白 AFP 参考范围 多少正常', stats);
  const bestIdx = scores.indexOf(Math.max(...scores));
  assert.equal(lab[bestIdx].id, 'LAB-AFP');
});

// ---- 混合检索：在/出范围分隔 ----
// 近邻问题（糖尿病饮食/乙肝疫苗等共享表面词）检索层无法完全分隔，属预期——
// 由严格提示词拒答 + 生成后护栏兜底（guardAnswer 有独立测试）。这里只测可分隔的两侧。
test('混合检索门控：在范围问题通过门控，无关问题被拦截', async () => {
  const items = await buildItems();
  const stats = buildDocStats(items);

  const inQs = ['肝母细胞瘤是什么病？', '化疗有什么副作用？怎么缓解？', '什么情况下需要肝移植？'];
  const outQs = ['孕妇可以喝咖啡吗？', '怎么理财比较稳健？', '今天天气怎么样？'];

  const gate = async (q) => {
    const { hits } = await scoreItems(items, stats, localEmbed(q), q, {});
    return hits.length > 0;
  };
  for (const q of inQs) {
    assert.ok(await gate(q), `在范围问题应通过门控：${q}`);
  }
  for (const q of outQs) {
    assert.ok(!(await gate(q)), `无关问题应被门控拦截：${q}`);
  }
});

test('混合检索：同义词问题（AFP）能命中甲胎蛋白条目 top3', async () => {
  const items = await buildItems();
  const stats = buildDocStats(items);
  const { top } = await scoreItems(items, stats, localEmbed('AFP 是什么？为什么要查？'), 'AFP 是什么？为什么要查？', { topK: 3 });
  const ids = top.map((t) => t.id);
  assert.ok(ids.includes('LAB-AFP') || ids.includes('HB-110'), `top3 应含 AFP 相关条目，实测 ${ids}`);
});

// ---- 护栏：引用校验 ----
test('validateCitations 剔除越界引用、保留合法引用', () => {
  const raw = '肝母细胞瘤多发于 5 岁以下 [来源1]，治疗以化疗为主 [来源9]。';
  const { answer, citationCount } = validateCitations(raw, 3);
  assert.equal(citationCount, 1);
  assert.ok(answer.includes('[来源1]'));
  assert.ok(!answer.includes('[来源9]'));
});

// ---- 护栏：数字溯源 ----
test('extractCriticalNumbers 挑出带单位/小数/大于20的数字，跳过列表序号与引用编号', () => {
  const nums = extractCriticalNumbers(
    ['1. 约占 60%–70%', '2. 剂量 80mg/㎡', '3. 见 [来源2]', '4. 每天 3 次'].join('\n')
  );
  assert.ok(nums.includes('60'));
  assert.ok(nums.includes('70'));
  assert.ok(nums.includes('80'));
  assert.ok(nums.includes('3')); // "3 次"带单位，属于关键数字
  assert.ok(!nums.includes('2')); // 行首序号 "2." 与引用 [来源2] 均不检查
});

test('checkGroundedNumbers 发现知识库外的数字', () => {
  const hits = [{ text: '约占儿童肝脏肿瘤的 60%–70%，绝大多数发生在 5 岁以下。' }];
  const ok = checkGroundedNumbers('约占 60%–70%，多发于 5 岁以下 [来源1]。', hits);
  assert.equal(ok.ungrounded.length, 0);
  const bad = checkGroundedNumbers('建议每天服用 500mg 维生素 [来源1]。', hits);
  assert.ok(bad.ungrounded.includes('500'));
});

test('guardAnswer：数字无出处直接拒答（不可重试），无引用可重试，正常回答放行', () => {
  const hits = [{ text: '常见转移部位为肺。' }, { text: '五年生存率与分期相关。' }];
  // 数字无出处
  const g1 = guardAnswer('治愈率约 95% [来源1]', hits);
  assert.equal(g1.ok, false);
  assert.equal(g1.reason, 'ungrounded_numbers');
  assert.equal(g1.retry, false);
  // 无引用 → 重试
  const g2 = guardAnswer('常见转移部位为肺。', hits);
  assert.equal(g2.ok, false);
  assert.equal(g2.reason, 'no_citations');
  assert.equal(g2.retry, true);
  // 正常
  const g3 = guardAnswer('常见转移部位为肺 [来源1]。', hits);
  assert.equal(g3.ok, true);
});

// ---- 追问查询构建 ----
test('buildRetrievalQuery 对短追问拼接上轮问题，独立问题不拼接', () => {
  const history = [
    { role: 'user', content: '化疗期间要注意什么？' },
    { role: 'assistant', content: '……' },
  ];
  assert.equal(
    buildRetrievalQuery('那副作用呢？', history),
    '化疗期间要注意什么？ 那副作用呢？'
  );
  assert.equal(buildRetrievalQuery('肝母细胞瘤能治好吗', history), '肝母细胞瘤能治好吗');
  assert.equal(buildRetrievalQuery('那副作用呢？', []), '那副作用呢？');
});

// ---- saturate 归一 ----
test('saturate 把 BM25 分压到 [0,1) 且强命中显著高于弱命中', () => {
  assert.ok(saturate(10) > 0.7);
  assert.ok(saturate(0.5) < 0.25);
  assert.ok(saturate(0) === 0);
});
