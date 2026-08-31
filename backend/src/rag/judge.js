// backend/src/rag/judge.js - LLM 语义判定（替代纯机械门控的"最后一公里"）
// 背景：机械检索（向量+BM25 阈值）会把口语化但确实相关的提问误判为"未收录"，
// 例如"我的孩子腹部有一个肿块，是怎么回事"可能不命中任何条目而直接拒答。
// 本模块在机械检索未命中时，调用大模型（DeepSeek，与回答同 key）做语义判定：
//   related   : 提问是否与肝母细胞瘤 / 儿童肝脏肿瘤及其诊疗照护领域相关
//   answerable: 给定的候选知识（检索 topN，即使分数低于阈值）是否足以回答
// 判定结果驱动 answer.js 的三分支：
//   相关且可答  → 用候选生成（仍走护栏）
//   相关但不足  → 学习话术 + 推送 learn_queue（知识积累回路）
//   不相关      → 拒答
const { chat } = require('./llm');

const JUDGE_SYSTEM = `你是「肝母细胞瘤智能问答助手」的意图判定器。给你一条家长提问和若干候选知识片段，请判断：
1) related：这条提问是否与"肝母细胞瘤（儿童肝脏恶性肿瘤）及其相关的诊断、症状、治疗、化疗、手术、移植、护理、副作用、复查随访、预后、遗传、化验单"有关。
   - 即使提问没有直接出现"肝母细胞瘤"字样，只要描述的症状、检查、治疗场景属于该病范畴（如"孩子肚子有肿块""AFP 高了""术后发烧"），都算 related。
   - 与儿童肝脏肿瘤无关的疾病（如糖尿病、肺炎、感冒用药）、或完全无关话题（天气、理财）算 unrelated。
2) answerable：仅凭下方 <候选知识> 的内容，能否合理回答这条提问。
   - 能覆盖核心问题或大部分要点 → answerable=true；
   - 候选与提问无关、或只能沾边不能真正作答 → answerable=false。

只输出 JSON，不要任何其他文字、不要解释：
{"related": true 或 false, "answerable": true 或 false}`;

const JUDGE_FALLBACK = { related: true, answerable: false };

function parseVerdict(text) {
  const s = String(text || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return JUDGE_FALLBACK;
  try {
    const obj = JSON.parse(m[0]);
    return {
      related: !!obj.related,
      answerable: !!obj.answerable,
    };
  } catch (e) {
    // 模型偶发输出非严格 JSON 时容错：宁可视为"相关但不可答"→ 进学习回路而非机械拒答
    return JUDGE_FALLBACK;
  }
}

// 调用大模型做语义判定。candidates 为检索 topN（含分数，即使低于阈值）。
// 判定失败（LLM 异常）时返回宽松默认值，交由 answer.js 决定最终动作。
async function judgeRelatedness(question, candidates = []) {
  const context = candidates.length
    ? candidates.map((h, i) => `[候选${i + 1}] (${h.id}) ${h.text}`).join('\n\n')
    : '（无候选知识）';
  const msgs = [
    { role: 'system', content: JUDGE_SYSTEM },
    {
      role: 'user',
      content: `家长提问：${question}\n\n<候选知识>\n${context}\n</候选知识>\n\n请只输出 JSON 判定结果。`,
    },
  ];
  const raw = await chat(msgs);
  return parseVerdict(raw);
}

module.exports = { judgeRelatedness, parseVerdict, JUDGE_SYSTEM, JUDGE_FALLBACK };
