// backend/src/rag/answer.js - 问答全流程（自托管后端与云函数共用，防幻觉逻辑单一来源）
// 流程：检索查询构建 → 混合检索 → 阈值门控 → 严格提示词 → 大模型 → 生成后护栏（引用/数字校验+重试）
const config = require('../config');
const { embed } = require('./embedder');
const { retrieve } = require('./retriever');
const { chat } = require('./llm');
const { buildMessages } = require('./prompt');
const { buildRetrievalQuery } = require('./query');
const { guardAnswer } = require('./guard');

// 知识库无相关内容 / 护栏拦截时的兜底话术（不调或不用模型输出，零幻觉）
const FALLBACK =
  '抱歉，我的知识库中暂未收录该问题的权威信息，建议您咨询主治医生或专科护士。';

function toSources(hits) {
  return hits.map((h, i) => ({
    id: i + 1,
    refId: h.id,
    title: h.title,
    excerpt: h.excerpt,
    source: h.source,
  }));
}

async function answerQuestion(message, history = []) {
  // 1) 构建检索查询（追问场景拼接上轮问题），混合检索（向量 + BM25）
  const retrievalQuery = buildRetrievalQuery(message, history);
  const queryEmbedding = await embed(retrievalQuery);
  const { hits, bestScore } = await retrieve(queryEmbedding, { queryText: retrievalQuery });

  // 2) 置信度门控：知识库无相关内容时直接拒答，根本不调大模型 → 零幻觉
  if (config.retrieval.strict && hits.length === 0) {
    return { answer: FALLBACK, sources: [], confidence: bestScore, retrieved: 0, refused: true };
  }

  // 3) 生成 + 护栏校验；无引用时带强化指令重试一次
  let raw = await chat(buildMessages(message, hits, history));
  let g = guardAnswer(raw, hits, config.guard);
  if (!g.ok && g.retry) {
    raw = await chat(buildMessages(message, hits, history, { forceCite: true }));
    g = guardAnswer(raw, hits, config.guard);
  }

  // 4) 护栏未通过（数字无出处 / 重试后仍无引用）→ 拒答，宁可不答不可错答
  if (!g.ok) {
    const detail =
      g.reason === 'ungrounded_numbers' && g.ungrounded.length
        ? `无出处数字: ${g.ungrounded.join(', ')}`
        : g.reason;
    console.warn(`[guard] 拦截回答（${detail}）`);
    return {
      answer: FALLBACK,
      sources: [],
      confidence: bestScore,
      retrieved: hits.length,
      refused: true,
    };
  }

  return {
    answer: g.answer,
    sources: toSources(hits),
    confidence: bestScore,
    retrieved: hits.length,
  };
}

module.exports = { answerQuestion, FALLBACK };
