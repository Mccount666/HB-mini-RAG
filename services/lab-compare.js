// services/lab-compare.js - 化验单指标提取与两次对比（纯函数，无 wx 依赖，可单测）
// 数据来源：历史记录里保存的 OCR 原文（rawText）。提取是启发式的，结果仅供
// 家长自行对照趋势参考，页面须注明"以医生解读为准"。

// 指标定义：re 在关键词后近距离抓第一个数字（排除 10^9 / 10*9 / "9/L" 这类单位片段）。
// commas 处理 AFP 等可能带千分位逗号的数值。
const INDICATORS = [
  { key: 'AFP', label: 'AFP（甲胎蛋白）', unit: 'ng/mL', commas: true, re: /(?:AFP|甲胎蛋白)[^\d]{0,12}?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'WBC', label: '白细胞 WBC', unit: '×10⁹/L', re: /(?:WBC|白细胞)[^\d]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'NEUT', label: '中性粒细胞#', unit: '×10⁹/L', re: /(?:中性粒细胞|NEUT#|#NEUT|NEUT)[^\d#]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'HGB', label: '血红蛋白 HGB', unit: 'g/L', re: /(?:HGB|血红蛋白)[^\d]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'PLT', label: '血小板 PLT', unit: '×10⁹/L', re: /(?:PLT|血小板)[^\d]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'ALT', label: '谷丙转氨酶 ALT', unit: 'U/L', re: /(?:ALT|谷丙转氨酶)[^\d]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'AST', label: '谷草转氨酶 AST', unit: 'U/L', re: /(?:AST|谷草转氨酶)[^\d]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
  { key: 'CRP', label: 'C反应蛋白 CRP', unit: 'mg/L', re: /(?:CRP|C-?反应蛋白)[^\d]{0,12}?(\d+(?:\.\d+)?)(?![\d]*[\^*]\s*9)/i },
];

function toNumber(raw, commas) {
  const s = String(raw || '').replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 从化验单 OCR 原文提取指标
 * @param {string} rawText
 * @returns {{found: number, items: Array<{key,label,unit,value,text}>}}
 */
function extractIndicators(rawText) {
  const text = String(rawText || '');
  const items = [];
  for (const ind of INDICATORS) {
    const m = text.match(ind.re);
    if (!m) continue;
    const value = toNumber(m[1], ind.commas);
    if (value === null) continue;
    items.push({ key: ind.key, label: ind.label, unit: ind.unit, value, text: m[1] });
  }
  return { found: items.length, items };
}

/**
 * 对比两次提取结果
 * @param {{items:Array}} a 上一次（较早）
 * @param {{items:Array}} b 这一次（较晚）
 * @returns {Array<{key,label,unit,aText,bText,trend,delta}>} trend: 'up'|'down'|'flat'|'only-a'|'only-b'
 */
function compareIndicators(a, b) {
  const mapA = new Map((a.items || []).map((it) => [it.key, it]));
  const mapB = new Map((b.items || []).map((it) => [it.key, it]));
  const keys = [];
  for (const ind of INDICATORS) {
    if (mapA.has(ind.key) || mapB.has(ind.key)) keys.push(ind.key);
  }
  return keys.map((key) => {
    const def = INDICATORS.find((i) => i.key === key);
    const va = mapA.get(key);
    const vb = mapB.get(key);
    let trend = 'flat';
    if (!vb) trend = 'only-a';
    else if (!va) trend = 'only-b';
    else if (vb.value > va.value) trend = 'up';
    else if (vb.value < va.value) trend = 'down';
    const delta = va && vb ? vb.value - va.value : null;
    return {
      key,
      label: def.label,
      unit: def.unit,
      aText: va ? va.text : '—',
      bText: vb ? vb.text : '—',
      trend,
      delta: delta === null ? null : Math.round(delta * 100) / 100,
    };
  });
}

const TREND_TEXT = {
  up: '↑ 升高',
  down: '↓ 降低',
  flat: '→ 相近',
  'only-a': '仅上次有',
  'only-b': '仅本次有',
};

module.exports = { extractIndicators, compareIndicators, INDICATORS, TREND_TEXT };
