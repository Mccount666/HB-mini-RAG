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

// 单位等价类：同一单位的中西文写法视为相等。数字带中文单位（毫克/毫升…）时
// 若不识别，会落入"无单位"宽松规则——KB 写 100mg、回答写"100 毫升"也误判已溯源。
// 未列入等价类的单位（%、岁、天、×10…）仍按原文（大小写不敏感）比对。
const UNIT_EQUIV = [
  ['mg', '毫克'],
  ['ml', 'ml', '毫升'],
  ['ug', 'μg', '微克'],
  ['kg', '千克', '公斤'],
  ['g', '克'],
  ['cm', '厘米'],
  ['mm', '毫米'],
  ['iu', 'IU'],
  // 浓度单位独立成类，避免与 mm（毫米）/m（米）串扰：2.5mmol/L 不得溯源到 2.5毫米
  ['mmol/l', 'mmol/L'],
  ['u/l', 'U/L'],
  ['iu/l', 'IU/L'],
  ['%', '％'],
];
const UNIT_CANON = new Map();
for (const group of UNIT_EQUIV) {
  for (const alias of group) UNIT_CANON.set(alias.toLowerCase(), group[0]);
}
function unitClass(unit) {
  return UNIT_CANON.get(unit.toLowerCase()) || unit.toLowerCase();
}

function consumeUnit(rest) {
  // 多字符单位优先匹配，避免 "500ug" 只吃到 "u" 被当无单位；
  // mmol/L / U/L 等含斜杠整体单位必须排在 mm/u 之前，否则 "2.5mmol/L" 只吃到 "mm"
  const units = [
    'mmol/L', 'mmol', 'IU/L', 'IU', 'U/L', 'u/', 'U/',
    'μg', '×10', 'x10', 'ug', 'mg', 'kg', 'g', 'ml', 'mL', 'cm', 'mm', 'nm', 'ng', 'iu',
    '毫克', '毫升', '微克', '千克', '公斤', '克', '厘米', '毫米',
    '％', '%', '‰', '万', '亿', '岁', '个月', '月', '年', '天', '日', '周', '次', '例', '分', '度', '周期', '疗程',
  ];
  const s = rest.replace(/^\s+/, ''); // 数字与单位间允许空白（"每天 3 次"）
  for (const u of units) {
    if (s.startsWith(u)) {
      // 斜杠复合单位（ng/mL、μg/L、U/ml…）：基单位后紧跟 "/" 时一并消费，
      // 否则溯源时 "10 ng/mL" 只吃到 "ng"、剩 "/mL" 会被单位后边界检查误拒
      let end = u.length;
      if (s[end] === '/') {
        const m = /^\/[A-Za-z0-9μ×]+/.exec(s.slice(end));
        if (m) end += m[0].length;
      }
      return s.slice(0, end);
    }
  }
  return '';
}

// 数字规范化：全角数字→半角；中文数字+已知单位→阿拉伯数字+单位。
// 防护栏线：模型若输出 "５００mg"（全角）或 "五百毫克"（中文），原 numRe /\d+/ 抓不到，
// 编造剂量即绕过溯源。此处先规范化再提取，覆盖这两类盲区。
// 中文数字解析覆盖一..九与十/百/千 组合（十一、二十、五百、二百五等），万以上从简。
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function parseChineseNum(str) {
  if (!/^[零一二两三四五六七八九十百千万]+$/.test(str)) return null;
  const unitMap = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let digit = 0;
  let lastUnit = 1;
  let hasUnit = false;
  let lastUnitIndex = -1;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch in CN_DIGIT) {
      digit = CN_DIGIT[ch];
    } else if (ch in unitMap) {
      section += (digit || 1) * unitMap[ch]; // "十" = 10，"十五" = 10 + 5
      digit = 0;
      lastUnit = unitMap[ch];
      hasUnit = true;
      lastUnitIndex = i;
    } else if (ch === '万') {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
      lastUnit = 1;
      hasUnit = true;
      lastUnitIndex = i;
    }
  }
  if (digit) {
    const suffix = lastUnitIndex >= 0 ? str.slice(lastUnitIndex + 1) : str;
    const colloquialTens = hasUnit && lastUnit >= 100 && suffix.length === 1 && !suffix.includes('零');
    section += colloquialTens ? digit * (lastUnit / 10) : digit;
  }
  const result = total + section;
  return result > 0 ? result : null;
}
// 单位片段（与 consumeUnit 表对齐，用于"中文数字+单位"识别）
const CN_UNIT_RE =
  '(?:mmol/L|IU/L|U/L|u/|μg|×10|x10|ug|mg|kg|g|ml|mL|cm|mm|nm|ng|iu|IU|毫克|毫升|微克|千克|公斤|克|厘米|毫米|％|%|‰|万|亿|岁|个月|月|年|天|日|周|次|例|分|度|周期|疗程)';
