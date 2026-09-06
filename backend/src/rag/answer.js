// backend/src/rag/answer.js - 问答全流程（自托管后端与云函数共用，防幻觉逻辑单一来源）
// 流程：检索查询构建 → 混合检索 → 机械命中则生成；未命中则 LLM 语义判定三分支：
//   相关且可答 → 用候选生成（仍走护栏）
//   相关但知识库不足 → 学习话术 + 推送 learn_queue（知识积累回路）
//   不相关 → 拒答
// 生成后护栏（引用/数字校验+重试）保持不变。
const config = require('../config');
const { embed } = require('./embedder');
const { retrieve } = require('./retriever');
const { chat } = require('./llm');
const { buildMessages } = require('./prompt');
const { buildRetrievalQuery } = require('./query');
const { guardAnswer } = require('./guard');
const { judgeRelatedness } = require('./judge');
const { sanitizeMessage, sanitizeHistory } = require('./sanitize');

// 知识库无相关内容 / 护栏拦截时的兜底话术（不调或不用模型输出，零幻觉）
const FALLBACK =
  '抱歉，我的知识库中暂未收录该问题的权威信息，建议您咨询主治医生或专科护士。';
// 提问相关但知识库尚未收录时：学习话术 + 提示会持续迭代（调用方负责把 learnQuestion 推入 learn_queue）
const LEARNING_FALLBACK =
  '您提的这个问题和我擅长的领域相关，但目前我的知识库还在学习积累中，暂时没能给出确切回答。我已经把这个问题记录下来，会持续补充相关知识——请您过几天再来问一次，我会尽力给出更准确的回答。';

function toSources(hits) {
  return hits.map((h, i) => ({
    id: i + 1,
    refId: h.id,
    title: h.title,
    excerpt: h.excerpt,
    source: h.source,
  }));
}

// 生成 + 护栏校验（无引用时带强化指令重试一次）；护栏未通过则拒答
async function generateGrounded(message, hits, history, bestScore) {
  let raw = await chat(buildMessages(message, hits, history));
  let g = guardAnswer(raw, hits, config.guard);
  if (!g.ok && g.retry) {
    raw = await chat(buildMessages(message, hits, history, { forceCite: true }));
    g = guardAnswer(raw, hits, config.guard);
  }
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

// 相关但知识库不足 → 学习回路返回对象（调用方负责入库 learn_queue）
function learningResult(question, bestScore) {
  return {
    answer: LEARNING_FALLBACK,
    sources: [],
    confidence: bestScore,
    retrieved: 0,
    refused: true,
    learning: true,
    learnQuestion: question,
  };
}

// ===== 化验参考条目并入（2026-09-05 用户确认开启）=====
// 家长在文字问答里直接问"AFP 多少算异常/参考范围"时，通用混合检索的 topK 常被
// 科普条目占满，14 条 lab_reference（已导师终审）排不进来，导致只能拒答或绕开
// 具体数值。此处在门控已通过的前提下，把得分接近通用最佳的化验条目并入候选。
// 相对门槛（≥0.8×bestScore）实测可干净区分：化验类问题 LAB 分 0.52~0.66，
// 无关问题仅 0.07~0.23；出范围问题 hits 为空直接拒答，不受影响。
const LAB_MERGE_RATIO = 0.8;
const LAB_MERGE_MAX = 2;
function mergeLabHits(hits, labTop, bestScore) {
  const have = new Set(hits.map((h) => h.id));
  const added = [];
  for (const h of labTop || []) {
    if (added.length >= LAB_MERGE_MAX) break;
    if (have.has(h.id) || h.score < bestScore * LAB_MERGE_RATIO) continue;
    added.push(h);
  }
  return added.length ? [...hits, ...added] : hits;
}

async function answerQuestion(message, history = []) {
  const cleanMessage = sanitizeMessage(message);
  const cleanHistory = sanitizeHistory(history);
  if (!cleanMessage) {
    return {
      answer: FALLBACK,
      sources: [],
      confidence: 0,
      retrieved: 0,
      refused: true,
      error: 'message 不能为空',
    };
  }

  // 1) 构建检索查询（追问场景拼接上轮问题），混合检索（向量 + BM25）
  const retrievalQuery = buildRetrievalQuery(cleanMessage, cleanHistory);
  const queryEmbedding = await embed(retrievalQuery);
  let { hits, top, bestScore } = await retrieve(queryEmbedding, {
    queryText: retrievalQuery,
  });
  // 门控通过时并入化验参考候选（hits 为空 = 出范围，保持原拒答语义不动）
  if (hits.length > 0) {
    const lab = await retrieve(queryEmbedding, {
      queryText: retrievalQuery,
      category: 'lab_reference',
      topK: LAB_MERGE_MAX,
    });
    hits = mergeLabHits(hits, lab.top, bestScore);
  }

  // 2) 机械命中 → 直接生成（高频正常路径，不额外花费一次 LLM 判定）
  if (hits.length > 0) {
    const res = await generateGrounded(cleanMessage, hits, cleanHistory, bestScore);
    // 机械命中但生成被护栏/模型拒答：说明知识库对该问题的覆盖仍不足 →
    // 转入学习回路（既不给错答，也把问题记入 learn_queue 供补充）
    if (!res.refused) return res;
    return learningResult(cleanMessage, bestScore);
  }

  // 3) 机械未命中 → LLM 语义判定：是"相关可答 / 相关待学习 / 不相关"
  let verdict;
  try {
    verdict = await judgeRelatedness(cleanMessage, top);
  } catch (e) {
    console.warn('[judge] LLM 语义判定失败，降级为机械拒答：', e.message);
    return {
      answer: FALLBACK,
      sources: [],
      confidence: bestScore,
      retrieved: 0,
      refused: true,
      judge: 'fail',
    };
  }

  // 3a) 相关且可答 → 用检索候选生成（仍走护栏；护栏拦下则转入学习回路）
  if (verdict.related && verdict.answerable) {
    const candidates = top.slice(0, config.retrieval.topK);
    if (candidates.length) {
      const res = await generateGrounded(cleanMessage, candidates, cleanHistory, bestScore);
      if (!res.refused) return res;
      return learningResult(cleanMessage, bestScore);
    }
  }

  // 3b) 相关但知识库不足 → 学习话术 + 推送队列
  if (verdict.related) {
    return learningResult(cleanMessage, bestScore);
  }

  // 3c) 不相关 → 拒答
  return {
    answer: FALLBACK,
    sources: [],
    confidence: bestScore,
    retrieved: 0,
    refused: true,
    judge: 'unrelated',
  };
}

module.exports = { answerQuestion, FALLBACK, LEARNING_FALLBACK, mergeLabHits };
