// pages/lab-compare/lab-compare.js - 化验单对比：两次 OCR 解读记录的指标趋势对照
// 数据取自本地历史里的化验单原文（rawText），提取为启发式，页面全程注明仅供参考。
const labCompare = require('../../services/lab-compare');

const fmtFull = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

Page({
  data: {
    ready: false,      // 是否有 ≥2 条化验单记录
    records: [],       // 候选记录（有 rawText 的化验单解读，时间正序）
    idxA: 0,           // 上一次
    idxB: 1,           // 这一次
    labels: [],
    rows: [],
    hasRows: false,
    // 走势区：N 次记录的同一指标横向条形图
    trendKeys: [],     // 有 ≥2 次记录的指标 key
    trendKey: '',      // 当前查看的指标
    trendLabel: '',
    trendUnit: '',
    trendBars: [],     // [{timeText, value, text, pct}]
  },

  onLoad() {
    const history = wx.getStorageSync('chat_history') || [];
    const records = history
      .filter((it) => it.rawText && String(it.rawText).trim())
      .sort((x, y) => x.time - y.time)
      .map((it) => ({ ...it, timeText: fmtFull(it.time) }));
    if (records.length < 2) {
      this.setData({ ready: false });
      return;
    }
    const labels = records.map((it) => `${it.timeText} 化验单`);
    const idxA = records.length - 2;
    const idxB = records.length - 1;
    this.setData({ ready: true, records, labels, idxA, idxB });
    this.compute();
    this.buildTrendKeys();
    this.computeTrend();
  },

  onPickA(e) {
    this.setData({ idxA: Number(e.detail.value) });
    this.compute();
  },

  onPickB(e) {
    this.setData({ idxB: Number(e.detail.value) });
    this.compute();
  },

  compute() {
    const { records, idxA, idxB } = this.data;
    if (!records.length) return;
    const a = labCompare.extractIndicators(records[idxA].rawText);
    const b = labCompare.extractIndicators(records[idxB].rawText);
    const rows = labCompare.compareIndicators(a, b).map((r) => ({
      ...r,
      trendText: labCompare.TREND_TEXT[r.trend],
    }));
    this.setData({ rows, hasRows: rows.length > 0 });
    if (!rows.length) {
      wx.showToast({ title: '两份报告没能识别出常见指标', icon: 'none' });
    }
  },

  // ===== N 次走势：找出在 ≥2 份报告里都识别到的指标 =====
  buildTrendKeys() {
    const { records } = this.data;
    const counts = new Map();
    for (const rec of records) {
      const { items } = labCompare.extractIndicators(rec.rawText);
      for (const it of items) counts.set(it.key, (counts.get(it.key) || 0) + 1);
    }
    const trendKeys = labCompare.INDICATORS.filter((ind) => (counts.get(ind.key) || 0) >= 2).map((ind) => ind.key);
    this.setData({ trendKeys, trendKey: trendKeys[0] || '' });
  },

  onTrendKeyTap(e) {
    this.setData({ trendKey: e.currentTarget.dataset.key });
    this.computeTrend();
  },

  computeTrend() {
    const { records, trendKey } = this.data;
    if (!trendKey) {
      this.setData({ trendBars: [], trendLabel: '', trendUnit: '' });
      return;
    }
    const def = labCompare.INDICATORS.find((i) => i.key === trendKey);
    const bars = [];
    let max = 0;
    for (const rec of records) {
      const { items } = labCompare.extractIndicators(rec.rawText);
      const hit = items.find((it) => it.key === trendKey);
      if (hit) {
        bars.push({ timeText: rec.timeText, value: hit.value, text: hit.text, pct: 0 });
        if (hit.value > max) max = hit.value;
      }
    }
    for (const b of bars) b.pct = max > 0 ? Math.max(6, Math.round((b.value / max) * 100)) : 0;
    this.setData({ trendBars: bars, trendLabel: def.label, trendUnit: def.unit });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  },
});
