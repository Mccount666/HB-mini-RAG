// services/follow-ups.js - 追问推荐生成器（纯函数，无 wx 依赖）
// 题库全部取自 tools/eval.js 的范围内命中清单（已验证能命中知识库，不会问出拒答）。
// 推荐逻辑：回答引用了哪些知识库条目（source.id），就优先推与这些条目强相关的追问；
// 同话题加成；剔除本次会话已问过的问题；同分随机轮换。
const BANK = [
  { q: '肝母细胞瘤是什么病？严重吗？', ids: ['HB-101', 'HB-001'], topics: ['general', 'prognosis'] },
  { q: '孩子肚子胀、摸到包块要紧吗？', ids: ['HB-102', 'HB-113'], topics: ['general'] },
  { q: '怎么确诊？要做哪些检查？', ids: ['HB-103', 'HB-003', 'HB-215', 'HB-218'], topics: ['diagnosis'] },
  { q: 'PRETEXT 分期是什么意思？', ids: ['HB-105', 'HB-221', 'HB-222', 'HB-224'], topics: ['diagnosis'] },
  { q: '化疗有什么副作用？怎么缓解？', ids: ['HB-111', 'HB-007'], topics: ['chemo', 'care'] },
  { q: '什么情况下需要做肝移植？', ids: ['HB-109'], topics: ['surgery', 'followup'] },
  { q: '出院后多久复查一次？', ids: ['HB-110', 'HB-006', 'HB-240', 'HB-241'], topics: ['followup'] },
  { q: 'AFP 是什么？为什么一直要查？', ids: ['LAB-AFP', 'HB-110', 'HB-009', 'HB-216', 'HB-217'], topics: ['lab', 'lab_report'] },
  { q: '会遗传吗？要二胎会有影响吗？', ids: ['HB-114', 'HB-012'], topics: ['prognosis', 'general'] },
  { q: '治愈率怎么样？能治好吗？', ids: ['HB-115', 'HB-005'], topics: ['prognosis', 'general'] },
  { q: '化疗期间可以打疫苗吗？', ids: ['HB-117'], topics: ['chemo', 'care'] },
  { q: '手术是怎么做的？能切干净吗？', ids: ['HB-108'], topics: ['surgery'] },
  { q: '孩子白细胞低、容易感染怎么办？', ids: ['LAB-WBC', 'HB-111', 'HB-117'], topics: ['lab', 'lab_report', 'care'] },
  { q: '化疗期间吃什么好？营养怎么补？', ids: ['HB-118', 'HB-112', 'HB-008'], topics: ['care', 'chemo'] },
  { q: '出现哪些情况要马上去医院？', ids: ['HB-113', 'HB-011'], topics: ['emergency', 'followup'] },
  { q: '为什么手术前要先化疗？', ids: ['HB-010', 'HB-106'], topics: ['surgery', 'chemo'] },
  { q: '肝母细胞瘤和Wnt基因通路有关吗？', ids: ['HB-272'], topics: [] },
  { q: 'CHIC风险分层是什么意思？', ids: ['HB-293'], topics: ['diagnosis'] },
  { q: '顺铂伤耳朵，有什么保护办法？', ids: ['HB-299'], topics: ['chemo'] },
  { q: '现在有肝母细胞瘤的靶向药吗？', ids: ['HB-310'], topics: ['prognosis'] },
  { q: '孩子肝上长东西还可能是什么病？', ids: ['HB-308'], topics: ['diagnosis'] },
  { q: '混合上皮间叶型是什么意思？', ids: ['HB-281'], topics: [] },
  { q: 'AFP特别低反而不好吗？', ids: ['HB-287', 'HB-288'], topics: ['lab', 'lab_report'] },
  { q: '肝移植前要满足什么条件？', ids: ['HB-301'], topics: ['surgery'] },
  { q: '肝母细胞瘤会遗传吗？生二胎要检查吗？', ids: ['HB-206', 'HB-322'], topics: ['prognosis'] },
  { q: '肿瘤破裂还有救吗？', ids: ['HB-304'], topics: ['emergency'] },
];

/**
 * 挑选追问推荐
 * @param {string} topicKey 当前问题主题（inferQuestionTopic 的 key）
 * @param {string[]} citedIds 回答引用的知识库条目 id（sources[].id）
 * @param {string[]} asked 本次会话已问过的问题原文
 * @returns {string[]} 最多 3 条推荐问题
 */
function pickSuggestions(topicKey, citedIds = [], asked = []) {
  const cited = new Set(citedIds);
  const askedSet = new Set(asked.map((s) => String(s || '').trim()).filter(Boolean));
  const scored = BANK
    .filter((it) => !askedSet.has(it.q))
    .map((it) => {
      let score = 0;
      for (const id of it.ids) if (cited.has(id)) score += 2; // 回答真的引用了这条
      if (topicKey && it.topics.includes(topicKey)) score += 1; // 同话题加成
      return { ...it, score };
    })
    .filter((it) => it.score > 0);
  const pool = scored.length ? scored : BANK.filter((it) => !askedSet.has(it.q));
  return pool
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0) || Math.random() - 0.5)
    .slice(0, 3)
    .map((it) => it.q);
}

module.exports = { pickSuggestions, BANK };
