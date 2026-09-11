// backend/src/ocr/interpret.js - 化验单解读（严格基于参考标准，控幻觉）
// 流程：向量化化验单原文 → 在 lab_reference 分类内检索参考区间 → 拼严格 OCR 提示词 → 调大模型
// 注意：化验单解读的数值允许来自家长上传的报告原文或命中的参考标准，
// 输出若补充两者之外的数字，仍按医学数字幻觉处理。
const { embed } = require('../rag/embedder');
const { retrieve } = require('../rag/retriever');
const { chat } = require('../rag/llm');
const { buildOcrMessages } = require('../rag/prompt');
const { validateCitations, checkGroundedNumbers } = require('../rag/guard');
const { buildRetrievalQuery } = require('../rag/query');
const config = require('../config');

async function interpretLabReport(rawText, history = []) {
  if (!rawText || !String(rawText).trim()) {
    return { rawText: '', interpretation: '未能识别化验单内容，请重新拍摄清晰、完整的化验单后重试。', sources: [] };
  }
  // 只在「化验单参考区间」分类内检索，并取全部参考条目作为上下文（化验条目仅 ~14 条），
  // 保证每条异常值都被引用、且严格基于诊断标准而非自由发挥
  const retrievalQuery = buildRetrievalQuery(
    '化验单 解读 参考区间 ' + String(rawText).slice(0, 400),
    history
  );
  const qe = await embed(retrievalQuery);
  const { hits } = await retrieve(qe, {
    queryText: retrievalQuery,
    category: 'lab_reference',
    topK: config.retrieval.ocrTopK,
    threshold: config.retrieval.ocrThreshold,
    minCoverage: 0, // 化验单原文关键词不受覆盖率门控（报告词汇与条目标题天然不同）
  });

  const messages = buildOcrMessages(rawText, hits, history);
  const rawInterpretation = await chat(messages);
  // 引用护栏：剔除越界的 [来源N]，防止模型指向不存在的参考条目
  const { answer: citedInterpretation } = validateCitations(rawInterpretation, hits.length);
  const numberContext = [{ text: rawText }, ...hits.map((h) => ({ text: h.text }))];
  const { ungrounded } = checkGroundedNumbers(citedInterpretation, numberContext);
  const interpretation = ungrounded.length
    ? '化验单解读结果中出现了无法在报告原文或参考标准中核对的数字。为避免误导，暂不展示自动解读，请带报告咨询主治医生或专科护士。'
    : citedInterpretation;

  const sources = hits.map((h, i) => ({
    id: i + 1,
    refId: h.id,
    title: h.title,
    excerpt: h.excerpt,
    source: h.source,
  }));

  return { rawText, interpretation, sources };
}

module.exports = { interpretLabReport };
