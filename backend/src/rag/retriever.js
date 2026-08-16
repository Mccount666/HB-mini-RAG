// backend/src/rag/retriever.js - 混合检索：向量余弦 + BM25 词法，加权融合 + 阈值门控
// 纯哈希向量的余弦分布窄（在/出范围问题常只差 0.04），单靠它门控既容易误召回也容易误拒。
// 融合 BM25 后：术语精确命中会被显著放大，出范围问题的分数被压低，分隔带宽大幅拉开
//（tools/eval.js 可实测校准阈值）。
const fs = require('fs');
const config = require('../config');
const { buildDocStats, bm25Scores, saturate, coverage } = require('./bm25');

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 索引与 BM25 文档统计缓存：按文件 mtime 失效，ingest 重新生成索引后无需重启服务
let cache = null; // { mtime, items, docStats }

async function loadIndex() {
  const file = process.env.INDEX_FILE || config.paths.indexFile;
  const mtime = fs.statSync(file).mtimeMs;
  if (cache && cache.mtime === mtime) return cache;
  const items = JSON.parse(fs.readFileSync(file, 'utf-8')).items;
  cache = { mtime, items, docStats: buildDocStats(items) };
  return cache;
}

// 混合分：wVec*cosine + wBm25*bm25norm，两项均已归一到 [0,1] 量纲附近
function hybridScore(cos, bm25norm) {
  const wV = config.retrieval.weightVector;
  const wB = config.retrieval.weightBm25;
  return cos * wV + bm25norm * wB;
}

// 对给定条目集合打分排序（供 retrieve 与测试/评测直接复用）
// queryEmbedding: 问题向量；queryText: 问题原文（提供则启用 BM25 融合，否则纯向量）
// 返回 { top, hits, bestScore, coverage }，score 为融合分
// 门控（hits 为空 → 拒答）：
//   1) 融合分阈值：top 条目 score ≥ threshold
//   2) 覆盖率门控：问题关键词（IDF 加权）在语料中的覆盖率 ≥ minCoverage，
//      拦截"糖尿病饮食"这类共享表面词但主题不在库内的问题（opts.minCoverage=0 关闭，OCR 用）
async function scoreItems(items, docStats, queryEmbedding, queryText, opts = {}) {
  const cosScores = items.map((it) => cosine(queryEmbedding, it.embedding));
  const bm25 = queryText
    ? bm25Scores(queryText, docStats).map((s) => saturate(s))
    : items.map(() => 0);

  const scored = items.map((it, i) => ({
    ...it,
    cosine: cosScores[i],
    bm25: bm25[i],
    score: hybridScore(cosScores[i], bm25[i]),
  }));
  scored.sort((a, b) => b.score - a.score);

  const topK = opts.topK !== undefined ? opts.topK : config.retrieval.topK;
  const threshold =
    opts.threshold !== undefined ? opts.threshold : config.retrieval.threshold;
  const top = scored.slice(0, topK);

  const cov = queryText ? coverage(queryText, docStats) : 1;
  const minCoverage =
    opts.minCoverage !== undefined ? opts.minCoverage : config.retrieval.minCoverage;
  const coverageOk = cov >= minCoverage;

  const hits = coverageOk ? top.filter((t) => t.score >= threshold) : [];
  return { top, hits, bestScore: top.length ? top[0].score : 0, coverage: cov };
}

// 线上检索入口。
// opts.category: 仅在该分类内检索（如 OCR 解读传 'lab_reference'）
// opts.topK / opts.threshold: 覆盖默认值（OCR 解读传大 topK + 0 阈值，取全部参考条目）
// opts.queryText: 问题原文，启用混合检索（强烈建议始终传入）
async function retrieve(queryEmbedding, opts = {}) {
  const { items, docStats } = await loadIndex();
  let idxItems = items;
  let idxStats = docStats;
  if (opts.category) {
    // 按分类过滤时同步重建 BM25 统计（IDF/平均长度需在小语料内重算）
    const keep = new Set();
    items.forEach((it, i) => {
      if (it.category === opts.category) keep.add(i);
    });
    idxItems = items.filter((_, i) => keep.has(i));
    idxStats = docStats.filter((_, i) => keep.has(i));
  }
  return scoreItems(idxItems, idxStats, queryEmbedding, opts.queryText, opts);
}

module.exports = { retrieve, scoreItems, cosine };
