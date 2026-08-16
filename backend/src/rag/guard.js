// backend/src/rag/guard.js - 生成后护栏（第五道防线：输出校验）
// 提示词再严，模型仍可能"漏引用"或"输出知识库外的数字"。医学场景下，
// 一个凭空出现的剂量/百分比就是事故。因此在返回给家长前做两层机检：
//   1. 引用校验：[来源N] 必须指向真实提供的条目编号，无效引用直接剔除
//   2. 数字溯源：回答中的关键数字（带医学单位 / 含小数 / 数值>20）必须能在
//      命中的知识库文本中找到原文出处，否则判定整条回答不可信 → 拒答
// 注意：数字溯源仅用于文本问答。化验单解读的数字来自家长上传的报告本身，
// 不适用该检查（interpret.js 只做引用校验）。

const CITATION_RE = /\[\s*来源\s*(\d+)\s*\]/g;

// —— 引用校验 ——
// 剔除越界的 [来源N]（N 超出实际提供的条目数），返回净化后的文本与有效引用数
function validateCitations(answer, hitCount) {
  let valid = 0;
  const cleaned = String(answer || '').replace(CITATION_RE, (m, n) => {
    const idx = parseInt(n, 10);
    if (idx >= 1 && idx <= hitCount) {
      valid += 1;
      return m;
    }
    return ''; // 无效引用：模型指了个不存在的来源，直接删掉
  });
  return { answer: cleaned, citationCount: valid };
}

// —— 数字溯源 ——
// 判定一个数字是否"关键"：带医学单位 / 含小数 / 数值大于 20（剂量、百分比、日数、计数等）。
// 纯列表序号（"1. 2. 3."）与短整数不检查，避免格式性误报导致过度拒答。
const UNIT_AFTER_RE =
  /^\s*(%|‰|mg|ug|μg|g|kg|ml|mL|cm|mm|nm|ng|iu|u\/|U\/|×10|x10|万|亿|岁|个月|月|年|天|日|周|次|例|分|度|周期|疗程)/i;

function extractCriticalNumbers(text) {
  const critical = [];
  // 先按行处理，跳过行首列表序号（(?!\d) 避免误吞 "2.5mg" 这类行首小数）
  const lines = text.split(/\n+/);
  const stripped = lines
    .map((l) => l.replace(/^\s*[0-9一二三四五六七八九十]{1,3}[、.．)）](?!\d)\s*/, ''))
    .join('\n');
  // 掩掉合法引用标记，避免 [来源3] 里的 3 被当作待检数字
  const masked = stripped.replace(CITATION_RE, '[来源#]');
  const numRe = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = numRe.exec(masked)) !== null) {
    const numStr = m[0];
    const rest = masked.slice(m.index + numStr.length, m.index + numStr.length + 6);
    const value = parseFloat(numStr);
    const isCritical =
      UNIT_AFTER_RE.test(rest) || numStr.includes('.') || value > 20;
    if (isCritical) critical.push(numStr);
  }
  return critical;
}

// 关键数字必须逐字出现在知识库命中文本中（模型被要求禁止换算，因此可逐字比对）
function checkGroundedNumbers(answer, hits) {
  const context = hits.map((h) => h.text || '').join('\n');
  const critical = extractCriticalNumbers(answer);
  const ungrounded = [...new Set(critical)].filter((n) => !context.includes(n));
  return { ungrounded };
}

// —— 护栏总入口 ——
// 返回:
//   { ok:true,  answer, citationCount, ungrounded:[] }          → 放行
//   { ok:false, reason:'no_citations', retry:true, ... }        → 无引用，可重试一次
//   { ok:false, reason:'ungrounded_numbers', retry:false, ... } → 数字无出处，直接拒答
function guardAnswer(rawAnswer, hits, opts = {}) {
  const checkNumbers = opts.checkNumbers !== false;
  const requireCitations = opts.requireCitations !== false;

  const { answer, citationCount } = validateCitations(rawAnswer, hits.length);

  if (checkNumbers) {
    const { ungrounded } = checkGroundedNumbers(answer, hits);
    if (ungrounded.length) {
      return { ok: false, reason: 'ungrounded_numbers', retry: false, answer, citationCount, ungrounded };
    }
  }

  if (requireCitations && citationCount === 0) {
    return { ok: false, reason: 'no_citations', retry: true, answer, citationCount, ungrounded: [] };
  }

  return { ok: true, answer, citationCount, ungrounded: [] };
}

module.exports = { validateCitations, extractCriticalNumbers, checkGroundedNumbers, guardAnswer };