function normalizeNumbers(s) {
  // 1) 全角数字 → 半角
  s = s.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10));
  // 2) 中文数字 + 紧随单位 → 阿拉伯数字 + 单位（仅在这种组合下转换，避免误伤"十一"序号等无单位上下文）
  s = s.replace(new RegExp('([零一二两三四五六七八九十百千万]+)' + CN_UNIT_RE), (m, cn) => {
    const n = parseChineseNum(cn);
    return n == null ? m : n + m.slice(cn.length);
  });
  return s;
}

function extractCriticalNumbersDetailed(text) {
  const critical = [];
  // 先规范化全角数字与中文数字+单位，避免模型输出变体绕过 /\d+/ 提取
  const normalized = normalizeNumbers(String(text || ''));
  // 先按行处理，跳过行首列表序号（(?!\d) 避免误吞 "2.5mg" 这类行首小数）
  const lines = normalized.split(/\n+/);
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
//   · 带单位数字：数字后紧跟（允许空格）等价类相同的单位（mg↔毫克、ml↔mL↔毫升…，大小写不敏感），
//     且单位后首字符不是字母（"500ug" 不会命中 "500mg"/"500mug"）——回答"100 毫升"撞知识库"100mg"
//     属单位错换，必须拒答
//   · 匹配不消费边界字符："5岁5mg" 两个相邻数字都能各自找到出处
function checkGroundedNumbers(answer, hits) {
  const context = normalizeNumbers(hits.map((h) => h.text || '').join('\n'));
  const critical = extractCriticalNumbersDetailed(answer);
  const ungrounded = [];

  function foundInContext(c) {
    // 用前后环视（lookaround）做数字词边界：只匹配数字本身，不消费边界字符——
    // 否则 "5岁5mg" 中前一个匹配吃掉 "岁"，后一个数字找不到前导边界而漏检。
    // num 中的小数点必须转义：未转义时 "2.5" 会误匹配 "2×5"（`.` 通配任意字符）。
    const numPattern = c.num.replace(/\./g, '\\.');
    const numRe = new RegExp(`(?<!\\d)${numPattern}(?!\\d)`, 'g');
    const wantClass = unitClass(c.unit);
    let m;
    while ((m = numRe.exec(context)) !== null) {
      const after = context.slice(m.index + c.num.length); // 环视不消费字符，数字后即目标位置
      if (!c.unit) return true; // 无单位：词边界出现即可
      // 数字与单位间允许空白；KB 侧单位按等价类比对（毫克↔mg 同类放行，毫克↔ml 异类拒答）
      const trimmed = after.replace(/^\s+/, '');
      const ctxUnit = consumeUnit(trimmed.slice(0, 8));
      if (ctxUnit && unitClass(ctxUnit) === wantClass) {
        const restAfterUnit = trimmed.slice(ctxUnit.length);
        if (!restAfterUnit || !/[a-zA-Z%％‰μgml×x/]/.test(restAfterUnit[0])) return true;
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
