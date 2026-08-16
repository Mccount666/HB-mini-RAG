// backend/src/rag/bm25.js - BM25 词法检索（与向量检索互补的另一半混合检索）
// 向量擅长"语义相近"，BM25 擅长"术语精确命中"。医学术语问答里后者往往决定成败：
// 家长问「AFP 多少正常」，BM25 经同义词扩展后能直接命中「甲胎蛋白 参考区间」条目。
// 采用 Lucene 式非负 IDF：idf = ln(1 + (N - df + 0.5) / (df + 0.5))，避免高频词出现负贡献。
const { tokenize } = require('./embedder');
const { STOPWORDS, expandText } = require('./synonyms');

const K1 = 1.5; // 词频饱和系数
const B = 0.75;  // 文档长度归一化系数

// BM25 专用分词：复用 embedder 的切分，在此基础上做同义词扩展、停用词与中文单字过滤。
// 中文单字（如「孕」「喝」）语义太弱——两个不相干文本共享一两个单字是常态，
// 会让出范围问题拿到虚高词法分；只保留 bigram 与英文/数字词，证据强度才可靠。
function bm25Tokenize(text) {
  return tokenize(expandText(text)).filter(
    (t) => !STOPWORDS.has(t) && !/^[\u4e00-\u9fa5]$/.test(t)
  );
}

// 预计算每个文档的词频与长度（检索前调用一次，之后多次打分零重复开销）
function buildDocStats(items) {
  return items.map((it) => {
    const tokens = bm25Tokenize(it.text || '');
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    return { tf, len: tokens.length };
  });
}

// 返回与 items 等长的 BM25 分数数组（未归一化，量级随语料变化）
function bm25Scores(queryText, docStats) {
  const qTokens = [...new Set(bm25Tokenize(queryText))];
  const N = docStats.length;
  if (!N || !qTokens.length) return new Array(N).fill(0);

  const avgdl = docStats.reduce((s, d) => s + d.len, 0) / N || 1;
  // 每个查询词的文档频率
  const df = {};
  for (const t of qTokens) {
    df[t] = docStats.reduce((s, d) => s + (d.tf[t] ? 1 : 0), 0);
  }

  const scores = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const d = docStats[i];
    const norm = K1 * (1 - B + (B * d.len) / avgdl);
    let s = 0;
    for (const t of qTokens) {
      const f = d.tf[t];
      if (!f) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      s += (idf * f * (K1 + 1)) / (f + norm);
    }
    scores[i] = s;
  }
  return scores;
}

// 归一化到 [0,1)：s/(s+k) 饱和曲线，k=3 时常见命中分(5~15)落在 0.6~0.83，
// 弱命中(<1)落在 0.25 以下，与余弦相似度量纲对齐后便于加权融合。
function saturate(score, k = 3) {
  return score / (score + k);
}

// 查询覆盖率：问题关键词（未做同义词扩展的原始词）有多大信息量能在语料中找到。
// 用于拦截"近邻陷阱"：糖尿病饮食/乙肝疫苗/感冒吃药这类问题与知识库共享表面词
//（饮食/疫苗/发热），词法与向量分都不低，但问题的核心主题词（糖尿病/乙肝/感冒）
// 在语料中根本不存在 → 覆盖率低 → 整题拒答，不进大模型。
// 权重用 IDF：越稀有的词信息量越大，缺席时对覆盖率的拖累也越大。
function coverage(queryText, docStats) {
  const rawTokens = [
    ...new Set(tokenize(queryText).filter((t) => !STOPWORDS.has(t) && !/^[\u4e00-\u9fa5]$/.test(t))),
  ];
  if (!rawTokens.length || !docStats.length) return 1;
  const N = docStats.length;
  let hitWeight = 0;
  let totalWeight = 0;
  for (const t of rawTokens) {
    const df = docStats.reduce((s, d) => s + (d.tf[t] ? 1 : 0), 0);
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    totalWeight += idf;
    if (df > 0) hitWeight += idf;
  }
  return totalWeight ? hitWeight / totalWeight : 1;
}

module.exports = { bm25Tokenize, buildDocStats, bm25Scores, saturate, coverage };
