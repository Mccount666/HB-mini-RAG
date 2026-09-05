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

// 提取关键数字及紧随其后的医学单位（若有）。
// 返回 [{ num, unit }]：unit 为数字后跟的单位（如 '%'、'mg'、'岁'），无单位时为空串。
// 带单位记录供 checkGroundedNumbers 做「数字+单位」整体溯源，避免裸数字子串误判
//（如回答 "500ml" 撞知识库 "500mg"、回答 "5岁" 撞 "5"）。
function consumeUnit(rest) {
  // 多字符单位优先匹配，避免 "500ug" 只吃到 "u" 被当无单位
  const units = [
    'μg', 'u/', 'U/', '×10', 'x10', 'ug', 'mg', 'kg', 'g', 'ml', 'mL', 'cm', 'mm', 'nm', 'ng', 'iu', 'IU',
    '%', '‰', '万', '亿', '岁', '个月', '月', '年', '天', '日', '周', '次', '例', '分', '度', '周期', '疗程',
  ];
  const s = rest.replace(/^\s+/, ''); // 数字与单位间允许空白（"每天 3 次"）
  for (const u of units) {
    if (s.startsWith(u)) return u;
  }
  return '';
}

function extractCriticalNumbersDetailed(text) {
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
    const unit = consumeUnit(rest);
    const isCritical = !!unit || numStr.includes('.') || value > 20;
    if (isCritical) critical.push({ num: numStr, unit });
  }
  return critical;
}

// 兼容旧接口：仅返回数字字符串数组（单测与外部工具复用）
function extractCriticalNumbers(text) {
  return extractCriticalNumbersDetailed(text).map((c) => c.num);
}

// 关键数字必须能在知识库命中文本中找到出处。
// 匹配规则（环视词边界，避免正则单位歧义）：
//   · 数字必须以词边界出现：前面不是数字、后面不是数字（"150 万" 不会撞 "50"，"50mg" 不会撞 "5"）
//   · 带单位数字：数字后紧跟（允许空格）同一单位（不区分大小写），且单位后首字符不是字母
//     （"500ug" 不会命中 "500mg"/"500mug"）
//   · 匹配不消费边界字符："5岁5mg" 两个相邻数字都能各自找到出处
function checkGroundedNumbers(answer, hits) {
  const context = hits.map((h) => h.text || '').join('\n');
  const critical = extractCriticalNumbersDetailed(answer);
  const ungrounded = [];

  function foundInContext(c) {
    // 用前后环视（lookaround）做数字词边界：只匹配数字本身，不消费边界字符——
    // 否则 "5岁5mg" 中前一个匹配吃掉 "岁"，后一个数字找不到前导边界而漏检。
    // num 中的小数点必须转义：未转义时 "2.5" 会误匹配 "2×5"（`.` 通配任意字符）。
    const numPattern = c.num.replace(/\./g, '\\.');
    const numRe = new RegExp(`(?<!\\d)${numPattern}(?!\\d)`, 'g');
    let m;
    while ((m = numRe.exec(context)) !== null) {
      const after = context.slice(m.index + c.num.length); // 环视不消费字符，数字后即目标位置
      if (!c.unit) return true; // 无单位：词边界出现即可
      // 允许数字与单位之间有一个空格（"5 岁以下"）；单位不区分大小写（"5ml" 可溯源 "5mL"）
      const s = after.startsWith(' ') ? after.slice(1) : after;
      if (s.slice(0, c.unit.length).toLowerCase() === c.unit.toLowerCase()) {
        const restAfterUnit = s.slice(c.unit.length);
        if (!restAfterUnit || !/[a-zA-Z%‰μgml×x]/.test(restAfterUnit[0])) return true;
      }
    }
    return false;
  }

  for (const c of critical) {
    if (!foundInContext(c)) ungrounded.push(c.num);
  }
  return { ungrounded: [...new Set(ungrounded)] };
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

module.exports = { validateCitations, extractCriticalNumbers, extractCriticalNumbersDetailed, checkGroundedNumbers, guardAnswer };
