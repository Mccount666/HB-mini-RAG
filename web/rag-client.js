// web/rag-client.js - 浏览器端 RAG 核心（与 backend/src/rag 同一套防幻觉逻辑的移植版）
// 注意：本文件与 backend/src/rag/{embedder,synonyms,bm25,retriever,query,guard}.js 逻辑保持一致，
// 修改后端检索逻辑时请同步更新本文件（阈值/权重等参数镜像 backend/src/config.js 默认值）。
// 演示模式下（未连接后端大模型）在本机完成：检索查询构建 → 混合检索 → 阈值门控 → 引用校验，
// 直接展示命中的知识库原文（逐字引用，零生成、零幻觉）。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RagClient = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 配置（镜像 backend/src/config.js 默认值）=====
  const CFG = {
    dim: 512,
    topK: 6,
    threshold: 0.5, // 2026-08-30 知识库扩至 107 条后实测校准值（与 backend/.env RETRIEVAL_THRESHOLD 一致）
    weightVector: 0.5,
    weightBm25: 0.5,
    historyTurns: 6,
  };

  // ===== 分词（backend/src/rag/embedder.js）=====
  function tokenize(text) {
    const tokens = [];
    const lower = String(text || '').toLowerCase();
    const en = lower.match(/[a-z0-9]+/g);
    if (en) tokens.push(...en);
    const cn = lower.replace(/[^一-龥]/g, '');
    for (const ch of cn) tokens.push(ch);
    for (let i = 0; i < cn.length - 1; i++) tokens.push(cn.slice(i, i + 2));
    return tokens;
  }

  function hashDim(token) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % CFG.dim;
  }

  function localEmbed(text) {
    const vec = new Array(CFG.dim).fill(0);
    const freq = {};
    for (const t of tokenize(text)) freq[t] = (freq[t] || 0) + 1;
    for (const t in freq) vec[hashDim(t)] += 1 + Math.log(freq[t]);
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  // ===== 医学同义词 + 停用词（backend/src/rag/synonyms.js）=====
  const GROUPS = [
    { canonical: ['肝母细胞瘤', 'hepatoblastoma'], variants: ['肝母', '肝母细胞', 'hb', '肝脏恶性肿瘤', '儿童肝癌', '小儿肝癌'] },
    { canonical: ['甲胎蛋白', 'afp'], variants: ['甲胎球蛋白', '胎甲球'] },
    { canonical: ['丙氨酸氨基转移酶', 'alt'], variants: ['谷丙转氨酶', '谷丙'] },
    { canonical: ['天冬氨酸氨基转移酶', 'ast'], variants: ['谷草转氨酶', '谷草'] },
    { canonical: ['转氨酶'], variants: ['alt', 'ast', '谷丙转氨酶', '谷草转氨酶'] },
    { canonical: ['碱性磷酸酶', 'alp'], variants: ['骨源性碱性磷酸酶'] },
    { canonical: ['γ-谷氨酰转移酶', 'ggt'], variants: ['r-谷氨酰转移酶', '谷氨酰转肽酶'] },
    { canonical: ['总胆红素', 'tbil'], variants: ['胆红素'] },
    { canonical: ['白蛋白', 'alb'], variants: ['血清白蛋白'] },
    { canonical: ['总蛋白', 'tp'], variants: ['血清总蛋白'] },
    { canonical: ['白细胞计数', 'wbc'], variants: ['白细胞', '白血球'] },
    { canonical: ['中性粒细胞绝对值', 'anc'], variants: ['中性粒细胞', '粒细胞减少'] },
    { canonical: ['血红蛋白', 'hgb'], variants: ['血色素'] },
    { canonical: ['血小板', 'plt'], variants: ['血小板计数'] },
    { canonical: ['凝血酶原时间国际标准化比值', 'inr'], variants: ['凝血功能', '凝血'] },
    { canonical: ['肌酐', 'crea'], variants: ['血肌酐', 'cr'] },
    { canonical: ['参考区间'], variants: ['参考范围', '正常值', '正常范围', '参考值'] },
    { canonical: ['腹部膨隆', '腹胀'], variants: ['肚子胀', '肚子大', '肚胀', '腹围增大'] },
    { canonical: ['腹部包块'], variants: ['肚子有包块', '摸到包块', '腹部肿块', '肚子有硬块', '腹部肿物'] },
    { canonical: ['黄疸'], variants: ['皮肤发黄', '眼白发黄', '眼睛发黄', '皮肤黄'] },
    { canonical: ['食欲下降'], variants: ['不爱吃饭', '不想吃饭', '吃饭差', '胃口差', '食欲不振'] },
    { canonical: ['体重增长缓慢'], variants: ['不长体重', '体重不增', '越来越瘦'] },
    { canonical: ['易疲乏'], variants: ['没精神', '乏力', '没力气', '精神差'] },
    { canonical: ['发热'], variants: ['发烧', '发高烧', '低烧', '体温高'] },
    { canonical: ['呕吐'], variants: ['吐', '恶心呕吐'] },
    { canonical: ['化学治疗', '化疗'], variants: ['化疗药', '打化疗', '输化疗'] },
    { canonical: ['新辅助化疗'], variants: ['术前化疗', '手术前化疗'] },
    { canonical: ['肝移植'], variants: ['移植', '换肝'] },
    { canonical: ['肿瘤切除术', '手术切除'], variants: ['肝切除', '切肿瘤', '做手术', '动手术'] },
    { canonical: ['穿刺活检', '病理'], variants: ['活检', '取病理'] },
    { canonical: ['影像学检查'], variants: ['超声', 'b超', 'ct', 'mri', '核磁'] },
    { canonical: ['复查随访', '随访'], variants: ['复查', '复诊', '定期检查'] },
    { canonical: ['副作用', '不良反应'], variants: ['副反应', '药物反应'] },
    { canonical: ['骨髓抑制'], variants: ['白细胞低', '血象低', '血象抑制'] },
    { canonical: ['复发'], variants: ['又长了', '重新长', '再发'] },
    { canonical: ['转移'], variants: ['扩散', '转移到'] },
    { canonical: ['预后'], variants: ['治愈率', '生存率', '能治好吗', '治得好吗', '效果怎么样'] },
    { canonical: ['分期'], variants: ['pretext', '几期', '早期晚期'] },
    { canonical: ['营养支持'], variants: ['营养', '吃什么', '饮食'] },
    { canonical: ['居家照护'], variants: ['在家护理', '家里照顾', '居家护理'] },
    { canonical: ['心理压力'], variants: ['焦虑', '压力大', '失眠', '心情不好', '崩溃'] },
    { canonical: ['疫苗接种'], variants: ['疫苗', '打疫苗', '预防针'] },
    { canonical: ['感染防护'], variants: ['感染', '预防感染', '隔离'] },
    { canonical: ['顺铂'], variants: ['cddp'] },
    { canonical: ['卡铂'], variants: ['carbo'] },
    { canonical: ['长春新碱'], variants: ['vcr'] },
    { canonical: ['氟尿嘧啶'], variants: ['5-fu', '5fu'] },
    { canonical: ['阿霉素'], variants: ['多柔比星'] },
  ];

  const STOPWORDS = new Set([
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '吗', '呢', '啊', '吧', '呀', '哦', '嘛',
    '有', '和', '与', '及', '或', '对', '从', '被', '把', '让', '给', '向', '往', '都', '也', '还',
    '就', '才', '只', '要', '会', '能', '可以', '什么', '怎么', '怎样', '如何', '为什么', '哪些',
    '哪个', '谁', '哪里', '请问', '一下', '这个', '那个', '这些', '那些', '很', '非常', '比较',
    '么样', '什么样', '咋', '咋样',
    '孩子', '宝宝', '小孩', '家长', '医生', '医院', '老师', '大家', '现在', '应该', '需要',
  ]);

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function expandText(text) {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    const extra = [];
    for (const g of GROUPS) {
      const members = [...g.canonical, ...g.variants];
      let hit = false;
      for (const v of members) {
        const needle = v.toLowerCase();
        if (/^[a-z0-9-]+$/.test(needle)) {
          const re = new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}([^a-z0-9]|$)`);
          if (re.test(lower)) { hit = true; break; }
        } else if (lower.includes(needle)) { hit = true; break; }
      }
      if (hit) extra.push(...members.filter((c) => !lower.includes(c.toLowerCase())));
    }
    return extra.length ? `${raw} ${extra.join(' ')}` : raw;
  }

  // ===== BM25（backend/src/rag/bm25.js）=====
  const K1 = 1.5, B = 0.75;

  function bm25Tokenize(text) {
    return tokenize(expandText(text)).filter(
      (t) => !STOPWORDS.has(t) && !/^[\u4e00-\u9fa5]$/.test(t)
    );
  }

  function buildDocStats(items) {
    return items.map((it) => {
      const tokens = bm25Tokenize(it.text || '');
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      return { tf, len: tokens.length };
    });
  }

  function bm25Scores(queryText, docStats) {
    const qTokens = [...new Set(bm25Tokenize(queryText))];
    const N = docStats.length;
    if (!N || !qTokens.length) return new Array(N).fill(0);
    const avgdl = docStats.reduce((s, d) => s + d.len, 0) / N || 1;
    const df = {};
    for (const t of qTokens) df[t] = docStats.reduce((s, d) => s + (d.tf[t] ? 1 : 0), 0);
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

  function saturate(score, k = 3) { return score / (score + k); }

  // ===== 混合检索（backend/src/rag/retriever.js）=====
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  function hybridScore(cos, bm25norm) {
    return cos * CFG.weightVector + bm25norm * CFG.weightBm25;
  }

  function scoreItems(items, docStats, queryEmbedding, queryText, opts = {}) {
    const cosScores = items.map((it) => cosine(queryEmbedding, it.embedding));
    const bm25 = queryText
      ? bm25Scores(queryText, docStats).map((s) => saturate(s))
      : items.map(() => 0);
    const scored = items.map((it, i) => ({
      id: it.id, category: it.category, title: it.title, excerpt: it.excerpt,
      source: it.source, text: it.text,
      cosine: cosScores[i], bm25: bm25[i], score: hybridScore(cosScores[i], bm25[i]),
    }));
    scored.sort((a, b) => b.score - a.score);
    const topK = opts.topK !== undefined ? opts.topK : CFG.topK;
    const threshold = opts.threshold !== undefined ? opts.threshold : CFG.threshold;
    const top = scored.slice(0, topK);
    const hits = top.filter((t) => t.score >= threshold);
    return { top, hits, bestScore: top.length ? top[0].score : 0 };
  }

  // ===== 追问查询构建（backend/src/rag/query.js）=====
  const FOLLOWUP_PREFIX = /^(那|那么|它|他|她|这个|这种|这类|该|其|还有|另外|以及|是不是|要不要|需不需要|能不能|可不可以)/;

  function buildRetrievalQuery(message, history = []) {
    const q = String(message || '').trim();
    if (!q) return q;
    const lastUser = [...history].reverse().find((h) => h && h.role === 'user' && h.content);
    const isFollowup = !!lastUser && (FOLLOWUP_PREFIX.test(q) || q.replace(/[?？。！!，,\s]/g, '').length <= 8);
    if (isFollowup) return `${String(lastUser.content).trim()} ${q}`;
    return q;
  }

  // ===== 生成后护栏（backend/src/rag/guard.js，仅引用校验；数字溯源在后端执行）=====
  const CITATION_RE = /\[\s*来源\s*(\d+)\s*\]/g;

  function validateCitations(answer, hitCount) {
    let valid = 0;
    const cleaned = String(answer || '').replace(CITATION_RE, (m, n) => {
      const idx = parseInt(n, 10);
      if (idx >= 1 && idx <= hitCount) { valid += 1; return m; }
      return '';
    });
    return { answer: cleaned, citationCount: valid };
  }

  // ===== 演示模式主入口：本机检索 + 门控，返回知识库原文（零生成）=====
  const FALLBACK = '抱歉，我的知识库中暂未收录该问题的权威信息，建议您咨询主治医生或专科护士。';

  function createIndex(items) {
    return { items, docStats: buildDocStats(items) };
  }

  // 返回 { refused, hits, bestScore }：refused=true 时应展示 FALLBACK
  function retrieveLocal(index, message, history = []) {
    const rq = buildRetrievalQuery(message, history);
    const { hits, bestScore } = scoreItems(index.items, index.docStats, localEmbed(rq), rq);
    return { refused: hits.length === 0, hits, bestScore };
  }

  return {
    CFG, tokenize, localEmbed, expandText, bm25Tokenize, buildDocStats,
    bm25Scores, saturate, cosine, scoreItems, buildRetrievalQuery,
    validateCitations, createIndex, retrieveLocal, FALLBACK,
  };
});
