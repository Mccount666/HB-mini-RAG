// backend/src/rag/query.js - 检索查询构建（轻量多轮指代消解）
// 家长常问「那化疗呢？」「它有什么副作用？」这类短追问，单独拿去检索会丢失主题。
// 这里不调大模型改写（省时延、省费用、零幻觉），用启发式：检测到追问特征时，
// 把上一轮用户问题拼在当前问题前面一起去检索。拼出的查询只用于检索，
// 送进大模型的仍是原始问题 + 完整历史，语义不受影响。

// 追问特征：以指示/承接词开头，或问题过短（信息量不足以独立成题）
const FOLLOWUP_PREFIX = /^(那|那么|它|他|她|这个|这种|这类|该|其|还有|另外|以及|是不是|要不要|需不需要|能不能|可不可以)/;

function buildRetrievalQuery(message, history = []) {
  const q = String(message || '').trim();
  if (!q) return q;
  const lastUser = [...history].reverse().find((h) => h && h.role === 'user' && h.content);
  const isFollowup =
    !!lastUser && (FOLLOWUP_PREFIX.test(q) || q.replace(/[?？。！!，,\s]/g, '').length <= 8);
  if (isFollowup) {
    return `${String(lastUser.content).trim()} ${q}`;
  }
  return q;
}

module.exports = { buildRetrievalQuery };
