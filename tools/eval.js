// tools/eval.js - 检索质量评测 + 阈值校准（上线/改配置前后必跑）
// 用法：node tools/eval.js
// 评测固定使用本地向量化和全部知识条目（含未审核演示数据），不依赖任何 API key。
// 输出：每题门控结果（是否会进大模型）、top3 命中、覆盖率观测值、阈值建议。
// 判定标准：
//   范围内问题 → 应命中预期条目（top3 内）且通过门控（hits 非空）
//   出范围问题 → 应被门控拦截（hits 为空）。注意"近邻问题"（糖尿病饮食/乙肝疫苗等）
//   与知识库共享表面词，检索层无法完全分隔，属预期行为——由严格提示词拒答 + 生成后护栏兜底，
//   评测中标记为 ⚠ 而非 ✗。
const path = require('path');

process.env.EMBEDDING_PROVIDER = 'local';
process.env.KB_ONLY_REVIEWED = 'false';

const { buildItems } = require('../backend/src/kb/ingest');
const { localEmbed } = require('../backend/src/rag/embedder');
const { scoreItems } = require('../backend/src/rag/retriever');
const { buildDocStats } = require('../backend/src/rag/bm25');
const config = require('../backend/src/config');

// —— 评测集：家长真实口吻 ——
// expect: 预期命中的条目 id（top3 内出现即算命中）
const IN_DOMAIN = [
  { q: '肝母细胞瘤是什么病？严重吗？', expect: ['HB-101', 'HB-001'] },
  { q: '孩子肚子胀、摸到包块要紧吗？', expect: ['HB-102', 'HB-113'] },
  { q: '怎么确诊？要做哪些检查？', expect: ['HB-103', 'HB-003'] },
  { q: 'PRETEXT 分期是什么意思？', expect: ['HB-105'] },
  { q: '化疗有什么副作用？怎么缓解？', expect: ['HB-111', 'HB-007'] },
  { q: '什么情况下需要做肝移植？', expect: ['HB-109'] },
  { q: '出院后多久复查一次？', expect: ['HB-110', 'HB-006'] },
  { q: 'AFP 是什么？为什么一直要查？', expect: ['HB-110', 'LAB-AFP', 'HB-009'] },
  { q: '会遗传吗？要二胎会有影响吗？', expect: ['HB-114', 'HB-012'] },
  { q: '治愈率怎么样？能治好吗？', expect: ['HB-115', 'HB-005'] },
  { q: '化疗期间可以打疫苗吗？', expect: ['HB-117'] },
  { q: '手术是怎么做的？能切干净吗？', expect: ['HB-108'] },
  { q: '孩子白细胞低、容易感染怎么办？', expect: ['LAB-WBC', 'HB-111', 'HB-117'] },
  { q: '化疗期间吃什么好？营养怎么补？', expect: ['HB-118', 'HB-112', 'HB-008'] },
  { q: '出现哪些情况要马上去医院？', expect: ['HB-113', 'HB-011'] },
  { q: '为什么手术前要先化疗？', expect: ['HB-010', 'HB-106'] },
];
// 出范围：知识库未收录，应被拒答。near: true = 近邻问题（共享表面词，检索层允许放行，
// 由严格提示词 + 护栏拒答）
const OUT_DOMAIN = [
  { q: '孩子感冒发烧 38 度吃什么药？', near: true },
  { q: '乙肝疫苗什么时候打？多少钱？', near: true },
  { q: '糖尿病饮食注意什么？', near: true },
  { q: '孕妇可以喝咖啡吗？' },
  { q: '肺癌晚期还有救吗？' },
  { q: '今天天气怎么样？' },
  { q: '怎么理财比较稳健？' },
  { q: '成人肝硬化怎么治疗？' },
  { q: '小儿肺炎一定要住院吗？' },
  { q: '给孩子报什么兴趣班好？' },
];

(async () => {
  console.log('加载知识库并构建向量…');
  const items = await buildItems();
  const stats = buildDocStats(items);
  console.log(`共 ${items.length} 条\n`);
  console.log(
    `门控配置：threshold=${config.retrieval.threshold}  topK=${config.retrieval.topK}  minCoverage=${config.retrieval.minCoverage}\n`
  );

  const fmt = (s) => s.toFixed(3);
  let hitCount = 0;
  let gatePassCount = 0;
  const outLeaked = [];
  const outNearLeaked = [];

  console.log('—— 范围内问题（应命中预期条目且通过门控）——');
  for (const { q, expect } of IN_DOMAIN) {
    const { top, hits, bestScore } = await scoreItems(items, stats, localEmbed(q), q, {});
    const ids = top.slice(0, 3).map((t) => t.id);
    const hit = expect.some((e) => ids.includes(e));
    const gatePass = hits.length > 0;
    if (hit) hitCount++;
    if (gatePass) gatePassCount++;
    console.log(
      `${hit && gatePass ? '✓' : '✗'} ${fmt(bestScore)}  ${q}  → top3: ${ids.join(', ')}${hit ? '' : ` （期望 ${expect.join('/')}）`}${gatePass ? '' : ' ⚠ 未通过门控（会被拒答）'}`
    );
  }

  console.log('\n—— 出范围问题（应被门控拦截拒答）——');
  for (const { q, near } of OUT_DOMAIN) {
    const { top, hits, bestScore } = await scoreItems(items, stats, localEmbed(q), q, {});
    const leaked = hits.length > 0;
    if (leaked) (near ? outNearLeaked : outLeaked).push(q);
    console.log(
      `${leaked ? (near ? '⚠' : '✗') : '✓'} ${fmt(bestScore)}  ${q}  → top1: ${top[0] ? top[0].id : '-'}${leaked ? (near ? ' （近邻：放行后由提示词+护栏拒答）' : ' （漏拦：会进大模型）') : ''}`
    );
  }

  console.log('\n—— 汇总 ——');
  console.log(`top3 命中率：${hitCount}/${IN_DOMAIN.length}｜门控通过：${gatePassCount}/${IN_DOMAIN.length}`);
  if (outLeaked.length) {
    console.log(`✗ 出范围漏拦 ${outLeaked.length} 题（建议上调 RETRIEVAL_THRESHOLD）：${outLeaked.join('；')}`);
  } else {
    console.log('✓ 出范围问题全部被门控拦截');
  }
  if (outNearLeaked.length) {
    console.log(`⚠ 近邻问题放行 ${outNearLeaked.length} 题（预期行为，由严格提示词 + 护栏拒答）：${outNearLeaked.join('；')}`);
  }
})().catch((e) => {
  console.error('评测失败：', e);
  process.exit(1);
});
