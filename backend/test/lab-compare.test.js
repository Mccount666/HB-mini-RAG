// backend/test/lab-compare.test.js - 小程序化验单对比：指标提取与趋势对比回归
// 被测模块是无 wx 依赖的纯函数（miniprogram services），可直接 require 测试。
const test = require('node:test');
const assert = require('node:assert');
const { extractIndicators, compareIndicators } = require('../../services/lab-compare');

test('extractIndicators：常规血常规+肝功能+AFP 全部识别', () => {
  const text = [
    '姓名：张小宝  年龄：2岁',
    'WBC 白细胞 4.5 10^9/L',
    'HGB 血红蛋白 105 g/L',
    'PLT 血小板 320 10^9/L',
    'ALT 谷丙转氨酶 35 U/L',
    'AST 谷草转氨酶 42 U/L',
    'AFP 甲胎蛋白 1250.0 ng/mL',
  ].join('\n');
  const r = extractIndicators(text);
  const byKey = Object.fromEntries(r.items.map((it) => [it.key, it.value]));
  assert.equal(byKey.WBC, 4.5);
  assert.equal(byKey.HGB, 105);
  assert.equal(byKey.PLT, 320);
  assert.equal(byKey.ALT, 35);
  assert.equal(byKey.AST, 42);
  assert.equal(byKey.AFP, 1250.0);
  assert.equal(r.found, 6);
});

test('extractIndicators：不把单位 10^9 里的数字误当指标值', () => {
  // "白细胞(10^9/L) 4.5" 这类先出现单位的写法不应取到 10 或 9
  const r = extractIndicators('白细胞(10^9/L) 4.5  WBC 3.8');
  const wbc = r.items.find((it) => it.key === 'WBC');
  assert.ok(wbc, '应识别到 WBC');
  assert.ok([4.5, 3.8].includes(wbc.value), `取值应为真实数值，实际 ${wbc.value}`);
  assert.notEqual(wbc.value, 10);
  assert.notEqual(wbc.value, 9);
});

test('extractIndicators：AFP 千分位逗号数值', () => {
  const r = extractIndicators('AFP 1,250.5 ng/mL');
  const afp = r.items.find((it) => it.key === 'AFP');
  assert.ok(afp);
  assert.equal(afp.value, 1250.5);
  assert.equal(afp.text, '1,250.5');
});

test('extractIndicators：中文关键词与 CRP/中性粒细胞 识别', () => {
  const r = extractIndicators('血小板 250 ×10⁹/L\n中性粒细胞数目 1.8\nC反应蛋白 12.3 mg/L');
  const byKey = Object.fromEntries(r.items.map((it) => [it.key, it.value]));
  assert.equal(byKey.PLT, 250);
  assert.equal(byKey.NEUT, 1.8);
  assert.equal(byKey.CRP, 12.3);
});

test('compareIndicators：趋势/缺失/增量', () => {
  const a = extractIndicators('AFP 100 ng/mL\nWBC 5.0\nPLT 300');
  const b = extractIndicators('AFP 40 ng/mL\nWBC 4.2');
  const rows = compareIndicators(a, b);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.AFP.trend, 'down');
  assert.equal(byKey.AFP.delta, -60);
  assert.equal(byKey.WBC.trend, 'down');
  assert.equal(byKey.PLT.trend, 'only-a');
  // 全部缺失时返回空数组，页面据此提示
  const empty = compareIndicators(extractIndicators(''), extractIndicators(''));
  assert.deepEqual(empty, []);
});
